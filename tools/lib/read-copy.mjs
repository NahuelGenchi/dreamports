// Which game a copy is, on any console: what its header or its disc's first files name, with the SHA-1 of the whole of
// it, read a piece at a time, as a disc can be larger than this computer's memory. Everything is read from the copy on
// this computer and stays here.

import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { open, readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { CONSOLES } from '../consoles.mjs';
import { readCopy } from '../gba/header.mjs';

const ascii = (bytes, at, length) => bytes.toString('latin1', at, at + length).replace(/[\0\s]+$/, '').trim();
const HEAD = 0x10000;

const SNES_REGIONS = { 0: 'Japan', 1: 'USA', 2: 'Europe' };

// the console a cartridge's first bytes say it's for, with what they name
function cartridge(bytes) {
  if (ascii(bytes, 0, 3) === 'NES' && bytes[3] === 0x1A) return { console: 'nes' };
  if (ascii(bytes, 0, 6) === 'MADEUP') return { console: 'made-up' };
  if (ascii(bytes, 0, 8) === 'PS-X EXE') return { console: 'ps1' };
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

// how a disc's sectors are laid out: how long each is, and where its data starts
const SECTORS = [[2048, 0], [2352, 24], [2352, 16]];

// a disc's first volume: where its files start, and how its sectors are laid out
async function disc(file) {
  const read = async (at, length) => {
    const bytes = Buffer.alloc(length);
    const { bytesRead } = await file.read(bytes, 0, length, at);
    return bytes.subarray(0, bytesRead);
  };
  for (const [sector, data] of SECTORS) {
    const volume = await read(16 * sector + data, 2048);
    if (ascii(volume, 1, 5) !== 'CD001') continue;
    const system = ascii(volume, 8, 32), title = ascii(volume, 40, 32);
    const files = await read(volume.readUInt32LE(158) * sector + data, 2048);
    const named = async name => {
      for (let at = 0; at + 33 < files.length && files[at];) {
        if (ascii(files, at + 33, files[at + 32]).replace(/;\d+$/, '') === name) return read(files.readUInt32LE(at + 2) * sector + data, Math.min(files.readUInt32LE(at + 10), 2048));
        at += files[at];
      }
      return null;
    };
    if (system.startsWith('PSP')) return { console: 'psp', title, code: ascii((await named('UMD_DATA.BIN')) ?? Buffer.alloc(0), 0, 10).split('|')[0] };
    if (system.startsWith('PLAYSTATION')) {
      const boot = (await named('SYSTEM.CNF'))?.toString('latin1') ?? '';
      const found = /BOOT(2?)\s*=\s*[^\\:]*:\\?([^;\s]+)/i.exec(boot);
      return { console: found?.[1] === '2' ? 'ps2' : 'ps1', title, code: found?.[2].replace('\\', '') ?? '' };
    }
    return { console: null, title, code: '' };
  }
  return null;
}

// the files a .cue names, in order, which hold the disc
const dataFiles = async path => {
  if (extname(path).toLowerCase() !== '.cue') return [path];
  const listed = [...(await readFile(path, 'latin1')).matchAll(/^\s*FILE\s+"([^"]+)"/gim)].map(found => join(dirname(path), found[1]));
  return listed.length ? listed : [path];
};

// the SHA-1 of all these files together, and of each
async function sha1Of(files) {
  const whole = createHash('sha1'), tracks = [];
  for (const file of files) {
    const hash = createHash('sha1');
    for await (const piece of createReadStream(file, { highWaterMark: 0x100000 })) {
      whole.update(piece);
      hash.update(piece);
    }
    tracks.push(hash.digest('hex'));
  }
  return { sha1: whole.digest('hex'), tracks };
}

/**
 * Whether these bytes look like a copy of a game on any console, for what must never leave this computer. A disc's track
 * of sound has nothing to tell it by: only the SHA-1s `rom` remembers know that.
 */
export function looksLikeAnyCopy(bytes) {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return !!cartridge(buffer) || SECTORS.some(([sector, data]) => ascii(buffer, 16 * sector + data + 1, 5) === 'CD001');
}

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
  const files = await dataFiles(path);
  // a disc whose tracks have moved isn't a copy of anything
  if (!files.every(existsSync)) return null;
  const file = await open(files[0]);
  let found;
  try {
    const head = Buffer.alloc(HEAD * 2);
    const { bytesRead } = await file.read(head, 0, head.length, 0);
    found = cartridge(head.subarray(0, bytesRead)) ?? await disc(file);
  } finally {
    await file.close();
  }
  const id = said ?? found?.console;
  // a file with a name of its own can still hold a Game Boy Advance game, whose header says so; another console's file can't
  if (!id) return Object.values(CONSOLES).some(({ files: kinds }) => kinds.includes(extension)) ? null : gbaIn();
  let size = 0;
  for (const data of files) size += (await stat(data)).size;
  const { sha1, tracks } = await sha1Of(files);
  return { console: id, title: found?.title || basename(path, extension), code: found?.code ?? '', region: found?.region ?? null, revision: 0, size, sha1, tracks: files.length > 1 ? tracks : undefined };
}
