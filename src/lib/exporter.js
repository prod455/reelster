// Ties the Direct API, reel extraction and the archive together.

import { extractReels, pickBestVideo, reelFileName } from "./reels.js";
import { iterateThreadItems } from "./thread.js";

/** Reads the whole thread and returns its reels, oldest first, deduplicated per direction. */
export async function collectReels({ api, threadId, sleep, onProgress }) {
  const byKey = new Map();
  let messages = 0;
  for await (const { items, viewerId } of iterateThreadItems(api, threadId, sleep)) {
    messages += items.length;
    for (const reel of extractReels(items, viewerId)) {
      // Pages come newest first; keeping the last one seen keeps the oldest share.
      byKey.set(`${reel.direction}:${reel.mediaId}`, reel);
    }
    onProgress({ phase: "scan", messages, reels: byKey.size });
  }
  return [...byKey.values()].sort((a, b) => a.sentAt - b.sentAt);
}

async function videoUrlFor(api, reel) {
  if (reel.videoUrl) return reel.videoUrl;
  const { items } = await api(`/api/v1/media/${reel.mediaId}/info/`);
  const url = pickBestVideo(items?.[0]?.video_versions);
  if (!url) throw new Error("reel has no video (deleted, private or not a video)");
  return url;
}

const encoder = new TextEncoder();

/**
 * Yields tar entries: one .mp4 per reel and a final manifest.json. A reel that
 * cannot be downloaded is listed under `failed` instead of aborting the export.
 */
export async function* archiveEntries({ api, fetchVideo, reels, threadId, onProgress }) {
  const exported = [];
  const failed = [];
  for (const [index, reel] of reels.entries()) {
    onProgress({ phase: "download", done: index, total: reels.length });
    const meta = {
      direction: reel.direction,
      shortcode: reel.shortcode,
      url: reel.shortcode ? `https://www.instagram.com/reel/${reel.shortcode}/` : null,
      sent_at: new Date(reel.sentAt).toISOString(),
      sender_id: reel.senderId,
    };
    try {
      const data = await fetchVideo(await videoUrlFor(api, reel));
      const file = reelFileName(reel);
      yield { name: file, data, mtime: new Date(reel.sentAt) };
      exported.push({ file, ...meta });
    } catch (error) {
      failed.push({ ...meta, error: String(error?.message ?? error) });
    }
  }
  onProgress({ phase: "download", done: reels.length, total: reels.length });

  const count = (direction) => exported.filter((r) => r.direction === direction).length;
  const manifest = {
    generator: "reelster",
    thread_id: threadId,
    exported_at: new Date().toISOString(),
    totals: { sent: count("sent"), received: count("received"), failed: failed.length },
    reels: exported,
    failed,
  };
  yield { name: "manifest.json", data: encoder.encode(JSON.stringify(manifest, null, 2)), mtime: new Date() };
}
