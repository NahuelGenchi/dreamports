// How many recordings prove plays at once (lib/at-once.mjs), and what a build of a game's C comes from (lib/c.mjs).
// Run with: node --test tools/test/at-once.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { MOST, roomFor } from '../lib/at-once.mjs';
import { buildFingerprint } from '../lib/c.mjs';

const GB = 1e9;

test('a computer with room plays the most at once, and never more than there are', () => {
  assert.equal(roomFor({ cores: 28, load: 1, free: 12 * GB, wanted: 72 }), MOST);
  assert.equal(roomFor({ cores: 28, load: 1, free: 12 * GB, wanted: 3 }), 3);
});

test('busy cores leave fewer, as a second prove on the same computer finds', () => {
  assert.equal(roomFor({ cores: 8, load: 0, free: 12 * GB, wanted: 72 }), 5);
  assert.equal(roomFor({ cores: 8, load: 5, free: 12 * GB, wanted: 72 }), 2);
  assert.equal(roomFor({ cores: 28, load: 20, free: 12 * GB, wanted: 72 }), 5);
});

test('little free memory leaves fewer', () => {
  assert.equal(roomFor({ cores: 28, load: 0, free: 3 * GB, wanted: 72 }), 4);
  assert.equal(roomFor({ cores: 28, load: 0, free: 1.6 * GB, wanted: 72 }), 1);
});

test('there is always one, however full the computer is', () => {
  assert.equal(roomFor({ cores: 2, load: 6, free: 0.2 * GB, wanted: 72 }), 1);
  assert.equal(roomFor({ cores: 1, load: 0, free: 12 * GB, wanted: 72 }), 1);
});

test('--at-once is taken as it is, up to how many there are', () => {
  assert.equal(roomFor({ cores: 2, load: 6, free: 0.2 * GB, wanted: 72, asked: '12' }), 12);
  assert.equal(roomFor({ cores: 28, load: 0, free: 12 * GB, wanted: 5, asked: '12' }), 5);
  assert.equal(roomFor({ cores: 28, load: 0, free: 12 * GB, wanted: 72, asked: '1' }), 1);
  for (const wrong of ['0', '-2', 'many', '2.5', '']) assert.throws(() => roomFor({ cores: 28, load: 0, free: 12 * GB, wanted: 72, asked: wrong }), /--at-once/);
});

test('a build comes from its files, how the compiler is asked and which compiler it is', () => {
  const files = () => ({ games: { walk: { c: { src: { 'game.c': Buffer.from('int a;'), 'game.h': Buffer.from('extern int a;') } } } }, kit: { c: { 'kit.h': Buffer.from('// the kit') } } });
  const args = ['clang', '-O2', 'games/walk/c/src/game.c'];
  const same = buildFingerprint(files(), args, '21.1.4');
  assert.equal(buildFingerprint(files(), [...args], '21.1.4'), same);
  // a changed file, a header too, a new file, another flag and another compiler each give another
  const changed = files();
  changed.games.walk.c.src['game.c'] = Buffer.from('int b;');
  assert.notEqual(buildFingerprint(changed, args, '21.1.4'), same);
  const header = files();
  header.kit.c['kit.h'] = Buffer.from('// the kit, changed');
  assert.notEqual(buildFingerprint(header, args, '21.1.4'), same);
  const added = files();
  added.games.walk.c.src['more.c'] = Buffer.from('');
  assert.notEqual(buildFingerprint(added, args, '21.1.4'), same);
  assert.notEqual(buildFingerprint(files(), [...args, '-g'], '21.1.4'), same);
  assert.notEqual(buildFingerprint(files(), args, '21.1.5'), same);
});

test('the same bytes under another name, or split another way, are another build', () => {
  const one = { src: { 'a.c': Buffer.from('xy'), 'b.c': Buffer.from('') } };
  const other = { src: { 'a.c': Buffer.from('x'), 'b.c': Buffer.from('y') } };
  const renamed = { src: { 'c.c': Buffer.from('xy'), 'b.c': Buffer.from('') } };
  assert.notEqual(buildFingerprint(one, [], '1'), buildFingerprint(other, [], '1'));
  assert.notEqual(buildFingerprint(one, [], '1'), buildFingerprint(renamed, [], '1'));
});
