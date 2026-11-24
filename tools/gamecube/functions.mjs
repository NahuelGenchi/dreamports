// The code in a GameCube game, for its code map (codemap.mjs), read from the player's copy on their computer: the
// program its disc boots, a DOL, or a DOL given alone, and every module the disc has beside it that a game loads as it
// runs, a REL, under its file's name.
//
// A DOL says which of its sections are code and where each goes in the console's memory, so its functions' addresses
// are where they run, as a decompilation or a disassembler shows them, and a list from one fits. A REL can be loaded
// anywhere, so a function of one is known by where it is in the REL's file, under the file's name, as
// `0x000000F4@stage/first.rel`.
//
// The functions are found by reading the code (ppc.mjs): where the program starts, every call's target (bl), and what
// follows the end of the function before. A function ends at its last return (blr), jump away (b to somewhere outside
// it or back), return from an interrupt (rfi) or jump through the count register that isn't a switch (bctr with no
// table read before it), that no branch of its own goes past, and before a word that isn't an instruction, as the
// zeros that fill up to the next function aren't. What's left between two functions, past any zeros, is a function too
// when every word of it is an instruction and it ends as one does, as a function reached only through a pointer does.
// In a REL a call's target is written by the console as it loads the module, from the module's own list of what to
// write where, so that list is read for them, and for the functions the module starts and ends with.

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { openDisc } from '../lib/read-copy.mjs';
import { fillFunctions } from '../gba/functions.mjs';
import { bytesOn, dolHeader, dolOf, filesOf } from '../../kit/copy/gcm.js';
import { decode, isInstruction } from './ppc.mjs';

export { isInstruction };

const LWZX = 23;
const isTableRead = word => (word >>> 26) === 31 && ((word >>> 1) & 0x3FF) === LWZX;

// Where a function that starts at `start` ends, reading no further than `limit`. With `strict`, null when it reaches
// `limit` or a word that isn't an instruction without having ended.
function endOf(wordAt, start, limit, strict = false) {
  let furthest = start;
  for (let at = start; at + 4 <= limit; at += 4) {
    const word = wordAt(at), way = decode(word, at);
    if (!way) return strict || at === start ? null : at;
    if (way.to !== undefined && !way.call && way.to > at && way.to < limit) furthest = Math.max(furthest, way.to);
    let away = way.returns || way.name === 'rfi' || (way.always && !way.call && way.to !== undefined && (way.to <= at || way.to >= limit));
    // a jump through the count register: a switch when a table was read just before it, whose cases follow, and
    // otherwise a call that never comes back
    if (way.through === 'ctr' && way.always && !way.call) {
      let table = false;
      for (let back = at - 4; back >= start && back >= at - 20; back -= 4) table ||= isTableRead(wordAt(back));
      away = !table;
    }
    if (away && at + 4 > furthest) return at + 4;
  }
  return strict ? null : limit;
}

/**
 * The functions in stretches of code, `sections`, each { address, bytes }, with `starts`, addresses known to start one,
 * each { address, size }, in order, those in `listed` kept as they are. `calls` says the code's calls name their targets,
 * which a module's don't until the console has loaded it.
 */
export function findPpcFunctions({ sections, starts = [], calls = true }, listed = []) {
  const functions = [];
  const sectionOf = address => sections.find(s => address >= s.address && address < s.address + s.bytes.length && (address - s.address) % 4 === 0);
  const known = new Map();
  for (const f of listed) if (!known.has(f.address)) known.set(f.address, f.size);
  for (const address of starts) if (sectionOf(address) && !known.has(address)) known.set(address, 0);
  // every call's target, in any of the sections
  for (const { address: base, bytes } of calls ? sections : []) {
    for (let at = 0; at + 4 <= bytes.length; at += 4) {
      const way = decode(bytes.readUInt32BE(at), base + at);
      if (way?.call && way.to !== undefined && sectionOf(way.to) && !known.has(way.to)) known.set(way.to, 0);
    }
  }
  for (const { address: base, bytes } of [...sections].sort((a, b) => a.address - b.address)) {
    const end = base + bytes.length - bytes.length % 4, wordAt = address => bytes.readUInt32BE(address - base);
    const ordered = [...known.keys()].filter(address => address >= base && address < end).sort((a, b) => a - b);
    // what's before the first known function, and after each: read as functions as long as it ends as they do
    const fill = (from, to) => {
      for (let at = from; at < to;) {
        while (at < to && wordAt(at) === 0) at += 4;
        const found = at < to ? endOf(wordAt, at, to, true) : null;
        if (found === null) break;
        functions.push({ address: at, size: found - at });
        at = found;
      }
    };
    fill(base, ordered[0] ?? end);
    for (const [n, address] of ordered.entries()) {
      const next = ordered[n + 1] ?? end;
      const size = known.get(address) || (endOf(wordAt, address, next) ?? next) - address;
      functions.push({ address, size: Math.max(4, Math.min(size, next - address)) });
      fill(address + size, next);
    }
  }
  return functions.sort((a, b) => a.address - b.address);
}

/** The program in a player's copy: a DOL as it is, or the one its disc boots. */
export async function gamecubeProgram(path) {
  if (extname(path).toLowerCase() === '.dol') return readFileSync(path);
  const disc = await openDisc(path);
  try {
    const dol = disc && await dolOf(disc);
    if (!dol) throw new Error(`The tools couldn't find the program ${path} boots: it isn't a GameCube disc or a DOL.`);
    return Buffer.from(dol.bytes);
  } finally {
    await disc?.close();
  }
}

/** A DOL's code as it's loaded: { entry, sections: [{ address, bytes }] }. */
export function codeOf(dol) {
  const header = dolHeader(dol);
  if (!header) throw new Error('This isn\'t a program for the GameCube: its header isn\'t a DOL\'s.');
  return { entry: header.entry, sections: header.sections.filter(s => s.kind === 'text').map(s => ({ address: s.address, bytes: dol.subarray(s.at, s.at + s.size) })) };
}

/** Whether an address is in the DOL's code as it's loaded. */
export function inCode(dol) {
  const { sections } = codeOf(dol);
  return address => sections.some(s => address >= s.address && address < s.address + s.bytes.length);
}

/** What reads a DOL as it's loaded: `read(address, count)`, its bytes from `address`, code or values, and none outside it. */
export function dolReader(dol) {
  const { sections } = dolHeader(dol);
  return (address, count) => {
    const s = sections.find(each => address >= each.address && address < each.address + each.size);
    return s ? dol.subarray(s.at + address - s.address, Math.min(s.at + s.size, s.at + address - s.address + count)) : Buffer.alloc(0);
  };
}

/** The functions in a DOL, each { address, size }, in order, those in `listed` kept as they are. */
export function findFunctions(dol, listed = []) {
  const { entry, sections } = codeOf(dol);
  return findPpcFunctions({ sections, starts: [entry] }, listed);
}

/** Of the functions in a list, those that start outside the DOL's code. */
export function startsInData(dol, listed) {
  const inside = inCode(dol);
  return listed.filter(({ address }) => !inside(address));
}

// A REL's kinds of things to write as it's loaded that the tools read: a call's target, and the three that aren't one
const REL24 = 10, SKIP = 201, SECTION = 202, END = 203;

/**
 * A REL's header and sections, or null when the bytes aren't one: { id, version, sections: [{ at, size, code }],
 * starts }, `at` where a section is in the file, 0 for one that isn't in it, and `starts` the places in the file where
 * the module's own list says a function starts: what it's started and ended with, and every call's target inside it.
 */
export function relOf(bytes) {
  if (bytes.length < 0x40) return null;
  const count = bytes.readUInt32BE(0x0C), table = bytes.readUInt32BE(0x10), version = bytes.readUInt32BE(0x1C);
  if (version < 1 || version > 3 || count < 2 || count > 64 || table < 0x40 || table + count * 8 > bytes.length) return null;
  const sections = [];
  for (let n = 0; n < count; n++) {
    const word = bytes.readUInt32BE(table + n * 8), size = bytes.readUInt32BE(table + n * 8 + 4), at = word & ~3;
    if (at && (at < table + count * 8 || at + size > bytes.length)) return null;
    sections.push({ at, size, code: (word & 1) === 1 });
  }
  if (!sections.some(s => s.code && s.at)) return null;
  const id = bytes.readUInt32BE(0), place = (section, offset) => (sections[section]?.at && offset < sections[section].size ? sections[section].at + offset : null);
  const starts = [];
  for (const [section, offset] of [[0x30, 0x34], [0x31, 0x38], [0x32, 0x3C]]) {
    const at = bytes[section] ? place(bytes[section], bytes.readUInt32BE(offset)) : null;
    if (at !== null && sections[bytes[section]].code) starts.push(at);
  }
  // the module's list of what to write where, for the calls into itself
  const imports = bytes.readUInt32BE(0x28), importsSize = bytes.readUInt32BE(0x2C);
  if (imports + importsSize <= bytes.length) {
    for (let at = imports; at + 8 <= imports + importsSize; at += 8) {
      if (bytes.readUInt32BE(at) !== id) continue;
      for (let entry = bytes.readUInt32BE(at + 4); entry + 8 <= bytes.length; entry += 8) {
        const type = bytes[entry + 2], section = bytes[entry + 3];
        if (type === END) break;
        if (type === REL24 && sections[section]?.code) {
          const to = place(section, bytes.readUInt32BE(entry + 4));
          if (to !== null) starts.push(to);
        }
      }
    }
  }
  return { id, version, sections, starts: [...new Set(starts)] };
}

/** The functions in a REL, each { address, size }, `address` where it is in the file, those in `listed` kept as they are. */
export function findRelFunctions(bytes, listed = []) {
  const rel = relOf(bytes);
  if (!rel) return [...listed];
  const sections = rel.sections.filter(s => s.code && s.at).map(s => ({ address: s.at, bytes: bytes.subarray(s.at, s.at + s.size) }));
  // a call in a REL as its file keeps it goes nowhere yet, so only the module's own list says where calls land
  return findPpcFunctions({ sections, starts: rel.starts, calls: false }, listed);
}

/**
 * The code on a player's copy: { boot, programs: [{ path, kind, bytes }] }. `boot` is the program the disc boots, and
 * `programs` every REL among the disc's files, `kind` 'rel', by its file's name with its folders. Given a DOL alone,
 * it's that program and no more. A module packed inside another file isn't found, as only the game's own code can
 * unpack it.
 */
export async function gamecubeDisc(path, { progress = () => {} } = {}) {
  const boot = await gamecubeProgram(path), code = { boot, programs: [] };
  if (extname(path).toLowerCase() === '.dol') return code;
  const disc = await openDisc(path);
  try {
    const files = (await filesOf(disc)) ?? [], total = files.length;
    for (const [n, file] of files.sort((a, b) => a.name.localeCompare(b.name)).entries()) {
      progress(n, total);
      if (file.size < 0x40 || file.size > 64 << 20) continue;
      // a REL has no word that says it's one, so its header is tried, and then the whole file
      const head = Buffer.from(await bytesOn(disc, file.at, 0x40));
      const count = head.readUInt32BE(0x0C), table = head.readUInt32BE(0x10), version = head.readUInt32BE(0x1C);
      if (version < 1 || version > 3 || count < 2 || count > 64 || table < 0x40 || table + count * 8 > file.size) continue;
      const bytes = Buffer.from(await bytesOn(disc, file.at, file.size));
      if (relOf(bytes)) code.programs.push({ path: file.name, kind: 'rel', bytes });
    }
  } finally {
    await disc.close();
  }
  return code;
}

/**
 * Every function on a disc read by gamecubeDisc, each { address, size, program }: `program` the REL's file when it
 * isn't the boot program. Those in `listed`, a code map's, are kept as they are, each program on its own.
 */
export function discFunctions(code, listed = []) {
  const plain = list => list.map(({ program, ...f }) => f), of = program => plain(listed.filter(f => (f.program ?? null) === program));
  const all = [...fillFunctions(of(null), findFunctions(code.boot, of(null)))];
  for (const program of [...code.programs].sort((a, b) => a.path.localeCompare(b.path))) {
    all.push(...fillFunctions(of(program.path), findRelFunctions(program.bytes, of(program.path))).map(f => ({ ...f, program: program.path })));
  }
  return all;
}
