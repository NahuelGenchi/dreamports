// What the route finder reads and writes around its search (lib/route.mjs): what a game says of its original, the
// conditions a goal is written in, the file the search is given and the archive it keeps. The search itself, on a
// console, is tried by npm run test:consoles.
// Run with: node --test tools/test/route.test.mjs

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { checkRoute, checkWait, defaultButtons, holds, maskOf, namesOf, parseCondition, placesOf, readArchive, readRoute, searchFingerprint, specText } from '../lib/route.mjs';
import { originalPlay } from '../lib/recording.mjs';
import { proofGames, readOriginal } from '../lib/proof-files.mjs';
import { referenceOf } from '../lib/reference.mjs';
import { consolesAtOnce } from '../route.mjs';

const KEY = { A: 1, B: 2, SELECT: 4, START: 8, RIGHT: 16, LEFT: 32, UP: 64, DOWN: 128, R: 256, L: 512 };
const values = {
  x: { address: '03005A20', bytes: 4, signed: true, per: 256 },
  y: { address: '03005A24', bytes: 4, signed: true, per: 256 },
  flags: { address: '03005004', bytes: 2 },
  boss: { found: { from: '03000600', to: '03001100', mark: '0804FD85', pointer: -6, pointerBytes: 2, base: '03000000', offset: 149 }, bytes: 1, signed: true },
};
const route = more => ({ values, cells: { x: 32, y: 32 }, lost: ['flags&0x80'], goals: { end: 'flags&2' }, ...more });

test('a condition is a value, a sign and a number, with commas between several', () => {
  assert.deepEqual(parseCondition('x>=9000', values, 'here'), [{ value: 'x', op: '>=', number: 9000 }]);
  assert.deepEqual(parseCondition(' x >= 9000 , y<700,flags&0x2,flags!&4, y != -3', values, 'here'), [
    { value: 'x', op: '>=', number: 9000 }, { value: 'y', op: '<', number: 700 }, { value: 'flags', op: '&', number: 2 },
    { value: 'flags', op: '!&', number: 4 }, { value: 'y', op: '!=', number: -3 },
  ]);
  for (const wrong of ['', 'x', 'x>', 'speed>3', 'x>y', 'x>=1.5', 'x>=9000,', null]) assert.throws(() => parseCondition(wrong, values, 'here'), /here: /, String(wrong));
});

test('a condition is held to what people count in, and a bit to the value as it is', () => {
  const at = { x: 9000 * 256, y: 100 * 256, flags: 0x23 };
  const is = text => holds(parseCondition(text, values, 'here'), values, at);
  assert.ok(is('x>=9000') && is('x=9000') && !is('x>9000') && is('x<=9000') && !is('x!=9000'));
  assert.ok(is('x>=9000,y<700') && !is('x>=9000,y>700'));
  assert.ok(is('flags&2') && !is('flags&0x40') && is('flags!&0x40') && !is('flags!&1'));
});

test('what a game says of its original is checked, with everything wrong with it', () => {
  assert.doesNotThrow(() => checkRoute(route(), 'route.json', { keys: KEY }));
  assert.doesNotThrow(() => checkRoute(route({ apart: { y: 4 }, wait: { frames: 90, states: 3 }, buttons: ['', 'RIGHT A'], goals: { end: 'flags&2', first: 'boss>=0', fight: { after: 'first', when: 'flags&2', cells: { x: 16, boss: 1 }, apart: { y: 2 }, wait: { frames: 30, states: 0 } } } }), 'route.json', { keys: KEY }));
  const said = more => { try { checkRoute(route(more), 'route.json', { keys: KEY }); } catch (error) { return error.message; } return ''; };
  assert.match(said({ values: {} }), /"values" names/);
  assert.match(said({ values: { x: { address: 'here', bytes: 3 } } }), /"bytes" is 1, 2 or 4.*"address" is the work memory's/);
  assert.match(said({ values: { x: { bytes: 4 } } }), /has an "address", or else "found"/);
  assert.match(said({ values: { x: { address: '03005A20', found: {}, bytes: 4 } } }), /has an "address", or else "found"/);
  assert.match(said({ values: { x: { found: { from: '0', to: 'zz' }, bytes: 4 } } }), /"found" has "from"/);
  assert.match(said({ cells: {} }), /"cells" is the grid/);
  assert.match(said({ cells: { speed: 4 } }), /"cells" has speed/);
  assert.match(said({ apart: { x: 0 } }), /"apart" has x/);
  assert.match(said({ wait: { frames: 0, states: 3 } }), /"wait" is \{ "frames", "states" \}/);
  assert.match(said({ goals: { end: { when: 'flags&2', wait: { frames: 90 } } } }), /The goal "end": "wait" is/);
  assert.equal(checkWait(undefined), '');
  assert.match(said({ lost: ['speed>3'] }), /"speed>3" isn't a value/);
  assert.match(said({ goals: { end: 'flags' } }), /the goal "end"/);
  assert.match(said({ goals: { end: { when: 'flags&2', after: 'end' } } }), /comes "after" end/);
  assert.match(said({ goals: { end: { when: 'flags&2', cells: { boss: 0 } } } }), /has boss in its "cells"/);
  assert.match(said({ buttons: ['RIGHT C'] }), /"buttons" has C/);
});

test('every game\'s route.json is one the search can use', async () => {
  for (const game of proofGames()) {
    const { KEY: keys } = await referenceOf(readOriginal(game));
    assert.doesNotThrow(() => readRoute(game, keys), game);
  }
});

test('the buttons a search may hold when a game names none', () => {
  const sets = defaultButtons(KEY);
  assert.equal(sets.length, 25);
  assert.ok(sets.includes('') && sets.includes('RIGHT') && sets.includes('A') && sets.includes('RIGHT A') && sets.includes('DOWN L'));
  assert.ok(!sets.some(set => /START|SELECT/.test(set)), 'neither Start nor Select, which would pause it');
  assert.equal(maskOf('RIGHT A', KEY), 17);
  assert.deepEqual(namesOf(17, KEY), ['A', 'RIGHT']);
});

test('the file the search is given has every value, the grid in the game\'s own units and each condition', () => {
  const text = specText({
    route: route(), goal: [parseCondition('x>=9000,flags&2', values, 'here')], lost: [parseCondition('flags&0x80', values, 'here'), parseCondition('y>2000', values, 'here')],
    cells: { x: 32, y: 16 }, apart: { boss: 1 }, wait: { frames: 90, states: 3 }, buttons: ['', 'RIGHT A'], KEY, files: { prefix: 'prefix.bin', sets: '-', archive: 'archive.bin', out: 'route.bin' },
    seed: 7, seconds: 600, stale: 20000, megabytes: 500, threads: 3,
  });
  assert.deepEqual(text.trim().split('\n'), [
    'prefix prefix.bin', 'sets -', 'archive archive.bin', 'out route.bin',
    `value ${0x03005A20} 4 1`, `value ${0x03005A24} 4 1`, `value ${0x03005004} 2 0`,
    `value-found ${0x03000600} ${0x03001100} 4 ${0x0804FD85} 4 -6 2 ${0x03000000} 149 1 1`,
    'cell 0 8192', 'cell 1 4096', 'apart 3 1', 'wait 90 3',
    'lost 0 2 6 128', `lost 1 1 4 ${2000 * 256}`,
    `goal 0 0 5 ${9000 * 256}`, 'goal 0 2 6 2',
    'buttons 0', 'buttons 17', 'seed 7', 'seconds 600', 'stale 20000', 'megabytes 500', 'threads 3',
  ]);
});

test('a search goes on from what it found only while it starts from the same and reads the same', () => {
  const given = { original: 'abc', prefix: Buffer.from([1, 2]), sets: Buffer.alloc(0), route: route(), cells: { x: 32 }, apart: {}, lost: [], buttons: ['A'] };
  const same = searchFingerprint(given);
  assert.equal(searchFingerprint({ ...given, route: route({ goals: { other: 'x>=1' } }) }), same, 'another goal goes on from the same places');
  for (const other of [{ prefix: Buffer.from([1, 3]) }, { sets: Buffer.from([0]) }, { cells: { x: 16 } }, { apart: { y: 1 } }, { wait: { frames: 90, states: 3 } }, { lost: ['flags&1'] }, { buttons: ['B'] }, { original: 'abd' }]) {
    assert.notEqual(searchFingerprint({ ...given, ...other }), same, JSON.stringify(Object.keys(other)));
  }
});

// an archive as lib/explore.h writes one: its nodes, each with its parent, how many frames since, where its buttons
// start, its frames from the search's start and the game's values there, then every node's buttons
function archiveOf(names, nodes, goal = -1) {
  const pool = nodes.flatMap(node => node.buttons);
  const bytes = Buffer.alloc(24 + nodes.length * (16 + names.length * 8) + pool.length * 4);
  bytes.write('DPRT', 0, 'latin1');
  [1, names.length, nodes.length, pool.length].forEach((n, i) => bytes.writeUInt32LE(n, 4 + i * 4));
  bytes.writeInt32LE(goal, 20);
  let at = 24, first = 0;
  for (const node of nodes) {
    bytes.writeInt32LE(node.parent, at);
    bytes.writeUInt32LE(node.buttons.length, at + 4);
    bytes.writeUInt32LE(first, at + 8);
    bytes.writeUInt32LE(node.frames, at + 12);
    names.forEach((name, i) => bytes.writeBigInt64LE(BigInt(node.values[name]), at + 16 + i * 8));
    at += 16 + names.length * 8;
    first += node.buttons.length;
  }
  pool.forEach((mask, i) => bytes.writeUInt32LE(mask, at + i * 4));
  return bytes;
}

test('the archive gives each node\'s values and the buttons that lead to it', () => {
  const names = ['x', 'y'], per = { x: { per: 256 }, y: { per: 256 } };
  const bytes = archiveOf(names, [
    { parent: -1, buttons: [], frames: 0, values: { x: 100 * 256, y: 50 * 256 } },
    { parent: 0, buttons: [16, 16, 17], frames: 3, values: { x: 140 * 256, y: 50 * 256 } },
    { parent: 1, buttons: [16], frames: 4, values: { x: 143 * 256, y: -3 * 256 } },
    { parent: 0, buttons: [32, 32, 32, 32, 32], frames: 5, values: { x: 141 * 256, y: 60 * 256 } },
  ], 2);
  const archive = readArchive(bytes, names);
  assert.equal(archive.goal, 2);
  assert.deepEqual(archive.nodes[2].values, { x: 143 * 256, y: -3 * 256 });
  assert.deepEqual(archive.route(0), []);
  assert.deepEqual(archive.route(2), [16, 16, 17, 16]);
  assert.deepEqual(archive.route(3), [32, 32, 32, 32, 32]);
  // three places: where it started, the cell the second and the fourth node share, which the second reached sooner,
  // and the one above the top of the stage
  const places = placesOf(archive, { x: 32, y: 32 }, per);
  assert.deepEqual([...places.values()].sort(), [0, 1, 2]);
  assert.throws(() => readArchive(bytes, ['x']), /another kind/);
  assert.throws(() => readArchive(bytes.subarray(0, bytes.length - 4), names), /cut short/);
});

test('the original\'s side of a recording, whole or up to a frame', () => {
  const recording = {
    frames: 10, held: [[0, []], [4, ['A']], [8, []]],
    onlyInOriginal: [{ at: 0, frames: 3, held: [[1, ['START']]], sets: [{ frame: 2, address: '03005168', bytes: 1, value: 9 }] }, { at: 6, frames: 2, held: [[0, ['B']]] }],
  };
  const whole = originalPlay(recording);
  assert.equal(whole.originalHeld.length, 15);
  assert.deepEqual(whole.originalHeld.map(list => list.join('')).join(','), ',START,START,,,,,A,A,B,B,A,A,,');
  assert.deepEqual([...whole.originalOf], [3, 4, 5, 6, 7, 8, 11, 12, 13, 14]);
  assert.deepEqual(whole.sets, [{ frame: 2, address: 0x03005168, bytes: 1, value: 9 }]);
  // up to frame 6, the stretch that goes in before frame 6 is part of the way there
  const part = originalPlay(recording, { frames: 6 });
  assert.deepEqual(part.originalHeld.map(list => list.join('')).join(','), ',START,START,,,,,A,A,B,B');
  assert.equal(originalPlay(recording, { frames: 5 }).originalHeld.length, 8);
  // a game that reads its buttons after the V-blank is given them a frame later, and its values with them
  assert.equal(originalPlay(recording, { keysLate: true }).sets[0].frame, 3);
});

test('how many consoles search at once: the idle cores, or what\'s asked', () => {
  assert.equal(consolesAtOnce(null, { cores: 8, load: 2.4 }), 5);
  assert.equal(consolesAtOnce(null, { cores: 64, load: 1 }), 12);
  assert.equal(consolesAtOnce(null, { cores: 2, load: 5 }), 1);
  assert.equal(consolesAtOnce('3', { cores: 64, load: 0 }), 3);
  for (const wrong of ['0', 'many', '33', '']) assert.throws(() => consolesAtOnce(wrong), /--at-once takes/);
});
