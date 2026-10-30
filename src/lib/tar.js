// Minimal streaming writer for POSIX ustar archives, gzipped with the
// platform's CompressionStream. No dependencies, works in browsers and Node.

const BLOCK = 512;
const encoder = new TextEncoder();

function writeString(block, offset, length, value) {
  const bytes = encoder.encode(value);
  if (bytes.length > length) throw new Error(`tar field too long: ${value}`);
  block.set(bytes, offset);
}

function writeOctal(block, offset, length, value) {
  // length - 1 digits followed by a NUL terminator.
  writeString(block, offset, length, value.toString(8).padStart(length - 1, "0") + "\0");
}

/** Builds the 512-byte ustar header for a regular file. */
export function tarHeader(name, size, mtime) {
  if (!/^[\x20-\x7e]+$/.test(name)) throw new Error(`tar entry name must be printable ASCII: ${name}`);
  if (name.length > 100) throw new Error(`tar entry name too long (max 100): ${name}`);

  const block = new Uint8Array(BLOCK);
  writeString(block, 0, 100, name);
  writeOctal(block, 100, 8, 0o644);
  writeOctal(block, 108, 8, 0);
  writeOctal(block, 116, 8, 0);
  writeOctal(block, 124, 12, size);
  writeOctal(block, 136, 12, Math.floor(mtime.getTime() / 1000));
  block.fill(0x20, 148, 156); // checksum is computed with this field as spaces
  block[156] = 0x30; // '0' = regular file
  writeString(block, 257, 6, "ustar\0");
  writeString(block, 263, 2, "00");

  let sum = 0;
  for (const byte of block) sum += byte;
  writeString(block, 148, 8, sum.toString(8).padStart(6, "0") + "\0 ");
  return block;
}

/**
 * Yields the tar byte stream for `entries`, an (async) iterable of
 * `{ name, data: Uint8Array, mtime: Date }`. Entries are consumed lazily so
 * only one file needs to be in memory at a time.
 */
export async function* tarChunks(entries) {
  for await (const { name, data, mtime } of entries) {
    yield tarHeader(name, data.length, mtime);
    yield data;
    const padding = (BLOCK - (data.length % BLOCK)) % BLOCK;
    if (padding) yield new Uint8Array(padding);
  }
  yield new Uint8Array(BLOCK * 2); // end-of-archive marker
}

/** Returns a ReadableStream with the gzipped tar of `entries`. */
export function tarGzStream(entries) {
  const chunks = tarChunks(entries);
  const tar = new ReadableStream({
    async pull(controller) {
      const { value, done } = await chunks.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel(reason) {
      await chunks.return(reason);
    },
  });
  return tar.pipeThrough(new CompressionStream("gzip"));
}
