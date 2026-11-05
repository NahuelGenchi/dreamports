// How the label rows are laid out (docs/LABELS.md), kept apart from the page so it can be tested on its own.
import { KINDS } from './label-scenes/index.mjs';
import { INVITES } from './label-scenes/invite.mjs';

export const PLACE = 240;

/**
 * A row's places, in pixels. Together they're exactly a place wider than the screen, so the moment a place of 240
 * leaves one side it comes in on the other. Labels need places of 240, so what's left over goes to one or two
 * narrower scenes, between 120 and 240 wide, which come back a few seconds after they leave. No place is wider than
 * 240, so a place and its repeat are never on the screen at once. A row given more labels than the screen holds is as
 * long as its labels.
 * @param {number} width the screen's width
 * @param {number} labels how many labels the row holds
 * @returns {number[]}
 */
export function placesFor(width, labels) {
  const whole = Math.floor((width + PLACE) / PLACE);
  const rest = width + PLACE - whole * PLACE;
  const places = Array(whole).fill(PLACE);
  if (rest >= PLACE / 2) places.push(rest);
  else if (rest > 0) {
    // too little for a scene of its own: the last place and the rest make two narrower ones
    const split = PLACE + rest;
    places.splice(whole - 1, 1, Math.floor(split / 2), Math.ceil(split / 2));
  }
  if (labels <= places.filter((w) => w === PLACE).length) return places;
  return Array(Math.max(labels, whole + 1)).fill(PLACE);
}

/**
 * The rows, counted from the bottom, in the order they take labels: rows mostly off the screen last, and the rest by
 * how far they stand from the middle of the screen, where the game is.
 * @param {number} rows
 * @param {number} height the screen's height
 * @param {number} [tall] a row's height
 * @returns {number[]}
 */
export function rowOrder(rows, height, tall = 60) {
  const hidden = (r) => ((r + 1) * tall - height > tall / 2 ? 1 : 0);
  const far = (r) => Math.abs(height - (r + 0.5) * tall - height / 2);
  return [...Array(rows).keys()].sort((a, b) => hidden(a) - hidden(b) || far(b) - far(a) || a - b);
}

/**
 * The site's own invitations: about one row in five, among the rows furthest from the game, each with its words and
 * the place it starts looking from, so they spread across the screen.
 * @param {number[]} order from rowOrder
 * @returns {{rank: number, words: string, from: number}[]}
 */
export function invitesFor(order) {
  const out = [];
  const count = Math.max(2, Math.round(order.length / 5));
  for (let i = 0; i < count; i++) {
    // ranks 0, 3, 4, 7, 8 and on, so the invitations stand apart, near the top and the bottom both
    const rank = i === 0 ? 0 : 2 * i + (i % 2);
    if (rank >= order.length) break;
    out.push({ rank, words: INVITES[i % INVITES.length], from: 2 + 3 * i });
  }
  return out;
}

/**
 * Every row of a screen, counted from the bottom: its places, which labels it holds and in which places, and where an
 * invitation goes. Labels fill the rows furthest from the game first; an invitation takes the first free place of a
 * label's size in its row, or in the next row along that has one, and never a place someone asked for.
 * @param {number} width
 * @param {number} height
 * @param {number} labels how many labels are showing
 * @param {number} [tall] a row's height
 * @returns {{places: number[], labels: {index: number, place: number}[], invite: {place: number, words: string} | null}[]}
 */
export function layout(width, height, labels, tall = 60) {
  const count = Math.ceil(height / tall);
  const order = rowOrder(count, height, tall);
  const held = Array.from({ length: count }, () => /** @type {number[]} */ ([]));
  for (let i = 0; i < labels; i++) held[order[i % count]].push(i);
  const rows = held.map((indexes) => {
    const places = placesFor(width, indexes.length);
    const sized = places.flatMap((w, k) => (w === PLACE ? [k] : []));
    // the labels spread evenly over the places of their size
    const taken = indexes.map((index, j) => ({ index, place: sized[Math.floor(((j + 0.5) * sized.length) / indexes.length)] }));
    return { places, sized, labels: taken, invite: /** @type {{place: number, words: string} | null} */ (null) };
  });
  for (const { rank, words, from } of invitesFor(order)) {
    for (let step = 0; step < count; step++) {
      const row = rows[order[(rank + step) % count]];
      if (row.invite) continue;
      const used = new Set(row.labels.map((label) => label.place));
      // the first free place at or after the one it starts from, round the row
      const place = row.sized.map((_, j) => row.sized[(from + j) % row.sized.length]).find((k) => !used.has(k));
      if (place === undefined) continue;
      row.invite = { place, words };
      break;
    }
  }
  return rows.map(({ places, labels, invite }) => ({ places, labels, invite }));
}

/**
 * A scene's own number, from its place.
 * @param {number} row
 * @param {number} place
 */
export const seedOf = (row, place) => (Math.imul(row + 1, 73856093) ^ Math.imul(place + 1, 19349663)) >>> 0;

/**
 * Which scene a place shows: neighbours in a row, and every place of the rows just above and below, are never the
 * same kind.
 * @param {number} row
 * @param {number} place
 */
export const kindOf = (row, place) => (row * 7 + place * 3) % KINDS;
