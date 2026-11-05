// Scenes of the sea, the land and its animals, for the label rows (index.mjs).
import { hex, mix, lighter, deep, dither, noise, time, sky, sun, cloud, birdFlock, land, hills, mountains, water, pine, roundTree, palm, grassTufts, blobRow } from './kit.mjs';
import { ART, person, personColours, draw } from './sprites.mjs';
import { silhouette, reflect, waves, splash, house } from './parts.mjs';

export const GRASS = ['#a4e45c', '#62bc48', '#3c8c3e'];
export const GRASS_FAR = ['#b0dc94', '#80bc7c', '#60a06c'];
export const PINE = ['#4c9c5c', '#2e7046', '#1c4a36'];
export const LEAF = ['#94d452', '#4ca242', '#2a6a34'];
export const FLOWERS = ['#ff5a7a', '#ffd84a', '#ffffff', '#b07af0', '#ff8a3a'];

export function skyWith(p, T, R, horizon, { clouds = [1, 3], sunAt } = {}) {
  sky(p, T, horizon, R);
  const sx = sunAt?.[0] ?? R.int(20, p.w - 20);
  const sy = sunAt?.[1] ?? R.int(6, Math.max(7, horizon - 12));
  if (sunAt !== false) sun(p, T, sx, sy, T.moon ? R.int(3, 4) : R.int(4, 6), R);
  const n = R.int(clouds[0], clouds[1]);
  for (let i = 0; i < n; i++) cloud(p, T, R.int(-10, p.w - 10), R.int(9, Math.max(10, horizon - 5)), R.int(16, 44), R);
  return { sx, sy };
}

export function pineRow(p, T, R, base, hmin, hmax, cols, gap, { far = 0, snow = false, wobble = 3, fill = true } = {}) {
  const tone = far ? cols.map((c) => T.far(c, far)) : cols;
  const flat = far ? { tone: (c) => c } : T;
  if (fill) p.rect(0, base - 1, p.w, p.h - base + 1, far ? tone[2] : T.tone(cols[2]));
  for (let x = R.int(-4, gap); x < p.w + 4; x += R.int(Math.max(2, gap - 2), gap + 2))
    pine(p, flat, x, base + R.int(0, wobble), R.int(hmin, hmax), tone, snow);
}

// ---------- The sea ----------

function seaside(p, R) {
  const T = time(R.pick(['morning', 'day', 'golden', 'sunset']));
  const hz = R.int(27, 32);
  const { sx } = skyWith(p, T, R, hz, { clouds: [1, 3] });
  water(p, T, R, hz, { sunX: sx, sunR: 3 });
  waves(p, T, R, hz + 2, p.h, { calm: 0.3 });
  if (R.chance(0.8)) {
    const bx = R.int(70, p.w - 70);
    const c = T.far('#fbf6ea', 0.15);
    for (let i = 0; i < 7; i++) p.rect(bx - Math.floor(i / 2), hz - 8 + i, 1 + Math.floor(i / 2), 1, c);
    p.rect(bx - 4, hz - 1, 8, 1, T.far('#8a4a3a', 0.25));
  }
  // a cliff with a lighthouse on one side
  const left = R.chance(0.5);
  const cw = R.int(56, 84);
  const top0 = R.int(17, 22);
  const edge = noise(R, p.w, 10);
  const X = (i) => (left ? i : p.w - 1 - i);
  const rock = [T.tone('#e2c49e'), T.tone('#b8926e'), T.tone('#86644e'), T.tone('#5a4038')];
  const grass = GRASS.map((c) => T.tone(c));
  const strata = noise(R, p.w, 14);
  const cracks = new Set(Array.from({ length: 9 }, () => R.int(2, cw - 2)));
  for (let i = 0; i < cw + 10; i++) {
    const fall = i > cw ? ((i - cw) / 10) ** 1.4 * (p.h - top0) : 0;
    const top = Math.round(top0 + edge(i) * 1.5 + fall);
    for (let y = top; y < p.h; y++) {
      const d = y - top;
      const band = (y + Math.round(strata(i) * 4)) % 7;
      let c = band === 0 ? rock[2] : band === 1 && dither(i, y) < 0.5 ? rock[1] : band > 4 ? rock[1] : rock[0];
      if (cracks.has(i) && (y * 3 + i) % 11 < 6) c = rock[3];
      if (cracks.has(i - 1) && (y * 3 + i - 1) % 11 < 6) c = rock[1];
      const face = cw - i;
      if (face < 4) c = face < 1 ? rock[3] : dither(i, y) < 0.6 ? rock[2] : c;
      if (i > cw) c = (y + i) % 5 === 0 ? rock[2] : rock[3];
      if (d < 2 && i <= cw) c = d === 0 ? grass[0] : grass[1];
      if (d === 2 && i <= cw && dither(i, y) < 0.5) c = grass[2];
      if (d > 2 && d < 5 && i <= cw && (i * 5) % 7 === 0) c = grass[2];
      p.put(X(i), y, c);
    }
  }
  // foam where the sea meets the rock
  for (let y = hz + 4; y < p.h; y++) {
    const i = cw + Math.round(((y - top0) / (p.h - top0)) ** (1 / 1.4) * 10);
    for (let k = 0; k < 4; k++) if (R.chance(0.6)) p.put(X(i + k), y, T.tone('#ffffff', 0.4));
  }
  splash(p, T, R, X(cw + 8), p.h - 2, 10, 8);
  // the lighthouse
  const lx = X(Math.round(cw * R.range(0.35, 0.6)));
  const lbase = top0 + 1;
  const lh = 22;
  const red = T.tone('#e0463c');
  const white = T.tone('#f6f2ea');
  const shade = T.tone('#c6bcb4');
  for (let y = 0; y < lh; y++) {
    const half = 3 - Math.floor((y / lh) * 1.5);
    const band = Math.floor(y / 4) % 2 === 0;
    for (let dx = -half; dx < half; dx++) p.put(lx + dx, lbase - y, band ? (dx >= half - 2 ? deep(red, 0.25) : red) : dx >= half - 2 ? shade : white);
  }
  const ly = lbase - lh;
  p.rect(lx - 3, ly - 1, 6, 1, T.tone('#3a3a4a'));
  p.rect(lx - 2, ly - 5, 4, 4, T.dark > 0.2 ? hex('#fff2a0') : T.tone('#ffe680'));
  p.rect(lx - 2, ly - 5, 1, 4, T.tone('#3a3a4a'));
  p.rect(lx + 1, ly - 5, 1, 4, T.tone('#3a3a4a'));
  for (let i = 0; i < 4; i++) p.rect(lx - 3 + i, ly - 6 - i, 6 - i * 2, 1, red);
  if (T.dark > 0.1) {
    p.glow(lx, ly - 3, 12, hex('#fff0a0'), 0.6);
    const dir = left ? 1 : -1;
    for (let k = 4; k < 70; k++) for (let w = -Math.floor(k / 9); w <= Math.floor(k / 9); w++) p.tint(lx + dir * k, ly - 3 + w - Math.round(k * 0.08), hex('#fff6c0'), 0.28 * (1 - k / 70));
  }
  p.rect(lx + (left ? 4 : -9), lbase - 5, 5, 5, white);
  p.rect(lx + (left ? 4 : -9), lbase - 6, 5, 1, red);
  // gulls
  for (let i = 0; i < R.int(2, 4); i++) draw(p, T, R.chance(0.5) ? 'gullUp' : 'gullFlat', R.int(20, p.w - 30), R.int(4, hz - 8), { w: '#ffffff', g: '#8a96a8' }, { outline: '#4a5468' });
}

function whales(p, R) {
  const T = time(R.pick(['morning', 'day', 'golden', 'sunset']));
  const hz = R.int(22, 28);
  const { sx } = skyWith(p, T, R, hz, { clouds: [2, 4] });
  water(p, T, R, hz, { sunX: sx, sunR: 3 });
  waves(p, T, R, hz + 1, p.h, { calm: 0.5 });
  const tx = R.int(40, p.w - 60);
  const ty = R.int(hz + 6, p.h - 17);
  draw(p, T, 'fluke', tx, ty, { d: '#34465e', l: '#8496b2' }, { outline: '#172030', k: 0.7 });
  for (let i = 0; i < 26; i++) {
    const side = R.chance(0.5);
    p.put(tx + (side ? R.int(-1, 2) : R.int(16, 19)) + R.int(-1, 1), ty + R.int(2, 12), T.tone(R.chance(0.6) ? '#ffffff' : '#bfe6ff', 0.3));
  }
  for (let dx = -8; dx < 28; dx++) {
    const y = ty + 11 + Math.round(Math.abs(dx - 9.5) / 9);
    if (R.chance(0.8)) p.put(tx + dx, y, T.tone('#ffffff', 0.4));
    if (Math.abs(dx - 9.5) < 10 && R.chance(0.5)) p.put(tx + dx, y - 1, T.tone('#e6f6ff', 0.4));
  }
  // a second whale's back, blowing
  const wx = tx + (tx > p.w / 2 ? -R.int(70, 110) : R.int(70, 110));
  const wy = R.int(hz + 7, hz + 12);
  for (let y = wy - 4; y < wy; y++)
    for (let x = wx - 13; x <= wx + 13; x++) {
      const e = ((x - wx) / 13) ** 2 + ((y - wy) / 4) ** 2;
      if (e <= 1) p.put(x, y, T.tone(e < 0.35 && y < wy - 2 ? '#62789a' : '#3a4c66', 0.7));
    }
  p.rect(wx + 5, wy - 6, 2, 2, T.tone('#3a4c66', 0.7));
  p.put(wx + 6, wy - 7, T.tone('#3a4c66', 0.7));
  for (let x = wx - 15; x <= wx + 15; x++) if (R.chance(0.8)) p.put(x, wy, T.tone('#ffffff', 0.4));
  for (let i = 0; i < 40; i++) {
    const h = R.range(0, 13);
    const spread = (h / 13) * 6;
    p.put(wx + 5 + R.range(-spread, spread), wy - 2 - h, T.tone(R.chance(0.7) ? '#ffffff' : '#cfeaff', 0.3));
  }
  // a ship far away
  if (R.chance(0.6)) {
    const bx = R.int(20, p.w - 20);
    p.rect(bx - 5, hz - 2, 11, 2, T.far('#4a3a3a', 0.35));
    p.rect(bx - 1, hz - 7, 1, 5, T.far('#4a3a3a', 0.35));
    p.rect(bx - 3, hz - 6, 2, 3, T.far('#fffaf0', 0.2));
    p.rect(bx, hz - 6, 3, 3, T.far('#fffaf0', 0.2));
  }
  for (let i = 0; i < R.int(2, 4); i++) draw(p, T, R.chance(0.5) ? 'gullUp' : 'gullFlat', R.int(10, p.w - 20), R.int(3, hz - 8), { w: '#ffffff', g: '#8a96a8' }, { outline: '#4a5468' });
}

function underwater(p, R) {
  const deepC = R.pick([['#a6eef8', '#56c6e8', '#2a98d4', '#1a6cb2', '#124a88'], ['#b8f2e8', '#5ad0d0', '#2aa0be', '#1a74a6', '#13507e']]);
  p.grad(0, p.h, deepC);
  const U = { tone: (c, k = 1) => mix(c, '#2a78b4', 0.18 * k), far: (c, k = 0.5) => mix(c, '#4aa6d4', k), dark: 0, night: false };
  // the surface shimmering at the top
  for (let x = 0; x < p.w; x++) {
    const y = Math.round(1 + Math.sin(x / 5) * 0.8);
    p.put(x, y, [230, 252, 255]);
    if (x % 7 < 3) p.put(x, y + 1, [190, 240, 255]);
  }
  // light coming down
  for (let k = 0; k < R.int(4, 7); k++) {
    const x0 = R.int(-30, p.w);
    const w = R.int(3, 9);
    for (let y = 2; y < p.h; y++) for (let i = 0; i < w; i++) p.tint(x0 + i + Math.round(y * 0.45), y, [255, 255, 255], 0.2 * (1 - y / p.h));
  }
  // far rocks
  const n = noise(R, p.w, 30);
  land(p, (x) => 40 + n(x) * 6, (x, y, d) => (d < 1 ? U.far('#7ab8d4', 0.4) : U.far('#3a7aa8', 0.45)));
  // the sand
  const s = noise(R, p.w, 40);
  const sandTop = (x) => 51 + s(x) * 3;
  land(p, sandTop, (x, y, d) => {
    let c = d < 1 ? '#fff0c0' : (x + y * 3) % 9 === 0 ? '#c8a874' : '#ecd49a';
    if (d > 4 && dither(x, y) < 0.4) c = '#d2b480';
    return U.tone(c);
  });
  // seaweed
  for (let i = 0; i < R.int(5, 9); i++) {
    const x = R.int(0, p.w);
    const h = R.int(10, 26);
    const ph = R() * 6;
    for (let y = 0; y < h; y++) {
      const xx = x + Math.round(Math.sin(y * 0.35 + ph) * 1.6);
      p.put(xx, sandTop(x) - y, U.tone(y % 4 === 0 ? '#7ad25a' : '#3c9a46'));
      p.put(xx + 1, sandTop(x) - y, U.tone('#2a7438'));
    }
  }
  // corals
  const corals = ['#ff7a8a', '#ff9a4a', '#c87ae8', '#ffd24a', '#ff5ab4'];
  for (let i = 0; i < R.int(5, 8); i++) {
    const x = R.int(4, p.w - 4);
    const base = Math.round(sandTop(x)) + 1;
    const c = R.pick(corals);
    const kind = R.int(0, 2);
    if (kind === 0) {
      const branch = (bx, by, len, ang, depth) => {
        let x0 = bx;
        let y0 = by;
        for (let k = 0; k < len; k++) {
          x0 += Math.cos(ang);
          y0 -= Math.sin(ang);
          p.put(x0, y0, U.tone(c));
          if (depth > 1) p.put(x0 + 1, y0, U.tone(deep(c, 0.25)));
        }
        p.put(x0, y0 - 1, U.tone(lighter(c, 0.45)));
        if (depth > 0) {
          branch(x0, y0, len * 0.7, ang + R.range(0.3, 0.6), depth - 1);
          branch(x0, y0, len * 0.7, ang - R.range(0.3, 0.6), depth - 1);
        }
      };
      branch(x, base, R.int(4, 7), Math.PI / 2 + R.range(-0.2, 0.2), 3);
    } else if (kind === 1) {
      const r = R.int(4, 7);
      for (let y = -r; y <= 0; y++)
        for (let dx = -r * 1.3; dx <= r * 1.3; dx++)
          if ((dx / (r * 1.3)) ** 2 + (y / r) ** 2 <= 1) {
            const groove = Math.sin(dx * 1.4 + Math.sin(y * 1.1) * 2) > 0.5;
            p.put(x + dx, base + y, U.tone(groove ? deep(c, 0.3) : y < -r * 0.5 ? lighter(c, 0.25) : c));
          }
    } else {
      const h = R.int(9, 15);
      for (let k = -4; k <= 4; k++) {
        const a = Math.PI / 2 + k * 0.18;
        for (let t = 0; t < h; t++) if ((t + k) % 2 === 0 || t > h * 0.6) p.put(x + Math.cos(a) * t, base - Math.sin(a) * t, U.tone(t > h * 0.7 ? lighter(c, 0.3) : c));
      }
    }
  }
  if (R.chance(0.7)) draw(p, U, 'starfish', R.int(10, p.w - 10), 53, { o: '#ff7a3a' }, { outline: '#9a3a1a' });
  // fish: a school and a few bright ones
  const school = R.pick([{ b: '#bfe8ff', t: '#8ac4ee', e: '#1a2a4a' }, { b: '#ffe25a', t: '#ffa83a', e: '#2a1a1a' }]);
  const scx = R.int(30, p.w - 30);
  const scy = R.int(14, 34);
  const flipS = R.chance(0.5);
  for (let i = 0; i < R.int(9, 16); i++) draw(p, U, 'tinyFish', scx + R.int(-22, 22), scy + R.int(-7, 7), school, { flip: flipS, outline: false });
  const bright = [
    { l: '#fff2a0', b: '#ffd030', t: '#ff8a20', e: '#1a1a2a', d: '#e8a020' },
    { l: '#9ac8ff', b: '#3a72e8', t: '#ffd040', e: '#1a1a2a', d: '#2a4ab0' },
    { l: '#ffffff', b: '#ff7a2a', t: '#ff5a1a', e: '#1a1a2a', d: '#ffffff' },
    { l: '#ffc8e8', b: '#ff6ab4', t: '#c84a9a', e: '#1a1a2a', d: '#e04a8a' },
  ];
  for (let i = 0; i < R.int(3, 6); i++) draw(p, U, 'fish', R.int(5, p.w - 12), R.int(8, 44), R.pick(bright), { flip: R.chance(0.5) });
  if (R.chance(0.6)) draw(p, U, 'turtle', R.int(20, p.w - 30), R.int(12, 34), { g: '#7ab84a', G: '#4a7a2a', h: '#a8d07a', e: '#1a2a1a', f: '#8ac05a' }, { flip: R.chance(0.5) });
  if (R.chance(0.5)) for (let i = 0; i < R.int(1, 3); i++) draw(p, U, 'jelly', R.int(10, p.w - 10), R.int(6, 30), { p: '#f2b4ff', l: '#ffffff' }, { outline: '#b46ad4' });
  // bubbles
  for (let i = 0; i < R.int(8, 16); i++) {
    const x = R.int(0, p.w);
    const y = R.int(4, 48);
    if (R.chance(0.6)) p.put(x, y, [230, 250, 255]);
    else {
      p.put(x, y - 1, [220, 248, 255]);
      p.put(x - 1, y, [220, 248, 255]);
      p.put(x + 1, y, [190, 236, 255]);
      p.put(x, y + 1, [190, 236, 255]);
    }
  }
}

function arctic(p, R) {
  const T = time(R.pick(['morning', 'day', 'golden']));
  const hz = R.int(26, 30);
  skyWith(p, T, R, hz, { clouds: [1, 3] });
  mountains(p, T, R, hz, R.int(8, 12), ['#ffffff', '#c4d6f0', '#ffffff', '#c4d6f0'], { far: 0.35, step: 26 });
  water(p, T, R, hz, { cols: ['#9adcf6', '#4ab2e6', '#2a86cc', '#1c62a8', '#144a86'] });
  waves(p, T, R, hz + 1, p.h, { calm: 0.8 });
  // icebergs and floes
  const ice = [T.tone('#ffffff'), T.tone('#d6ecfa'), T.tone('#9ccbef'), T.tone('#6aa6d8')];
  const floe = (x, y, w, h, peak) => {
    for (let dx = 0; dx < w; dx++) {
      const t = dx / (w - 1);
      const top = y - Math.round(peak * Math.sin(Math.PI * Math.min(1, t * 1.2)) ** 0.8) - (dx % 7 === 3 ? 1 : 0);
      for (let yy = top; yy < y + h; yy++) {
        let c = yy >= y ? ice[2] : t < 0.55 ? ice[0] : ice[1];
        if (yy === y + h - 1) c = ice[3];
        p.put(x + dx, yy, c);
      }
    }
    for (let dx = 1; dx < w - 1; dx++) p.put(x + dx, y + h, T.tone('#2a6aa6'));
  };
  const n = R.int(2, 4);
  const spots = [];
  for (let i = 0; i < n; i++) {
    const w = R.int(26, 54);
    const x = Math.round(((i + R.range(0.1, 0.5)) / n) * p.w) - w / 2;
    const y = R.int(hz + 12, p.h - 8);
    floe(x, y, w, 3, R.int(2, i === 0 ? 14 : 6));
    spots.push({ x, y, w });
  }
  // penguins on the ice
  for (const s of spots)
    for (let k = 0; k < R.int(1, 4); k++) {
      const x = s.x + R.int(4, s.w - 8);
      draw(p, T, 'penguin', x, s.y - 9, { k: '#22263a', w: '#ffffff', e: '#ffffff', Y: '#ffb02a' }, { flip: R.chance(0.5), outline: '#0c0e1a' });
    }
  if (R.chance(0.6)) {
    const fx = R.int(30, p.w - 30);
    const fy = R.int(hz + 6, hz + 10);
    for (let i = 0; i < 6; i++) p.rect(fx - Math.floor(i / 3), fy - 6 + i, 1 + Math.floor(i / 2), 1, T.tone('#1a1e2e'));
    p.rect(fx - 5, fy, 12, 1, T.tone('#ffffff', 0.4));
  }
  for (let i = 0; i < R.int(1, 3); i++) draw(p, T, 'gullFlat', R.int(10, p.w - 20), R.int(3, hz - 10), { w: '#ffffff', g: '#8a96a8' }, { outline: '#4a5468' });
}

// ---------- The land ----------

function meadow(p, R) {
  const T = time(R.pick(['morning', 'day', 'day', 'golden']));
  const hz = R.int(30, 34);
  skyWith(p, T, R, hz, { clouds: [2, 4] });
  hills(p, T, R, hz + 2, 6, GRASS_FAR, 70, 0.45);
  const mid = hills(p, T, R, hz + 10, 5, ['#bcea70', '#7cca52', '#5aaa4a'], 50);
  for (let i = 0; i < 160; i++) {
    const x = R.int(0, p.w);
    const y = Math.round(mid(x)) + R.int(2, p.h);
    if (y < p.h - 6) p.put(x, y, T.tone(R.pick(FLOWERS)));
  }
  const tx = R.chance(0.5) ? R.int(14, 50) : R.int(p.w - 50, p.w - 14);
  roundTree(p, T, tx, Math.round(mid(tx)) + 4, R.int(8, 11), LEAF);
  const near = hills(p, T, R, p.h - 6, 2, GRASS, 80);
  grassTufts(p, T, R, near, ['#c4f47a', '#3a8a3e'], FLOWERS);
  // a kite and the child holding it
  const kx = R.int(70, p.w - 70);
  const kidX = kx + R.int(-40, 40);
  const kidBase = Math.round(near(kidX)) + 1;
  person(p, T, R, kidX, kidBase, { pose: 'kid' });
  const ky = R.int(6, 14);
  const kc = R.pick([['#ff4a5a', '#ffd84a'], ['#4a8aff', '#ffffff'], ['#a25ad8', '#ffd84a']]).map((c) => T.tone(c));
  for (let y = -5; y <= 5; y++) for (let x = -4; x <= 4; x++) if (Math.abs(x) / 4 + Math.abs(y) / 5 <= 1) p.put(kx + x, ky + y, x * y >= 0 ? kc[0] : kc[1]);
  p.line(kx, ky - 5, kx, ky + 5, T.tone('#5a3a2a'));
  p.line(kx - 4, ky, kx + 4, ky, T.tone('#5a3a2a'));
  for (let i = 0; i < 18; i++) {
    const tx2 = kx + Math.round(Math.sin(i * 0.6) * 2) - Math.round(i * 0.3);
    p.put(tx2, ky + 6 + i, T.tone('#5a3a2a'));
    if (i % 5 === 3) {
      p.put(tx2 - 1, ky + 6 + i, kc[0]);
      p.put(tx2 + 1, ky + 6 + i, kc[1]);
    }
  }
  p.line(kx, ky + 5, kidX + 6, kidBase - 6, T.tone('#f4f4f4', 0.5));
  // a family nearby, rabbits and butterflies
  if (R.chance(0.7)) {
    const fx = kidX + (kidX > p.w / 2 ? -R.int(25, 45) : R.int(25, 45));
    const fb = Math.round(near(fx)) + 1;
    person(p, T, R, fx, fb, { pose: R.chance(0.5) ? 'person' : 'dress' });
    person(p, T, R, fx + 8, fb, { pose: R.chance(0.5) ? 'person' : 'dress' });
  }
  for (let i = 0; i < R.int(1, 3); i++) {
    const rx = R.int(10, p.w - 10);
    draw(p, T, 'rabbit', rx, Math.round(near(rx)) - 5, { b: R.pick(['#e8d4bc', '#f4f4f4', '#a8805a']), e: '#2a1a1a', w: '#ffffff' }, { flip: R.chance(0.5) });
  }
  for (let i = 0; i < R.int(3, 6); i++) draw(p, T, 'butterfly', R.int(5, p.w - 5), R.int(hz - 4, p.h - 12), { w: R.pick(['#ffd84a', '#ff8ac8', '#8ad0ff', '#ffffff']), k: '#3a2a2a' }, { outline: false });
  birdFlock(p, T, R, R.int(0, 3), 0, p.w, 3, hz - 14);
}

function campfire(p, R) {
  const T = time(R.pick(['dusk', 'night', 'night']));
  const hz = 46;
  skyWith(p, T, R, hz, { clouds: [0, 2] });
  pineRow(p, T, R, 40, 14, 24, PINE, 7, { far: 0.7 });
  pineRow(p, T, R, 46, 12, 22, PINE, 9, { far: 0.45 });
  const ground = noise(R, p.w, 60);
  const top = (x) => 50 + ground(x) * 2;
  land(p, top, (x, y, d) => T.tone(d < 1 ? '#5aa04a' : d < 3 && dither(x, y) < 0.5 ? '#4a8a40' : '#386e36'));
  const fx = R.int(70, p.w - 70);
  const fb = Math.round(top(fx)) + 2;
  // the fire lights everything around it
  p.glow(fx, fb - 4, 46, hex('#ff9a3a'), 0.42);
  // a tent
  const tentX = fx + (R.chance(0.5) ? -R.int(36, 50) : R.int(26, 40));
  const tb = Math.round(top(tentX)) + 2;
  const tc = R.pick(['#e8a03a', '#4a8ae8', '#e85a4a', '#5ac07a']);
  for (let i = 0; i < 12; i++)
    for (let dx = -i; dx <= i; dx++) p.put(tentX + dx, tb - 12 + i, dx < 0 ? T.tone(tc, 0.5) : T.tone(deep(tc, 0.3), 0.5));
  for (let i = 4; i < 12; i++) p.rect(tentX - Math.floor((i - 4) / 3), tb - 12 + i, 1 + Math.floor((i - 4) / 1.5), 1, hex('#ffd77a'));
  // people around the fire, lit from it
  const lit = { tone: (c) => mix(c, '#3a1a3a', 0.25), dark: 0 };
  for (const dx of [-16, -9, 9, 15]) if (R.chance(0.8)) person(p, lit, R, fx + dx - 3, fb, { pose: R.pick(['person', 'dress', 'person']), flip: dx > 0 });
  if (R.chance(0.6)) {
    const gx = fx + R.pick([-24, 22]);
    person(p, lit, R, gx, fb, { pose: 'person' });
    draw(p, lit, 'guitar', gx - 1, fb - 8, { b: '#d8943a', o: '#3a2010', n: '#6a3a1a' }, { outline: '#2a1408' });
  }
  // logs and flames
  p.line(fx - 5, fb, fx + 5, fb - 2, hex('#6a3a1a'));
  p.line(fx - 5, fb - 2, fx + 5, fb, hex('#7a4a22'));
  for (let i = 0; i < 26; i++) {
    const h = R.range(0, 9);
    const x = fx + R.range(-3.5, 3.5) * (1 - h / 11);
    p.put(x, fb - 2 - h, hex(h < 3 ? '#fff4b0' : h < 6 ? '#ffb03a' : '#ff5a2a'));
  }
  p.rect(fx - 1, fb - 4, 3, 2, hex('#ffffff'));
  for (let i = 0; i < 8; i++) p.put(fx + R.int(-6, 6), fb - R.int(12, 24), hex(R.chance(0.5) ? '#ffcf6a' : '#ff8a3a'));
  // fireflies
  for (let i = 0; i < R.int(8, 16); i++) {
    const x = R.int(0, p.w);
    const y = R.int(20, 48);
    p.glow(x, y, 3, hex('#d8ff7a'), 0.6);
    p.put(x, y, hex('#f4ffb0'));
  }
}

function deerWood(p, R) {
  const T = time(R.pick(['morning', 'golden', 'day']));
  const hz = 40;
  skyWith(p, T, R, hz, { clouds: [1, 2] });
  pineRow(p, T, R, 36, 14, 26, PINE, 6, { far: 0.65 });
  pineRow(p, T, R, 44, 16, 28, PINE, 8, { far: 0.35 });
  const ground = noise(R, p.w, 50);
  const top = (x) => 50 + ground(x) * 2;
  land(p, top, (x, y, d) => T.tone(d < 1 ? '#b4e46a' : d < 3 && dither(x, y) < 0.5 ? '#8acc5a' : '#5aa448'));
  // light through the trees
  for (let k = 0; k < R.int(3, 5); k++) {
    const x0 = R.int(0, p.w);
    for (let y = 0; y < 52; y++) for (let i = 0; i < 4; i++) p.tint(x0 + i - Math.round(y * 0.4), y, T.sun, 0.12);
  }
  for (const near of [R.int(0, 30), R.int(p.w - 30, p.w)]) pine(p, T, near, 58, R.int(36, 44), PINE);
  const dx = R.int(40, p.w - 60);
  const deer = { b: '#c4844a', h: '#c4844a', e: '#1a1010', n: '#2a1a1a', a: '#e8d4b4', k: '#3a2010' };
  draw(p, T, 'deer', dx, Math.round(top(dx)) - 10, deer, { flip: R.chance(0.5) });
  if (R.chance(0.7)) draw(p, T, 'deer', dx + R.int(14, 24), Math.round(top(dx + 18)) - 9, { ...deer, a: deer.b }, { flip: R.chance(0.5) });
  if (R.chance(0.6)) draw(p, T, 'fox', R.int(10, p.w - 20), Math.round(top(40)) - 6, { o: '#ff8a3a', t: '#ff8a3a', W: '#ffffff', w: '#ffffff', e: '#1a1010', n: '#1a1010', k: '#2a1a1a' }, { flip: R.chance(0.5) });
  for (let i = 0; i < R.int(1, 3); i++) {
    const rx = R.int(10, p.w - 10);
    draw(p, T, 'rabbit', rx, Math.round(top(rx)) - 5, { b: '#a8805a', e: '#2a1a1a', w: '#ffffff' }, { flip: R.chance(0.5) });
  }
  grassTufts(p, T, R, top, ['#c4f47a', '#4a9a3e'], FLOWERS);
  for (let i = 0; i < R.int(2, 4); i++) draw(p, T, 'butterfly', R.int(5, p.w - 5), R.int(28, 48), { w: R.pick(['#ffd84a', '#ffffff', '#8ad0ff']), k: '#3a2a2a' }, { outline: false });
}

function farm(p, R) {
  const T = time(R.pick(['morning', 'day', 'golden']));
  const hz = R.int(22, 26);
  skyWith(p, T, R, hz, { clouds: [2, 3] });
  hills(p, T, R, hz + 2, 4, GRASS_FAR, 70, 0.4);
  // patchwork fields
  const crops = ['#e4cc5a', '#9ad25a', '#c4e078', '#d8a85a', '#7ac04a'];
  const n = noise(R, p.w, 60);
  const top = (x) => hz + 6 + n(x) * 3;
  const widths = Array.from({ length: 12 }, () => R.int(24, 50));
  const fieldAt = (x, y) => {
    let edge = 0;
    const slant = (y - hz) * 0.8;
    for (let i = 0; i < widths.length; i++) {
      edge += widths[i];
      if (x + slant < edge) return i;
    }
    return 0;
  };
  land(p, top, (x, y, d) => {
    const f = fieldAt(x, y);
    const c = crops[(f * 3 + Math.floor((y - hz) / 9)) % crops.length];
    if (d < 1) return T.tone(lighter(c, 0.3));
    if ((x + Math.floor(y * 1.5)) % 4 === 0) return T.tone(deep(c, 0.15));
    return T.tone(c);
  });
  // hedgerows between fields
  for (let k = 0; k < 4; k++) {
    const y = hz + 12 + k * 9;
    for (let x = 0; x < p.w; x++) if (y > top(x) + 2 && (x + k) % 3 !== 0) p.put(x, y, T.tone('#3e8a3e'));
  }
  // the barn
  const bx = R.int(20, p.w - 80);
  const bb = R.int(44, 50);
  const red = T.tone('#d8463a');
  const redS = T.tone('#a8302c');
  p.rect(bx, bb - 14, 22, 14, red);
  p.rect(bx + 16, bb - 14, 6, 14, redS);
  for (let i = 0; i < 7; i++) p.rect(bx - 1 + Math.floor(i * 0.6), bb - 15 - i, 24 - Math.floor(i * 1.2), 1, T.tone(i < 3 ? '#5a5a6a' : '#6a6a7a'));
  p.rect(bx + 7, bb - 9, 8, 9, T.tone('#f4ece0'));
  p.line(bx + 7, bb - 9, bx + 14, bb - 1, red);
  p.line(bx + 14, bb - 9, bx + 7, bb - 1, red);
  p.rect(bx + 9, bb - 18, 4, 3, T.tone('#f4ece0'));
  // a silo and a windmill
  p.rect(bx + 24, bb - 20, 7, 20, T.tone('#c8ccd8'));
  p.rect(bx + 29, bb - 20, 2, 20, T.tone('#9aa0b0'));
  p.disc(bx + 27.5, bb - 20, 3.5, T.tone('#a8aebe'));
  const mx = bx + R.int(48, 64);
  const mb = bb - R.int(0, 3);
  for (let y = 0; y < 18; y++) {
    const half = 4 - Math.floor(y / 6);
    p.rect(mx - half, mb - y, half * 2, 1, T.tone(y % 6 === 5 ? '#c8b89a' : '#f2e8d4'));
  }
  p.rect(mx - 2, mb - 5, 3, 5, T.tone('#6a4a2a'));
  const a0 = R() * Math.PI;
  for (let k = 0; k < 4; k++) {
    const a = a0 + (k * Math.PI) / 2;
    for (let i = 2; i < 13; i++) {
      p.put(mx + Math.cos(a) * i, mb - 19 + Math.sin(a) * i, T.tone('#6a4a2a'));
      if (i > 4) p.put(mx + Math.cos(a) * i - Math.sin(a) * 1.5, mb - 19 + Math.sin(a) * i + Math.cos(a) * 1.5, T.tone(i % 2 ? '#f4f0e8' : '#d8d0c0'));
    }
  }
  p.disc(mx, mb - 19, 1.5, T.tone('#3a2a1a'));
  // a fence and the animals
  const fy = p.h - 6;
  for (let x = 0; x < p.w; x++) {
    if (x % 6 === 0) p.rect(x, fy - 5, 1, 6, T.tone('#8a6a4a'));
    p.put(x, fy - 4, T.tone('#a8865a'));
    p.put(x, fy - 1, T.tone('#a8865a'));
  }
  land(p, () => p.h - 3, (x, y) => T.tone(dither(x, y) < 0.5 ? '#6ab84a' : '#5aa444'));
  for (let i = 0; i < R.int(2, 4); i++) {
    const cx = R.int(0, p.w - 14);
    const cy = R.int(36, 46);
    if (R.chance(0.5)) draw(p, T, 'cow', cx, cy, { w: '#ffffff', b: '#2a2a2a', h: '#ffffff', e: '#1a1a1a', n: '#ffb0a8', u: '#ffb0a8', t: '#2a2a2a', k: '#3a3a3a' }, { flip: R.chance(0.5), outline: '#3a3a4a' });
    else draw(p, T, 'sheep', cx, cy + 2, { w: '#ffffff', f: '#2a2a2a', e: '#ffffff', k: '#2a2a2a' }, { flip: R.chance(0.5), outline: '#6a6a7a' });
  }
  for (let i = 0; i < R.int(1, 3); i++) draw(p, T, 'chicken', R.int(0, p.w), p.h - 8, { w: '#ffffff', r: '#e83a3a', Y: '#ffb02a', y: '#ffb02a' }, { flip: R.chance(0.5), outline: '#5a5a6a' });
  if (R.chance(0.7)) person(p, T, R, R.int(10, p.w - 10), p.h - 2, { pose: 'person', colours: personColours(R, T, { shirt: '#4a7ad8', pants: '#3a4a7a' }) });
  birdFlock(p, T, R, R.int(1, 3), 0, p.w, 3, hz - 10);
}

function lake(p, R) {
  const T = time(R.pick(['morning', 'day', 'golden', 'sunset']));
  const lakeY = R.int(38, 42);
  skyWith(p, T, R, lakeY, { clouds: [1, 3] });
  mountains(p, T, R, lakeY - 4, R.int(26, 32), ['#a8b4d4', '#7a86b0', '#ffffff', '#c8d4ee'], { far: 0.45, snow: 9, step: 30 });
  mountains(p, T, R, lakeY, R.int(14, 20), ['#7aa86a', '#4a7a52', '#ffffff', '#c8d4ee'], { far: 0.15, snow: 4, step: 20 });
  pineRow(p, T, R, lakeY + 1, 6, 12, PINE, 5, { far: 0.05, wobble: 0 });
  const cx = R.int(30, p.w - 40);
  house(p, T, R, cx, lakeY + 1, 12, 8, { wall: '#a8784a', roof: '#c84a3a' });
  reflect(p, lakeY + 2, p.h, T.water[2], 0.35, R, 1);
  for (let x = 0; x < p.w; x++) p.put(x, lakeY + 1, T.tone(x % 3 ? '#6aa45a' : '#8ac46a'));
  for (let i = 0; i < 40; i++) {
    const x = R.int(0, p.w);
    const y = R.int(lakeY + 3, p.h);
    for (let k = 0; k < R.int(2, 6); k++) p.tint(x + k, y, T.shine, 0.45);
  }
  draw(p, T, 'eagle', R.int(20, p.w - 40), R.int(4, 14), { d: '#5a3a22', w: '#ffffff' }, { outline: '#2a1a10' });
  if (R.chance(0.6)) {
    const bx = R.int(20, p.w - 20);
    const by = R.int(lakeY + 6, p.h - 4);
    p.rect(bx - 5, by, 11, 2, T.tone('#a8643a'));
    p.rect(bx - 4, by + 2, 9, 1, T.tone('#7a4422'));
    person(p, T, R, bx - 3, by, { pose: 'person' });
  }
}

function savanna(p, R) {
  const T = time(R.pick(['sunset', 'sunset', 'golden']));
  const hz = R.int(42, 46);
  sky(p, T, hz, R);
  const sx = R.int(50, p.w - 50);
  const r = R.int(11, 15);
  p.glow(sx, hz - 2, r * 4, T.glow, 0.7);
  p.disc(sx, hz - 2, r + 1, mix(T.sun, T.glow, 0.5));
  p.disc(sx, hz - 2, r, T.sun);
  for (let i = 0; i < R.int(1, 3); i++) cloud(p, T, R.int(-10, p.w - 10), R.int(10, hz - 16), R.int(20, 50), R);
  const ground = T.night ? '#2a1a2a' : T.name === 'sunset' ? '#3a1e30' : '#6a3a2a';
  const shadow = T.name === 'sunset' ? hex('#2a1428') : hex('#4a2420');
  hills(p, { tone: (c) => c, far: (c) => c }, R, hz, 1.5, [mix(ground, T.sky[4], 0.35), ground, mix(ground, '#000000', 0.3)], 60);
  // acacias
  const acacia = (x, base, s) => {
    const c = shadow;
    p.line(x, base, x, base - 10 * s, c);
    p.line(x, base - 6 * s, x - 6 * s, base - 13 * s, c);
    p.line(x, base - 7 * s, x + 7 * s, base - 14 * s, c);
    for (let dx = -14 * s; dx <= 14 * s; dx++) {
      const th = Math.round((1 - (dx / (14 * s)) ** 2) * 3 * s) + 1;
      for (let k = 0; k < th; k++) if (dither(x + dx, base - 14 * s - k) < 0.92) p.put(x + dx, base - 14 * s - k + (Math.abs(dx) > 10 * s ? 1 : 0), c);
    }
  };
  acacia(R.int(10, 60), hz + 3, R.range(1, 1.3));
  acacia(R.int(p.w - 60, p.w - 10), hz + 2, R.range(0.6, 1));
  // the animals
  const gx = R.int(60, p.w - 80);
  silhouette(p, 'giraffe', gx, hz - 15, shadow, R.chance(0.5));
  if (R.chance(0.6)) silhouette(p, 'giraffe', gx + R.int(12, 18), hz - 14, shadow, R.chance(0.5));
  const ex = gx + (gx > p.w / 2 ? -R.int(40, 60) : R.int(40, 60));
  silhouette(p, 'elephant', ex, hz - 9, shadow, R.chance(0.5));
  if (R.chance(0.6)) silhouette(p, 'elephant', ex + 14, hz - 8, shadow, R.chance(0.5));
  birdFlock(p, T, R, R.int(3, 7), 0, p.w, 6, hz - 20, shadow);
  // grass blades against the light
  for (let x = 0; x < p.w; x++) if (R.chance(0.4)) p.line(x, p.h - 1, x + R.int(-1, 1), p.h - R.int(3, 8), shadow);
}

function desert(p, R) {
  const T = time(R.pick(['night', 'golden', 'dusk']));
  const hz = R.int(32, 36);
  skyWith(p, T, R, hz, { clouds: [0, T.night ? 0 : 2] });
  // pyramids far
  if (R.chance(0.7)) {
    const px = R.int(30, p.w - 60);
    for (const [ox, s] of [[0, 14], [20, 10], [33, 7]]) {
      for (let i = 0; i < s; i++) for (let dx = -i; dx <= i; dx++) p.put(px + ox + dx, hz - s + i, T.far(dx < 0 ? '#f2cc84' : '#b88850', 0.35));
    }
  }
  // dunes, far to near: a long gentle side in the light, a steep side in shade, a bright crest between
  const sand = [['#ffe4a6', '#e0b070', '#fff4cc'], ['#f8d08a', '#d29a58', '#ffeab8'], ['#f2c070', '#c08446', '#ffe2a0']];
  const near = T.night ? 0.55 : 1;
  for (let k = 0; k < 3; k++) {
    const base = hz + 5 + k * 8;
    const len = 90 - k * 18;
    const off = R() * len;
    const amp = 5 + k * 2.5;
    const wob = noise(R, p.w, 30);
    const h = (x) => {
      const u = (((x + off + wob(x) * 8) % len) + len) % len / len;
      const v = u < 0.72 ? u / 0.72 : (1 - u) / 0.28;
      return base - Math.sin((v * Math.PI) / 2) * amp;
    };
    const lee = (x) => {
      const u = (((x + off + wob(x) * 8) % len) + len) % len / len;
      return u >= 0.72;
    };
    land(p, h, (x, y, d) => {
      const c = d < 1 && !lee(x) ? sand[k][2] : sand[k][lee(x) ? 1 : 0];
      const shaded = (x + y * 2) % 11 === 0 && d > 2 ? mix(c, sand[k][1], 0.4) : c;
      return k === 0 ? T.far(shaded, 0.2) : T.tone(shaded, near);
    });
  }
  // a caravan
  const dir = R.chance(0.5);
  const cx = R.int(30, p.w - 90);
  const cy = hz + R.int(9, 13);
  const robes = ['#f4f0e8', '#3a6ad0', '#e8463a', '#2a9a8a', '#f2c23e'];
  for (let i = 0; i < R.int(3, 5); i++) {
    const x = cx + i * 17;
    if (i % 2 === 0 || i === 1) person(p, { tone: (c) => T.tone(c, near * 0.8) }, R, x + (dir ? 5 : 3), cy + 5, { pose: 'kid', colours: personColours(R, { tone: (c) => T.tone(c, near * 0.8) }, { hair: R.pick(robes), shirt: R.pick(robes) }) });
    draw(p, T, 'camel', x, cy, { c: '#d4a064', n: '#3a2a1a', t: '#8a5a32', k: '#5a3a22' }, { flip: dir, outline: '#4a2a18', k: near * 0.8 });
  }
  if (R.chance(0.6)) {
    const ox = R.chance(0.5) ? R.int(6, 30) : R.int(p.w - 30, p.w - 6);
    palm(p, T, ox, p.h - 6, R.int(16, 22), R.int(-4, 4), ['#7ac04a', '#3a8a3a']);
    palm(p, T, ox + 9, p.h - 5, R.int(12, 18), R.int(-4, 4), ['#7ac04a', '#3a8a3a']);
  }
}

// a big leaf from (x, y) at an angle, lit on one half
function leaf(p, T, x, y, len, ang, w = 3, cols = ['#7ad84a', '#3a9a3a', '#22702e']) {
  const [lit, body, dark] = cols.map((c) => T.tone(c));
  for (let i = 0; i < len; i++) {
    const half = Math.sin((i / len) * Math.PI) * w;
    for (let j = -half; j <= half; j += 0.5) {
      const xx = x + Math.cos(ang) * i - Math.sin(ang) * j;
      const yy = y + Math.sin(ang) * i + Math.cos(ang) * j;
      p.put(xx, yy, Math.abs(j) < 0.5 ? dark : j < 0 ? lit : body);
    }
  }
}

function jungle(p, R) {
  const T = time(R.pick(['morning', 'day']));
  p.grad(0, 30, ['#c8f2e8', '#e8fbf0', '#f8fff0']);
  // canopy layers, misty far to clear near
  blobRow(p, T, R, 18, 5, 9, ['#c8ecc0', '#a8dcae', '#8acaa0'], { far: 0.1 });
  blobRow(p, T, R, 26, 6, 11, ['#9ad890', '#6ab87a', '#4a9a6a'], { far: 0.05 });
  // a mossy cliff and the waterfall
  const wx = R.int(80, p.w - 80);
  const ww = R.int(10, 16);
  const cl = noise(R, p.w, 12);
  for (let x = wx - 40; x < wx + 40; x++) {
    const top = 14 + Math.abs(x - wx) * 0.35 + cl(x) * 2;
    for (let y = Math.round(top); y < 50; y++) {
      const lit = x < wx;
      let c = (Math.floor(y / 4) + Math.floor(x / 6)) % 3 === 0 ? '#7a8a78' : lit ? '#a8b49a' : '#86967e';
      if ((y + Math.round(cl(x * 4) * 3)) % 6 === 0) c = '#5a6a5a';
      if (y - top < 2 || ((x * 7 + y) % 9 === 0 && y < 30)) c = '#5ab84a';
      p.put(x, y, T.tone(c));
    }
  }
  for (let y = 12; y < 50; y++)
    for (let x = wx - ww / 2; x < wx + ww / 2; x++) {
      const streak = (Math.floor(x) * 5 + Math.floor(y * 0.7 + Math.floor(x) * 3.3)) % 7;
      p.put(x, y, hex(streak < 2 ? '#ffffff' : streak < 5 ? '#d8f6ff' : '#9cdcf4'));
    }
  for (let x = wx - ww / 2; x < wx + ww / 2; x++) p.put(x, 12, hex('#ffffff'));
  // the pool and the mist
  water(p, T, R, 49, { cols: ['#c8f6ff', '#6ad4e4', '#3aa8c8', '#2a86ae'] });
  p.glow(wx, 48, ww * 2.2, hex('#ffffff'), 0.75);
  for (let i = 0; i < 90; i++) p.put(wx + R.range(-ww, ww), 48 + R.range(-4, 3), hex('#ffffff'));
  // trees and palms at the sides
  for (const side of [0, 1]) {
    const sx = side ? p.w - R.int(16, 40) : R.int(16, 40);
    roundTree(p, T, sx, 52, R.int(10, 13), ['#8ad84a', '#3c9a3c', '#226a30'], '#7a5a3a');
    palm(p, T, side ? p.w - R.int(4, 12) : R.int(4, 12), p.h, R.int(34, 42), side ? -7 : 7, ['#8ad84a', '#2e8a3a']);
  }
  // vines from the top
  for (let i = 0; i < R.int(7, 11); i++) {
    const x = R.int(0, p.w);
    const len = R.int(8, 26);
    for (let y = 0; y < len; y++) {
      const xx = x + Math.round(Math.sin(y * 0.3) * 1);
      p.put(xx, y, T.tone('#2e7a34'));
      if (y % 3 === 1) p.put(xx + (y % 6 === 1 ? 1 : -1), y, T.tone('#7ad04a'));
    }
  }
  // ferns and big leaves in front, with flowers
  for (let k = 0; k < 9; k++) {
    const bx = R.chance(0.5) ? R.int(0, 70) : R.int(p.w - 70, p.w);
    leaf(p, T, bx, p.h - R.int(0, 4), R.int(10, 18), -Math.PI / 2 + R.range(-1.1, 1.1), R.range(2, 3.5));
  }
  for (let i = 0; i < R.int(4, 7); i++) {
    const fx = R.int(0, p.w);
    const fy = R.int(44, 58);
    const c = R.pick(['#ff3a5a', '#ff8a2a', '#ff5ac8']);
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) p.put(fx + dx, fy + dy, T.tone(c));
    p.put(fx, fy, T.tone('#fff27a'));
  }
  // parrots
  for (let i = 0; i < R.int(2, 4); i++) {
    const c = R.pick([{ r: '#e8303a', b: '#3a6ae8', y: '#ffd02a' }, { r: '#3ac0e8', b: '#2a5ad8', y: '#ffd02a' }, { r: '#5ac83a', b: '#e8303a', y: '#ffd02a' }]);
    draw(p, T, 'parrot', R.int(10, p.w - 10), R.int(10, 36), { ...c, e: '#1a1a1a', Y: '#3a3a3a' }, { flip: R.chance(0.5), outline: '#1a1a2a' });
  }
  for (let i = 0; i < 4; i++) draw(p, T, 'butterfly', R.int(20, p.w - 20), R.int(20, 46), { w: R.pick(['#3ad0ff', '#ffd84a', '#ff8ac8']), k: '#1a1a2a' }, { outline: false });
}

function pond(p, R) {
  const T = time(R.pick(['morning', 'day', 'golden']));
  const wy = R.int(30, 34);
  skyWith(p, T, R, wy - 6, { clouds: [1, 3] });
  hills(p, T, R, wy - 2, 4, GRASS_FAR, 60, 0.4);
  blobRow(p, T, R, wy - 2, 4, 8, LEAF, { far: 0.3 });
  blobRow(p, T, R, wy + 1, 3, 6, ['#a4e45c', '#5cb848', '#3a8a3e'], { far: 0.1 });
  // a willow
  const tx = R.chance(0.5) ? R.int(16, 50) : R.int(p.w - 50, p.w - 16);
  p.rect(tx - 1, wy - 18, 3, 20, T.tone('#6a4a2a'));
  for (let k = 0; k < 40; k++) {
    const sx = tx + R.range(-16, 16);
    const sy = wy - 22 + Math.abs(sx - tx) * 0.3 + R.range(-3, 2);
    const len = R.int(6, 16);
    for (let i = 0; i < len; i++) p.put(sx + Math.round(Math.sin(i * 0.2) * 0.5), sy + i, T.tone(i < 2 ? '#c4ec6a' : i % 3 ? '#8ac850' : '#5aa040'));
  }
  water(p, T, R, wy + 1, {});
  reflect(p, wy + 1, p.h, T.water[2], 0.3, R, 1);
  // lily pads with flowers
  for (let i = 0; i < R.int(5, 9); i++) {
    const x = R.int(5, p.w - 5);
    const y = R.int(wy + 6, p.h - 3);
    const r = R.int(3, 5);
    p.ellipse(x, y, r, r * 0.45, T.tone('#5ab84a'));
    p.ellipse(x - 1, y - 0.5, r * 0.6, r * 0.25, T.tone('#8ad85a'));
    p.put(x + r - 1, y, T.tone('#2a7a3a'));
    if (R.chance(0.5)) {
      p.put(x, y - 2, T.tone('#ff8ac8'));
      p.put(x - 1, y - 1, T.tone('#ffb8e0'));
      p.put(x + 1, y - 1, T.tone('#ffb8e0'));
      p.put(x, y - 1, T.tone('#fff2a0'));
    }
  }
  // reeds
  for (const side of [R.int(0, 40), R.int(p.w - 40, p.w)])
    for (let k = 0; k < 12; k++) {
      const x = side + R.int(-8, 8);
      const h = R.int(8, 18);
      p.line(x, p.h, x + R.int(-1, 1), p.h - h, T.tone('#5a9a3a'));
      if (R.chance(0.5)) p.rect(x, p.h - h - 3, 2, 4, T.tone('#8a5a32'));
    }
  // ducks
  for (let i = 0; i < R.int(2, 4); i++) {
    const x = R.int(20, p.w - 30);
    const y = R.int(wy + 5, p.h - 8);
    const mother = i === 0;
    draw(p, T, 'duck', x, y, mother ? { g: '#2e8a4a', e: '#1a1a1a', Y: '#ffb02a', w: '#ffffff', b: '#a8805a' } : { g: '#a8805a', e: '#1a1a1a', Y: '#ffb02a', w: '#a8805a', b: '#c8a07a' }, { flip: R.chance(0.5), outline: '#3a2a1a' });
    p.rect(x, y + 7, 9, 1, T.tone('#ffffff', 0.4));
  }
  for (let i = 0; i < R.int(2, 4); i++) {
    const x = R.int(10, p.w - 10);
    const y = R.int(wy - 6, wy + 10);
    p.rect(x, y, 4, 1, T.tone('#3ab0e8'));
    p.put(x + 1, y - 1, T.tone('#d4f4ff'));
    p.put(x + 2, y - 1, T.tone('#d4f4ff'));
  }
}

function migration(p, R) {
  const T = time(R.pick(['sunset', 'golden']));
  const hz = R.int(40, 44);
  skyWith(p, T, R, hz, { clouds: [2, 4], sunAt: [R.int(30, p.w - 30), hz - R.int(4, 10)] });
  hills(p, T, R, hz, 3, ['#d8b860', '#b8903a', '#8a6a2a'], 70, 0.4);
  if (R.chance(0.7)) {
    const hx = R.int(20, p.w - 40);
    house(p, T, R, hx, hz + 1, 12, 7, { wall: '#f2e2c4', roof: '#8a3a3a' });
    roundTree(p, T, hx + 20, hz + 2, 5, LEAF);
  }
  // wheat: fine and hazy far away, tall ears up close, waves of wind across it
  const wheat = ['#fff0a8', '#ffd86a', '#e8b448', '#b8822e'];
  const wind = noise(R, p.w, 50);
  for (let y = hz + 2; y < p.h; y++) {
    const t = (y - hz) / (p.h - hz);
    for (let x = 0; x < p.w; x++) {
      const gust = Math.sin(x * 0.06 + y * 0.5 + wind(x) * 3) > 0.55;
      const stalk = (x + Math.round(y * 0.4)) % Math.max(2, Math.round(2 + t * 3)) === 0;
      let c = gust ? wheat[0] : stalk ? wheat[2] : wheat[1];
      if (t > 0.5 && (x * 3 + y) % 7 === 0) c = wheat[3];
      p.put(x, y, t < 0.25 ? T.far(c, 0.3 - t) : T.tone(c, 0.7));
    }
  }
  for (let x = 0; x < p.w; x += R.int(2, 3)) {
    const h = R.int(9, 15);
    const lean = R.int(-1, 1);
    p.line(x, p.h, x + lean, p.h - h, T.tone('#c8922e', 0.6));
    for (let k = 0; k < 4; k++) {
      p.put(x + lean, p.h - h - k, T.tone(k % 2 ? '#ffe89a' : '#f2c25a', 0.6));
      p.put(x + lean + (k % 2 ? 1 : -1), p.h - h - k + 1, T.tone('#e8b448', 0.6));
    }
  }
  // the geese in a V
  const vx = R.int(40, p.w - 40);
  const vy = R.int(8, 18);
  const flip = R.chance(0.5);
  const dir = flip ? -1 : 1;
  for (let k = 0; k < R.int(4, 6); k++)
    for (const side of k === 0 ? [0] : [-1, 1]) {
      const gx = vx - dir * k * 10;
      const gy = vy + side * k * 4 + (side < 0 ? -1 : 0);
      draw(p, T, 'goose', gx, gy, { g: '#4a4a5a', w: '#d8d0c8', h: '#1a1a2a', b: '#1a1a2a' }, { flip, outline: false });
    }
}

export const NATURE = { seaside, whales, underwater, arctic, meadow, campfire, deerWood, farm, lake, savanna, desert, jungle, pond, migration };
