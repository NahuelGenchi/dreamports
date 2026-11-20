// Finds the functions in a Super Nintendo game's cartridge, for its code map: where each one starts, how many bytes it
// takes, and the processor's mode it starts in, and nothing of the code itself.
//
// Reading alone can't tell how long an instruction is: an immediate value is 8 or 16 bits as the processor's flags M
// and X say, and the program changes them as it goes, with REP and SEP. So the code is followed from where the
// console starts it, in the 6502's mode, with the flags carried along through every instruction, branch, jump, call
// and table of addresses a call or a jump goes through, and a function is called in the mode its caller was in. A
// path stops where the flags can't be known by reading: after PLP, an XCE whose carry isn't known, or the start of an
// interrupt's handler until its own REP or SEP. Where play has been seen (libretro/ran.h, with the tools' change to
// Snes9x), each place the processor was sent to, by a call, a jump through a pointer or a return, comes with the mode
// it was in there, so what reading can't reach, or can't know the mode of, is followed from there, as it ran: a map
// made this way holds what was played, and grows with the recordings.
//
// A function's address in the code map is where it is in the cartridge's ROM, its offset from the ROM's first byte,
// past a copier's header, so the banks that show the same ROM twice name it once. A game's code names it by the
// address its code runs at, as `sub_808123`, a word and the bank and address in six hexadecimal digits, in any bank
// that shows that ROM (snesNames).

import { INSTRUCTIONS, isConditional, lengthOf, modeFromBits, modeOf } from './65816.mjs';
import { mapOf, placeIn, readCartridge, ROM } from './cartridge.mjs';

/** A Super Nintendo copy read: { cart, map, rom }, or null for a copy that isn't one the tools lay out. */
export function snesProgram(copy) {
  try {
    const cart = readCartridge(copy);
    return { cart, map: mapOf(cart), rom: cart.rom };
  } catch {
    return null;
  }
}

const programOf = copy => {
  const program = snesProgram(copy);
  if (!program) throw new Error('The tools don\'t lay out this cartridge, so they can\'t follow its code yet: only a plain LoROM, HiROM or ExHiROM.');
  return program;
};

/** The address a ROM offset's code runs at, as the console sees it in the bank code is most often run from: a
 *  LoROM's in banks $80 and up when its ROM is fast, or $00 and up, a HiROM's in banks $C0 and up. */
export function addressOf(offset, cart) {
  if (cart.mapping === 'lorom') return ((offset >> 15) + (cart.speed === 'fast' ? 0x80 : 0)) << 16 | 0x8000 | (offset & 0x7FFF);
  if (cart.mapping === 'exhirom' && offset >= 0x400000) return (0x40 + ((offset - 0x400000) >> 16)) << 16 | (offset & 0xFFFF);
  return (0xC0 + (offset >> 16)) << 16 | (offset & 0xFFFF);
}

/** The name the code map's address has in a game's code: sub_808123. */
export const snesName = (offset, cart) => `sub_${addressOf(offset, cart).toString(16).toUpperCase().padStart(6, '0')}`;

// a name of a function in a game's code: a word, then the bank and the address in six hexadecimal digits
const NAME = /\b[A-Za-z][A-Za-z0-9]*_([0-9A-Fa-f]{6})\b/g;

/** The functions a line of a game's code names, as [name, offset in the ROM], in any bank that shows the ROM. */
export function snesNames(line, map) {
  const names = [];
  for (const [name, digits] of line.matchAll(NAME)) {
    const { what, at } = placeIn(map, parseInt(digits, 16));
    if (what === ROM) names.push([name, at]);
  }
  return names;
}

// where the 65816 jumps in a way the tools follow, by opcode
const JSR = 0x20, JSL = 0x22, JSR_TABLE = 0xFC, JMP = 0x4C, JML = 0x5C, JMP_TABLE = 0x7C, BRA = 0x80, BRL = 0x82;
const ENDS = new Set(['RTS', 'RTL', 'RTI', 'STP', 'JMP absi', 'JML absl']);
// BRK and WDM are instructions, but no game's code runs either on purpose where it's followed: a zero is padding or data
const NOT_CODE = new Set([0x00, 0x42]);
// how many addresses a table of them is read for at most
const TABLE = 256;

const stateMode = s => (s.e ? 'e' : s.m === null || s.x === null ? null : modeOf((s.m ? 0x20 : 0) | (s.x ? 0x10 : 0)));
const fromMode = mode => (mode === 'e' ? { e: true, m: true, x: true } : { e: false, m: mode.startsWith('a8'), x: mode.endsWith('i8') });

/**
 * Follows a cartridge's code from `starts`, each { address, mode, call }, `address` as the console sees it, `mode`
 * one of MODES or null where the flags aren't known, `call` whether something calls it, which makes it a function's
 * start. `hints` gives the mode play saw at some places of the ROM, which wins over what reading carried there. Answers
 * { code, calls, conflicts }: `code` each instruction found, ROM offset → { address, op, length, mode, next }, `next`
 * the places of the ROM it can go on to in the same function; `calls` each ROM offset something calls, with its mode;
 * `conflicts` the places reading reached in two modes.
 */
export function follow({ rom, map }, starts, hints = new Map()) {
  const code = new Map(), calls = new Map(), conflicts = new Set(), tables = new Set();
  // the places of the ROM an instruction names, in its own bank or by a long address: where something starts, which a
  // table before it doesn't run into
  const named = new Set();
  const romAt = address => {
    const { what, at } = placeIn(map, address);
    return what === ROM && at < rom.length ? at : -1;
  };
  const inBank = (address, low) => (address & 0xFF0000) | (low & 0xFFFF);
  const queue = [];
  const push = (address, state, call) => queue.push({ address, state, call });
  for (const s of starts) push(s.address, s.mode ? fromMode(s.mode) : { e: false, m: null, x: null }, s.call);
  // a table of 16-bit addresses in the bank, read once the code around it is known, until an address isn't the ROM's,
  // the table runs into code, or an address points into the table itself or into the middle of an instruction
  const startsInside = at => {
    for (let back = 1; back < 4; back++) {
      const before = code.get(at - back);
      if (before && before.length > back) return true;
    }
    return false;
  };
  const table = (at, bank) => {
    const out = [];
    for (let i = 0; i < TABLE; i++) {
      const here = romAt(inBank(bank, at + i * 2));
      if (here < 0 || code.has(here) || code.has(here + 1) || startsInside(here) || (i && named.has(here))) break;
      const target = inBank(bank, rom[here] | rom[here + 1] << 8), to = romAt(target);
      if (to < 0 || startsInside(to)) break;
      if ((target & 0xFFFF) >= (at & 0xFFFF) && (target & 0xFFFF) < (at & 0xFFFF) + 2 * (i + 1)) break;
      out.push(target);
    }
    return out;
  };
  const pending = [];
  for (;;) {
    if (!queue.length) {
      // the tables of addresses met, now that the code around them is known
      if (!pending.length) break;
      for (const { tableAt, bank, call, state, from } of pending.splice(0)) {
        for (const target of table(tableAt, bank)) {
          if (!call) from.next.push(romAt(target));
          push(target, { ...state }, call);
        }
      }
      continue;
    }
    let { address, state, call } = queue.pop();
    let carry;
    for (;;) {
      const at = romAt(address);
      if (at < 0) break;
      const hint = hints.get(at);
      if (hint) state = fromMode(hint);
      const mode = stateMode(state);
      if (call) {
        const known = calls.get(at);
        if (known === undefined || (known === null && mode)) calls.set(at, mode);
        else if (mode && known !== mode) conflicts.add(at);
        call = false;
      }
      const seen = code.get(at);
      if (seen) {
        if (mode && seen.mode && seen.mode !== mode) conflicts.add(at);
        if (seen.mode || !mode) break;
      }
      const op = rom[at], { name, mode: way } = INSTRUCTIONS[op];
      if (NOT_CODE.has(op)) break;
      if ((way === 'imm' && state.m === null) || (way === 'immx' && state.x === null)) break;
      const length = lengthOf(op, way === 'imm' ? (state.m ? 'a8i8' : 'a16i8') : way === 'immx' ? (state.x ? 'a8i8' : 'a8i16') : 'a8i8');
      const operand = length > 1 ? rom[at + 1] | (length > 2 ? rom[at + 2] << 8 : 0) | (length > 3 ? rom[at + 3] << 16 : 0) : 0;
      const after = inBank(address, address + length);
      const instruction = { address, op, length, mode, next: [] };
      if (/^abs|^long/.test(way)) {
        const there = romAt(way.startsWith('long') ? operand : inBank(address, operand));
        if (there >= 0) named.add(there);
      }
      code.set(at, instruction);
      const go = to => {
        instruction.next.push(romAt(to));
        push(to, { ...state }, false);
      };
      // the flags after it, as far as reading can tell
      const next = { ...state };
      if (name === 'REP' && !state.e) {
        if (operand & 0x20) next.m = false;
        if (operand & 0x10) next.x = false;
      } else if (name === 'SEP' && !state.e) {
        if (operand & 0x20) next.m = true;
        if (operand & 0x10) next.x = true;
      } else if (name === 'XCE') {
        if (carry === undefined) break;
        if (carry) Object.assign(next, { e: true, m: true, x: true });
        else if (state.e) Object.assign(next, { e: false, m: true, x: true });
      } else if (name === 'PLP' && !state.e) {
        next.m = next.x = null;
      }
      const nextCarry = name === 'CLC' ? 0 : name === 'SEC' ? 1 : (name === 'REP' && operand & 1) ? 0 : (name === 'SEP' && operand & 1) ? 1 : name === 'XCE' ? (state.e ? 1 : 0) : undefined;
      if (ENDS.has(name) || ENDS.has(`${name} ${way}`)) break;
      if (isConditional(op)) go(inBank(address, after + (operand << 24 >> 24)));
      if (op === BRA) {
        address = inBank(address, after + (operand << 24 >> 24));
        instruction.next.push(romAt(address));
        state = next;
        continue;
      }
      if (op === BRL) {
        address = inBank(address, after + (operand << 16 >> 16));
        instruction.next.push(romAt(address));
        state = next;
        continue;
      }
      if (op === JMP || op === JML) {
        address = op === JMP ? inBank(address, operand) : operand;
        instruction.next.push(romAt(address));
        state = next;
        continue;
      }
      if (op === JMP_TABLE || op === JSR_TABLE) {
        const tableAt = inBank(address, operand);
        if (!tables.has(romAt(tableAt))) {
          tables.add(romAt(tableAt));
          pending.push({ tableAt, bank: address, call: op === JSR_TABLE, state: { ...next }, from: instruction });
        }
        if (op === JMP_TABLE) break;
      }
      if (op === JSR) push(inBank(address, operand), { ...next }, true);
      if (op === JSL) push(operand, { ...next }, true);
      instruction.next.push(romAt(after));
      address = after;
      state = next;
      carry = nextCarry;
    }
  }
  for (const instruction of code.values()) instruction.next = instruction.next.filter(at => at >= 0);
  return { code, calls, conflicts };
}

/** Where the console starts a cartridge's code: its reset in the 6502's mode, and its interrupts' handlers in the
 *  processor's own mode, with the flags not known. */
export function vectorsOf({ cart, map, rom }) {
  const word = at => rom[at] | rom[at + 1] << 8;
  const header = cart.header, starts = [{ address: cart.reset, mode: 'e', call: true }];
  // the native mode's COP, BRK, NMI and IRQ, and the 6502's NMI and IRQ, each in bank $00
  for (const [at, mode] of [[0x24, null], [0x26, null], [0x2A, null], [0x2E, null], [0x3A, 'e'], [0x3E, 'e']]) {
    const address = word(header + at);
    if (address >= 0x8000 && placeIn(map, address).what === ROM) starts.push({ address, mode, call: true });
  }
  return starts;
}

/**
 * The functions found by following the code: `listed` each { address, size, mode? } kept as it is, `played` each
 * place play sent the processor to, { address, way, mode }, `address` a ROM offset, as the tools' change to Snes9x
 * tells them. Each function { address, size, mode }, in order, `mode` the processor's at its start when it's known.
 */
export function findFunctions(copy, listed = [], options = {}) {
  return explore(copy, listed, options).functions;
}

/** As findFunctions, with the places reading reached in two modes: { functions, conflicts }, `conflicts` ROM offsets. */
export function explore(copy, listed = [], { played = [] } = {}) {
  const program = programOf(copy);
  const { cart, rom } = program;
  const hints = new Map();
  for (const p of played) if (p.mode && !hints.has(p.address)) hints.set(p.address, p.mode);
  const starts = [...vectorsOf(program)];
  for (const f of listed) starts.push({ address: addressOf(f.address, cart), mode: f.mode ?? hints.get(f.address) ?? null, call: true });
  // a place play called, or jumped to through a pointer, is followed from there in the mode it ran in
  for (const p of played) if (p.way !== 'returned') starts.push({ address: addressOf(p.address, cart), mode: p.mode ?? null, call: p.way === 'called' });
  // a place play returned to is where a function goes on after a call, in the mode the function it called left
  const { code, calls, conflicts } = follow(program, starts, hints);
  const begins = new Map(calls);
  for (const f of listed) if (!begins.has(f.address)) begins.set(f.address, f.mode ?? null);
  return { functions: functionsOf(code, begins, rom.length, listed), conflicts: [...conflicts].sort((a, b) => a - b) };
}

// each start to its end: the last byte of the code it reaches, without going through another start, before the next
// one; then what reading found that no function holds starts one of its own
function functionsOf(code, begins, end, listed) {
  const sizes = new Map(listed.map(f => [f.address, f.size]));
  const reached = start => {
    const seen = new Set([start]), todo = [start];
    while (todo.length) {
      const instruction = code.get(todo.pop());
      if (!instruction) continue;
      for (const at of instruction.next) {
        if (seen.has(at) || begins.has(at)) continue;
        seen.add(at);
        todo.push(at);
      }
    }
    return seen;
  };
  // each round can only add starts, and ends when every instruction found is in a function
  for (;;) {
    const ordered = [...begins.keys()].sort((a, b) => a - b), held = new Set();
    const functions = ordered.map((address, i) => {
      const limit = ordered[i + 1] ?? end;
      let last = address + 1;
      for (const at of reached(address)) {
        const instruction = code.get(at);
        if (at >= address && at < limit && instruction) last = Math.max(last, Math.min(limit, at + instruction.length));
      }
      const size = Math.min(sizes.get(address) ?? last - address, limit - address);
      for (let at = address; at < address + size; at++) held.add(at);
      return { address, size, ...(begins.get(address) ? { mode: begins.get(address) } : {}) };
    });
    const orphans = [...code.entries()].filter(([at]) => !held.has(at));
    if (!orphans.length) return functions;
    // the first instruction of each stretch no function holds
    const ends = new Set(orphans.map(([at, o]) => at + o.length)), before = begins.size;
    for (const [at, instruction] of orphans) if (!ends.has(at) && !begins.has(at)) begins.set(at, instruction.mode);
    if (begins.size === before) return functions;
  }
}

/**
 * The code map's functions again, with what play adds: `sent` each place play sent the processor to, as codemap reads
 * them, { address, way, mode }, `mode` the three bits the tools' change to Snes9x gives. Answers { starts, functions },
 * `starts` the functions play found that the map didn't have, and `functions` all of them. A place play called starts
 * a function wherever it is; one it jumped to through a pointer starts one only where no function holds it, as a
 * switch's case is its function's own; and one it returned to is where a function goes on, in the mode the function
 * it called left.
 */
export function fromPlay(copy, functions, sent) {
  const played = sent.filter(s => s.way).map(({ address, way, mode }) => ({ address, way, mode: modeFromBits(mode ?? 0) }));
  const found = findFunctions(copy, functions, { played });
  const known = new Set(functions.map(f => f.address));
  return { starts: found.filter(f => !known.has(f.address)).map(f => f.address), functions: found };
}

/** The functions the code map lists, and those found beyond them, as codemap's --fill and --from ask. */
export function fill(copy, listed) {
  return findFunctions(copy, listed);
}

/** Whether a ROM offset is in the cartridge's ROM, for a list of functions. */
export const inCode = copy => {
  const size = programOf(copy).rom.length;
  return offset => offset >= 0 && offset < size;
};

/** Of the functions in a list, those that start outside the cartridge's ROM. */
export function startsInData(copy, listed) {
  const inside = inCode(copy);
  return listed.filter(({ address }) => !inside(address));
}

/**
 * Where a Super Nintendo game's instructions are, for its code map: `of(f)` gives { instructions, branches }, the
 * offsets in the function `f` that hold an instruction and, of those, the conditional branches, as the code is
 * followed from every function of `functions`, each in the mode the map says it starts in. `copy` is the whole copy.
 */
export function instructionsIn(functions, copy) {
  const program = programOf(copy);
  const starts = [...vectorsOf(program), ...functions.map(f => ({ address: addressOf(f.address, program.cart), mode: f.mode ?? null, call: true }))];
  const { code } = follow(program, starts);
  const at = [...code.keys()].sort((a, b) => a - b);
  return f => {
    const instructions = new Set(), branches = new Set();
    let low = 0, high = at.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (at[middle] < f.address) low = middle + 1;
      else high = middle;
    }
    for (let i = low; i < at.length && at[i] < f.address + f.size; i++) {
      const place = at[i];
      instructions.add(place - f.address);
      if (isConditional(code.get(place).op)) branches.add(place - f.address);
    }
    return { instructions, branches };
  };
}

/** Where play sent the processor, as run-reference.mjs reads the tools' change to Snes9x: `way` is the word it wrote,
 *  the way in its lowest byte and the mode's three bits above. */
export const sentWay = word => ({ way: [null, 'called', 'jumped', 'returned'][word & 0xFF] ?? null, mode: modeFromBits(word >> 8 & 7) });
