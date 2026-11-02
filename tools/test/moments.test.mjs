// Tests of which stretches of play `capture` offers (tools/lib/moments.mjs), with made-up numbers for each frame.
// npm run check runs them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KEY } from '../gba/original.mjs';
import { WINDOW, shortlist } from '../lib/moments.mjs';

const frame = moved => ({ hash: 0, colours: 100, moved, light: 15, colourful: 20 });
const frames = movedAt => Array.from({ length: WINDOW * 2 }, (_, i) => frame(movedAt(i)));
const playing = Array(WINDOW * 2).fill(KEY.A);

test('play is offered, at 60 frames a second', () => {
  assert.ok(shortlist(frames(() => 0.2), playing).length > 0);
});

test('play is offered at 30 frames a second, with every second frame the same as the one before', () => {
  assert.ok(shortlist(frames(i => (i % 2 ? 0 : 0.2)), playing).length > 0);
});

test('what stands still isn\'t offered', () => {
  assert.equal(shortlist(frames(() => 0), playing).length, 0);
  assert.equal(shortlist(frames(i => (i % 10 ? 0 : 0.2)), playing).length, 0, 'with something changing now and then');
});

test('what plays with nobody playing isn\'t offered', () => {
  assert.equal(shortlist(frames(() => 0.2), Array(WINDOW * 2).fill(0)).length, 0);
});
