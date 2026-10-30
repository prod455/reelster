import { test } from "node:test";
import assert from "node:assert/strict";
import { collectReels, archiveEntries } from "../src/lib/exporter.js";

const noSleep = async () => {};
const VIEWER = 1;

const clip = (id, user, code, url) => ({
  item_id: id, item_type: "clip", user_id: user, timestamp: "1700000000000000",
  clip: { clip: { pk: `pk-${code}`, code, video_versions: url ? [{ url, width: 1, height: 1 }] : [] } },
});

function fakeApi(items, mediaInfo = {}) {
  return async (path) => {
    if (path.startsWith("/api/v1/media/")) {
      const id = path.split("/")[4];
      if (!(id in mediaInfo)) throw Object.assign(new Error("media gone"), { status: 404 });
      return { items: [{ video_versions: [{ url: mediaInfo[id], width: 1, height: 1 }] }] };
    }
    return { thread: { viewer_id: VIEWER, items, has_older: false } };
  };
}

async function drain(iterable) {
  const out = [];
  for await (const e of iterable) out.push(e);
  return out;
}

test("collectReels deduplicates a reel shared twice in the same direction, keeping the oldest share", async () => {
  const api = fakeApi([clip("a", 2, "X", "u1"), clip("b", 2, "X", "u1"), clip("c", VIEWER, "X", "u1")]);
  const reels = await collectReels({ api, threadId: "t", sleep: noSleep, onProgress() {} });
  assert.deepEqual(reels.map((r) => [r.itemId, r.direction]), [["b", "received"], ["c", "sent"]]);
});

test("archiveEntries yields one file per reel plus a manifest", async () => {
  const api = fakeApi([]);
  const reels = [
    { itemId: "a", mediaId: "1", shortcode: "AAA", direction: "received", senderId: "2", sentAt: 0, videoUrl: "u1" },
    { itemId: "b", mediaId: "2", shortcode: "BBB", direction: "sent", senderId: "1", sentAt: 0, videoUrl: "u2" },
  ];
  const fetchVideo = async (url) => new TextEncoder().encode(`video:${url}`);
  const entries = await drain(archiveEntries({ api, fetchVideo, reels, threadId: "t", onProgress() {} }));
  assert.deepEqual(entries.map((e) => e.name), [
    "recebidos/1970-01-01_00-00-00_AAA.mp4",
    "enviados/1970-01-01_00-00-00_BBB.mp4",
    "manifest.json",
  ]);
  assert.equal(new TextDecoder().decode(entries[0].data), "video:u1");
  const manifest = JSON.parse(new TextDecoder().decode(entries[2].data));
  assert.deepEqual(manifest.totals, { sent: 1, received: 1, failed: 0 });
  assert.equal(manifest.reels[0].url, "https://www.instagram.com/reel/AAA/");
});

test("archiveEntries resolves the video through media info when it is not inline", async () => {
  const api = fakeApi([], { 64: "resolved-url" });
  const reels = [{ itemId: "x", mediaId: "64", shortcode: "BA", direction: "sent", senderId: "1", sentAt: 0, videoUrl: null }];
  const fetched = [];
  const fetchVideo = async (url) => { fetched.push(url); return new Uint8Array(1); };
  await drain(archiveEntries({ api, fetchVideo, reels, threadId: "t", onProgress() {} }));
  assert.deepEqual(fetched, ["resolved-url"]);
});

test("archiveEntries records failures in the manifest and keeps going", async () => {
  const api = fakeApi([]);
  const reels = [
    { itemId: "gone", mediaId: "404", shortcode: "GONE", direction: "received", senderId: "2", sentAt: 0, videoUrl: null },
    { itemId: "ok", mediaId: "1", shortcode: "OK", direction: "received", senderId: "2", sentAt: 0, videoUrl: "u" },
  ];
  const fetchVideo = async () => new Uint8Array(1);
  const entries = await drain(archiveEntries({ api, fetchVideo, reels, threadId: "t", onProgress() {} }));
  assert.equal(entries.length, 2);
  const manifest = JSON.parse(new TextDecoder().decode(entries.at(-1).data));
  assert.deepEqual(manifest.totals, { sent: 0, received: 1, failed: 1 });
  assert.equal(manifest.failed[0].shortcode, "GONE");
  assert.match(manifest.failed[0].error, /media gone/);
});
