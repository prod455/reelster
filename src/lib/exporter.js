// Turns the Reels of a chat into tar entries.

import { reelFileName } from "./reels.js";

const encoder = new TextEncoder();

/**
 * Yields one .mp4 entry per reel and a final manifest.json. A reel that
 * cannot be downloaded is listed under `failed` instead of aborting.
 *
 * resolveVideo(reel) -> video URL, for reels whose message has no inline video.
 * fetchVideo(url) -> Uint8Array
 */
export async function* archiveEntries({ reels, resolveVideo, fetchVideo, threadId, onProgress }) {
  const exported = [];
  const failed = [];
  for (const [index, reel] of reels.entries()) {
    onProgress({ phase: "download", done: index, total: reels.length });
    const meta = {
      direction: reel.direction,
      shortcode: reel.shortcode,
      url: `https://www.instagram.com/reel/${reel.shortcode}/`,
      sent_at: new Date(reel.sentAt).toISOString(),
      sender_id: reel.senderId,
    };
    try {
      const data = await fetchVideo(reel.videoUrl ?? (await resolveVideo(reel)));
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

/** Distinct failure reasons with how many reels hit each, most frequent first. */
export function failureSummary(failed) {
  const counts = new Map();
  for (const { error } of failed) counts.set(error, (counts.get(error) ?? 0) + 1);
  return [...counts].map(([error, count]) => ({ error, count })).sort((a, b) => b.count - a.count);
}
