// Pure functions that find shared Reels and posts in Direct message nodes
// and work out which files to download for them.

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

const LINKS = [
  { kind: "reel", pattern: /instagram\.com\/reels?\/([A-Za-z0-9_-]+)/ },
  { kind: "post", pattern: /instagram\.com\/p\/([A-Za-z0-9_-]+)/ },
];

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

function largest(versions) {
  if (!versions?.length) return null;
  const area = (v) => (v.width ?? 0) * (v.height ?? 0);
  return versions.reduce((best, v) => (area(v) > area(best) ? v : best)).url;
}

/** Files of a media object: each carousel item, a video, or a photo, in the best resolution. */
export function mediaOf(media) {
  if (media.carousel_media?.length) return media.carousel_media.flatMap(mediaOf);
  const video = largest(media.video_versions);
  if (video) return [{ type: "video", url: video }];
  const photo = largest(media.image_versions2?.candidates);
  return photo ? [{ type: "image", url: photo }] : [];
}

const isMedia = (obj) =>
  typeof obj.code === "string" && (obj.product_type != null || obj.video_versions || obj.image_versions2 || obj.carousel_media);

/** `{ kind, shortcode, media }` shared by a message, or null. */
function shareIn(node) {
  for (const obj of walk(node.content)) {
    if (!isMedia(obj)) continue;
    const media = mediaOf(obj);
    return { kind: obj.product_type === "clips" ? "reel" : "post", shortcode: obj.code, media: media.length ? media : null };
  }
  const strings = [];
  for (const obj of walk({ content: node.content, text: node.text_body })) {
    for (const value of Object.values(obj)) if (typeof value === "string") strings.push(value);
  }
  for (const { kind, pattern } of LINKS) {
    for (const value of strings) {
      const match = pattern.exec(value);
      if (match) return { kind, shortcode: match[1], media: null };
    }
  }
  return null;
}

/**
 * Shared Reel or post of a message node, or null. `media` is null when the
 * message does not carry the files; resolve them by shortcode. `viewerId` is
 * the logged-in user's Instagram id (the `ds_user_id` cookie).
 */
export function extractShare(node, viewerId) {
  const share = shareIn(node);
  if (!share) return null;
  const senderId = node.sender?.igid ?? node.sender?.user_dict?.id;
  if (senderId == null) throw new Error(`message ${node.message_id} has no sender id; Instagram's format changed`);
  return {
    kind: share.kind,
    messageId: String(node.message_id ?? node.id),
    shortcode: share.shortcode,
    direction: String(senderId) === String(viewerId) ? "sent" : "received",
    senderId: String(senderId),
    sentAt: Number(node.timestamp_ms),
    media: share.media,
  };
}

/** Shares of a chat, oldest first, keeping only the oldest share per kind and direction. */
export function sharesFromMessages(nodes, viewerId) {
  const byKey = new Map();
  for (const node of nodes) {
    const share = extractShare(node, viewerId);
    if (!share) continue;
    const key = `${share.kind}:${share.direction}:${share.shortcode}`;
    if (!byKey.has(key) || share.sentAt < byKey.get(key).sentAt) byKey.set(key, share);
  }
  return [...byKey.values()].sort((a, b) => a.sentAt - b.sentAt);
}

/** The media object with `shortcode` anywhere in a parsed response, or null. */
export function findMedia(root, shortcode) {
  for (const obj of walk(root)) if (obj.code === shortcode && isMedia(obj)) return obj;
  return null;
}

/**
 * Picks the media from the answers of several lookups
 * (`{ name, status, text, error? }`), in order. Throws an error naming why
 * each lookup failed.
 */
export function mediaFromSources(sources, shortcode) {
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
      const media = findMedia(doc, shortcode);
      if (media && mediaOf(media).length) return mediaOf(media);
    }
    reasons.push(`${name}: no media in response`);
  }
  throw new Error(reasons.join("; "));
}

const FOLDER = { sent: "enviados", received: "recebidos" };
const EXTENSION = { video: "mp4", image: "jpg" };

/**
 * Archive paths for a share's files:
 * reels  <folder>/<UTC date>_<time>_<shortcode>.mp4
 * posts  <folder>/posts/<UTC date>_<time>_<shortcode>_<n>.<ext>
 */
export function shareFileNames({ kind, direction, sentAt, shortcode }, media) {
  const stamp = new Date(sentAt).toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-");
  if (kind === "reel") return [`${FOLDER[direction]}/${stamp}_${shortcode}.mp4`];
  return media.map((m, i) => `${FOLDER[direction]}/posts/${stamp}_${shortcode}_${i + 1}.${EXTENSION[m.type]}`);
}
