// How the label rows are laid out (docs/LABELS.md), kept apart from the page so it can be tested on its own.
import { KINDS } from './label-scenes/index.mjs';

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
