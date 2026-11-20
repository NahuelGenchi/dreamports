// The program a PlayStation 2 copy boots, kept on this computer once a tool has read it off the disc, so the tools that
// read the original's bytes as they go, as a function's proof does (../lib/proofs.mjs), can without reading the disc
// again: a disc's program is found through its SYSTEM.CNF and read a few sectors at a time, which is slow to do for
// every function, and can't be done in the middle of a sum. It's in .dreamports/ps2/programs/, by the copy's SHA-1,
// and never in the repository.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL } from '../lib/paths.mjs';

const FOLDER = join(LOCAL, 'ps2', 'programs');
const fileOf = sha1 => join(FOLDER, `${sha1}.elf`);

/** Keeps the program of the copy whose SHA-1 is `sha1`, its ELF's bytes, unless it's kept already. */
export function keepProgram(sha1, elf) {
  if (existsSync(fileOf(sha1)) && readFileSync(fileOf(sha1)).equals(elf)) return;
  mkdirSync(FOLDER, { recursive: true });
  writeFileSync(fileOf(sha1), elf);
}

/** The bytes of a program as it loads, at an address of its code map: `read(address, count)`, the bytes of the
 *  segment it's in, or of as many as there are, and zeros past a segment's file. */
export function programReader(elf) {
  const segments = [];
  for (let n = 0; n < elf.readUInt16LE(44); n++) {
    const o = elf.readUInt32LE(28) + n * 32;
    if (elf.readUInt32LE(o) === 1) segments.push({ offset: elf.readUInt32LE(o + 4), address: elf.readUInt32LE(o + 8), file: elf.readUInt32LE(o + 16), memory: elf.readUInt32LE(o + 20) });
  }
  return (address, count) => {
    const s = segments.find(each => address >= each.address && address < each.address + each.memory);
    const bytes = Buffer.alloc(s ? Math.min(count, s.address + s.memory - address) : 0);
    if (s && address < s.address + s.file) elf.copy(bytes, 0, s.offset + address - s.address, s.offset + Math.min(s.file, address - s.address + bytes.length));
    return bytes;
  };
}

/** What reads the kept program of the copy whose SHA-1 is `sha1`, as programReader gives it, or null when no tool has
 *  read it on this computer yet. */
export function keptProgram(sha1) {
  return existsSync(fileOf(sha1)) ? programReader(readFileSync(fileOf(sha1))) : null;
}

// a function outside that program, by its code map's key: a module's or a vector unit's, kept by itself
const pieceOf = (sha1, key) => join(FOLDER, sha1, `${createHash('sha1').update(key).digest('hex').slice(0, 16)}.bin`);

/** Keeps the bytes of the function whose key is `key`, of the copy whose SHA-1 is `sha1`, as the disc has them: a
 *  function of another program than the one it boots, or a vector unit's program, which the tool that checked it read. */
export function keepPiece(sha1, key, bytes) {
  const file = pieceOf(sha1, key);
  if (existsSync(file) && readFileSync(file).equals(bytes)) return;
  mkdirSync(join(FOLDER, sha1), { recursive: true });
  writeFileSync(file, bytes);
}

/** The bytes kept of the function whose key is `key`, or null when no tool has read it on this computer yet. */
export const keptPiece = (sha1, key) => (existsSync(pieceOf(sha1, key)) ? readFileSync(pieceOf(sha1, key)) : null);
