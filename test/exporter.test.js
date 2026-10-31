import { test } from "node:test";
import assert from "node:assert/strict";
import { archiveEntries } from "../src/lib/exporter.js";

const reel = (shortcode, direction, videoUrl = null) => ({ messageId: shortcode, shortcode, direction, senderId: "1", sentAt: 0, videoUrl });
const decode = (bytes) => new TextDecoder().decode(bytes);

async function drain(iterable) {
  const out = [];
  for await (const e of iterable) out.push(e);
  return out;
}

test("archiveEntries yields one file per reel plus a manifest", async () => {
  const reels = [reel("AAA", "received", "u1"), reel("BBB", "sent", "u2")];
  const fetchVideo = async (url) => new TextEncoder().encode(`video:${url}`);
  const resolveVideo = async () => assert.fail("inline URLs must not be resolved");
  const entries = await drain(archiveEntries({ reels, resolveVideo, fetchVideo, threadId: "t", onProgress() {} }));
  assert.deepEqual(entries.map((e) => e.name), [
    "recebidos/1970-01-01_00-00-00_AAA.mp4",
    "enviados/1970-01-01_00-00-00_BBB.mp4",
    "manifest.json",
  ]);
  assert.equal(decode(entries[0].data), "video:u1");
  const manifest = JSON.parse(decode(entries[2].data));
  assert.deepEqual(manifest.totals, { sent: 1, received: 1, failed: 0 });
  assert.equal(manifest.reels[0].url, "https://www.instagram.com/reel/AAA/");
});

test("archiveEntries resolves the video URL when the message does not carry it", async () => {
  const fetched = [];
  await drain(archiveEntries({
    reels: [reel("BA", "sent")],
    resolveVideo: async (r) => `resolved-${r.shortcode}`,
    fetchVideo: async (url) => { fetched.push(url); return new Uint8Array(1); },
    threadId: "t",
    onProgress() {},
  }));
  assert.deepEqual(fetched, ["resolved-BA"]);
});

test("archiveEntries records failures in the manifest and keeps going", async () => {
  const entries = await drain(archiveEntries({
    reels: [reel("GONE", "received"), reel("OK", "received", "u")],
    resolveVideo: async () => { throw new Error("media gone"); },
    fetchVideo: async () => new Uint8Array(1),
    threadId: "t",
    onProgress() {},
  }));
  assert.equal(entries.length, 2);
  const manifest = JSON.parse(decode(entries.at(-1).data));
  assert.deepEqual(manifest.totals, { sent: 0, received: 1, failed: 1 });
  assert.equal(manifest.failed[0].shortcode, "GONE");
  assert.match(manifest.failed[0].error, /media gone/);
});

test("failureSummary groups identical errors, most frequent first", async () => {
  const { failureSummary } = await import("../src/lib/exporter.js");
  assert.deepEqual(failureSummary([{ error: "a" }, { error: "b" }, { error: "b" }]), [
    { error: "b", count: 2 },
    { error: "a", count: 1 },
  ]);
});

test("archiveEntries records the export period in the manifest", async () => {
  const entries = await drain(archiveEntries({
    reels: [], resolveVideo: async () => "", fetchVideo: async () => new Uint8Array(), threadId: "t",
    period: { from: Date.UTC(2026, 0, 1), to: null }, onProgress() {},
  }));
  assert.deepEqual(JSON.parse(decode(entries[0].data)).period, { from: "2026-01-01T00:00:00.000Z", to: null });
});
