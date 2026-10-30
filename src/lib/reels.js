// Pure functions that find Reels in Direct message nodes.

import { parseBodies } from "./messages.js";

const SHORTCODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Converts a post shortcode (as in /reel/<code>/) to its numeric media id. */
export function shortcodeToMediaId(shortcode) {
  // Private posts append extra characters after the 11-char id.
  let id = 0n;
  for (const char of shortcode.slice(0, 11)) {
    const digit = SHORTCODE_ALPHABET.indexOf(char);
    if (digit < 0) throw new Error(`invalid shortcode: ${shortcode}`);
    id = id * 64n + BigInt(digit);
  }
  return id.toString();
}

// /reel/<code>, /reels/<code> on instagram.com. Feed posts (/p/) are not Reels.
const REEL_URL = /instagram\.com\/reels?\/([A-Za-z0-9_-]+)/;

/** Returns the URL of the highest-resolution video version, or null. */
export function pickBestVideo(versions) {
  if (!versions?.length) return null;
  const area = (v) => (v.width ?? 0) * (v.height ?? 0);
  return versions.reduce((best, v) => (area(v) > area(best) ? v : best)).url;
}

function* walk(value) {
  const stack = [value];
  while (stack.length) {
    const v = stack.pop();
    if (v && typeof v === "object") {
      yield v;
      stack.push(...Object.values(v));
    }
  }
}

/** The Reel referenced by a message: `{ shortcode, videoUrl }` or null. */
function reelIn(node) {
  for (const obj of walk(node.content)) {
    if (typeof obj.code === "string" && obj.product_type === "clips") {
      return { shortcode: obj.code, videoUrl: pickBestVideo(obj.video_versions) };
    }
  }
  for (const obj of walk({ content: node.content, text: node.text_body })) {
    for (const value of Object.values(obj)) {
      const match = typeof value === "string" && REEL_URL.exec(value);
      if (match) return { shortcode: match[1], videoUrl: null };
    }
  }
  return null;
}

/**
 * Reel record for a message node, or null if it holds no Reel. `viewerId`
 * is the logged-in user's Instagram id (the `ds_user_id` cookie).
 */
export function extractReel(node, viewerId) {
  const reel = reelIn(node);
  if (!reel) return null;
  const senderId = node.sender?.igid ?? node.sender?.user_dict?.id;
  if (senderId == null) throw new Error(`message ${node.message_id} has no sender id; Instagram's format changed`);
  return {
    messageId: String(node.message_id ?? node.id),
    shortcode: reel.shortcode,
    direction: String(senderId) === String(viewerId) ? "sent" : "received",
    senderId: String(senderId),
    sentAt: Number(node.timestamp_ms),
    videoUrl: reel.videoUrl,
  };
}

/** Reels of a chat, oldest first, keeping only the oldest share per direction. */
export function reelsFromMessages(nodes, viewerId) {
  const byKey = new Map();
  for (const node of nodes) {
    const reel = extractReel(node, viewerId);
    if (!reel) continue;
    const key = `${reel.direction}:${reel.shortcode}`;
    if (!byKey.has(key) || reel.sentAt < byKey.get(key).sentAt) byKey.set(key, reel);
  }
  return [...byKey.values()].sort((a, b) => a.sentAt - b.sentAt);
}

/** Best video URL of the media with `shortcode` anywhere in a parsed response, or null. */
export function findVideoForShortcode(root, shortcode) {
  for (const obj of walk(root)) {
    if (obj.code === shortcode && obj.video_versions?.length) return pickBestVideo(obj.video_versions);
  }
  return null;
}

/**
 * Picks the video from the responses of several lookups
 * (`{ name, status, text, error? }`), in order. Throws an error naming why
 * each lookup failed.
 */
export function videoFromSources(sources, shortcode) {
  const reasons = [];
  for (const { name, status, text, error } of sources) {
    if (error) {
      reasons.push(`${name}: ${error}`);
      continue;
    }
    if (status < 200 || status >= 300) {
      reasons.push(`${name}: HTTP ${status}`);
      continue;
    }
    for (const doc of parseBodies(text)) {
      const url = findVideoForShortcode(doc, shortcode);
      if (url) return url;
    }
    reasons.push(`${name}: no video in response`);
  }
  throw new Error(reasons.join("; "));
}

const FOLDER = { sent: "enviados", received: "recebidos" };

/** Archive path for a reel: <folder>/<UTC date>_<time>_<shortcode>.mp4 */
export function reelFileName({ direction, sentAt, shortcode }) {
  const stamp = new Date(sentAt).toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-");
  return `${FOLDER[direction]}/${stamp}_${shortcode}.mp4`;
}
