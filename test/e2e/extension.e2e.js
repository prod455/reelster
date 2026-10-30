// End-to-end test: loads the unpacked extension in Chromium, fakes
// instagram.com and its CDN with request routing, runs an export and checks
// the resulting .tar.gz. Run with `npm run test:e2e`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const EXTENSION = resolve("src");
// Chromium derives unpacked extension ids from the absolute path.
const EXTENSION_ID = [...createHash("sha256").update(EXTENSION).digest("hex").slice(0, 32)]
  .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
  .join("");

const CDN = "https://scontent.cdninstagram.com/v";
const pages = {
  "": {
    viewer_id: 1, has_older: true, oldest_cursor: "c1",
    items: [
      { item_id: "t", item_type: "text", user_id: 2, timestamp: "1700000000000000", text: "oi" },
      { item_id: "r1", item_type: "clip", user_id: 2, timestamp: "1700000000000000",
        clip: { clip: { pk: "9", code: "Cabc", video_versions: [{ url: `${CDN}/r1.mp4`, width: 720, height: 1280 }] } } },
    ],
  },
  c1: {
    viewer_id: 1, has_older: false,
    items: [
      { item_id: "s1", item_type: "xma_clip", user_id: 1, timestamp: "1690000000000000",
        xma_clip: [{ target_url: "https://www.instagram.com/reel/BA/" }] },
      { item_id: "gone", item_type: "xma_clip", user_id: 2, timestamp: "1690000000000000",
        xma_clip: [{ target_url: "https://www.instagram.com/reel/BB/" }] },
    ],
  },
};

test("exports sent and received reels of a DM thread into a .tar.gz", { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "reelster-e2e-"));
  const context = await chromium.launchPersistentContext(join(dir, "profile"), {
    channel: "chromium",
    headless: true,
    acceptDownloads: true,
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });
  try {
    let csrfHeader;
    await context.route("https://www.instagram.com/**", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/direct/t/555/") {
        return route.fulfill({ contentType: "text/html", body: "<p>dm</p>", headers: { "set-cookie": "csrftoken=tok123; Path=/" } });
      }
      csrfHeader = route.request().headers()["x-csrftoken"];
      if (url.pathname.startsWith("/api/v1/direct_v2/threads/555/")) {
        return route.fulfill({ json: { thread: pages[url.searchParams.get("cursor") ?? ""] } });
      }
      if (url.pathname === "/api/v1/media/64/info/") {
        return route.fulfill({ json: { items: [{ video_versions: [{ url: `${CDN}/s1.mp4`, width: 1, height: 1 }] }] } });
      }
      return route.fulfill({ status: 404 });
    });
    await context.route(`${CDN}/**`, (route) => route.fulfill({ body: `video ${new URL(route.request().url()).pathname}` }));

    const instagram = await context.newPage();
    await instagram.goto("https://www.instagram.com/direct/t/555/");

    const exporter = await context.newPage();
    await exporter.goto(`chrome-extension://${EXTENSION_ID}/popup.html`);
    const tabId = await exporter.evaluate(async () => (await chrome.tabs.query({ url: "https://www.instagram.com/direct/*" }))[0].id);

    const downloadPromise = exporter.waitForEvent("download");
    await exporter.goto(`chrome-extension://${EXTENSION_ID}/export.html?tab=${tabId}&thread=555`);
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /^reelster-555-\d{4}-\d{2}-\d{2}\.tar\.gz$/);

    const archive = join(dir, "out.tar.gz");
    await download.saveAs(archive);
    const out = join(dir, "out");
    execFileSync("mkdir", [out]);
    execFileSync("tar", ["-xzf", archive, "-C", out]);

    assert.equal(readFileSync(join(out, "recebidos/2023-11-14_22-13-20_Cabc.mp4"), "utf8"), "video /v/r1.mp4");
    assert.equal(readFileSync(join(out, "enviados/2023-07-22_04-26-40_BA.mp4"), "utf8"), "video /v/s1.mp4");
    const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    assert.deepEqual(manifest.totals, { sent: 1, received: 1, failed: 1 });
    assert.equal(manifest.failed[0].shortcode, "BB");
    assert.equal(csrfHeader, "tok123");
  } finally {
    await context.close();
  }
});
