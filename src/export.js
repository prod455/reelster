import { messagesForThread, parseBodies } from "./lib/messages.js";
import { mediaFromSources, sharesFromMessages, shortcodeToMediaId } from "./lib/shares.js";
import { archiveEntries, failureSummary } from "./lib/exporter.js";
import { tarGzStream } from "./lib/tar.js";
import { inPeriod, isBeforePeriod, parsePeriod } from "./lib/period.js";

const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String));
const statusEl = document.getElementById("status");
const progressEl = document.getElementById("progress");
const stopButton = document.getElementById("stop");
const saveButton = document.getElementById("save");
const failuresEl = document.getElementById("failures");
const diagnosticsEl = document.getElementById("diagnostics");
document.getElementById("title").textContent = t("exportTitle");
document.getElementById("keep-open").textContent = t("keepOpen");
stopButton.textContent = t("stopNow");
const setupForm = document.getElementById("setup");
document.getElementById("period-legend").textContent = t("periodLegend");
document.getElementById("from-label").textContent = t("periodFrom");
document.getElementById("to-label").textContent = t("periodTo");
document.getElementById("period-hint").textContent = t("periodHint");
document.getElementById("start").textContent = t("start");
saveButton.textContent = t("saveAgain");

const params = new URLSearchParams(location.search);
const tabId = Number(params.get("tab"));
const threadId = params.get("thread");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SCROLL_INTERVAL_MS = 1_500;
const IDLE_MS_TO_FINISH = 20_000; // this long without new messages = start of the chat
const RESOLVE_DELAY_MS = 800;
// Instagram's post query (PolarisPostRootQuery). Meta rotates these ids; when
// it stops working the HTML fallback below still applies.
const POST_QUERY_DOC_ID = "27852811784380813";

async function inTab(func, ...args) {
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func, args });
  return result;
}

// --- Functions below run inside the Instagram tab; they must be self-contained.

function drainAndScroll(knownTexts) {
  const bodies = window.__reelsterBodies ? window.__reelsterBodies.splice(0) : [];
  if (!window.__reelsterReadSsr) {
    // The newest messages are rendered into the HTML instead of fetched.
    window.__reelsterReadSsr = true;
    for (const script of document.querySelectorAll('script[type="application/json"]')) {
      if (script.textContent.includes("slide_messages")) bodies.push(script.textContent);
    }
  }
  const scrollable = (el) => {
    const overflow = getComputedStyle(el).overflowY;
    return (overflow === "auto" || overflow === "scroll") && el.scrollHeight > el.clientHeight;
  };
  // Best guess: the scrollable ancestor of a message we already read.
  let list = null;
  let found = "none";
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text && !list; text = walker.nextNode()) {
    if (!knownTexts.some((known) => text.data.includes(known))) continue;
    for (let el = text.parentElement; el; el = el.parentElement) {
      if (scrollable(el)) { list = el; found = "text"; break; }
    }
  }
  // Fallback: the right-most large scrollable element (the inbox is on the left).
  if (!list) {
    for (const el of document.querySelectorAll("div")) {
      if (!scrollable(el) || el.clientHeight < 200) continue;
      if (!list || el.getBoundingClientRect().left > list.getBoundingClientRect().left) list = el;
    }
    if (list) found = "guess";
  }
  if (list) {
    // Nudge down, then jump to the oldest message. A negative top also covers
    // column-reverse lists; regular lists clamp it to 0. Some lists only react
    // to wheel input, so send that too.
    list.scrollBy(0, 400);
    list.scrollTo(0, -list.scrollHeight);
    list.dispatchEvent(new WheelEvent("wheel", { deltaY: -2000, bubbles: true, cancelable: true }));
  }
  return { bodies, hasHook: Array.isArray(window.__reelsterBodies), found };
}

// Asks Instagram for a reel's or post's media in three independent ways and returns
// every raw answer; the extension side picks the files (mediaFromSources).
async function fetchMediaSources(shortcode, mediaId, docId) {
  const csrf = /(?:^|;\s*)csrftoken=([^;]+)/.exec(document.cookie)?.[1] ?? "";
  let dtsg = "";
  for (const script of document.scripts) {
    const match = /"DTSGInitialData",\[\],\{"token":"([^"]+)"/.exec(script.textContent) ?? /"dtsg":\s*\{\s*"token":"([^"]+)"/.exec(script.textContent);
    if (match) { dtsg = match[1]; break; }
  }
  const headers = {
    "x-csrftoken": csrf,
    "x-ig-app-id": "936619743392459",
    "x-ig-www-claim": sessionStorage.getItem("www-claim-v2") ?? "0",
    "x-requested-with": "XMLHttpRequest",
  };
  async function attempt(name, url, init, read = (r) => r.text()) {
    try {
      const response = await fetch(url, { credentials: "include", ...init });
      return { name, status: response.status, text: response.ok ? await read(response) : "" };
    } catch (error) {
      return { name, status: 0, text: "", error: String(error) };
    }
  }
  return [
    await attempt("graphql", "/graphql/query", {
      method: "POST",
      headers: { ...headers, "content-type": "application/x-www-form-urlencoded", "x-fb-friendly-name": "PolarisPostRootQuery" },
      body: new URLSearchParams({
        fb_dtsg: dtsg,
        fb_api_caller_class: "RelayModern",
        fb_api_req_friendly_name: "PolarisPostRootQuery",
        doc_id: docId,
        variables: JSON.stringify({
          shortcode,
          __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: false,
          __relay_internal__pv__PolarisMultiCaptionCarouselEnabledrelayprovider: false,
        }),
        server_timestamps: "true",
      }),
    }),
    await attempt("info", `/api/v1/media/${mediaId}/info/`, { headers }),
    await attempt("html", `/reel/${shortcode}/`, {}, async (response) => {
      // The reel page embeds its media as JSON; keep only those scripts.
      const html = new DOMParser().parseFromString(await response.text(), "text/html");
      return [...html.querySelectorAll('script[type="application/json"]')]
        .map((s) => s.textContent)
        .filter((text) => text.includes(shortcode))
        .join("\n");
    }),
  ];
}

// Downloads a file with the Instagram page's own origin and returns it as a
// data: URL. Fallback for when the CDN refuses the extension's request.
async function fetchFileInTab(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return { error: `HTTP ${response.status}` };
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ dataUrl: reader.result });
      reader.onerror = () => resolve({ error: String(reader.error) });
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    return { error: String(error) };
  }
}

// --- Extension side.

async function viewerId() {
  const cookie = await chrome.cookies.get({ url: "https://www.instagram.com", name: "ds_user_id" });
  if (!cookie?.value) throw new Error(t("notLoggedIn"));
  return cookie.value;
}

async function reloadInstagramTab() {
  const loaded = new Promise((resolve) => {
    chrome.tabs.onUpdated.addListener(function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
  await chrome.tabs.reload(tabId);
  await loaded;
}

/** Scrolls the chat up and collects its messages until its start or the period start. */
async function readThread(viewer, period) {
  const messages = new Map();
  const threadIds = new Set([threadId]);
  let stopped = false;
  let oldest = Infinity;
  let lastNewAt = Date.now();
  let responses = 0;
  stopButton.hidden = false;
  stopButton.onclick = () => (stopped = true);
  while (!stopped && Date.now() - lastNewAt < IDLE_MS_TO_FINISH && !isBeforePeriod(oldest, period)) {
    await sleep(SCROLL_INTERVAL_MS);
    const knownTexts = [...messages.values()]
      .map((m) => (m.text_body ?? m.content?.text_body ?? "").trim().slice(0, 40))
      .filter((text) => text.length >= 4)
      .slice(-20);
    const { bodies, hasHook, found } = await inTab(drainAndScroll, knownTexts);
    if (!hasHook) throw new Error(t("noMessages"));
    responses += bodies.length;
    const before = messages.size;
    for (const body of bodies) {
      for (const doc of parseBodies(body)) {
        for (const node of messagesForThread(doc, threadIds)) {
          messages.set(String(node.message_id ?? node.id), node);
          oldest = Math.min(oldest, Number(node.timestamp_ms));
        }
      }
    }
    if (messages.size > before) lastNewAt = Date.now();
    const shares = sharesFromMessages(messages.values(), viewer).filter((s) => inPeriod(s.sentAt, period));
    const reels = shares.filter((s) => s.kind === "reel").length;
    statusEl.textContent = t("stepScan", messages.size, reels, shares.length - reels);
    diagnosticsEl.textContent = t(found === "none" ? "listNotFound" : "scanHint") + " · " +
      t("diagnostics", responses, t(`list_${found}`));
  }
  stopButton.hidden = true;
  if (messages.size === 0) throw new Error(t("noMessages"));
  return [...messages.values()];
}

async function resolveMedia(share) {
  await sleep(RESOLVE_DELAY_MS);
  const sources = await inTab(fetchMediaSources, share.shortcode, shortcodeToMediaId(share.shortcode), POST_QUERY_DOC_ID);
  try {
    return mediaFromSources(sources, share.shortcode);
  } catch (error) {
    throw new Error(`${t("mediaNotFound")} [${error.message}]`);
  }
}

async function fetchMedia(url) {
  let direct;
  try {
    const response = await fetch(url);
    if (response.ok) return new Uint8Array(await response.arrayBuffer());
    direct = `HTTP ${response.status}`;
  } catch (error) {
    direct = String(error);
  }
  const { dataUrl, error } = await inTab(fetchFileInTab, url);
  if (error) throw new Error(`download failed [extension: ${direct}; tab: ${error}]`);
  return new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
}

function onProgress({ done, total }) {
  progressEl.max = total;
  progressEl.value = done;
  statusEl.textContent = t("stepDownload", done, total);
}

function save(blob, filename) {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: filename }).click();
  addEventListener("pagehide", () => URL.revokeObjectURL(url), { once: true });
}

async function run(period) {
  if (!Number.isInteger(tabId) || !threadId) throw new Error("missing tab or thread");
  const viewer = await viewerId();
  progressEl.hidden = false;
  statusEl.textContent = t("stepReload");
  await chrome.tabs.update(tabId, { active: true });
  await reloadInstagramTab();
  const shares = sharesFromMessages(await readThread(viewer, period), viewer).filter((s) => inPeriod(s.sentAt, period));
  diagnosticsEl.textContent = "";
  if (shares.length === 0) {
    progressEl.hidden = true;
    statusEl.textContent = t("noShares");
    return;
  }

  let manifest;
  async function* entries() {
    for await (const entry of archiveEntries({ shares, resolveMedia, fetchMedia, threadId, period, onProgress })) {
      if (entry.name === "manifest.json") {
        manifest = JSON.parse(new TextDecoder().decode(entry.data));
        statusEl.textContent = t("stepCompress");
      }
      yield entry;
    }
  }
  const blob = await new Response(tarGzStream(entries())).blob();
  const filename = `reelster-${threadId}-${new Date().toISOString().slice(0, 10)}.tar.gz`;
  save(blob, filename);
  saveButton.hidden = false;
  saveButton.onclick = () => save(blob, filename);
  const { reels, posts, post_files, failed } = manifest.totals;
  statusEl.textContent = t("done", reels.sent + reels.received, posts.sent + posts.received, post_files, failed);
  for (const { error, count } of failureSummary(manifest.failed)) {
    failuresEl.append(Object.assign(document.createElement("li"), { textContent: `${count}× ${error}` }));
  }
}

function fail(error) {
  progressEl.hidden = true;
  stopButton.hidden = true;
  statusEl.classList.add("error");
  statusEl.textContent = t("error", error?.message ?? error);
  console.error(error);
}

setupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  let period;
  try {
    period = parsePeriod(setupForm.elements.from.value, setupForm.elements.to.value);
  } catch (error) {
    statusEl.classList.add("error");
    statusEl.textContent = t("error", error.message);
    return;
  }
  statusEl.classList.remove("error");
  setupForm.hidden = true;
  run(period).catch(fail);
});
