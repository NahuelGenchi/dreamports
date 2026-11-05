// The site's own invitation in a few places of the rows (docs/LABELS.md): a little window, the way handheld games
// draw their menus, over a sky of its own, saying the place could hold someone's art or brand.
import { H, Pic, rng, time, sky, cloud, hills, hex, mix, dither } from './kit.mjs';

export const INVITES = ['YOUR ART HERE', 'YOUR BRAND HERE'];

// capitals five pixels wide and seven tall, drawn twice their size
const FONT = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
};
const SCALE = 2;
const GAP = 2;
const SPACE = 6;

// a painter's palette for art, a gold star for a brand
const ICONS = {
  'YOUR ART HERE': {
    art: [
      '....wwwwww....',
      '..wwwwwwwwww..',
      '.wwrrwwwwbbww.',
      'wwwrrwwwwbbwww',
      'wwwwwwwwwwwww.',
      'wwyywwww......',
      'wwyywww.......',
      'wwwwwww...ww..',
      '.wwwwwwwggww..',
      '..wwwwwwggw...',
      '....wwwwww....',
    ],
    pal: { w: hex('#f2c98a'), r: hex('#ff4f6e'), b: hex('#3a86ff'), y: hex('#ffd23a'), g: hex('#3cc46a') },
  },
  'YOUR BRAND HERE': {
    art: [
      '.....y.....',
      '....yyy....',
      '....yyy....',
      'yyyyyyyyyyy',
      '.yyyyyyyyy.',
      '..yyyyyyy..',
      '..yyyyyyy..',
      '.yyyy.yyyy.',
      '.yyy...yyy.',
      'yy.......yy',
    ],
    pal: { y: hex('#ffcc33') },
  },
};

const NAVY = hex('#16306e');
const SHADE = hex('#a8c6ee');
const EDGE = hex('#2f63c4');

function textWidth(words) {
  let w = 0;
  for (const ch of words) w += (ch === ' ' ? SPACE : 5 * SCALE) + GAP;
  return w - GAP;
}

function write(p, x, y, words, colour) {
  for (const ch of words) {
    if (ch === ' ') {
      x += SPACE + GAP;
      continue;
    }
    const glyph = FONT[ch];
    if (!glyph) throw new Error(`No letter ${ch} in the invitation's font`);
    for (let gy = 0; gy < 7; gy++)
      for (let gx = 0; gx < 5; gx++) if (glyph[gy][gx] === '#') p.rect(x + gx * SCALE, y + gy * SCALE, SCALE, SCALE, colour);
    x += 5 * SCALE + GAP;
  }
}

// a four-pointed glint, the way handhelds draw a sparkle
function glint(p, x, y, c, big) {
  p.put(x, y, c);
  for (let d = 1; d <= (big ? 2 : 1); d++) {
    const k = d === 1 ? 0.8 : 0.45;
    p.tint(x - d, y, c, k);
    p.tint(x + d, y, c, k);
    p.tint(x, y - d, c, k);
    p.tint(x, y + d, c, k);
  }
}

/**
 * An invitation, 240 x 60, its sky and hills from its own number.
 * @param {string} words one of INVITES
 * @param {number} seed
 * @returns {Uint8ClampedArray}
 */
export function drawInvite(words, seed) {
  const R = rng(seed);
  const p = new Pic(240, H);
  const T = time(R.pick(['morning', 'day', 'day', 'golden']));

  // the world behind the window
  sky(p, T, 46, R);
  for (let i = 0, n = R.int(2, 4); i < n; i++) cloud(p, T, R.int(-10, 220), R.int(12, 30), R.int(16, 34), R);
  hills(p, T, R, 50, 5, ['#a8dc78', '#7cc35c', '#5aa44c'], 50, 0.55);
  hills(p, T, R, 56, 3, ['#94d452', '#62bc48', '#3c8c3e'], 34);

  // the window: a shadow, a frame with its corners cut, a light face and a dashed line inside it
  const icon = ICONS[words];
  if (!icon) throw new Error(`No invitation says ${words}`);
  const iw = icon.art[0].length;
  const inner = iw + 6 + textWidth(words);
  const w = inner + 20;
  const h = 30;
  const x = Math.round((240 - w) / 2);
  const y = 14;
  const cut = (xx, yy) => (xx === x || xx === x + w - 1) && (yy === y || yy === y + h - 1);
  for (let yy = y + 2; yy < y + h + 2; yy++)
    for (let xx = x + 2; xx < x + w + 2; xx++) if (!cut(xx - 2, yy - 2)) p.tint(xx, yy, mix(T.sky[0], '#0a1738', 0.5), 0.35);
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) {
      if (cut(xx, yy)) continue;
      const rim = xx === x || xx === x + w - 1 || yy === y || yy === y + h - 1;
      const light = (yy - y) / h;
      p.put(xx, yy, rim ? EDGE : light > 0.55 + dither(xx, yy) * 0.3 ? hex('#eef4fd') : hex('#fdfcf6'));
    }
  for (let xx = x + 1; xx < x + w - 1; xx++) p.put(xx, y + 1, hex('#ffffff'));
  for (let xx = x + 3; xx < x + w - 3; xx++)
    if (((xx - x) >> 1) % 2 === 0) {
      p.put(xx, y + 3, SHADE);
      p.put(xx, y + h - 4, SHADE);
    }
  for (let yy = y + 3; yy < y + h - 3; yy++)
    if (((yy - y) >> 1) % 2 === 0) {
      p.put(x + 3, yy, SHADE);
      p.put(x + w - 4, yy, SHADE);
    }

  // the icon and the words, with a soft shadow under each letter
  const ix = x + 10;
  const iy = y + Math.round((h - icon.art.length) / 2);
  p.sprite(ix, iy, icon.art, icon.pal, { outline: hex('#6b4a2a') });
  const tx = ix + iw + 6;
  const ty = y + 8;
  write(p, tx + 1, ty + 1, words, SHADE);
  write(p, tx, ty, words, NAVY);

  // a few glints around the window
  for (let i = 0, n = R.int(3, 5); i < n; i++) {
    const left = R.chance(0.5);
    const gx = left ? R.int(3, Math.max(4, x - 5)) : R.int(Math.min(236, x + w + 4), 236);
    glint(p, gx, R.int(5, 40), hex('#ffffff'), R.chance(0.4));
  }
  return p.d;
}
