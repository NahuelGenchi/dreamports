// The Game Boy function finder (tools/gbc/functions.mjs) on two small programs written here, with nothing from any game
// in them: the made-up one the real-gb test runs, and a 64 KB one of four banks (made-up-gb.mjs) with code in each, a
// bank switched in by a write and by a routine, and the two kinds of table the finder follows. And the processor's
// instructions it reads them with (tools/gbc/sm83.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findFunctions, gbName, gbNames, gbProgram, programOffset, startsInData } from '../gbc/functions.mjs';
import { NONE, decode } from '../gbc/sm83.mjs';
import { readList } from '../codemap.mjs';
import { madeUpBanks, madeUpGb } from './made-up-gb.mjs';

const BANK = 0x4000;

test('follows the code into the banks it switches in, and through its tables', () => {
  const found = findFunctions(madeUpBanks()).map(f => gbName(f.address, 4));
  assert.deepEqual(found, ['sub_0008', 'sub_0040', 'sub_0048', 'sub_0100', 'sub_0200', 'sub_0240', 'sub_0320', 'sub_0330', 'sub_0340', 'sub_0350',
    'sub_01_4000', 'sub_01_4008', 'sub_02_4010', 'sub_03_4000', 'sub_03_4020']);
});

test('a function ends where its code does, and the list after a call is the caller\'s', () => {
  const sizes = Object.fromEntries(findFunctions(madeUpBanks()).map(f => [gbName(f.address, 4), f.size]));
  assert.equal(sizes.sub_0008, 11);
  assert.equal(sizes.sub_0200, 4);
  assert.equal(sizes.sub_0240, 5);
  assert.equal(sizes.sub_01_4000, 4);
  assert.equal(sizes.sub_03_4020, 3);
  // from $0100, through the jump to $0150, to the JP (HL) that ends it
  assert.equal(sizes.sub_0100, 0x150 + 39 - 0x100);
});

test('the tables it jumped with are data, and a list\'s function that starts in one is told', () => {
  const pool = new Set(), words = new Set();
  findFunctions(madeUpBanks(), [], pool, { words });
  assert.deepEqual([...words].sort((a, b) => a - b), [0x0241, 0x0243, 0x0300, 0x0302]);
  assert.deepEqual(startsInData(madeUpBanks(), [{ address: 0x0302, size: 2 }, { address: 0x0360, size: 5 }]), [{ address: 0x0302, size: 2 }]);
});

test('finds the made-up program\'s start, its three interrupts and its two routines, on both consoles', () => {
  for (const colour of [false, true]) {
    const { rom, at } = madeUpGb({ colour });
    const found = findFunctions(rom).map(f => f.address);
    for (const place of [0x40, 0x48, 0x50, 0x100, at.vblank, at.stat, at.timer, at.copy, at.fill]) assert.ok(found.includes(place), `0x${place.toString(16)}`);
    assert.equal(found.length, 9);
  }
});

test('names and offsets', () => {
  assert.equal(programOffset(0x0150, null, 4), 0x0150);
  assert.equal(programOffset(0x4123, 2, 4), 0x8123);
  assert.equal(programOffset(0x4123, null, 4), null);
  assert.equal(programOffset(0x4123, null, 2), 0x4123);
  assert.equal(programOffset(0x8000, 1, 4), null);
  assert.equal(gbName(0x8123, 4), 'sub_02_4123');
  assert.equal(gbName(0x0150, 4), 'sub_0150');
  assert.equal(gbName(0x100 * BANK + 0x10, 512), 'sub_100_4010');
  assert.deepEqual(gbNames('// sub_02_4123, then sub_0150, sub_4123, sub_00_4123 and wram_C000', 4), [['sub_02_4123', 0x8123], ['sub_0150', 0x0150]]);
  assert.deepEqual(gbNames('sub_4123', 2), [['sub_4123', 0x4123]]);
  assert.equal(gbProgram(madeUpBanks()).chip, 'mbc5');
  assert.equal(gbProgram(madeUpGb({ colour: true }).rom).colour, true);
});

test('a list takes names for addresses', () => {
  const gb = { inCode: offset => offset < 4 * BANK, address: a => a, name: value => gbNames(value, 4)[0]?.[1] };
  assert.deepEqual(readList('Address,Size\n0x0151,4\nsub_02_4123,6\n', gb), [{ address: 0x0151, size: 4 }, { address: 0x8123, size: 6 }]);
});

test('every byte is an instruction of one to three bytes, but for the eleven that are none', () => {
  let none = 0;
  for (let op = 0; op < 256; op++) {
    const instruction = decode([op, 0x12, 0x34], 0, 0x0200);
    if (!instruction) {
      none++;
      assert.ok(NONE.has(op));
      continue;
    }
    assert.ok(instruction.length >= 1 && instruction.length <= 3 && instruction.cycles >= 4 && instruction.cycles % 4 === 0, instruction.name);
    if (instruction.taken !== undefined) assert.ok(instruction.taken > instruction.cycles && instruction.when !== undefined, instruction.name);
  }
  assert.equal(none, 11);
  assert.deepEqual(decode([0x18, 0xFE], 0, 0x0200), { name: 'JR $0200', length: 2, cycles: 12, flow: 'near', to: 0x0200 });
  assert.deepEqual(decode([0xCD, 0x34, 0x12], 0), { name: 'CALL $1234', length: 3, cycles: 24, flow: 'call', to: 0x1234 });
  assert.deepEqual(decode([0xC0], 0), { name: 'RET NZ', length: 1, cycles: 8, taken: 20, flow: 'return', when: 0 });
  assert.deepEqual(decode([0xCB, 0x46], 0), { name: 'BIT 0,(HL)', length: 2, cycles: 12, prefixed: true });
  assert.deepEqual(decode([0xFF], 0), { name: 'RST $38', length: 1, cycles: 16, flow: 'rst', to: 0x38 });
  assert.equal(decode([0x36, 0x05], 0).name, 'LD (HL),$05');
  assert.equal(decode([0xF0, 0x44], 0).name, 'LDH A,($FF44)');
});
