// The NES function finder (tools/nes/functions.mjs) on two small programs written here, with nothing from any game in
// them: the made-up one the real-console test runs, and a 64 KB UNROM one with code in two switched banks, a bank
// switch through a routine, and the three kinds of table the finder follows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findFunctions, nesName, nesNames, programOffset } from '../nes/functions.mjs';
import { readList } from '../codemap.mjs';
import { madeUpNes } from './made-up-nes.mjs';

const BANK = 0x4000;

// a 64 KB UNROM program: four banks, the last at $C000
function unrom() {
  const prg = Buffer.alloc(4 * BANK, 0xFF);
  const at = (address, bank = 3) => bank * BANK + (address & 0x3FFF);
  const put = (address, bytes, bank) => Buffer.from(bytes).copy(prg, at(address, bank));
  const word = a => [a & 255, a >> 8];
  // the reset: bank 1 by a write the bus agrees with, a call there, bank 2 by the routine at $C090, a call there, then
  // a jump through a table of whole addresses
  put(0xC000, [0x78, 0xA9, 0x01, 0xAA, 0x9D, 0x00, 0xC1, 0x20, 0x00, 0x80, 0xA9, 0x02, 0x20, 0x90, 0xC0, 0x20, 0x10, 0x80,
    0xA2, 0x00, 0xBD, 0x20, 0xC1, 0x85, 0x00, 0xBD, 0x21, 0xC1, 0x85, 0x01, 0x6C, 0x00, 0x00]);
  // the V-blank interrupt: an address from two tables of low and high bytes, pushed for an RTS
  put(0xC040, [0xA2, 0x00, 0xBD, 0x42, 0xC1, 0x48, 0xBD, 0x40, 0xC1, 0x48, 0x60]);
  // the other interrupt: a call to a routine that reads the list of addresses after it
  put(0xC060, [0x20, 0x70, 0xC0, ...word(0xC240), ...word(0xC250), 0x00, 0x00]);
  put(0xC070, [0x0A, 0xA8, 0x68, 0x85, 0x02, 0x68, 0x85, 0x03, 0xC8, 0xB1, 0x02, 0x85, 0x04, 0xC8, 0xB1, 0x02, 0x85, 0x05, 0x6C, 0x04, 0x00]);
  // switches to the bank in A
  put(0xC090, [0x85, 0x10, 0xAA, 0x9D, 0x00, 0xC1, 0x60]);
  put(0xC100, [0, 1, 2, 3]);
  put(0xC120, [...word(0xC200), ...word(0xC210)]);
  put(0xC140, [0x1F, 0x2F, 0xC2, 0xC2]);
  for (const a of [0xC200, 0xC210, 0xC220, 0xC230, 0xC240, 0xC250]) put(a, [0x60]);
  // code nothing leads to, between the others
  put(0xC300, [0xAD, 0x00, 0x03, 0x8D, 0x07, 0x20, 0xE8, 0x60]);
  put(0x8000, [0xA9, 0x00, 0x60], 1);
  put(0x8010, [0xA2, 0x01, 0x60], 2);
  // the same at $8010 in bank 0, which nothing switches in
  put(0x8010, [0xA2, 0x01, 0x60], 0);
  prg.writeUInt16LE(0xC040, at(0xFFFA));
  prg.writeUInt16LE(0xC000, at(0xFFFC));
  prg.writeUInt16LE(0xC060, at(0xFFFE));
  const header = Buffer.from([0x4E, 0x45, 0x53, 0x1A, 4, 0, 0x21, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  return Buffer.concat([header, prg]);
}

test('follows the code into the banks it switches in, and through its tables', () => {
  const found = findFunctions(unrom()).map(f => nesName(f.address, 4));
  assert.deepEqual(found, ['sub_01_8000', 'sub_02_8010', 'sub_C000', 'sub_C040', 'sub_C060', 'sub_C070', 'sub_C090',
    'sub_C200', 'sub_C210', 'sub_C220', 'sub_C230', 'sub_C240', 'sub_C250', 'sub_C300']);
});

test('a function ends where its code does, and the list after a call is the caller\'s', () => {
  const sizes = Object.fromEntries(findFunctions(unrom()).map(f => [nesName(f.address, 4), f.size]));
  assert.equal(sizes.sub_C090, 7);
  assert.equal(sizes.sub_C060, 7);
  assert.equal(sizes.sub_C300, 8);
});

test('finds the made-up program\'s reset and V-blank interrupt, in a program of one bank', () => {
  const found = findFunctions(madeUpNes().rom);
  assert.equal(found[0].address, 0);
  assert.ok(found.length >= 2 && found.every(f => f.size > 0));
});

test('names and offsets', () => {
  assert.equal(programOffset(0xC39C, null, 8), 0x1C39C);
  assert.equal(programOffset(0x923F, 4, 8), 0x1123F);
  assert.equal(programOffset(0x923F, null, 8), null);
  assert.equal(programOffset(0xC123, null, 1), 0x0123);
  assert.equal(nesName(0x1123F, 8), 'sub_04_923F');
  assert.equal(nesName(0x1C39C, 8), 'sub_C39C');
  assert.deepEqual(nesNames('// sub_04_923F, then sub_C39C, sub_07_C39C, sub_923F and RAM_0200', 8), [['sub_04_923F', 0x1123F], ['sub_C39C', 0x1C39C], ['sub_07_C39C', 0x1C39C]]);
  assert.deepEqual(nesNames('sub_8123', 2), [['sub_8123', 0x0123]]);
});

test('a list keeps an odd address, and takes names for addresses', () => {
  const nes = { inCode: offset => offset < 8 * BANK, address: a => a, name: value => nesNames(value, 8)[0]?.[1] };
  assert.deepEqual(readList('Address,Size\n0x1C39D,4\nsub_04_923F,6\n', nes), [{ address: 0x1123F, size: 6 }, { address: 0x1C39D, size: 4 }]);
  assert.deepEqual(readList('Address,Size\n0x08000201,4\n'), [{ address: 0x08000200, size: 4 }]);
});
