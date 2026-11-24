// A small PlayStation Portable program of functions, with nothing from any game in it, written here for the function
// check's test (psp-twin.mjs), whose twins in C are psp-twin/game.c. It's relocatable, a PRX naming its sections, as most
// games' programs are, so the tools place it where their emulator does. Its functions, each as a compiler for the
// console's EABI would write it:
//
//   sum(a, b)            a + b
//   fill(to, count, v)   writes v to count bytes from to, a byte at a time
//   lookup(i)            the i-th word of a table, `values`
//   twice(a)             sum(a, a), with ra kept on its stack
//   pick(n)              10, 20 or 30 for 0, 1 or 2, through a table of where each case is, and 0 for the rest
//   bigger(a, b)         the Allegrex's own max
//   middle(x)            the Allegrex's own ext: x's bits 4 to 11
//   clock()              the system's time, through one of the system's functions
//   half(x)              a float's, which the check doesn't give yet
//   start                the program's start, which comes straight back

import { A0, A1, A2, NOP, RA, SP, T0, T1, T2, V0, ZERO, addiu, addu, beq, call, here, jal, jr, la, lw, pspProgram, sll, sw } from './made-up-psp.mjs';

const word = (op, rs, rt, value) => (op << 26 | rs << 21 | rt << 16 | (value & 0xFFFF)) >>> 0;
const sb = (rt, offset, base) => word(0x28, base, rt, offset);
const sltiu = (rt, rs, value) => word(0x0B, rs, rt, value);
const max = (rd, rs, rt) => (rs << 21 | rt << 16 | rd << 11 | 0x2C) >>> 0;
const ext = (rt, rs, position, size) => (0x1F << 26 | rs << 21 | rt << 16 | (size - 1) << 11 | position << 6) >>> 0;
const b = name => beq(ZERO, ZERO, name);

/** The functions, by name, in the order they're in the program. */
export const NAMES = ['start', 'sum', 'fill', 'lookup', 'twice', 'pick', 'bigger', 'middle', 'clock', 'half'];
/** The table `lookup` reads. */
export const VALUES = [11, 22, 33, 44];

/**
 * A second program, for the test of a game whose tasks are its parts (psp-parts.mjs): it sets the screen up, and each
 * frame counts the frame in memory, `count`, and paints the whole framebuffer, `paint`, a red that changes each frame,
 * `red`, for its first 59 frames, and a blue by another function, `blue`, from then on. So each part of its recording
 * runs functions the test knows. `start` is the program's start, which goes round that loop and never comes back.
 * { elf, at }, as madeUpPspTwin's.
 */
export function madeUpPspParts() {
  const VRAM = 0x04000000, WORDS = 512 * 272;
  const li32 = (rt, value) => [word(0x0F, 0, rt, value >>> 16), word(0x0D, rt, rt, value & 0xFFFF)];
  const sllv = (rd, rt, shift) => (rt << 16 | rd << 11 | shift << 6) >>> 0;
  const andi = (rt, rs, value) => word(0x0C, rs, rt, value);
  const or = (rd, rs, rt) => (rs << 21 | rt << 16 | rd << 11 | 0x25) >>> 0;
  const S1 = 17, A3 = 7;
  const code = [
    here('start'),
    addiu(A0, ZERO, 0), addiu(A1, ZERO, 480), addiu(A2, ZERO, 272), ...call('sceDisplaySetMode'),
    ...li32(A0, VRAM), addiu(A1, ZERO, 512), addiu(A2, ZERO, 3), addiu(A3, ZERO, 1), ...call('sceDisplaySetFrameBuf'),
    here('frame'),
    ...call('sceDisplayWaitVblankStart'),
    jal('count'), NOP,
    or(S1, V0, ZERO), sltiu(T0, S1, 60), beq(T0, ZERO, 'use blue'), or(A0, S1, ZERO),
    jal('red'), NOP, b('paint it'), NOP,
    here('use blue'), jal('blue'), NOP,
    here('paint it'), ...li32(A0, VRAM), ...li32(A1, WORDS), or(A2, V0, ZERO), jal('paint'), NOP,
    { jump: 2, name: 'frame' }, NOP,
    here('count'), ...la(T0, 'counter'), lw(V0, 0, T0), addiu(V0, V0, 1), jr(RA), sw(V0, 0, T0),
    here('red'), sllv(V0, A0, 2), andi(V0, V0, 0xFF), ...li32(T0, 0xFF000000), jr(RA), or(V0, V0, T0),
    here('blue'), sllv(V0, A0, 1), andi(V0, V0, 0xFF), sllv(V0, V0, 16), ...li32(T0, 0xFF000000), jr(RA), or(V0, V0, T0),
    here('paint'),
    here('paint loop'), beq(A1, ZERO, 'paint done'), NOP,
    sw(A2, 0, A0), addiu(A1, A1, -1), b('paint loop'), addiu(A0, A0, 4),
    here('paint done'), jr(RA), NOP,
  ];
  return pspProgram({
    code, name: 'parts', relocatable: true, sections: true,
    data: { counter: [0] },
    imports: ['sceDisplaySetMode', 'sceDisplaySetFrameBuf', 'sceDisplayWaitVblankStart'],
  });
}

/** The program: { elf, at }, `at` where each name is once the console has placed it. */
export function madeUpPspTwin() {
  const code = [
    here('start'), jr(RA), NOP,
    here('sum'), jr(RA), addu(V0, A0, A1),
    here('fill'),
    here('fill loop'), beq(A1, ZERO, 'fill done'), NOP,
    sb(A2, 0, A0), addiu(A1, A1, -1), b('fill loop'), addiu(A0, A0, 1),
    here('fill done'), jr(RA), NOP,
    here('lookup'), ...la(T0, 'values'), sll(T1, A0, 2), addu(T0, T0, T1), lw(V0, 0, T0), jr(RA), NOP,
    here('twice'), addiu(SP, SP, -16), sw(RA, 0, SP), jal('sum'), addu(A1, A0, ZERO), lw(RA, 0, SP), jr(RA), addiu(SP, SP, 16),
    here('pick'), sltiu(T0, A0, 3), beq(T0, ZERO, 'pick default'), sll(T1, A0, 2),
    ...la(T2, 'cases'), addu(T1, T1, T2), lw(T1, 0, T1), jr(T1), NOP,
    here('case 0'), jr(RA), addiu(V0, ZERO, 10),
    here('case 1'), jr(RA), addiu(V0, ZERO, 20),
    here('case 2'), jr(RA), addiu(V0, ZERO, 30),
    here('pick default'), jr(RA), addu(V0, ZERO, ZERO),
    here('bigger'), jr(RA), max(V0, A0, A1),
    here('middle'), jr(RA), ext(V0, A0, 4, 8),
    here('clock'), addiu(SP, SP, -16), sw(RA, 0, SP), ...call('sceKernelGetSystemTimeLow'), lw(RA, 0, SP), jr(RA), addiu(SP, SP, 16),
    // half: mov.s $f0, $f12 then a multiply by a half would do it; the check never calls it, so it only comes back
    here('half'), jr(RA), NOP,
  ];
  return pspProgram({
    code, name: 'twins', relocatable: true, sections: true,
    data: { values: VALUES, cases: [{ address: 'case 0' }, { address: 'case 1' }, { address: 'case 2' }] },
    imports: ['sceKernelGetSystemTimeLow'],
  });
}
