// Tests of which stretches of play `capture` offers (tools/lib/moments.mjs), with made-up numbers for each frame.
// npm run check runs them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KEY } from '../gba/original.mjs';
import { WINDOW, shortlist, stretches } from '../lib/moments.mjs';

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

test('what a list of presses led to is said in numbers, in at most about forty stretches', () => {
  const said = stretches(frames(() => 0.2), playing);
  assert.equal(said[0].from, 0);
  assert.ok(Math.abs(said[0].moved - 0.2) < 1e-9);
  assert.equal(said[0].colours, 100);
  assert.equal(said[0].held, 1);
  const long = Array.from({ length: 60000 }, () => frame(0.1));
  assert.ok(stretches(long, Array(60000).fill(0)).length <= 40);
  assert.equal(stretches(long, Array(60000).fill(0))[0].held, 0);
});

test('the best comes first, since it\'s taken when nobody chooses', () => {
  const dull = frame(0.002), bright = { ...frame(0.2), colourful: 40 };
  const list = Array.from({ length: WINDOW * 3 }, (_, i) => (i < WINDOW ? { ...dull, moved: 0.02 } : bright));
  const [first] = shortlist(list, Array(list.length).fill(KEY.A));
  assert.ok(first >= WINDOW);
});
