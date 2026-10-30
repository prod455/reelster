import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tarHeader, tarChunks, tarGzStream } from "../src/lib/tar.js";

const enc = new TextEncoder();

async function collect(asyncIterable) {
  const parts = [];
  for await (const p of asyncIterable) parts.push(p);
  return Buffer.concat(parts.map((p) => Buffer.from(p)));
}

async function* entries(list) {
  for (const e of list) yield e;
}

test("tarHeader is one 512-byte block with a valid checksum", () => {
  const h = tarHeader("a.txt", 5, new Date(0));
  assert.equal(h.length, 512);
  const stored = parseInt(Buffer.from(h.subarray(148, 154)).toString(), 8);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
  assert.equal(stored, sum);
});

test("tarHeader rejects names longer than 100 bytes", () => {
  assert.throws(() => tarHeader("x".repeat(101), 1, new Date()), /too long/);
});

test("tarHeader rejects non-ASCII names", () => {
  assert.throws(() => tarHeader("ção.mp4", 1, new Date()), /ASCII/);
});

test("tar output is readable by GNU tar with exact contents", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reelster-"));
  const tarPath = join(dir, "out.tar");
  const data = enc.encode("x".repeat(700)); // spans two blocks
  const buf = await collect(
    tarChunks(entries([
      { name: "recebidos/a.mp4", data, mtime: new Date(1_700_000_000_000) },
      { name: "manifest.json", data: enc.encode("{}"), mtime: new Date(1_700_000_000_000) },
    ])),
  );
  assert.equal(buf.length % 512, 0);
  writeFileSync(tarPath, buf);
  const listing = execFileSync("tar", ["-tf", tarPath]).toString().trim().split("\n");
  assert.deepEqual(listing, ["recebidos/a.mp4", "manifest.json"]);
  execFileSync("tar", ["-xf", tarPath, "-C", dir]);
  assert.equal(readFileSync(join(dir, "recebidos/a.mp4"), "utf8"), "x".repeat(700));
});

test("tarGzStream produces a gzip archive GNU tar can extract", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reelster-"));
  const gzPath = join(dir, "out.tar.gz");
  const stream = tarGzStream(entries([
    { name: "enviados/b.mp4", data: enc.encode("video-bytes"), mtime: new Date() },
  ]));
  const buf = Buffer.from(await new Response(stream).arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 2)], [0x1f, 0x8b]);
  writeFileSync(gzPath, buf);
  execFileSync("tar", ["-xzf", gzPath, "-C", dir]);
  assert.equal(readFileSync(join(dir, "enviados/b.mp4"), "utf8"), "video-bytes");
});
