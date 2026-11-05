// The site's own scenes for the places in the label rows that nobody has asked for (docs/LABELS.md): small pixel-art
// pictures in the style of handheld games, of the sea, the land and its animals, the sky and the stars, music and
// people, old battles and machines. Each is drawn in code from a number, so every place shows a different one, and
// none is ever words, a brand, a game's art or a character.
import { H, Pic, rng } from './kit.mjs';
import { NATURE } from './nature.mjs';
import { WORLD } from './world.mjs';

const SCENES = { ...NATURE, ...WORLD };
const LIST = Object.values(SCENES);

export const NAMES = Object.keys(SCENES);
export const KINDS = LIST.length;
export const SCENE_H = H;

/**
 * Draws scene number `kind` from `seed`, `width` pixels wide and 60 tall.
 * @param {number} width
 * @param {number} kind
 * @param {number} seed
 * @returns {Uint8ClampedArray} its pixels, four bytes each
 */
export function drawScene(width, kind, seed) {
  const p = new Pic(width, H);
  LIST[((kind % KINDS) + KINDS) % KINDS](p, rng(seed));
  return p.d;
}
