// Branch ways a PlayStation 2 game's code itself rules out (docs/STANDARD.md#done), as lib/decided.mjs finds a Game Boy
// Advance's: a conditional branch of the EE compares two registers, or one against zero, and where the straight run of
// instructions before it sets both from numbers in the code alone, it always goes the same way. That's worked out from
// the program the disc boots, with nothing played: the run is read forward from its start with every register unknown
// but $zero, each instruction changing what's known as the processor would, and the branch is decided only if what it
// compares is known when it's reached. The run starts after the last place anything could arrive from elsewhere: no
// instruction of the program branches, jumps or calls into it, no call in it comes back into it, and no word of the
// program holds an address in it, so nothing gets to the branch but through the whole run.

import { branchKind, mipsInstructionsOf } from './ledger.mjs';

const u32 = n => n >>> 0;
const signed16 = word => (word & 0xFFFF) << 16 >> 16;

/** Runs one EE instruction over what's known, `r` 32 numbers or nulls, the low 32 bits of each register. */
export function stepMips(r, w) {
  const op = w >>> 26, rs = w >>> 21 & 31, rt = w >>> 16 & 31, rd = w >>> 11 & 31, sa = w >>> 6 & 31, funct = w & 63, imm = signed16(w);
  const set = (to, value) => { if (to) r[to] = value === null ? null : u32(value); };
  const both = (a, b, f) => (a === null || b === null ? null : f(a, b));
  switch (op) {
    case 0x00:
      if (funct === 0x00) return set(rd, r[rt] === null ? null : r[rt] << sa);
      if (funct === 0x02) return set(rd, r[rt] === null ? null : r[rt] >>> sa);
      if (funct === 0x03) return set(rd, r[rt] === null ? null : r[rt] >> sa);
      if (funct === 0x21 || funct === 0x20 || funct === 0x2D || funct === 0x2C) return set(rd, both(r[rs], r[rt], (a, b) => a + b));
      if (funct === 0x23 || funct === 0x22 || funct === 0x2F || funct === 0x2E) return set(rd, both(r[rs], r[rt], (a, b) => a - b));
      if (funct === 0x24) return set(rd, both(r[rs], r[rt], (a, b) => a & b));
      if (funct === 0x25) return set(rd, both(r[rs], r[rt], (a, b) => a | b));
      if (funct === 0x26) return set(rd, both(r[rs], r[rt], (a, b) => a ^ b));
      if (funct === 0x27) return set(rd, both(r[rs], r[rt], (a, b) => ~(a | b)));
      if (funct === 0x2A) return set(rd, both(r[rs], r[rt], (a, b) => ((a | 0) < (b | 0) ? 1 : 0)));
      if (funct === 0x2B) return set(rd, both(r[rs], r[rt], (a, b) => (a < b ? 1 : 0)));
      // anything else that writes a register leaves it unknown, and those that write none leave everything
      if (![0x08, 0x0C, 0x0D, 0x0F, 0x11, 0x13, 0x1A, 0x1B].includes(funct) && !(funct >= 0x30 && funct <= 0x36)) set(rd, null);
      return undefined;
    case 0x08: case 0x09: case 0x18: case 0x19: return set(rt, r[rs] === null ? null : r[rs] + imm);
    case 0x0A: return set(rt, r[rs] === null ? null : ((r[rs] | 0) < imm ? 1 : 0));
    case 0x0B: return set(rt, r[rs] === null ? null : (r[rs] < u32(imm) ? 1 : 0));
    case 0x0C: return set(rt, r[rs] === null ? null : r[rs] & (w & 0xFFFF));
    case 0x0D: return set(rt, r[rs] === null ? null : r[rs] | (w & 0xFFFF));
    case 0x0E: return set(rt, r[rs] === null ? null : r[rs] ^ (w & 0xFFFF));
    case 0x0F: return set(rt, (w & 0xFFFF) << 16);
    // loads, the multimedia instructions and moves from a coprocessor leave what they write unknown
    case 0x1A: case 0x1B: case 0x1E: case 0x20: case 0x21: case 0x22: case 0x23: case 0x24: case 0x25: case 0x26: case 0x27: case 0x37: return set(rt, null);
    case 0x1C: return set(rd, null);
    case 0x10: case 0x11: case 0x12: if (rs <= 2) set(rt, null); return undefined;
    default: return undefined;
  }
}

/** Which way an EE conditional branch goes with these registers known: TAKEN's word, 'taken' or 'not taken', or null
 *  when what it compares isn't known. */
export function wayOf(r, w) {
  const op = w >>> 26, rs = w >>> 21 & 31, rt = w >>> 16 & 31;
  const a = r[rs], b = r[rt];
  const way = goes => (goes === null ? null : goes ? 'taken' : 'not taken');
  switch (op) {
    case 0x04: case 0x14: return way(a === null || b === null ? null : a === b);
    case 0x05: case 0x15: return way(a === null || b === null ? null : a !== b);
    case 0x06: case 0x16: return way(a === null ? null : (a | 0) <= 0);
    case 0x07: case 0x17: return way(a === null ? null : (a | 0) > 0);
    case 0x01: return way(a === null ? null : rt & 1 ? (a | 0) >= 0 : (a | 0) < 0);
    default: return null;
  }
}

const word = (bytes, at) => (bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16 | bytes[at + 3] << 24) >>> 0;

/**
 * Where anything can arrive in the program from elsewhere: every target of a branch, a jump or a call of its code, every
 * place after a call's delay slot, where it comes back to, and every word of the program that holds an address of its
 * code. `functions` are the code map's, `read(address, count)` the program's bytes where they run, and `words` every word
 * the program holds, data and code. A Set of addresses.
 */
export function arrivalsOf(functions, read, words) {
  const arrivals = new Set(), ranges = functions.filter(f => !f.cpu).map(f => [f.address, f.address + f.size]).sort((x, y) => x[0] - y[0]);
  const inCode = address => {
    let low = 0, high = ranges.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (address < ranges[middle][0]) high = middle - 1;
      else if (address >= ranges[middle][1]) low = middle + 1;
      else return true;
    }
    return false;
  };
  for (const f of functions) {
    if (f.cpu) continue;
    const bytes = read(f.address, f.size);
    arrivals.add(f.address);
    for (let at = 0; at + 4 <= bytes.length; at += 4) {
      const w = word(bytes, at), op = w >>> 26, pc = f.address + at;
      if (branchKind(w) || op === 0x04 || op === 0x14 || op === 0x06 || op === 0x16 || op === 0x01) arrivals.add(pc + 4 + signed16(w) * 4);
      if (op === 0x02 || op === 0x03) arrivals.add(u32((pc + 4) & 0xF0000000 | (w & 0x3FFFFFF) << 2));
      if (op === 0x03 || (op === 0 && (w & 63) === 0x09) || (op === 0x01 && (w >>> 16 & 31) >= 0x10)) arrivals.add(pc + 8);
    }
  }
  for (const value of words) if (inCode(value)) arrivals.add(value);
  return arrivals;
}

/**
 * The branches the EE's code decides, in the code map's EE functions: each { address, way, from, by }, the branch, the
 * way it never goes, where its run starts, and the instruction that compares, the branch itself. `read` and `words`
 * are as arrivalsOf takes them.
 */
export function decidedMipsBranches(functions, read, words) {
  const arrivals = arrivalsOf(functions, read, words), found = [];
  for (const f of functions) {
    if (f.cpu) continue;
    const bytes = read(f.address, f.size), { instructions, branches } = mipsInstructionsOf(bytes, [], new Map(), f.address);
    for (const at of [...branches].sort((a, b) => a - b)) {
      // the run back from the branch to the last place anything arrives, or a jump or a call it can't see past
      let from = at;
      while (from > 0 && instructions.has(from - 4) && !arrivals.has(f.address + from)) {
        const before = word(bytes, from - 4), previous = from >= 8 ? word(bytes, from - 8) : 0, op = previous >>> 26;
        // the instruction before is a delay slot: what was before it went somewhere, or came back from a call
        if (from >= 8 && (branchKind(previous) || [0x02, 0x03, 0x04, 0x14, 0x06, 0x16, 0x01].includes(op) || (op === 0 && [0x08, 0x09].includes(previous & 63)))) break;
        if (branchKind(before) || before >>> 26 === 0x02 || before >>> 26 === 0x03) break;
        from -= 4;
      }
      const r = new Array(32).fill(null);
      r[0] = 0;
      for (let pc = from; pc < at; pc += 4) {
        stepMips(r, word(bytes, pc));
        r[0] = 0;
      }
      const goes = wayOf(r, word(bytes, at));
      if (goes) found.push({ address: f.address + at, way: goes === 'taken' ? 'not taken' : 'taken', from: f.address + from, by: f.address + at });
    }
  }
  return found;
}

/** Why a branch the code decides can't go its other way, for the game's unreachable.json. */
export function decidedMipsWhy({ address, way, from }) {
  const hex = n => n.toString(16).toUpperCase().padStart(8, '0');
  return `The branch at ${hex(address)} compares registers the instructions from ${hex(from)} set from numbers in the code alone, a run that no instruction of the program branches, jumps or calls into and no word of the program points into, so it's never ${way}.`;
}
