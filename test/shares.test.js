import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractShare, sharesFromMessages, mediaOf, findMedia, mediaFromSources, shareFileNames, shortcodeToMediaId,
} from "../src/lib/shares.js";

const VIEWER = "2001";
const OTHER = "2002";

const message = (id, igid, content, extra = {}) => ({
  message_id: id,
  timestamp_ms: "1700000000123",
  sender: { id: "fb" + igid, igid, user_dict: { id: igid } },
  content,
  ...extra,
});
const xma = (url) => ({ __typename: "SlideMessageXMA", target_url: url });
const image = (url, width) => ({ url, width, height: width });

test("shortcodeToMediaId decodes Instagram base64 shortcodes", () => {
  assert.equal(shortcodeToMediaId("B"), "1");
  assert.equal(shortcodeToMediaId("BA"), "64");
  assert.equal(shortcodeToMediaId("BAAAAAAAAAAxyz"), shortcodeToMediaId("BAAAAAAAAAA"));
});

test("extractShare reads a shared reel link and marks it received", () => {
  assert.deepEqual(extractShare(message("m1", OTHER, xma("https://www.instagram.com/reel/DAbc_-1/?igsh=abc")), VIEWER), {
    kind: "reel",
    messageId: "m1",
    shortcode: "DAbc_-1",
    direction: "received",
    senderId: OTHER,
    sentAt: 1700000000123,
    media: null,
  });
});

test("extractShare reads a shared post link as a post", () => {
  const share = extractShare(message("m1", VIEWER, xma("https://www.instagram.com/p/POST1/")), VIEWER);
  assert.equal(share.kind, "post");
  assert.equal(share.shortcode, "POST1");
  assert.equal(share.direction, "sent");
});

test("extractShare uses inline reel media", () => {
  const content = { clip: { code: "Cxyz", product_type: "clips", video_versions: [{ url: "v", width: 1, height: 1 }] } };
  const share = extractShare(message("m1", OTHER, content), VIEWER);
  assert.equal(share.kind, "reel");
  assert.deepEqual(share.media, [{ type: "video", url: "v" }]);
});

test("extractShare uses inline post media", () => {
  const content = { media: { code: "P1", product_type: "feed", image_versions2: { candidates: [image("small", 100), image("big", 1080)] } } };
  const share = extractShare(message("m1", OTHER, content), VIEWER);
  assert.equal(share.kind, "post");
  assert.deepEqual(share.media, [{ type: "image", url: "big" }]);
});

test("extractShare finds links pasted in a text message", () => {
  const m = message("m1", OTHER, { __typename: "SlideMessageText" }, { text_body: "olha https://instagram.com/reels/QQ9/ kkk" });
  assert.equal(extractShare(m, VIEWER).shortcode, "QQ9");
});

test("extractShare falls back to user_dict.id for the sender", () => {
  const m = message("m1", OTHER, xma("https://www.instagram.com/reel/A/"));
  delete m.sender.igid;
  assert.equal(extractShare(m, VIEWER).senderId, OTHER);
});

test("extractShare ignores texts and photos or videos uploaded directly", () => {
  const cases = [
    { __typename: "SlideMessageText", text_body: "oi" },
    { __typename: "SlideMessageImage", image_versions2: { candidates: [image("https://scontent.cdninstagram.com/a.jpg", 1)] } },
    { __typename: "SlideMessageVideo", video_url: "https://scontent.cdninstagram.com/a.mp4" },
  ];
  for (const content of cases) assert.equal(extractShare(message("m", OTHER, content), VIEWER), null);
});

test("extractShare fails loudly when the sender id is missing", () => {
  const m = message("m1", OTHER, xma("https://www.instagram.com/reel/A/"));
  m.sender = {};
  assert.throws(() => extractShare(m, VIEWER), /sender/);
});

test("sharesFromMessages keeps the oldest share per kind and direction, sorted by date", () => {
  const msgs = [
    message("new", OTHER, xma("https://www.instagram.com/reel/X/"), { timestamp_ms: "300" }),
    message("old", OTHER, xma("https://www.instagram.com/reel/X/"), { timestamp_ms: "100" }),
    message("mine", VIEWER, xma("https://www.instagram.com/reel/X/"), { timestamp_ms: "200" }),
    message("post", OTHER, xma("https://www.instagram.com/p/X/"), { timestamp_ms: "250" }),
  ];
  assert.deepEqual(sharesFromMessages(msgs, VIEWER).map((s) => s.messageId), ["old", "mine", "post"]);
});

test("mediaOf returns every photo and video of a carousel, best resolution each", () => {
  const media = {
    carousel_media: [
      { image_versions2: { candidates: [image("a-small", 100), image("a-big", 1080)] } },
      { video_versions: [{ url: "b-video", width: 720, height: 1280 }], image_versions2: { candidates: [image("b-cover", 720)] } },
    ],
  };
  assert.deepEqual(mediaOf(media), [{ type: "image", url: "a-big" }, { type: "video", url: "b-video" }]);
});

test("mediaOf prefers the video of a video post over its cover", () => {
  const media = { video_versions: [{ url: "v", width: 1, height: 1 }], image_versions2: { candidates: [image("cover", 1)] } };
  assert.deepEqual(mediaOf(media), [{ type: "video", url: "v" }]);
});

test("findMedia finds the media object with that code anywhere in a response", () => {
  const response = { data: { x: { items: [{ code: "OTHER", image_versions2: {} }, { code: "ABC", video_versions: [] }] } } };
  assert.equal(findMedia(response, "ABC").code, "ABC");
  assert.equal(findMedia(response, "NONE"), null);
});

test("mediaFromSources returns the media of the first source that has it", () => {
  const sources = [
    { name: "graphql", status: 200, text: '{"data":null}' },
    { name: "info", status: 200, text: '{"items":[{"code":"AB","image_versions2":{"candidates":[{"url":"i","width":1,"height":1}]}}]}' },
  ];
  assert.deepEqual(mediaFromSources(sources, "AB"), [{ type: "image", url: "i" }]);
});

test("mediaFromSources explains every failed attempt", () => {
  const sources = [
    { name: "graphql", status: 200, text: '{"errors":[{"message":"bad"}]}' },
    { name: "info", status: 404, text: "" },
    { name: "html", status: 0, text: "", error: "TypeError: Failed to fetch" },
  ];
  assert.throws(() => mediaFromSources(sources, "AB"), /^Error: graphql: no media in response; info: HTTP 404; html: TypeError: Failed to fetch$/);
});

test("shareFileNames keeps reels at the folder root and numbers post files", () => {
  const sentAt = Date.UTC(2026, 9, 30, 14, 5, 9);
  assert.deepEqual(shareFileNames({ kind: "reel", direction: "received", sentAt, shortcode: "R1" }, [{ type: "video" }]), [
    "recebidos/2026-10-30_14-05-09_R1.mp4",
  ]);
  assert.deepEqual(shareFileNames({ kind: "post", direction: "sent", sentAt, shortcode: "P1" }, [{ type: "image" }, { type: "video" }]), [
    "enviados/posts/2026-10-30_14-05-09_P1_1.jpg",
    "enviados/posts/2026-10-30_14-05-09_P1_2.mp4",
  ]);
});
