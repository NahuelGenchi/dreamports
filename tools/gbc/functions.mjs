// Finds the functions in a Game Boy or Game Boy Color game's program, for its code map: where each one starts and how
// many bytes it takes, and nothing of the code itself. Like tools/nes/functions.mjs, it follows the code, here from
// where the console starts a game, $0100, and from the interrupts' five fixed places, through every call, jump and
// RST, and through the tables of addresses the code jumps with: one a register pair was loaded with before a JP (HL),
// and a list of addresses after a call or an RST to a routine that reads them from its own return address. A table is
// only ever one the code is seen to jump with, never a guess.
//
// The program is in 16 KB banks. The first always sits at $0000-$3FFF, and any of the others can be switched in at
// $4000-$7FFF, so an address there means nothing until the bank is known. Code in a switched bank sees itself there.
// Code in the first bank sees what its caller switched in, or what it switched in itself with a write to the
// cartridge's chip at $2000-$3FFF, which the tools follow when the value written is a number in the code. Where it
// can't be known, an address that reads as code in only one bank is taken in that bank.
//
// A function's address in the code map is where it is in the program, its offset from the program's first byte: bank
// n's $4000 is n × 0x4000. A game's code names it as `sub_02_4123`, a word, the bank in two hexadecimal digits, or
// three in a program of more than 256 banks, and the address the console sees, or as `sub_0150` in the first bank
// (gbNames). Code a game copies into its memory and runs there, as the routine that waits for the sprites' copy is,
// isn't in the program at an address of its own, and isn't found.

import { decode } from './sm83.mjs';

const BANK = 0x4000;

/** What a Game Boy or Game Boy Color copy's program is: its bytes, its banks, and its cartridge's kind of chip, 'none',
 *  'mbc1', 'mbc2', 'mbc3', 'mbc5' or 'other', or null for a file too small to be one. */
export function gbProgram(bytes) {
  if (bytes.length < 0x150) return null;
  const kind = bytes[0x147];
  const chip = kind === 0x00 || kind === 0x08 || kind === 0x09 ? 'none' : kind <= 0x03 ? 'mbc1' : kind === 0x05 || kind === 0x06 ? 'mbc2'
    : kind >= 0x0F && kind <= 0x13 ? 'mbc3' : kind >= 0x19 && kind <= 0x1E ? 'mbc5' : 'other';
  return { rom: bytes, banks: Math.max(1, Math.ceil(bytes.length / BANK)), chip, colour: (bytes[0x143] & 0x80) !== 0 };
}

/** Where `address`, as the console sees it with `bank` switched in at $4000, is in the program, or null when it's
 *  outside it or the bank isn't known. */
export function programOffset(address, bank, banks) {
  if (address < 0 || address > 0x7FFF) return null;
  if (address < BANK) return address;
  if (banks <= 2) return banks === 2 ? address : null;
  return bank === null || bank === undefined || bank >= banks ? null : bank * BANK + address - BANK;
}

const hex4 = n => n.toString(16).toUpperCase().padStart(4, '0');

/** The name the code map's address has in a game's code: sub_0150 in the first bank, or sub_02_4123. */
export function gbName(offset, banks) {
  const bank = Math.floor(offset / BANK);
  if (bank === 0) return `sub_${hex4(offset)}`;
  return `sub_${bank.toString(16).toUpperCase().padStart(banks > 256 ? 3 : 2, '0')}_${hex4(BANK + offset % BANK)}`;
}

// a name of a function in a game's code: a word, then the bank in two or three hexadecimal digits, and the address
const NAME = /\b[A-Za-z][A-Za-z0-9]*_(?:([0-9A-Fa-f]{2,3})_)?([0-7][0-9A-Fa-f]{3})\b/g;

/** The functions a line of a game's code names, as [name, offset in the program], for a program of `banks` banks: a
 *  name without a bank is the first bank's, and one at $4000-$7FFF without a bank names nothing in a program that
 *  switches its banks. */
export function gbNames(line, banks) {
  const names = [];
  for (const [name, bank, digits] of line.matchAll(NAME)) {
    const address = parseInt(digits, 16);
    const offset = bank === undefined
      ? (address < BANK || banks <= 2 ? programOffset(address, 1, banks) : null)
      : address >= BANK && parseInt(bank, 16) > 0 ? programOffset(address, parseInt(bank, 16), banks) : null;
    if (offset !== null) names.push([name, offset]);
  }
  return names;
}

// the interrupts' fixed places: the screen's V-blank, its other interrupts, the timer, the link cable and the buttons
const INTERRUPTS = [0x40, 0x48, 0x50, 0x58, 0x60];

/** Each function found, as { address, size }, with the address its offset in the program, sorted by address.
 *  `listed` are functions a list already knows, whose code is followed too. `pool` collects the bytes the code reads
 *  as data: its tables of addresses. `notes` collects more of what following the code found: in `words` (a Set),
 *  where each whole address of a table starts, in `leads` (a Map), for the offset of each call, jump and return, the
 *  offsets the code was followed to from there, and in `walked` (a Map), the offset of each instruction the code
 *  reaches, with its length. */
export function findFunctions(bytes, listed = [], pool = new Set(), notes = {}) {
  const program = gbProgram(bytes);
  if (!program) throw new Error("That copy isn't a Game Boy game's.");
  const { rom, banks, chip } = program;
  const size = rom.length;
  const bankOf = offset => Math.floor(offset / BANK);
  // the bank an offset sees at $4000-$7FFF by itself: its own, but for the first bank's
  const ownBank = offset => (banks <= 2 ? 1 : bankOf(offset) === 0 ? null : bankOf(offset));
  const sameWindow = (a, b) => bankOf(a) === bankOf(b);
  const u8 = offset => rom[offset];
  const u16 = offset => rom[offset] | rom[offset + 1] << 8;
  // the address the console sees an offset at
  const seenAt = offset => (offset < BANK ? offset : BANK + offset % BANK);
  const at = offset => decode(rom, offset, seenAt(offset));
  // $FF is RST $38, which a program's unused space is full of, and no game's code runs it on purpose
  const isCode = offset => offset < size && u8(offset) !== 0xFF && at(offset) !== null;
  const ends = instruction => instruction.when === undefined && ['return', 'reti', 'jump', 'near', 'jumpHL'].includes(instruction.flow);
  // the number a write to the chip switches in: an MBC1 and an MBC3 give bank 1 for 0
  const switchedIn = value => (value === null ? null : ((chip === 'mbc5' ? value : value & (chip === 'mbc1' ? 0x1F : 0x7F)) || (chip === 'mbc5' ? 0 : 1)) % banks);
  const isSwitch = address => address >= 0x2000 && address < (chip === 'mbc5' ? 0x3000 : BANK);

  // whether the code from an offset reads as code: instructions up to a return or a jump, none missing, in the same
  // bank, and not a run of NOPs, which is padding. A jump alone counts when it's to code that reads as code.
  function readsAsCode(offset, limit = 256, alone = true) {
    let nops = 0;
    for (let i = 0, pc = offset; i < limit; i++) {
      if (pc >= size || pool.has(pc) || !isCode(pc)) return false;
      const instruction = at(pc);
      if (!sameWindow(pc, pc + instruction.length - 1)) return false;
      nops = u8(pc) === 0x00 ? nops + 1 : 0;
      if (nops > 3) return false;
      if (ends(instruction)) {
        if (i >= 1 || instruction.flow === 'return' || instruction.flow === 'reti') return true;
        const to = instruction.flow === 'jump' ? programOffset(instruction.to, ownBank(pc), banks) : null;
        return alone && to !== null && to !== pc && readsAsCode(to, limit, false);
      }
      pc += instruction.length;
    }
    return false;
  }

  const found = new Map();   // offset → { end, contexts: the banks it was reached with, called }
  const queue = [];
  const unresolved = new Map();   // address at $4000-$7FFF → how many times code with no known bank led there
  const add = (offset, context, called) => {
    if (offset === null || offset >= size) return;
    let f = found.get(offset);
    if (!f) found.set(offset, f = { end: offset + 1, contexts: new Set(), called });
    f.called ||= called;
    // code in a switched bank always sees itself; code in the first bank, whatever its caller left
    const seen = bankOf(offset) === 0 ? context : ownBank(offset);
    if (!f.contexts.has(seen)) {
      f.contexts.add(seen);
      queue.push([offset, seen]);
    }
  };
  const target = (address, bank) => {
    const offset = programOffset(address, bank, banks);
    if (offset === null && address >= BANK && address < 2 * BANK) unresolved.set(address, (unresolved.get(address) ?? 0) + 1);
    return offset;
  };

  // whether a routine reads a list of addresses after the call that reaches it: it pops its own return address into
  // HL, reads through it, and jumps through HL without pushing an address back
  const dispatcher = new Map();
  function readsListAfterCall(offset) {
    if (dispatcher.has(offset)) return dispatcher.get(offset);
    let popped = false, reads = false, result = false;
    for (let i = 0, pc = offset; i < 24 && isCode(pc); i++) {
      const op = u8(pc), instruction = at(pc);
      if (op === 0xE1) popped = true;                                             // POP HL
      else if (popped && (op === 0x2A || op === 0x7E || (op & 0xC7) === 0x46)) reads = true;   // LD A,(HL+) or LD r,(HL)
      else if (op === 0xE5 || instruction.flow === 'call' || instruction.flow === 'rst') break;   // PUSH HL: it goes back
      if (instruction.flow === 'jumpHL') {
        result = popped && reads;
        break;
      }
      if (ends(instruction)) break;
      pc += instruction.length;
    }
    dispatcher.set(offset, result);
    return result;
  }

  // the addresses in a table of whole addresses at `table`, for as long as they read as code and the table hasn't
  // reached code already found, or the first of its own routines
  function readTable(table, bank, owner) {
    const out = [];
    let first = Infinity, last = -1;
    for (let i = 0; i < 128; i++) {
      const entry = table + i * 2;
      if (entry + 1 >= size || entry >= first || !sameWindow(entry, table) || (i && found.has(entry))) break;
      const to = programOffset(u16(entry), bank, banks);
      if (to === null || !readsAsCode(to)) break;
      if (to > entry && sameWindow(to, entry)) first = Math.min(first, to);
      pool.add(entry).add(entry + 1);
      notes.words?.add(entry);
      out.push(to);
      last = i;
    }
    if (owner && last >= 0) owner.end = Math.max(owner.end, table + last * 2 + 2);
    return out;
  }

  // what a call leaves switched in: the bank a routine always switches to, the one it's given in A, or undefined for
  // one that doesn't switch
  const switching = new Map();
  function switches(offset, a) {
    if (!switching.has(offset)) {
      let result;
      const regs = { a: 'given', hl: null };
      for (let i = 0, pc = offset; i < 24 && isCode(pc); i++) {
        const op = u8(pc), instruction = at(pc);
        if (instruction.flow) break;
        if (op === 0x3E) regs.a = u8(pc + 1);
        else if (op === 0x21) regs.hl = u16(pc + 1);
        else if (op === 0xEA && isSwitch(u16(pc + 1))) {
          result = regs.a;
          break;
        } else if (op === 0x77 && regs.hl !== null && isSwitch(regs.hl)) {
          result = regs.a;
          break;
        } else if (op === 0x36 && regs.hl !== null && isSwitch(regs.hl)) {
          result = u8(pc + 1);
          break;
        } else if ((op & 0xC0) === 0x80 || (op & 0xC7) === 0xC6 || (op & 0xF8) === 0x78 || op === 0xF0 || op === 0xFA || op === 0x0A || op === 0x1A || op === 0x2A || op === 0x3A || op === 0xF1 || (op & 0xC7) === 0x07 || op === 0x3C || op === 0x3D || op === 0xCB) regs.a = null;
        pc += instruction.length;
      }
      switching.set(offset, result);
    }
    const result = switching.get(offset);
    if (result === undefined) return undefined;
    return switchedIn(result === 'given' ? (a === 'given' ? null : a) : result);
  }

  // follows a function's code with `context` switched in at $4000: its end, what it calls and where its tables lead
  function trace(start, context) {
    const seen = new Set(), calls = [], jumps = [];
    const work = [[start, { a: null, hl: null, pairs: {}, bank: context }]];
    const extent = { end: start + 1 };
    let bad = false;
    const lead = (list, from, to, bank) => {
      list.push([to, bank]);
      if (!notes.leads) return;
      if (!notes.leads.has(from)) notes.leads.set(from, new Set());
      notes.leads.get(from).add(to);
    };
    while (work.length) {
      let [pc, regs] = work.pop();
      regs = { ...regs, pairs: { ...regs.pairs } };
      while (pc < size && !seen.has(pc) && !pool.has(pc) && (pc === start || !found.has(pc))) {
        if (!isCode(pc)) {
          bad = true;
          break;
        }
        const op = u8(pc), instruction = at(pc);
        const { length, flow } = instruction;
        if (!sameWindow(pc, pc + length - 1)) break;
        for (let i = 0; i < length; i++) seen.add(pc + i);
        notes.walked?.set(pc, length);
        extent.end = Math.max(extent.end, pc + length);
        const next = pc + length;
        if (flow === 'call' || flow === 'rst') {
          const to = target(instruction.to, regs.bank);
          if (to !== null) {
            lead(calls, pc, to, regs.bank);
            if (readsListAfterCall(to)) {
              // the list after the call, read by the routine: the address of each case, while they read as code
              for (const t of readTable(next, regs.bank, extent)) lead(jumps, pc, t, regs.bank);
              break;
            }
            const switched = switches(to, regs.a);
            if (switched !== undefined) regs.bank = switched;
          }
          regs.a = regs.hl = null;
          regs.pairs = {};
          pc = next;
          continue;
        }
        if (flow === 'near' || flow === 'jump') {
          const to = flow === 'near' ? pc + length + (u8(pc + 1) << 24 >> 24) : target(instruction.to, regs.bank);
          const inside = to !== null && to >= 0 && sameWindow(to, start) && (flow === 'near' || (to >= start && to <= extent.end + 0x80 && !found.has(to)));
          if (instruction.when !== undefined) {
            // one way or the other
            if (inside) work.push([to, regs]);
            else if (to !== null && flow === 'jump') lead(jumps, pc, to, regs.bank);
            pc = next;
            continue;
          }
          if (inside) {
            pc = to;
            continue;
          }
          if (to !== null && flow === 'jump') lead(jumps, pc, to, regs.bank);
          break;
        }
        if (flow === 'jumpHL') {
          // through a table one of the register pairs was last loaded with
          for (const table of [regs.pairs.hl, regs.pairs.de, regs.pairs.bc]) {
            const where = table === undefined ? null : programOffset(table, regs.bank, banks);
            const tabled = where === null || where < 0x100 ? [] : readTable(where, regs.bank);
            for (const t of tabled) lead(jumps, pc, t, regs.bank);
            if (tabled.length) break;
          }
          break;
        }
        if (flow === 'return' || flow === 'reti') {
          if (instruction.when !== undefined) {
            pc = next;
            continue;
          }
          break;
        }
        // the registers, as far as the bank switches and the tables need them
        if (op === 0x3E) regs.a = u8(pc + 1);
        else if (op === 0x21) {
          regs.hl = u16(pc + 1);
          regs.pairs.hl = regs.hl;
        } else if (op === 0x11) regs.pairs.de = u16(pc + 1);
        else if (op === 0x01) regs.pairs.bc = u16(pc + 1);
        else if (op === 0xEA && isSwitch(u16(pc + 1))) regs.bank = switchedIn(regs.a);
        else if (op === 0x77 && regs.hl !== null && isSwitch(regs.hl)) regs.bank = switchedIn(regs.a);
        else if (op === 0x36 && regs.hl !== null && isSwitch(regs.hl)) regs.bank = switchedIn(u8(pc + 1));
        else {
          if ((op & 0xC0) === 0x80 || (op & 0xC7) === 0xC6 || (op & 0xF8) === 0x78 || op === 0xF0 || op === 0xFA || op === 0xF2 || op === 0x0A || op === 0x1A || op === 0x2A || op === 0x3A || op === 0xF1 || (op & 0xC7) === 0x07 || op === 0x3C || op === 0x3D || (op === 0xCB && (u8(pc + 1) & 7) === 7)) regs.a = null;
          // HL moved on from the number it was loaded with: no longer the chip's address, though still the table's
          if (op === 0x23 || op === 0x2B || op === 0x09 || op === 0x19 || op === 0x29 || op === 0x39 || op === 0x22 || op === 0x32 || op === 0x2A || op === 0x3A || op === 0xE1 || op === 0xF8 || (op & 0xF8) === 0x60 || (op & 0xF8) === 0x68 || op === 0x26 || op === 0x2E || op === 0x24 || op === 0x25 || op === 0x2C || op === 0x2D) regs.hl = null;
        }
        pc = next;
      }
    }
    return { end: extent.end, calls, jumps, bad };
  }

  function follow() {
    while (queue.length) {
      const [offset, context] = queue.shift();
      const f = found.get(offset);
      if (!f) continue;
      const traced = trace(offset, context);
      if (traced.bad && !f.called && f.contexts.size === 1) {
        found.delete(offset);
        continue;
      }
      f.end = Math.max(f.end, traced.end);
      for (const [to, bank] of traced.calls) add(to, bank, true);
      for (const [to, bank] of traced.jumps) add(to, bank, true);
    }
  }

  // where the console starts a game, and each interrupt's place that holds code
  const start = banks <= 2 ? 1 : null;
  add(0x100, start, true);
  // a jump there is taken as it stands: what it jumps to can start with a call that has its list after it
  for (const place of INTERRUPTS) if (u8(place) === 0xC3 || readsAsCode(place)) add(place, start, true);
  for (const { address } of listed) add(address, ownBank(address) ?? start, false);
  follow();
  // addresses at $4000-$7FFF reached with no bank known: taken in the one bank where they read as code, and only if
  // that bank has code already
  for (let more = true; more;) {
    more = false;
    const withCode = new Set([...found.keys()].map(bankOf));
    for (const address of [...unresolved.keys()]) {
      const fits = [];
      for (let bank = 1; bank < banks; bank++) {
        const where = programOffset(address, bank, banks);
        if (withCode.has(bank) && readsAsCode(where) && !pool.has(where)) fits.push(where);
      }
      unresolved.delete(address);
      if (fits.length === 1 && !found.has(fits[0])) {
        add(fits[0], bankOf(fits[0]), true);
        more = true;
      }
    }
    follow();
  }

  // each function ends where the next one starts, at the latest, and in its own bank
  const list = [...found].map(([address, f]) => ({ address, end: Math.min(f.end, (bankOf(address) + 1) * BANK) })).sort((a, b) => a.address - b.address);
  let furthest = 0;
  return list.map((f, i) => {
    furthest = Math.max(sameWindow(Math.max(furthest - 1, 0), f.address) ? furthest : 0, f.end);
    return { address: f.address, size: Math.min(furthest, list[i + 1]?.address ?? Infinity) - f.address };
  });
}

/** Those of a list's functions that start in a table of addresses the code reads, which nothing the tools find leads to. */
export function startsInData(bytes, listed) {
  const pool = new Set();
  const functions = new Set(findFunctions(bytes, [], pool).map(f => f.address));
  return listed.filter(({ address }) => !functions.has(address) && pool.has(address));
}
