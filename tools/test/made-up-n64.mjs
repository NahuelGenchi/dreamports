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

const R = { zero: 0, at: 1, v0: 2, v1: 3, a0: 4, a1: 5, a2: 6, a3: 7, t0: 8, t1: 9, t2: 10, t3: 11, t4: 12, t5: 13, t6: 14, t7: 15, s0: 16, s1: 17, s2: 18, sp: 29, fp: 30, ra: 31 };
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
// the boot code that copies `bytes` of the cartridge after it
const bootFor = bytes => [
  lui('t0', 0xA460), addiu('t1', 'zero', LOAD & 0xFFFF), sw('t1', 0x00, 't0'),
  lui('t1', 0x1000), ori('t1', 't1', 0x1000), sw('t1', 0x04, 't0'),
  lui('t1', (bytes - 1) >>> 16), ori('t1', 't1', (bytes - 1) & 0xFFFF), sw('t1', 0x0C, 't0'),
  here('wait'), lw('t2', 0x10, 't0'), andi('t2', 't2', 3), bne('t2', 'zero', 'wait'), nop,
  lui('t3', LOAD >>> 16), ori('t3', 't3', LOAD & 0xFFFF), jr('t3'), nop,
];
const BOOT = bootFor(0x100000);

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

// A second program, for the Nintendo 64's kit (n64-kit.mjs): it sets the video interface up to show a picture of 320 by
// 240 in 16-bit colour, puts a microcode of its own in the RSP's instructions, and every frame waits for the video
// interface's interrupt, tells the RSP where the square is and which shade it is this frame, and starts it. The
// microcode makes the RDP's command for the square and, with a sum of the vector unit, the square's colour, and has the
// RDP read the commands straight from the RSP's memory: the background filled, then the square, then a full sync, whose
// interrupt the program waits for. The square moves STEP pixels a frame, round and round. Its boot code copies only the
// 8 KB the program needs, so it's running well before the first frame ends.

/** What the program draws, in the console's 16-bit colours, red highest and a bit of coverage lowest. */
export const KIT = { FRAMEBUFFER: 0x00100000, BACKGROUND: 0x2109, SQUARE: 0xF801, SHADE: 0x0040, SQUARE_Y: 100, SIZE: 32, STEP: 2, LAST_X: 288 };

// the RSP's instructions: its loads, stores and moves to its coprocessor 0, and the vector unit's
const rspLoad = (rt, offset) => i(0x23, 'zero', rt, offset);
const rspStore = (rt, offset) => i(0x2B, 'zero', rt, offset);
const rspHalf = (rt, offset) => i(0x25, 'zero', rt, offset);
const mtc0 = (rt, rd) => ((16 << 26) | (4 << 21) | (R[rt] << 16) | (rd << 11)) >>> 0;
const lqv = (vt, offset) => ((50 << 26) | (vt << 16) | (4 << 11) | ((offset / 16) & 0x7F)) >>> 0;
const sqv = (vt, offset) => ((58 << 26) | (vt << 16) | (4 << 11) | ((offset / 16) & 0x7F)) >>> 0;
const vadd = (vd, vs, vt) => ((18 << 26) | (1 << 25) | (vt << 16) | (vs << 11) | (vd << 6) | 0x10) >>> 0;
const or = (rd, rs, rt) => r(rs, rt, rd, 0, 0x25);
const breakpoint = 0x0000000D;

// The RSP's data memory as the program lays it out: the square's x at 0, the colours to add at 0x10 and 0x20, their
// sum at 0x30, and the RDP's commands from 0x100 to 0x140, which the program writes but for the square's colour and
// rectangle, which the microcode makes.
const { FRAMEBUFFER, BACKGROUND, SQUARE, SQUARE_Y, SIZE, STEP, LAST_X } = KIT;
const top = SQUARE_Y * 4, bottom = (SQUARE_Y + SIZE - 1) * 4;
/** The RDP's commands the program writes, each two words, from the RSP's data memory's 0x100. */
export const KIT_COMMANDS = [
  0xFF10013F, FRAMEBUFFER,                        // the colour image: 16-bit, 320 wide, at FRAMEBUFFER
  0xED000000, 0x005003C0,                         // the scissor: 0, 0 to 320, 240
  0xEF300000, 0x00000000,                         // other modes: fill
  0xF7000000, ((BACKGROUND << 16) | BACKGROUND) >>> 0, // the fill colour: the background's, twice
  0xF64FC3BC, 0x00000000,                         // a rectangle: 0, 0 to 319, 239
  0xF7000000, 0x00000000,                         // the square's fill colour, which the microcode makes
  0xF6000000, 0x00000000,                         // the square's rectangle, which the microcode makes
  0xE9000000, 0x00000000,                         // a full sync
];
/** The microcode, as the RSP's words, which runs from the start of its instructions. */
export const KIT_MICROCODE = [
  rspLoad('t0', 0x000), sll('t1', 't0', 2), addiu('t2', 't1', (SIZE - 1) * 4), sll('t2', 't2', 12), lui('t3', 0xF600), or('t2', 't2', 't3'), ori('t2', 't2', bottom),
  sll('t1', 't1', 12), ori('t1', 't1', top), rspStore('t2', 0x130), rspStore('t1', 0x134),
  lqv(1, 0x10), lqv(2, 0x20), vadd(3, 1, 2), sqv(3, 0x30), rspHalf('t4', 0x30), sll('t5', 't4', 16), or('t5', 't5', 't4'), rspStore('t5', 0x12C),
  addiu('t6', 'zero', 2), mtc0('t6', 11), addiu('t7', 'zero', 0x100), mtc0('t7', 8), addiu('t7', 'zero', 0x140), mtc0('t7', 9),
  breakpoint, nop,
];

const sh = (rt, offset, base) => i(0x29, base, rt, offset);
// the two halves of where a label is in the console's memory, as its DMA takes it
const physicalHi = (rt, label) => ({ at: labels => lui(rt, (((labels[label] & 0x1FFFFFFF) + 0x8000) >>> 16) & 0xFFFF) });
const physicalLo = (rt, rs, label) => ({ at: labels => addiu(rt, rs, labels[label] & 0xFFFF) });
const li32 = (rt, value) => [lui(rt, value >>> 16), ori(rt, rt, value & 0xFFFF)];

// The second task the program gives the RSP each frame, the vector check, from VECTOR_AT in its instructions. From a
// seed of the square's place and shade it makes numbers with the scalar unit's shifts, so they change every frame, and
// runs every one of the vector unit's sums on them with elements of every kind, keeping the accumulator and the flags
// after them, and its loads and stores of every size, each result 16 bytes from 0x300 in the RSP's data memory. The
// RSP's own DMA sends them into the picture's rows from VECTOR_ROW, 608 bytes a row where the screen shows them whole,
// once as they are and once with each half-word turned round by a bit, as the picture shows fifteen bits of each
// sixteen: so a proof compares every bit of every result, every frame.
export const VECTOR_AT = 0x80, VECTOR_ROW = 200;
const ROW_BYTES = 608, RESULTS = 0x300;
const xor = (rd, rs, rt) => r(rs, rt, rd, 0, 0x26);
const srl = (rd, rt, sa) => r('zero', rt, rd, sa, 2);
const lhu = (rt, offset, base) => i(0x25, base, rt, offset);
const bgtz = (rs, label) => ({ at: (labels, pc) => i(7, rs, 'zero', (labels[label] - pc - 4) >> 2) });
const cop2 = (op, rt, rd, e = 0) => ((0x12 << 26) | (op << 21) | (R[rt] << 16) | (rd << 11) | (e << 7)) >>> 0;
const vu = (fn, vd, vs, vt, e = 0) => ((0x12 << 26) | (1 << 25) | (e << 21) | (vt << 16) | (vs << 11) | (vd << 6) | fn) >>> 0;
const lwc2 = (kind, vt, e, offset, base) => ((0x32 << 26) | (R[base] << 21) | (vt << 16) | (kind << 11) | (e << 7) | (offset & 0x7F)) >>> 0;
const swc2 = (kind, vt, e, offset, base) => ((0x3A << 26) | (R[base] << 21) | (vt << 16) | (kind << 11) | (e << 7) | (offset & 0x7F)) >>> 0;
const VECTOR_CHECK = (() => {
  const items = [];
  let blocks = 0;
  // a register's 16 bytes as the next result, the accumulator's three parts, and the three flags
  const result = v => { items.push(swc2(4, v, 0, 0, 'a0'), addiu('a0', 'a0', 16)); blocks++; };
  const accumulator = () => { for (const e of [8, 9, 10]) { items.push(vu(0x1D, 8, 0, 0, e)); result(8); } };
  const flagsOut = () => { items.push(cop2(2, 't1', 0), sh('t1', 0, 'a0'), cop2(2, 't1', 1), sh('t1', 2, 'a0'), cop2(2, 't1', 2), sh('t1', 4, 'a0'), addiu('a0', 'a0', 16)); blocks++; };
  const flags = () => items.push(lhu('t1', 0x240, 'zero'), cop2(6, 't1', 0), lhu('t1', 0x242, 'zero'), cop2(6, 't1', 1), lhu('t1', 0x244, 'zero'), cop2(6, 't1', 2));
  const ROWS = 4;
  items.push(
    // the seed, and 20 words of numbers from 0x200 made from it
    rspLoad('t0', 0x000), rspHalf('t1', 0x020), sll('t1', 't1', 16), xor('t0', 't0', 't1'), ...li32('t1', 0x9E3779B9), xor('t0', 't0', 't1'),
    addiu('s1', 'zero', 0x200), addiu('s0', 'zero', 20),
    here('numbers'), sll('t1', 't0', 13), xor('t0', 't0', 't1'), srl('t1', 't0', 17), xor('t0', 't0', 't1'), sll('t1', 't0', 5), xor('t0', 't0', 't1'),
    sw('t0', 0, 's1'), addiu('s0', 's0', -1), bne('s0', 'zero', 'numbers'), addiu('s1', 's1', 4),
    // the third and fourth vectors small: each lane's sign and two lowest bits, so lanes are often equal
    addiu('s1', 'zero', 0x220), addiu('s0', 'zero', 16),
    here('small'), lhu('t1', 0, 's1'), andi('t1', 't1', 0x8003), sh('t1', 0, 's1'), addiu('s0', 's0', -1), bgtz('s0', 'small'), addiu('s1', 's1', 2),
    // the edges, and everything from them to the results' end cleared
    ...[0x80007FFF, 0x0000FFFF, 0x80010001, 0x7FFEFFFE].flatMap((word, n) => [...li32('t1', word), sw('t1', 0x250 + n * 4, 'zero')]),
    addiu('s1', 'zero', 0x260), addiu('s0', 'zero', (RESULTS + ROWS * ROW_BYTES - 0x260) / 4),
    here('clearing'), sw('zero', 0, 's1'), addiu('s0', 's0', -1), bgtz('s0', 'clearing'), addiu('s1', 's1', 4),
    // the vectors: two of numbers, two small, the edges and zero, and the flags from the numbers after them
    vu(0x2C, 0, 0, 0), lqv(1, 0x200), lqv(2, 0x210), lqv(3, 0x220), lqv(4, 0x230), lqv(5, 0x250),
    addiu('a0', 'zero', RESULTS),
  );
  // the multiplies, against numbers and edges with each element, and what each leaves in the accumulator
  [0x00, 0x01, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0C, 0x0D, 0x0E, 0x0F].forEach((fn, n) => { items.push(vu(fn, 6, n % 3 ? 1 : 5, n % 2 ? 5 : 2, (n * 5) % 16)); result(6); accumulator(); });
  // those the console reserves
  for (const fn of [0x02, 0x03, 0x0A, 0x0B, 0x12, 0x1E, 0x38]) { items.push(vu(fn, 6, 1, 2, 0)); result(6); }
  // the sums, with the flags before and after
  flags();
  for (const [fn, vs, vt, e] of [[0x14, 1, 2, 0], [0x10, 1, 5, 2], [0x15, 2, 1, 4], [0x11, 5, 2, 8], [0x14, 5, 5, 3], [0x10, 5, 5, 0]]) { items.push(vu(fn, 6, vs, vt, e)); result(6); flagsOut(); }
  for (const [vs, vt, e] of [[1, 5, 0], [5, 2, 9], [3, 5, 0]]) { items.push(vu(0x13, 6, vs, vt, e)); result(6); }
  // the comparisons, each from the numbers' flags, and VCL after VCH as they're used
  for (const [fn, vs, vt, e] of [[0x20, 3, 4, 0], [0x21, 3, 4, 2], [0x22, 3, 4, 5], [0x23, 3, 4, 9], [0x24, 3, 4, 0], [0x24, 1, 2, 3], [0x25, 5, 4, 12], [0x26, 3, 4, 0], [0x27, 1, 2, 0]]) { flags(); items.push(vu(fn, 6, vs, vt, e)); result(6); flagsOut(); }
  for (const fn of [0x25, 0x24]) { items.push(vu(fn, 6, 3, 4, 0)); result(6); flagsOut(); }
  // the logic
  [0x28, 0x29, 0x2A, 0x2B, 0x2C, 0x2D].forEach((fn, n) => { items.push(vu(fn, 6, 1, 2, n * 3)); result(6); });
  // the divides, single and double, from numbers and edges, into one lane each
  items.push(vu(0x30, 7, 0, 1, 8), vu(0x32, 7, 1, 2, 9), vu(0x31, 7, 2, 1, 10), vu(0x34, 7, 3, 5, 10), vu(0x36, 7, 4, 1, 11), vu(0x35, 7, 5, 2, 12), vu(0x30, 7, 6, 5, 8), vu(0x33, 7, 7, 2, 13));
  result(7); accumulator();
  items.push(vu(0x31, 9, 0, 5, 11), vu(0x35, 9, 1, 5, 12), vu(0x30, 9, 2, 3, 13), vu(0x34, 9, 3, 4, 14), vu(0x32, 9, 4, 5, 9), vu(0x31, 9, 5, 5, 15), vu(0x36, 9, 6, 3, 8), vu(0x35, 9, 7, 4, 9), vu(0x37, 9, 0, 0, 0));
  result(9);
  // the moves between the units
  items.push(vu(0x2A, 9, 2, 0), cop2(0, 't1', 1, 5), cop2(4, 't1', 9, 14), cop2(0, 't2', 5, 15), cop2(4, 't2', 9, 3));
  result(9);
  // the loads, each into a copy of the second vector, from addresses the seed moves
  items.push(andi('t5', 't0', 0xE), addiu('t5', 't5', 0x200), srl('t6', 't0', 4), andi('t6', 't6', 0xF), addiu('t6', 't6', 0x200));
  const load = (kind, e, offset, base, v = 9) => { items.push(vu(0x2A, v, 2, 0), lwc2(kind, v, e, offset, base)); result(v); };
  for (const e of [0, 7, 15]) load(0, e, 1, 't6');
  for (const e of [0, 6, 14]) load(1, e, 1, 't5');
  for (const e of [0, 4, 12]) load(2, e, 1, 't5');
  for (const e of [0, 8]) load(3, e, 1, 't5');
  for (const e of [0, 2]) load(4, e, 0, 't5');
  load(5, 0, 1, 't5');
  load(6, 0, 0, 't6');
  load(7, 0, 0, 't6');
  load(8, 0, 0x21, 'zero');
  load(9, 0, 0x21, 'zero');
  for (let v = 16; v < 24; v++) items.push(vu(0x2A, v, 2, 0));
  items.push(lwc2(11, 16, 2, 0x20, 'zero'));
  for (let v = 16; v < 24; v++) result(v);
  // the stores, each over a copy of the first vector, at places the seed moves
  const store = (kind, v, e, offset, base, place) => {
    items.push(swc2(4, 1, 0, 0, 'a0'), ...place, swc2(kind, v, e, offset, base), addiu('a0', 'a0', 16));
    blocks++;
  };
  const even = [andi('t1', 't0', 6), r('a0', 't1', 't7', 0, 0x21)], any = [srl('t1', 't0', 8), andi('t1', 't1', 7), r('a0', 't1', 't7', 0, 0x21)];
  const aligned = [addiu('t7', 'a0', 0)], before = [andi('t1', 't0', 6), addiu('t1', 't1', 2), r('a0', 't1', 't7', 0, 0x21)];
  store(0, 2, 3, 0, 't7', any);
  store(1, 2, 2, 0, 't7', even);
  store(2, 2, 4, 0, 't7', even);
  store(3, 2, 8, 0, 't7', even);
  store(4, 2, 0, 0, 't7', even);
  store(4, 2, 0, 0, 't7', aligned);
  store(5, 2, 0, 0, 't7', before);
  store(6, 2, 0, 0, 't7', any);
  store(7, 2, 0, 0, 't7', any);
  store(7, 2, 3, 0, 't7', any);
  store(8, 2, 0, 0, 't7', aligned);
  store(9, 2, 0, 0, 't7', aligned);
  store(9, 2, 8, 0, 't7', aligned);
  store(10, 2, 0, 0, 't7', aligned);
  store(11, 16, 0, 0, 't7', aligned);
  store(11, 16, 2, 0, 't7', aligned);
  if (blocks * 16 > ROWS * ROW_BYTES) throw new Error(`The vector check's ${blocks} results don't fit its ${ROWS} rows.`);
  // the results into the picture, as they are and then turned round by a bit
  const lengths = (32 << 20) | ((ROWS - 1) << 12) | (ROW_BYTES - 1);
  const send = row => [addiu('t1', 'zero', RESULTS), mtc0('t1', 0), ...li32('t1', FRAMEBUFFER + row * 640 + 8), mtc0('t1', 1), ...li32('t1', lengths), mtc0('t1', 3)];
  items.push(
    ...send(VECTOR_ROW), jal('turn'), nop, ...send(VECTOR_ROW + ROWS), breakpoint, nop,
    here('turn'), addiu('s1', 'zero', RESULTS), addiu('s0', 'zero', ROWS * ROW_BYTES / 2),
    here('turning'), lhu('t1', 0, 's1'), sll('t2', 't1', 1), srl('t3', 't1', 15), or('t1', 't2', 't3'), sh('t1', 0, 's1'), addiu('s0', 's0', -1), bgtz('s0', 'turning'), addiu('s1', 's1', 2),
    jr('ra'), nop,
  );
  const { words } = assemble(items, VECTOR_AT);
  if (VECTOR_AT + words.length * 4 > 0x1000) throw new Error('The vector check is longer than the RSP\'s instruction memory.');
  return words;
})();
// the square's microcode and then the vector check's, as the program copies them into the RSP's instructions
const MICROCODES = [...KIT_MICROCODE, ...new Array(VECTOR_AT / 4 - KIT_MICROCODE.length).fill(nop), ...VECTOR_CHECK];

const VI_REGISTERS = [[0x04, FRAMEBUFFER], [0x08, 320], [0x0C, 2], [0x14, 0x03E52239], [0x18, 0x20D], [0x1C, 0xC15], [0x20, 0x0C150C15], [0x24, 0x006C02EC], [0x28, 0x002501FF], [0x2C, 0x000E0204], [0x30, 0x200], [0x34, 0x400], [0x00, 0x3302]];
const KIT_PROGRAM = [
  here('start'),
  // the video interface: 16-bit colour, no filtering, every pixel shown twice across, 240 lines
  lui('t0', 0xA440), ...VI_REGISTERS.flatMap(([offset, value]) => [...li32('t1', value), sw('t1', offset, 't0')]),
  // the RDP's commands in the RSP's data memory, and the colours the vector unit adds, the square's in the first
  lui('s2', 0xA400), ...KIT_COMMANDS.flatMap((word, n) => [...li32('t1', word), sw('t1', 0x100 + n * 4, 's2')]),
  ...li32('t1', SQUARE << 16), sw('t1', 0x10, 's2'), sw('zero', 0x14, 's2'), sw('zero', 0x18, 's2'), sw('zero', 0x1C, 's2'),
  sw('zero', 0x20, 's2'), sw('zero', 0x24, 's2'), sw('zero', 0x28, 's2'), sw('zero', 0x2C, 's2'),
  // the microcode copied into the RSP's instructions, and its start
  lui('t0', 0xA404), addiu('t1', 'zero', 0x1000), sw('t1', 0x00, 't0'), physicalHi('t1', 'microcode'), physicalLo('t1', 't1', 'microcode'), sw('t1', 0x04, 't0'),
  addiu('t1', 'zero', MICROCODES.length * 4 - 1), sw('t1', 0x08, 't0'),
  here('copying'), lw('t2', 0x18, 't0'), bne('t2', 'zero', 'copying'), nop,
  addiu('s0', 'zero', 0), addiu('s1', 'zero', 0),
  here('frame'),
  // the video interface's interrupt, and then it's told it was seen
  lui('t0', 0xA430), here('waiting'), lw('t1', 0x08, 't0'), andi('t1', 't1', 0x08), beq('t1', 'zero', 'waiting'), nop,
  lui('t0', 0xA440), sw('zero', 0x10, 't0'),
  // where the square is, and this frame's shade, which the microcode adds to its colour
  sw('s0', 0x000, 's2'), andi('t1', 's1', 15), sll('t1', 't1', 6), sh('t1', 0x20, 's2'),
  // the RSP started from its first instruction, to interrupt at its break as games have it, and waited for until it
  // halts there, and then its interrupt seen
  lui('t0', 0xA408), sw('zero', 0, 't0'),
  lui('t0', 0xA404), addiu('t1', 'zero', 0x105), sw('t1', 0x10, 't0'),
  here('running'), lw('t1', 0x10, 't0'), andi('t1', 't1', 1), beq('t1', 'zero', 'running'), nop,
  addiu('t1', 'zero', 0x8), sw('t1', 0x10, 't0'),
  // the RDP's full sync, and then it's told it was seen
  lui('t0', 0xA430), here('drawing'), lw('t1', 0x08, 't0'), andi('t1', 't1', 0x20), beq('t1', 'zero', 'drawing'), nop,
  addiu('t1', 'zero', 0x800), sw('t1', 0x00, 't0'),
  // the vector check, the RSP's second task, from VECTOR_AT, and its interrupt seen once it halts
  lui('t0', 0xA408), addiu('t1', 'zero', VECTOR_AT), sw('t1', 0, 't0'),
  lui('t0', 0xA404), addiu('t1', 'zero', 0x105), sw('t1', 0x10, 't0'),
  here('checking'), lw('t1', 0x10, 't0'), andi('t1', 't1', 1), beq('t1', 'zero', 'checking'), nop,
  addiu('t1', 'zero', 0x8), sw('t1', 0x10, 't0'),
  // the square moves on, round and round
  addiu('s0', 's0', STEP), sltiu('t1', 's0', LAST_X + 1), bne('t1', 'zero', 'same'), nop, addiu('s0', 'zero', 0),
  here('same'), b('frame'), addiu('s1', 's1', 1),
  { align: 8 }, here('microcode'), ...MICROCODES,
  here('end'),
];

/** Where the kit's program keeps its microcode, which its Dreamport copies to the RSP as the program does, and how
 *  many bytes it is. */
export function madeUpKitMicrocode() {
  return { address: assemble(KIT_PROGRAM, LOAD).labels.microcode, bytes: MICROCODES.length * 4 };
}

/** The kit's program as a cartridge the console boots. */
export function madeUpKitCartridge() {
  const { words } = assemble(KIT_PROGRAM, LOAD);
  if (words.length * 4 > 0x2000) throw new Error('The kit\'s program is longer than its boot code copies.');
  const cartridge = Buffer.alloc(0x1000 + 0x2000);
  cartridge.writeUInt32BE(0x80371240, 0x00);
  cartridge.writeUInt32BE(0x0000000F, 0x04);
  cartridge.writeUInt32BE(LOAD, 0x08);
  cartridge.write('DREAMPORTS KIT'.padEnd(20), 0x20, 'latin1');
  cartridge.write('NDKE', 0x3B, 'latin1');
  assemble(bootFor(0x2000), 0xA4000040).words.forEach((word, n) => cartridge.writeUInt32BE(word, 0x40 + n * 4));
  words.forEach((word, n) => cartridge.writeUInt32BE(word, 0x1000 + n * 4));
  return cartridge;
}

// A third program, for the test of a game whose tasks are its parts (n64-parts.mjs): it sets the video interface up as
// the kit's program does, and every frame waits for the video interface's interrupt and calls step. step calls count,
// which adds one to the frame's count, a word of the console's memory, and then red while the count is under 60 and
// blue from then on. Each fills the picture's first four rows with a colour whose level is the count's low five bits.
// Its start, with the loop in it, never comes back, and the other four functions do.

/** Where the parts program keeps its count, how many pixels red and blue fill, and the count blue starts at. */
export const PARTS = { COUNT: 0x80200000, PIXELS: 1280, TURN: 60 };
const fillWith = (name, shift) => [
  here(name), lui('t0', PARTS.COUNT >>> 16), lw('t1', 0, 't0'), andi('t1', 't1', 31), sll('t1', 't1', shift), ori('t1', 't1', 1),
  lui('t2', (0xA0000000 + FRAMEBUFFER) >>> 16), addiu('t3', 'zero', PARTS.PIXELS),
  here(`${name}_loop`), sh('t1', 0, 't2'), addiu('t3', 't3', -1), bne('t3', 'zero', `${name}_loop`), addiu('t2', 't2', 2),
  jr('ra'), nop,
];
const PARTS_PROGRAM = [
  here('start'), lui('sp', STACK >>> 16), ori('sp', 'sp', STACK & 0xFFFF),
  lui('t0', 0xA440), ...VI_REGISTERS.flatMap(([offset, value]) => [...li32('t1', value), sw('t1', offset, 't0')]),
  lui('t0', PARTS.COUNT >>> 16), sw('zero', 0, 't0'),
  here('frame'),
  // the video interface's interrupt, and then it's told it was seen
  lui('t0', 0xA430), here('waiting'), lw('t1', 0x08, 't0'), andi('t1', 't1', 0x08), beq('t1', 'zero', 'waiting'), nop,
  lui('t0', 0xA440), sw('zero', 0x10, 't0'),
  jal('step'), nop, b('frame'), nop,
  here('step'), addiu('sp', 'sp', -24), sw('ra', 20, 'sp'), jal('count'), nop,
  lui('t0', PARTS.COUNT >>> 16), lw('t1', 0, 't0'), sltiu('t2', 't1', PARTS.TURN), beq('t2', 'zero', 'later'), nop,
  jal('red'), nop, b('done'), nop,
  here('later'), jal('blue'), nop,
  here('done'), lw('ra', 20, 'sp'), jr('ra'), addiu('sp', 'sp', 24),
  here('count'), lui('t0', PARTS.COUNT >>> 16), lw('t1', 0, 't0'), addiu('t1', 't1', 1), jr('ra'), sw('t1', 0, 't0'),
  // red in the colour's top five bits, blue in the five above its lowest, which is the pixel's coverage
  ...fillWith('red', 11), ...fillWith('blue', 1),
  here('end'),
];

/** The parts program as a cartridge the console boots: { cartridge, labels }, `labels` the address of start, step,
 *  count, red and blue. */
export function madeUpPartsCartridge() {
  const { words, labels } = assemble(PARTS_PROGRAM, LOAD);
  const cartridge = Buffer.alloc(0x1000 + 0x2000);
  cartridge.writeUInt32BE(0x80371240, 0x00);
  cartridge.writeUInt32BE(0x0000000F, 0x04);
  cartridge.writeUInt32BE(LOAD, 0x08);
  cartridge.write('DREAMPORTS PARTS'.padEnd(20), 0x20, 'latin1');
  cartridge.write('NDRE', 0x3B, 'latin1');
  assemble(bootFor(0x2000), 0xA4000040).words.forEach((word, n) => cartridge.writeUInt32BE(word, 0x40 + n * 4));
  words.forEach((word, n) => cartridge.writeUInt32BE(word, 0x1000 + n * 4));
  return { cartridge, labels };
}
