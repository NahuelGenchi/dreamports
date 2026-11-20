// A small Nintendo 64 program with nothing from any game in it, written here, for the tools' tests of the Nintendo 64:
// a program whose functions each do one thing the tools have to see. Its instructions are written as their words,
// with the few lines below that make them, so the tests need no assembler. The console keeps each word with its
// highest byte first, and so does every place this program is put.
//
// Its functions, in order, from where it loads:
//   start      the entry: sets the stack, calls main, and waits for ever
//   main       calls sum, fill, twice and lookup, and then each function in its table, through a pointer
//   sum        a0 + a1
//   fill       writes a1 bytes of a2 from a0, in a loop
//   lookup     the a0th word of its table of values
//   twice      sum(a0, a0), through a call, with a stack of its own
//   wide       a0 in the high half of a 64-bit number and a1 added, kept at a2 and given back as the console's
//              compilers give one, its high word in v0 and its low in v1
//   likely     1 when a0 is 0 and 2 when it isn't, by a branch whose delay slot runs only when it goes
//   addf       the sum of the two singles at a0, kept after them
//   square     the double at a0 squared, kept after it
//   mulf       the product of two floats, given in $f12 and $f14, in $f0
//   addd       the sum of two doubles, given in $f12 and $f14, in $f0
//   bits       a float given after a whole number, which comes in a1, given back as its bits
//   forever    a loop that never ends
//   misaligned reads a word where none starts
//   cartridge  reads the cartridge, at 0xB0000000
//   hardware   writes a register of the video interface and the RSP's data memory
//   trap       a syscall
//   unmapped   reads an address only the TLB can map, and it maps nothing
//   pick       a switch on a0, through a table of its cases
// and after the program's values:
//   shine      reached only through the table of functions, with a stack of its own

/** Where the program loads and starts, as the console's own boot code puts a game's, and its stack. */
export const LOAD = 0x80000400;
export const STACK = 0x803FFF00;

const R = { zero: 0, at: 1, v0: 2, v1: 3, a0: 4, a1: 5, a2: 6, a3: 7, t0: 8, t1: 9, t2: 10, t3: 11, s0: 16, sp: 29, fp: 30, ra: 31 };
const i = (op, rs, rt, imm) => ((op << 26) | (R[rs] << 21) | (R[rt] << 16) | (imm & 0xFFFF)) >>> 0;
const r = (rs, rt, rd, sa, fn) => ((R[rs] << 21) | (R[rt] << 16) | (R[rd] << 11) | (sa << 6) | fn) >>> 0;
const nop = 0;
const addu = (rd, rs, rt) => r(rs, rt, rd, 0, 0x21);
const daddu = (rd, rs, rt) => r(rs, rt, rd, 0, 0x2D);
const dsll32 = (rd, rt, sa) => r('zero', rt, rd, sa, 0x3C);
const dsra32 = (rd, rt, sa) => r('zero', rt, rd, sa, 0x3F);
const addiu = (rt, rs, imm) => i(9, rs, rt, imm);
const ori = (rt, rs, imm) => i(13, rs, rt, imm);
const lui = (rt, imm) => i(15, 'zero', rt, imm);
const sltiu = (rt, rs, imm) => i(11, rs, rt, imm);
const sll = (rd, rt, sa) => r('zero', rt, rd, sa, 0);
const jr = rs => r(rs, 'zero', 'zero', 0, 8);
const jalr = rs => r(rs, 'zero', 'ra', 0, 9);
const syscall = 0x0000000C;
const lw = (rt, offset, base) => i(0x23, base, rt, offset);
const sw = (rt, offset, base) => i(0x2B, base, rt, offset);
const sb = (rt, offset, base) => i(0x28, base, rt, offset);
const sd = (rt, offset, base) => i(0x3F, base, rt, offset);
// the floating-point unit's: its loads and stores by register number, and two of its sums, single and double
const f = (op, ft, offset, base) => ((op << 26) | (R[base] << 21) | (ft << 16) | (offset & 0xFFFF)) >>> 0;
const lwc1 = (ft, offset, base) => f(0x31, ft, offset, base);
const swc1 = (ft, offset, base) => f(0x39, ft, offset, base);
const ldc1 = (ft, offset, base) => f(0x35, ft, offset, base);
const sdc1 = (ft, offset, base) => f(0x3D, ft, offset, base);
const cop1 = (format, ft, fs, fd, fn) => ((17 << 26) | (format << 21) | (ft << 16) | (fs << 11) | (fd << 6) | fn) >>> 0;
const addS = (fd, fs, ft) => cop1(16, ft, fs, fd, 0);
const mulD = (fd, fs, ft) => cop1(17, ft, fs, fd, 2);
const mulS = (fd, fs, ft) => cop1(16, ft, fs, fd, 2);
const addD = (fd, fs, ft) => cop1(17, ft, fs, fd, 0);
// what needs to know where things are: a branch to a label, a call, and the two halves of an address
const branch = op => (rs, rt, label) => ({ at: (labels, pc) => i(op, rs, rt, (labels[label] - pc - 4) >> 2) });
const beq = branch(4), beql = branch(0x14);
const b = label => beq('zero', 'zero', label);
const jal = label => ({ at: labels => ((3 << 26) | ((labels[label] >>> 2) & 0x3FFFFFF)) >>> 0 });
const hi = (rt, label) => ({ at: labels => lui(rt, (labels[label] + 0x8000) >>> 16) });
const lo = (rt, rs, label) => ({ at: labels => addiu(rt, rs, labels[label] & 0xFFFF) });
const lwLo = (rt, rs, label) => ({ at: labels => lw(rt, labels[label] & 0xFFFF, rs) });
const here = name => ({ name });
const pointer = label => ({ at: labels => labels[label] >>> 0 });

/** The program's values, read by lookup. */
export const VALUES = [0x11111111, 0x22222222, 0x33333333, 0x44444444];

const PROGRAM = [
  here('start'), lui('sp', STACK >>> 16), ori('sp', 'sp', STACK & 0xFFFF), jal('main'), nop, here('spin'), b('spin'), nop,
  here('main'), addiu('sp', 'sp', -32), sw('ra', 24, 'sp'), sw('s0', 20, 'sp'),
  addiu('a0', 'zero', 2), jal('sum'), addiu('a1', 'zero', 3),
  hi('a0', 'buffer'), lo('a0', 'a0', 'buffer'), addiu('a1', 'zero', 4), jal('fill'), addiu('a2', 'zero', 0x5A),
  jal('twice'), addiu('a0', 'zero', 21), jal('lookup'), addiu('a0', 'zero', 1),
  hi('s0', 'functions'), lo('s0', 's0', 'functions'), lw('t0', 0, 's0'), nop, jalr('t0'), nop,
  lw('s0', 20, 'sp'), lw('ra', 24, 'sp'), jr('ra'), addiu('sp', 'sp', 32),
  here('sum'), jr('ra'), addu('v0', 'a0', 'a1'),
  here('fill'), here('fill_loop'), beq('a1', 'zero', 'fill_done'), nop, sb('a2', 0, 'a0'), addiu('a0', 'a0', 1), b('fill_loop'), addiu('a1', 'a1', -1),
  here('fill_done'), jr('ra'), nop,
  here('lookup'), hi('t0', 'values'), lo('t0', 't0', 'values'), sll('t1', 'a0', 2), addu('t0', 't0', 't1'), lw('v0', 0, 't0'), jr('ra'), nop,
  here('twice'), addiu('sp', 'sp', -24), sw('ra', 16, 'sp'), jal('sum'), addu('a1', 'a0', 'zero'), lw('ra', 16, 'sp'), jr('ra'), addiu('sp', 'sp', 24),
  here('wide'), dsll32('t0', 'a0', 0), daddu('t0', 't0', 'a1'), sd('t0', 0, 'a2'), dsra32('v0', 't0', 0), jr('ra'), sll('v1', 't0', 0),
  here('likely'), beql('a0', 'zero', 'likely_zero'), addiu('v0', 'zero', 1), addiu('v0', 'zero', 2), here('likely_zero'), jr('ra'), nop,
  here('addf'), lwc1(0, 0, 'a0'), lwc1(2, 4, 'a0'), addS(4, 0, 2), swc1(4, 8, 'a0'), jr('ra'), nop,
  here('square'), ldc1(0, 0, 'a0'), mulD(2, 0, 0), sdc1(2, 8, 'a0'), jr('ra'), nop,
  here('mulf'), mulS(0, 12, 14), jr('ra'), nop,
  here('addd'), addD(0, 12, 14), jr('ra'), nop,
  here('bits'), jr('ra'), addu('v0', 'a1', 'zero'),
  here('forever'), b('forever'), nop,
  here('misaligned'), lw('v0', 1, 'a0'), jr('ra'), nop,
  here('cartridge'), lui('t0', 0xB000), lw('v0', 0, 't0'), jr('ra'), nop,
  here('hardware'), lui('t0', 0xA440), sw('a0', 0x0C, 't0'), lui('t1', 0xA400), sw('a0', 0x10, 't1'), jr('ra'), nop,
  here('trap'), syscall, jr('ra'), nop,
  here('unmapped'), lui('t0', 0x0040), lw('v0', 0, 't0'), jr('ra'), nop,
  here('pick'), sltiu('t0', 'a0', 3), beq('t0', 'zero', 'pick_else'), sll('t0', 'a0', 2), hi('at', 'cases'), addu('at', 'at', 't0'), lwLo('t0', 'at', 'cases'), nop, jr('t0'), nop,
  here('pick_0'), jr('ra'), addiu('v0', 'zero', 10),
  here('pick_1'), jr('ra'), addiu('v0', 'zero', 20),
  here('pick_2'), jr('ra'), addiu('v0', 'zero', 30),
  here('pick_else'), jr('ra'), addiu('v0', 'zero', 0),
  here('values'), ...VALUES,
  here('cases'), pointer('pick_0'), pointer('pick_1'), pointer('pick_2'),
  here('shine'), addiu('sp', 'sp', -8), sw('a0', 0, 'sp'), addiu('v0', 'zero', 1), jr('ra'), addiu('sp', 'sp', 8),
  here('functions'), pointer('shine'),
  // where a doubleword's place starts, on a multiple of eight
  { align: 8 }, here('numbers'), 0, 0, 0, 0, 0, 0,
  here('buffer'), 0, 0,
  here('end'),
];

/** The functions, in order, each with the name of the label it starts at. */
export const FUNCTIONS = ['start', 'main', 'sum', 'fill', 'lookup', 'twice', 'wide', 'likely', 'addf', 'square', 'mulf', 'addd', 'bits', 'forever', 'misaligned', 'cartridge', 'hardware', 'trap', 'unmapped', 'pick', 'shine'];
// what isn't code: the values, the switch's table, the table of functions, the numbers and the buffer
const DATA = ['values', 'cases', 'functions', 'numbers', 'buffer', 'end'];

// The words of `items` placed from `base`, and where each label is
function assemble(items, base) {
  const labels = {};
  let pc = base;
  for (const item of items) {
    if (item.name) labels[item.name] = pc;
    else if (item.align) pc += (item.align - (pc % item.align)) % item.align;
    else pc += 4;
  }
  const words = [];
  pc = base;
  for (const item of items) {
    if (item.name) continue;
    if (item.align) {
      for (; pc % item.align; pc += 4) words.push(0);
      continue;
    }
    words.push(typeof item === 'number' ? item >>> 0 : item.at(labels, pc));
    pc += 4;
  }
  return { words, labels };
}

/** The program as words, from LOAD, where each label is, and each function's address and size. */
export function madeUpProgram() {
  const { words, labels } = assemble(PROGRAM, LOAD);
  // each function's address and size, to the next function or values after it
  const after = [...FUNCTIONS, ...DATA].map(name => labels[name]).sort((a, b) => a - b);
  const functions = FUNCTIONS.map(name => ({ name, address: labels[name], size: after.find(at => at > labels[name]) - labels[name] }));
  return { words, labels, functions };
}

// The cartridge's own boot code, which the console runs from the RSP's data memory, where it copies the cartridge's
// first 4 KB, at 0xA4000040, past the header: it has the cartridge interface copy the megabyte after it to where the
// program loads, waits until it's done, and jumps there, as the boot code a game's cartridge holds does once it has
// set the console up. It's the project's own, as is every word of this cartridge.
const andi = (rt, rs, imm) => i(12, rs, rt, imm);
const bne = branch(5);
const BOOT = [
  lui('t0', 0xA460), addiu('t1', 'zero', LOAD & 0xFFFF), sw('t1', 0x00, 't0'),
  lui('t1', 0x1000), ori('t1', 't1', 0x1000), sw('t1', 0x04, 't0'),
  lui('t1', 0x000F), ori('t1', 't1', 0xFFFF), sw('t1', 0x0C, 't0'),
  here('wait'), lw('t2', 0x10, 't0'), andi('t2', 't2', 3), bne('t2', 'zero', 'wait'), nop,
  lui('t3', LOAD >>> 16), ori('t3', 't3', LOAD & 0xFFFF), jr('t3'), nop,
];

/**
 * The program as a cartridge the console boots: its header, its boot code at 0x40, and the program at 0x1000, the
 * megabyte the boot code copies, which the cartridge holds all of. The header names where the program runs, or `named`,
 * as a cartridge whose boot code puts its program elsewhere does. { cartridge, labels, functions }.
 */
export function madeUpCartridge({ named = LOAD } = {}) {
  const { words, labels, functions } = madeUpProgram();
  const cartridge = Buffer.alloc(0x1000 + 0x100000);
  cartridge.writeUInt32BE(0x80371240, 0x00);
  cartridge.writeUInt32BE(0x0000000F, 0x04);
  cartridge.writeUInt32BE(named >>> 0, 0x08);
  cartridge.write('DREAMPORTS MADE UP'.padEnd(20), 0x20, 'latin1');
  cartridge.write('NDPE', 0x3B, 'latin1');
  assemble(BOOT, 0xA4000040).words.forEach((word, n) => cartridge.writeUInt32BE(word, 0x40 + n * 4));
  words.forEach((word, n) => cartridge.writeUInt32BE(word, 0x1000 + n * 4));
  return { cartridge, labels, functions };
}
