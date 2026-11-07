// What a recording shows (src/lib/shows.mjs): a recording named for a character has to play them, as the original's
// own memory says, and npm run check stops on one that doesn't, as Sonic Battle's Shadow recordings once played Cream.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kindsOf, namedIn, shownOf, showsProblems, slugOf } from '../../src/lib/shows.mjs';
import { proofOf } from '../../src/lib/entries.mjs';

const original = {
  name: 'Made Up', sha1: 'abc',
  shows: { fighter: { address: '03001634', bytes: 1, names: { 0: 'Sonic', 3: 'Shadow', 5: 'Amy', 6: 'Cream', 11: 'Neo Metal' } } },
};
const kinds = kindsOf(original);

test('a kind is read with its address as a number and each value\'s name', () => {
  assert.deepEqual(kinds.map(({ kind, address, bytes }) => [kind, address, bytes]), [['fighter', 0x03001634, 1]]);
  assert.equal(kinds[0].names.get(3), 'Shadow');
  assert.deepEqual(kindsOf({}), [], 'a game that lists nothing checks nothing');
  assert.equal(slugOf('Neo Metal'), 'neo-metal');
});

test('a list that isn\'t written as it must be is refused, naming why', () => {
  assert.throws(() => kindsOf({ shows: { fighter: { address: 'zz', bytes: 3, names: { 0: 'Sonic' } } } }), /address.*bytes/s);
  assert.throws(() => kindsOf({ shows: { fighter: { address: '03001634', bytes: 1, names: {} } } }), /gives each value its name/);
  assert.throws(() => kindsOf({ shows: { fighter: { address: '03001634', bytes: 1, names: { 0: 'Amy', 5: 'amy' } } } }), /couldn't tell them apart/);
});

test('a recording\'s name names a character only as whole words', () => {
  assert.deepEqual(namedIn('shadow-moving', kinds[0]), ['Shadow']);
  assert.deepEqual(namedIn('specials-shot', kinds[0]), []);
  assert.deepEqual(namedIn('a-dreamy-shadowless-stage', kinds[0]), [], 'a name inside another word isn\'t one');
  assert.deepEqual(namedIn('neo-metal-race', kinds[0]), ['Neo Metal'], 'a name of more than one word');
  assert.deepEqual(namedIn('Amy-X-Zone', kinds[0]), ['Amy']);
});

test('what the original held becomes names, or the number when the list gives it none', () => {
  assert.deepEqual(shownOf(kinds, [6]), { fighter: 'Cream' });
  assert.deepEqual(shownOf(kinds, [10]), { fighter: 10 });
});

test('a recording named for one character that plays another fails, and one that plays them passes', () => {
  assert.deepEqual(showsProblems('shadow-moving', { fighter: 'Shadow' }, kinds), []);
  assert.match(showsProblems('shadow-moving', { fighter: 'Cream' }, kinds)[0], /shadow-moving is named for Shadow, but the original's fighter is Cream/);
  assert.match(showsProblems('chaos-moves', { fighter: 10 }, kindsOf({ shows: { fighter: { address: '03001634', bytes: 1, names: { 8: 'Chaos' } } } }))[0], /fighter is 10, which original\.json gives no name/);
  assert.match(showsProblems('amy-moves', undefined, kinds)[0], /hasn't been proven since original\.json listed the fighter.*prove it again/);
  assert.deepEqual(showsProblems('specials-shot', undefined, kinds), [], 'a recording named for nobody needs nothing');
  assert.deepEqual(showsProblems('anything', undefined, []), [], 'a game that lists nothing checks nothing');
});

test('npm run check stops on a recording that plays someone its name doesn\'t say', () => {
  const measured = shows => ({ original, recordings: { 'shadow-moving': { held: [], frames: 10 } }, progress: { original: 'abc', recordings: { 'shadow-moving': { frames: 10, matched: 10, differs: [], functions: [], ...(shows ? { shows } : {}) } } } });
  assert.doesNotThrow(() => proofOf('made-up', measured({ fighter: 'Shadow' })));
  assert.throws(() => proofOf('made-up', measured({ fighter: 'Cream' })), /progress\.json: shadow-moving is named for Shadow, but the original's fighter is Cream/);
  assert.throws(() => proofOf('made-up', measured(null)), /hasn't been proven since/);
  assert.throws(() => proofOf('made-up', { ...measured({ fighter: 'Shadow' }), original: { ...original, shows: { fighter: { address: 'x' } } } }), /original\.json/);
});
