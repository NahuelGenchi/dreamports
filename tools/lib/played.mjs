// What of the original's code has been played next to a Dreamport, for gameplay proven
// (docs/STANDARD.md#how-progress-is-measured): every instruction of the code map's functions counts once it has run
// in a frame that matched, and every conditional branch twice, once for each of its two ways, taken and not. The
// program that plays the original says what ran and in which frames (gba/original.c, DP_PLAYED); prove keeps, for each
// recording, what ran in its matching frames, in games/<version>/proof/played.json:
//
// {
//   "original": the copy's SHA-1,
//   "percent", "units": { "total", "played" }: gameplay proven, and what it's made of,
//   "code": which places in the code map's functions hold an instruction, and which of those a conditional branch,
//   "recordings": { name: what ran in the recording's matching frames },
//   "content": { name: the cartridge's data used in the recording's matching frames }
// }
//
// The cartridge's data counts the same way: in cells of 32 bytes, each once the game has used something of it in a
// frame that matched (DP_CONTENT: read it and done anything with it but copy it into the work RAM, where it's followed).
// The cells that count are those with a byte outside every function of the code map, but those whose 32 bytes are
// all the same, which hold nothing.
//
// "code" and each recording's are sets of numbers, deflated and written in base64. A place is two bytes of a function,
// numbered through the code map's functions in order, and takes three numbers: in a recording's, that it ran, that its
// branch was taken, and that it wasn't; in "code", that it's an instruction, and that it's a conditional branch. They say
// where the original's instructions are and nothing of what they are, as the code map does.

import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { proofFolder, sharedProofFolder } from './paths.mjs';
import { looksLikeArm } from '../gba/functions.mjs';
import { playedPercent } from '../../src/lib/entries.mjs';

export const RAN = 0, TAKEN = 1, NOT_TAKEN = 2;
/** How many bytes of the cartridge a cell of its data is (gba/original.c). */
export const CELL = 32;
const INSTRUCTION = 0, BRANCH = 1;
const CARTRIDGE = 0x08000000;

const has = (set, n) => (set[n >> 3] >> (n & 7) & 1) === 1;
const put = (set, n) => { set[n >> 3] |= 1 << (n & 7); };
const pack = set => deflateRawSync(set, { level: 9 }).toString('base64');
const unpack = (text, bytes) => {
  const set = new Uint8Array(bytes);
  if (text) set.set(inflateRawSync(Buffer.from(text, 'base64')).subarray(0, bytes));
  return set;
};

/** Where each of the code map's functions has its places: { first, places, bytes }, `first[i]` the place of function
 *  i's first two bytes, and `bytes` how long a set of all of them is. */
export function layoutOf(codeMap) {
  const first = new Uint32Array(codeMap.functions.length + 1);
  codeMap.functions.forEach((f, i) => { first[i + 1] = first[i] + Math.ceil(f.size / 2); });
  const places = first[codeMap.functions.length];
  return { first, places, bytes: Math.ceil(places * 3 / 8) };
}

// Thumb instructions the console's processor doesn't have, a return, and a write to pc: where a function's code ends
const invalid = op => (op & 0xFF00) === 0xDE00 || (op & 0xF800) === 0xE800 || (op & 0xFF00) === 0xB100 || (op & 0xFE00) === 0xB200
  || (op & 0xFE00) === 0xB600 || (op & 0xFC00) === 0xB800 || (op & 0xFE00) === 0xBE00;
const leaves = op => (op & 0xFF00) === 0xBD00 || (op & 0xFF87) === 0x4700 || (op & 0xFF87) === 0x4687 || (op & 0xFF87) === 0x4487;

/**
 * The instructions of a function, from its bytes: follows its code from its start and from every place of it known to
 * have run (`seeds`, offsets), through each branch's two ways, to where it returns or leaves, and gives the offsets
 * that hold an instruction and, of those, the conditional branches: { instructions, branches }. A switch's cases are
 * found only from where they ran, as its table isn't read.
 */
export function instructionsOf(bytes, seeds = []) {
  const size = bytes.length, u16 = at => bytes[at] | bytes[at + 1] << 8, u32 = at => (u16(at) | u16(at + 2) << 16) >>> 0;
  const arm = size >= 16 && size % 4 === 0 && looksLikeArm([0, 4, 8, 12].map(u32));
  const instructions = new Set(), branches = new Set(), work = [0, ...seeds];
  while (work.length) {
    let pc = work.pop();
    while (pc >= 0 && pc + (arm ? 4 : 2) <= size && !instructions.has(pc)) {
      if (arm) {
        const op = u32(pc), always = op >>> 28 === 0xE;
        instructions.add(pc);
        if ((op & 0x0E000000) === 0x0A000000) {
          const target = pc + 8 + ((op & 0xFFFFFF) << 8 >> 6);
          if (op >>> 28 < 0xE) {
            branches.add(pc);
            work.push(target);
          } else if (!(op & 0x01000000)) {
            pc = target;
            continue;
          }
        } else if (always && ((op & 0x0FFFFFF0) === 0x012FFF10 || (op & 0x0E108000) === 0x08108000 || (op & 0x0C10F000) === 0x0410F000
          || ((op & 0x0C00F000) === 0x0000F000 && (op & 0x01900000) !== 0x01000000))) break;
        pc += 4;
        continue;
      }
      const op = u16(pc);
      if ((op & 0xF800) === 0xF000 && pc + 4 <= size && (u16(pc + 2) & 0xF800) === 0xF800) {
        // BL, in two halves, each a step of the processor's
        instructions.add(pc).add(pc + 2);
        pc += 4;
        continue;
      }
      if (invalid(op) || (op & 0xF800) === 0xF800) break;
      instructions.add(pc);
      if ((op & 0xF000) === 0xD000 && (op >> 8 & 0xF) < 0xE) {
        branches.add(pc);
        work.push(pc + 4 + ((op & 0xFF) << 24 >> 23));
      } else if ((op & 0xF800) === 0xE000) {
        pc = pc + 4 + ((op & 0x7FF) << 21 >> 20);
        continue;
      } else if (leaves(op)) break;
      pc += 2;
    }
  }
  return { instructions, branches };
}

/**
 * Finds the function an instruction that ran is in, for a code map: `find(address, code, thumb)` gives
 * [the function's place in the code map, the offset in it] or null. An address in the work RAM is a copy of the
 * cartridge's code, when the cartridge has those bytes there (`cartridge(address, count)` reads them), or else in a
 * function the game makes there, when the bytes `made` has for it (place in the code map → bytes) are those.
 */
export function finderOf(codeMap, cartridge, made) {
  const own = [], inMemory = [];
  codeMap.functions.forEach((f, index) => (f.bytes ? inMemory : own).push({ ...f, index }));
  const within = (list, address) => list.filter(f => address >= f.address && address < f.address + f.size);
  const inCartridge = address => {
    let low = 0, high = own.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1, f = own[middle];
      if (address < f.address) high = middle - 1;
      else if (address >= f.address + f.size) low = middle + 1;
      else return [f.index, address - f.address];
    }
    return null;
  };
  const same = (bytes, at, code, thumb) => bytes && at + (thumb ? 2 : 4) <= bytes.length
    && (bytes[at] | bytes[at + 1] << 8) === (code & 0xFFFF) && (thumb || (bytes[at + 2] | bytes[at + 3] << 8) === code >>> 16);
  return (address, code, thumb) => {
    if (address >= CARTRIDGE) return inCartridge(address);
    for (const copy of codeMap.copies ?? []) {
      if (address < copy.ram || address >= copy.ram + copy.size) continue;
      const from = copy.cartridge + address - copy.ram;
      if (same(cartridge(from, 4), 0, code, thumb)) return inCartridge(from);
    }
    for (const f of within(inMemory, address)) {
      if (same(made.get(f.index), address - f.address, code, thumb)) return [f.index, address - f.address];
    }
    return null;
  };
}

/**
 * What ran in a recording's matching frames, as a set: `records` as the original's program writes them (five words
 * each: address, +1 for Thumb, the bytes, what happened, the first and last frame of a stretch), `matched[frame]`
 * whether that frame of the original matched, and `find` from finderOf.
 */
export function playedIn(records, matched, layout, find) {
  const before = new Uint32Array(matched.length + 1);
  for (let frame = 0; frame < matched.length; frame++) before[frame + 1] = before[frame] + (matched[frame] ? 1 : 0);
  const set = new Uint8Array(layout.bytes);
  for (let i = 0; i + 5 <= records.length; i += 5) {
    const from = records[i + 3], to = Math.min(records[i + 4], matched.length - 1);
    if (from > to || before[to + 1] === before[from]) continue;
    const found = find(records[i] & ~1, records[i + 1], (records[i] & 1) === 1);
    if (found) put(set, (layout.first[found[0]] + (found[1] >> 1)) * 3 + records[i + 2]);
  }
  return set;
}

/** The cartridge's data used in a recording's matching frames, as a set of cells: `records` as the original's program
 *  writes them for DP_CONTENT (three words each: the cell, and the first and last frame of a stretch). */
export function contentIn(records, matched, cells) {
  const before = new Uint32Array(matched.length + 1);
  for (let frame = 0; frame < matched.length; frame++) before[frame + 1] = before[frame] + (matched[frame] ? 1 : 0);
  const set = new Uint8Array(Math.ceil(cells / 8));
  for (let i = 0; i + 3 <= records.length; i += 3) {
    const from = records[i + 1], to = Math.min(records[i + 2], matched.length - 1);
    if (records[i] < cells && from <= to && before[to + 1] !== before[from]) put(set, records[i]);
  }
  return set;
}

/** The cells of a cartridge that hold data, as a set: those with a byte outside every function of the code map, but
 *  those whose bytes are all the same. `rom` is the whole copy. */
export function contentCells(codeMap, rom) {
  const cells = Math.ceil(rom.length / CELL), code = new Uint8Array(rom.length), set = new Uint8Array(Math.ceil(cells / 8));
  for (const f of codeMap.functions) if (!f.bytes && f.address >= CARTRIDGE) code.fill(1, f.address - CARTRIDGE, f.address - CARTRIDGE + f.size);
  for (let cell = 0; cell < cells; cell++) {
    const from = cell * CELL, to = Math.min(from + CELL, rom.length);
    let data = false, same = true;
    for (let at = from; at < to; at++) {
      data ||= !code[at];
      same &&= rom[at] === rom[from];
    }
    if (data && !same) put(set, cell);
  }
  return set;
}

/**
 * What a game says nothing can reach, from games/<game>/proof/unreachable.json, which every version shares:
 * { "about", "code": [[from, to, why]], "content": [[from, to, why]], "ways": [[address, way, why]] }. `code` and
 * `content` are stretches of the cartridge, each its first and last address in hexadecimal, with why nothing reaches
 * it, such as code left from the game's making that nothing calls. `ways` are branches one way of which can't happen,
 * "taken" or "not taken", as the code itself decides them (lib/decided.mjs). A person reads each before it goes in, as
 * it takes something out of what gameplay proven counts, while it stays unplayed. Returns { code, content }, each a
 * list of [from, to] as numbers, and `ways`, a Map from a branch's address to TAKEN or NOT_TAKEN.
 */
export function readUnreachable(game) {
  const file = join(sharedProofFolder(game), 'unreachable.json');
  if (!existsSync(file)) return { code: [], content: [], ways: new Map() };
  const listed = JSON.parse(readFileSync(file, 'utf8'));
  const stretches = (list, word) => (list ?? []).map(([from, to, why]) => {
    const stretch = [parseInt(from, 16), parseInt(to, 16)];
    if (!/^[0-9A-F]{8}$/.test(from) || !/^[0-9A-F]{8}$/.test(to) || stretch[0] > stretch[1] || typeof why !== 'string' || !why.trim()) {
      throw new Error(`${file}: "${word}" lists stretches as [first address, last address, why], the addresses as eight capital hexadecimal digits.`);
    }
    return stretch;
  });
  const ways = new Map((listed.ways ?? []).map(([address, way, why]) => {
    if (!/^[0-9A-F]{8}$/.test(address) || !['taken', 'not taken'].includes(way) || typeof why !== 'string' || !why.trim()) {
      throw new Error(`${file}: "ways" lists branches as [address, "taken" or "not taken", why], the address as eight capital hexadecimal digits.`);
    }
    return [parseInt(address, 16), way === 'taken' ? TAKEN : NOT_TAKEN];
  }));
  return { code: stretches(listed.code, 'code'), content: stretches(listed.content, 'content'), ways };
}
const within = (stretches, address) => stretches.some(([from, to]) => address >= from && address <= to);

/**
 * What's been played of the cartridge's own code in a version's matching frames, for a search for what hasn't
 * (gba/original.c, DP_PROVEN): for each thing, its place in the cartridge in halfwords, times four, plus what it is.
 */
export function provenUnits(game, codeMap) {
  const layout = layoutOf(codeMap), played = readPlayed(game), ran = new Uint8Array(layout.bytes), units = [];
  for (const text of Object.values(played.places === layout.places ? played.recordings ?? {} : {})) {
    const set = unpack(text, layout.bytes);
    for (let i = 0; i < set.length; i++) ran[i] |= set[i];
  }
  codeMap.functions.forEach((f, index) => {
    if (f.bytes || f.address < CARTRIDGE) return;
    for (let place = layout.first[index]; place < layout.first[index + 1]; place++) {
      const slot = (f.address - CARTRIDGE) / 2 + place - layout.first[index];
      for (const what of [RAN, TAKEN, NOT_TAKEN]) if (has(ran, place * 3 + what)) units.push(slot * 4 + what);
    }
  });
  return Uint32Array.from(units);
}

/**
 * What a version's played.json leaves untouched, for people and for tasks: { functions, content }. `functions` has, for
 * each function of the code map with something unplayed, { key, address, size, total, played, never, ways }: its
 * instructions and branch ways, how many were played, whether it never ran at all, and `ways`, the addresses of the
 * branches played only one way, with the way never gone ('taken' or 'not taken'). `content` is the stretches of the
 * cartridge's data never used, as [first address, last address], the longest first, or none without `cartridge`.
 */
export function untouchedOf(game, codeMap, cartridge = null) {
  const layout = layoutOf(codeMap), played = readPlayed(game), same = played.places === layout.places;
  const ran = new Uint8Array(layout.bytes), code = unpack(same ? played.code : null, layout.bytes);
  const { ways: ruledOut } = readUnreachable(game);
  for (const text of Object.values(same ? played.recordings ?? {} : {})) {
    const set = unpack(text, layout.bytes);
    for (let i = 0; i < set.length; i++) ran[i] |= set[i];
  }
  const functions = [];
  codeMap.functions.forEach((f, index) => {
    let total = 0, done = 0;
    const ways = [];
    for (let place = layout.first[index]; place < layout.first[index + 1]; place++) {
      const at = f.address + (place - layout.first[index]) * 2;
      const went = [has(ran, place * 3 + RAN), has(ran, place * 3 + TAKEN), has(ran, place * 3 + NOT_TAKEN)];
      if (has(code, place * 3 + INSTRUCTION)) total++;
      if (has(code, place * 3 + BRANCH)) {
        // a way the game's list says can't happen isn't one to play
        const out = f.bytes ? undefined : ruledOut.get(at);
        total += [TAKEN, NOT_TAKEN].filter(way => went[way] || way !== out).length;
        if (went[RAN] && went[TAKEN] !== went[NOT_TAKEN] && (went[TAKEN] ? NOT_TAKEN : TAKEN) !== out) ways.push([at, went[TAKEN] ? 'not taken' : 'taken']);
      }
      done += went.filter(Boolean).length;
    }
    if (done < total) functions.push({ key: f.key, address: f.address, size: f.size, total, played: done, never: done === 0, ways });
  });
  if (!cartridge) return { functions, content: [] };
  // the cartridge's data never used, cell by cell, joined into stretches
  const rom = cartridge(CARTRIDGE, 0x02000000), holds = contentCells(codeMap, rom), read = new Uint8Array(holds.length), content = [];
  for (const text of Object.values(same ? played.content ?? {} : {})) {
    const set = unpack(text, holds.length);
    for (let i = 0; i < set.length; i++) read[i] |= set[i];
  }
  for (let cell = 0; cell < holds.length * 8; cell++) {
    if (!has(holds, cell) || has(read, cell)) continue;
    const from = CARTRIDGE + cell * CELL, last = content.at(-1);
    if (last && last[1] + 1 === from) last[1] = from + CELL - 1;
    else content.push([from, from + CELL - 1]);
  }
  content.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]) || a[0] - b[0]);
  return { functions, content };
}

/**
 * What's left of a version as pieces someone can take, once its parts are all played through (tools/tasks.mjs):
 * `functions` from untouchedOf, `parts` the game's, in a player's order, each { name, recording }, and `ran` each
 * recording's functions that ran in matching frames, by its name (progress.json). A function played in part goes with
 * the first part whose recording ran it, as "What's left of <part>"; one no part's recording ran, and those never
 * played, go by where they are in the original, as "Code never played around <address>", a stretch of 0x10000 each,
 * and one that most parts' recordings ran, as "What's left of the code the parts share around <address>".
 * Returns [{ name, recording, functions }], the parts' pieces first, each piece's functions those with most left first.
 */
export function leftoverPieces(functions, parts, ran) {
  // the first part whose recording ran each function, and how many parts' recordings did: one most of them ran is
  // the game's own machinery, no part's in particular
  const partOf = new Map(), shared = new Map();
  for (const part of parts) {
    for (const key of new Set(ran[part.recording] ?? [])) {
      if (!partOf.has(key)) partOf.set(key, part);
      shared.set(key, (shared.get(key) ?? 0) + 1);
    }
  }
  const proven = parts.filter(part => ran[part.recording]).length;
  const pieces = new Map();
  const into = (name, recording, order, f) => {
    if (!pieces.has(name)) pieces.set(name, { name, recording, order, functions: [] });
    pieces.get(name).functions.push(f);
  };
  for (const f of functions) {
    const part = f.never ? null : partOf.get(f.key), block = hex8(f.address & ~0xFFFF);
    if (part && shared.get(f.key) * 2 > proven && proven > 2) into(`What's left of the code the parts share around ${block}`, part.recording, parts.length + (f.address >>> 16), f);
    else if (part) into(`What's left of ${part.name}`, part.recording, parts.indexOf(part), f);
    else into(`Code never played around ${block}`, null, parts.length + 0x10000 + (f.address >>> 16), f);
  }
  return [...pieces.values()].sort((a, b) => a.order - b.order).map(({ name, recording, functions: list }) => ({
    name, recording, functions: list.sort((a, b) => (b.total - b.played) - (a.total - a.played) || a.address - b.address),
  }));
}
const hex8 = address => address.toString(16).toUpperCase().padStart(8, '0');

/** A version's played.json, or a new one. */
/**
 * The recordings in whose matching frames the instruction at `address` ran, with what it did there: each as
 * { name, taken, notTaken }, or none when the address is in no function of the code map or nothing has run it.
 */
export function ranIn(game, codeMap, address) {
  const layout = layoutOf(codeMap), played = readPlayed(game);
  const index = codeMap.functions.findIndex(f => address >= f.address && address < f.address + f.size);
  if (index < 0 || played.places !== layout.places) return [];
  const place = layout.first[index] + ((address - codeMap.functions[index].address) >> 1);
  return Object.entries(played.recordings ?? {}).map(([name, text]) => {
    const set = unpack(text, layout.bytes);
    return has(set, place * 3 + RAN) ? { name, taken: has(set, place * 3 + TAKEN), notTaken: has(set, place * 3 + NOT_TAKEN) } : null;
  }).filter(Boolean);
}

/**
 * The functions of the code map that started in a recording's matching frames, from what ran there (`set`, as playedIn
 * gives it): those whose first instruction ran, by their keys, in the code map's order. It's what a recording's row
 * lists as found running, for a recording whose program says what ran and not which functions started.
 */
export function startedIn(set, codeMap) {
  const layout = layoutOf(codeMap);
  return codeMap.functions.filter((f, index) => has(set, layout.first[index] * 3 + RAN)).map(f => f.key);
}

/**
 * For each recording, which of `addresses` ran in its matching frames: a Map from the recording's name to those
 * addresses, the recordings that ran none left out.
 */
export function ranBy(game, codeMap, addresses) {
  const layout = layoutOf(codeMap), played = readPlayed(game), by = new Map();
  if (played.places !== layout.places) return by;
  const starts = codeMap.functions.map((f, index) => ({ f, index })).sort((x, y) => x.f.address - y.f.address);
  const places = addresses.map(address => {
    // the last function that starts at or before it
    let low = 0, high = starts.length - 1, found = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (starts[middle].f.address <= address) { found = middle; low = middle + 1; } else high = middle - 1;
    }
    const at = found < 0 ? null : starts[found];
    return at && address < at.f.address + at.f.size ? layout.first[at.index] + ((address - at.f.address) >> 1) : -1;
  });
  for (const [name, text] of Object.entries(played.recordings ?? {})) {
    const set = unpack(text, layout.bytes);
    const ran = addresses.filter((_, i) => places[i] >= 0 && has(set, places[i] * 3 + RAN));
    if (ran.length) by.set(name, ran);
  }
  return by;
}

export function readPlayed(game) {
  const file = join(proofFolder(game), 'played.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { recordings: {} };
}

/**
 * Works out a version's played.json again and writes it: `sets` holds what ran in the matching frames of the
 * recordings just proven (name → set), the others stay as the file has them, and those not in `all` go. `made` holds the
 * bytes of the functions the game made in memory in those runs (place in the code map → bytes), and `cartridge` reads
 * the copy. Where each function's instructions and branches are comes from its bytes, followed from its start and from
 * what ran; a function made in memory that didn't run now keeps what the file knew of it. `used` holds the cartridge's
 * data those recordings used (name → set of cells). Returns { percent, total, played, content: { total, read, percent } }.
 */
export function writePlayed(game, { original, codeMap, cartridge, sets, used, made, all }) {
  const layout = layoutOf(codeMap), before = readPlayed(game), unreachable = readUnreachable(game);
  const sameMap = before.original === original && before.places === layout.places;
  const recordings = {};
  for (const name of [...all].sort()) {
    if (sets.has(name)) recordings[name] = pack(sets.get(name));
    else if (sameMap && before.recordings?.[name]) recordings[name] = before.recordings[name];
  }
  // everything that ran in some recording's matching frames
  const ran = new Uint8Array(layout.bytes);
  for (const text of Object.values(recordings)) {
    const set = unpack(text, layout.bytes);
    for (let i = 0; i < set.length; i++) ran[i] |= set[i];
  }
  const known = unpack(sameMap ? before.code : null, layout.bytes), code = new Uint8Array(layout.bytes);
  let total = 0, played = 0;
  codeMap.functions.forEach((f, index) => {
    const first = layout.first[index], places = layout.first[index + 1] - first;
    const bytes = f.bytes ? made.get(index) : cartridge(f.address, f.size);
    if (bytes) {
      const seeds = [];
      for (let place = 0; place < places; place++) if (has(ran, (first + place) * 3 + RAN)) seeds.push(place * 2);
      const { instructions, branches } = instructionsOf(bytes, seeds);
      for (const at of instructions) put(code, (first + (at >> 1)) * 3 + INSTRUCTION);
      for (const at of branches) put(code, (first + (at >> 1)) * 3 + BRANCH);
    } else {
      for (let place = 0; place < places; place++) {
        for (const what of [INSTRUCTION, BRANCH]) if (has(known, (first + place) * 3 + what)) put(code, (first + place) * 3 + what);
      }
    }
    for (let place = first; place < first + places; place++) {
      const went = [has(ran, place * 3 + RAN), has(ran, place * 3 + TAKEN), has(ran, place * 3 + NOT_TAKEN)];
      // what ran is an instruction, and what went a way a branch, whatever following the code found
      if (went[RAN]) put(code, place * 3 + INSTRUCTION);
      if (went[TAKEN] || went[NOT_TAKEN]) put(code, place * 3 + BRANCH);
      // what the game's list says nothing can reach doesn't count while it stays unplayed
      const out = !f.bytes && within(unreachable.code, f.address + (place - first) * 2);
      if (has(code, place * 3 + INSTRUCTION) && (went[RAN] || !out)) total++;
      // a branch's two ways count, but one the game's list says can't happen, while nothing has gone that way
      const ruledOut = f.bytes ? undefined : unreachable.ways.get(f.address + (place - first) * 2);
      if (has(code, place * 3 + BRANCH)) total += out ? went.slice(1).filter(Boolean).length : [TAKEN, NOT_TAKEN].filter(way => went[way] || way !== ruledOut).length;
      played += went.filter(Boolean).length;
    }
  });
  const percent = playedPercent(played, total);
  // the cartridge's data: the cells that count, and those some recording used in its matching frames
  const rom = cartridge(CARTRIDGE, 0x02000000), holds = contentCells(codeMap, rom), cellBytes = holds.length;
  const content = {};
  for (const name of [...all].sort()) {
    if (used.has(name)) content[name] = pack(used.get(name));
    else if (sameMap && before.content?.[name]) content[name] = before.content[name];
  }
  let cellsTotal = 0, cellsRead = 0;
  const read = new Uint8Array(cellBytes);
  for (const text of Object.values(content)) {
    const set = unpack(text, cellBytes);
    for (let i = 0; i < cellBytes; i++) read[i] |= set[i];
  }
  for (let cell = 0; cell < cellBytes * 8; cell++) {
    if (!has(holds, cell)) continue;
    if (!has(read, cell) && within(unreachable.content, CARTRIDGE + cell * CELL)) continue;
    cellsTotal++;
    if (has(read, cell)) cellsRead++;
  }
  const ofContent = { total: cellsTotal, read: cellsRead, percent: playedPercent(cellsRead, cellsTotal) };
  const text = `{\n  "original": ${JSON.stringify(original)},\n  "percent": ${percent},\n  "units": ${JSON.stringify({ total, played })},\n  "places": ${layout.places},\n`
    + `  "code": ${JSON.stringify(pack(code))},\n  "recordings": {\n${Object.entries(recordings).map(([name, set]) => `    ${JSON.stringify(name)}: ${JSON.stringify(set)}`).join(',\n')}\n  },\n`
    + `  "cells": ${JSON.stringify(ofContent)},\n  "content": {\n${Object.entries(content).map(([name, set]) => `    ${JSON.stringify(name)}: ${JSON.stringify(set)}`).join(',\n')}\n  }\n}\n`;
  // a version whose proof has nothing yet has no folder for it
  mkdirSync(proofFolder(game), { recursive: true });
  writeFileSync(join(proofFolder(game), 'played.json'), text);
  return { percent, total, played, content: ofContent };
}
