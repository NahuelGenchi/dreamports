// How a whole game's proof sums up the recordings that came out as before, and what prove says of a recording no part
// names (prove.mjs).
// Run with: node --test tools/test/prove-summary.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { partsItCouldProve, summed } from '../prove.mjs';

test('recordings with every frame the same, and those that differ from the same frame as before', () => {
  const lines = summed([
    { name: 'logos', frames: 900, matched: 900, differs: [] },
    { name: 'title', frames: 600, matched: 600, differs: [] },
    { name: 'act-1', frames: 3400, matched: 2077, differs: [[2077, 3399]] },
  ], 5);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /3 of 5 recordings came out as when last proven/);
  assert.match(lines[0], /--all/);
  assert.equal(lines[1], '  Every frame the same, 2: logos, title.');
  assert.equal(lines[2], '  Differing from the same frame as before, 1: act-1 from 2077.');
});

test('only the kinds there are', () => {
  assert.equal(summed([{ name: 'logos', frames: 900, matched: 900, differs: [] }], 1).length, 2);
  const differing = summed([{ name: 'act-1', frames: 3400, matched: 0, differs: [[0, 3399]] }], 1);
  assert.equal(differing.length, 2);
  assert.match(differing[1], /act-1 from 0\.$/);
});

test('a recording no part names, in a game with parts that have no recording yet', () => {
  const parts = [
    { name: 'The title screen', recording: 'title', frames: [0, 119] },
    { name: 'The stage map' },
    { name: 'Stage 1: The graveyard', needs: ['The enemies'] },
  ];
  const line = partsItCouldProve('stage-clear', parts);
  assert.match(line, /^No part names this recording, and 2 of the game's parts have no recording yet: The stage map, Stage 1: The graveyard\. /);
  assert.match(line, /once parts\.json names this recording and those frames/);
  assert.match(line, /help proving a part\.$/);
  assert.match(partsItCouldProve('stage-clear', parts.slice(0, 2)), /one of the game's parts has no recording yet: The stage map\. /);
});

test('only the first few parts are named', () => {
  const parts = Array.from({ length: 7 }, (_, at) => ({ name: `Stage ${at + 1}` }));
  assert.match(partsItCouldProve('walk', parts), /Stage 1, Stage 2, Stage 3, Stage 4, and 3 more\. /);
});

test('nothing to say when a part names the recording, or every part has one', () => {
  const parts = [{ name: 'The title screen', recording: 'title', frames: [0, 119] }, { name: 'The stage map' }];
  assert.equal(partsItCouldProve('title', parts), null);
  assert.equal(partsItCouldProve('walk', parts.slice(0, 1)), null);
  assert.equal(partsItCouldProve('walk', []), null);
});
