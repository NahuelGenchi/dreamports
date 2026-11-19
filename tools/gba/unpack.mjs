// What the Game Boy Advance's BIOS unpacks from the cartridge, for the tools that follow code a game unpacks into its
// work memory to run (codemap.mjs, lib/points-to.mjs). The BIOS's LZ77 (swi 0x11 and 0x12) and run-length (swi 0x14 and
// 0x15) formats, as the BIOS reads them: a word of header, its type in the high nibble of the first byte and the size
// unpacked in the other three, then the data. The VRAM calls write 16 bits at a time, and what they make is the same.
// The tools don't follow the others, BitUnPack, Huffman and the diff filters, so code from them stays unnamed.

/** The kind of what a BIOS call unpacks, as the code map's copies name it, or undefined for one the tools don't follow. */
export const UNPACKED_BY = { 0x11: 'lz77', 0x12: 'lz77', 0x14: 'rl', 0x15: 'rl' };

const TYPE = { lz77: 0x10, rl: 0x30 };

/** What the BIOS unpacks of `kind` from `data` at `at` (a Uint8Array, as the cartridge's bytes), as { bytes, read }: the
 *  bytes it makes, and how many of `data` it reads. Null when there's no such header there, or the data stops short. */
export function unpack(kind, data, at) {
  if (!TYPE[kind] || at < 0 || at + 4 > data.length || (data[at] & 0xF0) !== TYPE[kind]) return null;
  const size = data[at + 1] | data[at + 2] << 8 | data[at + 3] << 16;
  const out = new Uint8Array(size);
  let i = at + 4, o = 0;
  const next = () => (i < data.length ? data[i++] : -1);
  if (kind === 'lz77') {
    while (o < size) {
      const flags = next();
      if (flags < 0) return null;
      for (let bit = 7; bit >= 0 && o < size; bit--) {
        if (!(flags >> bit & 1)) {
          const b = next();
          if (b < 0) return null;
          out[o++] = b;
          continue;
        }
        const high = next(), low = next();
        if (low < 0) return null;
        const length = (high >> 4) + 3, back = ((high & 0xF) << 8 | low) + 1;
        if (back > o) return null;
        for (let k = 0; k < length && o < size; k++, o++) out[o] = out[o - back];
      }
    }
  } else {
    while (o < size) {
      const flag = next();
      if (flag < 0) return null;
      if (flag & 0x80) {
        const b = next();
        if (b < 0) return null;
        for (let k = 0; k < (flag & 0x7F) + 3 && o < size; k++) out[o++] = b;
      } else {
        for (let k = 0; k < (flag & 0x7F) + 1 && o < size; k++) {
          const b = next();
          if (b < 0) return null;
          out[o++] = b;
        }
      }
    }
  }
  return { bytes: out, read: i - at };
}

/** The bytes a code map's copy holds where the game runs it, as a Uint8Array of `copy.size`, from `rom` (the cartridge's
 *  bytes, from 0x08000000): the cartridge's own for a copy of it, what the BIOS unpacks from there, `from` bytes in, for
 *  an unpacked one. Null when the cartridge doesn't hold it. */
export function copyBytes(rom, copy) {
  const at = copy.cartridge - 0x08000000;
  if (!copy.packed) return at >= 0 && at + copy.size <= rom.length ? rom.subarray(at, at + copy.size) : null;
  const made = unpacked(rom, copy.packed, at);
  const from = copy.from ?? 0;
  return made && from + copy.size <= made.length ? made.subarray(from, from + copy.size) : null;
}

// each stretch of the cartridge is unpacked once for all the copies of what it makes
const made = new WeakMap();
function unpacked(rom, kind, at) {
  if (!made.has(rom)) made.set(rom, new Map());
  const key = `${kind}@${at}`, kept = made.get(rom);
  if (!kept.has(key)) kept.set(key, unpack(kind, rom, at)?.bytes ?? null);
  return kept.get(key);
}
