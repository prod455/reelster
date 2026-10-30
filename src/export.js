import { resolveThreadId } from "./lib/thread.js";
import { collectReels, archiveEntries } from "./lib/exporter.js";
import { tarGzStream } from "./lib/tar.js";

const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String));
const statusEl = document.getElementById("status");
const progressEl = document.getElementById("progress");
const saveButton = document.getElementById("save");
document.getElementById("title").textContent = t("exportTitle");
document.getElementById("keep-open").textContent = t("keepOpen");
saveButton.textContent = t("saveAgain");

const params = new URLSearchParams(location.search);
const tabId = Number(params.get("tab"));
const urlThreadId = params.get("thread");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs inside the Instagram tab so the request carries the user's session.
// Must be self-contained: it is serialized by chrome.scripting.
async function instagramGet(path) {
  if (!path.startsWith("/api/v1/")) return { status: 0, error: "refused path" };
  const csrf = /(?:^|;\s*)csrftoken=([^;]+)/.exec(document.cookie)?.[1] ?? "";
  try {
    const response = await fetch(path, {
      credentials: "include",
      headers: { "X-IG-App-ID": "936619743392459", "X-CSRFToken": csrf, "X-Requested-With": "XMLHttpRequest" },
    });
    if (!response.ok) return { status: response.status, error: `HTTP ${response.status} on ${path}` };
    return { status: response.status, json: await response.json() };
  } catch (error) {
    return { status: 0, error: String(error) };
  }
}

const RETRY_DELAYS_MS = [5_000, 15_000, 45_000];

async function api(path) {
  for (let attempt = 0; ; attempt++) {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: instagramGet, args: [path] });
    if (!result.error) return result.json;
    if (result.status === 429 && attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]);
      continue;
    }
    throw Object.assign(new Error(result.error), { status: result.status });
  }
}

async function fetchVideo(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} downloading video`);
  return new Uint8Array(await response.arrayBuffer());
}

function onProgress(event) {
  if (event.phase === "scan") {
    progressEl.removeAttribute("value");
    statusEl.textContent = t("stepScan", event.messages, event.reels);
  } else {
    progressEl.max = event.total;
    progressEl.value = event.done;
    statusEl.textContent = t("stepDownload", event.done, event.total);
  }
}

function save(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  link.click();
  // The blob stays referenced by the "save again" button; revoke on page exit.
  addEventListener("pagehide", () => URL.revokeObjectURL(url), { once: true });
}

async function run() {
  if (!Number.isInteger(tabId) || !urlThreadId) throw new Error("missing tab or thread");
  statusEl.textContent = t("stepResolve");
  const threadId = await resolveThreadId(api, urlThreadId, sleep);
  const reels = await collectReels({ api, threadId, sleep, onProgress });
  if (reels.length === 0) {
    progressEl.hidden = true;
    statusEl.textContent = t("noReels");
    return;
  }

  let manifest;
  async function* entries() {
    for await (const entry of archiveEntries({ api, fetchVideo, reels, threadId, onProgress })) {
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
}

run().catch((error) => {
  progressEl.hidden = true;
  statusEl.classList.add("error");
  statusEl.textContent = t("error", error?.message ?? error);
  console.error(error);
});
