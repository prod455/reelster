// Pure functions that find Reels in Direct message nodes.

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

const FOLDER = { sent: "enviados", received: "recebidos" };

/** Archive path for a reel: <folder>/<UTC date>_<time>_<shortcode>.mp4 */
export function reelFileName({ direction, sentAt, shortcode }) {
  const stamp = new Date(sentAt).toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-");
  return `${FOLDER[direction]}/${stamp}_${shortcode}.mp4`;
}
