// The branches a reading across a whole function decides (tools/lib/decided-across.mjs), through a table in the
// cartridge at an index of a few bits and through the function's own stack across a loop, and the words pointing into
// a function's middle that may be set aside (tools/lib/words-into.mjs). Made-up Thumb code and data stand in for a
// game's.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidedAcross } from '../lib/decided-across.mjs';
import { wordsSetAside } from '../lib/words-into.mjs';

const BASE = 0x08000000;
// a made-up cartridge: halfwords of code from 0, then words and bytes where they're put
function cartridge(code, size = 0x100) {
  const rom = new Uint8Array(size), view = new DataView(rom.buffer);
  code.forEach((op, i) => view.setUint16(2 * i, op, true));
  return { rom, view, word: (at, value) => view.setUint32(at, value >>> 0, true), bytes: (at, list) => rom.set(list, at) };
}
const decided = (made, size, targets = new Map(), options = {}) => decidedAcross(made.rom.subarray(0, size), BASE, made.rom, targets, options).map(d => [d.address - BASE, d.way]);

// ldrh r0, [r1]   mov r2, #3   and r2, r0   ldr r3, =table   add r3, r3, r2   ldrb r0, [r3]   cmp r0, #0   beq   bx lr
// bx lr, then the table's address at 0x14 and the table at 0x18
const LOOKUP = [0x8808, 0x2203, 0x4002, 0x4B03, 0x189B, 0x7818, 0x2800, 0xD000, 0x4770, 0x4770];
function lookup(table) {
  const made = cartridge(LOOKUP);
  made.word(0x14, BASE + 0x18);
  made.bytes(0x18, table);
  return made;
}

test('a byte of a table at an index of two bits decides a branch when none of the four is 0', () => {
  assert.deepEqual(decided(lookup([1, 2, 3, 4]), 0x14), [[0x0E, 'taken']]);
  assert.deepEqual(decided(lookup([1, 0, 3, 4]), 0x14), [], 'one of them 0: either way');
});

test('two bytes read at the same index stay together', () => {
  // ldrh r0, [r1]   mov r2, #3   and r2, r0   lsl r2, r2, #1   ldr r3, =pairs   add r3, r3, r2   ldrb r0, [r3]
  // ldrb r4, [r3, #1]   cmp r4, #0   beq 0x1C   cmp r0, #0   beq 0x1A   bx lr   bx lr   bx lr: a width of 0 only with a
  // height of 0, which goes the other way first
  const made = cartridge([0x8808, 0x2203, 0x4002, 0x0052, 0x4B05, 0x189B, 0x7818, 0x785C, 0x2C00, 0xD003, 0x2800, 0xD000, 0x4770, 0x4770, 0x4770]);
  made.word(0x20, BASE + 0x24);
  made.bytes(0x24, [8, 8, 16, 8, 0, 0, 8, 16]);
  assert.deepEqual(decided(made, 0x20), [[0x16, 'taken']]);
  made.bytes(0x24, [8, 8, 16, 8, 0, 4, 8, 0]);
  assert.deepEqual(decided(made, 0x20), [], 'a width of 0 with a height of 4, and a height of 0: either way, both');
});

// push {lr}   sub sp, #8   ldrh r0, [r1]   mov r2, #3   and r2, r0   ldr r3, =table   add r3, r3, r2   ldrb r0, [r3]
// str r0, [sp, #4]   mov r5, #4   ldr r6, =0x06000000, then a loop: strh r0, [r6]   add r6, #2   ldr r0, [sp, #4]
// cmp r0, #0   beq out   sub r5, #1   cmp r5, #0   bne loop; out: add sp, #8   pop {pc}; the numbers at 0x2C and 0x30, the
// table at 0x34. `pointer`, when given, replaces the load of the video memory's address with a load through r1.
function slotAcrossALoop({ pointer = false, call = false } = {}) {
  const code = [0xB500, 0xB082, 0x8808, 0x2203, 0x4002, 0x4B08, 0x189B, 0x7818, 0x9001, 0x2504, pointer ? 0x684E : 0x4E06,
    0x8030, 0x3602, 0x9801, 0x2800, 0xD003, 0x3D01, 0x2D00, 0xD1F7, 0x46C0, 0xB002, 0xBD00];
  // a call out of the function, in the place of the store and the add
  if (call) code.splice(11, 2, 0xF000, 0xF873);
  const made = cartridge(code);
  made.word(0x2C, BASE + 0x34);
  made.word(0x30, 0x06000000);
  made.bytes(0x34, [1, 2, 3, 4]);
  return made;
}

test('a value kept on the stack across a loop that writes the video memory still decides', () => {
  assert.deepEqual(decided(slotAcrossALoop(), 0x2C), [[0x1E, 'taken']]);
});

test('a write through a pointer the code can\'t follow, or a call, in the loop leaves the slot unknown', () => {
  assert.deepEqual(decided(slotAcrossALoop({ pointer: true }), 0x2C), []);
  assert.deepEqual(decided(slotAcrossALoop({ call: true }), 0x2C).filter(([at]) => at === 0x1E), []);
});

test('something arriving in the loop from elsewhere leaves it undecided, unless it\'s a word set aside', () => {
  const made = slotAcrossALoop();
  const into = new Map([[BASE + 0x16, new Set(['word'])]]);
  assert.deepEqual(decided(made, 0x2C, into), []);
  assert.deepEqual(decided(made, 0x2C, into, { aside: new Map([[BASE + 0x16, [{ at: BASE + 0xC0, value: BASE + 0x17 }]]]) }), [[0x1E, 'taken']]);
  const from = new Map([[BASE + 0x16, new Set([BASE + 0x80])]]);
  assert.deepEqual(decided(made, 0x2C, from, { aside: new Map([[BASE + 0x16, [{ at: BASE + 0xC0, value: BASE + 0x17 }]]]) }), [], 'a branch from another function isn\'t a word');
});

test('a DMA the function starts onto its slot leaves it unknown, and one onto the video memory doesn\'t', () => {
  // the loop of slotAcrossALoop with its strh replaced by a DMA of channel 3 to r6: ldr r7, =0x040000D4   str r6, [r7, #4]
  // ldr r4, =0x80000001   str r4, [r7, #8], and r6 the video memory's or the slot's place
  const build = ontoSlot => {
    const code = [0xB500, 0xB082, 0x8808, 0x2203, 0x4002, 0x4B0B, 0x189B, 0x7818, 0x9001, 0x2504, ontoSlot ? 0xAE01 : 0x4E09,
      0x4F0A, 0x607E, 0x4C0A, 0x60BC, 0x9801, 0x2800, 0xD003, 0x3D01, 0x2D00, 0xD1F5, 0x46C0, 0xB002, 0xBD00];
    const made = cartridge(code);
    made.word(0x38, BASE + 0x48);
    made.word(0x3C, 0x06000000);
    made.word(0x40, 0x040000D4);
    made.word(0x44, 0x80000001);
    made.bytes(0x48, [1, 2, 3, 4]);
    return made;
  };
  assert.deepEqual(decided(build(false), 0x30), [[0x22, 'taken']]);
  assert.deepEqual(decided(build(true), 0x30), []);
});

test('an inner loop read a turn at a time inside an outer one of many turns keeps the slot across both', () => {
  // push {lr}   sub sp, #8   ldrh r0, [r1]   mov r2, #3   and r2, r0   ldr r3, =table   add r3, r3, r2   ldrb r0, [r3]
  // str r0, [sp, #4]   mov r5, #0; outer: ldr r6, =0x06000000   mov r4, #4; inner: strh r0, [r6]   add r6, #2
  // ldr r0, [sp, #4]   cmp r0, #0   beq out   sub r4, #1   cmp r4, #0   bne inner   add r5, #1   cmp r5, #200   bcc outer;
  // out: add sp, #8   pop {pc}. The outer loop's 200 turns pass the ways a place keeps apart, the inner loop's 4 don't:
  // the inner loop's place in the video memory stays where its 4 turns take it, and nothing reaches the stack
  const made = cartridge([0xB500, 0xB082, 0x8808, 0x2203, 0x4002, 0x4B0A, 0x189B, 0x7818, 0x9001, 0x2500, 0x4E08, 0x2404,
    0x8030, 0x3602, 0x9801, 0x2800, 0xD006, 0x3C01, 0x2C00, 0xD1F7, 0x3501, 0x2DC8, 0xD3F2, 0x46C0, 0xB002, 0xBD00]);
  made.word(0x34, BASE + 0x3C);
  made.word(0x38, 0x06000000);
  made.bytes(0x3C, [1, 2, 3, 4]);
  assert.deepEqual(decided(made, 0x34), [[0x20, 'taken']]);
  made.bytes(0x3C, [1, 0, 3, 4]);
  assert.deepEqual(decided(made, 0x34), [], 'one of them 0: either way');
});

test('a word into a function\'s middle is set aside only when nothing in the cartridge refers to it', () => {
  const made = cartridge([0x2000, 0x2800, 0xD000, 0x4770, 0x4770], 0x200);
  const functions = [{ address: BASE, size: 0x0A }];
  made.word(0x100, BASE + 0x05);
  assert.deepEqual([...wordsSetAside(made.rom, functions)], [[BASE + 0x04, [{ at: BASE + 0x100, value: BASE + 0x05 }]]]);
  // even, it isn't a Thumb address
  made.word(0x100, BASE + 0x04);
  assert.equal(wordsSetAside(made.rom, functions).size, 0);
  // beside another address, it's in a table of them
  made.word(0x100, BASE + 0x05);
  made.word(0x104, BASE + 0x1F0);
  assert.equal(wordsSetAside(made.rom, functions).size, 0);
  // a word holding its address refers to it
  made.word(0x104, 0);
  made.word(0x180, BASE + 0x100);
  assert.equal(wordsSetAside(made.rom, functions).size, 0);
});
