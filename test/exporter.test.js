import { test } from "node:test";
import assert from "node:assert/strict";
import { archiveEntries, failureSummary } from "../src/lib/exporter.js";

const share = (kind, shortcode, direction, media = null) => ({ kind, messageId: shortcode, shortcode, direction, senderId: "1", sentAt: 0, media });
const decode = (bytes) => new TextDecoder().decode(bytes);
const fetchMedia = async (url) => new TextEncoder().encode(`file:${url}`);

async function drain(iterable) {
  const out = [];
  for await (const e of iterable) out.push(e);
  return out;
}

test("archiveEntries yields every file of every share plus a manifest", async () => {
  const shares = [
    share("reel", "AAA", "received", [{ type: "video", url: "u1" }]),
    share("post", "PPP", "sent", [{ type: "image", url: "i1" }, { type: "image", url: "i2" }]),
  ];
  const resolveMedia = async () => assert.fail("inline media must not be resolved");
  const entries = await drain(archiveEntries({ shares, resolveMedia, fetchMedia, threadId: "t", onProgress() {} }));
  assert.deepEqual(entries.map((e) => e.name), [
    "recebidos/1970-01-01_00-00-00_AAA.mp4",
    "enviados/posts/1970-01-01_00-00-00_PPP_1.jpg",
    "enviados/posts/1970-01-01_00-00-00_PPP_2.jpg",
    "manifest.json",
  ]);
  assert.equal(decode(entries[2].data), "file:i2");
  const manifest = JSON.parse(decode(entries[3].data));
  assert.deepEqual(manifest.totals, {
    reels: { sent: 0, received: 1 },
    posts: { sent: 1, received: 0 },
    post_files: 2,
    failed: 0,
  });
  assert.equal(manifest.items[0].url, "https://www.instagram.com/reel/AAA/");
  assert.equal(manifest.items[1].url, "https://www.instagram.com/p/PPP/");
  assert.deepEqual(manifest.items[1].files, ["enviados/posts/1970-01-01_00-00-00_PPP_1.jpg", "enviados/posts/1970-01-01_00-00-00_PPP_2.jpg"]);
});

test("archiveEntries resolves media when the message does not carry it", async () => {
  const fetched = [];
  await drain(archiveEntries({
    shares: [share("reel", "BA", "sent")],
    resolveMedia: async (s) => [{ type: "video", url: `resolved-${s.shortcode}` }],
    fetchMedia: async (url) => { fetched.push(url); return new Uint8Array(1); },
    threadId: "t",
    onProgress() {},
  }));
  assert.deepEqual(fetched, ["resolved-BA"]);
});

test("archiveEntries keeps only the video for a reel even if a cover image comes along", async () => {
  const entries = await drain(archiveEntries({
    shares: [share("reel", "R", "sent")],
    resolveMedia: async () => [{ type: "image", url: "cover" }, { type: "video", url: "v" }],
    fetchMedia,
    threadId: "t",
    onProgress() {},
  }));
  assert.deepEqual(entries.map((e) => e.name), ["enviados/1970-01-01_00-00-00_R.mp4", "manifest.json"]);
});

test("archiveEntries writes nothing for a post with a file that fails, and records why", async () => {
  const entries = await drain(archiveEntries({
    shares: [share("post", "HALF", "received", [{ type: "image", url: "ok" }, { type: "image", url: "bad" }]), share("reel", "GONE", "received")],
    resolveMedia: async () => { throw new Error("media gone"); },
    fetchMedia: async (url) => { if (url === "bad") throw new Error("HTTP 403"); return new Uint8Array(1); },
    threadId: "t",
    onProgress() {},
  }));
  assert.deepEqual(entries.map((e) => e.name), ["manifest.json"]);
  const manifest = JSON.parse(decode(entries[0].data));
  assert.equal(manifest.totals.failed, 2);
  assert.deepEqual(manifest.failed.map((f) => [f.shortcode, f.error]), [["HALF", "HTTP 403"], ["GONE", "media gone"]]);
});

test("archiveEntries records the export period in the manifest", async () => {
  const entries = await drain(archiveEntries({
    shares: [], resolveMedia: async () => [], fetchMedia, threadId: "t",
    period: { from: Date.UTC(2026, 0, 1), to: null }, onProgress() {},
  }));
  assert.deepEqual(JSON.parse(decode(entries[0].data)).period, { from: "2026-01-01T00:00:00.000Z", to: null });
});

test("failureSummary groups identical errors, most frequent first", () => {
  assert.deepEqual(failureSummary([{ error: "a" }, { error: "b" }, { error: "b" }]), [
    { error: "b", count: 2 },
    { error: "a", count: 1 },
  ]);
});
