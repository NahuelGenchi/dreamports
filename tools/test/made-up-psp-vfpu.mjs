// A small PlayStation Portable program with nothing from any game in it, written here, that does the vector unit's sums,
// for the tools' check of the kit's (psp-vfpu.mjs). Its first thread makes two threads with the vector unit of their own
// (PSP_THREAD_ATTR_VFPU), each waiting for the V-blank. Each frame the first of them, `sums`, turns four whole numbers
// from the frame's number into floats and does the unit's sums on them: a swizzle and a negation by prefix, sums and
// products of vectors, a dot product and a scale, the unit's own sine, cosine, reciprocal, reciprocal of a square root,
// square root, powers and logarithms of two and arcsine, a matrix times a matrix and a matrix times a vector, a
// conversion back to whole numbers, a comparison and a move by its condition, a sum saturated by prefix, and a sum it
// keeps from frame to frame in C700. Then `other` runs, which uses the same registers for sums of its own, C700 among
// them, so `sums` finds its own again only as the system gives each thread its unit back. Both store what they made,
// and the first thread draws a bar for each word, through the graphics chip, as wide as its four bytes folded into one,
// so a bit of any of them that differs shows.

import { pspProgram, here, li, la, call, addiu, addu, subu, andi, or, xor, sll, srl, sh, sw, lw, bne, j, NOP, ZERO, V0, A0, A1, A2, A3, T0, T1, T2, T3, T4, S0 } from './made-up-psp.mjs';
import { list, vertex, VTYPE, BACKGROUND, BAR, WIDTH, HEIGHT, LINE } from './made-up-psp-ge.mjs';

export { WIDTH, HEIGHT, LINE, BACKGROUND, BAR };

// ---- the vector unit's instructions, as their words --------------------------------------------------------------

const SIZE = { s: 0, p: 0x80, t: 0x8000, q: 0x8080 };
const three = base => (size, vd, vs, vt) => (base | SIZE[size] | vt << 16 | vs << 8 | vd) >>> 0;
const two = base => (size, vd, vs) => (base | SIZE[size] | vs << 8 | vd) >>> 0;
export const vadd = three(0x60000000), vmul = three(0x64000000), vdot = three(0x64800000), vscl = three(0x65000000);
export const vmov = two(0xD0000000), vrcp = two(0xD0100000), vrsq = two(0xD0110000), vsin = two(0xD0120000), vcos = two(0xD0130000);
export const vexp2 = two(0xD0140000), vlog2 = two(0xD0150000), vsqrt = two(0xD0160000), vasin = two(0xD0170000);
export const vzero = (size, vd) => (0xD0060000 | SIZE[size] | vd) >>> 0, vone = (size, vd) => (0xD0070000 | SIZE[size] | vd) >>> 0;
export const vcst = (size, vd, constant) => (0xD0600000 | constant << 16 | SIZE[size] | vd) >>> 0;
export const vi2f = (size, vd, vs, scale) => (0xD2800000 | scale << 16 | SIZE[size] | vs << 8 | vd) >>> 0;
export const vf2in = (size, vd, vs, scale) => (0xD2000000 | scale << 16 | SIZE[size] | vs << 8 | vd) >>> 0;
export const vcmp = (size, condition, vs, vt) => (0x6C000000 | SIZE[size] | vt << 16 | vs << 8 | condition) >>> 0;
export const vcmovt = (size, vd, vs, bit) => (0xD2A00000 | bit << 16 | SIZE[size] | vs << 8 | vd) >>> 0;
export const vmmul = three(0xF0000000);
export const vtfm4 = (vd, vs, vt) => (0xF1800000 | SIZE.q | vt << 16 | vs << 8 | vd) >>> 0;
export const vpfxs = value => (0xDC000000 | value) >>> 0, vpfxd = value => (0xDE000000 | value) >>> 0;
export const lvq = (vt, offset, base) => (0xD8000000 | base << 21 | (vt & 31) << 16 | (offset & 0xFFFC) | (vt >> 5 & 1)) >>> 0;
export const svq = (vt, offset, base) => (0xF8000000 | base << 21 | (vt & 31) << 16 | (offset & 0xFFFC) | (vt >> 5 & 1)) >>> 0;
export const svs = (vt, offset, base) => (0xE8000000 | base << 21 | (vt & 31) << 16 | (offset & 0xFFFC) | (vt >> 5 & 3)) >>> 0;
export const mfv = (rt, vd) => (0x48600000 | rt << 16 | vd) >>> 0, mtv = (rt, vd) => (0x48E00000 | rt << 16 | vd) >>> 0;
/** Whether a word is one of the vector unit's, which PPSSPP counts as two cycles. */
export const isVfpu = word => typeof word === 'number' && [0x12, 0x18, 0x19, 0x1B, 0x32, 0x34, 0x35, 0x36, 0x37, 0x3A, 0x3C, 0x3D, 0x3E].includes(word >>> 26);

// registers: a quad column vector Cmc0 and a matrix Mm00 by their numbers, and a single Smcr
const C = (m, c) => m << 2 | c, M = m => m << 2, S = (m, c, r) => m << 2 | c | r << 5;
/** The comparison vcmp makes, less than, and the condition bit vcmovt moves by: any of the four. */
const LT = 2, ANY = 4;
// the prefixes: s swizzled to y, x, w, z with its third lane negated and its fourth's sign dropped; d saturated to
// between 0 and 1 in every lane
const SWIZZLE = (1 | 0 << 2 | 3 << 4 | 2 << 6) | 1 << (8 + 3) | 1 << (16 + 2), SATURATE = 1 | 1 << 2 | 1 << 4 | 1 << 6;

/** The words `sums` and `other` store, each a bar, in order: sums' sixteen vectors, its dot product and its condition
 *  bits, then other's vector and its constant. */
export const SUMS_VECTORS = [C(0, 2), C(0, 3), C(1, 1), C(2, 0), C(2, 1), C(2, 2), C(2, 3), C(3, 0), C(3, 1), C(3, 2), C(3, 3), C(5, 0), C(5, 1), C(5, 2), C(5, 3), C(7, 0)];
export const WORDS = SUMS_VECTORS.length * 4 + 2 + 4 + 1;
/** The bars: the line of the first, how far apart and how tall. */
export const FIRST_BAR = 8, BAR_STEP = 3, BAR_HEIGHT = 3;
/** The threads' priorities, both better than the first's 32, and their stacks' size; the attribute that gives a thread
 *  a vector unit of its own. */
export const SUMS_PRIORITY = 0x18, OTHER_PRIORITY = 0x19, STACK = 0x4000, ATTR_VFPU = 0x4000;
/** Where in `results` other's words start. */
export const OTHER_AT = (SUMS_VECTORS.length * 4 + 2) * 4;

/** The list of bars, with the screen cleared first. */
export function barsList() {
  return list([
    [0x14, 0], [0x10, 0], [0x9C, 0], [0x9D, LINE], [0xD2, 3],
    [0xD4, 0], [0xD5, (WIDTH - 1) | (HEIGHT - 1) << 10], [0x16, (WIDTH - 1) | (HEIGHT - 1) << 10],
    [0x12, VTYPE],
    [0xD3, 1 | 0x100 | 0x200], [0x01, { at: 'clear' }], [0x04, 6 << 16 | 2], [0xD3, 0],
    [0x01, { at: 'bars' }], [0x04, 6 << 16 | WORDS * 2],
    [0x0F, 0], [0x0C, 0],
  ], [
    ['clear', Buffer.concat([vertex(BACKGROUND, 0, 0), vertex(BACKGROUND, WIDTH, HEIGHT)])],
    ['bars', Buffer.concat(Array.from({ length: WORDS }, (_, i) => [vertex(BAR, 0, FIRST_BAR + i * BAR_STEP), vertex(BAR, 1, FIRST_BAR + i * BAR_STEP + BAR_HEIGHT)]).flat())],
  ]);
}
/** Where, in the list, the first bar's right edge is; each next one is 24 bytes on. */
export const firstEdge = () => barsList().at.bars + 12 + 4;

/** The vector unit's sums of `sums` each frame, with the address of `inputs` in T2 and of `results` in T3. */
export const SUMS = [
  lvq(C(0, 0), 0, T2),
  vi2f('q', C(0, 0), C(0, 0), 4),
  vpfxs(SWIZZLE), vmov('q', C(0, 1), C(0, 0)),
  vadd('q', C(0, 2), C(0, 0), C(0, 1)),
  vmul('q', C(0, 3), C(0, 0), C(0, 2)),
  vsin('q', C(2, 0), C(0, 0)), vcos('q', C(2, 1), C(0, 0)), vrcp('q', C(2, 2), C(0, 2)), vrsq('q', C(2, 3), C(0, 3)),
  // the sines and cosines dotted, every bit of them in the sum
  vdot('q', S(1, 0, 0), C(2, 0), C(2, 1)),
  vscl('q', C(1, 1), C(0, 0), S(1, 0, 0)),
  vsqrt('q', C(3, 0), C(0, 3)), vexp2('q', C(3, 1), C(0, 0)), vlog2('q', C(3, 2), C(0, 3)), vasin('q', C(3, 3), C(2, 0)),
  vmmul('q', M(4), M(2), M(3)),
  vtfm4(C(5, 0), M(4), C(0, 0)),
  vf2in('q', C(5, 1), C(5, 0), 8),
  vcmp('q', LT, C(0, 0), C(0, 1)), vcmovt('q', C(5, 2), C(2, 0), ANY),
  vpfxd(SATURATE), vadd('q', C(5, 3), C(0, 0), C(2, 1)),
  vadd('q', C(7, 0), C(7, 0), C(2, 0)),
  ...SUMS_VECTORS.map((vector, i) => svq(vector, i * 16, T3)),
  svs(S(1, 0, 0), SUMS_VECTORS.length * 16, T3),
];
/** And of `other`, with `results` in T3: the same registers for sums of its own. */
export const OTHER = [
  vone('q', C(7, 0)), vcst('s', S(7, 1, 0), 5), vadd('q', C(7, 2), C(7, 0), C(7, 0)),
  svq(C(7, 2), OTHER_AT, T3), svs(S(7, 1, 0), OTHER_AT + 16, T3),
];

// the frame's number with 0xA5 flipped, xori t0, s0, 0xA5
const XORI = (0x0E << 26 | S0 << 21 | T0 << 16 | 0xA5) >>> 0;

// the program in stretches, each the instructions between two of the system's functions, whose cycles its Dreamport says
// after doing the same (psp-vfpu/main.c)
const STRETCHES = {
  mode: [addiu(A0, ZERO, 0), addiu(A1, ZERO, WIDTH), addiu(A2, ZERO, HEIGHT), ...call('sceDisplaySetMode')],
  framebuffer: [...li(A0, 0x44000000), addiu(A1, ZERO, LINE), addiu(A2, ZERO, 3), addiu(A3, ZERO, 1), ...call('sceDisplaySetFrameBuf')],
  createSums: [...la(A0, 'sums name'), ...la(A1, 'sums'), addiu(A2, ZERO, SUMS_PRIORITY), ...li(A3, STACK), ...li(T0, ATTR_VFPU), addiu(T1, ZERO, 0), ...call('sceKernelCreateThread')],
  startSums: [or(A0, V0, ZERO), addiu(A1, ZERO, 0), addiu(A2, ZERO, 0), ...call('sceKernelStartThread')],
  createOther: [...la(A0, 'other name'), ...la(A1, 'other'), addiu(A2, ZERO, OTHER_PRIORITY), ...li(A3, STACK), ...li(T0, ATTR_VFPU), addiu(T1, ZERO, 0), ...call('sceKernelCreateThread')],
  startOther: [or(A0, V0, ZERO), addiu(A1, ZERO, 0), addiu(A2, ZERO, 0), ...call('sceKernelStartThread')],
  wait: [...call('sceDisplayWaitVblankStart')],
  // each word folded into a bar's width, then the bars drawn
  bars: [...la(T0, 'results'), ...la(T2, 'bars list'), addiu(T3, ZERO, WORDS)],
  fold: [lw(T1, 0, T0), srl(T4, T1, 16), xor(T1, T1, T4), srl(T4, T1, 8), xor(T1, T1, T4), andi(T1, T1, 0xFF), addiu(T1, T1, 1), { edge: true }, addiu(T0, T0, 4), addiu(T2, T2, 24), addiu(T3, T3, -1), { fold: true }, NOP],
  draw: [...la(A0, 'bars list'), addiu(A1, ZERO, 0), addiu(A2, ZERO, -1), addiu(A3, ZERO, 0), ...call('sceGeListEnQueue')],
  drawSync: [addiu(A0, ZERO, 0), ...call('sceGeDrawSync')],
  // sums: the accumulator cleared once, then each frame
  sumsStart: [vzero('q', C(7, 0)), addiu(S0, ZERO, 0)],
  sumsWait: [...call('sceDisplayWaitVblankStart')],
  // four whole numbers from the frame's number: it, five of it and three, 300 less it, and it with 0xA5 flipped
  sums: [...la(T2, 'inputs'), sw(S0, 0, T2), sll(T0, S0, 2), addu(T0, T0, S0), addiu(T0, T0, 3), sw(T0, 4, T2), addiu(T0, ZERO, 300), subu(T0, T0, S0), sw(T0, 8, T2), XORI, sw(T0, 12, T2),
    ...la(T3, 'results'), ...SUMS, addiu(S0, S0, 1)],
  sumsNext: [j('sums loop'), NOP],
  otherWait: [...call('sceDisplayWaitVblankStart')],
  other: [...la(T3, 'results'), ...OTHER],
  otherNext: [j('other loop'), NOP],
};

// what the stretches' placeholders stand for: the bar's edge written through T2, and the fold's branch back
const filled = items => items.flatMap(item => {
  if (item.edge) return [sh(T1, firstEdge(), T2)];
  if (item.fold) return [bne(T3, ZERO, 'fold')];
  return [item];
});
// the stretch's cycles: one an instruction, two for the vector unit's, as PPSSPP counts them
const count = items => filled(items).filter(item => !item.here).reduce((sum, item) => sum + (isVfpu(item) ? 2 : 1), 0);
/** The cycles each stretch of the program's own instructions takes. */
export const CYCLES = {
  ...Object.fromEntries(Object.entries(STRETCHES).map(([name, items]) => [name.replace(/[A-Z]/g, c => `_${c}`).toUpperCase(), count(items)])),
  NEXT: 2,
};

/** The program: { elf, at }. */
export function madeUpPspVfpu() {
  const S_ = name => filled(STRETCHES[name]);
  const code = [
    ...S_('mode'), ...S_('framebuffer'), ...S_('createSums'), ...S_('startSums'), ...S_('createOther'), ...S_('startOther'),
    here('frame'),
    ...S_('wait'), ...S_('bars'),
    here('fold'),
    ...S_('fold'), ...S_('draw'), ...S_('drawSync'),
    j('frame'), NOP,
    here('sums'),
    ...S_('sumsStart'),
    here('sums loop'),
    ...S_('sumsWait'), ...S_('sums'), ...S_('sumsNext'),
    here('other'),
    here('other loop'),
    ...S_('otherWait'), ...S_('other'), ...S_('otherNext'),
  ];
  return pspProgram({
    code,
    data: { 'bars list': barsList().words, 'sums name': 'sums\0', 'other name': 'other\0', inputs: new Uint32Array(4), results: new Uint32Array(WORDS) },
    imports: ['sceDisplaySetMode', 'sceDisplaySetFrameBuf', 'sceDisplayWaitVblankStart', 'sceKernelCreateThread', 'sceKernelStartThread', 'sceGeListEnQueue', 'sceGeDrawSync'],
  });
}
