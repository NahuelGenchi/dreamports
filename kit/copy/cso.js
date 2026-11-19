// A compressed ISO as PlayStation Portable and PlayStation 2 players keep them: CSO (CISO), versions 1 and 2, and ZSO.
// A header, then where each block of the disc starts, then the blocks, each deflated, kept as it was, or, in ZSO and
// CSO 2, compressed with LZ4. Written from the format's description in maxcso's README (ISC); nothing of it is copied.

import { inflateRaw } from './inflate.js';

const u32 = (b, at) => (b[at] | b[at + 1] << 8 | b[at + 2] << 16 | b[at + 3] << 24) >>> 0;

/** Whether these first bytes are a CSO's or a ZSO's. */
export const isCso = head => head.length >= 4 && ['CISO', 'ZISO'].includes(String.fromCharCode(...head.subarray(0, 4)));

/** LZ4's block format: `size` bytes from the block in `input`. */
export function lz4Block(input, size) {
  const out = new Uint8Array(size);
  let at = 0, n = 0;
  while (at < input.length) {
    const token = input[at++];
    let literals = token >>> 4;
    if (literals === 15) for (let more = 255; more === 255;) literals += more = input[at++];
    if (n + literals > size || at + literals > input.length) throw new Error('An LZ4 block in the copy holds more than it should.');
    out.set(input.subarray(at, at + literals), n);
    at += literals;
    n += literals;
    if (at >= input.length || n >= size) break;
    const distance = input[at] | input[at + 1] << 8;
    at += 2;
    let length = token & 15;
    if (length === 15) for (let more = 255; more === 255;) length += more = input[at++];
    length += 4;
    if (!distance || distance > n || n + length > size) throw new Error('An LZ4 block in the copy reaches outside what it holds.');
    for (let i = 0; i < length; i++, n++) out[n] = out[n - distance];
  }
  if (n !== size) throw new Error(`An LZ4 block in the copy held ${n} bytes where ${size} were wanted.`);
  return out;
}

/**
 * Opens the CSO or ZSO `source` ({ size, read(at, length) }) and resolves to { format, size, blockSize, read(at, length) }:
 * `size` is the disc's, and `read` gives its bytes, as the ISO it was made from holds them.
 */
export async function openCso(source, { inflate = inflateRaw } = {}) {
  const head = await source.read(0, 24);
  if (!isCso(head)) throw new Error("This isn't a CSO.");
  const zso = head[0] === 0x5A, headerSize = u32(head, 4), size = u32(head, 8) + u32(head, 12) * 2 ** 32;
  const blockSize = u32(head, 16), version = head[20], align = head[21];
  if (!blockSize || blockSize & (blockSize - 1)) throw new Error("This CSO's blocks have a size it can't have.");
  if (!zso && version > 2) throw new Error(`This is a CSO of version ${version}, which the tools can't read.`);
  const blocks = Math.ceil(size / blockSize);
  const index = await source.read(headerSize || 24, (blocks + 1) * 4);
  const entry = n => u32(index, n * 4);
  const place = value => (value & 0x7FFFFFFF) * 2 ** align;
  const cache = new Map();

  async function block(n) {
    const kept = cache.get(n);
    if (kept) return kept;
    const value = entry(n), start = place(value), stored = place(entry(n + 1)) - start, length = Math.min(blockSize, size - n * blockSize);
    const flag = value >= 0x80000000;
    // a block may be followed by zeros up to where the next starts, which neither LZ4 nor deflate reads
    const bytes = await source.read(start, Math.min(stored, 2 * blockSize + 2 ** align));
    let out;
    if (zso) out = flag ? bytes.subarray(0, length) : lz4Block(bytes, length);
    else if (version === 2) out = flag ? lz4Block(bytes, length) : stored >= blockSize ? bytes.subarray(0, length) : inflate(bytes, length);
    else out = flag ? bytes.subarray(0, length) : inflate(bytes, length);
    cache.set(n, out);
    if (cache.size > 32) cache.delete(cache.keys().next().value);
    return out;
  }
  return {
    format: zso ? 'zso' : 'cso',
    size,
    blockSize,
    async read(at, length) {
      const out = new Uint8Array(Math.max(0, Math.min(length, size - at)));
      for (let done = 0; done < out.length;) {
        const n = Math.floor((at + done) / blockSize), within = (at + done) - n * blockSize;
        const bytes = await block(n), take = Math.min(bytes.length - within, out.length - done);
        out.set(bytes.subarray(within, within + take), done);
        done += take;
      }
      return out;
    },
  };
}
