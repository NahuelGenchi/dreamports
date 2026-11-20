// The parts of match that need no compiler (gba/thumb.mjs, gba/match.mjs, match.mjs): the tools' own assembler against
// what clang made of every form of every instruction, how a twin says which function it is, and what a game may say of
// its compiler and its names. Nothing here is from any game.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemble } from '../gba/thumb.mjs';
import { addressFinder, addressIn, compilerAt, readCompiler, runIn, throughIn, twinsIn } from '../gba/match.mjs';
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

test('the newer way of writing Thumb, as a decompilation writes a routine, comes out as GNU\'s assembler made it', () => {
  // flags set by an s, numbers with no # and names given one, a value kept at the pool, adr, stm with !, and a low
  // register moved to another as a shift by nothing
  const made = assemble('\t.syntax unified\n\t.equ off, 4\n\tadds r3, 1\n\tmovs r0, 0\n\tmovs r1, r2\n\tlsls r0, 2\n\tmuls r2, r1\n\tstr r1, [sp, 0x14]\n\tldr r3, [r0, off]\n\tsub sp, off * 6\n\tstm r5!, {r0}\n\tldr r1, =0x4000000 + 6\n\tadr r2, there\n\tbx r2\n\t.pool\n\t.arm\nthere:\n\tmov r0, r1, asr 9\n\tbx lr\n');
  const halves = [...made.sections['.text'].bytes.toString('hex').match(/..../g)].map(pair => pair.slice(2) + pair.slice(0, 2));
  assert.deepEqual(halves.slice(0, 14), ['3301', '2000', '0011', '0080', '434a', '9105', '6843', 'b086', 'c501', '4901', 'a201', '4710', '0006', '0400']);
  // ARM code takes its place and is said to be left out
  assert.deepEqual(made.unassembled.map(({ at, bytes }) => [at, bytes]), [[28, 4], [32, 4]]);
  assert.equal(made.symbols.get('there').at, 28);
  assert.throws(() => assemble('\t.syntax unified\n\tmov r0, r1\n'), /written movs/);
});

test('ARM code written the older way comes out as the ARM processor reads it, and ARM it doesn\'t know takes its place as zeros', () => {
  const made = assemble([
    '\t.arm', 'start:', '\tmov r0, #18', '\tmsr cpsr_cf, r0', '\tldr sp, [pc, #40]', '\tadd r0, pc, #24', '\tstr r0, [r1, #0]', '\tmov lr, pc', '\tbx r1',
    '\tmov r3, #67108864', '\tadd r3, r3, #512', '\tand r1, r2, r2, lsr #16', '\tands r0, r1, #8192', '\tbne start', '\tstrh r0, [r3, #2]', '\tldrb r2, [r1, #-3]',
    '\tldr r1, =0x03000470', '\tmrs r0, cpsr', '\tb elsewhere', '\tswp r0, r1, [r2]', '\t.pool', '',
  ].join('\n'));
  const bytes = made.sections['.text'].bytes, words = Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readUInt32LE(i * 4));
  assert.deepEqual(words, [0xE3A00012, 0xE129F000, 0xE59FD028, 0xE28F0018, 0xE5810000, 0xE1A0E00F, 0xE12FFF11, 0xE3A03301, 0xE2833C02, 0xE0021822, 0xE2110A02,
    0x1AFFFFF3, 0xE1C300B2, 0xE5512003, 0xE59F1008, 0xE10F0000, 0xEA000000, 0, 0x03000470]);
  // a branch to a name the file doesn't have is match's to fill in, and the instruction it doesn't know is left out
  assert.deepEqual(made.relocations, [{ section: '.text', at: 64, kind: 'arm-branch', name: 'elsewhere', addend: 0 }]);
  assert.deepEqual(made.unassembled, [{ section: '.text', at: 68, bytes: 4 }]);
  // and so is a branch to a function, which match places where the original has it, not where the file does
  assert.deepEqual(assemble('\t.arm\n\t.type start,function\nstart:\n\tb start\n').relocations, [{ section: '.text', at: 0, kind: 'arm-branch', name: 'start', addend: 0 }]);
  // a decompilation's ARM, after .syntax unified, is left as zeros, as m4a's table of frames has it
  assert.deepEqual(assemble('\t.syntax unified\n\t.arm\n\tmov r0, #18\n').unassembled, [{ section: '.text', at: 0, bytes: 4 }]);
});

test('ARM\'s multiplies, its loads and stores of every kind, ldm and stm, and a register shifted by a register come out as the ARM processor reads them', () => {
  const made = assemble([
    '\t.arm', 'back:', '\tmul r1, r0, r3', '\tmla r0, r1, r2, r3', '\tumull r0, r1, r2, r3', '\tsmlals r4, r5, r6, r7',
    '\tldrsb r1, [r7], #1', '\tldrsb r0, [r5, r6]', '\tldrnesb r6, [r1, r10]!', '\tstrb r0, [r5], #1', '\tstr r6, [r5], #4',
    '\tldr r0, [r1, -r2, lsl #2]!', '\tldrh r0, [r1, #-6]', '\tstrh r2, [r3], r4', '\tldrsh r0, [r1, #2]!', '\tldmia sp!, {r4, r12}',
    '\tstmdb sp!, {r4-r7, lr}', '\tldmfd sp!, {r0-r3, pc}^', '\tstmib r0, {r1}', '\tmov r0, r1, ror r2', '\tadd r0, r1, r2, lsl r3',
    '\tmovs r0, r1, rrx', '\tldr r2, back', '\tldrb r0, [r1, #-3]!', '\tldr r0, [r1], -r2, asr #3', '\tldrgtb r3, [r4, r5, lsr #1]',
    '\tldr r1, ahead', 'ahead:', '\t.word 0x12345678', '',
  ].join('\n'));
  const bytes = made.sections['.text'].bytes, words = Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readUInt32LE(i * 4));
  // each as mGBA's decoder reads it back, the line it was written as
  assert.deepEqual(words, [0xE0010390, 0xE0203291, 0xE0810392, 0xE0F54796, 0xE0D710D1, 0xE19500D6, 0x11B160DA, 0xE4C50001, 0xE4856004,
    0xE7310102, 0xE15100B6, 0xE08320B4, 0xE1F100F2, 0xE8BD1010, 0xE92D40F0, 0xE8FD800F, 0xE9800002, 0xE1A00271, 0xE0810312, 0xE1B00061,
    0xE51F2058, 0xE5710003, 0xE61101C2, 0xC7D430A5, 0xE51F1004, 0x12345678]);
  assert.deepEqual(made.unassembled, []);
  // what no ARM processor has: a store of a byte with its sign, and a shift by a register in an address
  assert.deepEqual(assemble('\t.arm\n\tstrsb r0, [r1]\n\tldr r0, [r1, r2, lsl r3]\n').unassembled.length, 2);
});

test('a twin of the function at a base address, as a cartridge\'s first instruction, names it with its own name right after it', () => {
  const twins = twinsIn('/** 0x08000000, CartridgeStart: the jump past the header. */\nvoid CartridgeStart(void)\n{\n}\n\n/** Reads at 0x08000000, the cartridge. */\nvoid Reads(void)\n{\n}\n');
  assert.deepEqual(twins.map(twin => [twin.name, twin.address]), [['CartridgeStart', 0x08000000], ['Reads', null]]);
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
  assert.deepEqual(readCompiler({ compiler: { name: 'agbcc', flags: ['-mthumb-interwork', '-O2', '-fprologue-bugfix'] } }, where), { name: 'agbcc', flags: ['-mthumb-interwork', '-O2', '-fprologue-bugfix'], stretches: [] });
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

test('a twin of one routine the code map holds as several functions names the run, and the run has to be one', () => {
  assert.equal(throughIn('/** Loop, 0x08001AA4 to 0x0800258E: the whole loop. */'), 0x0800258E);
  assert.equal(throughIn('/** Loop, 0x08001AA4: then 0x0800258E is called. */'), null);
  // the second address comes after the first, and a label is moved as the game's names.json says
  assert.equal(throughIn('/** 0x08002000 to 0x08001000 */'), null);
  assert.equal(throughIn('/** sub_8001AA4 to sub_80025A0 */', [{ from: 0x08000000, to: 0x08010000, by: 0x12 }]), 0x0800258E);
  const twins = twinsIn('/** Loop, 0x08000100 to 0x08000120: all of it. */\nvoid Loop(void) {}\n/** One, 0x08000200: one. */\nvoid One(void) {}\n');
  assert.deepEqual(twins.map(t => [t.name, t.address, t.through ?? null]), [['Loop', 0x08000100, 0x08000120], ['One', 0x08000200, null]]);
  const functions = [{ address: 0x08000100, size: 16, key: '08000100' }, { address: 0x08000110, size: 16, key: '08000110' }, { address: 0x08000120, size: 8, key: '08000120' }, { address: 0x08000140, size: 8, key: '08000140' }];
  assert.deepEqual(runIn(functions, 0x08000100, 0x08000120).map(f => f.key), ['08000100', '08000110', '08000120']);
  // a gap between two of them, or no function at either end, is no run
  assert.equal(runIn(functions, 0x08000110, 0x08000140), null);
  assert.equal(runIn(functions, 0x08000100, 0x08000118), null);
  assert.equal(runIn(functions, 0x08000104, 0x08000120), null);
});

test('a stretch of the cartridge a library was built in has its own compiler', () => {
  const where = 'games/made-up/proof/original.json';
  const game = { name: 'agbcc', flags: ['-mthumb-interwork', '-O2', '-fprologue-bugfix'] };
  const sound = { from: '08096AA0', to: '0809B376', name: 'old_agbcc', flags: ['-mthumb-interwork', '-O2'] };
  const flash = { from: '08098C00', to: '08098FFF', name: 'agbcc', flags: ['-mthumb-interwork', '-O1'] };
  const compiler = readCompiler({ compiler: { ...game, stretches: [{ from: '08096000', to: '08096A9F', ...flash, from: '08096000' }] } }, where);
  assert.deepEqual(compiler.stretches, [{ from: 0x08096000, to: 0x08098FFF, name: 'agbcc', flags: ['-mthumb-interwork', '-O1'] }]);
  const both = readCompiler({ compiler: { ...game, stretches: [sound] } }, where);
  assert.deepEqual(compilerAt(both, 0x08096AA0), { name: 'old_agbcc', flags: ['-mthumb-interwork', '-O2'] });
  assert.deepEqual(compilerAt(both, 0x0809B376), { name: 'old_agbcc', flags: ['-mthumb-interwork', '-O2'] });
  assert.deepEqual(compilerAt(both, 0x0809B378), game);
  assert.deepEqual(compilerAt(both, 0x08000200), game);
  // overlapping stretches, an address written another way, a stretch backwards, or one with a flag that names a file
  assert.throws(() => readCompiler({ compiler: { ...game, stretches: [sound, flash] } }, where), /overlap/);
  assert.throws(() => readCompiler({ compiler: { ...game, stretches: [{ ...sound, from: '8096AA0' }] } }, where), /"stretches"/);
  assert.throws(() => readCompiler({ compiler: { ...game, stretches: [{ ...sound, from: '0809B376', to: '08096AA0' }] } }, where), /"stretches"/);
  assert.throws(() => readCompiler({ compiler: { ...game, stretches: [{ ...sound, flags: ['-o', 'x'] }] } }, where), /for 08096AA0 to 0809B376/);
  assert.throws(() => readCompiler({ compiler: { ...game, stretches: [{ ...sound, name: 'gcc' }] } }, where), /names the compiler "gcc" for/);
});

test('a name less a number, as agbcc writes it, is the name with the number taken away', () => {
  const { relocations } = assemble('\t.code\t16\n\t.word\tgFoo+-0x8\n\t.word\tgFoo-0x8\n\t.word\tgFoo+0x8\n\t.word\tgFoo- -0x8\n');
  assert.deepEqual(relocations.map(r => [r.name, r.addend]), [['gFoo', -8], ['gFoo', -8], ['gFoo', 8], ['gFoo', 8]]);
});
