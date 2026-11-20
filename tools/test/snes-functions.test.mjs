// The Super Nintendo function finder (tools/snes/functions.mjs) and its table of the 65816's instructions
// (tools/snes/65816.mjs), on the made-up cartridge the function check's test runs (made-up-snes.mjs), with nothing
// from any game in it: its code followed from the console's vectors with the processor's mode carried along, through
// its calls, its table of functions and a switch's table of cases, and the function only play reaches, found from
// where play sent the processor, in the mode it ran in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUCTIONS, lengthOf, modeBits, modeFromBits, modeOf } from '../snes/65816.mjs';
import { addressOf, explore, findFunctions, fromPlay, instructionsIn, snesName, snesNames, snesProgram } from '../snes/functions.mjs';
import { formatCodeMap, parseCodeMap } from '../lib/proof-files.mjs';
import { madeUpCartridge } from './made-up-snes.mjs';

const { rom, labels } = madeUpCartridge();
const copy = Buffer.from(rom);
const at = name => labels[name] & 0x7FFF;
const named = functions => Object.fromEntries(functions.map(f => [Object.keys(labels).find(name => at(name) === f.address && !name.endsWith('_loop')) ?? f.address, f]));

test('the instructions\' lengths in each mode', () => {
  assert.equal(INSTRUCTIONS.length, 256);
  assert.equal(lengthOf(0xA9, 'a8i16'), 2, 'LDA # with A of 8 bits');
  assert.equal(lengthOf(0xA9, 'a16i8'), 3, 'LDA # with A of 16 bits');
  assert.equal(lengthOf(0xA2, 'a16i8'), 2, 'LDX # with X of 8 bits');
  assert.equal(lengthOf(0xA2, 'e'), 2, 'LDX # in the 6502\'s mode');
  assert.equal(lengthOf(0xC2, 'a16i16'), 2, 'REP is always 2');
  assert.equal(lengthOf(0x22, 'a8i8'), 4, 'JSL');
  assert.equal(lengthOf(0x54, 'a8i8'), 3, 'MVN');
  assert.deepEqual(['a8i8', 'a8i16', 'a16i8', 'a16i16', 'e'].map(mode => modeFromBits(modeBits(mode))), ['a8i8', 'a8i16', 'a16i8', 'a16i16', 'e']);
  assert.equal(modeOf(0x20), 'a8i16');
  assert.equal(modeOf(0x30, 1), 'e');
});

test('follows the code from the console\'s vectors, in the mode each function is called in', () => {
  const found = named(findFunctions(copy));
  assert.deepEqual(Object.keys(found), ['start', 'main', 'sum', 'fill', 'lookup', 'twice', 'leaves8', 'tick', 'pick', 'nmi', 'shine']);
  assert.deepEqual(Object.fromEntries(Object.entries(found).map(([name, f]) => [name, f.mode ?? null])), {
    start: 'e', main: 'a16i16', sum: 'a16i16', fill: 'a8i16', lookup: 'a16i16', twice: 'a16i16', leaves8: 'a16i16', tick: null, pick: 'a16i16', nmi: null, shine: 'a16i16',
  });
});

test('a function ends where its code does, a switch\'s cases are its own, and a table stops where another starts', () => {
  const { functions } = madeUpCartridge();
  const sizes = Object.fromEntries(functions.map(f => [f.name, f.size]));
  const found = named(findFunctions(copy));
  for (const name of ['start', 'main', 'sum', 'fill', 'lookup', 'twice', 'leaves8', 'tick', 'pick', 'nmi', 'shine']) assert.equal(found[name].size, sizes[name], name);
  assert.ok(!('pick_0' in found), 'the cases of pick are pick\'s own, not functions the table of functions runs into');
});

test('what only play reaches is followed from there, in the mode it ran in', () => {
  const before = findFunctions(copy);
  assert.ok(!before.some(f => f.address === at('hidden')), 'reading can\'t follow a pointer made as the game runs');
  // as the tools' change to Snes9x tells them: main called hidden with A, X and Y of 8 bits, and was returned to after it
  const sent = [{ address: at('hidden'), way: 'called', mode: modeBits('a8i8') }, { address: at('main') + 69, way: 'returned', mode: modeBits('a8i8') }, { address: at('pick_2'), way: 'jumped', mode: modeBits('a16i16') }];
  const { starts, functions } = fromPlay(copy, before, sent);
  assert.deepEqual(starts, [at('hidden')]);
  const hidden = functions.find(f => f.address === at('hidden'));
  assert.deepEqual(hidden, { address: at('hidden'), size: 6, mode: 'a8i8' });
  assert.equal(functions.find(f => f.address === at('pick')).size, 15, 'a case play jumped to stays its switch\'s');
});

test('a place reached in two modes is said', () => {
  // sum called again by a made-up caller with A of 8 bits, where main calls it with 16
  const { conflicts } = explore(copy, [{ address: at('sum'), size: 6, mode: 'a8i8' }]);
  assert.ok(conflicts.includes(at('sum')));
});

test('where each instruction is, for gameplay proven', () => {
  const functions = findFunctions(copy);
  const of = instructionsIn(functions, copy);
  const fill = of(functions.find(f => f.address === at('fill')));
  assert.deepEqual([...fill.instructions], [0, 3, 5, 8, 9, 10, 12]);
  assert.deepEqual([...fill.branches], [3]);
});

test('names and addresses', () => {
  const { cart, map } = snesProgram(copy);
  assert.equal(addressOf(0x1234, cart), 0x009234);
  assert.equal(snesName(0x1234, cart), 'sub_009234');
  assert.equal(addressOf(0x12345, { mapping: 'lorom', speed: 'fast' }), 0x82A345);
  assert.equal(addressOf(0x12345, { mapping: 'hirom' }), 0xC12345);
  assert.equal(addressOf(0x412345, { mapping: 'exhirom' }), 0x412345);
  assert.deepEqual(snesNames('// sub_009234, CODE_809234 and func_7E1234', map), [['sub_009234', 0x1234], ['CODE_809234', 0x1234]]);
});

test('the code map keeps the mode each function starts in', () => {
  const functions = findFunctions(copy).slice(0, 3);
  const text = formatCodeMap({ original: 'a'.repeat(40), from: 'Found in the copy by the proof tools (tools/snes/functions.mjs)', functions });
  assert.match(text, /"modes": \{\n {4}"00000000": "e",\n {4}"00000018": "a16i16"/);
  assert.deepEqual(parseCodeMap(JSON.parse(text)).functions.map(f => f.mode), ['e', 'a16i16', 'a16i16']);
});
