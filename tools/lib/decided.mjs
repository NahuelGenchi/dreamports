// Branch ways the code itself rules out (docs/STANDARD.md#done): a conditional branch goes by the flags, and where
// the straight run of instructions before it sets those flags from numbers in the code alone, it always goes the same
// way, whatever the game is doing. That's worked out here from the cartridge's bytes, with nothing played: the run is
// read forward from its start with every register and flag unknown, each instruction changing what's known as the
// processor would, and the branch is decided only if the flags its condition reads are all known when it's reached.
// The run starts after the last place anything could arrive from elsewhere: no instruction of the cartridge branches
// or calls into it, and no word of the cartridge holds an address in it, so nothing gets to the branch but through the
// whole run. Where only one conditional branch of the function's own comes into the run's start, and nothing falls
// into it, the run starts as that branch left things, with what it compared: the register its comparison read is
// equal to the number, or isn't, as the way into the run says (#1751). A branch the run passes by says the same. Only
// Thumb code is read, as nearly all of a Game Boy Advance game is.

import { instructionsOf } from './played.mjs';

const CARTRIDGE = 0x08000000;
const u32 = n => n >>> 0;

/** The flags an addition or a subtraction leaves, as the processor sets them: { n, z, c, v }. */
function arithmetic(a, b, subtract) {
  const result = u32(subtract ? a - b : a + b);
  const c = subtract ? a >= b : a + b > 0xFFFFFFFF;
  const v = subtract ? ((a ^ b) & (a ^ result)) >>> 31 === 1 : (~(a ^ b) & (a ^ result)) >>> 31 === 1;
  return { result, n: result >>> 31 === 1, z: result === 0, c, v };
}

/** Whether a condition holds with these flags, or null when it reads one that isn't known. */
export function holds(condition, { n, z, c, v }) {
  const all = (...flags) => flags.every(flag => flag !== null);
  switch (condition) {
    case 0x0: return z;
    case 0x1: return z === null ? null : !z;
    case 0x2: return c;
    case 0x3: return c === null ? null : !c;
    case 0x4: return n;
    case 0x5: return n === null ? null : !n;
    case 0x6: return v;
    case 0x7: return v === null ? null : !v;
    case 0x8: return all(c, z) ? c && !z : null;
    case 0x9: return all(c, z) ? !c || z : null;
    case 0xA: return all(n, v) ? n === v : null;
    case 0xB: return all(n, v) ? n !== v : null;
    case 0xC: return all(n, z, v) ? !z && n === v : null;
    case 0xD: return all(n, z, v) ? z || n !== v : null;
    default: return null;
  }
}

/**
 * Runs one Thumb instruction over what's known: `state` is { r: sixteen numbers or nulls, n, z, c, v: true, false or
 * null }, `op` the instruction, `pc` its address, and `word(address)` reads a word of the cartridge. It changes
 * `state` and returns whether the instruction set a flag. An instruction it doesn't know leaves nothing known.
 */
export function step(state, op, pc, word) {
  const { r } = state;
  const flags = ({ n, z, c, v }) => { state.n = n; state.z = z; if (c !== undefined) state.c = c; if (v !== undefined) state.v = v; return true; };
  const logical = result => flags({ n: result === null ? null : result >>> 31 === 1, z: result === null ? null : result === 0 });
  const unknownFlags = () => flags({ n: null, z: null, c: null, v: null });
  const forget = () => { r.fill(null); unknownFlags(); return true; };
  if ((op & 0xE000) === 0x0000 && (op & 0x1800) !== 0x1800) {
    // LSL, LSR, ASR by a number
    const kind = op >> 11 & 3, by = op >> 6 & 31, from = r[op >> 3 & 7], to = op & 7;
    if (from === null) { r[to] = null; return unknownFlags(); }
    let result, c;
    if (kind === 0) { result = u32(from << by); c = by ? (from >>> (32 - by) & 1) === 1 : state.c; }
    else if (kind === 1) { result = by ? from >>> by : 0; c = (from >>> ((by || 32) - 1) & 1) === 1; }
    else { result = u32(by ? from >> by : from >> 31); c = (from >>> ((by || 32) - 1) & 1) === 1; }
    r[to] = result;
    return flags({ n: result >>> 31 === 1, z: result === 0, c });
  }
  if ((op & 0xF800) === 0x1800) {
    // ADD, SUB of three: a register or a small number
    const a = r[op >> 3 & 7], b = op & 0x0400 ? op >> 6 & 7 : r[op >> 6 & 7], to = op & 7;
    if (a === null || b === null) { r[to] = null; return unknownFlags(); }
    const done = arithmetic(a, b, (op & 0x0200) !== 0);
    r[to] = done.result;
    return flags(done);
  }
  if ((op & 0xE000) === 0x2000) {
    // MOV, CMP, ADD, SUB with a number
    const kind = op >> 11 & 3, to = op >> 8 & 7, number = op & 0xFF;
    if (kind === 0) { r[to] = number; return logical(number); }
    if (r[to] === null) return unknownFlags();
    const done = arithmetic(r[to], number, kind !== 2);
    if (kind !== 1) r[to] = done.result;
    return flags(done);
  }
  if ((op & 0xFC00) === 0x4000) {
    const kind = op >> 6 & 15, from = r[op >> 3 & 7], to = op & 7, a = r[to];
    const known = a !== null && from !== null;
    switch (kind) {
      case 0x0: r[to] = known ? u32(a & from) : null; return logical(r[to]);
      case 0x1: r[to] = known ? u32(a ^ from) : null; return logical(r[to]);
      case 0x8: return logical(known ? u32(a & from) : null);
      case 0x9: { if (from === null) { r[to] = null; return unknownFlags(); } const done = arithmetic(0, from, true); r[to] = done.result; return flags(done); }
      case 0xA: return known ? flags(arithmetic(a, from, true)) : unknownFlags();
      case 0xB: return known ? flags(arithmetic(a, from, false)) : unknownFlags();
      case 0xC: r[to] = known ? u32(a | from) : null; return logical(r[to]);
      case 0xE: r[to] = known ? u32(a & ~from) : null; return logical(r[to]);
      case 0xF: r[to] = from === null ? null : u32(~from); return logical(r[to]);
      // shifts by a register, ADC, SBC, ROR and MUL: what they leave isn't followed
      default: r[to] = null; return unknownFlags();
    }
  }
  if ((op & 0xFC00) === 0x4400) {
    // ADD, CMP, MOV of the high registers, and BX
    const kind = op >> 8 & 3, from = op >> 3 & 15, to = (op & 7) | (op >> 4 & 8);
    // where the code is isn't a number in the code: a game runs copies of its functions from its work RAM
    const value = from === 15 ? null : r[from];
    if (kind === 0) { r[to] = r[to] === null || value === null ? null : u32(r[to] + value); return false; }
    if (kind === 1) return r[to] === null || value === null ? unknownFlags() : flags(arithmetic(r[to], value, true));
    if (kind === 2) { r[to] = value; return false; }
    return forget();
  }
  if ((op & 0xF800) === 0x4800) { r[op >> 8 & 7] = word(((pc + 4) & ~3) + (op & 0xFF) * 4); return false; }   // LDR from the numbers beside the code
  if ((op & 0xF000) === 0x5000 || (op & 0xE000) === 0x6000 || (op & 0xF000) === 0x8000 || (op & 0xF000) === 0x9000) {
    // a read from memory leaves something unknown; a write changes no register
    const load = (op & 0xF000) === 0x5000 ? (op & 0x0E00) !== 0x0000 && (op & 0x0E00) !== 0x0200 && (op & 0x0E00) !== 0x0400 : (op & 0x0800) !== 0;
    if (load) r[(op & 0xF000) === 0x9000 ? op >> 8 & 7 : op & 7] = null;
    return false;
  }
  if ((op & 0xF000) === 0xA000) { r[op >> 8 & 7] = null; return false; }   // an address from pc or sp, which depends on where the code is
  if ((op & 0xFF00) === 0xB000) return false;                                   // ADD to sp
  if ((op & 0xFE00) === 0xB400) return false;                                   // PUSH
  if ((op & 0xFE00) === 0xBC00) { for (let i = 0; i < 8; i++) if (op >> i & 1) r[i] = null; return false; }   // POP
  if ((op & 0xF000) === 0xC000) {
    // STMIA and LDMIA move the base, and LDMIA fills its registers
    r[op >> 8 & 7] = null;
    if (op & 0x0800) for (let i = 0; i < 8; i++) if (op >> i & 1) r[i] = null;
    return false;
  }
  if ((op & 0xF000) === 0xD000 && (op >> 8 & 0xF) < 0xE) return false;          // a conditional branch not taken changes nothing
  // a call, a software interrupt, and anything else: nothing is known after it
  return forget();
}

/**
 * Every address something in the cartridge may arrive at from elsewhere, with where from: the targets of each branch
 * and call of the functions' code, each with the addresses of the branches and calls that go there, and every address
 * of the cartridge a word of it holds, whatever that word is, with WORD. A Map of each address to a Set of those.
 * `rom` is the cartridge's bytes and `functions` the code map's, those in the cartridge.
 */
export function arrivals(rom, functions) {
  const targets = new Map();
  const add = (target, from) => {
    if (!targets.has(target)) targets.set(target, new Set());
    targets.get(target).add(from);
  };
  const view = new DataView(rom.buffer, rom.byteOffset, rom.length - rom.length % 4);
  for (let at = 0; at + 4 <= view.byteLength; at += 4) {
    const value = view.getUint32(at, true);
    if (value >= CARTRIDGE && value < CARTRIDGE + rom.length) add(value & ~1, WORD);
  }
  for (const f of functions) {
    const start = f.address - CARTRIDGE, bytes = rom.subarray(start, start + f.size);
    const u16 = at => bytes[at] | bytes[at + 1] << 8;
    const { instructions } = instructionsOf(bytes);
    if (isArm(bytes)) continue;
    for (const at of instructions) {
      const op = u16(at), from = f.address + at;
      if ((op & 0xF000) === 0xD000 && (op >> 8 & 0xF) < 0xE) add(from + 4 + ((op & 0xFF) << 24 >> 23), from);
      else if ((op & 0xF800) === 0xE000) add(from + 4 + ((op & 0x7FF) << 21 >> 20), from);
      else if ((op & 0xF800) === 0xF000 && at + 4 <= bytes.length && (u16(at + 2) & 0xF800) === 0xF800) {
        add(u32(from + 4 + ((op & 0x7FF) << 21 >> 9) + ((u16(at + 2) & 0x7FF) << 1)), from);
      }
    }
  }
  return targets;
}

/** What arrivals gives for an address a word of the cartridge holds. */
export const WORD = 'word';

// a function in ARM instructions, by its first words, as instructionsOf tells them
function isArm(bytes) {
  if (bytes.length < 16 || bytes.length % 4) return false;
  const word = at => (bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16 | bytes[at + 3] << 24) >>> 0;
  return [0, 4, 8, 12].map(word).filter(w => w >>> 28 === 0xE).length >= 3;
}

// how many branches, one into the run of another, a run is read through
const DEEPEST = 8;

// Whether an instruction goes on to the one after it: an unconditional branch, a return and a jump don't. The second
// half of a call's two is a call, which comes back.
const goesOn = op => !((op & 0xF800) === 0xE000 || (op & 0xFF00) === 0xBD00 || (op & 0xFF87) === 0x4700 || (op & 0xFF87) === 0x4687);

// A state of the run, as step takes it, with what's known of a register that isn't known as a number: `not`, the number
// each isn't, and `zOf`, the register and number the zero flag says are equal or not, as the last comparison left it.
// Whatever writes a register forgets both of it.
function fresh() {
  const not = new Array(16).fill(null), state = { not, zOf: null, n: null, z: null, c: null, v: null };
  state.r = new Proxy(new Array(16).fill(null), {
    set(r, key, value) {
      r[key] = value;
      if (/^\d+$/.test(key)) {
        not[key] = null;
        if (state.zOf?.reg === Number(key)) state.zOf = null;
      }
      return true;
    },
  });
  return state;
}

// What a comparison of a register the run doesn't know with a number it knows, `cmp` with an immediate or with another
// register, tells beyond what step worked out: what the zero flag says of the register, and the flags the number
// decides, as the carry of anything compared with 0, or of 0 compared with a register known not to be 0. `before` is
// what the registers held before it.
function compared(state, op, before) {
  let reg, value, reversed = false;
  if ((op & 0xF800) === 0x2800) [reg, value] = [op >> 8 & 7, op & 0xFF];
  else if ((op & 0xFFC0) === 0x4280 || (op & 0xFF00) === 0x4500) {
    const high = (op & 0xFF00) === 0x4500, a = high ? (op & 7) | (op >> 4 & 8) : op & 7, b = op >> 3 & (high ? 15 : 7);
    if (a === 15 || b === 15) return;
    if (before[a] === null && before[b] !== null) [reg, value] = [a, before[b]];
    else if (before[a] !== null && before[b] === null) [reg, value, reversed] = [b, before[a], true];
    else return;
  } else return;
  if (before[reg] !== null) return;
  state.zOf = { reg, value };
  if (state.not[reg] === value) state.z = false;
  // the carry is the first at least the second, unsigned: anything is at least 0, and 0 is at least only 0, and
  // nothing less 0 overflows
  if (value === 0 && !reversed) Object.assign(state, { c: true, v: false });
  else if (value === 0 && state.not[reg] === 0) state.c = false;
}

// What a branch on the zero flag going one way says of the register the last comparison read: it's equal to the
// number, or it isn't.
function went(state, condition, taken) {
  if (!state.zOf || (condition !== 0x0 && condition !== 0x1)) return;
  const { reg, value } = state.zOf, equal = (condition === 0x0) === taken;
  if (equal) state.r[reg] = value;
  else state.not[reg] = value;
  state.z = equal;
}

/**
 * The conditional branches of one function the code decides: each as { address, way, from, by, through }, `way` the
 * one that can't happen ("taken" or "not taken"), `from` where the run that decides it starts, `by` the instruction
 * that set the flags it goes by, and `through` the branch the run is entered by, when only it comes there, or null.
 * `bytes` are the function's, at `address`, `word(address)` reads a word of the cartridge and `targets` is what
 * arrivals gives.
 */
export function decidedIn(bytes, address, word, targets) {
  if (isArm(bytes)) return [];
  const u16 = at => bytes[at] | bytes[at + 1] << 8;
  const { instructions, branches } = instructionsOf(bytes);
  // back from an instruction over those that lead straight to it, to the last place anything else can arrive at
  const startOf = at => {
    let start = at;
    while (start >= 2 && instructions.has(start - 2) && !targets.has(address + start) && goesOn(u16(start - 2))) start -= 2;
    return start;
  };
  // what's known as the run from `start` begins: as the one branch of the function's own that comes there left it,
  // gone that way, when nothing else comes there and nothing falls into it, or else nothing
  const entry = (start, depth) => {
    const from = targets instanceof Map ? targets.get(address + start) : null;
    const source = from?.size === 1 ? [...from][0] - address : null;
    if (depth >= DEEPEST || source === null || !branches.has(source) || (instructions.has(start - 2) && goesOn(u16(start - 2)))) return { state: fresh(), through: null };
    const op = u16(source);
    if ((op & 0xF000) !== 0xD000 || (op >> 8 & 0xF) >= 0xE) return { state: fresh(), through: null };
    const { state } = runTo(source, depth + 1);
    if (holds(op >> 8 & 0xF, state) === false) return { state: fresh(), through: null };
    went(state, op >> 8 & 0xF, true);
    return { state, through: address + source };
  };
  // the run that leads to the instruction at `at`, as it leaves things there, and the last instruction of it that set
  // the flags
  const runTo = (at, depth) => {
    const start = startOf(at), { state, through } = entry(start, depth);
    let by = null;
    for (let pc = start; pc < at; pc += 2) {
      const op = u16(pc), before = [...state.r];
      if (step(state, op, address + pc, word)) {
        by = address + pc;
        state.zOf = null;
        compared(state, op, before);
      }
      // a branch passed by went its other way
      if ((op & 0xF000) === 0xD000 && (op >> 8 & 0xF) < 0xE) went(state, op >> 8 & 0xF, false);
    }
    return { state, start, by, through };
  };
  const found = [];
  for (const at of [...branches].sort((a, b) => a - b)) {
    // the run alone first, and then, only where that decides nothing, entered by the branch that comes into it
    for (const entered of [false, true]) {
      const { state, start, by, through } = runTo(at, entered ? 0 : DEEPEST);
      if (start === at) break;
      const taken = holds(u16(at) >> 8 & 0xF, state);
      if (taken === null || by === null) continue;
      found.push({ address: address + at, way: taken ? 'not taken' : 'taken', from: address + start, by, through });
      break;
    }
  }
  return found;
}

/** Every conditional branch of the cartridge's functions the code decides, as decidedIn gives them. */
export function decidedBranches(rom, functions) {
  const inRom = functions.filter(f => !f.bytes && f.address >= CARTRIDGE && f.address + f.size <= CARTRIDGE + rom.length);
  const targets = arrivals(rom, inRom);
  const view = new DataView(rom.buffer, rom.byteOffset, rom.length);
  const word = address => (address >= CARTRIDGE && address + 4 <= CARTRIDGE + rom.length ? view.getUint32(address - CARTRIDGE, true) : null);
  return inRom.flatMap(f => decidedIn(rom.subarray(f.address - CARTRIDGE, f.address - CARTRIDGE + f.size), f.address, word, targets));
}
