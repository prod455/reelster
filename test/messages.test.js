import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBodies, threadIdFromUrl, messagesForThread } from "../src/lib/messages.js";

const node = (id, thread = "555") => ({ message_id: id, thread_fbid: thread, timestamp_ms: "1", content: {} });
const page = (nodes, id = "555") => ({
  data: { fetch__SlideThread: { as_ig_direct_thread: { id, slide_messages: { edges: nodes.map((n) => ({ node: n })) } } } },
});

test("threadIdFromUrl reads the id from a DM URL", () => {
  assert.equal(threadIdFromUrl("https://www.instagram.com/direct/t/1234567890/"), "1234567890");
  assert.equal(threadIdFromUrl("https://www.instagram.com/direct/t/abc_9?x=1"), "abc_9");
});

test("threadIdFromUrl returns null outside a DM thread", () => {
  assert.equal(threadIdFromUrl("https://www.instagram.com/direct/inbox/"), null);
  assert.equal(threadIdFromUrl("https://example.com/direct/t/1/"), null);
});

test("parseBodies reads a single JSON document behind the for(;;) guard", () => {
  assert.deepEqual(parseBodies('for (;;);{"a":1}'), [{ a: 1 }]);
});

test("parseBodies reads newline-delimited incremental responses and skips junk lines", () => {
  assert.deepEqual(parseBodies('{"a":1}\n\nnot json\n{"b":2}'), [{ a: 1 }, { b: 2 }]);
});

test("messagesForThread finds slide_messages nodes of the open chat in any shape", () => {
  const ssr = { require: [["X", "handle", null, [{ __bbox: { result: page([node("m1")]) } }]]] };
  assert.deepEqual(messagesForThread(ssr, new Set(["555"])).map((n) => n.message_id), ["m1"]);
});

test("messagesForThread skips other chats preloaded by the inbox", () => {
  const inbox = { data: { inbox: [page([node("m1")]).data.fetch__SlideThread, page([node("x1", "777")], "777").data.fetch__SlideThread] } };
  assert.deepEqual(messagesForThread(inbox, new Set(["555"])).map((n) => n.message_id), ["m1"]);
});

test("messagesForThread matches the URL id against any id-like field of the thread", () => {
  const doc = { data: { t: { thread_key: "v2-id", id: "other", slide_messages: { edges: [{ node: node("m1", "fb") }] } } } };
  assert.equal(messagesForThread(doc, new Set(["v2-id"])).length, 1);
});

test("messagesForThread learns the chat's other ids so later pages that only carry them still match", () => {
  const ids = new Set(["555"]);
  messagesForThread(page([node("m1", "fb-1")]), ids); // first page: URL id on the thread, fbid on messages
  const later = { data: { more: { id: "fb-1", slide_messages: { edges: [{ node: node("m0", "fb-1") }] } } } };
  assert.deepEqual(messagesForThread(later, ids).map((n) => n.message_id), ["m0"]);
  assert.ok(ids.has("fb-1"));
});

test("messagesForThread does not learn ids from other chats", () => {
  const ids = new Set(["555"]);
  messagesForThread(page([node("x1", "777")], "777"), ids);
  assert.deepEqual([...ids], ["555"]);
});
