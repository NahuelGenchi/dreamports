// What counts as the same sound (lib/sound.mjs), on made-up tones: a wrong or missing sound differs, and a dip, one
// band falling away for a moment as two voices on a note cancel, doesn't. npm run check runs them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIP_FRAMES, makeFilter, soundOf } from '../lib/sound.mjs';

const RATE = 65536, SAMPLES = 1097, FRAMES = 80;
const dB = by => 10 ** (by / 20);

// `frames` frames of tones, the same on both sides: `tones(frame)` gives each one's pitch in Hz and how loud it is in
// that frame, in the console's steps
function sound(tones, frames = FRAMES) {
  return Array.from({ length: frames }, (_, frame) => {
    const samples = new Int16Array(SAMPLES * 2);
    for (let i = 0; i < SAMPLES; i++) {
      const t = (frame * SAMPLES + i) / RATE;
      const v = Math.round(tones(frame).reduce((sum, [hz, loud]) => sum + loud * Math.sin(2 * Math.PI * hz * t), 0));
      samples[i * 2] = samples[i * 2 + 1] = v;
    }
    return samples;
  });
}

// the frames whose sound differs, and those let through as dips, with `theirs` as the original's and `ours` as the Dreamport's
function compared(theirs, ours) {
  const compare = soundOf({ lengths: new Uint32Array(theirs.length).fill(SAMPLES), read: frame => theirs[frame] });
  const filter = makeFilter(RATE), heard = [], differs = [], originalOf = Array.from(ours, (_, f) => f);
  for (let f = 0; f < ours.length; f++) {
    const energies = new Float64Array(16);
    filter(ours[f], energies);
    heard.push({ energies, samples: SAMPLES });
    // a frame is measured with the one after it, so it's compared once that one is in
    if (f > 0 && compare(heard, originalOf, f - 1)) differs.push(f - 1);
  }
  if (compare(heard, originalOf, ours.length - 1)) differs.push(ours.length - 1);
  return { differs, dips: compare.dips };
}

const music = quiet => frame => [[500, quiet(frame) ? 100 * dB(-13) : 100], [2000, 60]];
const original = sound(music(() => false));

test('the same sound is the same, with no dips', () => {
  assert.deepEqual(compared(original, sound(music(() => false))), { differs: [], dips: [] });
});

test('one band 13 dB quieter for three frames is a dip, and counts as the same', () => {
  const { differs, dips } = compared(original, sound(music(frame => frame >= 30 && frame < 33)));
  assert.deepEqual(differs, []);
  assert.ok(dips.length >= 1 && dips.every(f => f >= 28 && f <= 34), `dips at ${dips}`);
});

test('a dip the other way, in the original, counts as the same too', () => {
  assert.deepEqual(compared(sound(music(frame => frame >= 30 && frame < 33)), original).differs, []);
});

test('a band that stays 13 dB quieter differs once it has lasted longer than a dip', () => {
  const { differs, dips } = compared(original, sound(music(frame => frame >= 30 && frame < 60)));
  assert.equal(dips.length, DIP_FRAMES);
  assert.equal(differs[0], dips.at(-1) + 1);
  assert.ok(differs.length >= 15, `${differs.length} frames differ`);
});

test('a dip right after a sound that is wrong is no dip', () => {
  // the band falls 25 dB, which differs, then sits 13 dB down for three frames
  const lone = wrong => frame => [[500, !wrong || frame < 30 || frame >= 38 ? 100 : frame < 35 ? 100 * dB(-25) : 100 * dB(-13)], [8000, 5]];
  const { differs, dips } = compared(sound(lone(false)), sound(lone(true)));
  assert.ok(differs.includes(36), `differs at ${differs}`);
  assert.deepEqual(dips.filter(f => f >= 31 && f <= 37), []);
});

test('a band 25 dB quieter differs at once', () => {
  // with little else playing, so the band has that far to fall
  const lone = quiet => frame => [[500, quiet && frame >= 30 && frame < 35 ? 100 * dB(-25) : 100], [8000, 5]];
  const { differs, dips } = compared(sound(lone(false)), sound(lone(true)));
  assert.ok(differs.length >= 3 && differs[0] <= 31, `differs at ${differs}`);
  assert.deepEqual(dips.filter(f => f >= 31 && f <= 33), []);
});

test('two bands apart, both 13 dB quieter, differ: a dip is one note', () => {
  const both = frame => { const by = frame >= 30 && frame < 33 ? dB(-13) : 1; return [[500, 100 * by], [2000, 60 * by]]; };
  assert.ok(compared(original, sound(both)).differs.length >= 1);
});

// the sound effect the Dreamport leaves out: `loud` steps at 4 kHz, for `frames` frames, over the music
const without = (loud, frames) => {
  const effect = on => frame => [[500, 100], ...(on && frame >= 30 && frame < 30 + frames ? [[4000, loud]] : [])];
  return compared(sound(effect(true)), sound(effect(false)));
};

test('a sound that is missing differs when it lasts longer than a dip', () => {
  assert.ok(without(40, 20).differs.length >= 1);
});

test('a loud sound that is missing differs, however short', () => {
  assert.ok(without(150, 3).differs.length >= 1);
});

test('a quiet sound three frames long, missing under the music, is taken for a dip: what the rule costs', () => {
  assert.deepEqual(without(40, 3).differs, []);
});

test('silence where the original plays differs', () => {
  const { differs, dips } = compared(original, sound(frame => (frame >= 30 && frame < 33 ? [] : music(() => false)(frame))));
  assert.ok(differs.length >= 1);
  assert.deepEqual(dips, []);
});
