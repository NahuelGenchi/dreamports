// Where pointers can point (tools/lib/points-to.mjs), for the never-written check: made-up Thumb programs, each a
// function that reads a byte of the work memory and branches on it, and others that store through pointers the check
// could only follow by following them. Each is laid out by hand, as the console's compiler would.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointsTo } from '../lib/points-to.mjs';
import { neverWrittenBranch, writesOf } from '../lib/never-written.mjs';

const BASE = 0x08000000, FIELD = 0x02000010, OTHER = 0x02000080;

// a made-up cartridge: halfwords and words at offsets
function cartridge(parts) {
  const rom = new Uint8Array(0x60);
  for (const [at, kind, ...values] of parts) {
    values.forEach((v, i) => {
      if (kind === 'h') { rom[at + 2 * i] = v & 0xFF; rom[at + 2 * i + 1] = v >> 8; } else for (let b = 0; b < 4; b++) rom[at + 4 * i + b] = v >>> (8 * b) & 0xFF;
    });
  }
  return rom;
}
// a call from `from` to `to`, as its two halves
const bl = (from, to) => { const off = to - (from + 4); return [0xF000 | ((off >> 12) & 0x7FF), 0xF800 | ((off >> 1) & 0x7FF)]; };
// Check, 0x08000000: ldr r0, =FIELD   ldrb r1, [r0]   cmp r1, #0   beq +0   bx lr   bx lr
const CHECK = [[0x00, 'h', 0x4802, 0x7801, 0x2900, 0xD000, 0x4770, 0x4770], [0x0C, 'w', FIELD]];
const check = { address: BASE, size: 0x10 };

// the never-written check on Check's branch, with the pass and without it
function decide(rom, functions, allocators = new Map()) {
  const followed = pointsTo(rom, functions, { allocators, seconds: 10 });
  assert.ok(followed.complete, 'the pass finishes within its limit');
  const without = neverWrittenBranch(rom, functions, BASE + 6, writesOf(rom, functions));
  const withPass = neverWrittenBranch(rom, functions, BASE + 6, writesOf(rom, functions, [], followed), followed);
  return { without, with: withPass, followed };
}

test('a store through a pointer kept at a fixed address goes where that pointer can point', () => {
  // Init, 0x10: ldr r0, =CELL   ldr r1, =x   str r1, [r0]   bx lr       Use, 0x20: ldr r0, =CELL   ldr r0, [r0]
  // mov r1, #5   strb r1, [r0]   bx lr
  const CELL = 0x02000040;
  const program = x => cartridge([...CHECK, [0x10, 'h', 0x4801, 0x4902, 0x6001, 0x4770], [0x18, 'w', CELL, x],
    [0x20, 'h', 0x4802, 0x6800, 0x2105, 0x7001, 0x4770], [0x2C, 'w', CELL]]);
  const functions = [check, { address: BASE + 0x10, size: 0x10 }, { address: BASE + 0x20, size: 0x10 }];
  const elsewhere = decide(program(OTHER), functions);
  assert.match(elsewhere.without.cannot, /0x08000026 writes through r0, a pointer the check can't follow/);
  assert.equal(elsewhere.with.decided?.way, 'not taken', 'the pointer is only ever 0 or OTHER, neither the byte Check reads');
  const there = decide(program(FIELD), functions);
  assert.match(there.with.cannot, /send it both ways: 0x02000010 can hold 0x0, 0x5/, 'and when it can be the byte, the store through it counts');
});

test('a store through a struct pointer plus an offset, the pointer given as an argument', () => {
  // Caller, 0x10: push {lr}   ldr r0, =s   bl Set   pop {pc}       Set, 0x20: mov r1, #5   strb r1, [r0, #12]   bx lr
  const program = s => cartridge([...CHECK, [0x10, 'h', 0xB500, 0x4802, ...bl(BASE + 0x14, BASE + 0x20), 0xBD00], [0x1C, 'w', s],
    [0x20, 'h', 0x2105, 0x7301, 0x4770]]);
  const functions = [check, { address: BASE + 0x10, size: 0x10 }, { address: BASE + 0x20, size: 8 }];
  const apart = decide(program(OTHER), functions);
  assert.equal(apart.without.decided, undefined);
  assert.equal(apart.with.decided?.way, 'not taken', 'the struct is elsewhere');
  assert.deepEqual([...apart.followed.stores.get(BASE + 0x22).base], [`c${OTHER}`], 'and the pass says where Set\'s pointer is');
  assert.match(decide(program(FIELD - 12), functions).with.cannot, /can hold 0x0, 0x5/, 'twelve bytes on from it is the byte, and that counts');
});

test('a store through what an allocator gives stays in its arena', () => {
  // Caller, 0x10: push {lr}   bl Alloc   mov r1, #5   strb r1, [r0, #4]   pop {pc}       Alloc, 0x30: ldr r0, =ARENA   bx lr
  const ARENA = 0x02000200;
  const rom = cartridge([...CHECK, [0x10, 'h', 0xB500, ...bl(BASE + 0x12, BASE + 0x30), 0x2105, 0x7101, 0xBD00], [0x30, 'h', 0x4800, 0x4770], [0x34, 'w', ARENA]]);
  const functions = [check, { address: BASE + 0x10, size: 0x10 }, { address: BASE + 0x30, size: 8 }];
  const outside = decide(rom, functions, new Map([[BASE + 0x30, { from: ARENA, to: ARENA + 0x100 }]]));
  assert.equal(outside.with.decided?.way, 'not taken');
  assert.ok([...outside.followed.stores.get(BASE + 0x18).base].every(e => e.startsWith('h')), 'the object is the allocator\'s, kept apart by the call that made it');
  const inside = decide(rom, functions, new Map([[BASE + 0x30, { from: 0x02000000, to: 0x02000100 }]]));
  assert.match(inside.with.cannot, /0x02000010/, 'with the byte in the arena, it can\'t be decided');
});

test('a pointer kept in a register across a call that keeps it', () => {
  // Caller, 0x10: push {r4, lr}   ldr r4, =x   bl Callee   mov r1, #5   strb r1, [r4]   pop {r4, pc}
  // Callee, 0x30: bx lr, or mov r4, #0 first, which writes r4 and doesn't keep it
  const program = clobbers => cartridge([...CHECK, [0x10, 'h', 0xB510, 0x4C02, ...bl(BASE + 0x14, BASE + 0x30), 0x2105, 0x7021, 0xBD10], [0x20, 'w', OTHER],
    [0x30, 'h', ...(clobbers ? [0x2400, 0x4770] : [0x4770, 0x4770])]]);
  const functions = [check, { address: BASE + 0x10, size: 0x14 }, { address: BASE + 0x30, size: 4 }];
  assert.equal(decide(program(false), functions).with.decided?.way, 'not taken');
  assert.match(decide(program(true), functions).with.cannot, /writes through a pointer the check can't follow/, 'a callee that writes r4 without keeping it leaves r4 unknown');
});

test('an address made from data it can\'t know stays "can\'t decide"', () => {
  // Writer, 0x10, whose address the cartridge keeps, so anything may call it: ldr r1, =CELL   strb r0, [r1]   bx lr
  // Use, 0x20: ldr r0, =CELL   ldrb r0, [r0]   ldr r1, =TABLE   add r1, r1, r0   mov r2, #5   strb r2, [r1]   bx lr
  const CELL = 0x02000040, TABLE = 0x02000080;
  const rom = cartridge([...CHECK, [0x10, 'h', 0x4901, 0x7008, 0x4770], [0x18, 'w', CELL],
    [0x20, 'h', 0x4802, 0x7800, 0x4902, 0x1809, 0x2205, 0x700A, 0x4770], [0x30, 'w', CELL, TABLE, BASE + 0x11]]);
  const functions = [check, { address: BASE + 0x10, size: 0x0C }, { address: BASE + 0x20, size: 0x18 }];
  const found = decide(rom, functions);
  assert.equal(found.with.decided, undefined);
  assert.match(found.with.cannot, /writes through a pointer the check can't follow/);
  assert.ok(found.followed.unbounded >= 1 && found.followed.bounded >= 1, 'and the pass counts what it bounded and what it couldn\'t');
});
