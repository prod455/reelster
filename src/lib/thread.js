// Pagination over Instagram's web Direct API. `api(path)` must perform an
// authenticated GET on instagram.com and resolve with the parsed JSON, or
// reject with an Error carrying the HTTP `status`.

const PAGE_DELAY_MS = 600;

/** Thread id from a https://www.instagram.com/direct/t/<id>/ URL, or null. */
export function threadIdFromUrl(url) {
  const { hostname, pathname } = new URL(url);
  if (!/(^|\.)instagram\.com$/.test(hostname)) return null;
  return /^\/direct\/t\/(\d+)/.exec(pathname)?.[1] ?? null;
}

/**
 * The id in the web URL is sometimes the thread's v2 id, which the API does
 * not accept. Try it directly, then look it up in the inbox.
 */
export async function resolveThreadId(api, urlId, sleep) {
  try {
    await api(`/api/v1/direct_v2/threads/${urlId}/?limit=1`);
    return urlId;
  } catch (error) {
    if (error.status !== 404 && error.status !== 400) throw error;
  }

  let cursor = "";
  for (;;) {
    const query = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const { inbox } = await api(`/api/v1/direct_v2/inbox/?limit=20${query}`);
    const match = inbox.threads.find((t) => String(t.thread_v2_id) === urlId || String(t.thread_id) === urlId);
    if (match) return String(match.thread_id);
    if (!inbox.has_older || !inbox.oldest_cursor || inbox.oldest_cursor === cursor) break;
    cursor = inbox.oldest_cursor;
    await sleep(PAGE_DELAY_MS);
  }
  throw new Error(`thread ${urlId} not found in your inbox`);
}

/** Yields `{ items, viewerId }` for each page, newest to oldest. */
export async function* iterateThreadItems(api, threadId, sleep) {
  let cursor = "";
  for (;;) {
    const query = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const { thread } = await api(`/api/v1/direct_v2/threads/${threadId}/?limit=20${query}`);
    if (thread.viewer_id == null) throw new Error("thread response has no viewer_id; the API format changed");
    yield { items: thread.items ?? [], viewerId: String(thread.viewer_id) };
    if (!thread.has_older || !thread.oldest_cursor || thread.oldest_cursor === cursor) return;
    cursor = thread.oldest_cursor;
    await sleep(PAGE_DELAY_MS);
  }
}
