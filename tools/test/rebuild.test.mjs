// The whole cartridge rebuilt and every byte accounted for (../lib/rebuild.mjs), on made-up bytes: what each check
// finds, with no compiler and no copy of anything. npm run test:rebuild tries both through the tools as they're typed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountOf, rebuildOf } from '../lib/rebuild.mjs';

const CARTRIDGE = 0x08000000;
// a made-up cartridge of 0x100 bytes: three functions, the second ending two bytes before a four-byte boundary, and
// after them data, then fill
const rom = Buffer.alloc(0x100, 0xFF);
for (let at = 0; at < 0x80; at++) rom[at] = (at * 37 + 11) & 0x7F | 1;
rom[0x2E] = rom[0x2F] = 0;
const functions = [
  { key: '08000000', address: 0x08000000, size: 0x20 },
  { key: '08000020', address: 0x08000020, size: 0x0E },
  { key: '08000030', address: 0x08000030, size: 0x10 },
];
const read = (address, count) => rom.subarray(address - CARTRIDGE, address - CARTRIDGE + count);
// each function's twin, built as the original's bytes
const twin = (f, more = {}) => ({ name: `F${f.key}`, address: f.address, bytes: Buffer.from(read(f.address, f.size)), file: 'src/cart.c', library: null, run: null, calls: [], ...more });
const laid = () => functions.map(f => twin(f));

test('every function with a twin the same is the whole code rebuilt', () => {
  const result = rebuildOf({ functions, read, laid: laid() });
  assert.equal(result.code, 0x3E);
  assert.equal(result.same, 0x3E);
  assert.equal(result.complete, true);
  assert.deepEqual([result.differs, result.none, result.outside.length, result.calls.length], [0, 0, 0, 0]);
});

test('a twin moved by one byte is caught', () => {
  const moved = laid();
  moved[2] = twin(functions[2], { address: functions[2].address + 1 });
  const result = rebuildOf({ functions, read, laid: moved });
  assert.equal(result.complete, false);
  assert.deepEqual(result.missing.map(s => [s.from, s.to]), [[0x08000030, 0x08000030]]);
  assert.equal(result.outside[0].why, 'no function');
  assert.equal(result.outside[0].from, 0x08000031);
  assert.ok(result.differs > 0);
});

test('a function the code map misses, where a twin lies, is outside it', () => {
  const result = rebuildOf({ functions: functions.filter(f => f.key !== '08000020'), read, laid: laid() });
  assert.equal(result.complete, false);
  assert.deepEqual(result.outside.map(s => [s.why, s.from, s.bytes]), [['no function', 0x08000020, 0x0E]]);
});

test('a call to where no function starts is a function the code map missed, or one it holds as two', () => {
  const twins = laid();
  twins[0].calls = [0x08000020, 0x08000040, 0x08000024];
  const result = rebuildOf({ functions, read, laid: twins });
  assert.equal(result.complete, false);
  assert.deepEqual(result.calls.map(c => [c.target, c.inside]), [[0x08000024, 0x08000020], [0x08000040, undefined]]);
});

test('zeros after a twin that line up the next function are padding, and four are not', () => {
  const padded = functions.map(f => (f.key === '08000020' ? { ...f, size: 0x10 } : f));
  const result = rebuildOf({ functions: padded, read, laid: laid() });
  assert.equal(result.padding, 2);
  assert.equal(result.complete, true);
  const wide = Buffer.from(rom);
  wide.fill(0, 0x2C, 0x30);
  const short = { ...twin(functions[1]), bytes: Buffer.from(wide.subarray(0x20, 0x2C)) };
  const four = rebuildOf({ functions: padded, read: (address, count) => wide.subarray(address - CARTRIDGE, address - CARTRIDGE + count), laid: [twin(functions[0]), short, twin(functions[2])] });
  assert.equal(four.padding, 0);
  assert.equal(four.none, 4);
  assert.equal(four.complete, false);
});

test('two twins over one function are caught', () => {
  const twins = [...laid(), { ...twin(functions[0]), name: 'Again' }];
  const result = rebuildOf({ functions, read, laid: twins });
  assert.equal(result.complete, false);
  assert.deepEqual(result.outside.map(s => [s.why, s.name, s.other, s.bytes]), [['over another', 'Again', 'F08000000', 0x20]]);
});

test('a twin the same as its function that goes on runs past its end, and one that differs stays in it', () => {
  const twins = laid();
  twins[0].bytes = Buffer.from(read(0x08000000, 0x22));
  const result = rebuildOf({ functions, read, laid: twins });
  assert.deepEqual(result.outside.map(s => [s.why, s.from, s.bytes]), [['past its end', 0x08000020, 2], ['over another', 0x08000020, 2]]);
  twins[0].bytes = Buffer.alloc(0x40, 0x12);
  const differing = rebuildOf({ functions, read, laid: twins });
  assert.deepEqual([differing.outside.length, differing.differs, differing.same], [0, 0x20, 0x1E]);
});

test('a function proven by the same memory is proven another way, and its twin isn\'t laid', () => {
  const twins = laid();
  twins[2].bytes = Buffer.alloc(0x40, 0x12);
  const states = new Map([['08000030', { kind: 'memory' }]]);
  const result = rebuildOf({ functions, read, laid: twins, states });
  assert.equal(result.another, 0x10);
  assert.equal(result.complete, true);
  assert.equal(result.outside.length, 0);
  // without its proof the same twin differs
  const unproven = rebuildOf({ functions, read, laid: twins });
  assert.deepEqual([unproven.complete, unproven.differs], [false, 0x10]);
});

test('what no twin covers is said by stretch, with whether a twin wasn\'t built and the cartridge\'s start', () => {
  const states = new Map([['08000020', { kind: null, twin: { name: 'F' } }], ['08000000', { kind: null, beyond: 'start' }]]);
  const result = rebuildOf({ functions, read, laid: [twin(functions[2])], states });
  assert.deepEqual(result.missing.map(s => [s.from, s.to, s.unbuilt, s.start]), [[0x08000000, 0x0800001F, false, true], [0x08000020, 0x0800002D, true, false]]);
  assert.deepEqual([result.none, result.unbuilt, result.start], [0x2E, 0x0E, 0x20]);
});

test('bytes from a shared library are counted apart', () => {
  const twins = laid();
  twins[1].library = 'gba/made-up';
  assert.equal(rebuildOf({ functions, read, laid: twins }).libraries, 0x0E);
});

test('functions the game makes in its work memory are counted apart, as they aren\'t the cartridge\'s', () => {
  const made = [...functions, { key: '03000000/0011223344556677', address: 0x03000000, size: 8, bytes: '0011223344556677' }];
  const result = rebuildOf({ functions: made, read, laid: laid(), states: new Map([['03000000/0011223344556677', { kind: 'memory' }]]) });
  assert.deepEqual(result.made, { functions: 1, proven: 1 });
  assert.equal(result.complete, true);
});

test('every byte is accounted for: code, header, padding, data and fill', () => {
  const head = Buffer.alloc(0x100, 0xFF);
  rom.copy(head, 0x40, 0, 0x80);
  head.fill(0x22, 0, 0x40);
  for (let at = 4; at < 0x40; at++) head[at] = at;
  const moved = functions.map(f => ({ ...f, address: f.address + 0x40 }));
  const account = accountOf({ rom: head, functions: moved, proven: new Set(['08000000', '08000020', '08000030']), used: cell => cell === 4, header: [0x08000000, 0x0800003F] });
  // the header 0x40, code 0x3E, padding 2, data 0x20 used (cell 4, 0x80 to 0x9F) and 0x20 not, fill 0x40
  assert.deepEqual(account.counts, { proven: 0x3E, unproven: 0, used: 0x20, never: 0x20, header: 0x40, padding: 2, fill: 0x40, unreachable: 0 });
  assert.equal(account.accounted, 0xE0);
  assert.equal(account.percent, 87.5);
  assert.deepEqual(account.unexplained.map(s => [s.kind, s.from, s.to]), [['never', 0x080000A0, 0x080000BF]]);
  // what unreachable.json lists is explained, unless it was used
  const listed = accountOf({ rom: head, functions: moved, proven: new Set(['08000000', '08000020', '08000030']), used: cell => cell === 4, unreachable: [[0x08000080, 0x080000BF]], header: [0x08000000, 0x0800003F] });
  assert.deepEqual([listed.counts.used, listed.counts.unreachable, listed.percent], [0x20, 0x20, 100]);
});

test('code without a proof is unexplained, by stretch, with its functions', () => {
  const account = accountOf({ rom, functions, proven: new Set(['08000020']), used: () => true });
  assert.deepEqual(account.unexplained.map(s => [s.kind, s.from, s.to, s.functions]), [['unproven', 0x08000000, 0x0800001F, [0x08000000]], ['unproven', 0x08000030, 0x0800003F, [0x08000030]]]);
  assert.equal(account.counts.padding, 2);
});

test('a run of one value is fill from 32 bytes on, and a function missing from the code map is data', () => {
  const runs = Buffer.alloc(0x80, 0);
  for (let at = 0; at < 0x80; at++) runs[at] = at & 1 ? 0x10 : 0x20;
  runs.fill(0x33, 0x10, 0x10 + 31);
  runs.fill(0x44, 0x40, 0x60);
  const account = accountOf({ rom: runs, functions: [], used: () => false });
  assert.equal(account.counts.fill, 32);
  assert.equal(account.counts.never, 0x80 - 32);
  assert.equal(account.percent, 25);
});
