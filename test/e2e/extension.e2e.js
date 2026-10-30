// End-to-end test: loads the unpacked extension in Chromium, fakes
// instagram.com and its CDN with request routing, runs an export and checks
// the resulting .tar.gz. Run with `npm run test:e2e`.
//
// The fake DM page behaves like Instagram's: the newest messages come
// server-rendered in a JSON script tag, older ones are fetched from GraphQL
// when the message list is scrolled to the top.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const EXTENSION = resolve("src");
// Chromium derives unpacked extension ids from the absolute path.
const EXTENSION_ID = [...createHash("sha256").update(EXTENSION).digest("hex").slice(0, 32)]
  .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
  .join("");

const CDN = "https://scontent.cdninstagram.com/v";
const VIEWER = "2001";
const FRIEND = "2002";

const message = (id, igid, ts, content) => ({
  message_id: id, thread_fbid: "fb-555", timestamp_ms: String(ts), content,
  sender: { id: `fb${igid}`, igid, user_dict: { id: igid } },
});
const xma = (url) => ({ __typename: "SlideMessageXMA", target_url: url });
const page = (messages) => ({
  data: { fetch__SlideThread: { as_ig_direct_thread: { id: "555", slide_messages: { edges: messages.map((node) => ({ node })) } } } },
});

const newest = page([
  message("m5", FRIEND, Date.UTC(2023, 10, 14, 22, 13, 20), { __typename: "SlideMessageText", text_body: "oi" }),
  message("m4", FRIEND, Date.UTC(2023, 10, 14, 22, 13, 20), {
    __typename: "SlideMessageClip",
    clip: { code: "Cabc", product_type: "clips", video_versions: [{ url: `${CDN}/inline.mp4`, width: 720, height: 1280 }] },
  }),
]);
const older = page([
  message("m3", VIEWER, Date.UTC(2023, 6, 22, 4, 26, 40), xma("https://www.instagram.com/reel/BA/")),
  message("m2", FRIEND, Date.UTC(2023, 6, 22, 4, 26, 41), xma("https://www.instagram.com/reel/HT/?igsh=x")),
  message("m1", FRIEND, Date.UTC(2023, 6, 22, 4, 26, 42), xma("https://www.instagram.com/reel/GONE/")),
  message("m0", FRIEND, Date.UTC(2023, 6, 22, 4, 26, 43), xma("https://www.instagram.com/p/FEEDPOST/")),
  message("m-1", VIEWER, Date.UTC(2023, 6, 22, 4, 26, 44), xma("https://www.instagram.com/reel/IN/")),
]);
// Another chat preloaded by the inbox: must not be exported.
const otherChat = { data: { inbox: { id: "777", slide_messages: { edges: [{ node: message("x1", FRIEND, 1, xma("https://www.instagram.com/reel/NOPE/")) }] } } } };

const dmPage = `<!doctype html>
<script type="application/json">${JSON.stringify(newest)}</script>
<script type="application/json">${JSON.stringify(otherChat)}</script>
<div style="position:fixed;left:0;width:300px;height:600px;overflow-y:auto"><div style="height:2000px">inbox</div></div>
<div id="list" style="position:fixed;left:400px;width:400px;height:600px;overflow-y:auto"><div style="height:3000px">chat</div></div>
<script>
  const list = document.getElementById("list");
  list.scrollTop = list.scrollHeight;
  let loaded = false;
  list.addEventListener("scroll", () => {
    if (list.scrollTop > 0 || loaded) return;
    loaded = true;
    fetch("/api/graphql", { method: "POST", body: "fb_api_req_friendly_name=IGDMessageListOffMsysQuery" });
  });
</script>`;

const reelHtml = (code, url) => `<!doctype html><script type="application/json">${JSON.stringify({
  require: [[{ __bbox: { result: { data: { items: [{ code, video_versions: [{ url, width: 1, height: 1 }] }] } } } }]],
})}</script>`;

test("exports sent and received reels of a DM thread into a .tar.gz", { timeout: 90_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "reelster-e2e-"));
  const context = await chromium.launchPersistentContext(join(dir, "profile"), {
    channel: "chromium",
    headless: true,
    acceptDownloads: true,
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });
  try {
    await context.route("https://www.instagram.com/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/direct/t/555/") {
        return route.fulfill({
          contentType: "text/html",
          body: dmPage,
          headers: { "set-cookie": `ds_user_id=${VIEWER}; Path=/; Secure` },
        });
      }
      if (url.pathname === "/api/graphql") return route.fulfill({ body: `for (;;);${JSON.stringify(older)}` });
      if (url.pathname === "/graphql/query") {
        const { shortcode } = JSON.parse(new URLSearchParams(request.postData()).get("variables"));
        const items = shortcode === "BA" ? [{ code: "BA", video_versions: [{ url: `${CDN}/ba.mp4`, width: 1, height: 1 }] }] : [];
        return route.fulfill({ json: { data: { xdt_api__v1__media__shortcode__web_info: { items } } } });
      }
      if (url.pathname === "/api/v1/media/525/info/") { // shortcode IN
        return route.fulfill({ json: { items: [{ code: "IN", video_versions: [{ url: `${CDN}/tab-only.mp4`, width: 1, height: 1 }] }] } });
      }
      if (url.pathname === "/reel/HT/") return route.fulfill({ contentType: "text/html", body: reelHtml("HT", `${CDN}/ht.mp4`) });
      return route.fulfill({ status: 404 });
    });
    await context.route(`${CDN}/**`, (route) => {
      const { pathname } = new URL(route.request().url());
      const origin = route.request().headers().origin ?? "";
      // This file is only served to the Instagram page, like a CDN that refuses foreign origins.
      if (pathname === "/v/tab-only.mp4" && !origin.startsWith("https://www.instagram.com")) return route.fulfill({ status: 403 });
      return route.fulfill({ body: `video ${pathname}`, headers: { "access-control-allow-origin": "https://www.instagram.com" } });
    });

    const instagram = await context.newPage();
    await instagram.goto("https://www.instagram.com/direct/t/555/");

    const exporter = await context.newPage();
    await exporter.goto(`chrome-extension://${EXTENSION_ID}/popup.html`);
    const tabId = await exporter.evaluate(async () => (await chrome.tabs.query({ url: "https://www.instagram.com/direct/*" }))[0].id);

    const downloadPromise = exporter.waitForEvent("download", { timeout: 60_000 });
    await exporter.goto(`chrome-extension://${EXTENSION_ID}/export.html?tab=${tabId}&thread=555`);
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /^reelster-555-\d{4}-\d{2}-\d{2}\.tar\.gz$/);

    const archive = join(dir, "out.tar.gz");
    await download.saveAs(archive);
    const out = join(dir, "out");
    mkdirSync(out);
    execFileSync("tar", ["-xzf", archive, "-C", out]);
    const files = execFileSync("tar", ["-tzf", archive]).toString().trim().split("\n").sort();
    assert.deepEqual(files, [
      "enviados/2023-07-22_04-26-40_BA.mp4",
      "enviados/2023-07-22_04-26-44_IN.mp4",
      "manifest.json",
      "recebidos/2023-07-22_04-26-41_HT.mp4",
      "recebidos/2023-11-14_22-13-20_Cabc.mp4",
    ]);
    assert.equal(readFileSync(join(out, "recebidos/2023-11-14_22-13-20_Cabc.mp4"), "utf8"), "video /v/inline.mp4");
    assert.equal(readFileSync(join(out, "enviados/2023-07-22_04-26-40_BA.mp4"), "utf8"), "video /v/ba.mp4");
    assert.equal(readFileSync(join(out, "recebidos/2023-07-22_04-26-41_HT.mp4"), "utf8"), "video /v/ht.mp4");
    const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    assert.equal(readFileSync(join(out, "enviados/2023-07-22_04-26-44_IN.mp4"), "utf8"), "video /v/tab-only.mp4");
    assert.deepEqual(manifest.totals, { sent: 2, received: 2, failed: 1 });
    assert.equal(manifest.failed[0].shortcode, "GONE");
    assert.match(manifest.failed[0].error, /graphql: no video in response; info: HTTP 404; html: HTTP 404/);
    assert.match(await exporter.textContent("#failures"), /^1× .*graphql: no video in response/);
  } finally {
    await context.close();
  }
});
