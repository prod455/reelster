// Turns the shared Reels and posts of a chat into tar entries.

import { shareFileNames } from "./shares.js";

const encoder = new TextEncoder();
const PAGE = { reel: "reel", post: "p" };

/**
 * Yields every file of every share and a final manifest.json. A share whose
 * files cannot all be downloaded is skipped and listed under `failed`.
 *
 * resolveMedia(share) -> [{ type, url }], for shares whose message has no media.
 * fetchMedia(url) -> Uint8Array
 * period: the `{ from, to }` the shares were filtered with, recorded in the manifest.
 */
export async function* archiveEntries({ shares, resolveMedia, fetchMedia, threadId, period = { from: null, to: null }, onProgress }) {
  const items = [];
  const failed = [];
  for (const [index, share] of shares.entries()) {
    onProgress({ phase: "download", done: index, total: shares.length });
    const meta = {
      kind: share.kind,
      direction: share.direction,
      shortcode: share.shortcode,
      url: `https://www.instagram.com/${PAGE[share.kind]}/${share.shortcode}/`,
      sent_at: new Date(share.sentAt).toISOString(),
      sender_id: share.senderId,
    };
    try {
      let media = share.media ?? (await resolveMedia(share));
      if (share.kind === "reel") {
        media = media.filter((m) => m.type === "video").slice(0, 1);
        if (!media.length) throw new Error("reel has no video");
      }
      const names = shareFileNames(share, media);
      // Download everything first so a share is either complete or absent.
      const files = [];
      for (const m of media) files.push(await fetchMedia(m.url));
      for (const [i, data] of files.entries()) yield { name: names[i], data, mtime: new Date(share.sentAt) };
      items.push({ ...meta, files: names });
    } catch (error) {
      failed.push({ ...meta, error: String(error?.message ?? error) });
    }
  }
  onProgress({ phase: "download", done: shares.length, total: shares.length });

  const count = (kind, direction) => items.filter((i) => i.kind === kind && i.direction === direction).length;
  const manifest = {
    generator: "reelster",
    thread_id: threadId,
    exported_at: new Date().toISOString(),
    period: {
      from: period.from === null ? null : new Date(period.from).toISOString(),
      to: period.to === null ? null : new Date(period.to).toISOString(),
    },
    totals: {
      reels: { sent: count("reel", "sent"), received: count("reel", "received") },
      posts: { sent: count("post", "sent"), received: count("post", "received") },
      post_files: items.filter((i) => i.kind === "post").reduce((n, i) => n + i.files.length, 0),
      failed: failed.length,
    },
    items,
    failed,
  };
  yield { name: "manifest.json", data: encoder.encode(JSON.stringify(manifest, null, 2)), mtime: new Date() };
}

/** Distinct failure reasons with how many shares hit each, most frequent first. */
export function failureSummary(failed) {
  const counts = new Map();
  for (const { error } of failed) counts.set(error, (counts.get(error) ?? 0) + 1);
  return [...counts].map(([error, count]) => ({ error, count })).sort((a, b) => b.count - a.count);
}
