// Shared libraries (../lib/libraries.mjs), as each tool reads a library's file: its twins take their addresses from
// the version that takes it, never from the file, on both consoles, and their marks name the file by its place in the
// kit. npm run test:libraries proves a made-up library in two made-up games with the real tools.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { twinsIn } from '../gba/match.mjs';
import { contractsIn } from '../nes/twin.mjs';
import { parseCodeMap } from '../lib/proof-files.mjs';
import { marksIn } from '../lib/proofs.mjs';
import { libraryFolder } from '../lib/libraries.mjs';
import { REPO } from '../lib/paths.mjs';

const LIBRARY = [
  '/** Adds two numbers. */',
  'unsigned LibAdd(unsigned a, unsigned b) { return a + b; }',
  '',
  '/** 0x08000300: a number named by mistake, which a library\'s twin never goes by. */',
  'unsigned LibPick(unsigned i) { return i < 4 ? i : LibAdd(i, 1); }',
  '',
  'static unsigned own(void) { return 0; }',
  '',
].join('\n');

test('a library\'s twins take the version\'s addresses, and none of their own', () => {
  const given = new Map([['LibAdd', 0x08000800], ['LibPick', 0x08000840]]);
  assert.deepEqual(twinsIn(LIBRARY, [], given).map(twin => [twin.name, twin.address]), [['LibAdd', 0x08000800], ['LibPick', 0x08000840], ['own', null]]);
  // a version whose copy doesn't have a function gives it no address
  assert.deepEqual(twinsIn(LIBRARY, [], new Map([['LibAdd', 0x08000A00]])).map(twin => twin.address), [0x08000A00, null, null]);
  // a game's own file goes by its comments, as before
  assert.deepEqual(twinsIn(LIBRARY).map(twin => twin.address), [null, 0x08000300, null]);
});

test('an NES library\'s contracts name its own functions, placed by the version', () => {
  const text = '// dp:twin show_thing show(X)\nvoid show(unsigned char x) { (void)x; }\n// dp:twin hide_thing hide(X)\nvoid hide(unsigned char x) { (void)x; }\n';
  const { contracts, errors } = contractsIn(text, 8, new Map([['show_thing', 0x1C123]]));
  assert.deepEqual(errors, []);
  // hide_thing isn't in this copy, so its contract is left out
  assert.deepEqual(contracts.map(contract => [contract.name, contract.offset, contract.call]), [['show_thing', 0x1C123, 'show(X)']]);
  // without the library's addresses the same words are no function of a game
  assert.equal(contractsIn(text, 8).errors.length, 2);
});

test('a library\'s twin is marked as the kit has it, the same in every version', () => {
  const file = join(libraryFolder('gba/test-unit'), 'unit.c');
  const read = path => (path === file ? LIBRARY : null);
  const marksAt = (folder, at) => {
    const given = new Map([['LibAdd', at], ['LibPick', at + 0x40]]);
    const codeMap = { ...parseCodeMap({ original: 'abc', functions: [[at.toString(16).toUpperCase().padStart(8, '0'), 16], [(at + 0x40).toString(16).toUpperCase().padStart(8, '0'), 32]] }), console: 'gba' };
    return marksIn(codeMap, { folder, files: [file], twinsOf: new Map([[file, twinsIn(LIBRARY, [], given)]]), givenOf: path => (path === file ? given : null), read });
  };
  const first = marksAt(join(REPO, 'games', 'one', 'c'), 0x08000800), second = marksAt(join(REPO, 'games', 'two', 'c'), 0x08000A00);
  assert.deepEqual([...first.values()].map(twin => twin.file), ['kit/gba/c/lib/test-unit/unit.c', 'kit/gba/c/lib/test-unit/unit.c']);
  assert.deepEqual([...first.values()].map(twin => twin.mark), [...second.values()].map(twin => twin.mark));
  assert.deepEqual([...second.keys()], ['08000A00', '08000A40']);
});

test('a library is named by its console, or c for kit/c/lib/, and nothing else', () => {
  assert.equal(libraryFolder('gba/m4a'), join(REPO, 'kit', 'gba', 'c', 'lib', 'm4a'));
  assert.equal(libraryFolder('c/libgcc'), join(REPO, 'kit', 'c', 'lib', 'libgcc'));
  for (const wrong of ['m4a', 'gba/M4A', 'dreamcast/thing', 'gba/m4a/more', 'gba/../x']) assert.throws(() => libraryFolder(wrong), /isn't a library/);
});

test('a console\'s map has a block for each library and a cell for each function, coloured by where it stands', async () => {
  const { sharedMap, sharedText, STATES } = await import('../../src/lib/shared-map.mjs');
  const cells = states => states.map((state, i) => ({ name: `F${i}`, size: 10, state }));
  const console = {
    id: 'gba', name: 'Game Boy Advance', functions: 6, bytes: 60, proven: 3, provenBytes: 30, versions: 2, games: 2,
    libraries: [
      { id: 'gba/sound', functions: 4, proven: 2, bytes: 40, provenBytes: 20, versions: ['a/c', 'b/c'], cells: cells(['bytes', 'memory', 'written', 'unwritten']) },
      { id: 'gba/save', functions: 2, proven: 1, bytes: 20, provenBytes: 10, versions: ['a/c'], cells: cells(['bytes', 'unwritten']) },
    ],
  };
  const { svg, alt } = sharedMap(console);
  assert.equal(alt, 'Game Boy Advance: 50% of its known shared code proven, 30 of 60 bytes and 3 of 6 functions, in 2 libraries, taken by 2 games.');
  assert.equal(sharedText(console), alt.slice(0, -1));
  for (const { colour } of Object.values(STATES)) assert.ok(svg.includes(`fill="${colour}" d="`), `a path of ${colour}`);
  // one square for each function: four sides each, in the paths of the four colours
  const squares = [...svg.matchAll(/<path fill="[^"]+" d="([^"]+)"/g)].reduce((sum, [, d]) => sum + (d.match(/M/g) ?? []).length, 0);
  assert.equal(squares, 6);
  assert.ok(svg.includes('gba/sound 2/4') && svg.includes('gba/save 1/2'));
});

test('docs/STATUS.md keeps one section of shared code after its table, written again in place', async () => {
  const { sharedPart, withShared } = await import('../readme.mjs');
  const section = text => `## Shared code\n\n${text}\n\n<!-- End of the maps of shared code. -->`;
  const once = withShared('\n', section('none yet'));
  assert.equal(once, `\n\n${section('none yet')}\n`);
  assert.equal(withShared(once, section('none yet')), once);
  assert.equal(withShared(once, section('a map')), `\n\n${section('a map')}\n`);
  assert.equal(sharedPart(once), section('none yet'));
  assert.equal(sharedPart('\n'), null);
});

test('a GBA function is masked where an address goes, and found by its short hash wherever it is', async () => {
  const { masked, shortHash, findLibrary } = await import('../gba/libraries.mjs');
  // push {lr}; bl somewhere; ldr r0, [pc]; pop {pc}; then a word of the work RAM's, as a literal pool holds
  const routine = (call, pointer) => {
    const bytes = Buffer.alloc(12);
    bytes.writeUInt16LE(0xB500, 0);
    bytes.writeUInt16LE(0xF000 | ((call >> 12) & 0x7FF), 2);
    bytes.writeUInt16LE(0xF800 | ((call >> 1) & 0x7FF), 4);
    bytes.writeUInt16LE(0x4800, 6);
    bytes.writeUInt32LE(pointer, 8);
    return bytes;
  };
  const one = routine(0x40, 0x03000100), two = routine(0x200, 0x03000480);
  assert.deepEqual([...masked(one)], [0x00, 0xB5, 0, 0, 0, 0, 0x00, 0x48, 0, 0, 0, 0]);
  assert.equal(shortHash(one), shortHash(two));
  assert.notEqual(shortHash(one), shortHash(routine(0x40, 0x00000100)));
  // the same routine in a made-up copy at 0x08000200, and one that differs in an instruction at 0x08000300
  const rom = Buffer.alloc(0x400);
  two.copy(rom, 0x200);
  const other = Buffer.from(two);
  other.writeUInt16LE(0x4801, 6);
  other.copy(rom, 0x300);
  const codeMap = { functions: [{ address: 0x08000200, size: 12 }, { address: 0x08000300, size: 12 }] };
  const library = { functions: [{ name: 'Routine', size: 12, file: '/lib/routine.c', hash: shortHash(one) }] };
  const found = findLibrary({ library, files: ['/lib/routine.c'], built: null, rom, codeMap });
  assert.deepEqual([...found.functions], [['Routine', 0x08000200]]);
  assert.deepEqual(found.missing, []);
  // without a hash, and with nothing built, it's said why it can't be found
  const unhashed = findLibrary({ library: { functions: [{ name: 'Routine', size: 12, file: '/lib/routine.c' }] }, files: ['/lib/routine.c'], built: null, rom, codeMap });
  assert.match(unhashed.missing[0].why, /no compiler for the Game Boy Advance, and it has no short hash/);
});
