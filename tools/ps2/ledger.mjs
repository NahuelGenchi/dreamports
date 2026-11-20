// What gameplay proven needs to know of a PlayStation 2 game (lib/played.mjs): where the instructions of its functions
// are and which are conditional branches, on the EE and the IOP (MIPS) and on the vector units (pairs of an upper and a
// lower instruction), by the same rules as the tools' change to Play! that says what ran (libretro/play.patch); the
// bytes of the program its disc boots, where it runs; and the disc's sectors that hold anything, read once a copy
// (loadCopy) from whatever file its disc is in.
//
// A branch whose way the code alone decides, as `beq $zero, $zero`, which is how `b` is written, or `bgez $zero`, is
// no conditional branch: it always goes, and only the conditional ones count each of their two ways.

import { statSync } from 'node:fs';
import { extname } from 'node:path';
import { discFiles, openDisc } from '../lib/read-copy.mjs';
import { moduleCode, ps2Disc, sectionOf } from './functions.mjs';

/** What kind of conditional branch an EE or IOP instruction is: 0 none, 1 one, 2 a likely one, whose delay slot runs
 *  only when it's taken. As play.patch's DreamportsBranchKind says. */
export function branchKind(word) {
  const op = word >>> 26, rs = word >>> 21 & 31, rt = word >>> 16 & 31;
  switch (op) {
    case 0x01:
      if (rt > 0x13 || (rt > 0x03 && rt < 0x10)) return 0;
      if (rs === 0 && rt & 1) return 0;
      return rt & 2 ? 2 : 1;
    case 0x04: case 0x14: return rs === rt ? 0 : op === 0x14 ? 2 : 1;
    case 0x05: case 0x15: return op === 0x15 ? 2 : 1;
    case 0x06: case 0x16: return rs === 0 ? 0 : op === 0x16 ? 2 : 1;
    case 0x07: case 0x17: return op === 0x17 ? 2 : 1;
    case 0x10: case 0x11: case 0x12: return rs !== 0x08 ? 0 : rt & 2 ? 2 : 1;
    default: return 0;
  }
}

/** Whether a vector unit's lower instruction is a conditional branch: IBEQ, IBNE, IBLTZ, IBGTZ, IBLEZ or IBGEZ, but IBEQ
 *  of a register with itself. */
export function vuBranches(lower) {
  const op = lower >>> 25, it = lower >>> 16 & 31, is = lower >>> 11 & 31;
  return (op === 0x29 || (op >= 0x2C && op <= 0x2F) || op === 0x28) && !(op === 0x28 && it === is);
}

const TAKEN = 1, NOT_TAKEN = 2;
const signed16 = word => (word & 0xFFFF) << 16 >> 16;

/**
 * The instructions of an EE or IOP function, from its bytes, as lib/played.mjs's instructionsOf gives a Game Boy
 * Advance's: follows its code from its start and from every place known to have run (`seeds`), through both ways of
 * each conditional branch, each delay slot, a call's return and a jump within it, to a JR or a jump out of it, and gives
 * { instructions, branches }, the offsets of each. `never` maps a branch's offset to the way it can't go. `address` is
 * where it runs, for a J's target.
 */
export function mipsInstructionsOf(bytes, seeds = [], never = new Map(), address = 0) {
  const size = bytes.length - bytes.length % 4, word = at => (bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16 | bytes[at + 3] << 24) >>> 0;
  // from the start first, then from each place known to have run, lowest first, so a delay slot is known for one before
  // it's taken for where something starts
  const instructions = new Set(), branches = new Set(), work = [0], later = [...seeds].sort((a, b) => b - a);
  const inside = at => at >= 0 && at < size;
  while (work.length || later.length) {
    let pc = work.length ? work.pop() : later.pop();
    while (inside(pc) && !instructions.has(pc)) {
      const w = word(pc), op = w >>> 26, funct = w & 63, rs = w >>> 21 & 31, rt = w >>> 16 & 31;
      instructions.add(pc);
      const target = pc + 4 + signed16(w) * 4, delay = pc + 4;
      const kind = branchKind(w);
      if (kind) {
        branches.add(pc);
        if (inside(delay)) instructions.add(delay);
        if (never.get(pc) !== TAKEN) work.push(target);
        if (never.get(pc) === NOT_TAKEN) break;
        pc += 8;
        continue;
      }
      // the branches that always go: to their target, or as a call, back after the delay slot
      const always = op === 0x04 || op === 0x14 || ((op === 0x06 || op === 0x16) && rs === 0) || (op === 0x01 && rs === 0 && (rt & 1));
      if (always) {
        if (inside(delay)) instructions.add(delay);
        if (op === 0x01 && rt >= 0x10) { pc += 8; continue; }
        pc = target;
        continue;
      }
      if (op === 0x02 || op === 0x03) {
        if (inside(delay)) instructions.add(delay);
        const to = ((address + pc + 4) & 0xF0000000 | (w & 0x3FFFFFF) << 2) >>> 0;
        if (op === 0x03) { pc += 8; continue; }
        pc = to - address;
        continue;
      }
      if (op === 0x00 && (funct === 0x08 || funct === 0x09)) {
        if (inside(delay)) instructions.add(delay);
        if (funct === 0x08) break;
        pc += 8;
        continue;
      }
      // ERET leaves
      if (w === 0x42000018) break;
      pc += 4;
    }
  }
  return { instructions, branches };
}

/**
 * The instructions of a vector unit's program, from its bytes, pairs of a lower and an upper word: its offsets of a
 * pair, and those of the pairs whose lower instruction is a conditional branch. B, BAL, JR and JALR go as the EE's
 * do, and a pair whose upper instruction has its E bit ends the program after the pair that follows it.
 */
export function vuInstructionsOf(bytes, seeds = [], never = new Map()) {
  const size = bytes.length - bytes.length % 8, word = at => (bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16 | bytes[at + 3] << 24) >>> 0;
  const instructions = new Set(), branches = new Set(), work = [0], later = [...seeds].sort((a, b) => b - a);
  const inside = at => at >= 0 && at < size;
  while (work.length || later.length) {
    let pc = work.length ? work.pop() : later.pop();
    while (inside(pc) && !instructions.has(pc)) {
      const lower = word(pc), upper = word(pc + 4), op = lower >>> 25;
      instructions.add(pc);
      const target = pc + 8 + ((lower & 0x7FF) << 21 >> 21) * 8, delay = pc + 8;
      if (upper & 0x40000000) {
        if (inside(delay)) instructions.add(delay);
        break;
      }
      if (vuBranches(lower)) {
        branches.add(pc);
        if (inside(delay)) instructions.add(delay);
        if (never.get(pc) !== TAKEN) work.push(target);
        if (never.get(pc) === NOT_TAKEN) break;
        pc += 16;
        continue;
      }
      if (op === 0x20 || op === 0x28) { if (inside(delay)) instructions.add(delay); pc = target; continue; }
      if (op === 0x21 || op === 0x25) { if (inside(delay)) instructions.add(delay); pc += 16; continue; }
      if (op === 0x24) { if (inside(delay)) instructions.add(delay); break; }
      pc += 8;
    }
  }
  return { instructions, branches };
}

/** What a program holds where it runs: `read(address, count)` gives its bytes there, from its segments as they're
 *  loaded, zeros past what the file holds of one, and nothing outside every segment. */
export function programReader(program) {
  const segments = [];
  if (program.readUInt32BE(0) === 0x7F454C46) {
    for (let i = 0; i < program.readUInt16LE(44); i++) {
      const o = program.readUInt32LE(28) + i * 32;
      if (program.readUInt32LE(o) !== 1) continue;
      segments.push({ address: program.readUInt32LE(o + 8), offset: program.readUInt32LE(o + 4), file: program.readUInt32LE(o + 16), memory: program.readUInt32LE(o + 20) });
    }
  }
  return (address, count) => {
    const segment = segments.find(s => address >= s.address && address < s.address + s.memory);
    if (!segment) return new Uint8Array(0);
    const bytes = new Uint8Array(Math.min(count, segment.address + segment.memory - address)), at = address - segment.address;
    if (at < segment.file) bytes.set(program.subarray(segment.offset + at, segment.offset + Math.min(segment.file, at + bytes.length)));
    return bytes;
  };
}

/** How many bytes of the disc's data a sector is, the disc's content counted a sector at a time. */
export const SECTOR = 2048;

// what's been read of each copy, by its path, size and time, as reading a disc takes a few seconds
const loaded = new Map();
const keyOf = path => {
  const { size, mtimeMs } = statSync(path);
  return `${path} ${size} ${mtimeMs}`;
};
const NOTHING = new Uint8Array(0);

/**
 * Reads what gameplay proven needs of a PlayStation 2 copy, once, from whatever file the disc is in (lib/read-copy.mjs):
 * every piece of code on it, as the code map lists it (functions.mjs), and its disc's sectors that hold anything, as a
 * set of bits, one a sector, those whose 2048 bytes are all the same left out. Resolves to { program, read, cells,
 * codeOf }: the program it boots, `read(address, count)` its bytes where it runs, `cells` { sectors, holds }, or null
 * for a copy that's no disc, and `codeOf(f)` what a function of the code map is made of, { kind, bytes, vuAddress }:
 *
 * - `kind` 'ee' for a function of the program the disc boots or of another EE program, with its `bytes` from that
 *   program, where it runs at its address;
 * - 'iop' for one of a module, with its bytes from the module's code, which the IOP loads wherever it has room;
 * - 'vu' for a vector unit's program, with the bytes of its pairs and `vuAddress`, where the MPG command before them
 *   puts them in the unit's code memory, or null when no command is there.
 *
 * `modules` maps what the emulator says of a module the IOP loaded, the FNV-1a hash of the bytes it loads, to
 * { program, textAt, load }: the module's name in the code map, where its code starts in what's loaded, and the
 * address the code map counts its functions from. Once it has, loadedCopy gives it at once.
 */
export async function loadCopy(path) {
  const key = keyOf(path);
  if (loaded.has(key)) return loaded.get(key);
  const code = await ps2Disc(path), boot = code.boot, read = programReader(boot);
  // the boot program's bytes at an address: a section's, as a vector unit's program is in one of its own, or a segment's
  const bootBytes = (address, count) => {
    const s = sectionOf(boot, address);
    return s && address + count <= s.address + s.size ? boot.subarray(s.offset + address - s.address, s.offset + address - s.address + count) : read(address, count);
  };
  const programs = new Map(code.programs.map(p => [p.path, p.kind === 'iop' ? { kind: 'iop', ...moduleCode(p.bytes), ...loadedOf(p.bytes) } : { kind: 'ee', read: programReader(p.bytes) }]));
  // each module by the hash of what the IOP loads of it, which is how the emulator names the one it loaded
  const modules = new Map([...programs].filter(([, p]) => p.kind === 'iop' && p.hash !== null).map(([path, p]) => [p.hash, { program: path, textAt: p.textAt, load: p.load }]));
  // the vector unit programs in the disc's other files, each read from its file with the command before it
  const inFiles = [];
  let cells = null;
  const disc = extname(path).toLowerCase() === '.elf' ? null : await openDisc(path);
  if (disc) {
    try {
      const holds = new Uint8Array(Math.ceil(disc.sectors / 8)), chunk = 256;
      for (let first = 0; first < disc.sectors; first += chunk) {
        const count = Math.min(chunk, disc.sectors - first), data = await disc.data(first, count);
        for (let n = 0; n < count; n++) {
          const from = n * SECTOR, value = data[from];
          for (let at = from + 1; at < from + SECTOR; at++) {
            if (data[at] !== value) { holds[(first + n) >> 3] |= 1 << ((first + n) & 7); break; }
          }
        }
      }
      cells = { sectors: disc.sectors, holds };
    } finally {
      await disc.close();
    }
    const uploads = code.uploads.filter(u => u.path);
    if (uploads.length) {
      const files = await discFiles(path);
      try {
        for (const u of uploads) inFiles.push({ path: u.path, at: u.at, bytes: await files.read(u.path, u.at - 4, u.size + 4) });
      } finally {
        await files.close();
      }
    }
  }
  const word = bytes => (bytes.length >= 4 ? (bytes[0] | bytes[1] << 8 | bytes[2] << 16 | bytes[3] << 24) >>> 0 : 0);
  // where an MPG command puts the pairs after it: its last byte says it's one, and its low half the place, in pairs
  const placed = command => ((command >>> 24 & 0x7F) === 0x4A ? (command & 0xFFFF) * 8 : null);
  const codeOf = f => {
    if (f.vu && f.program) {
      const held = inFiles.find(u => u.path === f.program && f.address >= u.at && f.address + f.size <= u.at + u.bytes.length - 4);
      if (!held) return { kind: 'vu', bytes: NOTHING, vuAddress: null };
      const from = placed(word(held.bytes));
      return { kind: 'vu', bytes: held.bytes.subarray(4 + f.address - held.at, 4 + f.address - held.at + f.size), vuAddress: from === null ? null : from + f.address - held.at };
    }
    if (f.vu) return { kind: 'vu', bytes: bootBytes(f.address, f.size), vuAddress: placed(word(bootBytes(f.address - 4, 4))) };
    if (!f.program) return { kind: 'ee', bytes: read(f.address, f.size) };
    const program = programs.get(f.program);
    if (!program) return { kind: 'ee', bytes: NOTHING };
    if (program.kind === 'ee') return { kind: 'ee', bytes: program.read(f.address, f.size) };
    return { kind: 'iop', bytes: program.text.subarray(f.address - program.load, f.address - program.load + f.size) };
  };
  const found = { program: boot, read, cells, codeOf, modules };
  loaded.set(key, found);
  return found;
}

// What the IOP loads of a module, its one loaded stretch as the file holds it: its hash, as the tools' change to Play!
// makes it (play.patch, FNV-1a), and where the module's code starts in it. { hash: null } for a file with none
function loadedOf(module) {
  const none = { hash: null, textAt: 0 };
  if (module.length < 52 || module.readUInt32BE(0) !== 0x7F454C46) return none;
  for (let i = 0; i < module.readUInt16LE(44); i++) {
    const o = module.readUInt32LE(28) + i * 32;
    if (o + 32 > module.length || module.readUInt32LE(o) !== 1) continue;
    const offset = module.readUInt32LE(o + 4), size = module.readUInt32LE(o + 16);
    let hash = 0x811C9DC5;
    for (let at = offset; at < offset + size && at < module.length; at++) hash = Math.imul(hash ^ module[at], 0x01000193);
    const { text } = moduleCode(module);
    return { hash: hash >>> 0, textAt: text.byteOffset - module.byteOffset - offset };
  }
  return none;
}

/** What loadCopy has read of a copy already, at once: it says so when nothing has. */
export function loadedCopy(path) {
  const found = loaded.get(keyOf(path));
  if (!found) throw new Error(`The tools haven't read the PlayStation 2 copy at ${path} yet: lib/proof-files.mjs's prepareCopy reads it first.`);
  return found;
}
