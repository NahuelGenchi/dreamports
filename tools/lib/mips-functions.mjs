// The functions in a program for a console's MIPS processor, found by reading it, for its code map (../codemap.mjs): a
// PlayStation game's program (../ps1/functions.mjs), a PlayStation 2 game's modules for its second processor
// (../ps2/functions.mjs), the code a Nintendo 64 game's cartridge starts (../n64/functions.mjs), and a PlayStation
// Portable game's program (../psp/functions.mjs).
//
// Such a program keeps its code and its values together, with nothing to say which is which, so the functions are found
// by reading it: where it starts, every call's target (JAL), every function's opening (ADDIU sp, sp, -n, or on the
// VR4300 DADDIU) right after the end of the one before, and every word of the program that holds the address of such an
// opening, as games keep tables of functions to call through a pointer. A function ends at its last return or jump away
// that no branch of its own goes past: JR ra, a jump to a fixed address, as a call to the PlayStation's BIOS is, a J, a
// branch back that always goes, each with its delay slot, or on the VR4300 an ERET, which has none. A JR through any
// other register is a switch, whose cases follow it. Then what's left between two functions, past any zeros, is a
// function too when every word of it is an instruction and it ends so, as a function no call or opening finds does,
// and isn't otherwise, as a program's values aren't. A function reached only through a pointer, opening another way, and
// running on into the next is left in the one before it.

import { isInstruction } from './mips.mjs';

const JR_RA = 0x03E00008;
const op = word => word >>> 26, rs = word => (word >>> 21) & 31, rt = word => (word >>> 16) & 31, funct = word => word & 63;

// ADDIU sp, sp, a negative number, or on the VR4300 DADDIU too
const openingOf = processor => processor === 'vr4300'
  ? word => ((word >>> 16) === 0x27BD || (word >>> 16) === 0x67BD) && (word & 0x8000) !== 0
  : word => (word >>> 16) === 0x27BD && (word & 0x8000) !== 0;

// what a word does to the way the processor goes on: { ends } for a return or a jump away that never comes back
// here, with `slot: false` when it has no delay slot, { to } for a branch or jump to an address of the program,
// `always` when it always goes there
function wayOf(word, address, before, processor) {
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
  if (processor === 'vr4300' || processor === 'allegrex') {
    // a likely branch, which runs its delay slot only when it goes, and a branch on the floating-point unit's condition
    if (o >= 20 && o <= 23) return { to: offset >>> 0, always: (o === 20 && rs(word) === 0 && rt(word) === 0) || (o === 22 && rs(word) === 0) };
    if (o === 1 && (rt(word) === 2 || rt(word) === 3)) return { to: offset >>> 0, always: rt(word) === 3 && rs(word) === 0 };
    if (o === 17 && rs(word) === 8) return { to: offset >>> 0 };
    // and on the Allegrex, a branch on one of its vector unit's conditions
    if (processor === 'allegrex' && o === 18 && rs(word) === 8) return { to: offset >>> 0 };
    if (processor === 'vr4300' && word === 0x42000018) return { ends: true, slot: false };
  }
  return {};
}

// Where a function that starts at `start` ends, reading no further than `limit`: after its last return or jump away
// that no branch of its own goes past, with its delay slot, or `limit` if it reaches it first. With `strict`, null
// when a word before that end isn't an instruction.
function endOf(wordAt, start, limit, processor, strict = false) {
  const instruction = word => isInstruction(word, processor);
  let furthest = start;
  for (let at = start; at + 4 <= limit; at += 4) {
    const word = wordAt(at);
    if (strict && !instruction(word)) return null;
    const way = wayOf(word, at, at > start ? wordAt(at - 4) : 0, processor);
    if (way.to !== undefined && way.to > at && way.to < limit) furthest = Math.max(furthest, way.to);
    const goesAway = way.ends || (way.always && (way.to <= at || way.to >= limit));
    const after = at + (way.slot === false ? 4 : 8);
    if (goesAway && after > furthest && after <= limit) {
      if (strict && way.slot !== false && !instruction(wordAt(at + 4))) return null;
      return after;
    }
  }
  return strict ? null : limit;
}

/**
 * The functions in `text`, code for `processor` (lib/mips.mjs) loaded at `load` that starts at `entry`, each
 * { address, size }, in order, those in `listed` kept as they are. `bigEndian` says its words keep their highest byte
 * first, as the Nintendo 64's do.
 */
export function findMipsFunctions({ entry, load, text, processor = 'r3000a', bigEndian = false }, listed = []) {
  const end = load + text.length;
  const isOpening = openingOf(processor);
  const inside = address => address >= load && address < end && address % 4 === 0;
  const wordAt = bigEndian ? address => text.readUInt32BE(address - load) : address => text.readUInt32LE(address - load);
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
    const size = starts.get(address) || endOf(wordAt, address, next, processor) - address;
    functions.push({ address, size: Math.min(size, end - address) });
    for (let at = address + size; at < next;) {
      while (at < next && wordAt(at) === 0) at += 4;
      const found = at < next ? endOf(wordAt, at, next, processor, true) : null;
      if (found === null) break;
      functions.push({ address: at, size: found - at });
      at = found;
    }
  }
  // a function that runs on past the end of the one before is cut, so none overlap, and none is empty
  return functions.map((f, i) => ({ ...f, size: Math.max(4, Math.min(f.size, (functions[i + 1]?.address ?? Infinity) - f.address)) }));
}

/** Of the calls in `text` loaded at `load`, how many go somewhere inside it, `inside`, and how many of those land on a
 *  function's opening, `landed`: where a program's calls say it runs, as a call names its target's address. */
export function callsThatLand({ load, text, processor = 'r3000a', bigEndian = false }) {
  const isOpening = openingOf(processor), end = load + text.length;
  const wordAt = bigEndian ? at => text.readUInt32BE(at) : at => text.readUInt32LE(at);
  let landed = 0, inside = 0;
  for (let at = 0; at + 4 <= text.length; at += 4) {
    const word = wordAt(at);
    if (op(word) !== 3) continue;
    const target = ((load + at + 4) & 0xF0000000 | (word & 0x3FFFFFF) << 2) >>> 0;
    if (target < load || target + 4 > end) continue;
    inside++;
    if (isOpening(wordAt(target - load))) landed++;
  }
  return { landed, inside };
}
