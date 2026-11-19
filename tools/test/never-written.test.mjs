// Branch ways a game never takes because nothing in it writes the value they go by (tools/lib/never-written.mjs).
// Made-up Thumb code stands in for a game's: one function reads a byte of the work memory and branches on it, and each
// made-up game is that function with others beside it, which write the byte or don't.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neverWrittenBranch, neverWrittenWhy, valuesAt, writesOf } from '../lib/never-written.mjs';

const BASE = 0x08000000, FIELD = 0x02000010;
const rom = new Uint8Array(0x70);
const put = (at, ...halfwords) => halfwords.forEach((h, i) => { rom[at + 2 * i] = h & 0xFF; rom[at + 2 * i + 1] = h >> 8; });
const word = (at, value) => { for (let i = 0; i < 4; i++) rom[at + i] = value >>> (8 * i) & 0xFF; };

// Check, 0x08000000: ldr r0, =FIELD   ldrb r1, [r0]   cmp r1, #0   beq +0   bx lr   bx lr
put(0x00, 0x4802, 0x7801, 0x2900, 0xD000, 0x4770, 0x4770);
word(0x0C, FIELD);
const CHECK = { address: BASE, size: 0x10 };
// SetFive, 0x08000010: ldr r0, =FIELD   mov r1, #5   strb r1, [r0]   bx lr
put(0x10, 0x4801, 0x2105, 0x7001, 0x4770);
word(0x18, FIELD);
const SET_FIVE = { address: BASE + 0x10, size: 0x0C };
// SetZero, 0x08000020: the same with 0
put(0x20, 0x4801, 0x2100, 0x7001, 0x4770);
word(0x28, FIELD);
const SET_ZERO = { address: BASE + 0x20, size: 0x0C };
// Poke, 0x08000030: strb r1, [r0], through whatever pointer it's given   bx lr
put(0x30, 0x7001, 0x4770);
const POKE = { address: BASE + 0x30, size: 4 };
// SetOther, 0x08000040: ldr r0, =FIELD + 4   mov r1, #5   strb r1, [r0], beside the byte and not on it
put(0x40, 0x4801, 0x2105, 0x7001, 0x4770);
word(0x48, FIELD + 4);
const SET_OTHER = { address: BASE + 0x40, size: 0x0C };
// Copy, 0x08000050: DMA channel 3's destination set to the byte, and a copy of one word started there:
// ldr r0, =0x040000D4   ldr r1, =FIELD   ldr r2, =0x84000001   str r1, [r0, #4]   str r2, [r0, #8]   bx lr
put(0x50, 0x4803, 0x4904, 0x4A04, 0x6041, 0x6082, 0x4770);
word(0x60, 0x040000D4);
word(0x64, FIELD);
word(0x68, 0x84000001);
const COPY = { address: BASE + 0x50, size: 0x1C };

const decide = functions => neverWrittenBranch(rom, functions, BASE + 6, writesOf(rom, functions));

test('a value nothing writes decides the branch that goes by it: it is always the console\'s 0', () => {
  const found = decide([CHECK]);
  assert.deepEqual(found.decided, { address: BASE + 6, way: 'not taken', from: BASE, fields: [{ address: FIELD, bytes: 1, values: [0] }] });
  assert.match(neverWrittenWhy(found.decided), /^The branch at 0x08000006 goes by the byte at 0x02000010, which no store, BIOS call or DMA of the game's code can set to anything but 0x0, .* never not taken in this game: never written\.$/);
  assert.ok(decide([CHECK, SET_OTHER]).decided, 'a write beside it, not on it, leaves it so');
});

test('one written only with 0 decides it too, and one written once with another number doesn\'t', () => {
  assert.equal(decide([CHECK, SET_ZERO]).decided?.way, 'not taken');
  const five = decide([CHECK, SET_FIVE]);
  assert.equal(five.decided, undefined);
  assert.match(five.cannot, /send it both ways: 0x02000010 can hold 0x0, 0x5/);
});

test('a write through a pointer the check can\'t follow leaves it undecided, and names the write', () => {
  const poked = decide([CHECK, POKE]);
  assert.equal(poked.decided, undefined);
  assert.match(poked.cannot, /the store at 0x08000030 writes through r0, a pointer the check can't follow/);
});

test('the BIOS and DMA are writes as much as the code\'s own', () => {
  // swi 0x0C, CpuFastSet, to a place the run doesn't know
  const bios = new Uint8Array(0x10);
  bios.set([0x0C, 0xDF, 0x70, 0x47]);
  assert.equal(writesOf(bios, [{ address: BASE, size: 4 }]).find(w => w.kind === 'unknown')?.at, BASE);
  // a fill of the fast work memory's top, as SoftReset does, is a write of 0 there
  bios.set([0x00, 0xDF, 0x70, 0x47]);
  const reset = writesOf(bios, [{ address: BASE, size: 4 }]);
  assert.deepEqual(valuesAt(0x03007F00, 4, reset).values, new Set([0]));
  // a DMA copy onto it puts there what the check doesn't follow
  assert.match(decide([CHECK, COPY]).cannot, /the write at 0x0800005A can put a value the check can't follow there|the write at 0x08000058 can put a value the check can't follow there/);
  // code the game runs from its work memory, and no copy of the cartridge's: its writes can't be read
  const ram = writesOf(rom, [CHECK, { address: 0x03000000, size: 8, bytes: '0000A0E1' }]);
  assert.match(valuesAt(FIELD, 1, ram).cannot, /runs from the work memory and isn't a copy of the cartridge's/);
});

test('a way the game never takes isn\'t followed, so the code only it reaches isn\'t asked for', async () => {
  const { instructionsOf, NOT_TAKEN, TAKEN } = await import('../lib/played.mjs');
  // cmp r1, #0   beq +2 (to 8)   mov r0, #1   bx lr   bx lr
  const code = Uint8Array.from([0x00, 0x29, 0x01, 0xD0, 0x01, 0x20, 0x70, 0x47, 0x70, 0x47]);
  assert.deepEqual([...instructionsOf(code).instructions].sort((a, b) => a - b), [0, 2, 4, 6, 8]);
  assert.deepEqual([...instructionsOf(code, [], new Map([[2, NOT_TAKEN]])).instructions].sort((a, b) => a - b), [0, 2, 8], 'never falling through: what follows the branch is out');
  assert.deepEqual([...instructionsOf(code, [], new Map([[2, TAKEN]])).instructions].sort((a, b) => a - b), [0, 2, 4, 6], 'never taken: its target is out');
});
