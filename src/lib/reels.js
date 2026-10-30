// Pure functions that turn Instagram Direct thread items into Reel records.

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

/** Returns the URL of the highest-resolution video version, or null. */
export function pickBestVideo(versions) {
  if (!versions?.length) return null;
  const area = (v) => (v.width ?? 0) * (v.height ?? 0);
  return versions.reduce((best, v) => (area(v) > area(best) ? v : best)).url;
}

function shortcodeFromUrl(url) {
  return /\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)/.exec(url ?? "")?.[1] ?? null;
}

/** Returns the reel's media object (or an equivalent stub) for a thread item, or null. */
function reelMedia(item) {
  switch (item.item_type) {
    case "clip":
      return item.clip?.clip ?? null;
    case "media_share": {
      const media = item.media_share;
      return media?.product_type === "clips" ? media : null;
    }
    case "xma_clip":
    case "xma_reel_share":
    case "xma_media_share": {
      const shortcode = shortcodeFromUrl(item[item.item_type]?.[0]?.target_url);
      return shortcode ? { code: shortcode } : null;
    }
    default:
      return null;
  }
}

/**
 * Extracts every Reel from a page of thread items. `videoUrl` is null when
 * the item does not carry the video inline; resolve it via `mediaId`.
 */
export function extractReels(items, viewerId) {
  const reels = [];
  for (const item of items) {
    const media = reelMedia(item);
    if (!media) continue;
    const shortcode = media.code ?? null;
    const mediaId = media.pk != null ? String(media.pk).split("_")[0] : shortcode ? shortcodeToMediaId(shortcode) : null;
    if (!mediaId) continue;
    reels.push({
      itemId: String(item.item_id),
      mediaId,
      shortcode,
      direction: String(item.user_id) === String(viewerId) ? "sent" : "received",
      senderId: String(item.user_id),
      sentAt: Number(BigInt(item.timestamp) / 1000n), // microseconds -> ms
      videoUrl: pickBestVideo(media.video_versions),
    });
  }
  return reels;
}

const FOLDER = { sent: "enviados", received: "recebidos" };

/** Archive path for a reel: <folder>/<UTC date>_<time>_<shortcode>.mp4 */
export function reelFileName({ direction, sentAt, shortcode, itemId }) {
  const stamp = new Date(sentAt).toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-");
  const id = (shortcode ?? itemId).replace(/[^A-Za-z0-9_-]/g, "_");
  return `${FOLDER[direction]}/${stamp}_${id}.mp4`;
}
