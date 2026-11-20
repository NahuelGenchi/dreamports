// A small PlayStation 2 program with nothing from any game in it, written here, for the function check's test
// (../ps2-twin.mjs): an ELF the console could load, whose functions each do one thing the check has to see, as Sony's
// compiler for the EE writes them, with the calling convention it keeps (arguments in a0 to a3 and t0 to t3, floats from
// f12, 32-bit values spread to 64 bits by their sign). Its instructions are written as their words, with the few lines
// below that make them, so the test needs no assembler. Its symbol table gives each function's start and size, as a
// program that kept its symbols does, so its code map is exact.
//
// Its functions, in order, from where it loads:
//   start      the entry: sets gp and the stack, calls main, and waits for ever
//   main       calls sum, fill, twice, lookup, wide, likely and pick, then the first of its table of functions
//   sum        a0 + a1, the sum written in the return's delay slot
//   fill       writes a1 bytes of a2 from a0, in a loop
//   lookup     the a0th word of the program's values
//   twice      sum(a0, a0), through a call, saving ra with a 64-bit store
//   wide       a0 + a1 as 64-bit numbers
//   scale      f12 * f13, a float product, which the EE cuts towards zero
//   eight      the sum of eight arguments, the last four in t0 to t3
//   copy16     a quadword from a1 to a0, by LQ and SQ, which leave out an address's low four bits
//   biggest    the larger of a0 and a1, by MMI's PMAXW on all four words
//   likely     7 when a0 is 0 and 3 otherwise, through a branch likely, whose delay slot runs only when it goes
//   pick       a switch on a0, through a table of its cases
//   hardware   writes the scratchpad and a register of the GS
//   kernel     calls the console's kernel
//   forever    a loop that never ends
//   misaligned reads a word where none starts
//   vu0        doubles the four floats a0 points at on vector unit 0, in macro mode, with LQC2, VADD and SQC2
//   shine      reached only through the table of functions
//   ten        the sum of ten arguments, the last two on the stack, eight bytes apart from where sp points
//   moded      a0 + 1 when the program's mode is the one play sets, and a0 otherwise
//   play       what stands for play: sets the mode, calls moded and then main, as a game's own code runs its functions
// and after them the program's values, the switch's table, the table of functions, a buffer and its mode.

/** Where the program loads and starts, and where its stack starts. */
export const LOAD = 0x00100000;
export const STACK = 0x01F00000;
/** The program's values, read by lookup. */
export const VALUES = [0x11111111, 0x22222222, 0x33333333, 0x44444444];
/** The mode play sets, which moded looks for. */
export const MODE = 0x1234ABCD;

const R = { zero: 0, at: 1, v0: 2, v1: 3, a0: 4, a1: 5, a2: 6, a3: 7, t0: 8, t1: 9, t2: 10, t3: 11, s0: 16, gp: 28, sp: 29, fp: 30, ra: 31 };
const i = (op, rs, rt, imm) => ((op << 26) | (R[rs] << 21) | (R[rt] << 16) | (imm & 0xFFFF)) >>> 0;
const r = (rs, rt, rd, sa, fn) => ((R[rs] << 21) | (R[rt] << 16) | (R[rd] << 11) | (sa << 6) | fn) >>> 0;
const nop = 0;
const addu = (rd, rs, rt) => r(rs, rt, rd, 0, 0x21);
const daddu = (rd, rs, rt) => r(rs, rt, rd, 0, 0x2D);
const addiu = (rt, rs, imm) => i(9, rs, rt, imm);
const lui = (rt, imm) => i(15, 'zero', rt, imm);
const ori = (rt, rs, imm) => i(13, rs, rt, imm);
const sltiu = (rt, rs, imm) => i(11, rs, rt, imm);
const sll = (rd, rt, sa) => r('zero', rt, rd, sa, 0);
const jr = rs => r(rs, 'zero', 'zero', 0, 8);
const jalr = rs => r(rs, 'zero', 'ra', 0, 9);
const syscall = 0x0C;
const lw = (rt, offset, base) => i(0x23, base, rt, offset);
const sw = (rt, offset, base) => i(0x2B, base, rt, offset);
const sb = (rt, offset, base) => i(0x28, base, rt, offset);
const ld = (rt, offset, base) => i(0x37, base, rt, offset);
const sd = (rt, offset, base) => i(0x3F, base, rt, offset);
const lq = (rt, offset, base) => i(0x1E, base, rt, offset);
const sq = (rt, offset, base) => i(0x1F, base, rt, offset);
// the FPU's product of two floats: fd = fs * ft
const mulS = (fd, fs, ft) => ((0x11 << 26) | (16 << 21) | (ft << 16) | (fs << 11) | (fd << 6) | 2) >>> 0;
// MMI's PMAXW, the larger of each of four words
const pmaxw = (rd, rs, rt) => ((0x1C << 26) | (R[rs] << 21) | (R[rt] << 16) | (R[rd] << 11) | (3 << 6) | 0x08) >>> 0;
// vector unit 0 in macro mode: a register to and from one of its vectors, and VADD.xyzw
const lqc2 = (vf, offset, base) => ((0x36 << 26) | (R[base] << 21) | (vf << 16) | (offset & 0xFFFF)) >>> 0;
const sqc2 = (vf, offset, base) => ((0x3E << 26) | (R[base] << 21) | (vf << 16) | (offset & 0xFFFF)) >>> 0;
const vadd = (fd, fs, ft) => ((0x12 << 26) | (1 << 25) | (0xF << 21) | (ft << 16) | (fs << 11) | (fd << 6) | 0x28) >>> 0;
// what needs to know where things are: a branch to a label, a call, and the two halves of an address
const branch = op => (rs, rt, label) => ({ at: (labels, pc) => i(op, rs, rt, (labels[label] - pc - 4) >> 2) });
const beq = branch(4), bne = branch(5), beql = branch(0x14);
const b = label => beq('zero', 'zero', label);
const jal = label => ({ at: labels => ((3 << 26) | ((labels[label] >>> 2) & 0x3FFFFFF)) >>> 0 });
const hi = (rt, label) => ({ at: labels => lui(rt, (labels[label] + 0x8000) >>> 16) });
const lo = (rt, rs, label) => ({ at: labels => addiu(rt, rs, labels[label] & 0xFFFF) });
const lwLo = (rt, rs, label) => ({ at: labels => lw(rt, labels[label] & 0xFFFF, rs) });
const swLo = (rt, rs, label) => ({ at: labels => sw(rt, labels[label] & 0xFFFF, rs) });
const here = name => ({ name });
const pointer = label => ({ at: labels => labels[label] >>> 0 });

const PROGRAM = [
  here('start'), hi('gp', 'values'), lo('gp', 'gp', 'values'), lui('sp', STACK >>> 16), jal('main'), nop, here('spin'), b('spin'), nop,
  here('main'), addiu('sp', 'sp', -32), sd('ra', 16, 'sp'), sd('s0', 0, 'sp'),
  addiu('a0', 'zero', 2), jal('sum'), addiu('a1', 'zero', 3),
  hi('a0', 'buffer'), lo('a0', 'a0', 'buffer'), addiu('a1', 'zero', 4), jal('fill'), addiu('a2', 'zero', 0x5A),
  jal('twice'), addiu('a0', 'zero', 21),
  jal('lookup'), addiu('a0', 'zero', 1),
  addiu('a0', 'zero', 40), jal('wide'), addiu('a1', 'zero', 2),
  jal('likely'), daddu('a0', 'zero', 'zero'),
  jal('pick'), addiu('a0', 'zero', 1),
  hi('v0', 'functions'), lwLo('v0', 'v0', 'functions'), jalr('v0'), addiu('a0', 'zero', 1),
  ld('s0', 0, 'sp'), ld('ra', 16, 'sp'), jr('ra'), addiu('sp', 'sp', 32),
  here('sum'), jr('ra'), addu('v0', 'a0', 'a1'),
  here('fill'), beq('a1', 'zero', 'fillDone'), nop,
  here('fillLoop'), sb('a2', 0, 'a0'), addiu('a1', 'a1', -1), bne('a1', 'zero', 'fillLoop'), addiu('a0', 'a0', 1),
  here('fillDone'), jr('ra'), nop,
  here('lookup'), sll('v0', 'a0', 2), hi('v1', 'values'), addu('v0', 'v0', 'v1'), lwLo('v0', 'v0', 'values'), jr('ra'), nop,
  here('twice'), addiu('sp', 'sp', -16), sd('ra', 0, 'sp'), jal('sum'), daddu('a1', 'a0', 'zero'), ld('ra', 0, 'sp'), jr('ra'), addiu('sp', 'sp', 16),
  here('wide'), jr('ra'), daddu('v0', 'a0', 'a1'),
  here('scale'), mulS(0, 12, 13), jr('ra'), nop,
  here('eight'), addu('v0', 'a0', 'a1'), addu('v0', 'v0', 'a2'), addu('v0', 'v0', 'a3'), addu('v0', 'v0', 't0'), addu('v0', 'v0', 't1'),
  addu('v0', 'v0', 't2'), jr('ra'), addu('v0', 'v0', 't3'),
  here('copy16'), lq('t0', 0, 'a1'), sq('t0', 0, 'a0'), jr('ra'), nop,
  here('biggest'), pmaxw('v0', 'a0', 'a1'), jr('ra'), nop,
  here('likely'), addiu('v0', 'zero', 1), beql('a0', 'zero', 'likelyOut'), addiu('v0', 'zero', 7), addiu('v0', 'v0', 2),
  here('likelyOut'), jr('ra'), nop,
  here('pick'), sltiu('v0', 'a0', 3), beq('v0', 'zero', 'pickOther'), sll('v0', 'a0', 2), hi('v1', 'cases'), addu('v0', 'v0', 'v1'),
  lwLo('v0', 'v0', 'cases'), jr('v0'), nop,
  here('case0'), jr('ra'), addiu('v0', 'zero', 10),
  here('case1'), jr('ra'), addiu('v0', 'zero', 20),
  here('case2'), jr('ra'), addiu('v0', 'zero', 30),
  here('pickOther'), jr('ra'), daddu('v0', 'zero', 'zero'),
  here('hardware'), lui('v1', 0x7000), sw('a0', 0x10, 'v1'), lui('v1', 0x1200), sw('a0', 0x70, 'v1'), jr('ra'), nop,
  here('kernel'), addiu('v1', 'zero', 0x3C), syscall, jr('ra'), nop,
  here('forever'), b('forever'), nop,
  here('misaligned'), lw('v0', 1, 'a0'), jr('ra'), nop,
  here('vu0'), lqc2(1, 0, 'a0'), vadd(2, 1, 1), sqc2(2, 0, 'a0'), jr('ra'), nop,
  here('shine'), jr('ra'), addiu('v0', 'zero', 1),
  here('ten'), lw('v0', 0, 'sp'), lw('v1', 8, 'sp'), addu('v0', 'v0', 'v1'), addu('v0', 'v0', 'a0'), addu('v0', 'v0', 'a1'), addu('v0', 'v0', 'a2'),
  addu('v0', 'v0', 'a3'), addu('v0', 'v0', 't0'), addu('v0', 'v0', 't1'), addu('v0', 'v0', 't2'), jr('ra'), addu('v0', 'v0', 't3'),
  here('moded'), hi('v1', 'mode'), lwLo('v1', 'v1', 'mode'), lui('v0', MODE >>> 16), ori('v0', 'v0', MODE & 0xFFFF), bne('v1', 'v0', 'modedOut'),
  daddu('v0', 'a0', 'zero'), addiu('v0', 'a0', 1),
  here('modedOut'), jr('ra'), nop,
  here('play'), addiu('sp', 'sp', -16), sd('ra', 0, 'sp'), lui('t0', MODE >>> 16), ori('t0', 't0', MODE & 0xFFFF), hi('t1', 'mode'), swLo('t0', 't1', 'mode'),
  jal('moded'), addiu('a0', 'zero', 5), jal('main'), nop, ld('ra', 0, 'sp'), jr('ra'), addiu('sp', 'sp', 16),
  here('end'),
];

/** The program's functions, in order, each from its label to the next one's. */
export const FUNCTIONS = ['start', 'main', 'sum', 'fill', 'lookup', 'twice', 'wide', 'scale', 'eight', 'copy16', 'biggest', 'likely', 'pick',
  'hardware', 'kernel', 'forever', 'misaligned', 'vu0', 'shine', 'ten', 'moded', 'play'];

/** The program's words where it loads, every label's address, and each function's { name, address, size }. */
export function madeUpProgram() {
  const labels = {};
  let pc = LOAD;
  for (const item of PROGRAM) {
    if (item.name) labels[item.name] = pc;
    else pc += 4;
  }
  const code = [];
  pc = LOAD;
  for (const item of PROGRAM) {
    if (item.name) continue;
    code.push(typeof item === 'number' ? item : item.at(labels, pc));
    pc += 4;
  }
  // the values after the code, each table on a quadword
  const dataAt = (labels.end + 15) & ~15;
  labels.values = dataAt;
  labels.cases = dataAt + 16;
  labels.functions = dataAt + 32;
  labels.buffer = dataAt + 48;
  labels.mode = dataAt + 64;
  // the halves of each address were worked out before the values had theirs: once more, now that they have
  pc = LOAD;
  code.length = 0;
  for (const item of PROGRAM) {
    if (item.name) continue;
    code.push(typeof item === 'number' ? item : item.at(labels, pc));
    pc += 4;
  }
  const data = [...VALUES, labels.case0, labels.case1, labels.case2, 0, labels.shine, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const functions = FUNCTIONS.map((name, n) => {
    const next = n + 1 < FUNCTIONS.length ? labels[FUNCTIONS[n + 1]] : labels.end;
    return { name, address: labels[name], size: next - labels[name] };
  });
  return { code, data, dataAt, labels, functions };
}

/** The program as the console loads it: an ELF for the EE, with its code, its values and a symbol table. */
export function madeUpElf() {
  const { code, data, dataAt, labels, functions } = madeUpProgram();
  const codeBytes = Buffer.alloc(code.length * 4);
  code.forEach((word, n) => codeBytes.writeUInt32LE(word, n * 4));
  const dataBytes = Buffer.alloc(data.length * 4);
  data.forEach((word, n) => dataBytes.writeUInt32LE(word >>> 0, n * 4));
  // the loaded image: the code, then the values on their quadword
  const image = Buffer.alloc(dataAt - LOAD + dataBytes.length);
  codeBytes.copy(image, 0);
  dataBytes.copy(image, dataAt - LOAD);
  const names = Buffer.from('\0.text\0.data\0.symtab\0.strtab\0.shstrtab\0');
  const symbols = Buffer.alloc(16 * (functions.length + 1));
  functions.forEach((f, n) => {
    const o = 16 * (n + 1);
    symbols.writeUInt32LE(f.address, o + 4);
    symbols.writeUInt32LE(f.size, o + 8);
    symbols[o + 12] = 0x12;   // a function, seen from everywhere
    symbols.writeUInt16LE(1, o + 14);
  });
  const strings = Buffer.from('\0');
  const at = { image: 0x1000 };
  at.symbols = at.image + image.length + 15 & ~15;
  at.strings = at.symbols + symbols.length;
  at.names = at.strings + strings.length;
  at.sections = at.names + names.length + 3 & ~3;
  const sections = [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [1, 1, 6, LOAD, at.image, codeBytes.length, 0, 0, 16, 0],
    [7, 1, 3, dataAt, at.image + dataAt - LOAD, dataBytes.length, 0, 0, 16, 0],
    [13, 2, 0, 0, at.symbols, symbols.length, 4, 1, 4, 16],
    [21, 3, 0, 0, at.strings, strings.length, 0, 0, 1, 0],
    [29, 3, 0, 0, at.names, names.length, 0, 0, 1, 0],
  ];
  const elf = Buffer.alloc(at.sections + 40 * sections.length);
  elf.writeUInt32BE(0x7F454C46, 0);
  elf[4] = 1; elf[5] = 1; elf[6] = 1;
  elf.writeUInt16LE(2, 16);              // a program that runs
  elf.writeUInt16LE(8, 18);              // for a MIPS processor
  elf.writeUInt32LE(1, 20);
  elf.writeUInt32LE(labels.start, 24);
  elf.writeUInt32LE(52, 28);
  elf.writeUInt32LE(at.sections, 32);
  elf.writeUInt32LE(0x20924001, 36);     // the EE's, as Sony's tools mark it
  elf.writeUInt16LE(52, 40);
  elf.writeUInt16LE(32, 42);
  elf.writeUInt16LE(1, 44);
  elf.writeUInt16LE(40, 46);
  elf.writeUInt16LE(sections.length, 48);
  elf.writeUInt16LE(5, 50);
  // one segment, loaded where the program runs
  [1, at.image, LOAD, LOAD, image.length, image.length, 7, 16].forEach((value, n) => elf.writeUInt32LE(value, 52 + n * 4));
  image.copy(elf, at.image);
  symbols.copy(elf, at.symbols);
  strings.copy(elf, at.strings);
  names.copy(elf, at.names);
  sections.forEach((fields, n) => fields.forEach((value, k) => elf.writeUInt32LE(value >>> 0, at.sections + 40 * n + 4 * k)));
  return { elf, labels, functions };
}
