// Made-up discs of the project's own, with nothing from any game in them, and the files discs come in, written here so
// the tools' readers (kit/copy/) are tried on every kind: an ISO of a made-up PlayStation 2 disc, raw sectors for a BIN,
// a CHD of a CD or of a DVD, and a CSO or a ZSO. Each writer keeps to the format as the programs that make it do, but
// simply: its compressors only need to make something a reader must undo, not something small.

import { createHash } from 'node:crypto';
import { closeSync, ftruncateSync, openSync, writeSync } from 'node:fs';
import { crc32 as zlibCrc32, deflateRawSync } from 'node:zlib';
import { makeSector, RAW, DATA } from '../../kit/copy/cd.js';

const sha1 = bytes => createHash('sha1').update(bytes).digest();

// --- the disc ------------------------------------------------------------------------------------------------------

/** A made-up program for the PlayStation 2's processor, as its ELF file's header says. */
export function madeUpProgram(size = 4096, seed = 1) {
  const program = Buffer.alloc(size);
  program.writeUInt32BE(0x7F454C46, 0);
  program[4] = 1;
  program[5] = 1;
  program.writeUInt16LE(2, 16);
  program.writeUInt16LE(8, 18);
  program.writeUInt32LE(0x20924001, 36);
  for (let i = 64, x = seed; i < size; i++) program[i] = (x = (x * 1103515245 + 12345) >>> 0) >>> 24;
  return program;
}

/**
 * The ISO of a made-up PlayStation 2 disc, 2048-byte sectors: its volume, SYSTEM.CNF booting SLUS_999.99, the program,
 * and `files` ({ name: bytes }), each at the sector its `at` says or after the last. `dvd` adds the UDF's marks a DVD
 * has. `sectors` makes it that long. As a file when `path` is given, its gaps left for the file system to fill with
 * zeros, so a disc of gigabytes takes none of them on the computer: `place(lba, bytes)` then writes more into it.
 */
export function madeUpPs2Disc({ dvd = false, sectors = 64, files = {}, at = {}, path = null, code = 'SLUS_999.99' } = {}) {
  const all = { 'SYSTEM.CNF': Buffer.from(`BOOT2 = cdrom0:\\${code};1\r\nVER = 1.00\r\nVMODE = NTSC\r\n`), [code]: madeUpProgram(), ...files };
  const parts = [];
  const put = (lba, bytes) => parts.push([lba, bytes]);
  const volume = Buffer.alloc(DATA);
  volume[0] = 1;
  volume.write('CD001', 1, 'latin1');
  volume[6] = 1;
  volume.write('PLAYSTATION'.padEnd(32), 8, 'latin1');
  volume.write('MADE UP DISC'.padEnd(32), 40, 'latin1');
  volume.writeUInt32LE(sectors, 80);
  volume.writeUInt32BE(sectors, 84);
  // the top folder's entry for itself, in the volume: at sector 22, one sector long
  const rootAt = 22;
  entry(volume, 156, '\0', rootAt, DATA, true);
  put(16, volume);
  const end = Buffer.alloc(DATA);
  end[0] = 255;
  end.write('CD001', 1, 'latin1');
  put(17, end);
  if (dvd) ['BEA01', 'NSR02', 'TEA01'].forEach((mark, i) => { const s = Buffer.alloc(DATA); s.write(mark, 1, 'latin1'); put(18 + i, s); });
  const folder = Buffer.alloc(DATA);
  let write = entry(folder, 0, '\0', rootAt, DATA, true);
  write += entry(folder, write, '\x01', rootAt, DATA, true);
  let next = 24;
  for (const [name, bytes] of Object.entries(all)) {
    const lba = at[name] ?? next;
    write += entry(folder, write, `${name};1`, lba, bytes.length, false);
    put(lba, bytes);
    next = Math.max(next, lba + Math.ceil(bytes.length / DATA));
  }
  put(rootAt, folder);
  const total = Math.max(sectors, next);
  if (path) {
    const fd = openSync(path, 'w');
    ftruncateSync(fd, total * DATA);
    for (const [lba, bytes] of parts) writeSync(fd, bytes, 0, bytes.length, lba * DATA);
    closeSync(fd);
    return { path, sectors: total, place(lba, bytes) { const f = openSync(path, 'r+'); writeSync(f, bytes, 0, bytes.length, lba * DATA); closeSync(f); } };
  }
  const image = Buffer.alloc(total * DATA);
  for (const [lba, bytes] of parts) bytes.copy(image, lba * DATA);
  return image;
}

// a folder's entry for a file or a folder; returns its length
function entry(bytes, at, name, lba, size, folder) {
  const length = 33 + name.length + (name.length % 2 ? 0 : 1);
  bytes[at] = length;
  bytes.writeUInt32LE(lba, at + 2);
  bytes.writeUInt32BE(lba, at + 6);
  bytes.writeUInt32LE(size, at + 10);
  bytes.writeUInt32BE(size, at + 14);
  bytes[at + 25] = folder ? 2 : 0;
  bytes[at + 32] = name.length;
  bytes.write(name, at + 33, 'latin1');
  return length;
}

/** The disc's 2048-byte sectors as raw ones, as a BIN keeps them: Mode 2 Form 1, as a PlayStation's CD is, or Mode 1. */
export function toRaw(iso, mode = 2) {
  const sectors = iso.length / DATA, raw = Buffer.alloc(sectors * RAW);
  for (let lba = 0; lba < sectors; lba++) {
    iso.copy(raw, lba * RAW + (mode === 1 ? 16 : 24), lba * DATA, (lba + 1) * DATA);
    makeSector(raw, lba, mode, { at: lba * RAW });
  }
  return raw;
}

/** Made-up sound for a CD's track of audio, `sectors` of it: two tones, as 16-bit samples, left and right. */
export function madeUpSound(sectors) {
  const bytes = Buffer.alloc(sectors * RAW);
  for (let i = 0; i < bytes.length / 4; i++) {
    bytes.writeInt16LE(Math.round(Math.sin(i / 20) * 8000 + Math.sin(i / 3) * 500), i * 4);
    bytes.writeInt16LE(Math.round(Math.cos(i / 31) * 6000), i * 4 + 2);
  }
  return bytes;
}

// --- writing bits, highest first, as a CHD's map and Huffman codes are read ------------------------------------------

class BitWriter {
  constructor() { this.bytes = []; this.acc = 0; this.count = 0; }
  write(value, n) {
    for (let i = n - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | (Math.floor(value / 2 ** i) & 1);
      if (++this.count === 8) { this.bytes.push(this.acc); this.acc = 0; this.count = 0; }
    }
  }
  done() { if (this.count) this.write(0, 8 - this.count); return Buffer.from(this.bytes); }
  /** The whole bytes written so far. */
  peekBytes() { return Buffer.from(this.bytes); }
}

// FLAC's two CRCs: of 8 bits over a frame's header, and of 16 over the whole frame
function crc8(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xFF : (crc << 1) & 0xFF;
  }
  return crc;
}
function crc16Flac(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x8005) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc;
}

// --- the codecs' simplest encoders -----------------------------------------------------------------------------------

/** LZMA with every byte a literal and no end mark, lc 3, lp 0, pb 2: a stream a CHD's reader must undo. */
export function lzmaLiterals(bytes) {
  const out = [];
  let low = 0, range = 0xFFFFFFFF, cache = 0, cacheSize = 1;
  const shiftLow = () => {
    if (low < 0xFF000000 || low >= 2 ** 32) {
      const carry = low >= 2 ** 32 ? 1 : 0;
      let temp = cache;
      do {
        out.push((temp + carry) & 0xFF);
        temp = 0xFF;
      } while (--cacheSize !== 0);
      cache = Math.floor(low / 2 ** 24) & 0xFF;
    }
    cacheSize++;
    low = (low % 2 ** 24) * 256;
  };
  const isMatch = new Uint16Array(12 * 16).fill(1024), literal = new Uint16Array(0x300 * 8).fill(1024);
  const bit = (p, i, b) => {
    const bound = (range >>> 11) * p[i];
    if (!b) { range = bound; p[i] += (2048 - p[i]) >>> 5; }
    else { low += bound; range = (range - bound) >>> 0; p[i] -= p[i] >>> 5; }
    while (range < 2 ** 24) { range = (range * 256) >>> 0; shiftLow(); }
  };
  let state = 0;
  for (let n = 0; n < bytes.length; n++) {
    bit(isMatch, state * 16 + (n & 3), 0);
    const base = 0x300 * ((n ? bytes[n - 1] : 0) >>> 5);
    let symbol = 1;
    for (let i = 7; i >= 0; i--) {
      const b = (bytes[n] >>> i) & 1;
      bit(literal, base + symbol, b);
      symbol = (symbol << 1) | b;
    }
    state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
  }
  for (let i = 0; i < 5; i++) shiftLow();
  return Buffer.from(out);
}

/** Huffman as a CHD's hunk keeps it: a code of one bit for the byte 0, eight for the byte 1 and nine for the rest, its
 *  tree written as chdman's reader reads it, in the small tree's codes 1 for a length of 1, 00 for 8 and 01 for 9. */
export function huffmanBytes(bytes) {
  const bits = new BitWriter();
  bits.write(0, 3);       // value 0 (a run): no code
  bits.write(1, 3);       // the rest start at value 2
  bits.write(1, 3);       // value 2 (a length of 1): one bit
  for (let v = 3; v <= 8; v++) bits.write(0, 3);
  bits.write(2, 3);       // value 9 (8): two bits
  bits.write(2, 3);       // value 10 (9): two bits
  bits.write(7, 3);       // and none after
  const lengths = Array.from({ length: 256 }, (_, v) => (v === 0 ? 1 : v === 1 ? 8 : 9));
  const small = { 1: [1, 1], 8: [0, 2], 9: [1, 2] };
  for (const length of lengths) bits.write(...small[length]);
  const codes = canonical(lengths);
  for (const byte of bytes) bits.write(codes[byte], lengths[byte]);
  return bits.done();
}

// each value's code from the lengths, as a CHD's reader works them out: the longest first
function canonical(lengths) {
  const histogram = new Array(33).fill(0), codes = [];
  for (const length of lengths) histogram[length]++;
  let start = 0;
  for (let length = 32; length > 0; length--) {
    const next = (start + histogram[length]) >> 1;
    histogram[length] = start;
    start = next;
  }
  for (const length of lengths) codes.push(length ? histogram[length]++ : 0);
  return codes;
}

/** FLAC frames of 16-bit stereo `samples` (4 bytes each, `bigEndian` or not), with no stream header, as a CHD keeps
 *  them: fixed predictors and LPC in turn, so a reader's every path is used. */
export function flacFrames(bytes, { bigEndian = false, block = 588 } = {}) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), count = bytes.length / 4;
  const chunks = [];
  for (let start = 0, frame = 0; start < count; start += block, frame++) {
    const n = Math.min(block, count - start), bits = new BitWriter();
    bits.write(0x3FFE, 14); bits.write(0, 2);
    bits.write(7, 4);           // the block's size in 16 bits after the frame's number
    bits.write(9, 4);           // 44.1 kHz
    bits.write(frame % 3 === 2 ? 8 : 1, 4);   // left and right, or left and side
    bits.write(4, 3);           // 16 bits
    bits.write(0, 1);
    bits.write(frame & 0x7F, 8);
    bits.write(n - 1, 16);
    bits.write(crc8(bits.peekBytes()), 8);
    const left = [], right = [];
    for (let i = 0; i < n; i++) {
      left.push(view.getInt16((start + i) * 4, !bigEndian));
      right.push(view.getInt16((start + i) * 4 + 2, !bigEndian));
    }
    const channels = frame % 3 === 2 ? [[left, 16], [left.map((l, i) => l - right[i]), 17]] : [[left, 16], [right, 16]];
    for (const [samples, width] of channels) subframe(bits, samples, width, frame % 2);
    const out = bits.done(), crc = Buffer.alloc(2);
    crc.writeUInt16BE(crc16Flac(out));
    chunks.push(out, crc);
  }
  return Buffer.concat(chunks);

  function subframe(bits, samples, width, lpc) {
    const order = Math.min(2, samples.length);
    bits.write(0, 1);
    bits.write(lpc ? 32 + order - 1 : 8 + order, 6);
    bits.write(0, 1);
    for (let i = 0; i < order; i++) bits.write(samples[i] < 0 ? samples[i] + 2 ** width : samples[i], width);
    if (lpc) {
      bits.write(14, 4);        // coefficients of 15 bits
      bits.write(1, 5);         // shifted by one
      for (const c of [4, -2].slice(0, order)) bits.write(c < 0 ? c + 2 ** 15 : c, 15);
    }
    // what the second-order prediction misses, in one partition of Rice codes with parameter 6
    bits.write(0, 2);
    bits.write(0, 4);
    bits.write(6, 4);
    for (let i = order; i < samples.length; i++) {
      const miss = samples[i] - (2 * samples[i - 1] - samples[i - 2]), folded = miss < 0 ? -2 * miss - 1 : 2 * miss;
      const high = Math.floor(folded / 64);
      bits.write(0, high);
      bits.write(1, 1);
      bits.write(folded & 63, 6);
    }
  }
}

/** LZ4's block format, its matches found greedily. */
export function lz4Block(bytes) {
  const out = [], seen = new Map();
  let anchor = 0, i = 0;
  const emit = (literals, matchLength, distance) => {
    const token = Math.min(literals.length, 15) << 4 | (matchLength ? Math.min(matchLength - 4, 15) : 0);
    out.push(token);
    if (literals.length >= 15) lengthBytes(literals.length - 15);
    out.push(...literals);
    if (matchLength) {
      out.push(distance & 0xFF, distance >> 8);
      if (matchLength - 4 >= 15) lengthBytes(matchLength - 4 - 15);
    }
  };
  const lengthBytes = n => { while (n >= 255) { out.push(255); n -= 255; } out.push(n); };
  while (i + 12 <= bytes.length) {
    const key = bytes.readUInt32LE(i), before = seen.get(key);
    seen.set(key, i);
    if (before !== undefined && i - before < 65536) {
      let n = 4;
      while (i + n + 5 < bytes.length && bytes[before + n] === bytes[i + n]) n++;
      emit([...bytes.subarray(anchor, i)], n, i - before);
      i += n;
      anchor = i;
    } else i++;
  }
  emit([...bytes.subarray(anchor)], 0, 0);
  return Buffer.from(out);
}

// --- the files ---------------------------------------------------------------------------------------------------

// the CRC of 16 bits a version 5 CHD checks its hunks and map with
function crc16(bytes) {
  let crc = 0xFFFF;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc;
}
const tag = text => Buffer.from(text, 'latin1').readUInt32BE(0);
const FRAME = 2448;

/**
 * A version 5 CHD of `data` (a Buffer), in hunks of `hunkBytes`, compressed in turn with each of `codecs` (chdman's
 * names: zlib, lzma, huff, flac, cdzl, cdlz, cdfl), a hunk the same as an earlier one kept as a reference to it, and
 * `metadata` ([tag, text]) after the hunks. A CD's `data` is its frames, 2448 bytes each.
 */
export function writeChd(data, { hunkBytes = 8 * FRAME, unitBytes = FRAME, codecs = ['cdlz', 'cdzl', 'cdfl'], metadata = [] } = {}) {
  const hunks = Math.ceil(data.length / hunkBytes);
  const header = Buffer.alloc(124);
  const pieces = [], entries = [], seen = new Map();
  let offset = 124;
  for (let n = 0; n < hunks; n++) {
    const hunk = Buffer.alloc(hunkBytes);
    data.copy(hunk, 0, n * hunkBytes, Math.min(data.length, (n + 1) * hunkBytes));
    const key = sha1(hunk).toString('hex');
    if (seen.has(key)) { entries.push({ type: 5, self: seen.get(key) }); continue; }
    seen.set(key, n);
    const slot = n % codecs.length, packed = compress(codecs[slot], hunk, hunkBytes);
    if (packed.length >= hunkBytes) {
      entries.push({ type: 4, offset, length: hunkBytes, crc: crc16(hunk) });
      pieces.push(hunk);
      offset += hunkBytes;
    } else {
      entries.push({ type: slot, offset, length: packed.length, crc: crc16(hunk) });
      pieces.push(packed);
      offset += packed.length;
    }
  }
  // the map: every kind four bits long, as a tree of runs gives it, then each hunk's length, CRC or reference
  const lengthBits = Math.max(1, Math.ceil(Math.log2(Math.max(...entries.map(e => e.length ?? 0), 1) + 1)));
  const selfBits = Math.max(1, Math.ceil(Math.log2(hunks + 1)));
  const bits = new BitWriter();
  for (let i = 0; i < 16; i++) bits.write(4, 4);
  for (const e of entries) bits.write(e.type, 4);
  const raw = Buffer.alloc(hunks * 12);
  entries.forEach((e, n) => {
    if (e.type <= 3) { bits.write(e.length, lengthBits); bits.write(e.crc, 16); }
    else if (e.type === 4) bits.write(e.crc, 16);
    else bits.write(e.self, selfBits);
    raw[n * 12] = e.type;
    raw.writeUIntBE(e.type <= 4 ? e.length : 0, n * 12 + 1, 3);
    raw.writeUIntBE(e.type <= 4 ? e.offset : e.self, n * 12 + 4, 6);
    raw.writeUInt16BE(e.type <= 4 ? e.crc : 0, n * 12 + 10);
  });
  const mapBits = bits.done(), mapHead = Buffer.alloc(16);
  mapHead.writeUInt32BE(mapBits.length, 0);
  mapHead.writeUIntBE(124, 4, 6);
  mapHead.writeUInt16BE(crc16(raw), 10);
  mapHead[12] = lengthBits;
  mapHead[13] = selfBits;
  mapHead[14] = 0;
  const mapOffset = offset;
  offset += 16 + mapBits.length;
  const metaOffset = metadata.length ? offset : 0, metas = [];
  metadata.forEach(([name, words], i) => {
    const bytes = Buffer.from(`${words}\0`, 'latin1'), entryHead = Buffer.alloc(16);
    entryHead.writeUInt32BE(tag(name), 0);
    entryHead[4] = 1;
    entryHead.writeUIntBE(bytes.length, 5, 3);
    const next = i + 1 < metadata.length ? offset + 16 + bytes.length : 0;
    entryHead.writeUIntBE(next, 10, 6);
    metas.push(entryHead, bytes);
    offset += 16 + bytes.length;
  });
  header.write('MComprHD', 0, 'latin1');
  header.writeUInt32BE(124, 8);
  header.writeUInt32BE(5, 12);
  codecs.forEach((name, i) => header.writeUInt32BE(tag(name), 16 + i * 4));
  header.writeBigUInt64BE(BigInt(data.length), 32);
  header.writeBigUInt64BE(BigInt(mapOffset), 40);
  header.writeBigUInt64BE(BigInt(metaOffset), 48);
  header.writeUInt32BE(hunkBytes, 56);
  header.writeUInt32BE(unitBytes, 60);
  sha1(data).copy(header, 64);
  sha1(data).copy(header, 84);
  // how many hunks each way of keeping them took, for a test to be sure it tried every one
  const used = {};
  for (const e of entries) {
    const name = e.type <= 3 ? codecs[e.type] : e.type === 4 ? 'none' : 'self';
    used[name] = (used[name] ?? 0) + 1;
  }
  return Object.assign(Buffer.concat([header, ...pieces, mapHead, mapBits, ...metas]), { used });
}

function compress(codec, hunk, hunkBytes) {
  if (codec === 'zlib') return deflateRawSync(hunk);
  if (codec === 'lzma') return lzmaLiterals(hunk);
  if (codec === 'huff') return huffmanBytes(hunk);
  if (codec === 'flac') return Buffer.concat([Buffer.from('L'), flacFrames(hunk)]);
  // a CD's: its sectors, with sync and ECC left out where they can be made again, then its subchannel
  const frames = hunkBytes / FRAME, sectors = Buffer.alloc(frames * RAW), subcode = Buffer.alloc(frames * 96), flags = Buffer.alloc((frames + 7) >> 3);
  for (let f = 0; f < frames; f++) {
    hunk.copy(sectors, f * RAW, f * FRAME, f * FRAME + RAW);
    hunk.copy(subcode, f * 96, f * FRAME + RAW, (f + 1) * FRAME);
    const sector = sectors.subarray(f * RAW, (f + 1) * RAW), again = Buffer.from(sector);
    if (codec !== 'cdfl' && again[0] === 0 && again[1] === 0xFF && (again[15] === 1 || again[15] === 2)) {
      makeSector(again, 0, again[15]);
      // ECC that comes out the same when made again is left out, and its frame marked
      const same = again.subarray(0x81C, 0x930).equals(sector.subarray(0x81C, 0x930));
      if (same) { sector.fill(0, 0, 12); sector.fill(0, 0x81C, 0x930); flags[f >> 3] |= 1 << (f & 7); }
    }
  }
  if (codec === 'cdfl') return Buffer.concat([flacFrames(sectors, { bigEndian: true }), deflateRawSync(subcode)]);
  const base = codec === 'cdlz' ? lzmaLiterals(sectors) : deflateRawSync(sectors);
  const length = Buffer.alloc(hunkBytes < 65536 ? 2 : 3);
  length.writeUIntBE(base.length, 0, length.length);
  return Buffer.concat([flags, length, base, deflateRawSync(subcode)]);
}

/** A version 4 CHD of `data`, as older chdman made them: hunks deflated, kept as they are, eight bytes repeated, or
 *  the same as an earlier one, in turn, its map 16 bytes a hunk, then the cookie that ends it. */
export function writeChdV4(data, { hunkBytes = 4096, metadata = [] } = {}) {
  const hunks = Math.ceil(data.length / hunkBytes), mapAt = 108, map = Buffer.alloc(hunks * 16 + 16), pieces = [], seen = new Map();
  let offset = mapAt + map.length;
  for (let n = 0; n < hunks; n++) {
    const hunk = Buffer.alloc(hunkBytes), e = n * 16;
    data.copy(hunk, 0, n * hunkBytes, Math.min(data.length, (n + 1) * hunkBytes));
    const key = sha1(hunk).toString('hex'), crc = zlibCrc32(hunk);
    map.writeUInt32BE(crc, e + 8);
    const eight = hunk.subarray(0, 8), repeats = hunk.every((byte, i) => byte === eight[i % 8]);
    if (seen.has(key)) { map.writeBigUInt64BE(BigInt(seen.get(key)), e); map[e + 15] = 4; continue; }
    seen.set(key, n);
    if (repeats) { eight.copy(map, e); map[e + 15] = 3; continue; }
    const deflated = n % 2 ? hunk : deflateRawSync(hunk), packed = deflated.length < hunkBytes ? deflated : hunk;
    map.writeBigUInt64BE(BigInt(offset), e);
    map.writeUInt16BE(packed.length & 0xFFFF, e + 12);
    map[e + 14] = packed.length >>> 16;
    map[e + 15] = packed === hunk ? 2 : 1;
    pieces.push(packed);
    offset += packed.length;
  }
  map.write('EndOfListCookie\0', hunks * 16, 'latin1');
  const metaOffset = metadata.length ? offset : 0, metas = [];
  metadata.forEach(([name, words], i) => {
    const bytes = Buffer.from(`${words}\0`, 'latin1'), entryHead = Buffer.alloc(16);
    entryHead.writeUInt32BE(tag(name), 0);
    entryHead.writeUIntBE(bytes.length, 5, 3);
    entryHead.writeUIntBE(i + 1 < metadata.length ? offset + 16 + bytes.length : 0, 10, 6);
    metas.push(entryHead, bytes);
    offset += 16 + bytes.length;
  });
  const header = Buffer.alloc(108);
  header.write('MComprHD', 0, 'latin1');
  header.writeUInt32BE(108, 8);
  header.writeUInt32BE(4, 12);
  header.writeUInt32BE(1, 20);
  header.writeUInt32BE(hunks, 24);
  header.writeBigUInt64BE(BigInt(data.length), 28);
  header.writeBigUInt64BE(BigInt(metaOffset), 36);
  header.writeUInt32BE(hunkBytes, 44);
  sha1(data).copy(header, 48);
  sha1(data).copy(header, 88);
  return Buffer.concat([header, map, ...pieces, ...metas]);
}

/** A CD as a CHD keeps it: each track's sectors as frames with no subchannel, padded to four frames, and its CHT2. */
export function cdFrames(tracks) {
  const frames = [], metadata = [];
  tracks.forEach(({ type, sectors, pregap = 0 }, i) => {
    const count = sectors.length / RAW;
    for (let s = 0; s < count; s++) {
      const frame = Buffer.alloc(FRAME);
      const sector = sectors.subarray(s * RAW, (s + 1) * RAW);
      // a CHD keeps a CD's sound with each sample's bytes the other way round
      if (type === 'AUDIO') for (let b = 0; b < RAW; b += 2) { frame[b] = sector[b + 1]; frame[b + 1] = sector[b]; }
      else sector.copy(frame);
      frames.push(frame);
    }
    for (let pad = count; pad % 4; pad++) frames.push(Buffer.alloc(FRAME));
    metadata.push(['CHT2', `TRACK:${i + 1} TYPE:${type} SUBTYPE:NONE FRAMES:${count} PREGAP:${pregap} PGTYPE:${pregap ? 'VAUDIO' : 'MODE1'} PGSUB:RW POSTGAP:0`]);
  });
  return { data: Buffer.concat(frames), metadata };
}

/** A CSO of version 1 or 2, or a ZSO, of `iso`, in blocks of `blockSize`, aligned to 2 ** `align` bytes. In version 2
 *  blocks are deflated and LZ4'd in turn; a block that wouldn't shrink is kept as it is. */
export function writeCso(iso, { format = 'cso', version = 1, blockSize = DATA, align = 0 } = {}) {
  const blocks = Math.ceil(iso.length / blockSize), index = Buffer.alloc((blocks + 1) * 4), header = Buffer.alloc(24);
  header.write(format === 'zso' ? 'ZISO' : 'CISO', 0, 'latin1');
  header.writeUInt32LE(24, 4);
  header.writeBigUInt64LE(BigInt(iso.length), 8);
  header.writeUInt32LE(blockSize, 16);
  header[20] = format === 'zso' ? 1 : version;
  header[21] = align;
  const pieces = [];
  let offset = 24 + index.length;
  const pad = () => { const extra = (2 ** align - (offset % 2 ** align)) % 2 ** align; if (extra) { pieces.push(Buffer.alloc(extra)); offset += extra; } };
  pad();
  for (let n = 0; n < blocks; n++) {
    const block = iso.subarray(n * blockSize, Math.min(iso.length, (n + 1) * blockSize));
    const lz4 = format === 'zso' || (version === 2 && n % 2);
    const packed = lz4 ? lz4Block(block) : deflateRawSync(block);
    const plain = packed.length >= block.length;
    // in version 1 and a ZSO the top bit marks a block kept as it is; in version 2 it marks LZ4, and size marks plain
    const top = version === 2 && format === 'cso' ? (lz4 && !plain) : plain;
    index.writeUInt32LE(((offset / 2 ** align) | (top ? 0x80000000 : 0)) >>> 0, n * 4);
    const bytes = plain ? (version === 2 && format === 'cso' ? Buffer.concat([block, Buffer.alloc(blockSize - block.length)]) : block) : packed;
    pieces.push(bytes);
    offset += bytes.length;
    pad();
  }
  index.writeUInt32LE(offset / 2 ** align, blocks * 4);
  return Buffer.concat([header, index, ...pieces]);
}
