// A CHD, MAME's compressed disc (versions 3, 4 and 5), read a hunk at a time: its header, its map of where each hunk
// is and how it's kept, and what it says of the disc it holds. Each hunk is a run of the disc's bytes, compressed by one
// of up to four codecs the header names: zlib, LZMA, Huffman, FLAC and zstd, and their CD forms, which keep a CD's
// sectors apart from their subchannel and leave out sync and ECC that can be made again (cd.js). Written from MAME's
// chd.cpp as libchdr (BSD-3-Clause) reads it; nothing of either is copied here.

import { Bits, Huffman } from './huffman.js';
import { lzmaDecode } from './lzma.js';
import { flacDecode } from './flac.js';
import { inflateRaw } from './inflate.js';
import { makeSyncAndEcc } from './cd.js';

const tag = text => [...text].reduce((value, c) => value * 256 + c.charCodeAt(0), 0);
const ZLIB = tag('zlib'), LZMA = tag('lzma'), HUFF = tag('huff'), FLAC = tag('flac'), ZSTD = tag('zstd');
const CD_ZLIB = tag('cdzl'), CD_LZMA = tag('cdlz'), CD_FLAC = tag('cdfl'), CD_ZSTD = tag('cdzs');
const NAMES = { [ZLIB]: 'zlib', [LZMA]: 'LZMA', [HUFF]: 'Huffman', [FLAC]: 'FLAC', [ZSTD]: 'zstd', [CD_ZLIB]: 'CD zlib', [CD_LZMA]: 'CD LZMA', [CD_FLAC]: 'CD FLAC', [CD_ZSTD]: 'CD zstd' };

/** A CD frame in a CHD: a sector's 2352 bytes and its 96 of subchannel. */
export const FRAME = 2448;
const SECTOR = 2352, SUBCODE = 96;

const u16 = (b, at) => b[at] << 8 | b[at + 1];
const u24 = (b, at) => b[at] << 16 | b[at + 1] << 8 | b[at + 2];
const u32 = (b, at) => (b[at] << 24 | b[at + 1] << 16 | b[at + 2] << 8 | b[at + 3]) >>> 0;
const u48 = (b, at) => u16(b, at) * 2 ** 32 + u32(b, at + 2);
const u64 = (b, at) => u32(b, at) * 2 ** 32 + u32(b, at + 4);
const hex = (b, at, n) => [...b.subarray(at, at + n)].map(x => x.toString(16).padStart(2, '0')).join('');

// the CRC of 16 bits each hunk of a version 5 CHD is checked by, and its map
const CRC16 = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
  let crc = i << 8;
  for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
  CRC16[i] = crc & 0xFFFF;
}
const crc16 = bytes => {
  let crc = 0xFFFF;
  for (let i = 0; i < bytes.length; i++) crc = ((crc << 8) ^ CRC16[((crc >> 8) ^ bytes[i]) & 0xFF]) & 0xFFFF;
  return crc;
};

/** Whether these first bytes are a CHD's. */
export const isChd = head => head.length >= 8 && String.fromCharCode(...head.subarray(0, 8)) === 'MComprHD';

/**
 * Opens the CHD `source` ({ size, read(at, length) }, copy.js) and resolves to { version, hunkBytes, unitBytes,
 * logicalBytes, hunks, sha1, rawSha1, metadata, hunk(n) }: `metadata` is each entry's tag and bytes, and `hunk(n)`
 * resolves to hunk n's bytes. `zstd`, when given, undoes zstd, which a browser can't. A CHD that needs a parent, a
 * second CHD it was made as changes to, can't be read alone.
 */
export async function openChd(source, { zstd = null, inflate = inflateRaw } = {}) {
  const head = await source.read(0, 124);
  if (!isChd(head)) throw new Error("This isn't a CHD.");
  const version = u32(head, 12);
  let header;
  if (version === 5) {
    header = {
      codecs: [0, 1, 2, 3].map(i => u32(head, 16 + i * 4)),
      logicalBytes: u64(head, 32), mapOffset: u64(head, 40), metaOffset: u64(head, 48),
      hunkBytes: u32(head, 56), unitBytes: u32(head, 60), rawSha1: hex(head, 64, 20), sha1: hex(head, 84, 20), parent: hex(head, 104, 20),
    };
  } else if (version === 3 || version === 4) {
    header = {
      flags: u32(head, 16), compression: u32(head, 20), hunkCount: u32(head, 24), logicalBytes: u64(head, 28),
      metaOffset: u64(head, 36), hunkBytes: version === 3 ? u32(head, 76) : u32(head, 44),
      sha1: version === 3 ? hex(head, 80, 20) : hex(head, 48, 20), rawSha1: version === 4 ? hex(head, 88, 20) : null,
      mapOffset: version === 3 ? 120 : 108,
    };
    header.unitBytes = header.hunkBytes;
    if (header.flags & 1) header.parent = 'yes';
  } else throw new Error(`This is a CHD of version ${version}, which the tools can't read: version 3, 4 or 5 can be read.`);
  if (header.parent && !/^0*$/.test(header.parent)) throw new Error('This CHD holds only changes to another one, its parent, so it can\'t be read alone.');
  const { hunkBytes, logicalBytes } = header;
  if (!hunkBytes) throw new Error('This CHD has no hunk size.');
  const hunks = version === 5 ? Math.ceil(logicalBytes / hunkBytes) : header.hunkCount;

  // each hunk's way of being kept, where, how long, and its CRC
  const map = { type: new Uint8Array(hunks), offset: new Float64Array(hunks), length: new Uint32Array(hunks), crc: new Uint32Array(hunks) };
  if (version === 5) await readMapV5(source, header, hunks, map);
  else {
    // an older map's entries as they are, as one that repeats eight bytes keeps them where the place would be
    const bytes = map.raw = await source.read(header.mapOffset, hunks * 16);
    for (let n = 0; n < hunks; n++) {
      const e = n * 16;
      map.offset[n] = u64(bytes, e);
      map.crc[n] = u32(bytes, e + 8);
      map.length[n] = u16(bytes, e + 12) | bytes[e + 14] << 16;
      map.type[n] = bytes[e + 15] & 15;
    }
  }

  const metadata = [];
  for (let at = header.metaOffset; at;) {
    const entry = await source.read(at, 16);
    const length = u24(entry, 5);
    metadata.push({ tag: String.fromCharCode(...entry.subarray(0, 4)), data: await source.read(at + 16, length) });
    at = u64(entry, 8);
  }

  const decoders = header.codecs?.map(codec => decoder(codec, hunkBytes, { zstd, inflate }));
  const cache = new Map();
  async function hunk(n, depth = 0) {
    if (n < 0 || n >= hunks) throw new Error(`The CHD has no hunk ${n}.`);
    const kept = cache.get(n);
    if (kept) {
      cache.delete(n);
      cache.set(n, kept);
      return kept;
    }
    const bytes = await read(n, depth);
    cache.set(n, bytes);
    if (cache.size > 16) cache.delete(cache.keys().next().value);
    return bytes;
  }
  async function read(n, depth) {
    const type = map.type[n], offset = map.offset[n], length = map.length[n];
    if (version === 5) {
      if (!header.codecs[0]) {
        // a CHD with no codec: each hunk where the map says, or zeros
        return offset ? source.read(offset, hunkBytes) : new Uint8Array(hunkBytes);
      }
      if (type <= 3) {
        if (!header.codecs[type]) throw new Error(`The CHD's hunk ${n} uses a codec it doesn't name.`);
        const out = decoders[type](await source.read(offset, length));
        if (crc16(out) !== map.crc[n]) throw new Error(`The CHD's hunk ${n} isn't what it was when it was made.`);
        return out;
      }
      if (type === 4) {
        const out = await source.read(offset, hunkBytes);
        if (crc16(out) !== map.crc[n]) throw new Error(`The CHD's hunk ${n} isn't what it was when it was made.`);
        return out;
      }
      if (type === 5 && depth < 8) return (await hunk(offset, depth + 1)).slice();
      throw new Error(`The CHD's hunk ${n} needs a parent CHD.`);
    }
    // versions 3 and 4: compressed with zlib, or not, or eight bytes again and again, or another hunk's
    if (type === 1) {
      if (header.compression !== 1 && header.compression !== 2) throw new Error('This CHD is compressed with a codec the tools can\'t read.');
      return inflate(await source.read(offset, length), hunkBytes);
    }
    if (type === 2) return source.read(offset, hunkBytes);
    if (type === 3) {
      const out = new Uint8Array(hunkBytes), eight = map.raw.subarray(n * 16, n * 16 + 8);
      for (let at = 0; at < hunkBytes; at += 8) out.set(eight.subarray(0, Math.min(8, hunkBytes - at)), at);
      return out;
    }
    if (type === 4 && depth < 8) return (await hunk(offset, depth + 1)).slice();
    throw new Error(`The CHD's hunk ${n} is of a kind the tools can't read.`);
  }

  return {
    version, hunkBytes, unitBytes: header.unitBytes, logicalBytes, hunks, sha1: header.sha1, rawSha1: header.rawSha1, metadata,
    codecs: (header.codecs ?? []).filter(Boolean).map(codec => NAMES[codec] ?? tagName(codec)),
    hunk: n => hunk(n),
  };
}

const tagName = codec => String.fromCharCode(codec >>> 24, (codec >>> 16) & 0xFF, (codec >>> 8) & 0xFF, codec & 0xFF);

// a version 5 CHD's map, compressed: each hunk's kind in Huffman codes with runs, then each one's length, place and CRC
async function readMapV5(source, header, hunks, map) {
  if (!header.codecs[0]) {
    const bytes = await source.read(header.mapOffset, hunks * 4);
    for (let n = 0; n < hunks; n++) map.offset[n] = u32(bytes, n * 4) * header.hunkBytes;
    return;
  }
  const top = await source.read(header.mapOffset, 16);
  const mapBytes = u32(top, 0), first = u48(top, 4), mapCrc = u16(top, 10), lengthBits = top[12], selfBits = top[13], parentBits = top[14];
  const bits = new Bits(await source.read(header.mapOffset + 16, mapBytes));
  const kinds = new Huffman(16, 8);
  kinds.readRle(bits);
  const RLE_SMALL = 7, RLE_LARGE = 8, SELF_0 = 9, SELF_1 = 10, PARENT_SELF = 11, PARENT_0 = 12, PARENT_1 = 13;
  let repeat = 0, last = 0;
  for (let n = 0; n < hunks; n++) {
    if (repeat > 0) { map.type[n] = last; repeat--; continue; }
    const kind = kinds.decode(bits);
    if (kind === RLE_SMALL) { map.type[n] = last; repeat = 2 + kinds.decode(bits); }
    else if (kind === RLE_LARGE) { map.type[n] = last; repeat = 2 + 16 + (kinds.decode(bits) << 4); repeat += kinds.decode(bits); }
    else map.type[n] = last = kind;
  }
  // and the map as chdman checks it: 12 bytes a hunk, its kind, length, place and CRC, big-endian
  const raw = new Uint8Array(hunks * 12);
  let at = first, lastSelf = 0, lastParent = 0;
  for (let n = 0; n < hunks; n++) {
    let offset = at, length = 0, crc = 0;
    switch (map.type[n]) {
      case 0: case 1: case 2: case 3:
        length = bits.read(lengthBits);
        at += length;
        crc = bits.read(16);
        break;
      case 4:
        length = header.hunkBytes;
        at += length;
        crc = bits.read(16);
        break;
      case 5:
        offset = lastSelf = bits.read(selfBits);
        break;
      case 6:
        offset = lastParent = bits.read(parentBits);
        break;
      case SELF_1:
        lastSelf++;
      // falls through
      case SELF_0:
        map.type[n] = 5;
        offset = lastSelf;
        break;
      case PARENT_SELF:
        map.type[n] = 6;
        offset = lastParent = n * header.hunkBytes / header.unitBytes;
        break;
      case PARENT_1:
        lastParent += header.hunkBytes / header.unitBytes;
      // falls through
      case PARENT_0:
        map.type[n] = 6;
        offset = lastParent;
        break;
      default:
        throw new Error("The CHD's map names a kind of hunk that doesn't exist.");
    }
    map.offset[n] = offset;
    map.length[n] = length;
    map.crc[n] = crc;
    const e = n * 12;
    raw[e] = map.type[n];
    raw[e + 1] = length >>> 16; raw[e + 2] = length >>> 8; raw[e + 3] = length;
    for (let i = 0; i < 6; i++) raw[e + 4 + i] = Math.floor(offset / 2 ** (40 - i * 8)) & 0xFF;
    raw[e + 10] = crc >>> 8; raw[e + 11] = crc;
  }
  if (bits.over || crc16(raw) !== mapCrc) throw new Error("The CHD's map isn't what it was when it was made.");
}

// the LZMA properties chdman's encoder sets for a hunk of `bytes`: only lc, lp and pb matter to a reader
const LZMA_PROPERTIES = { lc: 3, lp: 0, pb: 2 };

// how a codec's hunk is undone, as a function from its compressed bytes to the hunk's
function decoder(codec, hunkBytes, { zstd, inflate }) {
  if (!codec) return null;
  const frames = hunkBytes / FRAME;
  let huffman = null;
  const plain = {
    [ZLIB]: (bytes, size) => inflate(bytes, size),
    [LZMA]: (bytes, size) => lzmaDecode(bytes, size, LZMA_PROPERTIES),
    [ZSTD]: (bytes, size) => {
      if (!zstd) throw new Error('This CHD is compressed with zstd, which this browser can\'t undo. chdman can make it again with the usual codecs: chdman copy -c cdlz,cdzl,cdfl.');
      return zstd(bytes, size);
    },
    [HUFF]: (bytes, size) => {
      const bits = new Bits(bytes), code = huffman ??= new Huffman(256, 16), out = new Uint8Array(size);
      code.readHuffman(bits);
      for (let i = 0; i < size; i++) out[i] = code.decode(bits);
      if (bits.over) throw new Error('A Huffman hunk in the CHD ends early.');
      return out;
    },
    [FLAC]: (bytes, size) => {
      if (bytes[0] !== 0x4C && bytes[0] !== 0x42) throw new Error('A FLAC hunk in the CHD says neither byte order.');
      const out = new Uint8Array(size);
      flacDecode(bytes, size / 4, out, { at: 1, bigEndian: bytes[0] === 0x42 });
      return out;
    },
  };
  if (plain[codec]) return bytes => plain[codec](bytes, hunkBytes);
  const base = { [CD_ZLIB]: plain[ZLIB], [CD_LZMA]: plain[LZMA], [CD_ZSTD]: plain[ZSTD] }[codec];
  if (!base && codec !== CD_FLAC) throw new Error(`This CHD is compressed with ${tagName(codec)}, which the tools can't read.`);
  if (!Number.isInteger(frames)) throw new Error('This CHD keeps a CD in hunks that aren\'t whole frames.');
  // a CD codec: which frames lost their sync and ECC, how long the sectors' part is, the sectors, then the subchannel
  return bytes => {
    const out = new Uint8Array(hunkBytes);
    let sectors, subcode;
    if (codec === CD_FLAC) {
      sectors = new Uint8Array(frames * SECTOR);
      const end = flacDecode(bytes, frames * SECTOR / 4, sectors, { bigEndian: true });
      subcode = inflate(bytes.subarray(end), frames * SUBCODE);
    } else {
      const eccBytes = (frames + 7) >> 3, lengthBytes = hunkBytes < 65536 ? 2 : 3;
      let baseLength = u16(bytes, eccBytes);
      if (lengthBytes > 2) baseLength = baseLength * 256 + bytes[eccBytes + 2];
      const start = eccBytes + lengthBytes;
      sectors = base(bytes.subarray(start, start + baseLength), frames * SECTOR);
      subcode = codec === CD_ZSTD ? zstd(bytes.subarray(start + baseLength), frames * SUBCODE) : inflate(bytes.subarray(start + baseLength), frames * SUBCODE);
      for (let f = 0; f < frames; f++) if (bytes[f >> 3] & (1 << (f & 7))) makeSyncAndEcc(sectors, f * SECTOR);
    }
    for (let f = 0; f < frames; f++) {
      out.set(sectors.subarray(f * SECTOR, (f + 1) * SECTOR), f * FRAME);
      out.set(subcode.subarray(f * SUBCODE, (f + 1) * SUBCODE), f * FRAME + SECTOR);
    }
    return out;
  };
}

/**
 * A CD's tracks as the CHD's metadata gives them (CHT2, or CHTR in older ones), each { number, type, dataSize, frames,
 * pregap, pregapStored, postgap }: `type` as chdman names it (MODE1, MODE1_RAW, MODE2_FORM1, AUDIO…), `dataSize` the bytes
 * of each frame it keeps, and `frames` how many it keeps, a stored pregap among them. Or null for a CHD that isn't a CD.
 */
export function chdTracks(chd) {
  const text = data => String.fromCharCode(...data).replace(/\0.*$/s, '');
  const tracks = [];
  for (const { tag: name, data } of chd.metadata) {
    if (name !== 'CHT2' && name !== 'CHTR') continue;
    const fields = Object.fromEntries(text(data).trim().split(/\s+/).map(word => word.split(':')));
    const type = fields.TYPE;
    tracks.push({
      number: Number(fields.TRACK), type, dataSize: DATA_SIZE[type] ?? 2352, frames: Number(fields.FRAMES),
      pregap: Number(fields.PREGAP ?? 0), pregapStored: (fields.PGTYPE ?? '').startsWith('V'), postgap: Number(fields.POSTGAP ?? 0),
    });
  }
  return tracks.length ? tracks.sort((a, b) => a.number - b.number) : null;
}
const DATA_SIZE = { MODE1: 2048, MODE1_RAW: 2352, MODE2: 2336, MODE2_FORM1: 2048, MODE2_FORM2: 2324, MODE2_FORM_MIX: 2336, MODE2_RAW: 2352, AUDIO: 2352 };
