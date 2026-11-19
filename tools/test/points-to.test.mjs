// Where pointers can point (tools/lib/points-to.mjs), for the never-written check: made-up Thumb programs, each a
// function that reads a byte of the work memory and branches on it, and others that store through pointers the check
// could only follow by following them. Each is laid out by hand, as the console's compiler would.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANYWHERE, pointsTo } from '../lib/points-to.mjs';
import { neverWrittenBranch, writesOf } from '../lib/never-written.mjs';

const BASE = 0x08000000, FIELD = 0x02000010, OTHER = 0x02000080;

// a made-up cartridge: halfwords and words at offsets
function cartridge(parts) {
  const rom = new Uint8Array(0x100);
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

test('ARM code calls Thumb code through bx, and goes on when it gives back', () => {
  // Arm, 0x10, in ARM: ldr r4, =x   ldr r1, =Thumb + 1   mov lr, pc   bx r1   mov r1, #5   strb r1, [r4]   bx lr
  // Thumb, 0x40: bx lr, which keeps r4
  const program = x => cartridge([...CHECK, [0x10, 'w', 0xE59F4014, 0xE59F1014, 0xE1A0E00F, 0xE12FFF11, 0xE3A01005, 0xE5C41000, 0xE12FFF1E, x, BASE + 0x41], [0x40, 'h', 0x4770]]);
  const functions = [check, { address: BASE + 0x10, size: 0x34 }, { address: BASE + 0x40, size: 2 }];
  const apart = decide(program(OTHER), functions);
  assert.equal(apart.without.decided, undefined);
  assert.deepEqual([...apart.followed.stores.get(BASE + 0x24).base], [`c${OTHER}`], 'the ARM store after the call goes through r4, which the Thumb function kept');
  assert.equal(apart.with.decided?.way, 'not taken');
  assert.match(decide(program(FIELD), functions).with.cannot, /can hold 0x0, 0x5/);
});

test('an ARM store through a pointer kept at a fixed address', () => {
  // Arm, 0x10: ldr r0, =CELL   ldr r0, [r0]   mov r1, #5   strb r1, [r0]   bx lr       Init, 0x40, in Thumb: CELL = x
  const CELL = 0x02000040;
  const program = x => cartridge([...CHECK, [0x10, 'w', 0xE59F000C, 0xE5900000, 0xE3A01005, 0xE5C01000, 0xE12FFF1E, CELL],
    [0x40, 'h', 0x4801, 0x4902, 0x6001, 0x4770], [0x48, 'w', CELL, x]]);
  const functions = [check, { address: BASE + 0x10, size: 0x18 }, { address: BASE + 0x40, size: 0x10 }];
  assert.equal(decide(program(OTHER), functions).with.decided?.way, 'not taken');
  assert.match(decide(program(FIELD), functions).with.cannot, /can hold 0x0, 0x5/);
});

// Use, 0x40: ldr r0, =OTHER   mov r1, #5   strb r1, [r0]   bx lr, and a word of data, at 0x60, holding 0x08000043, an
// address in Use's middle
const USE = [[0x40, 'h', 0x4801, 0x2105, 0x7001, 0x4770], [0x48, 'w', OTHER], [0x60, 'w', BASE + 0x43]];
const use = { address: BASE + 0x40, size: 0x0C };

test('a word of data that holds an address in a function\'s middle, which no code jumps through, is data', () => {
  const found = decide(cartridge([...CHECK, ...USE]), [check, use]);
  assert.equal(found.with.decided?.way, 'not taken', 'Use\'s store stays where its pointer is');
  const word = found.followed.words.find(w => w.at === BASE + 0x60);
  assert.deepEqual(word, { at: BASE + 0x60, to: BASE + 0x42, verdict: 'data', why: 'no code the pass reads can carry it to the program counter' });
});

test('one a jump table carries to the program counter is a way in', () => {
  // Jumper, 0x70: ldr r0, =0x08000060   ldr r0, [r0]   mov pc, r0
  const found = decide(cartridge([...CHECK, ...USE, [0x70, 'h', 0x4801, 0x6800, 0x4687], [0x78, 'w', BASE + 0x60]]), [check, use, { address: BASE + 0x70, size: 0x0C }]);
  const word = found.followed.words.find(w => w.at === BASE + 0x60);
  assert.equal(word.verdict, 'target');
  assert.match(word.why, /the jump at 0x08000074 can carry it to the program counter/);
  assert.match(found.with.cannot, /writes through a pointer the check can't follow/, 'arriving there, the pass knows nothing of r0');
});

test('one code the pass can\'t read may load stays a possible way in', () => {
  const unreadable = { address: 0x03000000, size: 8, bytes: '00000000' };
  const found = decide(cartridge([...CHECK, ...USE]), [check, use, unreadable]);
  const word = found.followed.words.find(w => w.at === BASE + 0x60);
  assert.equal(word.verdict, 'open');
  assert.match(word.why, /code the pass can't read, such as 0x03000000, may load it/);
  assert.deepEqual(found.followed.unread, [0x03000000]);
  assert.equal(found.with.decided, undefined);
});

// Copies of the cartridge's code the game runs from its work memory, read where they run (#1547).
const words = (at, ...values) => [at, 'w', ...values];
const halves = (at, ...values) => [at, 'h', ...values];

test('a call into a copy of a helper that jumps through r0 keeps a register\'s known address', () => {
  // Caller, 0x00: push {r4, lr}   ldr r4, =CELL   ldr r0, =Target   bl Helper   mov r1, #5   str r1, [r4]   pop {r4, pc}
  // Helper, 0x20: bx r0       Target, 0x24: bx lr       and the game runs Caller and Helper from 0x02000000
  const CELL = 0x02000300;
  const rom = cartridge([halves(0x00, 0xB510, 0x4C03, 0x4803, ...bl(BASE + 0x06, BASE + 0x20), 0x2105, 0x6021, 0xBD10), words(0x10, CELL, BASE + 0x25),
    halves(0x20, 0x4700, 0x0000, 0x4770)]);
  const functions = [{ address: BASE, size: 0x18 }, { address: BASE + 0x20, size: 2 }, { address: BASE + 0x24, size: 2 }];
  const copies = [{ ram: 0x02000000, cartridge: BASE, size: 0x22 }];
  const read = pointsTo(rom, functions, { copies, seconds: 10 });
  assert.deepEqual([...read.stores.get(0x0200000C).base], [`c${CELL}`], 'r4 is kept across the copy, and on to Target, which keeps it');
  assert.equal(read.everywhere, false);
  const unread = pointsTo(rom, functions, { seconds: 10 });
  assert.equal(unread.stores.get(0x0200000C), undefined, 'with no copy named, the work memory\'s code isn\'t read at all');
});

// Two copies the game puts at 0x03000000 at different times, C and D, each with a helper 0x20 in, which give back 1
// and 2, and a caller, E, the game runs from 0x03000080, outside both:
// C, 0x40: push {r4, lr}   ldr r4, =CELL   bl 0x60   str r0, [r4]   pop {r4, pc}    0x60: mov r0, #1   bx lr
// D, 0x80: bx lr, and nothing to 0xA0: mov r0, #2   bx lr
// E, 0xC0: as C's caller, its call reaching 0x03000020 where it runs, and C's helper in the cartridge
const shared = () => {
  const CELL = 0x02000040;
  const caller = (at, to) => [halves(at, 0xB510, 0x4C03, ...bl(BASE + at + 4, BASE + to), 0x6020, 0xBD10), words(at + 0x10, CELL)];
  const rom = cartridge([...caller(0x40, 0x60), halves(0x60, 0x2001, 0x4770), halves(0x80, 0x4770), halves(0xA0, 0x2002, 0x4770), ...caller(0xC0, 0x60)]);
  const functions = [{ address: BASE + 0x40, size: 0x14 }, { address: BASE + 0x60, size: 4 }, { address: BASE + 0x80, size: 2 }, { address: BASE + 0xA0, size: 4 }, { address: BASE + 0xC0, size: 0x14 }];
  const copies = [{ ram: 0x03000000, cartridge: BASE + 0x40, size: 0x24 }, { ram: 0x03000000, cartridge: BASE + 0x80, size: 0x24 }, { ram: 0x03000080, cartridge: BASE + 0xC0, size: 0x14 }];
  return pointsTo(rom, functions, { copies, seconds: 10 });
};

test('two copies at one address: a call from inside one reaches only its own piece there', () => {
  // C's call, at 0x03000004, is in both copies with other bytes in D, so while it runs D isn't there
  assert.deepEqual([...shared().stores.get(0x03000008).value], ['c1']);
});

test('two copies at one address: a call from outside both reaches either, both joined', () => {
  const value = shared().stores.get(0x03000088).value;
  assert.deepEqual([...value].sort(), ['c1', 'c2'], 'E can find either helper at 0x03000020');
});

// Words stored on every way before, returns by pop and jump, and literal pools (#1549).
test('a word stored on every way before a load isn\'t its power-on 0 there, unless a way skips the store or a reset may clear it', () => {
  // ldr r0, =CELL   ldr r1, =OTHER   [beq over the store]   str r1, [r0]   ldr r2, [r0]   mov r3, #5   strb r3, [r2]   bx lr
  const CELL = 0x02000060;
  const surely = cartridge([halves(0x00, 0x4803, 0x4904, 0x6001, 0x6802, 0x2305, 0x7013, 0x4770), words(0x10, CELL, OTHER)]);
  const one = [{ address: BASE, size: 0x18 }];
  assert.deepEqual([...pointsTo(surely, one, { seconds: 10 }).stores.get(BASE + 0x0A).base], [`c${OTHER}`]);
  const maybe = cartridge([halves(0x00, 0x4803, 0x4904, 0xD000, 0x6001, 0x6802, 0x2305, 0x7013, 0x4770), words(0x10, CELL, OTHER)]);
  assert.deepEqual([...pointsTo(maybe, one, { seconds: 10 }).stores.get(BASE + 0x0C).base].sort(), ['c0', `c${OTHER}`].sort(), 'a way that skips the store still reads 0');
  // and RegisterRamReset of the slow work memory somewhere in the game: mov r0, #1   swi 1   bx lr
  const reset = cartridge([halves(0x00, 0x4803, 0x4904, 0x6001, 0x6802, 0x2305, 0x7013, 0x4770), words(0x10, CELL, OTHER), halves(0x20, 0x2001, 0xDF01, 0x4770)]);
  assert.deepEqual([...pointsTo(reset, [...one, { address: BASE + 0x20, size: 6 }], { seconds: 10 }).stores.get(BASE + 0x0A).base].sort(), ['c0', `c${OTHER}`].sort(), 'a reset may put the 0 back');
});

// a caller that keeps CELL in r4 across a call to `to`, then stores through it: push {r4, lr}   ldr r4, =CELL   bl to
// mov r1, #5   str r1, [r4]   pop {r4, pc}
const keeping = (at, to, cell) => [halves(at, 0xB510, 0x4C03, ...bl(BASE + at + 4, BASE + to), 0x2105, 0x6021, 0xBD10), words(at + 0x10, cell)];

test('a function that returns by popping its return address and jumping to it keeps what it doesn\'t write', () => {
  const CELL = 0x02000070;
  // Ret, 0x40: push {lr}   mov r0, #1   pop {r0}   bx r0       Ret2, 0x48: push {r4, lr}   mov r4, #9   pop {r4, pc}
  const rom = cartridge([...keeping(0x00, 0x40, CELL), ...keeping(0x20, 0x48, CELL), halves(0x40, 0xB500, 0x2001, 0xBC01, 0x4700), halves(0x48, 0xB510, 0x2409, 0xBD10)]);
  const functions = [{ address: BASE, size: 0x14 }, { address: BASE + 0x20, size: 0x14 }, { address: BASE + 0x40, size: 8 }, { address: BASE + 0x48, size: 6 }];
  const read = pointsTo(rom, functions, { seconds: 10 });
  assert.deepEqual([...read.stores.get(BASE + 0x0A).base], [`c${CELL}`], 'pop {r0}; bx r0 returns');
  assert.deepEqual([...read.stores.get(BASE + 0x2A).base], [`c${CELL}`], 'pop {r4, pc} returns, with r4 as it was');
});

test('a pop and jump that goes on elsewhere isn\'t a return: what it reaches may write anything', () => {
  const CELL = 0x02000070;
  // On, 0x40: ldr r0, =Clobber   push {r0}   pop {r0}   bx r0   .word Clobber       Clobber, 0x50: mov r4, #0   bx lr
  const rom = cartridge([...keeping(0x00, 0x40, CELL), halves(0x40, 0x4801, 0xB401, 0xBC01, 0x4700), words(0x48, BASE + 0x51), halves(0x50, 0x2400, 0x4770)]);
  const functions = [{ address: BASE, size: 0x14 }, { address: BASE + 0x40, size: 0x0C }, { address: BASE + 0x50, size: 4 }];
  assert.equal(pointsTo(rom, functions, { seconds: 10 }).stores.get(BASE + 0x0A).base, ANYWHERE);
});

test('a literal pool is data, not instructions that write registers', () => {
  const CELL = 0x02000070;
  // Pooled, 0x40: ldr r1, =0x0000FFFF   mov r0, #0   bx lr   .hword 0   .word 0x0000FFFF
  const rom = cartridge([...keeping(0x00, 0x40, CELL), halves(0x40, 0x4901, 0x2000, 0x4770, 0x0000), words(0x48, 0x0000FFFF)]);
  const functions = [{ address: BASE, size: 0x14 }, { address: BASE + 0x40, size: 0x0C }];
  assert.deepEqual([...pointsTo(rom, functions, { seconds: 10 }).stores.get(BASE + 0x0A).base], [`c${CELL}`]);
});

// Loops, their counters kept as ranges, widened at the loop's head and narrowed by its guard (#1551).
const range = (lo, hi, step) => `n${lo}:${hi}:${step}`;

test('a count-down loop with a signed guard against another register stays within it', () => {
  // ldr r1, =T   mov r2, #7   mov r0, #0x80   lsl r0, r0, #2   add r0, r0, r1
  // loop: str r2, [r0]   sub r0, #4   cmp r0, r1   bge loop   bx lr: 129 words from T + 0x200 down to T
  const T = 0x02000100;
  const rom = cartridge([halves(0x00, 0x4904, 0x2207, 0x2080, 0x0080, 0x1840, 0x6002, 0x3804, 0x4288, 0xDAFB, 0x4770), words(0x14, T)]);
  const read = pointsTo(rom, [{ address: BASE, size: 0x18 }], { seconds: 10 });
  assert.deepEqual([...read.stores.get(BASE + 0x0A).base], [range(T, T + 0x200, 4)]);
  assert.equal(read.everywhere, false);
});

test('a count-up loop with an unsigned guard against a number stays within it', () => {
  // ldr r1, =T   mov r2, #7   mov r0, #0   loop: lsl r3, r0, #2   add r3, r3, r1   str r2, [r3]   add r0, #1
  // cmp r0, #100   bcc loop   bx lr: words T to T + 99 * 4
  const T = 0x02000400;
  const rom = cartridge([halves(0x00, 0x4904, 0x2207, 0x2000, 0x0083, 0x185B, 0x601A, 0x3001, 0x2864, 0xD3F9, 0x4770), words(0x14, T)]);
  const read = pointsTo(rom, [{ address: BASE, size: 0x18 }], { seconds: 10 });
  assert.deepEqual([...read.stores.get(BASE + 0x0A).base], [range(T, T + 99 * 4, 4)]);
  assert.equal(read.everywhere, false);
});

test('a loop whose guard register is unknown stays open on that side', () => {
  // ldr r0, =T   mov r2, #7   loop: str r2, [r0]   sub r0, #4   cmp r0, r1   bge loop   bx lr, r1 an argument the
  // pass can't know: r0 steps down from T to wherever
  const T = 0x02000300;
  const rom = cartridge([halves(0x00, 0x4803, 0x2207, 0x6002, 0x3804, 0x4288, 0xDAFB, 0x4770), words(0x10, T)]);
  const read = pointsTo(rom, [{ address: BASE, size: 0x14 }], { seconds: 10 });
  assert.deepEqual([...read.stores.get(BASE + 0x04).base], [range(0, 0xFFFFFFFC, 4)], 'down from T past 0, as a signed guard against anything allows, every word the step reaches');
  assert.equal(read.unbounded, 1, 'and the store is one the pass can\'t bound');
});

test('nested loops: each counter within its own guard, the store within both', () => {
  // ldr r1, =T   mov r2, #7   mov r4, #0   outer: lsl r3, r4, #6   add r3, r3, r1   mov r0, #0
  // inner: lsl r5, r0, #2   add r5, r5, r3   str r2, [r5]   add r0, #1   cmp r0, #16   bcc inner
  // add r4, #1   cmp r4, #16   bcc outer   bx lr: 16 rows of 16 words from T
  const T = 0x02000800;
  const rom = cartridge([halves(0x00, 0x4907, 0x2207, 0x2400, 0x01A3, 0x185B, 0x2000, 0x0085, 0x18ED, 0x602A, 0x3001, 0x2810, 0xD3F9, 0x3401, 0x2C10, 0xD3F3, 0x4770), words(0x20, T)]);
  const read = pointsTo(rom, [{ address: BASE, size: 0x24 }], { seconds: 10 });
  assert.deepEqual([...read.stores.get(BASE + 0x10).base], [range(T, T + 15 * 64 + 15 * 4, 4)]);
  assert.equal(read.everywhere, false);
});

// Only the code a piece's flow reaches is read as instructions (#1553).
// F, 0x40: ldr r4, =CELL   mov r1, #5   str r1, [r4]   bx lr: its store bounded unless something arrives at 0x44
const CELL_F = 0x02000090;
const storer = [halves(0x40, 0x4C01, 0x2105, 0x6021, 0x4770), words(0x48, CELL_F)];
const storerF = { address: BASE + 0x40, size: 0x0C };

test('a header whose data decodes as a branch no longer splits the code after it', () => {
  // H, 0x00, ARM: b 0x20, then a header: a word that reads as b F + 4, and mov r0, r0 twice; 0x20: bx lr
  const rom = cartridge([words(0x00, 0xEA000006, 0xEA00000E, 0xE1A00000, 0xE1A00000), words(0x20, 0xE12FFF1E), ...storer]);
  const read = pointsTo(rom, [{ address: BASE, size: 0x24 }, storerF], { seconds: 10 });
  assert.deepEqual([...read.stores.get(BASE + 0x44).base], [`c${CELL_F}`]);
});

test('a jump through a register the scan can\'t place still reads all of its piece', () => {
  // J, 0x60: mov r0, #0   bx r0, and after it a halfword that reads as b F + 4, which the jump may reach
  const rom = cartridge([halves(0x60, 0x2000, 0x4700, 0xE7EE), ...storer]);
  const read = pointsTo(rom, [{ address: BASE + 0x60, size: 6 }, storerF], { seconds: 10 });
  assert.equal(read.stores.get(BASE + 0x44).base, ANYWHERE, 'so F may be arrived at mid-way, and is widened there');
});
