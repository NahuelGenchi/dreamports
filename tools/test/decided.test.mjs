// The branches the code itself decides (tools/lib/decided.mjs): worked out from a function's bytes alone, and only where
// nothing else can arrive in the run of instructions that sets the flags. Made-up Thumb code stands in for a game's.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrivals, decidedBranches, decidedIn, holds, step } from '../lib/decided.mjs';

const BASE = 0x08000000;
const thumb = (...ops) => Uint8Array.from(ops.flatMap(op => [op & 0xFF, op >> 8]));
const none = new Set(), word = () => null;
const state = () => ({ r: new Array(16).fill(null), n: null, z: null, c: null, v: null });

test('a comparison of two numbers in the code decides its branch, and says which way can\'t happen', () => {
  // mov r0, #4   lsl r0, r0, #16   lsr r0, r0, #16   cmp r0, #0   beq +4   bx lr   bx lr
  const code = thumb(0x2004, 0x0400, 0x0C00, 0x2800, 0xD000, 0x4770, 0x4770);
  assert.deepEqual(decidedIn(code, BASE, word, none), [{ address: BASE + 8, way: 'taken', from: BASE, by: BASE + 6 }]);
  // the same with 0: it's always taken
  assert.equal(decidedIn(thumb(0x2000, 0x2800, 0xD000, 0x4770, 0x4770), BASE, word, none)[0].way, 'not taken');
});

test('a value read from memory, what a call gave back, or where the code is decides nothing', () => {
  // ldr r0, [r1]   cmp r0, #0   beq
  assert.deepEqual(decidedIn(thumb(0x6808, 0x2800, 0xD000, 0x4770, 0x4770), BASE, word, none), []);
  // mov r0, #1   bl   cmp r0, #1   beq: the call may have changed r0
  assert.deepEqual(decidedIn(thumb(0x2001, 0xF000, 0xF800, 0x2801, 0xD000, 0x4770, 0x4770), BASE, word, none), []);
  // mov r2, pc   lsr r2, r2, #24   cmp r2, #8   beq: a copy in the work RAM runs it elsewhere
  assert.deepEqual(decidedIn(thumb(0x467A, 0x0E12, 0x2A08, 0xD000, 0x4770, 0x4770), BASE, word, none), []);
  // mov r0, #0, which leaves the carry as it was, then bcs
  assert.deepEqual(decidedIn(thumb(0x2000, 0xD200, 0x4770, 0x4770), BASE, word, none), []);
});

test('nothing is decided past a place something else can arrive at', () => {
  const code = thumb(0x2004, 0x2800, 0xD000, 0x4770, 0x4770);
  assert.equal(decidedIn(code, BASE, word, none).length, 1);
  assert.deepEqual(decidedIn(code, BASE, word, new Set([BASE + 2])), [], 'a branch from elsewhere lands on the comparison');
  assert.deepEqual(decidedIn(code, BASE, word, new Set([BASE + 4])), [], 'or on the branch itself');
  assert.equal(decidedIn(code, BASE, word, new Set([BASE])).length, 1, 'arriving at the run\'s start is arriving through all of it');
  // cmp r0, #0   beq +0 (to 4)   mov r0, #4   cmp r0, #0   beq: the first branch's target is inside the run
  const rom = thumb(0x2800, 0xD0FF, 0x2004, 0x2800, 0xD000, 0x4770, 0x4770, 0x0000);
  assert.ok(arrivals(rom, [{ address: BASE, size: 14 }]).has(BASE + 4));
  // a word of the cartridge that holds an address in the run stops it too
  const pointed = new Uint8Array(16);
  pointed.set(thumb(0x2004, 0x2800, 0xD000, 0x4770, 0x4770));
  new DataView(pointed.buffer).setUint32(12, BASE + 2 + 1, true);
  assert.deepEqual(decidedBranches(pointed, [{ address: BASE, size: 10 }]), []);
  new DataView(pointed.buffer).setUint32(12, 0x03000000, true);
  assert.equal(decidedBranches(pointed, [{ address: BASE, size: 10 }]).length, 1);
});

test('the numbers beside the code are read, and the flags are the processor\'s', () => {
  const s = state();
  step(s, 0x4801, BASE, () => 0x12345678);   // ldr r0, [pc, #4]
  assert.equal(s.r[0], 0x12345678);
  step(s, 0x2805, BASE, word);               // cmp r0, #5
  assert.deepEqual([s.n, s.z, s.c, s.v], [false, false, true, false]);
  assert.equal(holds(0x8, s), true, 'higher');
  assert.equal(holds(0xB, s), false, 'not less');
  const t = state();
  step(t, 0x2000, BASE, word);               // mov r0, #0
  step(t, 0x3801, BASE, word);               // sub r0, #1
  assert.equal(t.r[0], 0xFFFFFFFF);
  assert.deepEqual([t.n, t.z, t.c, t.v], [true, false, false, false]);
  assert.equal(holds(0xB, t), true, 'less, as a signed number');
  assert.equal(holds(0x3, t), true, 'and it borrowed');
  assert.equal(holds(0xA, { n: null, z: false, c: true, v: false }), null, 'a flag not known decides nothing');
});
