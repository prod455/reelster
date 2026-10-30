import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveThreadId, iterateThreadItems, threadIdFromUrl } from "../src/lib/thread.js";

const noSleep = async () => {};

test("threadIdFromUrl reads the id from a DM URL", () => {
  assert.equal(threadIdFromUrl("https://www.instagram.com/direct/t/1234567890/"), "1234567890");
  assert.equal(threadIdFromUrl("https://www.instagram.com/direct/t/1234567890?x=1"), "1234567890");
});

test("threadIdFromUrl returns null outside a DM thread", () => {
  assert.equal(threadIdFromUrl("https://www.instagram.com/direct/inbox/"), null);
  assert.equal(threadIdFromUrl("https://example.com/direct/t/1/"), null);
});

test("resolveThreadId keeps an id the thread endpoint accepts", async () => {
  const api = async (path) => {
    assert.match(path, /^\/api\/v1\/direct_v2\/threads\/42\//);
    return { thread: { thread_id: "42", items: [] } };
  };
  assert.equal(await resolveThreadId(api, "42", noSleep), "42");
});

test("resolveThreadId maps a v2 URL id to the API thread id via the inbox", async () => {
  const pages = {
    "": { inbox: { threads: [{ thread_id: "1", thread_v2_id: "100" }], has_older: true, oldest_cursor: "c1" } },
    c1: { inbox: { threads: [{ thread_id: "2", thread_v2_id: "200" }], has_older: false } },
  };
  const api = async (path) => {
    if (path.includes("/threads/")) throw Object.assign(new Error("404"), { status: 404 });
    const cursor = new URL(path, "https://x").searchParams.get("cursor") ?? "";
    return pages[cursor];
  };
  assert.equal(await resolveThreadId(api, "200", noSleep), "2");
});

test("resolveThreadId throws when the thread is nowhere in the inbox", async () => {
  const api = async (path) => {
    if (path.includes("/threads/")) throw Object.assign(new Error("404"), { status: 404 });
    return { inbox: { threads: [], has_older: false } };
  };
  await assert.rejects(resolveThreadId(api, "9", noSleep), /not found/);
});

test("resolveThreadId does not hide non-404 errors", async () => {
  const api = async () => { throw Object.assign(new Error("rate limited"), { status: 429 }); };
  await assert.rejects(resolveThreadId(api, "9", noSleep), /rate limited/);
});

test("iterateThreadItems walks every page oldest-ward and reports the viewer", async () => {
  const pages = {
    "": { thread: { viewer_id: 7, items: [{ item_id: "a" }, { item_id: "b" }], has_older: true, oldest_cursor: "c1" } },
    c1: { thread: { viewer_id: 7, items: [{ item_id: "c" }], has_older: false } },
  };
  const seen = [];
  const api = async (path) => {
    seen.push(path);
    return pages[new URL(path, "https://x").searchParams.get("cursor") ?? ""];
  };
  const out = [];
  for await (const page of iterateThreadItems(api, "42", noSleep)) out.push(page);
  assert.deepEqual(out.map((p) => p.items.map((i) => i.item_id)), [["a", "b"], ["c"]]);
  assert.equal(out[0].viewerId, "7");
  assert.equal(seen.length, 2);
});

test("iterateThreadItems stops if the cursor does not advance", async () => {
  const api = async () => ({ thread: { viewer_id: 7, items: [], has_older: true, oldest_cursor: "same" } });
  const out = [];
  for await (const page of iterateThreadItems(api, "42", noSleep)) out.push(page);
  assert.equal(out.length, 2);
});

test("iterateThreadItems fails loudly when the viewer id is missing", async () => {
  const api = async () => ({ thread: { items: [], has_older: false } });
  await assert.rejects(async () => { for await (const _ of iterateThreadItems(api, "42", noSleep)); }, /viewer_id/);
});
