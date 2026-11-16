// What was played of the original's code (tools/lib/played.mjs), which gameplay proven is made of: every instruction
// that ran in a frame that matched, and each way every conditional branch went. Made-up Thumb code stands in for a game's.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CELL, NOT_TAKEN, RAN, TAKEN, contentCells, contentIn, finderOf, instructionsOf, layoutOf, playedIn } from '../lib/played.mjs';
import { gameplayText, playedPercent, proofOf } from '../../src/lib/entries.mjs';

const thumb = (...ops) => Uint8Array.from(ops.flatMap(op => [op & 0xFF, op >> 8]));
// 0: cmp r0, #0   2: beq +2 (to 8)   4: mov r0, #1   6: bx lr   8: mov r0, #2   A: bx lr   C: a word of data
const CODE = thumb(0x2800, 0xD001, 0x2001, 0x4770, 0x2002, 0x4770, 0xD0D0, 0xDEAD);

test('a function\'s instructions are followed through both ways of each branch, and its data left out', () => {
  const { instructions, branches } = instructionsOf(CODE);
  assert.deepEqual([...instructions].sort((a, b) => a - b), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual([...branches], [2]);
});

test('a place known to have run is followed too, as a switch\'s case is', () => {
  // 0: mov pc, r0 (a jump the code can't be followed through)   2: mov r0, #1   4: bx lr
  const code = thumb(0x4687, 0x2001, 0x4770);
  assert.deepEqual([...instructionsOf(code).instructions], [0]);
  assert.deepEqual([...instructionsOf(code, [2]).instructions].sort((a, b) => a - b), [0, 2, 4]);
});

const codeMap = { functions: [{ key: '08000100', address: 0x08000100, size: 16 }, { key: '08000200', address: 0x08000200, size: 4 }], copies: [] };
const find = finderOf(codeMap, () => null, new Map());
const record = (address, code, what, from, to) => [address | 1, code, what, from, to];

test('only what ran in a frame that matched counts, each way of a branch by itself', () => {
  const layout = layoutOf(codeMap);
  assert.deepEqual([layout.places, [...layout.first]], [10, [0, 8, 10]]);
  const records = Uint32Array.from([
    ...record(0x08000100, 0x2800, RAN, 0, 5), ...record(0x08000102, 0xD001, RAN, 0, 5),
    ...record(0x08000102, 0xD001, TAKEN, 0, 1),        // only in frames that differ
    ...record(0x08000102, 0xD001, NOT_TAKEN, 2, 5),
    ...record(0x08000200, 0x4770, RAN, 0, 1),          // the second function ran only in frames that differ
    ...record(0x08000900, 0x4770, RAN, 2, 5),          // outside every function
  ]);
  const matched = Uint8Array.from([0, 0, 1, 1, 0, 0]);
  const set = playedIn(records, matched, layout, find);
  const has = n => (set[n >> 3] >> (n & 7) & 1) === 1;
  assert.ok(has(0 * 3 + RAN) && has(1 * 3 + RAN) && has(1 * 3 + NOT_TAKEN));
  assert.ok(!has(1 * 3 + TAKEN), 'taken only where the frames differ');
  assert.ok(!has(8 * 3 + RAN), 'ran only where the frames differ');
  assert.equal(set.reduce((sum, byte) => sum + byte.toString(2).replaceAll('0', '').length, 0), 3);
});

test('code in the work RAM is the cartridge\'s where a copy holds those bytes, or a function the game made, by its bytes', () => {
  const map = {
    functions: [{ key: '03000000/0128', address: 0x03000000, size: 4, bytes: '0128' }, { key: '08000100', address: 0x08000100, size: 16 }],
    copies: [{ ram: 0x03000000, cartridge: 0x08000100, size: 16 }],
  };
  const cartridge = (address, count) => CODE.subarray(address - 0x08000100, address - 0x08000100 + count);
  const inMemory = finderOf(map, cartridge, new Map([[0, thumb(0x2801, 0x4770)]]));
  assert.deepEqual(inMemory(0x03000002, 0xD001, true), [1, 2], 'the copy of the cartridge\'s code');
  assert.deepEqual(inMemory(0x03000002, 0x4770, true), [0, 2], 'the game\'s own code, later at the same address');
  assert.equal(inMemory(0x03000002, 0x1234, true), null);
});

test('the cartridge\'s data counts in cells: those outside the code that hold something, once used in a frame that matched', () => {
  // four cells: a function, data, 32 bytes all the same, and data next to a function
  const rom = new Uint8Array(CELL * 4).map((_, i) => i & 0xFF);
  rom.fill(0xFF, CELL * 2, CELL * 3);
  const map = { functions: [{ key: '08000000', address: 0x08000000, size: CELL }, { key: '08000060', address: 0x08000060, size: 8 }] };
  const holds = contentCells(map, rom), has = (set, n) => (set[n >> 3] >> (n & 7) & 1) === 1;
  assert.deepEqual([0, 1, 2, 3].map(cell => has(holds, cell)), [false, true, false, true]);
  // cell 1 used in frames 0 to 1, which differ, and 4 to 5; cell 3 only where the frames differ
  const used = contentIn(Uint32Array.from([1, 0, 1, 1, 4, 5, 3, 0, 1, 9, 2, 3]), Uint8Array.from([0, 0, 1, 1, 1, 0]), 4);
  assert.deepEqual([0, 1, 2, 3].map(cell => has(used, cell)), [false, true, false, false]);
});

test('gameplay proven is never 100% until everything is played, and the numbers say what it\'s made of', () => {
  assert.equal(playedPercent(99999, 100000), 99.99);
  assert.equal(playedPercent(100000, 100000), 100);
  assert.equal(playedPercent(0, 0), 0);
  const original = { name: 'Made Up', sha1: 'abc' };
  const files = played => ({
    original, map: { original: 'abc', functions: [['08000100', 16]] }, parts: { parts: [{ name: 'The title' }] },
    progress: { original: 'abc', percent: 0, codeMap: { functions: 1, bytes: 16 }, proven: { functions: 0, bytes: 0 }, ...(played ? { played } : {}), recordings: {} },
  });
  const byCode = proofOf('made-up', files({ total: 8, played: 6, percent: 75 })).gameplay;
  assert.deepEqual([byCode.percent, byCode.units, byCode.proven, byCode.total], [75, { total: 8, played: 6 }, 0, 1]);
  assert.equal(gameplayText(byCode), '75%, 6 of 8 instructions and branch ways played, and 0 of 1 parts played through');
  const byParts = proofOf('made-up', files(null)).gameplay;
  assert.equal(gameplayText(byParts), '0%, 0 of 1 parts');
  assert.throws(() => proofOf('made-up', files({ total: 8, played: 6, percent: 80 })), /"played" doesn't add up/);
  // with the content counted, the number is the lower of the two
  const both = content => {
    const all = files({ total: 8, played: 6, percent: 75 });
    all.progress.content = content;
    return all;
  };
  const lower = proofOf('made-up', both({ total: 10, read: 3, percent: 30 })).gameplay;
  assert.deepEqual([lower.percent, lower.code, lower.content], [30, 75, { total: 10, read: 3, percent: 30 }]);
  assert.equal(gameplayText(lower), '30%, the lower of its code, 75%, 6 of 8 instructions and branch ways played, and its content, 30%, 3 of 10 cells of data used, with 0 of 1 parts played through');
  assert.equal(proofOf('made-up', both({ total: 10, read: 9, percent: 90 })).gameplay.percent, 75);
  assert.throws(() => proofOf('made-up', both({ total: 10, read: 11, percent: 100 })), /"content" doesn't add up/);
});
