// What gameplay proven needs to know of a PlayStation 2 game (lib/played.mjs): where the instructions of its functions
// are and which are conditional branches, on the EE and the IOP (MIPS) and on the vector units (pairs of an upper and a
// lower instruction), by the same rules as the tools' change to Play! that says what ran (libretro/play.patch); the
// bytes of the program its disc boots, where it runs; and the disc's sectors that hold anything.
//
// A branch whose way the code alone decides, as `beq $zero, $zero`, which is how `b` is written, or `bgez $zero`, is
// no conditional branch: it always goes, and only the conditional ones count each of their two ways.

import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { bootFileSync, discLayout, readDiscFileSync } from '../lib/read-copy.mjs';

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

/** The processor a function of the code map runs on, as the program that plays the original numbers them
 *  (libretro/ran-ps2.h): 0 the EE, where a function with no "cpu" runs, 1 the IOP, 2 and 3 the vector units. */
export const processorOf = f => ({ iop: 1, vu0: 2, vu1: 3 })[f.cpu] ?? 0;

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
  const instructions = new Set(), branches = new Set(), work = [0, ...seeds];
  const inside = at => at >= 0 && at < size;
  while (work.length) {
    let pc = work.pop();
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
  const instructions = new Set(), branches = new Set(), work = [0, ...seeds];
  const inside = at => at >= 0 && at < size;
  while (work.length) {
    let pc = work.pop();
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

/** The program a PlayStation 2 copy boots: an ELF file as it is, or the one its disc's SYSTEM.CNF names. */
export function bootProgram(path) {
  if (extname(path).toLowerCase() === '.elf') return readFileSync(path);
  const name = bootFileSync(path), program = name && readDiscFileSync(path, name);
  if (!program) throw new Error(`The tools couldn't find the program ${path} boots: its SYSTEM.CNF names ${name ?? 'none'}.`);
  return program;
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

// what's been worked out of each disc, by its path, size and time, as reading a disc takes a few seconds
const known = new Map();

/** The disc's sectors that hold anything, as a set of bits, one a sector, those whose 2048 bytes are all the same left
 *  out, and how many sectors it has: { sectors, holds }, or null for a copy that's no disc, such as an ELF file. */
export function discCells(path) {
  const layout = discLayout(path);
  if (!layout) return null;
  const { mtimeMs, size } = statSync(layout.file), key = `${layout.file} ${size} ${mtimeMs}`;
  if (known.has(key)) return known.get(key);
  const holds = new Uint8Array(Math.ceil(layout.sectors / 8)), fd = openSync(layout.file, 'r');
  const chunk = 512, buffer = Buffer.alloc(chunk * layout.sector);
  try {
    for (let first = 0; first < layout.sectors; first += chunk) {
      const count = Math.min(chunk, layout.sectors - first);
      readSync(fd, buffer, 0, count * layout.sector, first * layout.sector);
      for (let n = 0; n < count; n++) {
        const from = n * layout.sector + layout.data, value = buffer[from];
        let same = true;
        for (let at = from + 1; at < from + SECTOR; at++) if (buffer[at] !== value) { same = false; break; }
        if (!same) holds[(first + n) >> 3] |= 1 << ((first + n) & 7);
      }
    }
  } finally {
    closeSync(fd);
  }
  const found = { sectors: layout.sectors, holds };
  known.set(key, found);
  return found;
}
