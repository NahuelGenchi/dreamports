// The functions in a PlayStation game's program, for its code map (codemap.mjs): the program its disc boots, as
// SYSTEM.CNF names it, or a program given as a PS-X EXE, read from the player's copy on their computer. Addresses are
// where the program runs, from where its header says it's loaded, as a disassembler such as Ghidra shows them, so a
// list from one fits.
//
// A PS-X EXE keeps its code and its values together, with nothing to say which is which, so the functions are found by
// reading it, as the PlayStation 2's are (../ps2/functions.mjs): where it starts, every call's target (JAL), every
// function's opening (ADDIU sp, sp, -n) right after the end of the one before, and every word of the program that
// holds the address of such an opening, as games keep tables of functions to call through a pointer. A function ends
// at its last return or jump away that no branch of its own goes past: JR ra, a jump to a fixed address, as a call to
// the BIOS is, a J, or a branch back that always goes, each with its delay slot. A JR through any other register is a
// switch, whose cases follow it. Then what's left between two functions, past any zeros, is a function too when every
// word of it is an instruction and it ends so, as a function no call or opening finds does, and isn't otherwise, as a
// program's values aren't. A function reached only through a pointer, opening another way, and running on into the
// next is left in the one before it. Code a game loads from its disc as it runs isn't in the program, and isn't mapped.

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { readDiscFile } from '../lib/read-copy.mjs';

const JR_RA = 0x03E00008;
const HEADER = 0x800;
const isOpening = word => (word >>> 16) === 0x27BD && (word & 0x8000) !== 0;   // ADDIU sp, sp, a negative number
const op = word => word >>> 26, rs = word => (word >>> 21) & 31, rt = word => (word >>> 16) & 31, funct = word => word & 63;

// the R3000A's instructions, by their first six bits, and for SPECIAL and REGIMM by the field that says which: anything
// else is no instruction, as a program's values mostly aren't (the COP2 commands are the geometry processor's)
const PRIMARY = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 32, 33, 34, 35, 36, 37, 38, 40, 41, 42, 43, 46, 50, 58]);
const SPECIAL = new Set([0, 2, 3, 4, 6, 7, 8, 9, 12, 13, 16, 17, 18, 19, 24, 25, 26, 27, 32, 33, 34, 35, 36, 37, 38, 39, 42, 43]);
const REGIMM = new Set([0, 1, 16, 17]);

/** Whether a word is one of the R3000A's instructions. */
export function isInstruction(word) {
  const o = op(word);
  if (!PRIMARY.has(o)) return false;
  if (o === 0) return SPECIAL.has(funct(word));
  if (o === 1) return REGIMM.has(rt(word));
  return true;
}

/** The program in a player's copy: a PS-X EXE as it is, or the one a disc boots, which is PSX.EXE when its SYSTEM.CNF
 *  names none. */
export async function ps1Program(path) {
  if (extname(path).toLowerCase() === '.exe') return readFileSync(path);
  const boot = (await readDiscFile(path, 'SYSTEM.CNF'))?.toString('latin1');
  const name = boot === undefined ? 'PSX.EXE' : /^\s*BOOT\s*=\s*[^\\:]*:\\?([^;\s]+)/im.exec(boot)?.[1] ?? null;
  const program = name && await readDiscFile(path, name);
  if (!program) throw new Error(`The tools couldn't find the program ${path} boots: its SYSTEM.CNF names ${name ?? 'none'}.`);
  return program;
}

/** A PS-X EXE's parts: where it starts, where its code and values are loaded, and those bytes. */
export function exeOf(program) {
  if (program.length < HEADER || program.toString('latin1', 0, 8) !== 'PS-X EXE') throw new Error('This isn\'t a program for the PlayStation\'s processor: it has no PS-X EXE header.');
  const load = program.readUInt32LE(0x18), size = Math.min(program.readUInt32LE(0x1C), program.length - HEADER);
  return { entry: program.readUInt32LE(0x10), gp: program.readUInt32LE(0x14), load, text: program.subarray(HEADER, HEADER + size) };
}

/** Whether an address is in the program as it's loaded. */
export function inCode(program) {
  const { load, text } = exeOf(program);
  return address => address >= load && address < load + text.length;
}

// what a word does to the way the processor goes on: { ends } for a return or a jump away that never comes back
// here, { to } for a branch or jump to an address of the program, `always` when it always goes there
function wayOf(word, address, before) {
  const o = op(word);
  if (o === 0 && funct(word) === 8) {
    if (word === JR_RA) return { ends: true };
    // a jump through a register the instruction before set to a fixed address, as a call to the BIOS is made
    const set = (op(before) === 9 || op(before) === 13) && rs(before) === 0 && rt(before) === rs(word);
    return set ? { ends: true } : { switch: true };
  }
  if (o === 2) return { to: ((address + 4) & 0xF0000000 | (word & 0x3FFFFFF) << 2) >>> 0, always: true };
  const offset = ((word << 16) >> 14) + address + 4;
  if (o >= 4 && o <= 7) return { to: offset >>> 0, always: (o === 4 && rs(word) === 0 && rt(word) === 0) || (o === 6 && rs(word) === 0) };
  if (o === 1 && (rt(word) === 0 || rt(word) === 1)) return { to: offset >>> 0, always: rt(word) === 1 && rs(word) === 0 };
  return {};
}

// Where a function that starts at `start` ends, reading no further than `limit`: after its last return or jump away
// that no branch of its own goes past, with its delay slot, or `limit` if it reaches it first. With `strict`, null
// when a word before that end isn't an instruction.
function endOf(wordAt, start, limit, strict = false) {
  let furthest = start;
  for (let at = start; at + 4 <= limit; at += 4) {
    const word = wordAt(at);
    if (strict && !isInstruction(word)) return null;
    const way = wayOf(word, at, at > start ? wordAt(at - 4) : 0);
    if (way.to !== undefined && way.to > at && way.to < limit) furthest = Math.max(furthest, way.to);
    const goesAway = way.ends || (way.always && (way.to <= at || way.to >= limit));
    if (goesAway && at + 8 > furthest && at + 8 <= limit) {
      if (strict && !isInstruction(wordAt(at + 4))) return null;
      return at + 8;
    }
  }
  return strict ? null : limit;
}

/** The functions in the program, each { address, size }, in order, those in `listed` kept as they are. */
export function findFunctions(program, listed = []) {
  const { entry, load, text } = exeOf(program), end = load + text.length;
  const inside = address => address >= load && address < end && address % 4 === 0;
  const wordAt = address => text.readUInt32LE(address - load);
  const starts = new Map();
  for (const f of listed) if (!starts.has(f.address)) starts.set(f.address, f.size);
  if (inside(entry) && !starts.has(entry)) starts.set(entry, 0);
  for (let address = load; address + 4 <= end; address += 4) {
    const word = wordAt(address);
    // a call's target, in the same 256 MB as the call
    if (op(word) === 3) {
      const target = ((address + 4) & 0xF0000000 | (word & 0x3FFFFFF) << 2) >>> 0;
      if (inside(target) && !starts.has(target)) starts.set(target, 0);
    }
    // an opening right after a return, its delay slot and any zeros
    if (isOpening(word) && !starts.has(address)) {
      let back = address - 4;
      while (back >= load && wordAt(back) === 0) back -= 4;
      if (back - 4 >= load && (wordAt(back - 4) === JR_RA || wordAt(back) === JR_RA)) starts.set(address, 0);
    }
    // a word that holds the address of an opening, as a table of functions does
    if (inside(word) && !starts.has(word) && isOpening(wordAt(word))) starts.set(word, 0);
  }
  // each function to its end, and then what's left before the next one, read as a function if it ends as one
  const ordered = [...starts.keys()].sort((a, b) => a - b), functions = [];
  for (let i = 0; i < ordered.length; i++) {
    const address = ordered[i], next = ordered[i + 1] ?? end;
    const size = starts.get(address) || endOf(wordAt, address, next) - address;
    functions.push({ address, size: Math.min(size, end - address) });
    for (let at = address + size; at < next;) {
      while (at < next && wordAt(at) === 0) at += 4;
      const found = at < next ? endOf(wordAt, at, next, true) : null;
      if (found === null) break;
      functions.push({ address: at, size: found - at });
      at = found;
    }
  }
  // a function that runs on past the end of the one before is cut, so none overlap, and none is empty
  return functions.map((f, i) => ({ ...f, size: Math.max(4, Math.min(f.size, (functions[i + 1]?.address ?? Infinity) - f.address)) }));
}

/** Of the functions in a list, those that start outside the program's code. */
export function startsInData(program, listed) {
  const inside = inCode(program);
  return listed.filter(({ address }) => !inside(address));
}
