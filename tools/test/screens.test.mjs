// What a game says of its screen (lib/screens.mjs).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkSizes, firstOtherSize, forGame, sizeAt, sizesIn } from '../lib/screens.mjs';

const CONSOLE = { name: 'Some Console', screen: [320, 224], core: {} };

test('a size, or a list of them, or none', () => {
  assert.equal(sizesIn(undefined), null);
  assert.deepEqual(sizesIn([256, 224]), [[256, 224]]);
  assert.deepEqual(sizesIn([[320, 224], [256, 224]]), [[320, 224], [256, 224]]);
  for (const wrong of [[], [256], [256, 0], [256, 224, 1], ['256', 224], [[256, 224], [320]], [[]], 256, 'big', null]) assert.throws(() => sizesIn(wrong), /a width and a height/, JSON.stringify(wrong));
});

test('a game has its own sizes, with room for any of them', () => {
  assert.deepEqual(forGame(CONSOLE, {}), { ...CONSOLE, screens: [[320, 224]], said: false });
  const one = forGame(CONSOLE, { screen: [256, 224] });
  assert.deepEqual([one.screen, one.screens, one.said], [[256, 224], [[256, 224]], true]);
  const two = forGame(CONSOLE, { screen: [[256, 448], [320, 224]] });
  assert.deepEqual(two.screen, [320, 448]);
});

test('a Game Boy Advance game has no say', () => {
  const gba = { name: 'Game Boy Advance', screen: [240, 160], core: null };
  assert.deepEqual(forGame(gba, {}).screen, [240, 160]);
  assert.throws(() => forGame(gba, { screen: [240, 160] }), /always 240 by 160/);
});

test('the size at a frame, from the changes', () => {
  const changes = [[3, 320, 224], [10, 256, 224]];
  assert.equal(sizeAt(changes, 2), null);
  assert.deepEqual(sizeAt(changes, 3), [320, 224]);
  assert.deepEqual(sizeAt(changes, 9), [320, 224]);
  assert.deepEqual(sizeAt(changes, 10), [256, 224]);
});

test('a size the game does not list stops it, with what to write', () => {
  const game = forGame(CONSOLE, { screen: [256, 224] });
  const changes = [[0, 256, 224], [10, 320, 224]];
  assert.doesNotThrow(() => checkSizes(undefined, game, [1, 2]));
  assert.doesNotThrow(() => checkSizes(changes, game, [1, 9]));
  assert.throws(() => checkSizes(changes, game, [1, 9, 10]), /320 by 224 at frame 10, and its original.json says 256 by 224.*"screen": \[\[256,224\],\[320,224\]\]/);
  // named as the caller counts them
  assert.throws(() => checkSizes(changes, game, [9, 10], (_, i) => i), /320 by 224 at frame 1,/);
  assert.throws(() => checkSizes(changes, forGame(CONSOLE, {}), [1]), /256 by 224 at frame 1, and kit\/consoles.js says 320 by 224 for the Some Console.*"screen": \[256,224\]/);
  // nothing shown yet says nothing
  assert.doesNotThrow(() => checkSizes([[5, 256, 224]], game, [1, 2, 5]));
});

test('the first frame where the two sizes differ', () => {
  const theirs = [[0, 320, 224], [11, 256, 224]], ours = [[0, 320, 224], [10, 256, 224]];
  assert.equal(firstOtherSize(theirs, ours, 20, f => f + 1), null);
  assert.deepEqual(firstOtherSize(theirs, ours, 20, f => f), { frame: 10, original: [320, 224], dreamport: [256, 224] });
  assert.equal(firstOtherSize(theirs, ours, 10, f => f), null);
  assert.equal(firstOtherSize([], ours, 5, f => f), null);
});
