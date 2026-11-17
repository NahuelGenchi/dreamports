// Finds the functions in an NES game's program, for its code map: where each one starts and how many bytes it takes,
// and nothing of the code itself. Like tools/gba/functions.mjs, it follows the code, here from the console's three
// vectors, through every call, branch and jump, and through the tables of addresses the code jumps with: a list of
// addresses after a JSR to a routine that reads them from the stack, two tables of each address's low and high bytes
// that the code pushes before an RTS, or writes into the stack page for an RTS much later, as a game that gives each
// of its tasks a stack does, and the same two built into a pointer for JMP ($xx), in the routine itself or in one it
// calls that is that jump alone. The two bytes can also be read through a pointer to the table, when the code builds
// that pointer from numbers of its own. A table is only ever one the code is seen to jump with, never a guess.
//
// The program is in 16 KB banks. On the cartridges the tools read, the last one always sits at $C000-$FFFF and any
// of them can be switched in at $8000-$BFFF, so an address there means nothing until the bank is known. Code in a
// switched bank sees itself there. Code in the last bank sees what its caller switched in, or what it switched in
// itself with a write to the cartridge, which the tools follow when the value written is a number in the code. Where
// it can't be known, an address that reads as code in only one bank is taken in that bank.
//
// A function's address in the code map is where it is in the program, its offset from the program's first byte,
// past the file's 16-byte header: bank n's $8000 is n × 0x4000, and $C39C in the last of 8 banks is 0x1C39C. A game's
// code names it as `sub_04_923F`, a word, the bank in two hexadecimal digits and the address the console sees, or as
// `sub_C39C` in the last bank (nesAddress).

import { INSTRUCTIONS, LENGTH } from './6502.mjs';

const BANK = 0x4000;
const HEADER = 16;
// the mappers whose program is laid out as above: none, MMC1, UNROM, CNROM, and UNROM's look-alikes
const MAPPERS = new Set([0, 1, 2, 3, 71, 94]);

/** Whether the tools know which bank is where on a cartridge of this mapper. */
export const followsBanks = mapper => MAPPERS.has(mapper);

// the 6502's documented instructions, by opcode. The others aren't instructions any NES game's own code uses, so data
// read as code soon meets one.
const OPS = INSTRUCTIONS.map(instruction => (instruction.undocumented ? undefined : instruction));
// BRK is an instruction, but no game's code runs one on purpose: a zero is padding or data
const isCode = op => OPS[op] && op !== 0x00;
const ENDS = new Set(['RTS', 'RTI', 'JMP']);
// how many numbers at the start of a table of addresses can have no routine
const EMPTY_FIRST = 2;

/** What an NES copy's program is: its bytes, its banks, and its mapper, or null for a copy that isn't one. */
export function nesProgram(bytes) {
  if (bytes.length < HEADER || bytes.toString('latin1', 0, 3) !== 'NES' || bytes[3] !== 0x1A) return null;
  const at = HEADER + (bytes[6] & 4 ? 512 : 0);
  const size = bytes[4] * BANK;
  return { prg: bytes.subarray(at, at + size), banks: bytes[4], mapper: bytes[6] >> 4 | bytes[7] & 0xF0 };
}

/** Where `address`, as the console sees it with `bank` switched in at $8000, is in the program, or null when it's
 *  outside it or the bank isn't known. */
export function programOffset(address, bank, banks) {
  if (address < 0x8000 || address > 0xFFFF) return null;
  if (banks <= 2) return (address - 0x8000) % (banks * BANK);
  if (address >= 0xC000) return (banks - 1) * BANK + address - 0xC000;
  return bank === null || bank === undefined || bank >= banks - 1 ? null : bank * BANK + address - 0x8000;
}

/** The name the code map's address has in a game's code: sub_C39C in the last bank, or sub_04_923F. */
export function nesName(offset, banks) {
  const bank = Math.floor(offset / BANK), at = offset % BANK;
  const hex4 = n => n.toString(16).toUpperCase().padStart(4, '0');
  if (banks <= 2) return `sub_${hex4(0x8000 + offset)}`;
  if (bank === banks - 1) return `sub_${hex4(0xC000 + at)}`;
  return `sub_${bank.toString(16).toUpperCase().padStart(2, '0')}_${hex4(0x8000 + at)}`;
}

// a name of a function in a game's code: a word, then the bank in two hexadecimal digits, and the address
const NAME = /\b[A-Za-z][A-Za-z0-9]*_(?:([0-9A-Fa-f]{2})_)?([89A-Fa-f][0-9A-Fa-f]{3})\b/g;

/** The functions a line of a game's code names, as [name, offset in the program], for a program of `banks` banks: a
 *  name without a bank is the last bank's, and one at $8000-$BFFF without a bank names nothing in a program that
 *  switches its banks. */
export function nesNames(line, banks) {
  const names = [];
  for (const [name, bank, digits] of line.matchAll(NAME)) {
    const address = parseInt(digits, 16);
    const offset = bank === undefined
      ? (address >= 0xC000 || banks <= 2 ? programOffset(address, null, banks) : null)
      : address < 0xC000 || banks <= 2 ? programOffset(address, parseInt(bank, 16), banks) : parseInt(bank, 16) === banks - 1 ? programOffset(address, null, banks) : null;
    if (offset !== null) names.push([name, offset]);
  }
  return names;
}

/** Each function found, as { address, size }, with the address its offset in the program, sorted by address.
 *  `listed` are functions a list already knows, whose code is followed too. `pool` collects the bytes the code reads
 *  as data: its tables of addresses. `notes` collects more of what following the code found, for `read`: in `words`
 *  (a Set), where each whole address of a table starts, its low byte and then its high, and in `leads` (a Map), for
 *  the offset of each JSR, JMP and RTS, the offsets the code was followed to from there, and in `walked` (a Map), the
 *  offset of each instruction the code reaches, with its length. */
export function findFunctions(bytes, listed = [], pool = new Set(), notes = {}) {
  const program = nesProgram(bytes);
  if (!program) throw new Error("That copy isn't an NES game's.");
  const { prg, banks, mapper } = program;
  if (!followsBanks(mapper)) throw new Error(`The tools can't follow the banks of an NES game on mapper ${mapper} yet: --from <list> takes its functions from a disassembler.`);
  const last = banks <= 2 ? null : banks - 1;
  const size = prg.length;
  // the bank an offset is in, and the one it sees itself in at $8000-$BFFF
  const bankOf = offset => (banks <= 2 ? null : Math.floor(offset / BANK));
  const ownBank = offset => (bankOf(offset) === last ? null : bankOf(offset));
  const sameWindow = (a, b) => (banks <= 2 ? true : bankOf(a) === bankOf(b));
  const u8 = offset => prg[offset];
  const u16 = offset => prg[offset] | prg[offset + 1] << 8;

  // whether the code from an offset reads as code: instructions up to an RTS, RTI or JMP, none missing, in the same
  // bank. A routine can run long before its first return, as one that sets a screen up does. A JMP alone counts when
  // it's to code that reads as code, as a table's entry that goes on in another's routine.
  function readsAsCode(offset, limit = 256, alone = true) {
    for (let i = 0, at = offset; i < limit; i++) {
      if (at >= size || pool.has(at) || !isCode(u8(at))) return false;
      const { name, mode } = OPS[u8(at)];
      if (!sameWindow(at, at + LENGTH[mode] - 1)) return false;
      if (ENDS.has(name)) {
        if (i >= 1 || name === 'RTS' || name === 'RTI') return true;
        const to = mode === 'abs' ? programOffset(u16(at + 1), ownBank(at), banks) : null;
        return alone && to !== null && to !== at && readsAsCode(to, limit, false);
      }
      at += LENGTH[mode];
    }
    return false;
  }

  // whether the code from an offset reads as code up to its end, before `limit`, more surely than readsAsCode: at least
  // three instructions, none reading or writing an address where the console has nothing, no branch past the
  // stretch, and every call to code that reads as code
  const MIRRORS = address => (address >= 0x0800 && address < 0x2000) || (address >= 0x2008 && address < 0x4000) || (address >= 0x4018 && address < 0x6000);
  function looksLikeCode(offset, limit) {
    for (let i = 0, at = offset; i < 64 && at < limit; i++) {
      if (pool.has(at) || !isCode(u8(at))) return false;
      const { name, mode } = OPS[u8(at)];
      const length = LENGTH[mode];
      if (at + length > limit) return false;
      const operand = length === 3 ? u16(at + 1) : null;
      if (operand !== null && MIRRORS(operand)) return false;
      if (mode === 'rel') {
        const to = at + 2 + (u8(at + 1) << 24 >> 24);
        if (to >= limit || (to < offset && (!sameWindow(to, offset) || pool.has(to) || !isCode(u8(to))))) return false;
      }
      if (name === 'JSR' || (name === 'JMP' && mode === 'abs')) {
        if (operand < 0x8000) return false;
        const to = programOffset(operand, ownBank(offset), banks);
        if (to !== null && !readsAsCode(to)) return false;
      }
      if (ENDS.has(name)) return i >= 2;
      at += length;
    }
    return false;
  }

  const found = new Map();   // offset → { end, contexts: the banks it was reached with, called }
  const queue = [];
  const unresolved = new Map();   // address at $8000-$BFFF → how many times code with no known bank led there
  const add = (offset, context, called) => {
    if (offset === null || offset >= size) return;
    let f = found.get(offset);
    if (!f) found.set(offset, f = { end: offset + 1, contexts: new Set(), called });
    f.called ||= called;
    // code in a switched bank always sees itself; code in the last bank, whatever its caller left
    const seen = bankOf(offset) === last ? context : ownBank(offset);
    if (!f.contexts.has(seen)) {
      f.contexts.add(seen);
      queue.push([offset, seen]);
    }
  };
  // where an address leads with `bank` switched in, or null, noting an address at $8000-$BFFF whose bank isn't known
  const target = (address, bank) => {
    const offset = programOffset(address, bank, banks);
    if (offset === null && address >= 0x8000 && address < 0xC000) unresolved.set(address, (unresolved.get(address) ?? 0) + 1);
    return offset;
  };

  // whether a routine reads a list of addresses after the JSR that calls it: it pulls its own return address off the
  // stack, PLA twice, and jumps through what it read
  const dispatcher = new Map();
  function readsListAfterCall(offset) {
    if (dispatcher.has(offset)) return dispatcher.get(offset);
    // the pulled bytes go to the zero page, and the list is read through them with LDA ($xx),Y
    let pulled = false, kept = new Set(), reads = false, jumps = false;
    for (let i = 0, at = offset; i < 32 && at < size && isCode(u8(at)); i++) {
      const { name, mode } = OPS[u8(at)];
      if (name === 'PLA') pulled = true;
      else if (name === 'STA' && mode === 'zp' && pulled) kept.add(u8(at + 1));
      else if (name === 'LDA' && mode === 'izy' && (kept.has(u8(at + 1)) || kept.has(u8(at + 1) + 1))) reads = true;
      if (name !== 'PLA') pulled = false;
      if (name === 'JMP' && mode === 'ind') jumps = true;
      if (ENDS.has(name)) break;
      at += LENGTH[mode];
    }
    dispatcher.set(offset, kept.size >= 2 && reads && jumps);
    return dispatcher.get(offset);
  }

  // the addresses in a table, from `lo` and `hi`, the offsets of the first's low and high bytes, `step` bytes apart,
  // plus `plus`: as many as the gap between two split tables says, or else for as long as they read as code
  function readTable(lo, hi, step, plus, bank, owner) {
    if (step === 1 && hi === lo + 1) step = 2;
    const split = step === 1 && sameWindow(lo, hi);
    const count = split ? Math.abs(hi - lo) : Infinity;
    const out = [];
    let first = Infinity, last = 0;
    for (let i = 0; i < Math.min(count, 128); i++) {
      const l = lo + i * step, h = hi + i * step;
      if (h >= size || l >= first || h >= first || (!split && i && found.has(l))) break;
      // a table can start with numbers that have no routine, written as zeros
      if (!out.length && i < EMPTY_FIRST && !u8(l) && !u8(h)) continue;
      const address = (u8(l) | u8(h) << 8) + plus & 0xFFFF;
      const to = programOffset(address, bank, banks);
      if (to === null || !readsAsCode(to)) break;
      if (to > Math.min(l, h) && sameWindow(to, l)) first = Math.min(first, to);
      pool.add(l).add(h);
      if (h === l + 1) notes.words?.add(l);
      out.push(to);
      last = i;
    }
    if (owner && out.length) owner.end = Math.max(owner.end, Math.max(lo, hi) + last * step + 1);
    return out;
  }

  // the pointer a routine jumps through when it is a JMP ($xx) and nothing else, which its callers fill, or null
  const jumpsThrough = offset => (offset + 2 < size && OPS[u8(offset)]?.mode === 'ind' && u16(offset + 1) < 0x8000 ? u16(offset + 1) : null);

  // follows a function's code with `context` switched in at $8000: its end, what it calls and where its tables lead
  function trace(start, context) {
    const seen = new Set(), calls = [], jumps = [];
    const work = [[start, { a: null, x: null, y: null, bank: context, from: {}, part: null, parts: {} }]];
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
      // where A came from: a table read with an index, as { table: offset }
      let aFrom = null;
      // what was pushed, and what was written into the stack page through a pointer, one after the other
      const pushed = [], stacked = [];
      // the addresses in the table a pointer was built from, the low bytes' and the high bytes'
      const through = pointer => {
        const lo = regs.from[pointer], hi = regs.from[pointer + 1 & 0xFFFF];
        return lo && hi && lo.table !== hi.table ? readTable(lo.table, hi.table, lo.step, 0, regs.bank) : [];
      };
      while (pc < size && !seen.has(pc) && !pool.has(pc) && (pc === start || !found.has(pc))) {
        const op = u8(pc);
        if (!isCode(op)) {
          bad = true;
          break;
        }
        const { name, mode } = OPS[op];
        const length = LENGTH[mode];
        if (!sameWindow(pc, pc + length - 1)) break;
        for (let i = 0; i < length; i++) seen.add(pc + i);
        notes.walked?.set(pc, length);
        extent.end = Math.max(extent.end, pc + length);
        const operand = length === 3 ? u16(pc + 1) : length === 2 ? u8(pc + 1) : null;
        const next = pc + length;
        if (name === 'JSR') {
          const to = target(operand, regs.bank);
          if (to !== null) {
            lead(calls, pc, to, regs.bank);
            if (readsListAfterCall(to)) {
              // the list after the call, read by the routine: the address of each case, while they read as code
              for (const t of readTable(next, next + 1, 2, 0, regs.bank, extent)) lead(jumps, pc, t, regs.bank);
              break;
            }
            // a call to a JMP ($xx) alone: through the pointer this code just built
            const pointer = jumpsThrough(to);
            if (pointer !== null) for (const t of through(pointer)) lead(jumps, pc, t, regs.bank);
            const switched = switches(to, regs.a);
            if (switched !== undefined) regs.bank = switched;
          }
          regs.a = regs.x = regs.y = regs.part = null;
          aFrom = null;
          pc = next;
          continue;
        }
        if (mode === 'rel') {
          const to = next + (operand << 24 >> 24);
          if (to >= 0 && sameWindow(to, pc)) work.push([to, { ...regs, from: { ...regs.from }, parts: { ...regs.parts } }]);
          pc = next;
          continue;
        }
        if (name === 'JMP' && mode === 'abs') {
          const to = target(operand, regs.bank);
          if (to === null) break;
          // on within the function, as near as a branch could go past what it has so far, or on to another one
          if (sameWindow(to, start) && to >= start && to <= extent.end + 0x80 && !found.has(to)) {
            pc = to;
            continue;
          }
          lead(jumps, pc, to, regs.bank);
          break;
        }
        if (name === 'JMP') {
          // JMP ($xxxx): through a pointer the code just built from two tables, or one kept in the program
          const tabled = through(operand);
          for (const t of tabled) lead(jumps, pc, t, regs.bank);
          if (!tabled.length && operand >= 0x8000) {
            const at = programOffset(operand, regs.bank, banks);
            if (at !== null && at + 1 < size) {
              const to = programOffset(u16(at), regs.bank, banks);
              if (to !== null) lead(jumps, pc, to, regs.bank);
            }
          }
          break;
        }
        if (name === 'RTS') {
          // the RTS trick: an address from two tables, less one, pushed high byte first
          const [hi, lo] = pushed.slice(-2);
          if (hi && lo) for (const t of readTable(lo.table, hi.table, lo.step, 1, regs.bank)) lead(jumps, pc, t, regs.bank);
          break;
        }
        if (name === 'RTI') break;
        // the registers, as far as the bank switches need them
        const value = mode === 'imm' ? operand : null;
        let read = (mode === 'abx' || mode === 'aby') && operand >= 0x8000 ? programOffset(operand, regs.bank, banks) : null;
        // a pointer in the zero page that the code built from its own numbers, as far as they're known: the high
        // byte a number, the low byte a number, or a number added to an index
        const lowByte = mode === 'izy' ? regs.parts[operand] : null, highByte = mode === 'izy' ? regs.parts[operand + 1 & 0xFF] : null;
        if (name === 'LDA' && lowByte && highByte?.exact && regs.y !== null) {
          // a read through it, of a table in the program
          const address = (highByte.value << 8 | lowByte.value) + regs.y;
          if (address >= 0x8000 && address <= 0xFFFF) read = programOffset(address, regs.bank, banks);
        }
        if (name === 'STA' && highByte?.exact && highByte.value === 1) {
          // a write through it into the stack page: an address from two tables, less one, low byte first, for an RTS
          // once the stack is put there
          stacked.push(aFrom);
          const [lo, hi] = stacked.slice(-2);
          if (lo && hi && lo.table !== hi.table) for (const t of readTable(lo.table, hi.table, lo.step, 1, regs.bank)) lead(jumps, pc, t, regs.bank);
        }
        if (mode === 'zp' && !['LDA', 'LDX', 'LDY', 'STA', 'CMP', 'CPX', 'CPY', 'BIT', 'ORA', 'AND', 'EOR', 'ADC', 'SBC'].includes(name)) delete regs.parts[operand];
        const part = regs.part;
        if (!['STA', 'STX', 'STY', 'CMP', 'CPX', 'CPY', 'BIT', 'CLC', 'SEC', 'LDX', 'LDY', 'INX', 'INY', 'DEX', 'DEY', 'PHA', 'PHP', 'PLP', 'TAX', 'TAY'].includes(name)) regs.part = null;
        switch (name) {
          case 'LDA': regs.a = value; regs.part = value === null ? null : { value, exact: true }; aFrom = read !== null ? { table: read, step: 1 } : null; break;
          case 'ADC':
            // a number added: to another, or to an index
            if (value !== null) regs.part = part ? { value: part.value + value & 0xFF, exact: part.exact } : { value, exact: false };
            regs.a = null;
            aFrom = null;
            break;
          case 'LDX': regs.x = value; break;
          case 'LDY': regs.y = value; break;
          case 'TAX': regs.x = regs.a; break;
          case 'TAY': regs.y = regs.a; break;
          case 'TXA': regs.a = regs.x; aFrom = null; break;
          case 'TYA': regs.a = regs.y; aFrom = null; break;
          case 'INX': case 'DEX': regs.x = regs.x === null ? null : regs.x + (name === 'INX' ? 1 : -1) & 0xFF; break;
          case 'INY': case 'DEY': regs.y = regs.y === null ? null : regs.y + (name === 'INY' ? 1 : -1) & 0xFF; break;
          case 'TSX': regs.x = null; break;
          case 'PHA': pushed.push(aFrom); break;
          case 'STA': case 'STX': case 'STY': {
            const into = mode === 'zp' || mode === 'abs' ? operand : null;
            if (into !== null && into < 0x8000) {
              if (name === 'STA' && aFrom) regs.from[into] = aFrom;
              else delete regs.from[into];
              if (name === 'STA' && regs.part) regs.parts[into] = regs.part;
              else delete regs.parts[into];
            }
            if (operand >= 0x8000 && mode !== 'zp' && mode !== 'zpx' && mode !== 'zpy' && mode !== 'izx' && mode !== 'izy') {
              // a write to the cartridge: a bank switch. UNROM's program is on the bus as it's written, so what it
              // gets is the number and the byte there both
              const index = mode === 'abx' ? regs.x : mode === 'aby' ? regs.y : 0;
              const reg = name === 'STA' ? regs.a : name === 'STX' ? regs.x : regs.y;
              const at = index === null ? null : programOffset(operand + index & 0xFFFF, regs.bank, banks);
              regs.bank = reg === null || mapper === 1 ? null : (at === null ? reg : reg & u8(at)) % banks;
            }
            break;
          }
          default:
            if (mode === 'acc' || ['ADC', 'SBC', 'AND', 'ORA', 'EOR', 'PLA'].includes(name)) {
              regs.a = null;
              aFrom = null;
            }
        }
        pc = next;
      }
    }
    return { end: extent.end, calls, jumps, bad };
  }

  // what a call leaves switched in: the bank a routine always switches to, the one it's given in A, or undefined for
  // one that doesn't switch
  const switching = new Map();
  function switches(offset, a) {
    if (!switching.has(offset)) {
      // the routine's first instructions, with A as the number it's given
      let result;
      const regs = { a: 'given', x: null, y: null };
      for (let i = 0, at = offset; i < 24 && at < size && isCode(u8(at)); i++) {
        const { name, mode } = OPS[u8(at)];
        const operand = LENGTH[mode] === 3 ? u16(at + 1) : LENGTH[mode] === 2 ? u8(at + 1) : null;
        if (name === 'JSR' || name === 'RTS' || name === 'RTI' || name === 'JMP' || mode === 'rel') break;
        if (name === 'LDA') regs.a = mode === 'imm' ? operand : null;
        else if (name === 'LDX') regs.x = mode === 'imm' ? operand : null;
        else if (name === 'LDY') regs.y = mode === 'imm' ? operand : null;
        else if (name === 'TAX') regs.x = regs.a;
        else if (name === 'TAY') regs.y = regs.a;
        else if (name === 'TXA') regs.a = regs.x;
        else if (name === 'TYA') regs.a = regs.y;
        else if (mode === 'acc' || ['ADC', 'SBC', 'AND', 'ORA', 'EOR', 'PLA'].includes(name)) regs.a = null;
        else if (['STA', 'STX', 'STY'].includes(name) && operand >= 0x8000 && (mode === 'abs' || mode === 'abx' || mode === 'aby')) {
          const reg = name === 'STA' ? regs.a : name === 'STX' ? regs.x : regs.y;
          result = reg === 'given' ? 'given' : reg;
          break;
        }
        at += LENGTH[mode];
      }
      switching.set(offset, result);
    }
    const result = switching.get(offset);
    if (result === undefined) return undefined;
    if (result === 'given') return a === null || a === 'given' || mapper === 1 ? null : a % banks;
    return result === null || mapper === 1 ? null : result % banks;
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

  // the vectors at the end of the last bank: the V-blank interrupt, the reset and the other interrupt
  const vectors = size - 6;
  for (const at of [vectors, vectors + 2, vectors + 4]) {
    pool.add(at).add(at + 1);
    add(programOffset(u16(at), null, banks), null, true);
  }
  for (const { address } of listed) add(address, ownBank(address), false);
  follow();
  // addresses at $8000-$BFFF reached with no bank known: taken in the one bank where they read as code, and only if
  // that bank has code already
  for (let more = true; more;) {
    more = false;
    const withCode = new Set([...found.keys()].map(bankOf));
    for (const address of [...unresolved.keys()]) {
      const fits = [];
      for (let bank = 0; bank < banks - 1; bank++) {
        const at = programOffset(address, bank, banks);
        if (withCode.has(bank) && readsAsCode(at) && !pool.has(at)) fits.push(at);
      }
      unresolved.delete(address);
      if (fits.length === 1 && !found.has(fits[0])) {
        add(fits[0], bankOf(fits[0]), true);
        more = true;
      }
    }
    follow();
  }

  // what nothing calls or points at, as code a table no one follows leads to: what's left between the functions of
  // a bank with code, past any padding, that reads as code up to its end, with every address it uses one the console
  // has and every call to code that reads as code too
  const tried = new Set();
  for (let more = true; more;) {
    more = false;
    const spans = [...found].map(([address, f]) => [address, Math.min(f.end, (bankOf(address) + 1) * BANK)]).sort((a, b) => a[0] - b[0]);
    const withCode = new Set(spans.map(([address]) => bankOf(address)));
    spans.forEach(([, end], i) => {
      const to = Math.min(spans[i + 1]?.[0] ?? size, (bankOf(end - 1) + 1) * BANK);
      let at = Math.max(end, ...spans.slice(0, i).map(([, e]) => e));
      while (at < to && (u8(at) === 0xFF || u8(at) === 0x00 || u8(at) === 0xEA)) at++;
      if (at < to && withCode.has(bankOf(at)) && !tried.has(at) && looksLikeCode(at, to)) {
        tried.add(at);
        add(at, ownBank(at), false);
        more = true;
      }
    });
    follow();
  }

  // each function ends where the next one starts, at the latest, and in its own bank
  const list = [...found].map(([address, f]) => ({ address, end: Math.min(f.end, (Math.floor(address / BANK) + 1) * BANK) })).sort((a, b) => a.address - b.address);
  let furthest = 0;
  return list.map((f, i) => {
    furthest = Math.max(sameWindow(furthest - 1, f.address) ? furthest : 0, f.end);
    return { address: f.address, size: Math.min(furthest, list[i + 1]?.address ?? Infinity) - f.address };
  });
}

/** Those of a list's functions that start in a table of addresses the code reads, which nothing the tools find leads to. */
export function startsInData(bytes, listed) {
  const pool = new Set();
  const functions = new Set(findFunctions(bytes, [], pool).map(f => f.address));
  return listed.filter(({ address }) => !functions.has(address) && pool.has(address));
}
