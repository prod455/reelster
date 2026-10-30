import { test } from "node:test";
import assert from "node:assert/strict";
import { extractReels, pickBestVideo, shortcodeToMediaId, reelFileName } from "../src/lib/reels.js";

const VIEWER = "111";
const OTHER = "222";

const clipItem = (overrides = {}) => ({
  item_id: "i1",
  item_type: "clip",
  user_id: OTHER,
  timestamp: "1700000000123456",
  clip: { clip: { pk: "999", code: "Cabc123", video_versions: [{ url: "https://cdn/a.mp4", width: 720, height: 1280 }] } },
  ...overrides,
});

test("shortcodeToMediaId decodes Instagram base64 shortcodes", () => {
  assert.equal(shortcodeToMediaId("B"), "1");
  assert.equal(shortcodeToMediaId("BA"), "64");
  assert.equal(shortcodeToMediaId("_"), "63");
});

test("shortcodeToMediaId ignores the private-post suffix beyond 11 chars", () => {
  assert.equal(shortcodeToMediaId("BAAAAAAAAAAxyz"), shortcodeToMediaId("BAAAAAAAAAA"));
});

test("shortcodeToMediaId rejects invalid characters", () => {
  assert.throws(() => shortcodeToMediaId("ab$"), /invalid shortcode/);
});

test("pickBestVideo picks the largest resolution", () => {
  const best = pickBestVideo([
    { url: "s", width: 360, height: 640 },
    { url: "l", width: 1080, height: 1920 },
    { url: "m", width: 720, height: 1280 },
  ]);
  assert.equal(best, "l");
});

test("pickBestVideo returns null when there are no versions", () => {
  assert.equal(pickBestVideo(undefined), null);
  assert.equal(pickBestVideo([]), null);
});

test("extractReels marks a clip from the other person as received", () => {
  const [r] = extractReels([clipItem()], VIEWER);
  assert.deepEqual(r, {
    itemId: "i1",
    mediaId: "999",
    shortcode: "Cabc123",
    direction: "received",
    senderId: OTHER,
    sentAt: 1700000000123,
    videoUrl: "https://cdn/a.mp4",
  });
});

test("extractReels marks a clip from the viewer as sent", () => {
  const [r] = extractReels([clipItem({ user_id: VIEWER })], VIEWER);
  assert.equal(r.direction, "sent");
});

test("extractReels accepts media_share items only when they are clips with video", () => {
  const share = (product_type) => ({
    item_id: "m", item_type: "media_share", user_id: OTHER, timestamp: "1",
    media_share: { pk: "5", code: "Xyz", product_type, media_type: 2, video_versions: [{ url: "u", width: 1, height: 1 }] },
  });
  assert.equal(extractReels([share("clips")], VIEWER).length, 1);
  assert.equal(extractReels([share("feed")], VIEWER).length, 0);
});

test("extractReels reads xma_clip shares from the reel URL without an inline video", () => {
  const item = {
    item_id: "x", item_type: "xma_clip", user_id: VIEWER, timestamp: "2000000",
    xma_clip: [{ target_url: "https://www.instagram.com/reel/BA/?igsh=abc" }],
  };
  const [r] = extractReels([item], VIEWER);
  assert.equal(r.shortcode, "BA");
  assert.equal(r.mediaId, "64");
  assert.equal(r.videoUrl, null);
  assert.equal(r.direction, "sent");
});

test("extractReels ignores text, photos and other item types", () => {
  const items = [
    { item_id: "t", item_type: "text", user_id: OTHER, timestamp: "1", text: "oi" },
    { item_id: "p", item_type: "media", user_id: OTHER, timestamp: "1", media: { media_type: 1 } },
  ];
  assert.deepEqual(extractReels(items, VIEWER), []);
});

test("extractReels skips a clip with no media id or shortcode", () => {
  assert.deepEqual(extractReels([clipItem({ clip: { clip: {} } })], VIEWER), []);
});

test("reelFileName groups by direction and is sortable by date", () => {
  const name = reelFileName({ direction: "received", sentAt: Date.UTC(2026, 9, 30, 14, 5, 9), shortcode: "Cabc123", itemId: "i1" });
  assert.equal(name, "recebidos/2026-10-30_14-05-09_Cabc123.mp4");
});

test("reelFileName sanitizes shortcodes and falls back to the item id", () => {
  const name = reelFileName({ direction: "sent", sentAt: 0, shortcode: null, itemId: "a/b" });
  assert.equal(name, "enviados/1970-01-01_00-00-00_a_b.mp4");
});
