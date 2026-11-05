// The site's own scenes in the label rows, and how the rows are laid out (src/scripts/label-scenes/,
// src/scripts/label-rows.mjs, docs/LABELS.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, NAMES, SCENE_H, drawScene } from '../../src/scripts/label-scenes/index.mjs';
import { INVITES, drawInvite } from '../../src/scripts/label-scenes/invite.mjs';
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
