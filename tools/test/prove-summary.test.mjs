// How a whole game's proof sums up the recordings that came out as before (prove.mjs).
// Run with: node --test tools/test/prove-summary.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { summed } from '../prove.mjs';

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
