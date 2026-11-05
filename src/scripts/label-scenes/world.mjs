// Scenes of the sky and the stars, of music and people, of old battles and of machines, for the label rows (index.mjs).
import { hex, mix, lighter, deep, dither, noise, time, sky, sun, cloud, birdFlock, land, hills, mountains, water, pine, roundTree, blobRow } from './kit.mjs';
import { ART, person, personColours, draw } from './sprites.mjs';
import { silhouette, reflect, waves, smoke, splash, house, castle, galleon, cannonFire, balloon, turbine, dish, firework, rocket, train } from './parts.mjs';
import { GRASS, GRASS_FAR, PINE, LEAF, skyWith, pineRow } from './nature.mjs';

function noise2(R, w, h, cell) {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const g = Array.from({ length: gw * gh }, () => R());
  const at = (i, j) => g[(j % gh) * gw + (i % gw)];
  return (x, y) => {
    const fx = Math.max(0, x) / cell;
    const fy = Math.max(0, y) / cell;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    return (at(i, j) * (1 - sx) + at(i + 1, j) * sx) * (1 - sy) + (at(i, j + 1) * (1 - sx) + at(i + 1, j + 1) * sx) * sy;
  };
}

function milkyWay(p, R, y1 = p.h) {
  const slope = R.range(-0.18, 0.18);
  const c = R.int(10, 26);
  const n = noise2(R, p.w, p.h, 12);
  const n2 = noise2(R, p.w, p.h, 4);
  const hue = R.pick([['#7a6ad8', '#e09ad8'], ['#5a8ae8', '#c8a0f0'], ['#8a5ac8', '#f0a8a0']]).map(hex);
  for (let y = 0; y < y1; y++)
    for (let x = 0; x < p.w; x++) {
      const d = (y - (c + slope * (x - p.w / 2))) / 10;
      const band = Math.exp(-d * d);
      const cl = band * (0.35 + n(x, y) * 0.9);
      p.tint(x, y, hue[0], cl * 0.32);
      if (n2(x, y) > 0.5) p.tint(x, y, hue[1], cl * 0.22);
      if (Math.abs(d) < 0.3 && n2(x + 50, y) > 0.6) p.tint(x, y, [6, 6, 20], 0.35);
      if (R() < band * band * 0.05) p.put(x, y, mix(p.get(x, y), [255, 255, 255], 0.4 + R() * 0.6));
    }
}

function shootingStar(p, R, y1) {
  const x = R.int(30, p.w - 30);
  const y = R.int(3, y1);
  const len = R.int(10, 18);
  const dir = R.chance(0.5) ? 1 : -1;
  for (let i = 0; i < len; i++) p.tint(x + dir * i, y + Math.round(i * 0.45), [255, 255, 255], 1 - i / len);
  p.glow(x, y, 3, [255, 255, 255], 0.6);
}

// ---------- The sky and the stars ----------

function observatory(p, R) {
  const T = time('night');
  sky(p, T, 60, R);
  milkyWay(p, R, 50);
  if (R.chance(0.7)) shootingStar(p, R, 20);
  const n = noise(R, p.w, 70);
  const left = R.chance(0.5);
  const hillTop = (x) => 46 - (left ? Math.max(0, 1 - x / 120) : Math.max(0, (x - 120) / 120)) * 14 + n(x) * 2;
  land(p, hillTop, (x, y, d) => T.tone(d < 1 ? '#4a7a6a' : dither(x, y) < 0.3 ? '#2e5a4e' : '#36604e', 0.75));
  // the observatory on the hill
  const ox = left ? R.int(26, 50) : R.int(p.w - 50, p.w - 26);
  const ob = Math.round(hillTop(ox)) + 2;
  const wall = T.tone('#e8e4dc', 0.5);
  const wallS = T.tone('#a8a4a8', 0.5);
  p.rect(ox - 10, ob - 10, 20, 10, wall);
  p.rect(ox + 5, ob - 10, 5, 10, wallS);
  const r = 9;
  for (let y = -r; y <= 0; y++)
    for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) p.put(ox + x, ob - 10 + y, x < -2 ? T.tone('#f4f2ec', 0.45) : x < 4 ? wall : wallS);
  for (let y = -r; y <= 0; y++) p.rect(ox - 1, ob - 10 + y, 3, 1, hex('#1a1a2e'));
  p.line(ox, ob - 14, ox + 9, ob - 26, T.tone('#c8ccd8', 0.4));
  p.line(ox + 1, ob - 14, ox + 10, ob - 26, T.tone('#9aa0b0', 0.4));
  p.rect(ox - 6, ob - 6, 3, 3, hex('#ffd26a'));
  p.glow(ox - 5, ob - 5, 8, hex('#ffcf70'), 0.35);
  p.rect(ox + 1, ob - 5, 3, 5, T.tone('#5a4a3a', 0.5));
  // an astronomer with a small telescope, and someone with them
  const ax = left ? R.int(110, 200) : R.int(30, 120);
  const ab = Math.round(hillTop(ax)) + 1;
  const lit = { tone: (c, k = 1) => T.tone(c, 0.55 * k), dark: 0.3 };
  draw(p, lit, 'telescope', ax + 8, ab - 8, { w: '#e8ecf4', k: '#5a5a6a' }, { outline: '#1a1a2a', flip: left });
  person(p, lit, R, ax, ab, { pose: 'person' });
  if (R.chance(0.7)) person(p, lit, R, ax - 9, ab, { pose: 'kid' });
  for (let i = 0; i < 3; i++) {
    const fx = R.int(0, p.w);
    p.glow(fx, Math.round(hillTop(fx)) + R.int(3, 8), 3, hex('#d8ff7a'), 0.5);
  }
}

function space(p, R) {
  p.grad(0, p.h, ['#04051a', '#0a0a2c', '#120c36', '#0a0820']);
  const n = noise2(R, p.w, p.h, 22);
  const n2 = noise2(R, p.w, p.h, 7);
  const neb = R.pick([['#d84ab4', '#5a4ae8'], ['#3ac8d8', '#4a5ae8'], ['#ff8a4a', '#c83a7a'], ['#8a5ae8', '#3ab8e8']]).map(hex);
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const v = n(x, y) * 0.75 + n2(x, y) * 0.35;
      if (v > 0.55) p.tint(x, y, v > 0.78 ? neb[0] : neb[1], (v - 0.55) * 1.4 * (dither(x, y) < 0.8 ? 1 : 0.6));
    }
  for (let i = 0; i < 160; i++) {
    const x = R.int(0, p.w - 1);
    const y = R.int(0, p.h - 1);
    const b = R();
    p.put(x, y, mix([120, 130, 200], [255, 255, 255], b));
    if (b > 0.96) {
      p.tint(x - 1, y, [255, 255, 255], 0.5);
      p.tint(x + 1, y, [255, 255, 255], 0.5);
      p.tint(x, y - 1, [255, 255, 255], 0.5);
      p.tint(x, y + 1, [255, 255, 255], 0.5);
      p.glow(x, y, 4, [200, 220, 255], 0.3);
    }
  }
  // a ringed planet
  const px = R.int(40, p.w - 40);
  const py = R.int(18, 42);
  const pr = R.int(12, 17);
  const bands = R.pick([['#f2d08a', '#d89a5a', '#e8b878', '#b87a4a'], ['#8ad0f0', '#5a9ad8', '#a8e0f8', '#4a7ac0'], ['#f0a8c8', '#c87ab0', '#f8c8d8', '#a85a98']]).map(hex);
  const tilt = R.range(-0.35, 0.35);
  const lightX = R.chance(0.5) ? -1 : 1;
  const ring = (front) => {
    for (let y = -pr * 2; y <= pr * 2; y++)
      for (let x = -pr * 2.4; x <= pr * 2.4; x++) {
        const u = x * Math.cos(tilt) + y * Math.sin(tilt);
        const v = -x * Math.sin(tilt) + y * Math.cos(tilt);
        const e = (u / (pr * 2.1)) ** 2 + (v / (pr * 0.55)) ** 2;
        const e2 = (u / (pr * 1.45)) ** 2 + (v / (pr * 0.36)) ** 2;
        if (e <= 1 && e2 >= 1 && (v > 0) === front) {
          const gap = Math.abs(e - 0.72) < 0.05;
          if (!gap) p.put(px + x, py + y, mix(bands[2], bands[1], e > 0.85 ? 0.5 : 0.1));
        }
      }
  };
  ring(false);
  const sw = noise(R, 60, 8);
  for (let y = -pr; y <= pr; y++)
    for (let x = -pr; x <= pr; x++) {
      if (x * x + y * y > pr * pr) continue;
      const lat = y + sw(x + pr) * 2.5;
      let c = bands[((Math.floor((lat / pr + 1) * 3.2) % 4) + 4) % 4];
      const shade = (x * lightX + y * 0.4) / pr;
      if (shade > 0.35 + dither(px + x, py + y) * 0.3) c = mix(c, [10, 10, 40], 0.55);
      else if (shade < -0.55) c = lighter(c, 0.25);
      p.put(px + x, py + y, c);
    }
  ring(true);
  // a moon
  const mx = px + (px > p.w / 2 ? -R.int(50, 80) : R.int(50, 80));
  const my = R.int(10, 44);
  const mr = R.int(4, 6);
  p.disc(mx, my, mr, hex('#c8ccd8'));
  p.disc(mx + lightX * 1.5, my + 1, mr - 1, hex('#8a90a8'));
  p.disc(mx - lightX, my - 1, 1, hex('#e8ecf4'));
  // a satellite and a comet
  draw(p, { tone: (c) => hex(c) }, 'satellite', R.int(10, p.w - 24), R.int(4, 50), { p: '#3a6ae8', P: '#8ab4ff', b: '#f2c23e', s: '#c8ccd8' }, { outline: '#0a0a1a' });
  if (R.chance(0.7)) {
    const cx = R.int(20, p.w - 20);
    const cy = R.int(6, 26);
    const dir = R.chance(0.5) ? 1 : -1;
    for (let i = 0; i < 28; i++) for (let w = -i / 7; w <= i / 7; w++) p.tint(cx + dir * i, cy - Math.round(i * 0.35) + Math.round(w), [180, 230, 255], 0.55 * (1 - i / 28));
    p.glow(cx, cy, 5, [200, 240, 255], 0.7);
    p.put(cx, cy, [255, 255, 255]);
  }
}

function aurora(p, R) {
  const T = time('night');
  sky(p, T, 60, R);
  const n = noise(R, p.w, 40);
  const n3 = noise(R, p.w, 14);
  const curtains = R.int(1, 2);
  for (let k = 0; k < curtains; k++) {
    const yb = R.int(26, 34) - k * 8;
    const hgt = R.int(16, 24);
    const low = hex(R.pick(['#5affa8', '#5affd8', '#8aff6a']));
    const high = hex(R.pick(['#b46aff', '#ff6ad0', '#6a8aff']));
    for (let x = 0; x < p.w; x++) {
      const b = yb + n(x + k * 60) * 7;
      const I = (0.45 + 0.55 * Math.sin(x * 0.3 + n3(x) * 5)) ** 2;
      for (let y = Math.floor(b - hgt); y <= b; y++) {
        const t = (b - y) / hgt;
        const a = I * (1 - t) ** 0.8 * 0.85;
        p.tint(x, y, mix(low, high, t ** 1.3), a);
      }
      p.tint(x, Math.round(b), lighter(low, 0.5), I * 0.8);
    }
  }
  mountains(p, T, R, 44, 10, ['#ffffff', '#b4c4e8', '#ffffff', '#b4c4e8'], { far: 0.35, step: 30 });
  const n2 = noise(R, p.w, 60);
  const top = (x) => 48 + n2(x) * 3;
  land(p, top, (x, y, d) => T.tone(d < 1 ? '#ffffff' : dither(x, y) < 0.2 + d * 0.04 ? '#a8bce8' : '#dce8fa', 0.55));
  // the lights shine on the snow
  for (let y = 44; y < p.h; y++) for (let x = 0; x < p.w; x++) if (dither(x, y) < 0.15) p.tint(x, y, hex('#7affc0'), 0.18);
  for (let i = 0; i < R.int(4, 7); i++) {
    const x = R.int(0, p.w);
    pine(p, { tone: (c) => T.tone(c, 0.6) }, x, Math.round(top(x)) + 3, R.int(12, 20), PINE, true);
  }
  const hx = R.int(40, p.w - 60);
  house(p, { ...T, tone: (c) => T.tone(c, 0.6), dark: 0.6 }, R, hx, Math.round(top(hx)) + 2, 14, 8, { wall: '#a8744a', roof: '#c84a3a', snow: true, lit: true });
  if (R.chance(0.6)) person(p, { tone: (c, k = 1) => T.tone(c, 0.55 * k) }, R, hx + 20, Math.round(top(hx + 20)) + 2, { pose: 'back' });
}

function sunrise(p, R) {
  const T = time(R.pick(['morning', 'golden']));
  const hz = R.int(34, 40);
  const sx = R.int(50, p.w - 50);
  sky(p, T, hz, R);
  p.glow(sx, hz, 70, T.glow, 0.55);
  sun(p, T, sx, hz - R.int(2, 6), 7, R);
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI * (0.08 + (k / 9) * 0.84);
    for (let i = 10; i < 80; i++) p.tint(sx + Math.cos(a) * i, hz - 4 + Math.sin(a) * i, T.sun, 0.1 * (1 - i / 80));
  }
  for (let i = 0; i < R.int(3, 5); i++) cloud(p, T, R.int(-10, p.w - 10), R.int(10, hz - 6), R.int(20, 40), R);
  // a valley of mist with hills
  hills(p, T, R, hz + 2, 5, ['#c8b4d8', '#a898c8', '#8a7ab8'], 60, 0.45);
  for (let y = hz; y < hz + 8; y++) for (let x = 0; x < p.w; x++) p.tint(x, y, T.haze, 0.45 * (1 - (y - hz) / 8));
  hills(p, T, R, hz + 10, 5, ['#8ab87a', '#5a9a6a', '#3a7a5a'], 50, 0.2);
  hills(p, T, R, p.h - 5, 3, GRASS, 70);
  // balloons drifting, smaller further away
  birdFlock(p, T, R, R.int(2, 4), 0, p.w, 4, hz - 12);
  const cols = [['#e8403a', '#ffd84a'], ['#3a7ae8', '#ffffff'], ['#5ac87a', '#ffd84a'], ['#a25ad8', '#ff8ac8'], ['#ff8a3a', '#3ac0c8']];
  const count = R.int(3, 6);
  const list = Array.from({ length: count }, (_, i) => ({ x: ((i + R.range(0.2, 0.8)) / count) * p.w, r: R.int(3, 9) })).sort((a, b) => a.r - b.r);
  for (const b of list) balloon(p, b.r < 5 ? { tone: (c) => T.far(c, 0.25) } : T, R, b.x, R.int(8, hz - b.r), b.r, R.pick(cols));
}

// ---------- Music and people ----------

function facades(p, T, R, base, { minH = 18, maxH = 34, lit = false } = {}) {
  const walls = ['#f2c8a0', '#f4e2b4', '#c8e0f0', '#f0b4b4', '#d4e8c0', '#e8d0f0', '#fff0d8'];
  const roofs = ['#c84a3a', '#6a5a7a', '#3a6a9a', '#a8643a'];
  for (let x = R.int(-12, 0); x < p.w; ) {
    const w = R.int(18, 28);
    const h = R.int(minH, maxH);
    const wall = R.pick(walls);
    const wc = T.tone(wall, 0.8);
    const ws = T.tone(deep(wall, 0.18), 0.8);
    p.rect(x, base - h, w, h, wc);
    p.rect(x + w - 2, base - h, 2, h, ws);
    const roof = R.pick(roofs);
    if (R.chance(0.5)) {
      for (let i = 0; i < 6; i++) p.rect(x - 1 + i, base - h - 1 - i, w + 2 - i * 2, 1, T.tone(i % 2 ? roof : deep(roof, 0.2), 0.8));
    } else {
      p.rect(x - 1, base - h - 2, w + 2, 2, T.tone(deep(wall, 0.35), 0.8));
    }
    const glass = lit ? hex('#ffd26a') : T.tone('#7ab8e0', 0.8);
    const shutter = T.tone(R.pick(['#3a8a5a', '#3a6ab8', '#b84a3a', '#5a4a3a']), 0.8);
    for (let wy = base - h + 3; wy < base - 9; wy += 7)
      for (let wx = x + 3; wx < x + w - 5; wx += 6) {
        p.rect(wx, wy, 3, 4, glass);
        p.rect(wx - 1, wy, 1, 4, shutter);
        p.rect(wx + 3, wy, 1, 4, shutter);
        if (R.chance(0.3)) for (let k = 0; k < 3; k++) p.put(wx + k, wy + 4, T.tone(R.pick(['#ff5a7a', '#ffd84a', '#e8403a']), 0.8));
      }
    const dx = x + Math.round(w / 2) - 2;
    p.rect(dx, base - 7, 4, 7, T.tone('#6a4a2a', 0.8));
    p.rect(dx, base - 8, 4, 1, T.tone(deep(wall, 0.3), 0.8));
    x += w;
  }
}

function bunting(p, T, R, y, sag) {
  const cols = ['#e8403a', '#ffd84a', '#3a7ae8', '#5ac87a', '#ff8ac8', '#ffffff'].map((c) => T.tone(c, 0.7));
  for (let x = 0; x < p.w; x++) {
    const yy = Math.round(y + Math.sin((x / p.w) * Math.PI) * sag);
    p.put(x, yy, T.tone('#4a3a3a', 0.7));
    if (x % 6 === 0) {
      const c = cols[(x / 6) % cols.length];
      for (let i = 0; i < 4; i++) p.rect(x + 1 + Math.floor(i / 2), yy + 1 + i, 4 - Math.floor(i / 2) * 2, 1, c);
    }
  }
}

function cobbles(p, T, y0) {
  for (let y = y0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const row = Math.floor((y - y0) / 3);
      const edge = (y - y0) % 3 === 2 || (x + row * 3) % 6 === 0;
      p.put(x, y, T.tone(edge ? '#8a8494' : (x + y) % 5 === 0 ? '#c8c2cc' : '#b4aebc', 0.8));
    }
}

function plaza(p, R) {
  const T = time(R.pick(['morning', 'day', 'golden']));
  sky(p, T, 30, R);
  for (let i = 0; i < R.int(1, 3); i++) cloud(p, T, R.int(-10, p.w), R.int(8, 16), R.int(20, 40), R);
  facades(p, T, R, 48);
  bunting(p, T, R, 8, 8);
  cobbles(p, T, 48);
  // the band in the middle
  const mid = R.int(80, p.w - 80);
  const base = R.int(54, 57);
  const pal = () => personColours(R, T);
  person(p, T, R, mid - 18, base, { pose: 'person' });
  draw(p, T, 'guitar', mid - 19, base - 8, { b: '#e8943a', o: '#3a2010', n: '#6a3a1a' }, { outline: '#2a1408' });
  person(p, T, R, mid - 6, base, { pose: 'person' });
  draw(p, T, 'drum', mid - 6, base - 6, { r: '#e8403a', w: '#f4f0e8' }, { outline: '#3a1a1a' });
  person(p, T, R, mid + 6, base, { pose: 'person', flip: true });
  draw(p, T, 'trumpet', mid + 12, base - 9, { y: '#ffd040', Y: '#ffe890' }, { outline: '#7a5a1a' });
  person(p, T, R, mid + 18, base, { pose: 'dress' });
  draw(p, T, 'violin', mid + 22, base - 11, { b: '#c8642a', n: '#4a2a10' }, { outline: '#2a1408' });
  // notes rising
  const noteC = T.tone(R.pick(['#3a3a6a', '#6a3a8a', '#2a5a8a']));
  for (let i = 0; i < R.int(4, 7); i++) p.sprite(mid + R.int(-30, 30), base - R.int(18, 34), ART[R.chance(0.6) ? 'note' : 'notes'], { x: noteC });
  // dancers and listeners
  for (let i = 0; i < R.int(5, 9); i++) {
    const side = R.chance(0.5) ? -1 : 1;
    const x = mid + side * R.int(34, 110);
    if (x < -4 || x > p.w) continue;
    person(p, T, R, x, base + R.int(-1, 2), { pose: R.pick(['person', 'dress', 'kid', 'cheer']), flip: side > 0, colours: pal() });
  }
  if (R.chance(0.6)) {
    const dx = R.int(10, p.w - 20);
    p.rect(dx, base - 1, 6, 1, T.tone('#5a3a2a'));
  }
}

function concert(p, R) {
  p.grad(0, p.h, ['#07041a', '#140a30', '#24104a', '#1a0a30']);
  // the stage
  const sx = R.int(70, p.w - 70);
  const sw = R.int(80, 110);
  const floor = 36;
  const beams = ['#ff4ab4', '#4ad8ff', '#ffd84a', '#8a5aff', '#5aff9a'];
  const cols = [R.pick(beams), R.pick(beams), R.pick(beams)].map(hex);
  // light beams fanning down through the haze
  for (let k = 0; k < 6; k++) {
    const bx = sx - sw / 2 + 8 + (k * (sw - 16)) / 5;
    const ang = Math.PI / 2 + R.range(-0.7, 0.7);
    const c = cols[k % 3];
    for (let i = 0; i < 60; i++) {
      const w = 1 + i * 0.18;
      for (let j = -w; j <= w; j++) p.tint(bx + Math.cos(ang) * i - Math.sin(ang) * j, 8 + Math.sin(ang) * i, c, 0.22 * (1 - i / 60));
    }
  }
  p.rect(sx - sw / 2, 6, sw, 2, hex('#3a3a4a'));
  for (let k = 0; k < 6; k++) {
    const bx = sx - sw / 2 + 8 + (k * (sw - 16)) / 5;
    p.glow(bx, 8, 6, cols[k % 3], 0.8);
    p.disc(bx, 8, 1.5, hex('#ffffff'));
  }
  p.rect(sx - sw / 2, 8, 2, floor - 8, hex('#2a2a3a'));
  p.rect(sx + sw / 2 - 2, 8, 2, floor - 8, hex('#2a2a3a'));
  // a big screen glowing behind
  p.rect(sx - 22, 12, 44, 16, mix(cols[0], [20, 10, 40], 0.55));
  for (let y = 12; y < 28; y += 2) p.rect(sx - 22, y, 44, 1, mix(cols[1], [20, 10, 40], 0.65));
  p.rect(sx - sw / 2, floor, sw, 4, hex('#3a2a4a'));
  p.rect(sx - sw / 2, floor, sw, 1, hex('#8a7aa8'));
  // the band on stage
  const lit = { tone: (c) => hex(c), dark: 0 };
  person(p, lit, R, sx - 26, floor, { pose: 'person' });
  draw(p, lit, 'guitar', sx - 27, floor - 8, { b: '#e8403a', o: '#1a1010', n: '#3a2a2a' }, { outline: '#1a0a0a' });
  person(p, lit, R, sx - 3, floor, { pose: 'cheer' });
  person(p, lit, R, sx + 20, floor, { pose: 'person', flip: true });
  draw(p, lit, 'guitar', sx + 19, floor - 8, { b: '#3a7ae8', o: '#1a1010', n: '#3a2a2a' }, { outline: '#0a0a1a' });
  p.rect(sx + 8, floor - 8, 8, 6, hex('#c8ccd8'));
  p.rect(sx + 9, floor - 7, 6, 4, hex('#e8403a'));
  // haze
  for (let y = 26; y < 46; y++) for (let x = 0; x < p.w; x++) if (dither(x, y) < 0.3) p.tint(x, y, cols[1], 0.08);
  // the crowd, hands up
  const crowdC = [hex('#1a1030'), hex('#24163e'), hex('#2e1c4a')];
  for (let row = 0; row < 3; row++) {
    const base = 50 + row * 5;
    for (let x = R.int(-6, 0); x < p.w; x += R.int(5, 8)) {
      const pose = R.chance(0.35) ? 'cheer' : 'back';
      silhouette(p, pose, x, base - 13 + R.int(-1, 1), crowdC[row]);
      if (pose === 'cheer' && R.chance(0.2)) p.glow(x, base - 14, 3, hex('#ffffff'), 0.6);
    }
  }
  for (let i = 0; i < 10; i++) p.put(R.int(0, p.w), R.int(38, 58), hex(R.pick(['#5affa8', '#ff6ad0', '#ffd84a'])));
}

function winter(p, R) {
  const T = time(R.pick(['day', 'morning', 'dusk', 'night']));
  const hz = R.int(28, 32);
  skyWith(p, T, R, hz, { clouds: [1, 3] });
  mountains(p, T, R, hz + 4, R.int(14, 20), ['#ffffff', '#b8c8e8', '#ffffff', '#b8c8e8'], { far: 0.3, snow: 30, step: 26 });
  const snowCols = ['#ffffff', '#e4eefc', '#b8cce8'];
  const k = T.dark > 0.3 ? 0.6 : 1;
  const n = noise(R, p.w, 70);
  const top = (x) => hz + 12 + n(x) * 4;
  land(p, top, (x, y, d) => T.tone(d < 1 ? snowCols[0] : d < 6 || dither(x, y) > (d - 6) / 12 ? snowCols[1] : snowCols[2], k));
  pineRow(p, { ...T, tone: (c) => T.tone(c, k) }, R, hz + 12, 8, 14, PINE, 11, { snow: true, fill: false, wobble: 2 });
  const lit = T.dark > 0.3;
  const count = R.int(3, 4);
  for (let i = 0; i < count; i++) {
    const x = Math.round(((i + R.range(0.1, 0.6)) / count) * p.w);
    const w = R.int(14, 20);
    house(p, { ...T, tone: (c) => T.tone(c, k) }, R, x, Math.round(top(x + w / 2)) + 8, w, R.int(9, 13), { wall: R.pick(['#e8b484', '#c87a5a', '#f2e2c4', '#a8c4e0']), roof: '#c84a3a', snow: true, lit });
  }
  const near = (x) => p.h - 3 + n(x * 2) * 1;
  land(p, near, (x, y) => T.tone(dither(x, y) < 0.5 ? snowCols[0] : snowCols[1], k));
  // a snowman and children
  const sx = R.int(20, p.w - 20);
  const sb = p.h - 2;
  const white = T.tone('#ffffff', k);
  const shade = T.tone('#c8d8f0', k);
  for (const [dy, r] of [[-4, 4], [-10, 3], [-14.5, 2]]) {
    p.disc(sx, sb + dy, r, white);
    p.disc(sx + r * 0.4, sb + dy + r * 0.3, r * 0.7, shade);
    p.disc(sx - r * 0.2, sb + dy - r * 0.15, r * 0.75, white);
  }
  p.put(sx - 1, sb - 15, T.tone('#1a1a2a', k));
  p.put(sx + 1, sb - 15, T.tone('#1a1a2a', k));
  p.put(sx + 2, sb - 14, T.tone('#ff8a2a', k));
  p.rect(sx - 2, sb - 13, 5, 1, T.tone('#e8403a', k));
  p.rect(sx - 2, sb - 19, 5, 2, T.tone('#2a2a3a', k));
  p.rect(sx - 3, sb - 17, 7, 1, T.tone('#2a2a3a', k));
  p.line(sx - 3, sb - 10, sx - 7, sb - 13, T.tone('#6a4a2a', k));
  p.line(sx + 3, sb - 10, sx + 7, sb - 13, T.tone('#6a4a2a', k));
  const kidT = { tone: (c, kk = 1) => T.tone(c, k * kk) };
  for (let i = 0; i < R.int(1, 3); i++) person(p, kidT, R, sx + (i % 2 ? -1 : 1) * R.int(10, 30), sb, { pose: 'kid' });
  if (R.chance(0.6)) {
    const lx = R.int(10, p.w - 30);
    p.rect(lx, sb - 2, 10, 1, T.tone('#c84a3a', k));
    p.put(lx + 10, sb - 3, T.tone('#c84a3a', k));
    person(p, kidT, R, lx + 2, sb - 2, { pose: 'kid' });
  }
  for (let i = 0; i < 70; i++) p.put(R.int(0, p.w), R.int(0, p.h), T.tone('#ffffff', 0.3));
}

function rain(p, R) {
  const T = time(R.pick(['dusk', 'night']));
  p.grad(0, 40, ['#2a3050', '#3a4468', '#4a5a7e', '#5a6a8a']);
  const lit = { ...T, tone: (c) => T.tone(c, 0.5), dark: 0.5 };
  facades(p, lit, R, 42, { minH: 20, maxH: 36, lit: true });
  // shop awnings
  for (let x = R.int(0, 10); x < p.w; x += R.int(26, 40)) {
    const c = R.pick([['#e8403a', '#f4f0e8'], ['#3a8a5a', '#f4f0e8'], ['#3a6ab8', '#ffd84a']]);
    for (let i = 0; i < 14; i++) p.rect(x + i, 30, 1, 3, T.tone(c[Math.floor(i / 2) % 2], 0.5));
    p.rect(x, 33, 14, 1, T.tone('#2a2a3a', 0.5));
  }
  // the wet street
  p.rect(0, 42, p.w, p.h - 42, T.tone('#4a5068', 0.5));
  reflect(p, 43, p.h, hex('#2a3050'), 0.45, R, 1);
  // lamps
  for (let x = R.int(10, 30); x < p.w; x += R.int(55, 75)) {
    p.rect(x, 22, 1, 20, hex('#1a1a2a'));
    p.rect(x - 1, 21, 3, 2, hex('#1a1a2a'));
    p.glow(x, 23, 14, hex('#ffd890'), 0.55);
    p.rect(x - 1, 23, 3, 2, hex('#fff2b0'));
    for (let y = 46; y < p.h; y += 2) p.tint(x + R.int(-1, 1), y, hex('#ffd890'), 0.5);
  }
  // people under umbrellas
  for (let i = 0; i < R.int(3, 5); i++) {
    const x = R.int(10, p.w - 20);
    const base = R.int(52, 58);
    person(p, { tone: (c, k = 1) => T.tone(c, 0.45 * k) }, R, x, base, { pose: R.pick(['walk', 'person', 'dress']), flip: R.chance(0.5) });
    const uc = T.tone(R.pick(['#e8403a', '#3a7ae8', '#ffd84a', '#5ac87a', '#ff8ac8', '#2a2a3a']), 0.35);
    const ux = x + 3;
    const uy = base - 15;
    for (let y = -4; y <= 0; y++) for (let dx = -7; dx <= 7; dx++) if ((dx / 7) ** 2 + (y / 4) ** 2 <= 1) p.put(ux + dx, uy + y, (dx + 7) % 5 === 0 ? deep(uc, 0.25) : uc);
    p.line(ux, uy, ux, uy + 6, hex('#1a1a2a'));
  }
  // the rain
  for (let i = 0; i < 260; i++) {
    const x = R.int(0, p.w + 20);
    const y = R.int(-4, p.h);
    const len = R.int(3, 6);
    for (let k = 0; k < len; k++) p.tint(x - k * 0.5, y + k, hex('#c8d8f8'), 0.5);
  }
  for (let i = 0; i < 25; i++) {
    const x = R.int(0, p.w);
    const y = R.int(44, p.h);
    p.tint(x - 1, y, [220, 230, 255], 0.5);
    p.tint(x + 1, y, [220, 230, 255], 0.5);
  }
}

function harbor(p, R) {
  const T = time('night');
  sky(p, T, 60, R);
  const fw = ['#ff4a6a', '#ffd84a', '#5ad8ff', '#8aff6a', '#ff8ae8', '#ffffff'];
  for (let i = 0; i < R.int(3, 5); i++) firework(p, R, R.int(20, p.w - 20), R.int(8, 22), R.int(6, 11), R.pick(fw));
  // the town on the hill
  const n = noise(R, p.w, 60);
  const hill = (x) => 30 + n(x) * 5;
  land(p, hill, (x, y) => T.tone('#3a4a6a', 0.7));
  for (let x = R.int(0, 6); x < p.w; x += R.int(8, 14)) {
    const w = R.int(6, 11);
    const h = R.int(5, 10);
    const b = Math.round(hill(x)) + R.int(4, 9);
    p.rect(x, b - h, w, h, T.tone(R.pick(['#e8c8a0', '#c8a0a0', '#a0b8d8']), 0.6));
    for (let k = 0; k < w - 2; k += 2) if (R.chance(0.55)) p.rect(x + 1 + k, b - h + 2, 1, 2, hex('#ffd26a'));
    for (let i = 0; i < 3; i++) p.rect(x - 1 + i, b - h - 1 - i, w + 2 - i * 2, 1, T.tone('#a8443a', 0.6));
  }
  const wy = 42;
  p.rect(0, 40, p.w, 2, T.tone('#4a4a5a', 0.6));
  reflect(p, wy, p.h, hex('#0e1a40'), 0.35, R, 1.5);
  // boats with lanterns
  for (let i = 0; i < R.int(2, 4); i++) {
    const bx = R.int(10, p.w - 30);
    const by = R.int(46, 54);
    for (let dx = 0; dx < 20; dx++) {
      const depth = Math.round(3 - Math.abs(dx - 10) / 5);
      p.rect(bx + dx, by, 1, depth, T.tone(R.chance(0.02) ? '#ffffff' : '#c8643a', 0.5));
    }
    p.rect(bx, by, 20, 1, T.tone('#f4e0c0', 0.5));
    p.line(bx + 10, by, bx + 10, by - 14, T.tone('#8a6a4a', 0.5));
    for (let k = 0; k < 3; k++) {
      const lx = bx + 3 + k * 7;
      const ly = by - 5 - (k === 1 ? 4 : 0);
      p.glow(lx, ly, 5, hex('#ffb84a'), 0.6);
      p.put(lx, ly, hex('#fff0a0'));
    }
    p.line(bx + 3, by - 5, bx + 10, by - 9, T.tone('#5a4a3a', 0.5));
    p.line(bx + 10, by - 9, bx + 17, by - 5, T.tone('#5a4a3a', 0.5));
  }
  // people on the pier
  const px = R.int(0, p.w - 60);
  p.rect(px, 40, 60, 3, T.tone('#6a4a3a', 0.6));
  for (let x = px; x < px + 60; x += 6) p.rect(x, 43, 1, 4, T.tone('#4a3a2a', 0.6));
  for (let i = 0; i < 4; i++) person(p, { tone: (c, k = 1) => mix(T.tone(c, 0.7 * k), '#ffb070', 0.12) }, R, px + 6 + i * 13 + R.int(-2, 2), 40, { pose: R.chance(0.5) ? 'back' : 'cheer' });
}

// ---------- Old battles ----------

function knight(p, T, R, x, base, flip, coat, horseC, banner) {
  draw(p, T, 'horse', x, base - 13, { h: horseC, m: deep(horseC, 0.4), e: horseC, k: '#2a2a2a' }, { flip, outline: '#1a1418' });
  draw(p, T, 'rider', x + (flip ? 8 : 4), base - 16, { a: '#c8ccd8', A: '#3a3a4a', p: banner, c: coat }, { flip, outline: '#1a1418' });
  const lx = x + (flip ? 7 : 9);
  p.line(lx, base - 9, lx, base - 30, T.tone('#6a4a2a'));
  const fc = T.tone(banner);
  for (let i = 0; i < 7; i++) for (let j = 0; j < 4; j++) p.put(lx + (flip ? -1 - i : 1 + i), base - 30 + j + (i > 4 && j === 3 ? -1 : 0), j === 1 && i > 1 && i < 5 ? T.tone('#ffd84a') : fc);
}

function siege(p, R) {
  const T = time(R.pick(['day', 'golden', 'sunset']));
  const hz = R.int(30, 34);
  skyWith(p, T, R, hz, { clouds: [2, 4] });
  mountains(p, T, R, hz, R.int(10, 16), ['#a8b4d4', '#7a86b0', '#ffffff', '#c8d4ee'], { far: 0.45, snow: 4, step: 30 });
  const left = R.chance(0.5);
  const mid = hills(p, T, R, hz + 6, 4, GRASS_FAR, 60, 0.15);
  // the castle on its hill
  const cw = R.int(56, 70);
  const cx = left ? R.int(4, 16) : p.w - cw - R.int(4, 16);
  const roof = R.pick(['#3a6ad0', '#c84a3a', '#5a4a8a']);
  const flag = R.pick(['#e8403a', '#3a7ae8', '#ffd84a']);
  castle(p, T, R, cx, Math.round(mid(cx + cw / 2)) + 6, cw, R.int(24, 30), { roof, banner: flag });
  const near = hills(p, T, R, p.h - 8, 2, GRASS, 70);
  // the army marching on it
  const coats = ['#e8403a', '#3a6ad0', '#2a9a5a', '#a25ad8'].filter((c) => c !== flag);
  const coat = R.pick(coats);
  const horses = ['#f4f0e8', '#8a5a3a', '#3a2a22', '#c8a070'];
  const dir = !left;
  const ax = left ? cx + cw + R.int(20, 34) : R.int(10, 30);
  for (let i = 0; i < R.int(2, 3); i++) {
    const kx = ax + i * 24;
    knight(p, T, R, kx, Math.round(near(kx + 8)) + 4, left ? true : false, coat, R.pick(horses), coat);
  }
  for (let i = 0; i < R.int(4, 6); i++) {
    const sx = ax + R.int(-6, 90);
    const base = Math.round(near(sx)) + R.int(5, 8);
    const pal = { ...personColours(R, T, { shirt: coat }), a: T.tone('#c8ccd8'), A: T.tone('#5a5a6a'), C: T.tone('#ffd84a') };
    p.sprite(sx, base - 12, ART.soldier, pal, { flip: left, outline: T.tone('#1a1418') });
    p.line(sx + (left ? 0 : 6), base - 2, sx + (left ? 0 : 6), base - 20, T.tone('#6a4a2a'));
    p.put(sx + (left ? 0 : 6), base - 21, T.tone('#e8ecf4'));
  }
  // a catapult and its stone
  const tx = left ? Math.min(p.w - 30, ax + R.int(70, 100)) : Math.max(10, ax + R.int(80, 110));
  const tb = Math.round(near(tx)) + 4;
  const wood = T.tone('#8a5a32');
  p.rect(tx, tb - 3, 16, 2, wood);
  p.disc(tx + 3, tb - 1, 2, T.tone('#5a3a22'));
  p.disc(tx + 13, tb - 1, 2, T.tone('#5a3a22'));
  p.line(tx + 4, tb - 3, tx + 8, tb - 11, wood);
  p.line(tx + 12, tb - 3, tx + 8, tb - 11, wood);
  p.line(tx + 8, tb - 9, left ? tx + 1 : tx + 15, tb - 20, T.tone('#a8743a'));
  const targetX = cx + cw / 2;
  const sx = left ? tx + 1 : tx + 15;
  const sy = tb - 20;
  const steps = 40;
  for (let i = 0; i < steps; i += 3) {
    const t = i / steps;
    const x = sx + (targetX - sx) * t * 0.7;
    const y = sy - Math.sin(t * Math.PI) * 14 + t * 6;
    p.tint(x, y, T.tone('#ffffff'), 0.5);
  }
  const t = 0.7;
  p.disc(sx + (targetX - sx) * t * 0.7, sy - Math.sin(t * Math.PI) * 14 + t * 6, 1.6, T.tone('#6a6a72'));
  if (R.chance(0.7)) smoke(p, T, cx + R.int(10, cw - 20), Math.round(mid(cx)) - R.int(2, 10), R.int(10, 16), R, ['#e8e8ec', '#b8b8c4', '#8a8a98']);
  birdFlock(p, T, R, R.int(1, 4), 0, p.w, 3, 14);
}

function seaBattle(p, R) {
  const T = time(R.pick(['golden', 'sunset', 'day']));
  const hz = R.int(34, 38);
  const { sx } = skyWith(p, T, R, hz, { clouds: [3, 5] });
  water(p, T, R, hz, { sunX: sx, sunR: 3 });
  waves(p, T, R, hz + 1, p.h, { calm: 0.4 });
  const s1 = R.range(0.85, 1.05);
  const s2 = R.range(0.6, 0.8);
  const x1 = R.int(18, 50);
  const x2 = p.w - R.int(18, 50);
  const y1 = R.int(50, 54);
  const y2 = R.int(43, 47);
  const c1 = R.pick([['#e8403a', '#ffd84a'], ['#3a6ad0', '#ffffff']]);
  const c2 = R.pick([['#2a9a5a', '#ffffff'], ['#a25ad8', '#ffd84a'], ['#1a1a2a', '#ffffff']]);
  galleon(p, T, R, x2, y2, s2, { flip: true, flag: c2[0], stripe: c2[1] });
  galleon(p, T, R, x1, y1, s1, { flag: c1[0], stripe: c1[1] });
  for (let i = 0; i < R.int(2, 3); i++) cannonFire(p, T, R, x1 + 26 * s1 + i * 6, y1 - 5, 1);
  if (R.chance(0.8)) cannonFire(p, T, R, x2 - 20 * s2, y2 - 4, -1);
  for (let i = 0; i < R.int(2, 4); i++) splash(p, T, R, R.int(x1 + 50, x2 - 40), R.int(hz + 6, p.h - 4), R.int(4, 7), R.int(6, 12));
  for (let x = 0; x < p.w; x++) if (R.chance(0.5)) p.tint(x, y1 + 2, [255, 255, 255], 0.3);
  birdFlock(p, T, R, R.int(1, 3), 0, p.w, 3, 14);
}

// ---------- Machines ----------

function city(p, R) {
  const T = time(R.pick(['night', 'dusk']));
  skyWith(p, T, R, 50, { clouds: [0, 1] });
  // far skyline
  for (let x = 0; x < p.w; ) {
    const w = R.int(6, 14);
    const h = R.int(12, 30);
    p.rect(x, 50 - h, w, h, T.far('#5a6a9a', 0.35));
    for (let y = 50 - h + 2; y < 50; y += 3) for (let k = 1; k < w - 1; k += 2) if (R.chance(0.25)) p.put(x + k, y, mix(T.far('#ffd26a', 0.2), [255, 220, 120], 0.5));
    x += w + R.int(0, 2);
  }
  // near towers
  const neon = ['#ff4ab4', '#4ad8ff', '#ffd84a', '#8a5aff', '#5aff9a'];
  for (let x = R.int(-8, 0); x < p.w; ) {
    const w = R.int(12, 22);
    const h = R.int(24, 50);
    const base = 60;
    const body = T.tone(R.pick(['#3a4a7a', '#4a3a6a', '#2a4a6a', '#3a3a5a']), 0.4);
    p.rect(x, base - h, w, h, body);
    p.rect(x + w - 3, base - h, 3, h, deep(body, 0.3));
    p.rect(x, base - h, w, 1, lighter(body, 0.25));
    const glass = R.pick(['#ffd26a', '#8ae8ff', '#ffb0e0']);
    for (let y = base - h + 3; y < base - 2; y += 3) for (let k = 2; k < w - 3; k += 3) if (R.chance(0.55)) p.rect(x + k, y, 2, 1, hex(glass));
    if (R.chance(0.6)) {
      p.rect(x + w / 2, base - h - 6, 1, 6, deep(body, 0.2));
      p.glow(x + w / 2, base - h - 6, 3, hex('#ff4a4a'), 0.8);
      p.put(x + w / 2, base - h - 6, hex('#ff8a8a'));
    }
    if (R.chance(0.5)) {
      const c = hex(R.pick(neon));
      const ny = base - h + R.int(4, Math.max(5, h - 10));
      p.glow(x + w / 2, ny + 1, 8, c, 0.5);
      p.rect(x + 2, ny, w - 4, 3, c);
      p.rect(x + 3, ny + 1, w - 6, 1, lighter(c, 0.6));
    }
    x += w + R.int(0, 3);
  }
  // the monorail across
  const ry = R.int(30, 38);
  p.rect(0, ry, p.w, 2, hex('#4a5a7a'));
  for (let x = R.int(0, 20); x < p.w; x += 40) p.rect(x, ry + 2, 3, 60 - ry, hex('#2a3450'));
  const tx = R.int(0, p.w - 60);
  p.rect(tx, ry - 6, 54, 6, hex('#e8ecf4'));
  p.rect(tx, ry - 6, 54, 1, hex('#ffffff'));
  p.rect(tx + 50, ry - 5, 4, 4, hex('#c8ccd8'));
  for (let k = 3; k < 48; k += 5) p.rect(tx + k, ry - 4, 3, 2, hex('#8ae8ff'));
  p.rect(tx, ry - 2, 54, 1, hex(R.pick(neon)));
  // flying cars and their trails
  for (let i = 0; i < R.int(3, 6); i++) {
    const cx = R.int(10, p.w - 10);
    const cy = R.int(6, 28);
    const dir = R.chance(0.5) ? 1 : -1;
    const c = hex(R.pick(neon));
    for (let k = 1; k < 24; k++) p.tint(cx - dir * k, cy + 1, c, 0.6 * (1 - k / 24));
    p.rect(cx - 3, cy, 7, 2, hex('#c8ccd8'));
    p.rect(cx - 1, cy - 1, 3, 1, hex('#8ae8ff'));
    p.put(cx + dir * 3, cy + 1, hex('#ffffff'));
    p.glow(cx + dir * 4, cy + 1, 3, hex('#ffffff'), 0.6);
  }
}

function launch(p, R) {
  const T = time(R.pick(['morning', 'day', 'golden', 'dusk']));
  const hz = R.int(38, 42);
  skyWith(p, T, R, hz, { clouds: [1, 3] });
  water(p, T, R, hz, {});
  const n = noise(R, p.w, 60);
  land(p, (x) => hz + 4 + n(x) * 1.5, (x, y, d) => T.tone(d < 1 ? '#c8d890' : '#9ab870'));
  const rx = R.int(70, p.w - 70);
  const lift = R.int(0, 16);
  // the tower
  const tx = rx + 9;
  const red = T.tone('#d8503a');
  for (let y = 8; y < hz + 6; y++) {
    p.put(tx, y, red);
    p.put(tx + 5, y, red);
    if (y % 4 === 0) p.line(tx, y, tx + 5, y + 4, red);
  }
  for (const ay of [16, 24]) p.rect(tx - 3, ay, 3, 1, red);
  p.rect(tx - 1, 6, 8, 2, red);
  rocket(p, T, R, rx, hz + 6, R.int(28, 34), lift);
  // the smoke rolling out
  for (let i = 0; i < 8; i++) {
    const side = i % 2 ? 1 : -1;
    const dx = side * (4 + i * 5);
    smoke(p, T, rx + dx - 8, hz + 7 - Math.round(i * 0.4), R.int(12, 20), R);
  }
  if (lift > 6) for (let i = 0; i < 4; i++) smoke(p, T, rx - 6 + R.int(-3, 3), hz + 4 - i * 4, 10, R);
  // people watching on the beach
  const near = (x) => p.h - 5 + n(x * 3) * 1.5;
  land(p, near, (x, y, d) => T.tone(d < 1 ? '#fff0c0' : '#f0d898'));
  const crowdX = rx > p.w / 2 ? R.int(6, 60) : R.int(p.w - 100, p.w - 60);
  for (let i = 0; i < R.int(4, 7); i++) person(p, T, R, crowdX + i * 8 + R.int(-1, 1), p.h - 3, { pose: R.pick(['back', 'cheer', 'back']) });
  birdFlock(p, T, R, R.int(2, 4), 0, p.w, 4, 20);
}

function viaduct(p, R) {
  const T = time(R.pick(['morning', 'day', 'golden']));
  skyWith(p, T, R, 34, { clouds: [2, 3] });
  mountains(p, T, R, 34, R.int(16, 22), ['#a8b4d4', '#7a86b0', '#ffffff', '#c8d4ee'], { far: 0.45, snow: 6, step: 28 });
  hills(p, T, R, 40, 6, GRASS_FAR, 50, 0.2);
  blobRow(p, T, R, 46, 3, 6, LEAF, { far: 0.1 });
  water(p, T, R, 52, {});
  // the stone bridge
  const deck = R.int(28, 32);
  const stone = ['#e2cfae', '#b89a74', '#8a6e52'].map((c) => T.tone(c));
  const span = R.int(20, 26);
  const off = R.int(0, span);
  for (let x = 0; x < p.w; x++) {
    const u = (((x + off) % span) + span) % span;
    const inArch = Math.abs(u - span / 2) < span / 2 - 2.5;
    const archY = inArch ? deck + 5 + Math.round((1 - Math.sqrt(Math.max(0, 1 - ((u - span / 2) / (span / 2 - 2.5)) ** 2))) * 6) : 99;
    for (let y = deck; y < 56; y++) {
      if (inArch && y >= archY) continue;
      let c = (y - deck) % 4 === 3 || (x + Math.floor((y - deck) / 4) * 3) % 7 === 0 ? stone[1] : stone[0];
      if (!inArch || y < archY - 1) c = u > span - 4 ? stone[1] : c;
      if (y === deck) c = stone[2];
      p.put(x, y, c);
    }
  }
  p.rect(0, deck - 1, p.w, 1, stone[2]);
  // the train and its steam
  const cars = R.int(2, 4);
  const len = cars * 17 + 18;
  const tx = R.int(0, p.w - len);
  const { stackX, stackY } = train(p, T, R, tx, deck - 1, cars, { car: R.pick(['#3a7a5a', '#3a5a9a', '#8a3a3a']) });
  for (let i = 0; i < 7; i++) smoke(p, T, stackX - 4 - i * 9, stackY - 1 - Math.round(Math.sin(i * 0.8) * 2) - Math.min(i, 3), 8 + i * 2, R);
  birdFlock(p, T, R, R.int(1, 3), 0, p.w, 3, 14);
}

function windfarm(p, R) {
  const T = time(R.pick(['morning', 'day', 'golden']));
  const hz = R.int(30, 34);
  skyWith(p, T, R, hz, { clouds: [2, 4] });
  const far = hills(p, T, R, hz + 2, 6, GRASS_FAR, 70, 0.4);
  for (let i = 0; i < R.int(3, 5); i++) {
    const x = R.int(10, p.w - 10);
    turbine(p, { tone: (c) => T.far(c, 0.3) }, x, Math.round(far(x)) + 1, R.int(12, 16), R() * Math.PI * 2);
  }
  const mid = hills(p, T, R, hz + 14, 7, GRASS, 60);
  for (let i = 0; i < R.int(2, 4); i++) {
    const x = R.int(20, p.w - 20);
    turbine(p, T, x, Math.round(mid(x)) + 1, R.int(24, 30), R() * Math.PI * 2);
  }
  // solar panels in rows
  const sx = R.int(10, p.w - 90);
  for (let r = 0; r < 2; r++)
    for (let k = 0; k < 6; k++) {
      const x = sx + k * 13 + r * 4;
      const y = 50 + r * 5;
      for (let i = 0; i < 4; i++) p.rect(x + i, y - i, 10, 1, T.tone(i === 3 ? '#8ab4ff' : (k + i) % 2 ? '#2a4ab8' : '#3a5ad0'));
      p.rect(x + 4, y + 1, 1, 2, T.tone('#6a6a7a'));
    }
  const hx = sx > p.w / 2 ? R.int(14, 60) : R.int(p.w - 70, p.w - 30);
  house(p, T, R, hx, Math.round(mid(hx)) + 8, 14, 8, { wall: '#f2e2c4', roof: '#3a6a9a' });
  for (let i = 0; i < R.int(2, 4); i++) draw(p, T, 'sheep', hx + R.int(-30, 40), p.h - 8, { w: '#ffffff', f: '#2a2a2a', e: '#ffffff', k: '#2a2a2a' }, { flip: R.chance(0.5), outline: '#6a6a7a' });
  birdFlock(p, T, R, R.int(1, 3), 0, p.w, 4, hz - 10);
}

function dishes(p, R) {
  const T = time(R.pick(['night', 'dusk']));
  sky(p, T, 60, R);
  milkyWay(p, R, 44);
  if (R.chance(0.6)) shootingStar(p, R, 16);
  const n = noise(R, p.w, 60);
  land(p, (x) => 46 + n(x) * 1.5, (x, y, d) => T.tone(d < 1 ? '#c8a878' : dither(x, y) < 0.3 ? '#8a6a4a' : '#a88a5a', 0.7));
  const tilt = R.range(-0.7, 0.7);
  const count = R.int(3, 5);
  const start = R.int(10, 40);
  for (let i = 0; i < count; i++) {
    const s = 1 - i * 0.16;
    const x = start + i * R.int(40, 50);
    if (x > p.w + 10) break;
    dish(p, { tone: (c, k = 1) => T.tone(c, 0.55 * k) }, x, Math.round(50 + s * 6), Math.round(9 * s), tilt);
  }
  const bx = R.int(10, p.w - 30);
  p.rect(bx, 50, 14, 6, T.tone('#e8e4dc', 0.6));
  p.rect(bx + 2, 52, 3, 2, hex('#ffd26a'));
  p.rect(bx + 8, 52, 3, 2, hex('#ffd26a'));
  p.glow(bx + 7, 53, 9, hex('#ffcf70'), 0.3);
}

export const WORLD = { observatory, space, aurora, sunrise, plaza, concert, winter, rain, harbor, siege, seaBattle, city, launch, viaduct, windfarm, dishes };
