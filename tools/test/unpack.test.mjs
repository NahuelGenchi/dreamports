// Code a game has the BIOS unpack from the cartridge into its work memory (tools/gba/unpack.mjs): the BIOS's LZ77 and
// run-length formats, the code map's copies that say where such code comes from, and the points-to pass reading it.
// Everything here is made up, laid out by hand.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyBytes, unpack } from '../gba/unpack.mjs';
import { formatCodeMap, parseCodeMap } from '../lib/proof-files.mjs';
import { pointsTo } from '../lib/points-to.mjs';
import { neverWrittenBranch, writesOf } from '../lib/never-written.mjs';

const text = bytes => String.fromCharCode(...bytes);

test('the BIOS\'s LZ77: bytes as they are, and runs of what came before', () => {
  // ABC, then 6 bytes from 3 back, then D: flags 0b00010000 for the fourth of five being a run
  const packed = Uint8Array.from([0xFF, 0xFF, 0xFF, 0xFF, 0x10, 0x0A, 0x00, 0x00, 0x10, 0x41, 0x42, 0x43, 0x30, 0x02, 0x44]);
  const made = unpack('lz77', packed, 4);
  assert.equal(text(made.bytes), 'ABCABCABCD');
  assert.equal(made.read, 11);
  assert.equal(unpack('rl', packed, 4), null, 'not a run-length header');
  assert.equal(unpack('lz77', packed.subarray(0, 12), 4), null, 'data that stops short');
});

test('the BIOS\'s run-length: a byte over and over, and bytes as they are', () => {
  // 5 A's, then BCD as they are
  const made = unpack('rl', Uint8Array.from([0x30, 0x08, 0x00, 0x00, 0x82, 0x41, 0x02, 0x42, 0x43, 0x44]), 0);
  assert.equal(text(made.bytes), 'AAAAABCD');
  assert.equal(made.read, 10);
});

// a made-up cartridge: at 0x40 an LZ77 stream of every byte as it is, which unpacks to a Thumb function that stores 5
// at OTHER: ldr r0, =OTHER   mov r1, #5   str r1, [r0]   bx lr   .word OTHER
const OTHER = 0x02000100, FIELD = 0x02000110;
const program = [0x4801, 0x2105, 0x6001, 0x4770].flatMap(h => [h & 0xFF, h >> 8]).concat([0x00, 0x01, 0x00, 0x02]);
function cartridge(extra = []) {
  const rom = new Uint8Array(0x100);
  rom.set([0x10, program.length, 0x00, 0x00, 0x00, ...program.slice(0, 8), 0x00, ...program.slice(8)], 0x40);
  for (const [at, bytes] of extra) rom.set(bytes, at);
  return rom;
}
const key = bytes => Array.from(bytes.slice(0, 8), b => b.toString(16).toUpperCase().padStart(2, '0')).join('');

test('a code map\'s unpacked copy is read and written back, and holds what the BIOS makes', () => {
  const map = parseCodeMap({ original: 'x', from: 'y', functions: [['02000000/' + key(program), 12]], copies: [['02000000', '08000040', 12, 'lz77'], ['03000000', '08000040', 4, 'lz77', 8]] });
  assert.deepEqual(map.copies, [{ ram: 0x02000000, cartridge: 0x08000040, size: 12, packed: 'lz77' }, { ram: 0x03000000, cartridge: 0x08000040, size: 4, packed: 'lz77', from: 8 }]);
  assert.match(formatCodeMap(map), /\["02000000","08000040",12,"lz77"\],\n {4}\["03000000","08000040",4,"lz77",8\]/);
  const rom = cartridge();
  assert.deepEqual([...copyBytes(rom, map.copies[0])], program);
  assert.deepEqual([...copyBytes(rom, map.copies[1])], [0x00, 0x01, 0x00, 0x02], 'and one copied on, from as far in as it says');
});

test('the pass reads a function from what the BIOS unpacks, and not one whose bytes the copy doesn\'t have', () => {
  const rom = cartridge();
  const copies = [{ ram: 0x02000000, cartridge: 0x08000040, size: 12, packed: 'lz77' }];
  const read = pointsTo(rom, [{ address: 0x02000000, size: 12, bytes: key(program) }], { copies, seconds: 10 });
  assert.deepEqual(read.unread, []);
  assert.deepEqual([...read.stores.get(0x02000004).base], [`c${OTHER}`], 'its store goes where its own pool says');
  assert.equal(read.everywhere, false);
  const other = pointsTo(rom, [{ address: 0x02000000, size: 12, bytes: '0000000000000000' }], { copies, seconds: 10 });
  assert.deepEqual(other.unread, [0x02000000], 'other code at that address at another time is code it can\'t read');
  assert.equal(other.everywhere, true);
});

test('an unpack from the cartridge writes as far as its header says, and the check counts it there', () => {
  // Check, 0x00: ldr r0, =FIELD   ldrb r1, [r0]   cmp r1, #0   beq +0   bx lr   bx lr
  // Unpack, 0x10: ldr r0, =0x08000040   ldr r1, =to   swi 0x11   bx lr
  const check = [0x4802, 0x7801, 0x2900, 0xD000, 0x4770, 0x4770].flatMap(h => [h & 0xFF, h >> 8]);
  const word = w => [w & 0xFF, w >>> 8 & 0xFF, w >>> 16 & 0xFF, w >>> 24];
  const unpacking = to => cartridge([[0x00, check], [0x0C, word(FIELD)], [0x10, [0x01, 0x48, 0x02, 0x49, 0x11, 0xDF, 0x70, 0x47]], [0x18, [...word(0x08000040), ...word(to)]]]);
  const functions = [{ address: 0x08000000, size: 0x10 }, { address: 0x08000010, size: 0x10 }];
  const decide = rom => {
    const followed = pointsTo(rom, functions, { seconds: 10 });
    assert.equal(followed.everywhere, false, 'the unpack writes where the pass can bound');
    assert.deepEqual(followed.swis.get(0x08000014).wrote, [{ from: rom[0x1C] | rom[0x1D] << 8 | 0x02000000, size: 12 }]);
    return neverWrittenBranch(rom, functions, 0x08000006, writesOf(rom, functions, [], followed), followed);
  };
  assert.equal(decide(unpacking(0x02000200)).decided?.way, 'not taken', 'elsewhere, it leaves the byte the console\'s 0');
  assert.match(decide(unpacking(FIELD - 4)).cannot, /can put a value the check can't follow there/, 'on it, it counts');
});
