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
  const cells = (states, size = 10) => states.map((state, i) => ({ name: `F${i}`, size, state }));
  const library = (id, states) => {
    const made = cells(states), proven = made.filter(cell => cell.state === 'bytes' || cell.state === 'memory');
    return { id, functions: made.length, proven: proven.length, bytes: made.length * 10, provenBytes: proven.length * 10, versions: ['a/c'], cells: made };
  };
  const console = {
    id: 'gba', name: 'Game Boy Advance', functions: 6, bytes: 60, proven: 3, provenBytes: 30, versions: 2, games: 2,
    libraries: [library('gba/sound', ['bytes', 'memory', 'written', 'unwritten']), library('gba/save', ['bytes', 'unwritten'])],
  };
  const { svg, alt } = sharedMap(console);
  assert.equal(alt, 'Game Boy Advance: 50% of its known shared code proven, 30 of 60 bytes and 3 of 6 functions, in 2 libraries, taken by 2 games.');
  assert.equal(sharedText(console), alt.slice(0, -1));
  // one square for each function, in a path of its state's class
  const squares = state => (new RegExp(`<path class="${state}" d="([^"]*)"`).exec(svg)?.[1].match(/M/g) ?? []).length;
  assert.deepEqual(Object.keys(STATES).map(squares), [2, 1, 1, 2]);
  // each library by its own name, with how many of its functions are written, and a bar of what's proven
  assert.ok(svg.includes('>sound</text>') && svg.includes('>3/4 written</text>') && svg.includes('>save</text>') && svg.includes('>1/2 written</text>'));
  assert.ok(!svg.includes('gba/sound</text>'));
  assert.equal((svg.match(/<rect class="track"/g) ?? []).length, 2);
  // the reader's theme: dark, and light where the reader asks for it, each state's colour in both
  assert.match(svg, /@media \(prefers-color-scheme:light\)\{/);
  for (const { dark, light } of Object.values(STATES)) assert.ok(svg.includes(dark) && svg.includes(light));
});

test('a map\'s labels are always whole, and its cells on one grid, at any width', async () => {
  const { sharedMap } = await import('../../src/lib/shared-map.mjs');
  const library = (id, size, states) => ({ id, functions: size, proven: 0, bytes: size * 20, provenBytes: 0, versions: [], cells: [...Array(size)].map((_, i) => ({ name: `F${i}`, size: 20, state: states[i % states.length] })) });
  const console = {
    id: 'gba', name: 'Game Boy Advance', functions: 0, bytes: 0, proven: 0, provenBytes: 0, versions: 0, games: 0,
    libraries: [library('gba/a-long-library-name', 140, ['bytes', 'written']), library('gba/x', 3, ['unwritten']), library('gba/medium', 30, ['memory']), library('gba/tiny', 1, ['written'])],
  };
  for (const width of [480, 390, 320]) {
    const { svg } = sharedMap(console, { width });
    const blocks = [...svg.matchAll(/<rect class="block" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"/g)].map(([, x, y, w]) => ({ x: +x, y: +y, w: +w }));
    assert.equal(blocks.length, 4);
    for (const block of blocks) assert.ok(block.x >= 0 && block.x + block.w <= width, `a block inside ${width} pixels`);
    // a label is no wider than its block, at the width the map measures text by
    const blockAt = (x, y) => blocks.find(each => x >= each.x && x <= each.x + each.w && y >= each.y && y <= each.y + 40);
    for (const [, x, y, rest, text] of svg.matchAll(/<text class="(?:text|dim)" x="([\d.]+)" y="([\d.]+)" font-size="(?:1[01]|22)"([^>]*)>([^<]+)<\/text>/g)) {
      const wide = text.length * 11 * 0.62, [from, to] = /text-anchor="end"/.test(rest) ? [+x - wide, +x] : [+x, +x + wide];
      const block = blockAt(+x, +y) ?? { x: 0, w: width };
      assert.ok(from >= block.x && to <= block.x + block.w, `"${text}" fits ${block.w === width ? 'the map' : 'its block'} at ${width} pixels`);
    }
    // every cell on one grid, across and down
    const corners = [...svg.matchAll(/M([\d.]+) ([\d.]+)h/g)].map(([, x, y]) => [+x % 10, +y % 10]);
    assert.equal(new Set(corners.map(([x]) => x)).size, 1);
    assert.equal(new Set(corners.map(([, y]) => y)).size, 1);
  }
  // at a phone's width the blocks take more rows than on a wide screen
  const tops = width => new Set([...sharedMap(console, { width }).svg.matchAll(/<rect class="block" x="[\d.]+" y="([\d.]+)"/g)].map(([, y]) => y)).size;
  assert.ok(tops(320) > tops(480));
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

test('an NES function is masked at each address its instructions name, and nowhere else', async () => {
  const { masked, placesOf, shortHash } = await import('../nes/libraries.mjs');
  // CLC, ADC $20, STA $0300,X, LDA #$05, BCC +2, JSR $C123, RTS
  const one = Buffer.from([0x18, 0x65, 0x20, 0x9D, 0x00, 0x03, 0xA9, 0x05, 0x90, 0x02, 0x20, 0x23, 0xC1, 0x60]);
  assert.deepEqual(placesOf(one), [{ at: 2, bytes: 1 }, { at: 4, bytes: 2 }, { at: 11, bytes: 2 }]);
  assert.deepEqual([...masked(one)], [0x18, 0x65, 0, 0x9D, 0, 0, 0xA9, 0x05, 0x90, 0x02, 0x20, 0, 0, 0x60]);
  const elsewhere = Buffer.from(one);
  elsewhere[2] = 0x40;
  elsewhere.writeUInt16LE(0x0480, 4);
  elsewhere.writeUInt16LE(0xC456, 11);
  assert.equal(shortHash(elsewhere), shortHash(one));
  // an immediate value or a branch is the routine's own, so one that differs is another routine
  const other = Buffer.from(one);
  other[7] = 0x06;
  assert.notEqual(shortHash(other), shortHash(one));
});
