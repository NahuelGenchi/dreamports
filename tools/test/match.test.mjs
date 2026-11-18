// The parts of match that need no compiler (gba/thumb.mjs, gba/match.mjs, match.mjs): the tools' own assembler against
// what clang made of every form of every instruction, how a twin says which function it is, and what a game may say of
// its compiler and its names. Nothing here is from any game.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemble } from '../gba/thumb.mjs';
import { addressFinder, addressIn, readCompiler, twinsIn } from '../gba/match.mjs';
import { readAddresses } from '../match.mjs';

const fixture = name => readFileSync(new URL(`./match/${name}`, import.meta.url), 'utf8');
const halfwords = text => [...assemble(`\t.code\t16\n${text}\n`).sections['.text'].bytes.toString('hex').match(/..../g)].map(pair => pair.slice(2) + pair.slice(0, 2));

test('every form of every Thumb instruction comes out as clang made it', () => {
  const made = assemble(fixture('forms.s')), mine = Buffer.from(made.sections['.text'].bytes);
  const theirs = Buffer.from(fixture('forms.hex').replace(/\s/g, ''), 'hex');
  // a place a linker fills in is zeros in the fixture, and here it's a call with nowhere to go yet
  for (const { at } of made.relocations) mine.fill(0, at, at + 4);
  assert.equal(mine.length, theirs.length);
  for (let at = 0; at < mine.length; at += 2) {
    assert.equal(mine.readUInt16LE(at), theirs.readUInt16LE(at), `line ${made.sections['.text'].lines[at]} of forms.s`);
  }
  assert.deepEqual(made.relocations.map(({ kind, name, addend }) => [kind, name, addend]), [
    ['call', 'outer', 0], ['word', 'outer', 0], ['word', 'outer', 0x9EC], ['word', 'back', 0], ['word', '.L2', 0],
  ]);
});

test('the choices GNU\'s assembler made, which the original\'s bytes hold', () => {
  // a low register moved to a low one is an add of zero, and a number added in place takes the 8-bit form
  assert.deepEqual(halfwords('\tmov\tr4, r0\n\tadd\tr4, r0, #0\n\tadd\tr1, r1, #0x1\n\tadd\tr1, r2, #0x1'), ['1c04', '1c04', '3101', '1c51']);
  assert.deepEqual(halfwords('\tadd\tsp, sp, #-0x4\n\tneg\tr0, r1\n\tlsl\tr0, r0, #0x12\n\tmov\tr8, r8'), ['b081', '4248', '0480', '46c0']);
  // a load from beside the function counts from the word the instruction after next is in
  assert.deepEqual(halfwords('\tmov\tr0, #0\n\tldr\tr1, .L1+0x4\n\tbx\tlr\n\t.align\t2, 0\n.L1:\n\t.word\t0x1\n\t.word\t0x2'), ['2000', '4902', '4770', '0000', '0001', '0000', '0002', '0000']);
});

test('a function knows its length, and a line the assembler can\'t read is named', () => {
  const made = assemble('\t.type\t f,function\n\t.thumb_func\nf:\n\tbx\tlr\n.Lfe1:\n\t.size\t f,.Lfe1-f\n\t.align\t2, 0\n\t.comm\tvalue, 4\n');
  assert.equal(made.sizes.get('f'), 2);
  assert.equal(made.symbols.get('f').function, true);
  assert.equal(made.sections['.text'].bytes.length, 4);
  assert.throws(() => assemble('\tbx\tlr\n\tfrob\tr0\n'), /Line 2 .*doesn't know "frob"/);
  assert.throws(() => assemble(`\tbeq\tfar\n${'\tmov\tr0, r0\n'.repeat(200)}far:\n`), /Line 1 .*too far/);
  assert.throws(() => assemble('\tmov\tr0, #0x100\n'), /Line 1 .*0 to 255/);
});

test('a function is the twin of the address the comment just above it names, or of its own name', () => {
  const twins = twinsIn([
    '// A file, which names 0x08000010 for something else.',
    '#include "a.h"',
    '',
    '/** Start, 0x08000100: starts, as sub_8000200 does. */',
    'void Start(void) {',
    '  if (x) { y(); }',
    '}',
    '',
    '// Next, 0x08000300:',
    '// in two lines.',
    'static struct Thing *',
    'Next(struct Thing *thing, void (*then)(void)) {',
    '  return thing; /* 0x08000900 */',
    '}',
    '',
    '// far above, 0x08000400',
    '',
    'int Alone(void) { return 0; }',
    'struct Thing things[] = { { 1 } };',
    'int sub_8000500(void) { return 1; }',
    'int Declared(void);',
    'char *text = "{ Hidden(void) {";',
  ].join('\n'));
  assert.deepEqual(twins, [
    { name: 'Start', address: 0x08000100, line: 5, own: false, code: 'void Start(void) { if (x) { y(); } }' },
    { name: 'Next', address: 0x08000300, line: 12, own: true, code: 'static struct Thing * Next(struct Thing *thing, void (*then)(void)) { return thing; }' },
    { name: 'Alone', address: null, line: 18, own: false, code: 'int Alone(void) { return 0; }' },
    { name: 'sub_8000500', address: 0x08000500, line: 20, own: false, code: 'int sub_8000500(void) { return 1; }' },
  ]);
});

test('a label is moved as the game\'s names.json says, and a name finds its address', () => {
  const shifts = [{ from: 0x08001000, to: 0x08002000, by: 0x30 }];
  assert.equal(addressIn('sub_8001588', shifts), 0x08001558);
  assert.equal(addressIn('0x08001588', shifts), 0x08001588);
  assert.equal(addressIn('from 0x08000000, FUN_08000101 on'), 0x08000100);
  assert.equal(addressIn('nothing here'), null);
  const find = addressFinder({
    named: new Map([['gThings', 0x03000100], ['Helper', 0x08000301], ['Listed', 0x08000700]]),
    twins: new Map([['Twin', new Set([0x08000400])], ['Twice', new Set([0x08000500, 0x08000600])], ['Listed', new Set([0x08000800])]]),
    startsFunction: address => address === 0x08000900,
  });
  assert.deepEqual(['gThings', 'Helper', 'Listed', 'Twin', 'Twice', 'sub_8000900', 'gUnknown_08000A00', 'gUnknown_03000040', 'Missing'].map(find),
    [0x03000100, 0x08000301, 0x08000700, 0x08000401, null, 0x08000901, 0x08000A00, 0x03000040, null]);
});

test('a game says which compiler and how, with no flag that names a file', () => {
  const where = 'games/x/proof/original.json';
  assert.deepEqual(readCompiler({ compiler: { name: 'agbcc', flags: ['-mthumb-interwork', '-O2', '-fprologue-bugfix'] } }, where), { name: 'agbcc', flags: ['-mthumb-interwork', '-O2', '-fprologue-bugfix'] });
  assert.throws(() => readCompiler({}, where), /doesn't say which compiler/);
  assert.throws(() => readCompiler({ compiler: { name: 'gcc', flags: [] } }, where), /names the compiler "gcc"/);
  for (const flags of [['-o', 'elsewhere'], ['-aux-info'], ['-dumpbase=x'], ['file.c'], 'O2']) {
    assert.throws(() => readCompiler({ compiler: { name: 'agbcc', flags } }, where), /"flags"/);
  }
});

test('a game\'s names and addresses are read, and a wrong one is refused', () => {
  const folder = mkdtempSync(join(tmpdir(), 'dp-match-'));
  try {
    const file = join(folder, 'addresses.json');
    writeFileSync(file, JSON.stringify({ about: 'Made up', addresses: { gThings: '030006B0', _call_via_r0: '08099845' } }));
    assert.deepEqual([...readAddresses(file)], [['gThings', 0x030006B0], ['_call_via_r0', 0x08099845]]);
    for (const wrong of [{ gThings: '30006b0' }, { 'a b': '030006B0' }, { gThings: 0x030006B0 }]) {
      writeFileSync(file, JSON.stringify({ addresses: wrong }));
      assert.throws(() => readAddresses(file), /eight capital hexadecimal digits/);
    }
    writeFileSync(file, '{}');
    assert.throws(() => readAddresses(file), /needs "addresses"/);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
