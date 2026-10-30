import { messagesForThread, parseBodies } from "./lib/messages.js";
import { reelsFromMessages, shortcodeToMediaId, videoFromSources } from "./lib/reels.js";
import { archiveEntries, failureSummary } from "./lib/exporter.js";
import { tarGzStream } from "./lib/tar.js";

const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String));
const statusEl = document.getElementById("status");
const progressEl = document.getElementById("progress");
const stopButton = document.getElementById("stop");
const saveButton = document.getElementById("save");
const failuresEl = document.getElementById("failures");
document.getElementById("title").textContent = t("exportTitle");
document.getElementById("keep-open").textContent = t("keepOpen");
stopButton.textContent = t("stopNow");
saveButton.textContent = t("saveAgain");

const params = new URLSearchParams(location.search);
const tabId = Number(params.get("tab"));
const threadId = params.get("thread");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SCROLL_INTERVAL_MS = 1_500;
const IDLE_ROUNDS_TO_FINISH = 6; // ~9 s without new messages = start of the chat
const RESOLVE_DELAY_MS = 800;
// Instagram's post query (PolarisPostRootQuery). Meta rotates these ids; when
// it stops working the HTML fallback below still applies.
const POST_QUERY_DOC_ID = "27852811784380813";

async function inTab(func, ...args) {
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func, args });
  return result;
}

// --- Functions below run inside the Instagram tab; they must be self-contained.

function drainAndScroll() {
  const bodies = window.__reelsterBodies ? window.__reelsterBodies.splice(0) : [];
  if (!window.__reelsterReadSsr) {
    // The newest messages are rendered into the HTML instead of fetched.
    window.__reelsterReadSsr = true;
    for (const script of document.querySelectorAll('script[type="application/json"]')) {
      if (script.textContent.includes("slide_messages")) bodies.push(script.textContent);
    }
  }
  // The message list is the right-most large scrollable element (the inbox is on the left).
  let list = null;
  for (const el of document.querySelectorAll("div")) {
    const overflow = getComputedStyle(el).overflowY;
    if ((overflow !== "auto" && overflow !== "scroll") || el.clientHeight < 200 || el.scrollHeight <= el.clientHeight) continue;
    if (!list || el.getBoundingClientRect().left > list.getBoundingClientRect().left) list = el;
  }
  if (list) {
    // Nudge down, then jump to the oldest message. A negative top also covers
    // column-reverse lists; regular lists clamp it to 0.
    list.scrollBy(0, 400);
    list.scrollTo(0, -list.scrollHeight);
  }
  return { bodies, hasHook: Array.isArray(window.__reelsterBodies), foundList: Boolean(list) };
}

// Asks Instagram for a reel's media in three independent ways and returns
// every raw answer; the extension side picks the video (videoFromSources).
async function fetchVideoSources(shortcode, mediaId, docId) {
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

// Downloads a video with the Instagram page's own origin and returns it as a
// data: URL. Fallback for when the CDN refuses the extension's request.
async function fetchVideoInTab(url) {
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

async function readWholeThread(viewer) {
  const messages = new Map();
  let stopped = false;
  stopButton.hidden = false;
  stopButton.onclick = () => (stopped = true);
  for (let idle = 0; idle < IDLE_ROUNDS_TO_FINISH && !stopped; ) {
    await sleep(SCROLL_INTERVAL_MS);
    const { bodies, hasHook } = await inTab(drainAndScroll);
    if (!hasHook) throw new Error(t("noMessages"));
    const before = messages.size;
    for (const body of bodies) {
      for (const doc of parseBodies(body)) {
        for (const node of messagesForThread(doc, threadId)) messages.set(String(node.message_id ?? node.id), node);
      }
    }
    idle = messages.size > before ? 0 : idle + 1;
    statusEl.textContent = t("stepScan", messages.size, reelsFromMessages(messages.values(), viewer).length);
  }
  stopButton.hidden = true;
  if (messages.size === 0) throw new Error(t("noMessages"));
  return [...messages.values()];
}

async function resolveVideo(reel) {
  await sleep(RESOLVE_DELAY_MS);
  const sources = await inTab(fetchVideoSources, reel.shortcode, shortcodeToMediaId(reel.shortcode), POST_QUERY_DOC_ID);
  try {
    return videoFromSources(sources, reel.shortcode);
  } catch (error) {
    throw new Error(`${t("videoNotFound")} [${error.message}]`);
  }
}

async function fetchVideo(url) {
  let direct;
  try {
    const response = await fetch(url);
    if (response.ok) return new Uint8Array(await response.arrayBuffer());
    direct = `HTTP ${response.status}`;
  } catch (error) {
    direct = String(error);
  }
  const { dataUrl, error } = await inTab(fetchVideoInTab, url);
  if (error) throw new Error(`video download failed [extension: ${direct}; tab: ${error}]`);
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

async function run() {
  if (!Number.isInteger(tabId) || !threadId) throw new Error("missing tab or thread");
  const viewer = await viewerId();
  statusEl.textContent = t("stepReload");
  await reloadInstagramTab();
  const reels = reelsFromMessages(await readWholeThread(viewer), viewer);
  if (reels.length === 0) {
    progressEl.hidden = true;
    statusEl.textContent = t("noReels");
    return;
  }

  let manifest;
  async function* entries() {
    for await (const entry of archiveEntries({ reels, resolveVideo, fetchVideo, threadId, onProgress })) {
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
  const { sent, received, failed } = manifest.totals;
  statusEl.textContent = t("done", sent, received, failed);
  for (const { error, count } of failureSummary(manifest.failed)) {
    failuresEl.append(Object.assign(document.createElement("li"), { textContent: `${count}× ${error}` }));
  }
}

run().catch((error) => {
  progressEl.hidden = true;
  stopButton.hidden = true;
  statusEl.classList.add("error");
  statusEl.textContent = t("error", error?.message ?? error);
  console.error(error);
});
