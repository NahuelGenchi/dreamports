// How a code map holds the code a game runs from its work RAM (lib/proof-files.mjs, codemap.mjs), with made-up code
// that has nothing from any game in it.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatCodeMap, parseCodeMap, watchesOf } from '../lib/proof-files.mjs';
import { findInMemory, withLongJumps } from '../gba/functions.mjs';
import { splitAt, startsFromPlay } from '../codemap.mjs';

const halfwords = list => Buffer.from(Uint16Array.from(list).buffer);

test('a function in the work RAM is known by its address and its first 8 bytes, and a copy by where it runs', () => {
  const text = formatCodeMap({
    original: 'a'.repeat(40), from: 'Made up',
    functions: [{ address: 0x02000000, size: 8, bytes: '00B5FFF7FEFF00BD' }, { address: 0x08000000, size: 4 }, { address: 0x080000C0, size: 64, name: 'start' }],
    copies: [{ ram: 0x03000000, cartridge: 0x080000C0, size: 64 }],
  });
  assert.match(text, /\["02000000\/00B5FFF7FEFF00BD",8\]/);
  assert.match(text, /"copies": \[\n {4}\["03000000","080000C0",64\]/);
  const map = parseCodeMap(JSON.parse(text));
  assert.deepEqual(map.functions.map(f => [f.key, f.address, f.size, f.bytes, f.name]), [
    ['02000000/00B5FFF7FEFF00BD', 0x02000000, 8, '00B5FFF7FEFF00BD', undefined],
    ['08000000', 0x08000000, 4, undefined, undefined],
    ['080000C0', 0x080000C0, 64, undefined, 'start'],
  ]);
  assert.deepEqual(map.copies, [{ ram: 0x03000000, cartridge: 0x080000C0, size: 64 }]);
});

test('a function runs where it is, and where a copy of it is, with its bytes', () => {
  const map = parseCodeMap({ functions: [['02000000/0102030405060708', 8], ['08000010', 16], ['08000100', 4]], copies: [['03000000', '08000000', 32]] });
  const cartridge = (address, count) => Buffer.from(Array.from({ length: count }, (_, i) => (address + i) & 0xFF));
  assert.deepEqual(watchesOf(map, cartridge), [
    { address: 0x02000000, size: 8, index: 0, bytes: [0x04030201, 0x08070605] },
    { address: 0x08000010, size: 16, index: 1 },
    { address: 0x08000100, size: 4, index: 2 },
    // only the function the copy holds, where the copy runs, as long as the copy's left of it
    { address: 0x03000010, size: 16, index: 1, bytes: [0x13121110, 0x17161514] },
  ]);
});

test('the functions of code that ran in memory are those it starts in and calls', () => {
  // at 0x02000000: PUSH {lr}, BL 0x0200000C, POP {pc}, a word of data, then MOVS r0, #1 and BX lr
  const bytes = halfwords([0xB500, 0xF000, 0xF803, 0xBD00, 0x0000, 0x0000, 0x2001, 0x4770]);
  const ran = [0x02000000, 0x02000002, 0x0200000C, 0x0200000E].map(address => ({ address, thumb: true }));
  assert.deepEqual(findInMemory(bytes, 0x02000000, ran).map(f => [f.address, f.size]), [[0x02000000, 8], [0x0200000C, 4]]);
  // a function nothing calls that ran, as from an address in a table, is one too
  assert.deepEqual(findInMemory(bytes, 0x02000000, [{ address: 0x0200000C, thumb: true }]).map(f => [f.address, f.size]), [[0x0200000C, 4]]);
});

test('a copy splits the cartridge function it shows starts partway', () => {
  const functions = [{ address: 0x08001000, size: 0x100 }, { address: 0x08002000, size: 0x10 }];
  assert.deepEqual(splitAt(functions, [{ address: 0x08001040, size: 0x20 }, { address: 0x08002000, size: 0x10 }, { address: 0x08003000, size: 0x30 }]), [
    { address: 0x08001000, size: 0x40 },
    { address: 0x08001040, size: 0xC0 },
    { address: 0x08002000, size: 0x10 },
    { address: 0x08003000, size: 0x30 },
  ]);
});

test('what play sends an NES game\'s processor to starts a function where the map has none', () => {
  // a program of 0x40 bytes with a JSR at 0x05, so 0x08 is where that call comes back to
  const prg = new Uint8Array(0x40);
  prg[0x05] = 0x20;
  const functions = [{ address: 0x00, size: 0x10 }, { address: 0x20, size: 0x08 }];
  const sent = [
    { address: 0x20, way: 'called' },     // a function the map has
    { address: 0x0C, way: 'called' },     // called inside one: it starts a function there
    { address: 0x0E, way: 'jumped' },     // jumped to inside one: that function's own code
    { address: 0x30, way: 'jumped' },     // jumped to outside every function
    { address: 0x08, way: 'returned' },   // where a call came back
    { address: 0x24, way: 'returned' },   // returned to inside one, not after a call: its own code
    { address: 0x38, way: 'returned' },   // an address a routine pushed, outside every function
  ];
  assert.deepEqual(startsFromPlay(prg, functions, sent), [0x0C, 0x30, 0x38]);
});

test('a function takes the pieces a BL used as a long jump or a branch leads it on into, not a function it calls', () => {
  const halfwords = [
    0xB510, 0xD101, 0xF000, 0xF800,   // 0x00: PUSH {r4, lr}; BNE on to 0x08; BL 0x08, a long jump
    0x2001, 0xBC10, 0xBC02, 0x4708,   // 0x08: its end: MOV r0, #1; POP {r4}; POP {r1}; BX r1
    0xB500, 0xBD00,                   // 0x10: a function: PUSH {lr}; POP {pc}
    0xF000, 0xF800,                   // 0x14: BL 0x18, a call
    0x2000, 0x4770,                   // 0x18: a function it calls that returns through the link register
  ];
  const bytes = Buffer.alloc(halfwords.length * 2);
  halfwords.forEach((op, i) => bytes.writeUInt16LE(op, i * 2));
  const base = 0x08000000;
  const sizes = withLongJumps(bytes, [[0, 8], [8, 8], [0x10, 4], [0x14, 4], [0x18, 4]].map(([at, size]) => ({ address: base + at, size })));
  assert.deepEqual([...sizes].map(([address, size]) => [address - base, size]), [[0, 16], [8, 8], [0x10, 4], [0x14, 4], [0x18, 4]]);
});
