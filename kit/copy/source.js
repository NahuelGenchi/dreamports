// A file read a piece at a time, as disc.js reads a copy: { name, size, read(at, length) }, where `read` resolves to
// the bytes from `at`, fewer at the file's end. In a browser it's the File the player chose or dropped, which stays on
// their device and is never read whole; the tools make the same from a file on the computer (tools/lib/read-copy.mjs).

// what's read is read in chunks of 256 KB, and the last 32 of them are kept, as a disc's reads come close together
const CHUNK = 0x40000, KEPT = 32;

/** A File or Blob, read in pieces. */
export function blobSource(blob, name = blob.name ?? '') {
  return chunked({ name, size: blob.size, read: async (at, length) => new Uint8Array(await blob.slice(at, at + length).arrayBuffer()) });
}

/** A source whose reads go through chunks it keeps a few of, so many small reads close together cost one. */
export function chunked(source) {
  const kept = new Map();
  const chunk = n => {
    let found = kept.get(n);
    if (found) {
      kept.delete(n);
      kept.set(n, found);
      return found;
    }
    found = source.read(n * CHUNK, Math.min(CHUNK, source.size - n * CHUNK));
    kept.set(n, found);
    if (kept.size > KEPT) kept.delete(kept.keys().next().value);
    found.catch(() => kept.delete(n));
    return found;
  };
  return {
    name: source.name,
    size: source.size,
    async read(at, length) {
      length = Math.max(0, Math.min(length, source.size - at));
      // a long read goes straight to the file
      if (length > CHUNK * 4) return source.read(at, length);
      const out = new Uint8Array(length);
      for (let done = 0; done < length;) {
        const n = Math.floor((at + done) / CHUNK), within = at + done - n * CHUNK;
        const bytes = await chunk(n), take = Math.min(bytes.length - within, length - done);
        if (take <= 0) return out.subarray(0, done);
        out.set(bytes.subarray(within, within + take), done);
        done += take;
      }
      return out;
    },
  };
}
