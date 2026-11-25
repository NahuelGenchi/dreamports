// A player's disc, whatever file it comes in, read a few sectors at a time as a game asks for them, so a disc of
// several gigabytes never has to be in memory: an ISO, a BIN with or without its .cue, a CHD, a CSO or ZSO, or a GameCube
// disc (an ISO or a GCM, gcm.js). Each
// gives the same disc: its tracks, its sectors as the console's drive reads them, and the data on them. The page reads
// it from the file the player chose, and the tools from the file on their computer (copy.js has both).
//
// Sectors are counted as a drive counts them, from 0 at 00:02:00. A CD's sector is 2352 bytes as the drive reads it
// whole, and a DVD's or a UMD's 2048.

import { DATA, RAW, makeSector, msf } from './cd.js';
import { FRAME, chdTracks, isChd, openChd } from './chd.js';
import { isCso, openCso } from './cso.js';
import { isGcm } from './gcm.js';

/** How many sectors a single-layer DVD holds: a disc with more has two layers. */
export const DVD_LAYER = 2295104;

const text = bytes => String.fromCharCode(...bytes);
const has = (bytes, at, words) => text(bytes.subarray(at, at + words.length)) === words;
const SYNC = [0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00];
const hasSync = (bytes, at = 0) => SYNC.every((byte, i) => bytes[at + i] === byte);

// the sectors of a .cue's kinds of track, as its file keeps them, and what kind of track each is
const CUE_TRACKS = {
  'MODE1/2048': [2048, 'mode1'], 'MODE1/2352': [2352, 'mode1'], 'MODE2/2048': [2048, 'mode2'], 'MODE2/2324': [2324, 'mode2'],
  'MODE2/2336': [2336, 'mode2'], 'MODE2/2352': [2352, 'mode2'], 'CDI/2336': [2336, 'mode2'], 'CDI/2352': [2352, 'mode2'], AUDIO: [2352, 'audio'],
};
const time = words => {
  const [m, s, f] = words.split(':').map(Number);
  return (m * 60 + s) * 75 + f;
};

/**
 * Opens the disc in `source` ({ name, size, read(at, length) }, copy.js) and resolves to it, or to null when the file
 * isn't one. `open(name)` gives another file beside it, by name, for the tracks a .cue names. `zstd` undoes zstd where
 * the host can (chd.js), and `inflate` deflate. The disc is { format, kind, sectors, layerBreak, tracks, read(lba,
 * count), data(lba, count), image(), files }:
 * - `kind` is 'cd' or 'dvd' (a UMD is read as a DVD is), and `sectors` how many it has, a CD's lead-out
 * - `layerBreak` is where a DVD's second layer starts, or 0
 * - `tracks` are { number, type, first, pregap, sectors }: `type` 'mode1', 'mode2' or 'audio', `first` its index 1,
 *   `pregap` the sectors of its own before that, and `sectors` how many from its index 1 to the next track's pregap
 * - `read` resolves to `count` sectors from `lba` as the drive reads them, 2352 bytes each on a CD, 2048 on a DVD, with
 *   what the file leaves out of a CD's sectors made again (cd.js), and `data` to the 2048 bytes of data of each
 * - `image()` gives the copy's bytes, as the image it was made from holds them, as { track, bytes } pieces in order:
 *   the file's own bytes for an ISO, a BIN or a .cue's files (each file a track), and for a CHD or a CSO the ISO or the
 *   tracks they were made from, so a copy's SHA-1 is the same in any of them
 * - `files` names the files it reads, the .cue's tracks for a .cue
 * - `whole` says the file keeps every sector as the drive reads it, or can make it again exactly: false for an ISO of
 *   a PlayStation's CD, which has lost each sector's subheader
 */
export async function openDisc(source, { open = null, zstd = null, inflate } = {}) {
  const head = await source.read(0, 0x9400);
  if (isChd(head)) return chdDisc(source, { zstd, inflate });
  if (isCso(head)) {
    const cso = await openCso(source, { inflate });
    return sectorDisc(cso.format, cso, { files: [source.name] });
  }
  if (looksLikeCue(head)) return cueDisc(source, open);
  // a GameCube disc, which has its own file system in place of a volume (gcm.js): its data, 2048 bytes a sector
  if (isGcm(head)) return plainDisc('gcm', source, { files: [source.name] });
  // a BIN: raw sectors, the mode in the first one's header, or where its volume is
  const mode = hasSync(head) && (head[15] === 1 || head[15] === 2) ? head[15] : has(head, 16 * RAW + 25, 'CD001') ? 2 : has(head, 16 * RAW + 17, 'CD001') ? 1 : 0;
  if (mode) {
    const sectors = Math.floor(source.size / RAW);
    return cdDisc('bin', [track(1, mode === 1 ? 'mode1' : 'mode2', 0, 0, sectors, [extent(0, sectors, RAW, source, 0)])], { files: [source.name], image: fileImage([source]) });
  }
  if (has(head, 0x8001, 'CD001')) return sectorDisc('iso', source, { files: [source.name] });
  return null;
}

const looksLikeCue = head => {
  const words = text(head.subarray(0, Math.min(head.length, 4096)));
  return !/[\0-\x08\x0E-\x1F]/.test(words) && /^\s*FILE\s/im.test(words) && /^\s*TRACK\s+\d+/im.test(words);
};

function track(number, type, start, pregap, sectors, extents) {
  return { number, type, first: start + pregap, pregap, sectors, extents };
}
// `count` sectors from `lba` kept `size` bytes each in `source`, from byte `at`, or nothing (silence, or empty data)
function extent(lba, count, size, source, at, { swap = false } = {}) {
  return { lba, count, size, swap, fetch: source && ((from, n) => source.read(at + from * size, n * size)) };
}

// an ISO, or a disc in 2048-byte sectors as a CSO or a CHD of a DVD holds it: one track of data
async function sectorDisc(format, source, { files, image = fileImage([source]) }) {
  const sectors = Math.floor(source.size / DATA);
  const read = (lba, count) => source.read(lba * DATA, count * DATA);
  const volume = await read(16, 1);
  const system = text(volume.subarray(8, 40)).trim();
  // a DVD has the UDF's marks after its volume, as every PlayStation 2 DVD does; a UMD is read as a DVD is
  let dvd = sectors > 400000 || system.startsWith('PSP');
  for (let lba = 17; !dvd && lba < 32; lba++) {
    const mark = text((await read(lba, 1)).subarray(1, 6));
    if (mark === 'BEA01' || mark.startsWith('NSR0')) dvd = true;
    else if (!['CD001', 'TEA01', 'BOOT2', 'CDW02'].includes(mark)) break;
  }
  if (!dvd) {
    // a CD kept as its data only: a PlayStation's in Mode 2 Form 1, any other in Mode 1
    const type = system.startsWith('PLAYSTATION') ? 'mode2' : 'mode1';
    return cdDisc(format, [track(1, type, 0, 0, sectors, [extent(0, sectors, DATA, source, 0)])], { files, image });
  }
  // two layers: the first's volume ends where the second's volume descriptor is, 16 sectors on
  let layerBreak = 0;
  if (sectors > DVD_LAYER) {
    const volumeSectors = volume[80] | volume[81] << 8 | volume[82] << 16 | volume[83] * 2 ** 24;
    const second = volumeSectors - 16;
    if (second > 0 && second + 16 < sectors && has(await read(second + 16, 1), 1, 'CD001')) layerBreak = second;
  }
  return {
    format, kind: 'dvd', sectors, layerBreak, files, whole: true,
    tracks: [{ number: 1, type: 'mode1', first: 0, pregap: 0, sectors }],
    read: (lba, count) => read(lba, clamp(lba, count, sectors)),
    data: (lba, count) => read(lba, clamp(lba, count, sectors)),
    image,
  };
}
// a disc of one track of data in 2048-byte sectors with nothing more to tell of it, read as a DVD is
function plainDisc(format, source, { files, image = fileImage([source]) }) {
  const sectors = Math.ceil(source.size / DATA);
  const read = async (lba, count) => {
    const wanted = clamp(lba, count, sectors) * DATA, bytes = await source.read(lba * DATA, wanted);
    // a file that ends partway through a sector, as a program's own small disc can, ends in zeros
    if (bytes.length === wanted) return bytes;
    const whole = new Uint8Array(wanted);
    whole.set(bytes);
    return whole;
  };
  return { format, kind: 'dvd', sectors, layerBreak: 0, files, whole: true, tracks: [{ number: 1, type: 'mode1', first: 0, pregap: 0, sectors }], read, data: read, image };
}
const clamp = (lba, count, sectors) => Math.max(0, Math.min(count, sectors - lba));

// the bytes of these files, in pieces of 4 MB, each file a track
function fileImage(sources) {
  return async function* image() {
    for (const [track, source] of sources.entries()) {
      for (let at = 0; at < source.size; at += 0x400000) yield { track, bytes: await source.read(at, Math.min(0x400000, source.size - at)) };
    }
  };
}

// a CD, from its tracks, each kept in extents of its sectors
function cdDisc(format, tracks, { files, image }) {
  const last = tracks.at(-1);
  const sectors = last.first + last.sectors;
  const extents = tracks.flatMap(t => t.extents.map(e => ({ ...e, type: t.type })));
  // the sectors from `lba`, as their extent keeps them, a run at a time
  async function runs(lba, count, each) {
    for (let done = 0; done < count;) {
      const at = lba + done;
      const e = extents.find(x => at >= x.lba && at < x.lba + x.count);
      if (!e) {
        // between what's kept, as a pregap a .cue says is there and isn't in its file: silence
        const next = extents.find(x => x.lba > at);
        const n = Math.min(count - done, (next ? next.lba : sectors) - at);
        await each(at, n, null, null, done);
        done += n;
        continue;
      }
      const n = Math.min(count - done, e.lba + e.count - at);
      let stored = e.fetch ? await e.fetch(at - e.lba, n) : null;
      if (stored && e.swap) stored = swapped(stored);
      await each(at, n, e, stored, done);
      done += n;
    }
  }
  // whether the file keeps every sector as the drive reads it: a Mode 2 sector kept as its data alone, as an ISO of a
  // PlayStation's CD keeps it, has lost its subheader, which says what the sector holds, and nothing can make it again
  const keptWhole = !tracks.some(t => t.type === 'mode2' && t.extents.some(e => e.size === DATA || e.size === 2324));
  return {
    format, kind: 'cd', sectors, layerBreak: 0, files, image, whole: keptWhole,
    tracks: tracks.map(({ number, type, first, pregap, sectors: s }) => ({ number, type, first, pregap, sectors: s })),
    async read(lba, count) {
      count = clamp(lba, count, sectors);
      const out = new Uint8Array(count * RAW);
      await runs(lba, count, (at, n, e, stored, done) => {
        for (let i = 0; i < n; i++) whole(out, (done + i) * RAW, at + i, e, stored, i, typeAt(at + i));
      });
      return out;
    },
    async data(lba, count) {
      count = clamp(lba, count, sectors);
      const out = new Uint8Array(count * DATA);
      await runs(lba, count, (at, n, e, stored, done) => {
        for (let i = 0; i < n; i++) {
          if (!e || e.type === 'audio') continue;
          const from = e.size === DATA ? i * DATA : e.size === 2336 ? i * e.size + 8 : e.size === 2324 ? i * e.size : i * e.size + (stored[i * e.size + 15] === 1 ? 16 : 24);
          out.set(stored.subarray(from, from + DATA), (done + i) * DATA);
        }
      });
      return out;
    },
  };
  function typeAt(lba) {
    let type = tracks[0].type;
    for (const t of tracks) if (lba >= t.first - t.pregap) type = t.type;
    return type;
  }
}

// one sector as the drive reads it, from what its extent keeps of it
function whole(out, at, lba, e, stored, i, type) {
  const sector = out.subarray(at, at + RAW);
  if (!e) {
    if (type !== 'audio') makeSector(sector, lba, type === 'mode1' ? 1 : 2);
    return;
  }
  const size = e.size, bytes = stored.subarray(i * size, (i + 1) * size);
  if (size === RAW) sector.set(bytes);
  else if (size === DATA) {
    sector.set(bytes, type === 'mode1' ? 16 : 24);
    makeSector(sector, lba, type === 'mode1' ? 1 : 2);
  } else if (size === 2336) {
    // Mode 2 without its sync and header: its subheader, data, EDC and ECC are kept, so only those two are made
    sector.set(SYNC, 0);
    sector.set(msf(lba), 12);
    sector[15] = 2;
    sector.set(bytes, 16);
  } else if (size === 2324) {
    sector.set(bytes, 24);
    makeSector(sector, lba, 2, { form: 2 });
  }
}

// sound kept with its bytes the other way round, as a CHD keeps a CD's
const swapped = bytes => {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i + 1 < bytes.length; i += 2) { out[i] = bytes[i + 1]; out[i + 1] = bytes[i]; }
  return out;
};

// a .cue and the files it names
async function cueDisc(cue, open) {
  const words = new TextDecoder('latin1').decode(await cue.read(0, Math.min(cue.size, 0x100000)));
  const files = [];
  let file = null, current = null;
  for (const line of words.split(/\r?\n/)) {
    const [, command, rest = ''] = /^\s*(\S+)\s*(.*)$/.exec(line) ?? [];
    if (!command) continue;
    const word = command.toUpperCase();
    if (word === 'FILE') {
      const [, quoted, plain, kind = 'BINARY'] = /^(?:"([^"]*)"|(\S+))\s*(\S*)/.exec(rest) ?? [];
      const name = quoted ?? plain;
      if (!/^(BINARY|MOTOROLA)$/i.test(kind || 'BINARY')) throw new Error(`The .cue keeps a track as ${kind}, which the tools can't read: a BIN of it can be.`);
      file = { name, swap: /^MOTOROLA$/i.test(kind), tracks: [] };
      files.push(file);
    } else if (word === 'TRACK') {
      const [number, mode] = rest.split(/\s+/);
      const kind = CUE_TRACKS[mode?.toUpperCase()];
      if (!kind) throw new Error(`The .cue has a track of a kind the tools can't read: ${mode}.`);
      if (!file) throw new Error('The .cue names a track before its file.');
      current = { number: Number(number), size: kind[0], type: kind[1], indexes: {}, pregap: 0, postgap: 0 };
      file.tracks.push(current);
    } else if (word === 'INDEX' && current) {
      const [n, at] = rest.split(/\s+/);
      current.indexes[Number(n)] = time(at);
    } else if (word === 'PREGAP' && current) current.pregap = time(rest.trim());
    else if (word === 'POSTGAP' && current) current.postgap = time(rest.trim());
  }
  if (!files.length || !files.some(f => f.tracks.length)) return null;
  const sources = [];
  // a .cue whose files have moved isn't a disc any more
  for (const f of files) {
    const each = open ? await open(f.name) : null;
    if (!each) return null;
    sources.push(each);
  }
  // each file's tracks follow one another in it, each from its first index, and the files follow one another on the disc
  const tracks = [];
  let lba = 0;
  files.forEach((f, which) => {
    const source = sources[which];
    let byte = 0;
    f.tracks.forEach((t, i) => {
      const startsAt = t.indexes[0] ?? t.indexes[1] ?? 0, next = f.tracks[i + 1];
      const nextAt = next ? next.indexes[0] ?? next.indexes[1] ?? 0 : null;
      const kept = nextAt !== null ? nextAt - startsAt : Math.floor((source.size - byte) / t.size);
      const storedPregap = (t.indexes[1] ?? startsAt) - startsAt;
      // a pregap the .cue says is there that the file doesn't keep comes first, as silence or empty sectors
      const start = lba;
      lba += t.pregap;
      const kept0 = lba;
      tracks.push(track(t.number, t.type, start, t.pregap + storedPregap, kept - storedPregap, [extent(kept0, kept, t.size, source, byte, { swap: f.swap })]));
      byte += kept * t.size;
      lba += kept + t.postgap;
      // what's after a track's last sector up to the next is its own, as a postgap is
      tracks.at(-1).sectors += t.postgap;
    });
  });
  return cdDisc('cue', tracks, { files: files.map(f => f.name), image: fileImage(sources) });
}

// a CHD: of a CD, with its tracks in its metadata, or of a DVD or any other disc in 2048-byte sectors
async function chdDisc(source, options) {
  const chd = await openChd(source, options);
  // the CHD's bytes as a disc's, read through its hunks
  const bytes = {
    size: chd.logicalBytes,
    async read(at, length) {
      const out = new Uint8Array(Math.max(0, Math.min(length, chd.logicalBytes - at)));
      for (let done = 0; done < out.length;) {
        const n = Math.floor((at + done) / chd.hunkBytes), within = at + done - n * chd.hunkBytes;
        const hunk = await chd.hunk(n), take = Math.min(chd.hunkBytes - within, out.length - done);
        out.set(hunk.subarray(within, within + take), done);
        done += take;
      }
      return out;
    },
  };
  const cd = chdTracks(chd);
  if (!cd) return sectorDisc('chd', bytes, { files: [source.name] });
  // each track's frames, padded to a multiple of four in the CHD, a pregap among them when it's kept
  const tracks = [];
  let lba = 0, frame = 0;
  for (const t of cd) {
    const type = t.type === 'AUDIO' ? 'audio' : t.type.startsWith('MODE1') ? 'mode1' : 'mode2';
    const start = lba;
    if (!t.pregapStored) lba += t.pregap;
    const firstFrame = frame, size = t.dataSize, audio = type === 'audio';
    const frames = {
      read: async (at, length) => {
        // a track's sectors from its frames: the bytes of each it keeps
        const from = at / size, n = length / size, out = new Uint8Array(length);
        const raw = await bytes.read((firstFrame + from) * FRAME, n * FRAME);
        for (let i = 0; i < n; i++) out.set(raw.subarray(i * FRAME, i * FRAME + size), i * size);
        return out;
      },
    };
    tracks.push(track(t.number, type, start, t.pregap, t.frames - (t.pregapStored ? t.pregap : 0), [extent(lba, t.frames, size, frames, 0, { swap: audio })]));
    lba += t.frames + t.postgap;
    tracks.at(-1).sectors += t.postgap;
    frame += Math.ceil(t.frames / 4) * 4;
  }
  return cdDisc('chd', tracks, {
    files: [source.name],
    // each track's sectors, as the BIN they were made from keeps them, its sound the right way round
    image: async function* image() {
      for (const [index, t] of tracks.entries()) {
        const e = t.extents[0];
        for (let done = 0; done < e.count; done += 1024) {
          const n = Math.min(1024, e.count - done), stored = await e.fetch(done, n);
          yield { track: index, bytes: e.swap ? swapped(stored) : stored };
        }
      }
    },
  });
}
