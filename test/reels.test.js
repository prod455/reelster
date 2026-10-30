import { test } from "node:test";
import assert from "node:assert/strict";
import { extractReel, reelsFromMessages, pickBestVideo, findVideoForShortcode, reelFileName } from "../src/lib/reels.js";

const VIEWER = "2001";
const OTHER = "2002";

const message = (id, igid, content, extra = {}) => ({
  message_id: id,
  timestamp_ms: "1700000000123",
  sender: { id: "fb" + igid, igid, user_dict: { id: igid } },
  content,
  ...extra,
});

const xmaReel = (code) => ({ __typename: "SlideMessageXMA", target_url: `https://www.instagram.com/reel/${code}/?igsh=abc` });

test("pickBestVideo picks the largest resolution", () => {
  assert.equal(pickBestVideo([{ url: "s", width: 360, height: 640 }, { url: "l", width: 1080, height: 1920 }]), "l");
});

test("pickBestVideo returns null when there are no versions", () => {
  assert.equal(pickBestVideo(undefined), null);
  assert.equal(pickBestVideo([]), null);
});

test("extractReel reads a shared reel link and marks it received", () => {
  assert.deepEqual(extractReel(message("m1", OTHER, xmaReel("DAbc_-1")), VIEWER), {
    messageId: "m1",
    shortcode: "DAbc_-1",
    direction: "received",
    senderId: OTHER,
    sentAt: 1700000000123,
    videoUrl: null,
  });
});

test("extractReel marks a reel from the viewer as sent", () => {
  assert.equal(extractReel(message("m1", VIEWER, xmaReel("A")), VIEWER).direction, "sent");
});

test("extractReel falls back to user_dict.id for the sender", () => {
  const m = message("m1", OTHER, xmaReel("A"));
  delete m.sender.igid;
  assert.equal(extractReel(m, VIEWER).senderId, OTHER);
});

test("extractReel uses inline clip media with its best video", () => {
  const content = { __typename: "SlideMessageClip", clip: { code: "Cxyz", product_type: "clips", video_versions: [{ url: "v", width: 1, height: 1 }] } };
  const reel = extractReel(message("m1", OTHER, content), VIEWER);
  assert.equal(reel.shortcode, "Cxyz");
  assert.equal(reel.videoUrl, "v");
});

test("extractReel finds a reel link pasted in a text message", () => {
  const m = message("m1", OTHER, { __typename: "SlideMessageText" }, { text_body: "olha https://instagram.com/reels/QQ9/ kkk" });
  assert.equal(extractReel(m, VIEWER).shortcode, "QQ9");
});

test("extractReel ignores texts, photos, videos and feed posts", () => {
  const cases = [
    { __typename: "SlideMessageText", text_body: "oi" },
    { __typename: "SlideMessageImage", image_versions2: { candidates: [{ url: "https://scontent.cdninstagram.com/a.jpg" }] } },
    { __typename: "SlideMessageVideo", video_url: "https://scontent.cdninstagram.com/a.mp4" },
    { __typename: "SlideMessageXMA", target_url: "https://www.instagram.com/p/POST1/" },
  ];
  for (const content of cases) assert.equal(extractReel(message("m", OTHER, content), VIEWER), null);
});

test("extractReel fails loudly when the sender id is missing", () => {
  const m = message("m1", OTHER, xmaReel("A"));
  m.sender = {};
  assert.throws(() => extractReel(m, VIEWER), /sender/);
});

test("reelsFromMessages keeps the oldest share per direction and sorts by date", () => {
  const msgs = [
    message("new", OTHER, xmaReel("X"), { timestamp_ms: "300" }),
    message("old", OTHER, xmaReel("X"), { timestamp_ms: "100" }),
    message("mine", VIEWER, xmaReel("X"), { timestamp_ms: "200" }),
    message("text", OTHER, { __typename: "SlideMessageText" }, { text_body: "oi" }),
  ];
  assert.deepEqual(reelsFromMessages(msgs, VIEWER).map((r) => [r.messageId, r.direction]), [["old", "received"], ["mine", "sent"]]);
});

test("findVideoForShortcode finds the media object with that code anywhere in a response", () => {
  const response = { data: { xdt_api__v1__media__shortcode__web_info: { items: [
    { code: "OTHER", video_versions: [{ url: "no", width: 9, height: 9 }] },
    { code: "ABC", video_versions: [{ url: "low", width: 1, height: 1 }, { url: "high", width: 2, height: 2 }] },
  ] } } };
  assert.equal(findVideoForShortcode(response, "ABC"), "high");
  assert.equal(findVideoForShortcode(response, "NONE"), null);
});

test("reelFileName groups by direction and is sortable by date", () => {
  const name = reelFileName({ direction: "received", sentAt: Date.UTC(2026, 9, 30, 14, 5, 9), shortcode: "Cabc123" });
  assert.equal(name, "recebidos/2026-10-30_14-05-09_Cabc123.mp4");
});
