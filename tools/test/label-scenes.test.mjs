// The site's own scenes in the label rows, and how the rows are laid out (src/scripts/label-scenes/,
// src/scripts/label-rows.mjs, docs/LABELS.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, NAMES, SCENE_H, drawScene } from '../../src/scripts/label-scenes/index.mjs';
import { INVITES, drawInvite } from '../../src/scripts/label-scenes/invite.mjs';
import { steady } from '../../src/scripts/label-scenes/steady.mjs';
import { PLACE, invitesFor, kindOf, layout, placesFor, rowOrder, seedOf } from '../../src/scripts/label-rows.mjs';

test('there are 30 kinds of scene, each with its own name', () => {
  assert.equal(KINDS, 30);
  assert.equal(new Set(NAMES).size, KINDS);
  assert.equal(SCENE_H, 60);
});

test('every kind fills every pixel of its place, at every width a row can give it', () => {
  for (let kind = 0; kind < KINDS; kind++) {
    for (const width of [120, 151, 179, 200, 239, 240]) {
      for (const seed of [1, 0xdeadbeef, seedOf(3, 7)]) {
        const pixels = drawScene(width, kind, seed);
        assert.equal(pixels.length, width * SCENE_H * 4, `${NAMES[kind]} at ${width}`);
        for (let i = 3; i < pixels.length; i += 4) {
          if (pixels[i] !== 255) {
            const at = (i - 3) / 4;
            assert.fail(`${NAMES[kind]} at ${width} wide, seed ${seed}, leaves pixel ${at % width},${Math.floor(at / width)} open`);
          }
        }
      }
    }
  }
});

test('a scene is the same every time from the same number, and different from another number', () => {
  for (let kind = 0; kind < KINDS; kind++) {
    const a = drawScene(240, kind, seedOf(0, 4));
    assert.deepEqual(drawScene(240, kind, seedOf(0, 4)), a, NAMES[kind]);
    assert.notDeepEqual(drawScene(240, kind, seedOf(5, 4)), a, NAMES[kind]);
  }
});

test('a row is exactly a place wider than the screen, and no place is wider than a label', () => {
  for (let width = 200; width <= 4000; width += 7) {
    const places = placesFor(width, 0);
    assert.equal(places.reduce((a, b) => a + b, 0), width + PLACE, `at ${width}`);
    const odd = places.filter((w) => w !== PLACE);
    assert.ok(odd.length <= 2, `at ${width}`);
    // never wider than a label, so a place and its repeat are never on the screen at once
    for (const w of odd) assert.ok(w >= PLACE / 2 && w < PLACE, `${w} at ${width}`);
  }
  assert.deepEqual(placesFor(1200, 0), [240, 240, 240, 240, 240, 240]);
  assert.deepEqual(placesFor(1440, 0), [240, 240, 240, 240, 240, 240, 240]);
  assert.deepEqual(placesFor(390, 0), [240, 240, 150]);
  assert.deepEqual(placesFor(1280, 0), [240, 240, 240, 240, 240, 160, 160]);
  assert.deepEqual(placesFor(300, 0), [240, 150, 150]);
});

test('a row given more labels than it holds grows to fit them all', () => {
  assert.deepEqual(placesFor(390, 2), [240, 240, 150]);
  assert.deepEqual(placesFor(390, 3), [240, 240, 240]);
  assert.deepEqual(placesFor(390, 5), [240, 240, 240, 240, 240]);
  assert.deepEqual(placesFor(1280, 5), [240, 240, 240, 240, 240, 160, 160]);
  assert.deepEqual(placesFor(1280, 6), [240, 240, 240, 240, 240, 240, 240]);
});

test('no place shows the same kind as its row\'s next nine places or any place in the rows beside it', () => {
  for (let row = 0; row < 40; row++) {
    for (let place = 0; place < 40; place++) {
      for (let d = 1; d < 10; d++) assert.notEqual(kindOf(row, place), kindOf(row, place + d), `${row}, ${place} and ${d} on`);
      for (let other = 0; other < 40; other++) {
        for (const near of [row + 1, row + 2]) assert.notEqual(kindOf(row, place), kindOf(near, other), `${row}, ${place} and ${near}, ${other}`);
      }
    }
  }
});

test('no two places in a screenful of rows share a number', () => {
  const seen = new Set();
  for (let row = 0; row < 60; row++) for (let place = 0; place < 40; place++) seen.add(seedOf(row, place));
  assert.equal(seen.size, 60 * 40);
});

test('every invitation fills its place, the same from the same number, with a sky of its own', () => {
  for (const words of INVITES) {
    const first = drawInvite(words, seedOf(0, 2));
    assert.equal(first.length, PLACE * SCENE_H * 4);
    for (let i = 3; i < first.length; i += 4) assert.equal(first[i], 255, `${words} leaves a pixel open`);
    assert.deepEqual(drawInvite(words, seedOf(0, 2)), first, words);
    assert.notDeepEqual(drawInvite(words, seedOf(13, 4)), first, words);
  }
  assert.throws(() => drawInvite('YOUR GAME HERE', 1), /No invitation says YOUR GAME HERE/);
});

test('rows furthest from the game take labels first, and a row mostly off the screen takes them last', () => {
  assert.deepEqual(rowOrder(15, 900).slice(0, 4), [0, 14, 1, 13]);
  // 844 high: the top row shows only 4 pixels
  const phone = rowOrder(15, 844);
  assert.equal(phone.at(-1), 14);
  assert.deepEqual(phone.slice(0, 3), [0, 13, 1]);
  assert.deepEqual(rowOrder(12, 720).slice(0, 2), [0, 11]);
});

test('a few rows hold an invitation, apart from each other, of both kinds', () => {
  const rowsOf = (width, height, labels = 0) =>
    layout(width, height, labels).flatMap((row, r) => (row.invite ? [r] : []));
  assert.deepEqual(rowsOf(1440, 900), [0, 2, 13]);
  assert.deepEqual(rowsOf(1280, 720), [0, 10]);
  assert.deepEqual(rowsOf(390, 844), [0, 2, 12]);
  assert.equal(rowsOf(2560, 1800).length, 6);
  assert.equal(invitesFor(rowOrder(2, 120)).length, 1);
  const words = layout(1440, 900, 0).flatMap((row) => (row.invite ? [row.invite.words] : []));
  assert.deepEqual(new Set(words), new Set(INVITES));
});

test('labels fill the rows furthest from the game first, each in its own place of 240', () => {
  const rows = layout(1440, 900, 24);
  assert.equal(rows.reduce((n, row) => n + row.labels.length, 0), 24);
  assert.deepEqual(new Set(rows.flatMap((row) => row.labels.map((label) => label.index))).size, 24);
  for (const row of rows) {
    const places = row.labels.map((label) => label.place);
    assert.equal(new Set(places).size, places.length);
    for (const k of places) assert.equal(row.places[k], PLACE);
  }
  assert.equal(rows[0].labels.length, 2);
  assert.equal(rows[7].labels.length, 1);
});

test('an invitation never takes a label\'s place, and moves to the next row along when its own is full', () => {
  for (const [width, height] of [[1440, 900], [1280, 720], [390, 844], [800, 600]]) {
    for (let labels = 0; labels <= 60; labels++) {
      for (const row of layout(width, height, labels)) {
        if (!row.invite) continue;
        assert.equal(row.places[row.invite.place], PLACE);
        assert.ok(!row.labels.some((label) => label.place === row.invite.place), `${width} x ${height} with ${labels}`);
      }
    }
  }
  // 24 labels on a phone fill the rows the invitations would take, so they move on to rows with room
  const phone = layout(390, 844, 24);
  assert.equal(phone.filter((row) => row.invite).length, 3);
  // a screen with no room left holds none
  assert.equal(layout(390, 844, 30).filter((row) => row.invite).length, 0);
});

// How much a picture's sharpness swings as a row glides across a pixel, at its worst 8 x 4 spot, on the screen's own
// values: the light tint and the rows' 32% over white, with the screen blending neighbours between pixels.
const MATRIX = [0.65, 0.295, 0.055, -0.1005, 0.15, 0.795, 0.055, 0.0289, 0.15, 0.295, 0.555, 0.1191];
function flicker(pixels, w) {
  const Y = new Float32Array(w * SCENE_H);
  for (let i = 0; i < Y.length; i++) {
    const c = [0, 1, 2].map((k) => (pixels[i * 4 + k] / 255) * 0.63 + 0.385);
    const t = [0, 1, 2].map((r) => Math.min(1, Math.max(0, MATRIX[r * 4] * c[0] + MATRIX[r * 4 + 1] * c[1] + MATRIX[r * 4 + 2] * c[2] + MATRIX[r * 4 + 3])));
    Y[i] = (0.2126 * (0.32 * t[0] + 0.68) + 0.7152 * (0.32 * t[1] + 0.68) + 0.0722 * (0.32 * t[2] + 0.68)) * 255;
  }
  let worst = 0;
  for (let y0 = 0; y0 + 4 <= SCENE_H; y0 += 2)
    for (let x0 = 2; x0 + 10 <= w; x0 += 4) {
      const sharp = [0, 0.25, 0.5].map((f) => {
        let a = 0;
        for (let y = y0; y < y0 + 4; y++)
          for (let x = x0; x < x0 + 8; x++) {
            const at = (q) => (1 - f) * Y[y * w + q] + f * Y[y * w + q + 1];
            a += (at(x + 1) - at(x)) ** 2;
          }
        return Math.sqrt(a / 32);
      });
      worst = Math.max(worst, Math.max(...sharp) - Math.min(...sharp));
    }
  return worst;
}

test('softened for a gliding row, no scene flickers much, and most pixels stay as drawn', () => {
  let before = 0, after = 0, touched = 0, total = 0;
  for (let kind = 0; kind < KINDS; kind++) {
    const pixels = drawScene(240, kind, seedOf(1, kind));
    const calm = steady(pixels, 240);
    assert.equal(calm.length, pixels.length);
    for (let i = 0; i < pixels.length; i += 4) {
      total++;
      if (pixels[i] !== calm[i] || pixels[i + 1] !== calm[i + 1] || pixels[i + 2] !== calm[i + 2]) touched++;
      assert.equal(calm[i + 3], 255);
    }
    before = Math.max(before, flicker(pixels, 240));
    after = Math.max(after, flicker(calm, 240));
  }
  assert.ok(after <= 8, `the worst flicker is ${after.toFixed(1)}`);
  assert.ok(after < before * 0.45, `from ${before.toFixed(1)} to ${after.toFixed(1)}`);
  assert.ok(touched / total < 0.3, `${((100 * touched) / total).toFixed(1)}% of pixels changed`);
  // a flat picture, or one with only gentle steps, is left exactly as it is
  const flat = new Uint8ClampedArray(240 * SCENE_H * 4).fill(200);
  assert.deepEqual(steady(flat, 240), flat);
});

// How much a long upright edge's sharpness swings as a row glides, in a spot 6 wide and the whole place tall.
function edgeFlicker(pixels, w, x0) {
  const Y = new Float32Array(w * SCENE_H);
  for (let i = 0; i < Y.length; i++) Y[i] = 0.2126 * pixels[i * 4] + 0.7152 * pixels[i * 4 + 1] + 0.0722 * pixels[i * 4 + 2];
  const [sharp, soft] = [0, 0.5].map((f) => {
    let a = 0;
    for (let y = 0; y < SCENE_H; y++)
      for (let x = x0; x < x0 + 6; x++) {
        const at = (q) => (1 - f) * Y[y * w + q] + f * Y[y * w + q + 1];
        a += (at(x + 1) - at(x)) ** 2;
      }
    return Math.sqrt(a / (6 * SCENE_H));
  });
  return Math.abs(sharp - soft);
}

test('the line where two places meet, and long upright edges, soften the most', () => {
  // a night sky beside a sunny street, which flickered most where they met
  const row = new Uint8ClampedArray(480 * SCENE_H * 4);
  const night = drawScene(240, NAMES.indexOf('space'), 7);
  const day = drawScene(240, NAMES.indexOf('plaza'), 8);
  for (let y = 0; y < SCENE_H; y++) {
    row.set(night.subarray(y * 960, (y + 1) * 960), y * 1920);
    row.set(day.subarray(y * 960, (y + 1) * 960), y * 1920 + 960);
  }
  const calm = steady(row, 480, [0, 240]);
  const before = edgeFlicker(row, 480, 237);
  const after = edgeFlicker(calm, 480, 237);
  assert.ok(after < before * 0.4, `where they meet, from ${before.toFixed(1)} to ${after.toFixed(1)}`);
  // without being told where places meet, the same long edge still softens, if less
  const unseen = edgeFlicker(steady(row, 480), 480, 237);
  assert.ok(unseen < before * 0.7, `an unmarked long edge, from ${before.toFixed(1)} to ${unseen.toFixed(1)}`);
  // a line one pixel tall and as sharp doesn't run upright, so it's left as drawn
  const dash = new Uint8ClampedArray(240 * SCENE_H * 4).fill(255);
  for (let x = 100; x < 140; x++) dash.set([0, 0, 0], (30 * 240 + x) * 4);
  assert.deepEqual(steady(dash, 240).subarray(30 * 960 + 105 * 4, 30 * 960 + 135 * 4), dash.subarray(30 * 960 + 105 * 4, 30 * 960 + 135 * 4));
});

test('a label with clear parts never darkens where it meets them', () => {
  // clear on the left, an orange label on the right
  const pixels = new Uint8ClampedArray(240 * SCENE_H * 4);
  for (let y = 0; y < SCENE_H; y++) for (let x = 120; x < 240; x++) pixels.set([200, 100, 50, 255], (y * 240 + x) * 4);
  const calm = steady(pixels, 240, [0, 120]);
  for (let y = 0; y < SCENE_H; y++)
    for (const x of [119, 120, 239, 0]) {
      const i = (y * 240 + x) * 4;
      if (calm[i + 3]) assert.deepEqual([...calm.subarray(i, i + 3)], [200, 100, 50], `colour at ${x}, ${y}`);
    }
  // the edge softens by fading, not by turning dark
  assert.ok(calm[(10 * 240 + 120) * 4 + 3] < 255 && calm[(10 * 240 + 119) * 4 + 3] > 0);
});
