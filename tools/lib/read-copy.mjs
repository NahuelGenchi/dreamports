// Which game a copy is, on any console: what its header or its disc's first files name, with the SHA-1 of the whole of
// it, read a piece at a time, as a disc can be larger than this computer's memory. Everything is read from the copy on
// this computer and stays here.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { open, readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { constants as zlibConstants, inflateRawSync, zstdDecompressSync } from 'node:zlib';
import { CONSOLES } from '../consoles.mjs';
import { readCopy } from '../gba/header.mjs';
import { openDisc as openDiscOf } from '../../kit/copy/disc.js';
import { isChd } from '../../kit/copy/chd.js';
import { isCso } from '../../kit/copy/cso.js';
import { inflateRaw } from '../../kit/copy/inflate.js';
import { bootOf, readFileOn, volumeOf, whatDisc } from '../../kit/copy/iso9660.js';
import { chunked } from '../../kit/copy/source.js';

const ascii = (bytes, at, length) => bytes.toString('latin1', at, at + length).replace(/[\0\s]+$/, '').trim();
const HEAD = 0x10000;

const SNES_REGIONS = { 0: 'Japan', 1: 'USA', 2: 'Europe' };

// the console a cartridge's first bytes say it's for, with what they name
function cartridge(bytes) {
  if (ascii(bytes, 0, 3) === 'NES' && bytes[3] === 0x1A) return { console: 'nes' };
  if (ascii(bytes, 0, 6) === 'MADEUP') return { console: 'made-up' };
  if (ascii(bytes, 0, 8) === 'PS-X EXE') return { console: 'ps1' };
  // a program for the PlayStation 2's processor, as its ELF file's flags say
  if (bytes.length >= 52 && bytes.readUInt32BE(0) === 0x7F454C46 && bytes.readUInt16LE(18) === 8 && bytes.readUInt32LE(36) === 0x20924001) return { console: 'ps2' };
  // and one for the PlayStation Portable's, the Allegrex
  if (bytes.length >= 52 && bytes.readUInt32BE(0) === 0x7F454C46 && bytes.readUInt16LE(18) === 8 && (bytes.readUInt32LE(36) & 0x00FF0000) === 0x00A20000) return { console: 'psp' };
  const magic = bytes.length >= 4 ? bytes.readUInt32BE(0) : 0;
  // a Nintendo 64 cartridge's first word, in the three orders copies come in
  if (magic === 0x80371240 || magic === 0x37804012 || magic === 0x40123780) {
    const size = 4, head = Buffer.from(bytes.subarray(0, 0x40));
    if (magic !== 0x80371240) for (let i = 0; i + size <= 0x40; i += size) {
      if (magic === 0x40123780) head.subarray(i, i + 4).reverse();
      else { head.subarray(i, i + 2).reverse(); head.subarray(i + 2, i + 4).reverse(); }
    }
    return { console: 'n64', title: ascii(head, 0x20, 20), code: ascii(head, 0x3B, 4) };
  }
  if (bytes.length > 0x200 && ascii(bytes, 0x100, 4) === 'SEGA') return { console: 'md', title: ascii(bytes, 0x150, 48), code: ascii(bytes, 0x180, 14) };
  // a Game Boy cartridge's header checksum
  if (bytes.length > 0x150) {
    let sum = 0;
    for (let i = 0x134; i <= 0x14C; i++) sum = (sum - bytes[i] - 1) & 0xFF;
    if (sum === bytes[0x14D] && bytes[0x147] < 0x20 && bytes[0x149] < 6) {
      const colour = bytes[0x143] === 0x80 || bytes[0x143] === 0xC0;
      return { console: colour ? 'gbc' : 'gb', title: ascii(bytes, 0x134, colour ? 11 : 16), code: colour ? ascii(bytes, 0x13F, 4) : '', region: bytes[0x14A] ? 'World' : 'Japan' };
    }
  }
  // a Super Nintendo cartridge's header, where its checksum and the checksum's complement add up, past a copier's 512 bytes
  for (const base of [0x7FC0, 0xFFC0, 0x81C0, 0x101C0]) {
    if (bytes.length < base + 0x20) continue;
    if ((bytes.readUInt16LE(base + 0x1C) ^ bytes.readUInt16LE(base + 0x1E)) === 0xFFFF && bytes[base + 0x15] < 0x40) {
      return { console: 'snes', title: ascii(bytes, base, 21), code: bytes[base + 0x1A] === 0x33 ? ascii(bytes, base - 0x0E, 4) : '', region: SNES_REGIONS[bytes[base + 0x19]] ?? null };
    }
  }
  return null;
}

// Discs, in any of the files they come in, are read through kit/copy/, the same reader the page uses, a few sectors at a
// time: kit/copy/disc.js says how each kind of file keeps a disc, and kit/copy/iso9660.js finds a file on one.

/** A file on this computer, read a piece at a time (kit/copy/source.js), with `close()` once it's done with. */
export async function fileSource(path) {
  const handle = await open(path);
  const { size } = await handle.stat();
  const source = chunked({
    name: basename(path),
    size,
    async read(at, length) {
      const bytes = Buffer.alloc(Math.max(0, Math.min(length, size - at)));
      let done = 0;
      while (done < bytes.length) {
        const { bytesRead } = await handle.read(bytes, done, bytes.length - done, at + done);
        if (!bytesRead) break;
        done += bytesRead;
      }
      return new Uint8Array(bytes.buffer, bytes.byteOffset, done);
    },
  });
  return Object.assign(source, { close: () => handle.close() });
}

// deflate through Node's own zlib, and the kit's where zlib won't take a stream with bytes after its end; and zstd,
// which only Node has
const inflate = (bytes, size, options) => {
  try {
    const out = inflateRawSync(bytes, { finishFlush: zlibConstants.Z_SYNC_FLUSH });
    if (out.length === size) return new Uint8Array(out.buffer, out.byteOffset, out.length);
  } catch { /* the kit's own reads what zlib won't */ }
  return inflateRaw(bytes, size, options);
};
const zstd = zstdDecompressSync && ((bytes, size) => {
  const out = zstdDecompressSync(bytes);
  if (out.length !== size) throw new Error(`A zstd piece of the copy held ${out.length} bytes where ${size} were wanted.`);
  return new Uint8Array(out.buffer, out.byteOffset, out.length);
});

/**
 * The disc in the file at `path`, ISO, BIN, .cue, CHD, CSO or ZSO, read a few sectors at a time, or null when it isn't
 * one: kit/copy/disc.js's { format, kind, sectors, layerBreak, tracks, read(lba, count), data(lba, count), image(),
 * files }, with `close()` to let go of its files once it's done with. A .cue's files are the ones beside it.
 */
export async function openDisc(path) {
  const sources = [await fileSource(path)];
  const close = () => Promise.all(sources.map(each => each.close()));
  try {
    const disc = await openDiscOf(sources[0], {
      zstd, inflate,
      open: async name => {
        const beside = join(dirname(path), name);
        if (!existsSync(beside)) return null;
        const source = await fileSource(beside);
        sources.push(source);
        return source;
      },
    });
    if (!disc) {
      await close();
      return null;
    }
    return Object.assign(disc, { close });
  } catch (error) {
    await close();
    throw error;
  }
}

/**
 * A whole file on a disc, by its name in the disc's top folder, such as SLUS_205.73, or with the folders it's in before
 * it, as GAME\MAIN.EXE, read a sector at a time from whatever file the disc is in, or null when it has none of that
 * name. For the program a PlayStation or PlayStation 2 game boots, which its code map is made from
 * (ps1/functions.mjs, ps2/functions.mjs).
 */
export async function readDiscFile(path, name) {
  const disc = await openDisc(path);
  if (!disc) return null;
  try {
    const bytes = await readFileOn(disc, name);
    return bytes && Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
  } finally {
    await disc.close();
  }
}

/**
 * Every file on a disc, by its name with the folders it's in, as DATA/MODELS.ARC, and a way to read any stretch of one,
 * in whatever file the disc is: { files: [{ name, size }], read(name, at, length), close() }, or null when it isn't a
 * disc. For a PlayStation 2 game's code map, as a game keeps code in many files (ps2/functions.mjs).
 */
export async function discFiles(path) {
  const disc = await openDisc(path);
  if (!disc) return null;
  const volume = await volumeOf(disc);
  if (!volume) {
    await disc.close();
    return null;
  }
  const files = new Map();
  const walk = async (lba, size, folder, depth) => {
    const entries = Buffer.from(await disc.data(lba, Math.ceil(Math.max(2048, Math.min(size, 0x100000)) / 2048)));
    for (let at = 0; at + 33 < entries.length;) {
      if (!entries[at]) { at = (Math.floor(at / 2048) + 1) * 2048; continue; }
      const name = ascii(entries, at + 33, entries[at + 32]).replace(/;\d+$/, '');
      const entry = { lba: entries.readUInt32LE(at + 2), size: entries.readUInt32LE(at + 10) };
      // past the folder's own entry and its parent's
      if (!(entries[at + 32] === 1 && entries[at + 33] <= 1)) {
        if (entries[at + 25] & 2) { if (depth < 8) await walk(entry.lba, entry.size, `${folder}${name}/`, depth + 1); }
        else files.set(`${folder}${name}`, entry);
      }
      at += entries[at];
    }
  };
  await walk(volume.root.lba, volume.root.size, '', 0);
  const read = async (name, at = 0, length = files.get(name).size - at) => {
    const file = files.get(name), wanted = Math.max(0, Math.min(length, file.size - at));
    if (!wanted) return Buffer.alloc(0);
    const first = Math.floor(at / 2048), count = Math.ceil((at % 2048 + wanted) / 2048);
    const bytes = await disc.data(file.lba + first, count);
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).subarray(at % 2048, at % 2048 + wanted);
  };
  return { files: [...files].map(([name, { size }]) => ({ name, size })), read, close: () => disc.close() };
}

/** The name of the program a PlayStation 2 disc boots, as its SYSTEM.CNF says, such as SLUS_205.73. */
export async function bootFile(path) {
  const disc = await openDisc(path);
  if (!disc) return null;
  try {
    return await bootOf(disc);
  } finally {
    await disc.close();
  }
}

// files that aren't a disc, each a track of an image
const wholeFiles = paths => ({
  async* image() {
    for (const [track, path] of paths.entries()) {
      const source = await fileSource(path);
      try {
        for (let at = 0; at < source.size; at += 0x400000) yield { track, bytes: await source.read(at, 0x400000) };
      } finally {
        await source.close();
      }
    }
  },
});

/** The files a copy is, to give a page: a .cue and the tracks it names, or the file itself. */
export async function copyFiles(path) {
  const files = await cueFiles(path);
  return files[0] === path ? files : [path, ...files];
}

// the files a .cue names, in order, or the file itself
async function cueFiles(path) {
  if (extname(path).toLowerCase() !== '.cue') return [path];
  const listed = [...(await readFile(path, 'latin1')).matchAll(/^\s*FILE\s+"([^"]+)"/gim)].map(found => join(dirname(path), found[1]));
  return listed.length ? listed : [path];
}

// the SHA-1 of a disc's bytes, as the image it was made from holds them, and of each of its tracks
async function sha1Of(disc) {
  const whole = createHash('sha1'), tracks = [];
  let size = 0;
  for await (const { track, bytes } of disc.image()) {
    (tracks[track] ??= createHash('sha1')).update(bytes);
    whole.update(bytes);
    size += bytes.length;
  }
  return { sha1: whole.digest('hex'), tracks: tracks.map(hash => hash.digest('hex')), size };
}

/**
 * Whether these bytes look like a copy of a game on any console, for what must never leave this computer. A disc's track
 * of sound has nothing to tell it by: only the SHA-1s `rom` remembers know that.
 */
export function looksLikeAnyCopy(bytes) {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return !!cartridge(buffer) || isChd(buffer) || isCso(buffer) || SECTORS.some(([sector, data]) => ascii(buffer, 16 * sector + data + 1, 5) === 'CD001');
}

// the ways a disc's first volume can lie in a file: in sectors of 2048 bytes, or raw, Mode 2 or Mode 1
const SECTORS = [[2048, 0], [2352, 24], [2352, 16]];

/**
 * Reads a copy: { console, title, code, region, revision, size, sha1 }, and `tracks`, the SHA-1 of each file of a disc
 * split into several, or null when it can't tell it's a game. `said` is
 * the console the person says it's for, for a kind of file that doesn't say: a compressed disc, or a console's own.
 */
export async function readAnyCopy(path, said = null) {
  const extension = extname(path).toLowerCase();
  const gbaIn = async () => {
    const { size } = await stat(path);
    const gba = size <= CONSOLES.gba.largest ? await readCopy(path) : null;
    return gba && { console: 'gba', ...gba };
  };
  if (said === 'gba' || (!said && CONSOLES.gba.files.includes(extension))) {
    const gba = await gbaIn();
    if (gba) return gba;
  }
  // a .cue's files, in order, hold the copy: a disc whose tracks have moved isn't a copy of anything
  const files = await cueFiles(path);
  if (!files.every(existsSync)) return null;
  const file = await fileSource(files[0]);
  let found = null, disc = null;
  try {
    found = cartridge(Buffer.from(await file.read(0, HEAD * 2)));
  } finally {
    await file.close();
  }
  if (!found) {
    disc = await openDisc(path).catch(error => {
      // a file that says it's a compressed disc and can't be read says why
      throw new Error(`${basename(path)} can't be read: ${error.message}`);
    });
    if (disc) found = await whatDisc(disc);
  }
  try {
    const id = said ?? found?.console;
    // a file with a name of its own can still hold a Game Boy Advance game, whose header says so; another console's file can't
    if (!id) return Object.values(CONSOLES).some(({ files: kinds }) => kinds.includes(extension)) ? null : gbaIn();
    const { sha1, tracks, size } = await sha1Of(disc ?? wholeFiles(files));
    return { console: id, title: found?.title || basename(path, extension), code: found?.code ?? '', region: found?.region ?? null, revision: 0, size, sha1, tracks: tracks.length > 1 ? tracks : undefined, ...(disc ? { format: disc.format, kind: disc.kind, whole: disc.whole } : {}) };
  } finally {
    await disc?.close();
  }
}
