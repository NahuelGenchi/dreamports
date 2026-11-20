// A PlayStation 2 program with nothing from any game in it, written here, for the check of the kit's EE and vector
// units (ps2-ee-vu.mjs). Each frame it does what a game's EE code does to feed the GS:
//
// - the FPU's sums and the MMI's on numbers that change each frame, kept in main memory and sent to vector unit 1's
//   memory, where the check compares them;
// - a DMA chain to VIF1 with every kind of tag, its tags' second halves sent as VIF codes on every other frame (TTE):
//   UNPACK in every format, signed and not, through the mask, adding the row or keeping a running sum, written and
//   skipped and filled as STCYCL says, double-buffered with BASE, OFFSET and TOPS; MPG; and MSCAL twice, a program on
//   vector unit 1 turning corners by a matrix and sending them to the GS with XGKICK (PATH1);
// - MSKPATH3 holding the GIF's own DMA chain (PATH3) back while VIF1 sends packets with DIRECT (PATH2), until it lets
//   it go;
// - a transfer to VIF0 with a program for vector unit 0;
// - a packet copied into the scratchpad, sent to the GIF from there, copied back out and sent again.
//
// Each frame's work is written once, as a list of steps (`frameSteps`), and made both into the program's own MIPS code
// and into its Dreamport's C (made-up-ps2-ee-vu.c), a twin of that code: the same sums with the kit's ee_ and MMI
// functions, and the same register writes through ps2_write32, so the kit's DMA controller, VIFs, vector units and GIF
// do the rest. It runs straight from its ELF file, as the emulator's stand-in for the BIOS starts one.

import { createHash } from 'node:crypto';

/** Where the program is loaded and starts, where its data is, and where its sums' results go, in main memory. */
export const LOAD_AT = 0x00100000, DATA_AT = 0x00200000, RESULTS_AT = 0x00300000;
/** How many frames the check runs. */
export const FRAMES = 120;

// ---- The EE's instructions, as MIPS and the EE's own encode them ----
const T0 = 8, T1 = 9, T2 = 10, T3 = 11, S0 = 16, S1 = 17, A0 = 4, A1 = 5, A2 = 6, V0 = 2, V1 = 3, A3 = 7;
const imm = (op, rs, rt, value) => (op << 26 | rs << 21 | rt << 16 | (value & 0xFFFF)) >>> 0;
const special = (rs, rt, rd, sa, funct) => (rs << 21 | rt << 16 | rd << 11 | sa << 6 | funct) >>> 0;
const lui = (rt, value) => imm(0x0F, 0, rt, value), ori = (rt, rs, value) => imm(0x0D, rs, rt, value);
const addiu = (rt, rs, value) => imm(0x09, rs, rt, value), andi = (rt, rs, value) => imm(0x0C, rs, rt, value);
const lw = (rt, offset, base) => imm(0x23, base, rt, offset), sw = (rt, offset, base) => imm(0x2B, base, rt, offset);
const lq = (rt, offset, base) => imm(0x1E, base, rt, offset), sq = (rt, offset, base) => imm(0x1F, base, rt, offset);
const ld = (rt, offset, base) => imm(0x37, base, rt, offset), sd = (rt, offset, base) => imm(0x3F, base, rt, offset);
const lwc1 = (ft, offset, base) => imm(0x31, base, ft, offset), swc1 = (ft, offset, base) => imm(0x39, base, ft, offset);
const sll = (rd, rt, shift) => special(0, rt, rd, shift, 0x00), srl = (rd, rt, shift) => special(0, rt, rd, shift, 0x02);
const addu = (rd, rs, rt) => special(rs, rt, rd, 0, 0x21), or = (rd, rs, rt) => special(rs, rt, rd, 0, 0x25);
const cfc1 = (rt, fs) => (0x11 << 26 | 2 << 21 | rt << 16 | fs << 11) >>> 0, mtc1 = (rt, fs) => (0x11 << 26 | 4 << 21 | rt << 16 | fs << 11) >>> 0;
const fpu = (funct, fd, fs, ft = 0) => (0x11 << 26 | 16 << 21 | ft << 16 | fs << 11 | fd << 6 | funct) >>> 0;
const fpuWord = (funct, fd, fs) => (0x11 << 26 | 20 << 21 | fs << 11 | fd << 6 | funct) >>> 0;
const mmi = (funct, rd, rs, rt, sa = 0) => (0x1C << 26 | rs << 21 | rt << 16 | rd << 11 | sa << 6 | funct) >>> 0;
const mtsab = (rs, value) => (0x01 << 26 | rs << 21 | 0x18 << 16 | (value & 0xFFFF)) >>> 0;
const and = (rd, rs, rt) => special(rs, rt, rd, 0, 0x24);
const ctc1 = (rt, fs) => (0x11 << 26 | 6 << 21 | rt << 16 | fs << 11) >>> 0;
// vector unit 0 from the EE: a vector loaded and stored, a control register read and written, and one of its instructions
const lqc2 = (ft, offset, base) => imm(0x36, base, ft, offset), sqc2 = (ft, offset, base) => imm(0x3E, base, ft, offset);
const cfc2 = (rt, id) => (0x12 << 26 | 2 << 21 | rt << 16 | id << 11) >>> 0, ctc2 = (rt, id) => (0x12 << 26 | 6 << 21 | rt << 16 | id << 11) >>> 0;
const cop2 = word => (0x12 << 26 | 1 << 25 | (word & 0x01FFFFFF)) >>> 0;
const SYSCALL = 0x0C, NOP = 0;
const li = (rt, value) => [lui(rt, value >>> 16), ori(rt, rt, value & 0xFFFF)];
const here = name => ({ here: name }), beq = (rs, rt, name) => ({ op: 0x04, rs, rt, name }), bne = (rs, rt, name) => ({ op: 0x05, rs, rt, name });
const j = name => ({ jump: name });

function assemble(code, at) {
  const places = {}, words = [];
  for (const item of code) {
    if (item.here) places[item.here] = words.length;
    else words.push(item);
  }
  return words.map((item, i) => {
    if (typeof item === 'number') return item >>> 0;
    if (item.jump) return (2 << 26 | ((at + places[item.jump] * 4) >>> 2 & 0x3FFFFFF)) >>> 0;
    return imm(item.op, item.rs, item.rt, places[item.name] - i - 1);
  });
}

// ---- Vector unit instructions: an upper and a lower one a pair ----
const up = (code, { dest = 15, ft = 0, fs = 0, fd = 0 } = {}) => (dest << 21 | ft << 16 | fs << 11 | fd << 6 | code) >>> 0;
const upExtra = (index, fields) => up(0x3C | (index & 3), { ...fields, fd: index >> 2 });
const low = (table, index, { dest = 0, it = 0, is = 0, fsf = 0, ftf = 0 } = {}) => (0x40 << 25 | (dest | fsf | ftf << 2) << 21 | it << 16 | is << 11 | index << 6 | 0x3C | table) >>> 0;
const vu = {
  NOP: 0x000002FF, E: 0x40000000, I: 0x80000000, LNOP: low(0, 0x0C),
  // upper: with a whole vector, with one field of ft (bc), with Q and with I
  add: f => up(0x28, f), madd: f => up(0x29, f), mul: f => up(0x2A, f), max: f => up(0x2B, f), sub: f => up(0x2C, f), msub: f => up(0x2D, f),
  opmsub: f => up(0x2E, f), mini: f => up(0x2F, f),
  addbc: (bc, f) => up(0x00 | bc, f), subbc: (bc, f) => up(0x04 | bc, f), maddbc: (bc, f) => up(0x08 | bc, f), msubbc: (bc, f) => up(0x0C | bc, f),
  maxbc: (bc, f) => up(0x10 | bc, f), minibc: (bc, f) => up(0x14 | bc, f), mulbc: (bc, f) => up(0x18 | bc, f),
  mulq: f => up(0x1C, f), maxi: f => up(0x1D, f), muli: f => up(0x1E, f), minii: f => up(0x1F, f), addq: f => up(0x20, f), maddq: f => up(0x21, f),
  addi: f => up(0x22, f), maddi: f => up(0x23, f), subq: f => up(0x24, f), msubq: f => up(0x25, f), subi: f => up(0x26, f), msubi: f => up(0x27, f),
  // the same into the accumulator, and the rest of the extra table
  addabc: (bc, f) => upExtra(0x00 | bc, f), subabc: (bc, f) => upExtra(0x04 | bc, f), maddabc: (bc, f) => upExtra(0x08 | bc, f), msubabc: (bc, f) => upExtra(0x0C | bc, f),
  itof: (bits, f) => upExtra(0x10 | [0, 4, 12, 15].indexOf(bits), f), ftoi: (bits, f) => upExtra(0x14 | [0, 4, 12, 15].indexOf(bits), f),
  mulabc: (bc, f) => upExtra(0x18 | bc, f), mulaq: f => upExtra(0x1C, f), abs: f => upExtra(0x1D, f), mulai: f => upExtra(0x1E, f), clip: f => upExtra(0x1F, f),
  addaq: f => upExtra(0x20, f), maddaq: f => upExtra(0x21, f), addai: f => upExtra(0x22, f), maddai: f => upExtra(0x23, f),
  subaq: f => upExtra(0x24, f), msubaq: f => upExtra(0x25, f), subai: f => upExtra(0x26, f), msubai: f => upExtra(0x27, f),
  adda: f => upExtra(0x28, f), madda: f => upExtra(0x29, f), mula: f => upExtra(0x2A, f), suba: f => upExtra(0x2C, f), msuba: f => upExtra(0x2D, f), opmula: f => upExtra(0x2E, f),
  // lower
  lq: (ft, offset, is, dest = 15) => (dest << 21 | ft << 16 | is << 11 | offset & 0x7FF) >>> 0,
  sq: (fs, offset, it, dest = 15) => (1 << 25 | dest << 21 | it << 16 | fs << 11 | offset & 0x7FF) >>> 0,
  ilw: (it, offset, is, dest) => (0x04 << 25 | dest << 21 | it << 16 | is << 11 | offset & 0x7FF) >>> 0,
  isw: (it, offset, is, dest) => (0x05 << 25 | dest << 21 | it << 16 | is << 11 | offset & 0x7FF) >>> 0,
  iaddiu: (it, is, value) => (0x08 << 25 | (value >> 11 & 15) << 21 | it << 16 | is << 11 | value & 0x7FF) >>> 0,
  isubiu: (it, is, value) => (0x09 << 25 | (value >> 11 & 15) << 21 | it << 16 | is << 11 | value & 0x7FF) >>> 0,
  fceq: value => (0x10 << 25 | value & 0xFFFFFF) >>> 0, fcset: value => (0x11 << 25 | value & 0xFFFFFF) >>> 0,
  fcand: value => (0x12 << 25 | value & 0xFFFFFF) >>> 0, fcor: value => (0x13 << 25 | value & 0xFFFFFF) >>> 0,
  fsset: value => (0x15 << 25 | (value >> 11 & 1) << 21 | value & 0x7FF) >>> 0,
  fsand: (it, value) => (0x16 << 25 | (value >> 11 & 1) << 21 | it << 16 | value & 0x7FF) >>> 0,
  fsor: (it, value) => (0x17 << 25 | (value >> 11 & 1) << 21 | it << 16 | value & 0x7FF) >>> 0,
  fmeq: (it, is) => (0x18 << 25 | it << 16 | is << 11) >>> 0, fmand: (it, is) => (0x1A << 25 | it << 16 | is << 11) >>> 0,
  fmor: (it, is) => (0x1B << 25 | it << 16 | is << 11) >>> 0, fcget: it => (0x1C << 25 | it << 16) >>> 0,
  b: pairs => (0x20 << 25 | pairs & 0x7FF) >>> 0, bal: (it, pairs) => (0x21 << 25 | it << 16 | pairs & 0x7FF) >>> 0,
  jr: is => (0x24 << 25 | is << 11) >>> 0, jalr: (it, is) => (0x25 << 25 | it << 16 | is << 11) >>> 0,
  ibeq: (it, is, pairs) => (0x28 << 25 | it << 16 | is << 11 | pairs & 0x7FF) >>> 0, ibne: (it, is, pairs) => (0x29 << 25 | it << 16 | is << 11 | pairs & 0x7FF) >>> 0,
  ibltz: (is, pairs) => (0x2C << 25 | is << 11 | pairs & 0x7FF) >>> 0, ibgtz: (is, pairs) => (0x2D << 25 | is << 11 | pairs & 0x7FF) >>> 0,
  iblez: (is, pairs) => (0x2E << 25 | is << 11 | pairs & 0x7FF) >>> 0, ibgez: (is, pairs) => (0x2F << 25 | is << 11 | pairs & 0x7FF) >>> 0,
  iadd: (id, is, it) => (0x40 << 25 | it << 16 | is << 11 | id << 6 | 0x30) >>> 0, isub: (id, is, it) => (0x40 << 25 | it << 16 | is << 11 | id << 6 | 0x31) >>> 0,
  iaddi: (it, is, value) => (0x40 << 25 | it << 16 | is << 11 | (value & 31) << 6 | 0x32) >>> 0,
  iand: (id, is, it) => (0x40 << 25 | it << 16 | is << 11 | id << 6 | 0x34) >>> 0, ior: (id, is, it) => (0x40 << 25 | it << 16 | is << 11 | id << 6 | 0x35) >>> 0,
  move: (ft, fs, dest = 15) => low(0, 0x0C, { dest, it: ft, is: fs }), mr32: (ft, fs, dest = 15) => low(1, 0x0C, { dest, it: ft, is: fs }),
  lqi: (ft, is, dest = 15) => low(0, 0x0D, { dest, it: ft, is }), sqi: (fs, it, dest = 15) => low(1, 0x0D, { dest, it, is: fs }),
  lqd: (ft, is, dest = 15) => low(2, 0x0D, { dest, it: ft, is }), sqd: (fs, it, dest = 15) => low(3, 0x0D, { dest, it, is: fs }),
  div: (fs, fsf, ft, ftf) => low(0, 0x0E, { it: ft, is: fs, fsf, ftf }), sqrt: (ft, ftf) => low(1, 0x0E, { it: ft, ftf }),
  rsqrt: (fs, fsf, ft, ftf) => low(2, 0x0E, { it: ft, is: fs, fsf, ftf }), waitq: low(3, 0x0E),
  mtir: (it, fs, fsf) => low(0, 0x0F, { it, is: fs, fsf }), mfir: (ft, is, dest = 15) => low(1, 0x0F, { dest, it: ft, is }),
  ilwr: (it, is, dest) => low(2, 0x0F, { dest, it, is }), iswr: (it, is, dest) => low(3, 0x0F, { dest, it, is }),
  rnext: (ft, dest = 15) => low(0, 0x10, { dest, it: ft }), rget: (ft, dest = 15) => low(1, 0x10, { dest, it: ft }),
  rinit: (fs, fsf) => low(2, 0x10, { is: fs, fsf }), rxor: (fs, fsf) => low(3, 0x10, { is: fs, fsf }),
  mfp: (ft, dest) => low(0, 0x19, { dest, it: ft }), xtop: it => low(0, 0x1A, { it }), xitop: it => low(1, 0x1A, { it }), xgkick: is => low(0, 0x1B, { is }),
  esadd: fs => low(0, 0x1C, { is: fs }), ersadd: fs => low(1, 0x1C, { is: fs }), eleng: fs => low(2, 0x1C, { is: fs }), erleng: fs => low(3, 0x1C, { is: fs }),
  eatanxy: fs => low(0, 0x1D, { is: fs }), eatanxz: fs => low(1, 0x1D, { is: fs }), esum: fs => low(2, 0x1D, { is: fs }),
  esqrt: (fs, fsf) => low(0, 0x1E, { is: fs, fsf }), ersqrt: (fs, fsf) => low(1, 0x1E, { is: fs, fsf }), ercpr: (fs, fsf) => low(2, 0x1E, { is: fs, fsf }), waitp: low(3, 0x1E),
  esin: (fs, fsf) => low(0, 0x1F, { is: fs, fsf }), eexp: (fs, fsf) => low(2, 0x1F, { is: fs, fsf }),
};
const microcode = pairs => pairs.flatMap(([lower, upper]) => [lower >>> 0, upper >>> 0]);

// ---- VIF codes, GIF tags and DMA tags ----
const vif = {
  NOP: 0, stcycl: (cl, wl) => (0x01 << 24 | wl << 8 | cl) >>> 0, offset: value => (0x02 << 24 | value) >>> 0, base: value => (0x03 << 24 | value) >>> 0,
  itop: value => (0x04 << 24 | value) >>> 0, stmod: mode => (0x05 << 24 | mode) >>> 0, mskpath3: on => (0x06 << 24 | (on ? 0x8000 : 0)) >>> 0,
  mark: value => (0x07 << 24 | value) >>> 0, FLUSHE: 0x10 << 24, FLUSH: 0x11 << 24, FLUSHA: 0x13 << 24, mscal: at => (0x14 << 24 | at) >>> 0, mscalf: at => (0x15 << 24 | at) >>> 0, MSCNT: 0x17 << 24,
  STMASK: 0x20 << 24, STROW: 0x30 << 24, STCOL: 0x31 << 24, mpg: (at, pairs) => (0x4A << 24 | (pairs & 0xFF) << 16 | at) >>> 0,
  direct: qwords => (0x50 << 24 | qwords) >>> 0,
  unpack: ({ format, count, at, masked = false, unsigned = false, tops = false }) => ((0x60 | (masked ? 0x10 : 0) | format) << 24 | (count & 0xFF) << 16 | (tops ? 0x8000 : 0) | (unsigned ? 0x4000 : 0) | at) >>> 0,
};
// how many words an UNPACK's data takes: as many values as it writes, or with CL below WL, CL of each WL it writes
const unpackReads = (count, [cl, wl] = [4, 4]) => cl >= wl ? count : Math.floor(count / wl) * cl + Math.min(count % wl, cl);
const unpackWords = (format, values) => format === 0xF ? Math.ceil(values / 2) : Math.ceil(values * ((format >> 2) + 1) * [4, 2, 1][format & 3] / 4);
const gifTag = ({ loops, ends = true, prim = null, kind = 0, regs = [] }) => {
  const list = regs.reduce((sum, reg, i) => sum + BigInt(reg) * (1n << BigInt(i * 4)), 0n);
  return [loops | (ends ? 0x8000 : 0), ((prim !== null ? 1 << 14 | prim << 15 : 0) | kind << 26 | (regs.length & 15) << 28) >>> 0, Number(list & 0xFFFFFFFFn) >>> 0, Number(list >> 32n) >>> 0];
};
const aPlusD = (reg, low, high = 0) => [low >>> 0, high >>> 0, reg, 0];
const XY = (x, y) => (x << 4 | y << 20) >>> 0;
const TAG = { REFE: 0, CNT: 1, NEXT: 2, REF: 3, REFS: 4, CALL: 5, RET: 6, END: 7 };
const dmaTag = (id, qwc, address = 0, high = [0, 0]) => [(qwc | id << 28) >>> 0, address >>> 0, high[0] >>> 0, high[1] >>> 0];
const bitsOf = float => new Uint32Array(new Float32Array([float]).buffer)[0];
const padded = (words, before = 0) => { const out = [...words]; while ((out.length + before) % 4) out.push(vif.NOP); return out; };
const pattern = (n, seed) => Array.from({ length: n }, (_, i) => (Math.imul(i + seed, 0x9E3779B1) ^ (i * 0x01010101)) >>> 0);

// ---- Vector unit 1's memory, by quadword ----
// the EE's results from 0, the unpacks from 0x100, twelve quadwords each, what the second program keeps from 0x280, what
// the first keeps, the two buffers TOPS turns between, the packet, the split unpacks, and what both programs are given
const RESULTS_QUADS = 0x000, UNPACKS_QUADS = 0x100, UNPACK_ROOM = 12, EXERCISE_OUT = 0x280, KEPT_AT = 0x380, BASE = 0x390, OFFSET = 8, PACKET_AT = 0x3A0, SPLIT_AT = 0x3B0,
  MATRIX_AT = 0x3E0, COLOUR_AT = 0x3E4, EDGE_AT = 0x3E5, GIVEN_AT = 0x3F0;
/** Where vector unit 1's second program starts, in instruction pairs. */
const EXERCISE_AT = 0x100;

// vector unit 1's program: the corners VIF1 put at TOPS, as many as ITOP says, each turned by the matrix, over its
// depth, into sixteenths of a pixel and put in a packet of sprites it sends with XGKICK; on the way, integer sums, the
// clip flags, two of the EFU's sums and the flags, each kept in its memory for the check to see, and a CLIP on the
// edge, x the size of w and y its negative
function vu1Program() {
  const n = vu.NOP, L = vu.LNOP;
  const pairs = [
    [vu.xtop(1), n], [vu.xitop(2), n], [vu.iaddiu(3, 0, PACKET_AT + 1), n], [vu.iaddiu(4, 0, KEPT_AT), n],
    [vu.lq(10, MATRIX_AT, 0), n], [vu.lq(11, MATRIX_AT + 1, 0), n], [vu.lq(12, MATRIX_AT + 2, 0), n], [vu.lq(13, MATRIX_AT + 3, 0), n],
    [vu.iaddiu(5, 0, 0x1234), n], [vu.isubiu(6, 5, 0x0FF0), n], [vu.iand(7, 5, 6), n], [vu.ior(8, 5, 6), n],
    [vu.iadd(9, 7, 8), n], [vu.isub(9, 9, 2), n], [vu.iaddi(9, 9, -5), n], [vu.isw(9, 0, 4, 8), n], [vu.isw(5, 0, 4, 4), n],
    [vu.ilw(10, 0, 4, 8), n], [vu.isw(10, 0, 4, 2), n], [vu.iswr(1, 4, 1), n],
  ];
  const loop = pairs.length;
  pairs.push(
    [vu.lqi(1, 1), n],
    [L, vu.mulabc(0, { ft: 1, fs: 10 })], [L, vu.maddabc(1, { ft: 1, fs: 11 })], [L, vu.maddabc(2, { ft: 1, fs: 12 })], [L, vu.maddbc(3, { ft: 1, fs: 13, fd: 2 })],
    [vu.div(0, 3, 2, 3), n], [vu.waitq, n], [L, vu.mulq({ dest: 14, fs: 2, fd: 3 })], [L, vu.ftoi(4, { dest: 14, fs: 3, ft: 4 })],
    [vu.lq(5, COLOUR_AT, 0), n], [vu.sqi(5, 3), n], [vu.sqi(4, 3), vu.clip({ dest: 14, fs: 2, ft: 2 })],
    [vu.iaddi(2, 2, -1), n], [L, n],
  );
  const branchAt = pairs.length;
  pairs.push([vu.ibne(2, 0, loop - branchAt - 1), n], [L, n]);
  pairs.push(
    [vu.fcget(11), n], [vu.isw(11, 1, 4, 8), n],
    [vu.esqrt(2, 0), n], [vu.waitp, n], [vu.mfp(14, 8), n], [vu.ercpr(2, 3), n], [vu.waitp, n], [vu.mfp(14, 4), n], [vu.sq(14, 2, 4), n],
    [vu.iaddiu(13, 0, 0xFFFF), n], [vu.fmand(12, 13), n], [vu.fsand(14, 0xFFF), n], [vu.isw(12, 3, 4, 8), n], [vu.isw(14, 3, 4, 4), n],
    [vu.lq(6, EDGE_AT, 0), n], [L, vu.clip({ dest: 14, fs: 6, ft: 6 })], [L, n], [L, n], [L, n], [vu.fcget(11), n], [vu.isw(11, 4, 4, 8), n],
    [vu.ilw(15, 0, 4, 9), n], [vu.isw(15, 4, 4, 4), n],
    [vu.iaddiu(12, 0, PACKET_AT), n], [vu.xgkick(12), n], [L, n], [L, (n | vu.E) >>> 0], [L, n],
  );
  return microcode(pairs);
}

// Vector unit 1's second program, which VIF1 starts with MSCALF and, after it stops halfway, goes on with MSCNT. It
// does every upper instruction on vectors of the EE's results, of unpacked patterns and of the floats the console
// treats its own way (the largest, the smallest, minus zero, one with its exponent all ones), and after each keeps its
// result and the MAC, status and clip flags it left. Then the division unit with Q read before and after it lands, the
// EFU, the instructions on whole numbers and on R, every branch taken and not, a branch right after a sum on its
// register, and the flags read one to four cycles after what sets them.
function vu1Exercise() {
  const n = vu.NOP, L = vu.LNOP, pairs = [], OUT = 14, ALL = 15, R = 20;
  const keep = () => pairs.push([vu.sqi(R, OUT), n]);
  // the three flags into one quadword's fields
  const flags = () => pairs.push([vu.fmand(10, ALL), n], [vu.fsand(11, 0xFFF), n], [vu.fcget(12), n],
    [vu.isw(10, 0, OUT, 8), n], [vu.isw(11, 0, OUT, 4), n], [vu.isw(12, 0, OUT, 2), n], [vu.iaddiu(OUT, OUT, 1), n]);
  const upper = (...words) => { for (const word of words) pairs.push([L, word]); keep(); flags(); };
  // the accumulator, seen as itself plus nothing
  const acc = (...words) => upper(...words, vu.maddbc(0, { fs: 0, ft: 0, fd: R }));
  const four = (...registers) => { registers.forEach((reg, i) => pairs.push([vu.isw(reg, 0, OUT, 8 >> i), n])); pairs.push([vu.iaddiu(OUT, OUT, 1), n]); };
  const settle = () => pairs.push([L, n], [L, n], [L, n], [L, n]);

  pairs.push([vu.iaddiu(OUT, 0, EXERCISE_OUT), n], [vu.isubiu(ALL, 0, 1), n],
    [vu.lq(1, 0x000, 0), n], [vu.lq(2, 0x001, 0), n], [vu.lq(3, 0x002, 0), n], [vu.lq(4, UNPACKS_QUADS, 0), n], [vu.lq(5, GIVEN_AT, 0), n], [vu.lq(6, GIVEN_AT + 1, 0), n], [vu.lq(7, 0x010, 0), n], [vu.lq(8, GIVEN_AT + 2, 0), n]);
  for (const [fs, ft] of [[1, 2], [5, 6], [4, 7]]) {
    upper(vu.add({ fs, ft, fd: R })); upper(vu.sub({ fs, ft, fd: R })); upper(vu.mul({ fs, ft, fd: R })); upper(vu.max({ fs, ft, fd: R })); upper(vu.mini({ fs, ft, fd: R }));
  }
  upper(vu.mul({ fs: 5, ft: 5, fd: R })); upper(vu.add({ fs: 5, ft: 5, fd: R })); upper(vu.sub({ dest: 9, fs: 5, ft: 1, fd: R }));
  upper(vu.add({ fs: 8, ft: 6, fd: R })); upper(vu.sub({ fs: 6, ft: 8, fd: R })); upper(vu.mul({ fs: 8, ft: 6, fd: R })); upper(vu.addbc(0, { fs: 8, ft: 0, fd: R })); upper(vu.add({ fs: 8, ft: 8, fd: R })); upper(vu.addbc(1, { fs: 8, ft: 5, fd: R }));
  [0, 1, 2, 3].forEach(bc => upper(vu.addbc(bc, { fs: 1, ft: 2, fd: R })));
  upper(vu.subbc(1, { fs: 2, ft: 3, fd: R })); upper(vu.mulbc(2, { fs: 1, ft: 6, fd: R })); upper(vu.maxbc(3, { fs: 1, ft: 2, fd: R })); upper(vu.minibc(0, { fs: 2, ft: 6, fd: R }));
  upper(vu.addbc(0, { fs: 4, ft: 0, fd: R }));
  // the accumulator's
  acc(vu.adda({ fs: 1, ft: 2 })); acc(vu.suba({ fs: 2, ft: 3 })); acc(vu.mula({ fs: 1, ft: 6 }));
  acc(vu.mula({ fs: 1, ft: 2 }), vu.madda({ fs: 2, ft: 3 })); acc(vu.mula({ fs: 3, ft: 6 }), vu.msuba({ fs: 1, ft: 2 }));
  acc(vu.addabc(1, { fs: 1, ft: 2 })); acc(vu.subabc(2, { fs: 1, ft: 6 })); acc(vu.mulabc(3, { fs: 2, ft: 6 }));
  acc(vu.mulabc(0, { fs: 1, ft: 6 }), vu.maddabc(1, { fs: 2, ft: 6 }), vu.msubabc(2, { fs: 3, ft: 6 }));
  upper(vu.mula({ fs: 1, ft: 2 }), vu.madd({ fs: 2, ft: 3, fd: R })); upper(vu.mula({ fs: 1, ft: 2 }), vu.msub({ fs: 3, ft: 6, fd: R }));
  upper(vu.mula({ fs: 5, ft: 6 }), vu.maddbc(0, { fs: 1, ft: 6, fd: R })); upper(vu.mula({ fs: 2, ft: 6 }), vu.msubbc(3, { fs: 1, ft: 6, fd: R }));
  upper(vu.opmula({ dest: 14, fs: 1, ft: 2 }), vu.opmsub({ dest: 14, fs: 2, ft: 1, fd: R }));
  // with Q, from a division
  pairs.push([vu.div(1, 0, 6, 0), n], [vu.waitq, n]);
  upper(vu.mulq({ fs: 1, fd: R })); upper(vu.addq({ fs: 2, fd: R })); upper(vu.subq({ fs: 3, fd: R }));
  upper(vu.mula({ fs: 1, ft: 2 }), vu.maddq({ fs: 2, fd: R })); upper(vu.mula({ fs: 1, ft: 6 }), vu.msubq({ fs: 3, fd: R }));
  acc(vu.mulaq({ fs: 1 })); acc(vu.addaq({ fs: 2 })); acc(vu.subaq({ fs: 3 })); acc(vu.mulaq({ fs: 1 }), vu.maddaq({ fs: 2 }), vu.msubaq({ fs: 3 }));
  // with I, loaded by a pair whose lower half is the float
  const withI = (float, ...words) => { pairs.push([bitsOf(float), (n | vu.I) >>> 0]); upper(...words); };
  withI(1.75, vu.muli({ fs: 1, fd: R })); withI(-300.5, vu.addi({ fs: 2, fd: R })); withI(1e-3, vu.subi({ fs: 3, fd: R }));
  withI(2.5, vu.mula({ fs: 1, ft: 2 }), vu.maddi({ fs: 2, fd: R })); withI(-0.5, vu.mula({ fs: 1, ft: 6 }), vu.msubi({ fs: 3, fd: R }));
  withI(10, vu.maxi({ fs: 1, fd: R })); withI(10, vu.minii({ fs: 1, fd: R }));
  pairs.push([bitsOf(3.25), (n | vu.I) >>> 0]);
  acc(vu.mulai({ fs: 1 })); acc(vu.addai({ fs: 2 })); acc(vu.subai({ fs: 3 })); acc(vu.mulai({ fs: 1 }), vu.maddai({ fs: 2 }), vu.msubai({ fs: 3 }));
  // whole numbers and floats, and the rest
  [0, 4, 12, 15].forEach(bits => upper(vu.itof(bits, { fs: 4, ft: R })));
  [0, 4, 12, 15].forEach(bits => upper(vu.ftoi(bits, { fs: 1, ft: R })));
  upper(vu.ftoi(4, { fs: 5, ft: R })); upper(vu.ftoi(0, { fs: 4, ft: R })); upper(vu.ftoi(15, { fs: 7, ft: R }));
  upper(vu.abs({ fs: 6, ft: R })); upper(vu.abs({ dest: 5, fs: 4, ft: R }));
  upper(vu.clip({ dest: 14, fs: 1, ft: 2 })); upper(vu.clip({ dest: 14, fs: 5, ft: 6 })); upper(vu.clip({ dest: 14, fs: 4, ft: 4 }));

  // both halves of a pair writing one register, and the lower reading what the upper writes
  pairs.push([vu.lq(21, 0x003, 0), vu.add({ fs: 1, ft: 2, fd: 21 })], [vu.move(R, 21), n]); keep();
  pairs.push([vu.move(R, 22), vu.sub({ fs: 2, ft: 3, fd: 22 })]); keep(); pairs.push([vu.move(R, 22), n]); keep();

  // the program stops here, and MSCNT goes on from the pair after the next
  pairs.push([L, (n | vu.E) >>> 0], [L, n]);

  // the division unit: Q read before it lands and after, and the status flag's D and I as they land
  const q = () => upper(vu.addq({ dest: 8, fs: 0, fd: R }));
  const wait = count => { for (let i = 0; i < count; i++) pairs.push([L, n]); };
  pairs.push([vu.div(6, 0, 6, 2), n], [vu.waitq, n], [vu.div(6, 2, 6, 0), n]); wait(5);
  pairs.push([L, vu.addq({ dest: 8, fs: 0, fd: R })], [L, vu.addq({ dest: 8, fs: 0, fd: 21 })], [vu.sqi(R, OUT), n], [vu.sqi(21, OUT), n]);
  pairs.push([vu.rsqrt(6, 0, 6, 2), n]); wait(11);
  pairs.push([L, vu.addq({ dest: 8, fs: 0, fd: R })], [L, vu.addq({ dest: 8, fs: 0, fd: 21 })], [vu.sqi(R, OUT), n], [vu.sqi(21, OUT), n]);
  pairs.push([vu.div(6, 0, 5, 2), n], [vu.fsand(10, 0xFFF), n]); wait(4); pairs.push([vu.fsand(11, 0xFFF), n], [vu.fsand(12, 0xFFF), n]); four(10, 11, 12);
  pairs.push([vu.div(6, 0, 6, 2), n], [vu.fsand(10, 0xFFF), n]); wait(4); pairs.push([vu.fsand(11, 0xFFF), n], [vu.fsand(12, 0xFFF), n]); four(10, 11, 12);
  pairs.push([vu.esadd(1), n]); wait(9); pairs.push([vu.mfp(R, 15), n], [vu.mfp(21, 15), n], [vu.sqi(R, OUT), n], [vu.sqi(21, OUT), n]);
  // how long WAITP waits, by the flags of a sum made just before it, read just after
  pairs.push([L, vu.add({ fs: 6, ft: 6, fd: 22 })]); wait(5);
  pairs.push([vu.esqrt(1, 0), n]); wait(8); pairs.push([L, vu.sub({ fs: 2, ft: 2, fd: 21 })], [vu.waitp, n], [vu.fmand(10, ALL), n], [vu.fmand(11, ALL), n]); four(10, 11);
  pairs.push([vu.div(1, 0, 2, 1), n]); q(); pairs.push([vu.waitq, n]); q();
  pairs.push([vu.div(6, 0, 5, 2), n], [vu.fsand(10, 0xFFF), n], [vu.waitq, n], [vu.fsand(11, 0xFFF), n]); q(); four(10, 11);
  pairs.push([vu.div(5, 2, 5, 2), n], [vu.waitq, n]); q();
  pairs.push([vu.div(5, 0, 5, 1), n], [vu.waitq, n]); q();
  pairs.push([vu.sqrt(6, 1), n], [vu.waitq, n]); q();
  pairs.push([vu.sqrt(1, 0), n], [vu.waitq, n]); q();
  pairs.push([vu.rsqrt(6, 0, 1, 1), n], [vu.fsand(10, 0xFFF), n], [vu.waitq, n]); q();
  pairs.push([vu.rsqrt(6, 1, 5, 2), n], [vu.waitq, n]); q();
  pairs.push([vu.rsqrt(1, 0, 6, 1), n], [vu.waitq, n]); q();
  // the EFU, P read before it lands and after
  const p = () => { pairs.push([vu.mfp(R, 15), n]); keep(); };
  pairs.push([vu.esadd(1), n]); p(); pairs.push([vu.waitp, n]); p();
  for (const sum of [vu.ersadd(2), vu.eleng(1), vu.erleng(6), vu.esum(1), vu.esqrt(1, 0), vu.ersqrt(6, 0), vu.ercpr(6, 2), vu.esin(6, 2), vu.eexp(6, 2), vu.eatanxy(1), vu.eatanxz(2), vu.esqrt(6, 1), vu.ercpr(5, 2)]) {
    pairs.push([sum, n], [vu.waitp, n]);
    p();
  }
  // whole numbers, R and the vector moves
  pairs.push([vu.mtir(5, 4, 0), n], [vu.mtir(6, 1, 2), n], [vu.mfir(R, 5, 15), n]); keep();
  pairs.push([vu.rinit(1, 0), n], [vu.rnext(R, 15), n]); keep();
  pairs.push([vu.rxor(2, 1), n], [vu.rget(R, 12), n], [vu.rnext(R, 3), n]); keep();
  pairs.push([vu.mr32(R, 1, 15), n]); keep();
  pairs.push([vu.move(R, 2, 10), n]); keep();
  // loads and stores that step their register, and a whole number loaded and stored through one
  pairs.push([vu.iaddiu(5, 0, 0x004), n], [vu.lqd(R, 5, 15), n]); keep();
  pairs.push([vu.lqi(R, 5, 14), n], [vu.lqi(21, 5, 15), n]); keep();
  pairs.push([vu.iadd(6, OUT, 0), n], [vu.iaddiu(OUT, OUT, 2), n], [vu.sqi(1, 6, 15), n], [vu.sqd(2, OUT, 15), n], [vu.iaddiu(OUT, OUT, 1), n]);
  pairs.push([vu.ilwr(7, 5, 4), n], [vu.iswr(7, OUT, 15), n], [vu.iaddiu(OUT, OUT, 1), n]);
  four(5, 6, 7);

  // every branch, taken and not: 9 gets a 1 from each delay slot, a 16 from what a taken branch skips and a 256 from
  // where it lands
  const branch = make => pairs.push([make(2), n], [vu.iaddiu(9, 9, 1), n], [vu.iaddiu(9, 9, 16), n], [vu.iaddiu(9, 9, 256), n]);
  pairs.push([vu.iaddiu(9, 0, 0), n], [vu.iaddiu(1, 0, 5), n], [vu.isubiu(2, 0, 5), n], [vu.iaddiu(3, 0, 5), n]);
  settle();
  for (const make of [k => vu.ibeq(1, 3, k), k => vu.ibeq(1, 2, k), k => vu.ibne(1, 2, k), k => vu.ibne(1, 3, k), k => vu.ibltz(2, k), k => vu.ibltz(1, k),
    k => vu.ibgtz(1, k), k => vu.ibgtz(0, k), k => vu.iblez(0, k), k => vu.iblez(1, k), k => vu.ibgez(0, k), k => vu.ibgez(2, k), k => vu.b(k)]) branch(make);
  // a call and its way back, and a jump through a register
  pairs.push([vu.bal(4, 2), n], [vu.iaddiu(9, 9, 1), n], [vu.iaddiu(9, 9, 16), n], [vu.iaddiu(9, 9, 256), n]);
  pairs.push([vu.iaddiu(5, 0, EXERCISE_AT + pairs.length + 8), n]); settle();
  pairs.push([vu.jalr(6, 5), n], [vu.iaddiu(9, 9, 1), n], [vu.iaddiu(9, 9, 16), n], [vu.iaddiu(9, 9, 256), n]);
  pairs.push([vu.iaddiu(5, 0, EXERCISE_AT + pairs.length + 8), n]); settle();
  pairs.push([vu.jr(5), n], [vu.iaddiu(9, 9, 1), n], [vu.iaddiu(9, 9, 16), n], [vu.iaddiu(9, 9, 256), n]);
  four(9, 4, 6);
  // a branch right after a sum on its register tests it as it was: 0, so this one is taken
  pairs.push([vu.iaddiu(9, 0, 0), n], [vu.iaddiu(5, 0, 0), n]); settle();
  pairs.push([vu.iaddiu(5, 0, 1), n], [vu.ibeq(5, 0, 2), n], [vu.iaddiu(9, 9, 1), n], [vu.iaddiu(9, 9, 16), n], [vu.iaddiu(9, 9, 256), n]);
  // after two sums on it, as it was before the first
  pairs.push([vu.iaddiu(5, 0, 0), n]); settle();
  pairs.push([vu.iaddiu(5, 5, 1), n], [vu.iaddiu(5, 5, 1), n], [vu.ibeq(5, 0, 2), n], [vu.iaddiu(9, 9, 1), n], [vu.iaddiu(9, 9, 16), n], [vu.iaddiu(9, 9, 256), n]);
  // after a flag's instruction, as it is
  settle();
  pairs.push([vu.fcget(5), n], [vu.ibeq(5, 0, 2), n], [vu.iaddiu(9, 9, 1), n], [vu.iaddiu(9, 9, 16), n], [vu.iaddiu(9, 9, 256), n]);
  // and when the branch's pair waits for a float, as it is
  pairs.push([vu.iaddiu(5, 0, 0), n]); settle();
  pairs.push([L, vu.add({ fs: 1, ft: 2, fd: 21 })], [vu.iaddiu(5, 0, 1), n], [vu.ibeq(5, 0, 2), vu.add({ fs: 21, ft: 1, fd: 22 })], [vu.iaddiu(9, 9, 1), n], [vu.iaddiu(9, 9, 16), n], [vu.iaddiu(9, 9, 256), n]);
  four(9, 5);

  // flags one to four cycles after what sets them: a sum's MAC flags, FSSET's sticky flags and FCSET's clip flags
  settle();
  pairs.push([L, vu.sub({ fs: 1, ft: 1, fd: 21 })], [vu.fmand(10, ALL), n], [vu.fmand(11, ALL), n], [vu.fmand(12, ALL), n], [vu.fmand(13, ALL), n]); four(10, 11, 12, 13);
  pairs.push([vu.fsset(0xFC0), n], [vu.fsand(10, 0xFFF), n], [vu.fsand(11, 0xFFF), n], [vu.fsand(12, 0xFFF), n], [vu.fsand(13, 0xFFF), n]); four(10, 11, 12, 13);
  pairs.push([vu.fsset(0), n], [vu.fsand(10, 0xFFF), n], [vu.fsand(11, 0xFFF), n], [vu.fsand(12, 0xFFF), n], [vu.fsand(13, 0xFFF), n]); four(10, 11, 12, 13);
  pairs.push([vu.fcset(0xABC123), n], [vu.fcget(10), n], [vu.fcget(11), n], [vu.fcget(12), n], [vu.fcget(13), n]); four(10, 11, 12, 13);
  // the clip flags' three tests, and the status and MAC flags' others
  pairs.push([vu.fceq(0xABC123), n], [vu.iadd(10, 1, 0), n], [vu.fcand(0x000100), n], [vu.iadd(11, 1, 0), n], [vu.fcor(0x543EDC), n], [vu.iadd(12, 1, 0), n], [vu.fcor(0x543EDD), n], [vu.iadd(13, 1, 0), n]);
  four(10, 11, 12, 13);
  pairs.push([vu.fsor(10, 0x00F), n], [vu.fmeq(11, 0), n], [vu.fmor(12, 0), n], [vu.iaddiu(13, 0, 0x7FF), n]); four(10, 11, 12, 13);
  pairs.push([L, (n | vu.E) >>> 0], [L, n]);
  return { code: microcode(pairs), pairs: pairs.length };
}

// vector unit 0's program: float sums, MAX and MINI, ITOF, MR32, MFIR and R's on the numbers VIF0 put at 0, and XITOP
function vu0Program() {
  const n = vu.NOP, L = vu.LNOP;
  return microcode([
    [vu.lq(1, 0, 0), n], [vu.lq(2, 1, 0), n], [vu.lq(3, 2, 0), n],
    [L, vu.add({ fs: 1, ft: 2, fd: 4 })], [L, vu.mul({ fs: 1, ft: 2, fd: 5 })], [L, vu.sub({ dest: 12, fs: 2, ft: 1, fd: 6 })],
    [L, vu.maxbc(1, { fs: 1, ft: 2, fd: 7 })], [L, vu.minibc(2, { fs: 2, ft: 1, fd: 8 })], [L, vu.itof(4, { fs: 3, ft: 9 })],
    [vu.mr32(10, 1), n], [vu.mfir(11, 0), n], [vu.rinit(1, 0), n], [vu.rnext(12), n], [vu.rxor(2, 1), n], [vu.rget(13), n],
    [vu.sq(4, 3, 0), n], [vu.sq(5, 4, 0), n], [vu.sq(6, 5, 0), n], [vu.sq(7, 6, 0), n], [vu.sq(8, 7, 0), n], [vu.sq(9, 8, 0), n],
    [vu.sq(10, 9, 0), n], [vu.sq(11, 10, 0), n], [vu.sq(12, 11, 0), n], [vu.sq(13, 12, 0), n],
    [vu.xitop(1), n], [vu.iaddiu(2, 0, 13), n], [vu.iswr(1, 2, 8), n],
    [L, (n | vu.E) >>> 0], [L, n],
  ]);
}

// the unpacks into vector unit 1's memory from quadword 0x100, 16 quadwords each: every format, signed and not, masked
// and not, adding the row or keeping a running sum, and written as STCYCL says
const UNPACKS = [
  { format: 0x0, count: 3 }, { format: 0x1, count: 5 }, { format: 0x1, count: 5, unsigned: true }, { format: 0x2, count: 7 }, { format: 0x2, count: 7, unsigned: true },
  { format: 0x4, count: 3 }, { format: 0x5, count: 4 }, { format: 0x5, count: 4, unsigned: true }, { format: 0x6, count: 6 }, { format: 0x6, count: 6, unsigned: true },
  { format: 0x8, count: 3 }, { format: 0x9, count: 4 }, { format: 0x9, count: 4, unsigned: true }, { format: 0xA, count: 5 }, { format: 0xA, count: 5, unsigned: true },
  { format: 0xC, count: 2 }, { format: 0xD, count: 3 }, { format: 0xD, count: 3, unsigned: true }, { format: 0xE, count: 4 }, { format: 0xE, count: 4, unsigned: true },
  { format: 0xF, count: 6 },
  { format: 0xC, count: 4, masked: true }, { format: 0x9, count: 5, masked: true }, { format: 0x0, count: 4, masked: true },
  { format: 0xC, count: 3, mode: 1 }, { format: 0x5, count: 3, mode: 1, masked: true }, { format: 0xC, count: 4, mode: 2 }, { format: 0x2, count: 5, mode: 2 },
  { format: 0xC, count: 6, cycle: [4, 2] }, { format: 0x9, count: 4, cycle: [3, 1] }, { format: 0xC, count: 6, cycle: [1, 3] }, { format: 0x1, count: 7, cycle: [2, 4], masked: true },
];

// ---- The math: the FPU's and the MMI's instructions, each how the EE's code does it and how the Dreamport's C does ----
const FPU_OPS = [
  // [MIPS into $f2 from $f0 (a) and $f1 (b), C on a and b, kind of result]
  [[fpu(0x00, 2, 0, 1)], 'ee_add(a, b)'], [[fpu(0x01, 2, 0, 1)], 'ee_sub(a, b)'], [[fpu(0x02, 2, 0, 1)], 'ee_mul(a, b)'],
  [[fpu(0x03, 2, 0, 1)], 'ee_div(a, b)'], [[fpu(0x04, 2, 0, 0)], 'ee_sqrt(a)'], [[fpu(0x05, 2, 0)], 'ee_abs(a)'], [[fpu(0x07, 2, 0)], 'ee_neg(a)'],
  [[fpu(0x28, 2, 0, 1)], 'ee_max(a, b)'], [[fpu(0x29, 2, 0, 1)], 'ee_min(a, b)'],
  [[fpu(0x18, 0, 0, 1), fpu(0x1C, 2, 1, 0)], '(ee_adda(a, b), ee_madd(b, a))'], [[fpu(0x1A, 0, 1, 0), fpu(0x1D, 2, 0, 1)], '(ee_mula(b, a), ee_msub(a, b))'],
  [[fpu(0x24, 2, 0)], 'ee_to_int(a)', 'int'],
];
const COMPARES = [[0x34, 'ee_c_lt(a, b)'], [0x36, 'ee_c_le(a, b)'], [0x32, 'ee_c_eq(a, a)']];
// MMI: [name, class funct, sub-op (sa), form]; the forms: 'rd' rd = op(rs, rt), 'rt' rd = op(rt), 'hilo' it also writes
// HI and LO, 'div' only HI and LO
const MMI_OPS = [
  ...['paddw', 'psubw', 'pcgtw', 'pmaxw', 'paddh', 'psubh', 'pcgth', 'pmaxh', 'paddb', 'psubb', 'pcgtb'].map((name, i) => [name, 0x08, i, 'rd']),
  ...[['paddsw', 0x10], ['psubsw', 0x11], ['pextlw', 0x12], ['ppacw', 0x13], ['paddsh', 0x14], ['psubsh', 0x15], ['pextlh', 0x16], ['ppach', 0x17],
    ['paddsb', 0x18], ['psubsb', 0x19], ['pextlb', 0x1A], ['ppacb', 0x1B]].map(([name, sa]) => [name, 0x08, sa, 'rd']),
  ['pext5', 0x08, 0x1E, 'rt'], ['ppac5', 0x08, 0x1F, 'rt'],
  ['pabsw', 0x28, 0x01, 'rt'], ['pceqw', 0x28, 0x02, 'rd'], ['pminw', 0x28, 0x03, 'rd'], ['padsbh', 0x28, 0x04, 'rd'], ['pabsh', 0x28, 0x05, 'rt'],
  ['pceqh', 0x28, 0x06, 'rd'], ['pminh', 0x28, 0x07, 'rd'], ['pceqb', 0x28, 0x0A, 'rd'], ['padduw', 0x28, 0x10, 'rd'], ['psubuw', 0x28, 0x11, 'rd'],
  ['pextuw', 0x28, 0x12, 'rd'], ['padduh', 0x28, 0x14, 'rd'], ['psubuh', 0x28, 0x15, 'rd'], ['pextuh', 0x28, 0x16, 'rd'], ['paddub', 0x28, 0x18, 'rd'],
  ['psubub', 0x28, 0x19, 'rd'], ['pextub', 0x28, 0x1A, 'rd'], ['qfsrv', 0x28, 0x1B, 'rd'],
  ['pmaddw', 0x09, 0x00, 'hilo'], ['psllvw', 0x09, 0x02, 'rd'], ['psrlvw', 0x09, 0x03, 'rd'], ['pmsubw', 0x09, 0x04, 'hilo'], ['pinth', 0x09, 0x0A, 'rd'],
  ['pmultw', 0x09, 0x0C, 'hilo'], ['pdivw', 0x09, 0x0D, 'div'], ['pcpyld', 0x09, 0x0E, 'rd'], ['pmaddh', 0x09, 0x10, 'hilo'], ['phmadh', 0x09, 0x11, 'hilo'],
  ['pand', 0x09, 0x12, 'rd'], ['pxor', 0x09, 0x13, 'rd'], ['pmsubh', 0x09, 0x14, 'hilo'], ['phmsbh', 0x09, 0x15, 'hilo'], ['pexeh', 0x09, 0x1A, 'rt'],
  ['prevh', 0x09, 0x1B, 'rt'], ['pmulth', 0x09, 0x1C, 'hilo'], ['pdivbw', 0x09, 0x1D, 'div'], ['pexew', 0x09, 0x1E, 'rt'], ['prot3w', 0x09, 0x1F, 'rt'],
  ['pmadduw', 0x29, 0x00, 'hilo'], ['psravw', 0x29, 0x03, 'rd'], ['pinteh', 0x29, 0x0A, 'rd'], ['pmultuw', 0x29, 0x0C, 'hilo'], ['pdivuw', 0x29, 0x0D, 'div'],
  ['pcpyud', 0x29, 0x0E, 'rd'], ['por', 0x29, 0x12, 'rd'], ['pnor', 0x29, 0x13, 'rd'], ['pexch', 0x29, 0x1A, 'rt'], ['pcpyh', 0x29, 0x1B, 'rt'], ['pexcw', 0x29, 0x1E, 'rt'],
];
// the shifts by an amount in the instruction, with the amount each takes
const MMI_SHIFTS = [['psllh', 0x34, 3], ['psrlh', 0x36, 5], ['psrah', 0x37, 7], ['psllw', 0x3C, 9], ['psrlw', 0x3E, 17], ['psraw', 0x3F, 21]];
// what Play!'s release build skips as unknown instructions, which the kit does as the manual says (mmi.h): left out
// until Play! does them, and the shifts by a register, whose assembly names rt before rs
const PLAY_SKIPS = new Set(['pmaddw', 'pmsubw', 'pmsubh', 'padsbh', 'pmadduw', 'pdivuw', 'pmfhl_slw', 'pmthl_lw']);
const SWAPPED = new Set(['psllvw', 'psrlvw', 'psravw']);
const PMFHL = [['pmfhl_lw', 0], ['pmfhl_uw', 1], ['pmfhl_slw', 2], ['pmfhl_lh', 3], ['pmfhl_sh', 4]];
// the pipeline-1 and 64-bit ones on the registers' low 64 bits: [name, funct, form]
const MMI_WIDE = [['mmi_madd', 0x00, 'acc'], ['maddu', 0x01, 'acc'], ['mult1', 0x18, 'mul'], ['multu1', 0x19, 'mul'], ['div1', 0x1A, 'div'], ['divu1', 0x1B, 'div'], ['madd1', 0x20, 'acc'], ['maddu1', 0x21, 'acc']];

// ---- The program's memory ----
class Memory {
  constructor() { this.blocks = []; }
  // a block at a place, its words
  put(at, words) { this.blocks.push([at, words.map(w => w >>> 0)]); return at; }
}

/** The program: its memory, its code, and its Dreamport's C, from the same steps. */
export function eeVuProgram() {
  const memory = new Memory();
  // the math's inputs: eight floats, eight whole numbers and four quadwords, and the constants their sums take
  const FIN = DATA_AT, IIN = FIN + 0x20, QIN = IIN + 0x20, CONSTANTS = QIN + 0x40;
  memory.put(FIN, [1.5, -2.75, 3.0e9, -1.2e-4, -333.5, 7.25, 12345.678, -0.4].map(bitsOf));
  memory.put(IIN, [1, -7, 1000, 123456, -99999, 42, 0x7FFF0000, -1]);
  memory.put(QIN, pattern(16, 3));
  memory.put(CONSTANTS, [bitsOf(0.03125), 0, 0, 0, 0x01030507, 0x090B0D0F, 0xF1F3F5F7, 0x80818283]);
  // the floats the console treats its own way: the largest, two with their exponent all ones, both zeros, two tinier
  // than the smallest ordinary one and that one, and one near the largest a computer has
  const SPECIAL = CONSTANTS + 0x20, FIFOS = SPECIAL + 0x20;
  memory.put(SPECIAL, [0x7FFFFFFF, 0x7F800000, 0xFF800001, 0x00000000, 0x80000000, 0x00000001, 0x00800000, bitsOf(3.0e38)]);
  // a packet for the GIF's FIFO, a corner of a sprite, and a quadword of codes for VIF1's, an UNPACK of two words
  memory.put(FIFOS, [...gifTag({ loops: 1, prim: 6, regs: [0x1, 0x5] }), 0x70, 0x70, 0x10, 0x80, XY(50, 400), 0, 0, 0,
    vif.stcycl(1, 1), vif.unpack({ format: 0x0, count: 2, at: 0x3F8 }), 0x12345678, 0x9ABCDEF0]);
  // the GS made ready to draw, sent first each frame as PATH3
  const SETUP = DATA_AT + 0x200, WIDTH = 640, HEIGHT = 448;
  const setup = [...gifTag({ loops: 6, regs: [0xE] }), ...aPlusD(0x4C, (WIDTH / 64) << 16), ...aPlusD(0x40, (WIDTH - 1) << 16, (HEIGHT - 1) << 16),
    ...aPlusD(0x18, 0), ...aPlusD(0x47, 0x30000), ...aPlusD(0x4E, 0, 1), ...aPlusD(0x1A, 1)];
  memory.put(SETUP, setup);

  // VIF1's chain: CNT (the program), NEXT (the setup, the unpacks), REF (the matrix and the packet's tag), CALL to a
  // subchain that REFS and REF the corners, each with its MSCAL, and RETs, then END, which masks PATH3
  const CHAIN = DATA_AT + 0x1000, PARTS = DATA_AT + 0x4000, SUB = DATA_AT + 0x6000;
  const code1 = vu1Program();
  const unpackStream = [vif.STMASK, 0x1B6C93E4, vif.STROW, 0x11111111, 0x00220022, 0x3F800000, 0xFFFFFFF0, vif.STCOL, 0x01000000, 0x02000000, 0x03000000, 0x04000000];
  const UNPACK_DATA_FROM = [];
  let quad = UNPACKS_QUADS, seed = 11;
  for (const u of UNPACKS) {
    const [cl, wl] = u.cycle ?? [4, 4];
    unpackStream.push(vif.stcycl(cl, wl), vif.stmod(u.mode ?? 0), vif.unpack({ ...u, at: quad }));
    UNPACK_DATA_FROM.push(unpackStream.length);
    unpackStream.push(...pattern(unpackWords(u.format, unpackReads(u.count, u.cycle)), seed += 5));
    quad += UNPACK_ROOM;
  }
  const program = padded([vif.FLUSHE, vif.mpg(0, code1.length / 2), ...code1]);
  const setupStream = padded([vif.stcycl(4, 4), vif.base(BASE), vif.offset(OFFSET), vif.itop(4), ...unpackStream]);
  const matrix = [[1, 0, 0, 0.0005], [0, 1, 0, 0], [0, 0, 1, 0], [320, 224, 0, 1]].flat().map(bitsOf);
  const reference = padded([vif.stcycl(4, 4), vif.stmod(0), vif.unpack({ format: 0xC, count: 4, at: MATRIX_AT }), ...matrix,
    vif.unpack({ format: 0xC, count: 1, at: PACKET_AT }), ...gifTag({ loops: 4, prim: 6, regs: [0x1, 0x5] }),
    vif.unpack({ format: 0xC, count: 1, at: COLOUR_AT }), 0x40, 0xC0, 0x80, 0x80,
    vif.unpack({ format: 0xC, count: 1, at: EDGE_AT }), bitsOf(2), bitsOf(-2), 0x40000001, bitsOf(2)]);
  const corners = shift => [[-100, -60], [80, -90], [-70, 110], [120, 70]].flatMap(([x, y]) => [bitsOf(x + shift), bitsOf(y), bitsOf(500), bitsOf(1)]);
  const cornersA = padded([vif.unpack({ format: 0xC, count: 4, at: 0, tops: true }), ...corners(0), vif.mscal(0)]);
  // the second run's colour comes after its MSCAL, in the same transfer, as the program starts once the VIF has to wait
  const cornersB = padded([vif.unpack({ format: 0xC, count: 4, at: 0, tops: true }), ...corners(25), vif.mscal(0), vif.unpack({ format: 0xC, count: 1, at: COLOUR_AT }), 0xC0, 0x40, 0x20, 0x80]);
  const ending = padded([vif.FLUSH, vif.mark(0x5A5A), vif.mskpath3(true)]);
  // an UNPACK whose data runs over from one transfer into the next, partway through a value, written 2 of every 4
  // quadwords, then one whose data ends partway into a quadword
  const split = pattern(6 * 4, 77);
  const splitFirst = [vif.stcycl(4, 2), vif.unpack({ format: 0xC, count: 6, at: SPLIT_AT }), ...split.slice(0, 10)];
  const splitRest = [...split.slice(10), vif.stcycl(1, 1), vif.unpack({ format: 0x5, count: 6, at: SPLIT_AT + 12 }), ...pattern(6, 78)];
  while (splitRest.length % 4) splitRest.push(vif.NOP);
  const SPLIT_FIRST = DATA_AT + 0xE000, SPLIT_REST = DATA_AT + 0xE100;
  memory.put(SPLIT_FIRST, splitFirst);
  memory.put(SPLIT_REST, splitRest);
  // a tag's second half, sent on the frames with TTE: three corners for the program on them, not four
  const tte = [vif.itop(3), vif.NOP];
  const SETUP_PART = PARTS, REFERENCE_PART = PARTS + 0x1000, CORNERS_A = PARTS + 0x1400, CORNERS_B = PARTS + 0x1800;
  memory.put(SETUP_PART, setupStream);
  memory.put(REFERENCE_PART, reference);
  memory.put(CORNERS_A, cornersA);
  memory.put(CORNERS_B, cornersB);
  const t0Size = program.length / 4;
  memory.put(CHAIN, [
    ...dmaTag(TAG.CNT, t0Size, 0, tte), ...program,
    ...dmaTag(TAG.NEXT, 0, CHAIN + 0x800, tte),
  ]);
  // past a gap, where NEXT goes: REF to the setup and the unpacks, REF to the matrix, CALL, END
  memory.put(CHAIN + 0x800, [
    ...dmaTag(TAG.REF, setupStream.length / 4, SETUP_PART, tte), ...dmaTag(TAG.REF, reference.length / 4, REFERENCE_PART, tte),
    ...dmaTag(TAG.CALL, 0, SUB, tte), ...dmaTag(TAG.END, ending.length / 4, 0, tte), ...ending,
  ]);
  memory.put(SUB, [...dmaTag(TAG.REFS, cornersA.length / 4, CORNERS_A, tte), ...dmaTag(TAG.REF, cornersB.length / 4, CORNERS_B, tte), ...dmaTag(TAG.RET, 0, 0, tte)]);
  // each unpack's data, which changes each frame: where it is and how many words
  const unpacksFrom = SETUP_PART + setupStream.indexOf(unpackStream[0]) * 4;
  const bumps = UNPACKS.map((u, i) => [unpacksFrom + UNPACK_DATA_FROM[i] * 4, unpackWords(u.format, unpackReads(u.count, u.cycle))]);

  // the GIF's chain, held while PATH3 is masked: CNT with a REGLIST packet, REF to a PACKED one, END with a picture
  const GIF_CHAIN = DATA_AT + 0x8000, PACKED = DATA_AT + 0x8400;
  const reglist = [...gifTag({ loops: 2, kind: 1, regs: [0x0, 0x1, 0x5] }), 6, 0, 0x80102030, 0x3F800000, XY(10, 10), 0, 6, 0, 0x80405060, 0x3F800000, XY(20, 20), 0];
  const packed = [...gifTag({ loops: 2, prim: 6, regs: [0x1, 0x5] }), 0x10, 0x20, 0x30, 0x80, XY(100, 100), 0, 0, 0, 0x40, 0x50, 0x60, 0x80, XY(140, 130), 0, 0, 0];
  const picture = [...gifTag({ loops: 4, ends: false, regs: [0xE] }), ...aPlusD(0x50, 0, 0x2000 | 1 << 16), ...aPlusD(0x51, 0), ...aPlusD(0x52, 4, 4), ...aPlusD(0x53, 0),
    ...gifTag({ loops: 4, kind: 2 }), ...pattern(16, 99)];
  memory.put(PACKED, packed);
  memory.put(GIF_CHAIN, [...dmaTag(TAG.CNT, reglist.length / 4), ...reglist, ...dmaTag(TAG.REF, packed.length / 4, PACKED), ...dmaTag(TAG.END, picture.length / 4), ...picture]);

  // VIF1's second transfer, in normal mode: a DIRECT packet, PATH3 let go, which sends one of its packets at once, and
  // another DIRECT packet
  const SECOND = DATA_AT + 0x9000;
  const direct = (colour, x) => [...gifTag({ loops: 2, prim: 6, regs: [0x1, 0x5] }), colour, 0x10, 0x10, 0x80, XY(x, 300), 0, 0, 0, 0x10, colour, 0x10, 0x80, XY(x + 30, 330), 0, 0, 0];
  const packetA = direct(0x90, 300), packetB = direct(0x30, 400);
  const second = [...padded([vif.mark(2)], 1), vif.direct(packetA.length / 4), ...packetA, ...padded([vif.mskpath3(false)], 1), vif.direct(packetB.length / 4), ...packetB, ...padded([vif.FLUSHA])];
  memory.put(SECOND, second);

  // VIF1's third transfer: the second program, in as many MPGs as its 256-pair pieces, what it's given, MSCALF, and
  // MSCNT once it has stopped halfway
  const THIRD = DATA_AT + 0x10000, exercise = vu1Exercise();
  const pieces = [];
  for (let from = 0; from < exercise.pairs; from += 256) {
    const count = Math.min(256, exercise.pairs - from);
    pieces.push(vif.mpg(EXERCISE_AT + from, count), ...exercise.code.slice(from * 2, (from + count) * 2));
  }
  const third = padded([vif.FLUSHE, ...pieces, vif.stcycl(4, 4), vif.stmod(0), vif.unpack({ format: 0xC, count: 3, at: GIVEN_AT }),
    0x7FFFFFFF, 0x00800000, 0x80000000, 0x7F800001, bitsOf(2), bitsOf(-3.5), bitsOf(0.25), bitsOf(1e10), 0x00000001, 0x807FFFFF, 0x00400000, bitsOf(1), vif.mscalf(EXERCISE_AT), vif.FLUSHE, vif.MSCNT, vif.FLUSHE]);
  memory.put(THIRD, third);

  // VIF0: vector unit 0's program, its numbers, ITOP and MSCAL, in normal mode
  const VIF0 = DATA_AT + 0xA000, code0 = vu0Program();
  const numbers = [1.5, -2.25, 3, 0.5, 100, -0.125, 7, 2].map(bitsOf).concat([0x12345, -42, 7, 1000]);
  const vif0 = padded([vif.FLUSHE, vif.mpg(0, code0.length / 2), ...code0, vif.stcycl(1, 1), vif.stmod(0), vif.unpack({ format: 0xC, count: 3, at: 0 }), ...numbers, vif.itop(0x2A), vif.mscal(0), vif.FLUSHE]);
  // as a chain that a tag's interrupt bit ends, with TIE: the tag after it, whose UNPACK would mark the unit's memory,
  // is never read
  memory.put(VIF0, [(vif0.length / 4 | TAG.CNT << 28 | 1 << 31) >>> 0, 0, 0, 0, ...vif0,
    ...dmaTag(TAG.END, 2), vif.stcycl(1, 1), vif.unpack({ format: 0x0, count: 1, at: 0x30 }), 0xDEADBEEF, vif.NOP, vif.NOP, vif.NOP, vif.NOP, vif.NOP]);

  // the scratchpad's round trip
  const SPR = DATA_AT + 0xC000, SPR_BACK = DATA_AT + 0xD000;
  const sprPacket = [...gifTag({ loops: 2, prim: 6, regs: [0x1, 0x5] }), 0x33, 0x66, 0x99, 0x80, XY(500, 50), 0, 0, 0, 0x99, 0x66, 0x33, 0x80, XY(540, 90), 0, 0, 0];
  memory.put(SPR, sprPacket);

  // the math's results go to vector unit 1's memory from quadword 0, through VIF1, after a quadword of its codes
  const steps = frameSteps({ FIN, IIN, QIN, CONSTANTS, SPECIAL, FIFOS, SETUP, setupQwc: setup.length / 4, CHAIN, GIF_CHAIN, SECOND, secondQwc: second.length / 4,
    VIF0, vif0Qwc: vif0.length / 4, SPR, SPR_BACK, sprQwc: sprPacket.length / 4, bumps, SPLIT_FIRST, splitFirstQwc: splitFirst.length / 4, SPLIT_REST, splitRestQwc: splitRest.length / 4, THIRD, thirdQwc: third.length / 4 });
  return { memory: memory.blocks, steps, names: { FIN, IIN, QIN, CONSTANTS, SPECIAL, FIFOS, RESULTS_AT, RESULT_CODES: RESULTS_AT - 16 } };
}

// One frame's work as steps, each made into MIPS by `mips` and into C by `c`. Registers: S0 the frame's number, S1
// where the next result goes.
function frameSteps(p) {
  const steps = [];
  const step = (mips, c) => steps.push({ mips, c });
  let result = 0;
  const RESULT_CODES = RESULTS_AT - 16;
  step([...li(S1, RESULTS_AT)], 'uint32_t next = RESULTS_AT;');
  // the inputs change: each float by a 32nd of another, each whole number times 3 plus 0x1357, each quadword by the next
  // and the constant's bytes
  step([...li(T3, p.CONSTANTS), lwc1(4, 0, T3)], 'const float k = word_float(CONSTANTS);');
  for (let i = 0; i < 8; i++) {
    step([...li(T0, p.FIN), lwc1(0, i * 4, T0), lwc1(1, ((i + 3) & 7) * 4, T0), fpu(0x02, 1, 1, 4), fpu(0x00, 0, 0, 1), swc1(0, i * 4, T0)],
      `put_float(FIN + ${i * 4}, ee_add(word_float(FIN + ${i * 4}), ee_mul(word_float(FIN + ${((i + 3) & 7) * 4}), k)));`);
    step([...li(T0, p.IIN), lw(T1, i * 4, T0), sll(T2, T1, 1), addu(T1, T1, T2), addiu(T1, T1, 0x1357), sw(T1, i * 4, T0)],
      `put_word(IIN + ${i * 4}, word(IIN + ${i * 4}) * 3 + 0x1357);`);
  }
  for (let i = 0; i < 4; i++) {
    step([...li(T0, p.QIN), lq(A0, i * 16, T0), lq(A1, ((i + 1) & 3) * 16, T0), lq(A2, 16, T3), mmi(0x08, A0, A0, A1, 0x00), mmi(0x08, A0, A0, A2, 0x08), sq(A0, i * 16, T0)],
      `put_quad(QIN + ${i * 16}, ee_paddb(ee_paddw(quad(QIN + ${i * 16}), quad(QIN + ${((i + 1) & 3) * 16})), quad(CONSTANTS + 16)));`);
  }
  // the FPU's sums on each float and the next, and the conditions they set
  const put = c => { const at = result; result += 4; return `put_word(next + ${at}, ${c});`; };
  for (let i = 0; i < 8; i++) {
    const load = [...li(T0, p.FIN), lwc1(0, i * 4, T0), lwc1(1, ((i + 1) & 7) * 4, T0), lw(T1, i * 4 + 0x20, T0)];
    step(load, `{ float a = word_float(FIN + ${i * 4}), b = word_float(FIN + ${((i + 1) & 7) * 4}); int32_t n = (int32_t)word(IIN + ${i * 4});`);
    for (const [mips, c, kind] of FPU_OPS) step([...mips, swc1(2, result, S1)], put(kind === 'int' ? `(uint32_t)${c}` : `float_word(${c})`));
    step([mtc1(T1, 3), fpuWord(0x20, 2, 3), swc1(2, result, S1)], put('float_word(ee_from_int(n))'));
    for (const [funct, c] of COMPARES) {
      const compare = (0x11 << 26 | 16 << 21 | (funct === 0x32 ? 0 : 1) << 16 | 0 << 11 | funct) >>> 0;
      step([compare, cfc1(T2, 31), srl(T2, T2, 23), andi(T2, T2, 1), sw(T2, result, S1)], put(`(${c}, ee_cfc1(31) >> 23 & 1)`));
    }
    step([], '}');
  }
  // the same on the floats the console treats its own way, each against another of them and against one of the others,
  // each result with the whole FCSR it leaves, which starts each frame with its flags clear
  step([ctc1(0, 31)], 'ee_ctc1(31, 0);');
  for (let i = 0; i < 8; i++) {
    const other = i & 1 ? [p.FIN, i * 4, `FIN + ${i * 4}`] : [p.SPECIAL, ((i + 3) & 7) * 4, `SPECIAL + ${((i + 3) & 7) * 4}`];
    step([...li(T0, p.SPECIAL), lwc1(0, i * 4, T0), ...li(T0, other[0]), lwc1(1, other[1], T0)], `{ float a = word_float(SPECIAL + ${i * 4}), b = word_float(${other[2]});`);
    for (const [mips, c, kind] of FPU_OPS) {
      step([...mips, swc1(2, result, S1)], put(kind === 'int' ? `(uint32_t)${c}` : `float_word(${c})`));
      step([cfc1(T2, 31), sw(T2, result, S1)], put('ee_cfc1(31)'));
    }
    for (const [mips, c] of [[[fpu(0x16, 2, 0, 1)], 'ee_rsqrt(a, b)'], [[fpu(0x03, 2, 1, 0)], 'ee_div(b, a)'], [[fpu(0x04, 2, 0, 1)], 'ee_sqrt(b)']]) {
      step([...mips, swc1(2, result, S1)], put(`float_word(${c})`));
      step([cfc1(T2, 31), sw(T2, result, S1)], put('ee_cfc1(31)'));
    }
    // and against a third, compared, and the larger and the smaller
    step([...li(T0, p.SPECIAL), lwc1(1, ((i + 6) & 7) * 4, T0)], `b = word_float(SPECIAL + ${((i + 6) & 7) * 4});`);
    for (const [funct, c] of [[0x34, 'ee_c_lt(a, b)'], [0x36, 'ee_c_le(a, b)'], [0x32, 'ee_c_eq(a, b)']]) {
      step([(0x11 << 26 | 16 << 21 | 1 << 16 | 0 << 11 | funct) >>> 0, cfc1(T2, 31), srl(T2, T2, 23), andi(T2, T2, 1), sw(T2, result, S1)], put(`(${c}, ee_cfc1(31) >> 23 & 1)`));
    }
    step([fpu(0x28, 2, 0, 1), swc1(2, result, S1)], put('float_word(ee_max(a, b))'));
    step([fpu(0x29, 2, 0, 1), swc1(2, result, S1)], put('float_word(ee_min(a, b))'));
    step([], '}');
  }
  result = (result + 15) & ~15;
  // the MMI's on two of the four quadwords, which two changing each frame
  step([...li(T0, p.QIN), andi(T1, S0, 3), sll(T1, T1, 4), addu(T1, T1, T0), lq(A0, 0, T1), addiu(T2, S0, 1), andi(T2, T2, 3), sll(T2, T2, 4), addu(T2, T2, T0), lq(A1, 0, T2), mtsab(S0, 3)],
    '{ ee_quad a = quad(QIN + ((frame & 3) << 4)), b = quad(QIN + (((frame + 1) & 3) << 4)); ee_mtsab(frame, 3);');
  const putQuad = c => { const at = result; result += 16; return `put_quad(next + ${at}, ${c});`; };
  const setHiLo = [mmi(0x29, 0, A1, 0, 0x08), mmi(0x29, 0, A0, 0, 0x09)];
  const hiLoAfter = () => {
    step([mmi(0x09, V1, 0, 0, 0x08), sq(V1, result, S1)], putQuad('ee_pmfhi()'));
    step([mmi(0x09, V1, 0, 0, 0x09), sq(V1, result, S1)], putQuad('ee_pmflo()'));
  };
  for (const [name, funct, sa, form] of MMI_OPS) {
    if (PLAY_SKIPS.has(name)) continue;
    const args = SWAPPED.has(name) ? '(b, a)' : '(a, b)';
    if (form === 'rd') step([mmi(funct, V0, A0, A1, sa), sq(V0, result, S1)], putQuad(`ee_${name}${args}`));
    else if (form === 'rt') step([mmi(funct, V0, 0, A1, sa), sq(V0, result, S1)], putQuad(`ee_${name}(b)`));
    else {
      // HI and LO from the inputs first, then the instruction, then what it left in them
      step(setHiLo, 'ee_pmthi(b); ee_pmtlo(a);');
      if (form === 'hilo') step([mmi(funct, V0, A0, A1, sa), sq(V0, result, S1)], putQuad(`ee_${name}(a, b)`));
      else step([mmi(funct, 0, A0, A1, sa)], `ee_${name}(a, b);`);
      hiLoAfter();
    }
  }
  for (const [name, funct, amount] of MMI_SHIFTS) step([mmi(funct, V0, 0, A1, amount), sq(V0, result, S1)], putQuad(`ee_${name}(b, ${amount})`));
  // the five ways PMFHL reads HI and LO, after a PMULTH has filled them, and PMTHL.LW
  step([mmi(0x09, V0, A0, A1, 0x1C)], 'ee_pmulth(a, b);');
  for (const [name, sa] of PMFHL) if (!PLAY_SKIPS.has(name)) step([mmi(0x30, V0, 0, 0, sa), sq(V0, result, S1)], putQuad(`ee_${name}()`));
  // the 64-bit and pipeline-1 ones on the low 64 bits
  for (const [name, funct, form] of MMI_WIDE) {
    step(setHiLo, 'ee_pmthi(b); ee_pmtlo(a);');
    if (form === 'div') step([mmi(funct, 0, A0, A1)], `ee_${name}(a.d[0], b.d[0]);`);
    else step([mmi(funct, V0, A0, A1), sd(V0, result, S1)], `put_double(next + ${result}, ee_${name}(a.d[0], b.d[0]));`), result += 16;
    hiLoAfter();
  }
  step([mmi(0x04, V0, A0, 0), sd(V0, result, S1)], `put_double(next + ${result}, ee_plzcw(a.d[0]));`);
  result += 16;
  step([], '}');
  // vector unit 0 from the EE, an instruction at a time: its registers loaded, sums, a division, CLIP, whole numbers
  // and R, with the vectors, Q through a sum and the flags kept
  {
    const macro = word => step([cop2(word)], `vu0_macro(${cop2(word)}u);`);
    const lowerWord = word => word & 0x01FFFFFF;
    const keepVector = reg => { step([sqc2(reg, result, S1)], `put_vector(next + ${result}, vu0_vf(${reg}));`); result += 16; };
    const keepFlags = () => {
      [16, 17, 18].forEach((id, i) => step([cfc2(T2, id), sw(T2, result + i * 4, S1)], `put_word(next + ${result + i * 4}, vu0_cfc2(${id}));`));
      step([sw(0, result + 12, S1)], `put_word(next + ${result + 12}, 0);`);
      result += 16;
    };
    step([...li(T0, p.FIN), lqc2(1, 0, T0), lqc2(2, 16, T0), ...li(T0, p.SPECIAL), lqc2(3, 0, T0), lqc2(4, 16, T0)],
      'load_vector(vu0_vf(1), FIN); load_vector(vu0_vf(2), FIN + 16); load_vector(vu0_vf(3), SPECIAL); load_vector(vu0_vf(4), SPECIAL + 16);');
    for (const word of [vu.add({ fs: 1, ft: 2, fd: 5 }), vu.mul({ fs: 1, ft: 3, fd: 6 }), vu.sub({ dest: 14, fs: 3, ft: 4, fd: 7 })]) macro(word);
    [5, 6, 7].forEach(keepVector); keepFlags();
    for (const word of [vu.mulabc(0, { fs: 1, ft: 2 }), vu.maddabc(1, { fs: 2, ft: 1 }), vu.maddbc(3, { fs: 1, ft: 2, fd: 5 }), vu.opmula({ dest: 14, fs: 1, ft: 2 }), vu.opmsub({ dest: 14, fs: 2, ft: 1, fd: 6 }),
      vu.ftoi(4, { fs: 1, ft: 7 }), vu.itof(12, { fs: 7, ft: 8 }), vu.clip({ dest: 14, fs: 1, ft: 2 }), vu.clip({ dest: 14, fs: 3, ft: 1 })]) macro(word);
    [5, 6, 7, 8].forEach(keepVector); keepFlags();
    // a division, by zero the second time, each waited for, with Q seen through a sum, and a root
    for (const [divide, into] of [[vu.div(1, 0, 2, 1), 5], [vu.div(1, 0, 3, 3), 6], [vu.sqrt(2, 1), 7], [vu.rsqrt(1, 2, 2, 0), 8]]) {
      macro(lowerWord(divide)); macro(lowerWord(vu.waitq)); macro(vu.addq({ fs: 0, fd: into }));
      keepVector(into); keepFlags();
    }
    // whole numbers, R and the moves, and the control registers written and read back
    for (const word of [vu.iaddi(1, 0, 7), vu.iaddi(2, 1, -3), vu.iadd(3, 1, 2), vu.isub(4, 1, 2), vu.iand(5, 1, 2), vu.ior(6, 1, 2)]) macro(lowerWord(word));
    for (const word of [vu.mtir(7, 1, 0), vu.mfir(5, 3, 15), vu.rinit(1, 1), vu.rnext(6, 15), vu.rxor(2, 0), vu.rget(7, 10), vu.mr32(8, 1, 15), vu.move(9, 2, 5)]) macro(lowerWord(word));
    [5, 6, 7, 8, 9].forEach(keepVector);
    [1, 2, 3, 4, 5, 6, 7, 20].forEach((id, i) => step([cfc2(T2, id), sw(T2, result + i * 4, S1)], `put_word(next + ${result + i * 4}, vu0_cfc2(${id}));`));
    result += 32;
    step([...li(T2, 0xFC0), ctc2(T2, 16), ...li(T2, 0x123456), ctc2(T2, 18), ...li(T2, 0x4D2), ctc2(T2, 8)], 'vu0_ctc2(16, 0xFC0); vu0_ctc2(18, 0x123456); vu0_ctc2(8, 0x4D2);');
    keepFlags();
    step([cfc2(T2, 8), sw(T2, result, S1), sw(0, result + 4, S1), sw(0, result + 8, S1), sw(0, result + 12, S1)], `put_word(next + ${result}, vu0_cfc2(8)); put_word(next + ${result + 4}, 0); put_word(next + ${result + 8}, 0); put_word(next + ${result + 12}, 0);`);
    result += 16;
    step([ctc2(0, 16)], 'vu0_ctc2(16, 0);');
  }
  const resultQuads = result / 16;
  if (resultQuads > 255) throw new Error(`The results are ${resultQuads} quadwords, more than one UNPACK takes.`);
  if (process.env.DP_TEST_SIZES) console.log(`results: ${resultQuads} quadwords`);
  // the results to vector unit 1's memory
  step([...li(T0, RESULT_CODES), ...li(T1, vif.stcycl(4, 4)), sw(T1, 0, T0), ...li(T1, vif.stmod(0)), sw(T1, 4, T0), sw(0, 8, T0),
    ...li(T1, vif.unpack({ format: 0xC, count: resultQuads & 0xFF, at: RESULTS_QUADS })), sw(T1, 12, T0)],
    `put_word(RESULT_CODES, ${vif.stcycl(4, 4)}u); put_word(RESULT_CODES + 4, ${vif.stmod(0)}u); put_word(RESULT_CODES + 8, 0); put_word(RESULT_CODES + 12, ${vif.unpack({ format: 0xC, count: resultQuads & 0xFF, at: RESULTS_QUADS })}u);`);
  const send = (channel, { madr = null, qwc = null, tadr = null, sadr = null, chcr, tte = false, wait = true }, name) => {
    const mips = [...li(T0, channel)];
    const c = [];
    if (madr !== null) mips.push(...li(T1, madr), sw(T1, 0x10, T0)), c.push(`ps2_write32(${channel} + DMA_MADR, ${madr >>> 0}u);`);
    if (qwc !== null) mips.push(...li(T1, qwc), sw(T1, 0x20, T0)), c.push(`ps2_write32(${channel} + DMA_QWC, ${qwc});`);
    if (tadr !== null) mips.push(...li(T1, tadr), sw(T1, 0x30, T0)), c.push(`ps2_write32(${channel} + DMA_TADR, ${tadr}u);`);
    if (sadr !== null) mips.push(...li(T1, sadr), sw(T1, 0x80, T0)), c.push(`ps2_write32(${channel} + DMA_SADR, ${sadr});`);
    mips.push(...li(T1, chcr));
    if (tte) mips.push(andi(T2, S0, 1), sll(T2, T2, 6), or(T1, T1, T2));
    mips.push(sw(T1, 0, T0));
    c.push(`ps2_write32(${channel} + DMA_CHCR, ${chcr}u${tte ? ' | (frame & 1) << 6' : ''});`);
    if (wait) mips.push(here(`wait${name}`), lw(T3, 0, T0), andi(T3, T3, 0x100), bne(T3, 0, `wait${name}`), NOP), c.push(`wait_for(${channel});`);
    step(mips, c.join(' '));
  };
  const GIF = 0x1000A000, VIF1 = 0x10009000, VIF0 = 0x10008000, FROM_SPR = 0x1000D000, TO_SPR = 0x1000D400;
  send(GIF, { madr: p.SETUP, qwc: p.setupQwc, chcr: 0x101 }, 'setup');
  send(VIF1, { madr: RESULT_CODES, qwc: resultQuads + 1, chcr: 0x101 }, 'results');
  // the unpacks' data changes by the frame's number, a word at a time
  p.bumps.forEach(([at, count], i) => step(
    [...li(T0, at), addiu(T1, 0, count), here(`bump${i}`), lw(T2, 0, T0), addu(T2, T2, S0), sw(T2, 0, T0), addiu(T0, T0, 4), addiu(T1, T1, -1), bne(T1, 0, `bump${i}`), NOP],
    `for (uint32_t i = 0; i < ${count}; i++) put_word(${at}u + i * 4, word(${at}u + i * 4) + frame);`));
  send(VIF1, { tadr: p.CHAIN, chcr: 0x105, tte: true }, 'chain');
  send(GIF, { tadr: p.GIF_CHAIN, chcr: 0x105, wait: false }, 'gifchain');
  send(VIF1, { madr: p.SECOND, qwc: p.secondQwc, chcr: 0x101 }, 'second');
  send(VIF1, { madr: p.SPLIT_FIRST, qwc: p.splitFirstQwc, chcr: 0x101 }, 'split');
  send(VIF1, { madr: p.SPLIT_REST, qwc: p.splitRestQwc, chcr: 0x101 }, 'rest');
  send(VIF1, { madr: p.THIRD, qwc: p.thirdQwc, chcr: 0x101 }, 'third');
  step([...li(T0, GIF), here('waitgif'), lw(T3, 0, T0), andi(T3, T3, 0x100), bne(T3, 0, 'waitgif'), NOP], `wait_for(${GIF});`);
  send(VIF0, { tadr: p.VIF0, chcr: 0x185 }, 'vif0');
  // a packet written to the GIF's FIFO, a quadword at a time, and a quadword of codes to VIF1's
  step([...li(T0, p.FIFOS), lq(A0, 0, T0), lq(A1, 16, T0), lq(A2, 32, T0), lq(A3, 48, T0), ...li(T1, 0x10006000), sq(A0, 0, T1), sq(A1, 0, T1), sq(A2, 0, T1), ...li(T1, 0x10005000), sq(A3, 0, T1)],
    '{ ee_quad a = quad(FIFOS), b = quad(FIFOS + 16), c = quad(FIFOS + 32), d = quad(FIFOS + 48); ps2_write128(GIF_FIFO, &a); ps2_write128(GIF_FIFO, &b); ps2_write128(GIF_FIFO, &c); ps2_write128(VIF1_FIFO, &d); }');
  send(TO_SPR, { madr: p.SPR, qwc: p.sprQwc, sadr: 0, chcr: 0x100 }, 'tospr');
  send(GIF, { madr: 0x80000000, qwc: p.sprQwc, chcr: 0x101 }, 'fromspr');
  send(FROM_SPR, { madr: p.SPR_BACK, qwc: p.sprQwc, sadr: 0, chcr: 0x100 }, 'back');
  send(GIF, { madr: p.SPR_BACK, qwc: p.sprQwc, chcr: 0x101 }, 'sprback');
  return steps;
}

// ---- The program's own code: the screen, then each frame's steps after the V-blank ----
const GS = 0x12000000, CSR = 0x1000, D_CTRL = 0x1000E000;
function programCode(steps) {
  return [
    // SetGsCrt: interlaced, NTSC, in fields
    addiu(V1, 0, 2), addiu(A0, 0, 1), addiu(A1, 0, 2), addiu(A2, 0, 0), SYSCALL,
    lui(T0, GS >>> 16),
    ...li(T1, 0xFF25), sw(T1, 0x00, T0), sw(0, 0x04, T0), addiu(T1, 0, 1), sw(T1, 0x20, T0), sw(0, 0x24, T0),
    ...li(T1, 10 << 9), sw(T1, 0x70, T0), sw(0, 0x74, T0), ...li(T1, (656 | 36 << 12 | 3 << 23) >>> 0), sw(T1, 0x80, T0),
    ...li(T1, (640 * 4 - 1 | (448 - 1) << 12) >>> 0), sw(T1, 0x84, T0),
    ...li(T2, D_CTRL), addiu(T1, 0, 1), sw(T1, 0, T2), addiu(S0, 0, 0),
    here('frame'),
    ...li(T0, GS | CSR), addiu(T1, 0, 8), sw(T1, 0, T0), here('vblank'), lw(T1, 0, T0), andi(T1, T1, 8), beq(T1, 0, 'vblank'), NOP,
    ...steps.flatMap(s => s.mips),
    addiu(S0, S0, 1), j('frame'), NOP,
  ];
}

function elfOf(segments, entry) {
  const headerSize = 52 + 32 * segments.length, bodies = [];
  let offset = Math.ceil(headerSize / 16) * 16;
  const header = Buffer.alloc(offset);
  header.set([0x7F, 0x45, 0x4C, 0x46, 1, 1, 1], 0);
  header.writeUInt16LE(2, 16);
  header.writeUInt16LE(8, 18);
  header.writeUInt32LE(1, 20);
  header.writeUInt32LE(entry, 24);
  header.writeUInt32LE(52, 28);
  header.writeUInt32LE(0x20924001, 36);
  header.writeUInt16LE(52, 40);
  header.writeUInt16LE(32, 42);
  header.writeUInt16LE(segments.length, 44);
  header.writeUInt16LE(40, 46);
  segments.forEach(([address, words], i) => {
    const body = Buffer.from(new Uint32Array(words).buffer), at = 52 + i * 32;
    header.writeUInt32LE(1, at);
    header.writeUInt32LE(offset, at + 4);
    header.writeUInt32LE(address, at + 8);
    header.writeUInt32LE(address, at + 12);
    header.writeUInt32LE(body.length, at + 16);
    header.writeUInt32LE(body.length, at + 20);
    header.writeUInt32LE(7, at + 24);
    header.writeUInt32LE(16, at + 28);
    bodies.push(body);
    offset += body.length;
    const pad = (16 - offset % 16) % 16;
    if (pad) bodies.push(Buffer.alloc(pad)), offset += pad;
  });
  const elf = Buffer.concat([header, ...bodies]);
  return { elf, sha1: createHash('sha1').update(elf).digest('hex') };
}

/** The program as an ELF file, with its SHA-1, as `rom` knows a copy by, and its Dreamport's numbers and steps. */
export function madeUpPs2EeVu() {
  const { memory, steps, names } = eeVuProgram();
  const code = assemble(programCode(steps), LOAD_AT);
  const segments = [[LOAD_AT, code], ...memory].sort((a, b) => a[0] - b[0]);
  return { ...elfOf(segments, LOAD_AT), memory, names, steps: steps.map(s => s.c).filter(Boolean) };
}
