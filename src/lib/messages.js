// Reads Direct messages out of the GraphQL bodies the Instagram web app
// loads by itself. The parsing is shape-agnostic on purpose: the same
// `slide_messages` lists appear under different query names, inside inbox
// preloads and inside server-rendered `__bbox` wrappers.

/** Chat id from a https://www.instagram.com/direct/t/<id>/ URL, or null. */
export function threadIdFromUrl(url) {
  const { hostname, pathname } = new URL(url);
  if (!/(^|\.)instagram\.com$/.test(hostname)) return null;
  const match = /^\/direct\/t\/([^/?#]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * A body is one JSON document, or several newline-separated ones
 * (incremental delivery), optionally behind a `for (;;);` guard.
 */
export function parseBodies(text) {
  const unguarded = (s) => s.replace(/^\s*for\s*\(;;\);/, "");
  try {
    return [JSON.parse(unguarded(text))];
  } catch {
    const docs = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        docs.push(JSON.parse(unguarded(line)));
      } catch {
        // Not every line of a multipart body is JSON.
      }
    }
    return docs;
  }
}

// The thread's own ids (`id`, `thread_fbid`, `thread_key`, ...). Other id
// fields such as `viewer_id` are left out: they are shared across chats.
function threadIdsOf(container) {
  const ids = [];
  for (const [key, value] of Object.entries(container)) {
    if ((typeof value === "string" || typeof value === "number") && /^id$|thread/i.test(key)) ids.push(String(value));
  }
  return ids;
}

/**
 * Message nodes of one chat found anywhere in a parsed body. `knownIds`
 * starts with the id from the URL and grows with the other ids the chat is
 * seen with, because older pages may carry only those.
 */
export function messagesForThread(doc, knownIds) {
  const found = [];
  const stack = [doc];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      stack.push(...value);
      continue;
    }
    const edges = value.slide_messages?.edges;
    if (Array.isArray(edges)) {
      const containerIds = threadIdsOf(value);
      const containerMatches = containerIds.some((id) => knownIds.has(id));
      for (const { node } of edges) {
        if (!node) continue;
        const fbid = node.thread_fbid == null ? null : String(node.thread_fbid);
        if (!containerMatches && !knownIds.has(fbid)) continue;
        found.push(node);
        for (const id of containerIds) knownIds.add(id);
        if (fbid) knownIds.add(fbid);
      }
    }
    for (const [key, child] of Object.entries(value)) if (key !== "slide_messages") stack.push(child);
  }
  return found;
}
