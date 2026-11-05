// The drawing kit for the label rows' scenes: a picture 60 pixels tall (240 wide unless asked otherwise), gradients
// like a handheld's, sprites with outlines, and the pieces scenes are made of. Everything is drawn from a seed.
export const H = 60;

export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (a, b) => a + next() * (b - a);
  next.int = (a, b) => Math.floor(a + next() * (b - a + 1));
  next.pick = (list) => list[Math.floor(next() * list.length)];
  next.chance = (p) => next() < p;
  return next;
}

export const hex = (s) => (typeof s === 'string' ? [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)] : s);
export const mix = (a, b, t) => {
  a = hex(a);
  b = hex(b);
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
};
export const lighter = (c, t) => mix(c, [255, 255, 255], t);
export const darker = (c, t) => mix(c, [0, 0, 0], t);
// a darker, more saturated shade, for outlines and shadows the way handheld artists pick them
export const deep = (c, t = 0.45) => {
  const [r, g, b] = hex(c);
  const m = Math.max(r, g, b);
  return [r, g, b].map((v) => Math.round(Math.max(0, (v - (m - v) * 0.35) * (1 - t))));
};

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
export const dither = (x, y) => BAYER[((y & 3) << 2) | (x & 3)];

// a smooth line of noise across a width, between -1 and 1, that meets itself at both ends
export function noise(R, w, step = 24) {
  const n = Math.max(2, Math.round(w / step));
  const knots = Array.from({ length: n }, () => R() * 2 - 1);
  return (x) => {
    const f = ((((x / w) * n) % n) + n) % n;
    const i = Math.floor(f);
    const t = (1 - Math.cos((f - i) * Math.PI)) / 2;
    return knots[i] * (1 - t) + knots[(i + 1) % n] * t;
  };
}

// The times of day: the sky from top to horizon, the light, the sun or moon, clouds and water.
const TIMES = {
  morning: {
    sky: ['#4a86e0', '#69a2ec', '#93c3f6', '#c3e2fc', '#eef8ff'],
    sun: '#fffdf0', glow: '#fff4c4', cloud: ['#ffffff', '#eaf3fd', '#c4d6f0'], haze: '#c2dcf5',
    water: ['#bfe6ff', '#6fbdf1', '#3f95dc', '#2b72bf', '#1d5296'], shine: '#ffffff', ambient: '#ffffff', dark: 0,
  },
  day: {
    sky: ['#2f6fd6', '#4a8be6', '#78b0f3', '#addaff', '#e0f4ff'],
    sun: '#fffbe6', glow: '#fff0b0', cloud: ['#ffffff', '#e6f0fc', '#b9ceec'], haze: '#b4d4f3',
    water: ['#c8ecff', '#6cc0f2', '#3a92da', '#2a6dbc', '#1c4d92'], shine: '#ffffff', ambient: '#ffffff', dark: 0,
  },
  golden: {
    sky: ['#4b66c0', '#7e8cd6', '#cfa0c2', '#ffc99b', '#fff0cf'],
    sun: '#fff6cf', glow: '#ffd890', cloud: ['#fff1dc', '#ffc6a2', '#c98896'], haze: '#e5b4ae',
    water: ['#ffe2b3', '#d9a2a6', '#8b82b8', '#5a61a2', '#394383'], shine: '#fff4d6', ambient: '#ff8a4a', dark: 0.14,
  },
  sunset: {
    sky: ['#2a1d5c', '#5a2a78', '#a3407c', '#e2665d', '#ffa75b', '#ffdf8e'],
    sun: '#fff3bd', glow: '#ffc874', cloud: ['#ffd197', '#f0846d', '#a44873'], haze: '#c55e7e',
    water: ['#ffc47a', '#de7068', '#98487b', '#5b336e', '#32234e'], shine: '#ffe2a2', ambient: '#4a1f66', dark: 0.34,
  },
  dusk: {
    sky: ['#0f143e', '#24296a', '#4b3e8d', '#8a589e', '#d685a1'],
    sun: '#ffe6c4', glow: '#e8a0b4', cloud: ['#b97fae', '#7c5a99', '#4a3c78'], haze: '#6e5590',
    water: ['#c98aae', '#7a5a9c', '#45407e', '#2a2b5e', '#1a1c44'], shine: '#f3c1d6', ambient: '#1e1c5a', dark: 0.5,
    stars: 0.35,
  },
  night: {
    sky: ['#03061b', '#081133', '#0f1f4c', '#192f64', '#24437d'],
    sun: '#f6f2d6', glow: '#7d93d6', cloud: ['#4a5d96', '#34457a', '#232f5c'], haze: '#2c3f74',
    water: ['#2f4a8a', '#1f3470', '#152657', '#0e1a40', '#08112c'], shine: '#a9c1ff', ambient: '#0b1747', dark: 0.62,
    stars: 1, moon: true,
  },
};

export const TIME_NAMES = Object.keys(TIMES);

export function time(name) {
  const t = TIMES[name];
  return {
    name,
    sky: t.sky.map(hex), sun: hex(t.sun), glow: hex(t.glow), cloud: t.cloud.map(hex), haze: hex(t.haze),
    water: t.water.map(hex), shine: hex(t.shine), stars: t.stars ?? 0, moon: !!t.moon, dark: t.dark,
    night: t.dark > 0.45,
    tone: (c, k = 1) => mix(c, t.ambient, t.dark * k),
    // a colour half lost in the distance, for far hills and mountains
    far: (c, k = 0.55) => mix(mix(c, t.ambient, t.dark), t.haze, k),
  };
}

export class Pic {
  constructor(w = 240, h = H) {
    this.w = w;
    this.h = h;
    this.d = new Uint8ClampedArray(w * h * 4);
  }

  put(x, y, c) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || !c) return;
    const i = (y * this.w + x) * 4;
    this.d[i] = c[0];
    this.d[i + 1] = c[1];
    this.d[i + 2] = c[2];
    this.d[i + 3] = 255;
  }

  get(x, y) {
    x = Math.max(0, Math.min(this.w - 1, Math.floor(x)));
    y = Math.max(0, Math.min(this.h - 1, Math.floor(y)));
    const i = (y * this.w + x) * 4;
    return [this.d[i], this.d[i + 1], this.d[i + 2]];
  }

  // mixes a colour over what's there
  tint(x, y, c, a) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (!(a > 0) || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.put(x, y, mix(this.get(x, y), c, Math.max(0, Math.min(1, a))));
  }

  rect(x, y, w, h, c) {
    for (let yy = Math.floor(y); yy < y + h; yy++) for (let xx = Math.floor(x); xx < x + w; xx++) this.put(xx, yy, c);
  }

  // rows y0 to y1 through a list of colours, dithered between each pair
  grad(y0, y1, cols, x0 = 0, x1 = this.w) {
    cols = cols.map(hex);
    for (let y = Math.floor(y0); y < y1; y++) {
      const f = Math.max(0, Math.min(0.999, (y - y0) / Math.max(1, y1 - y0 - 1))) * (cols.length - 1);
      const i = Math.floor(f);
      for (let x = Math.floor(x0); x < x1; x++) this.put(x, y, f - i > dither(x, y) ? cols[Math.min(i + 1, cols.length - 1)] : cols[i]);
    }
  }

  disc(cx, cy, r, c) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++) if ((x - cx + 0.5) ** 2 + (y - cy + 0.5) ** 2 <= r * r) this.put(x, y, c);
  }

  ellipse(cx, cy, rx, ry, c) {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) if (((x - cx + 0.5) / rx) ** 2 + ((y - cy + 0.5) / ry) ** 2 <= 1) this.put(x, y, c);
  }

  // a soft light around a point, dithered away
  halo(cx, cy, r, c, strength = 0.7) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const d = Math.hypot(x - cx + 0.5, y - cy + 0.5) / r;
        if (d < 1 && (1 - d) * strength > dither(x, y)) this.put(x, y, c);
      }
  }

  // a softer light that mixes rather than covers
  glow(cx, cy, r, c, strength = 0.5) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const d = Math.hypot(x - cx + 0.5, y - cy + 0.5) / r;
        if (d < 1) this.tint(x, y, c, (1 - d) ** 1.6 * strength);
      }
  }

  line(x0, y0, x1, y1, c) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.put(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), c);
  }

  // A picture drawn as text: each letter a colour from `pal`, a dot left clear. With `outline`, every clear pixel
  // touching the picture takes that colour, the way handheld sprites are drawn.
  sprite(x, y, art, pal, { flip = false, outline = null } = {}) {
    x = Math.round(x);
    y = Math.round(y);
    const w = Math.max(...art.map((r) => r.length));
    const h = art.length;
    const at = (dx, dy) => {
      if (dy < 0 || dy >= h || dx < 0 || dx >= w) return null;
      const ch = art[dy][flip ? w - 1 - dx : dx];
      return ch && ch !== '.' && ch !== ' ' ? pal[ch] : null;
    };
    if (outline) {
      for (let dy = -1; dy <= h; dy++)
        for (let dx = -1; dx <= w; dx++) {
          if (at(dx, dy)) continue;
          if (at(dx - 1, dy) || at(dx + 1, dy) || at(dx, dy - 1) || at(dx, dy + 1)) this.put(x + dx, y + dy, outline);
        }
    }
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++) {
        const c = at(dx, dy);
        if (c) this.put(x + dx, y + dy, c);
      }
  }
}

// ---------- The sky ----------

export function sky(p, T, horizon, R) {
  p.grad(0, horizon, T.sky);
  p.rect(0, horizon, p.w, p.h - horizon, T.sky[T.sky.length - 1]);
  if (T.stars) {
    const n = Math.round((p.w / 240) * 70 * T.stars);
    for (let i = 0; i < n; i++) {
      const x = R.int(0, p.w - 1);
      const y = R.int(0, Math.max(1, horizon - 4));
      const bright = R();
      p.put(x, y, mix(T.sky[0], [255, 255, 255], 0.3 + bright * 0.6));
      if (bright > 0.94) {
        const c = [255, 255, 255];
        p.tint(x - 1, y, c, 0.35);
        p.tint(x + 1, y, c, 0.35);
        p.tint(x, y - 1, c, 0.35);
        p.tint(x, y + 1, c, 0.35);
      }
    }
  }
}

export function sun(p, T, x, y, r, R) {
  if (T.moon) {
    p.glow(x, y, r * 4, T.glow, 0.45);
    p.disc(x, y, r, T.sun);
    const shadow = mix(T.sun, '#b8b49a', 0.6);
    for (let i = 0; i < 3; i++) p.disc(x + R.range(-r * 0.45, r * 0.3), y + R.range(-r * 0.45, r * 0.3), R.range(0.7, r * 0.3), shadow);
    return;
  }
  p.glow(x, y, r * 4.5, T.glow, 0.6);
  p.disc(x, y, r + 1, mix(T.sun, T.glow, 0.5));
  p.disc(x, y, r, T.sun);
}

// a puffy cloud whose flat bottom sits on y, lit from above
export function cloud(p, T, x, y, w, R, cols = T.cloud) {
  const puffs = [];
  const n = Math.max(2, Math.round(w / 8));
  for (let i = 0; i < n; i++) {
    const mid = 1 - Math.abs((i + 0.5) / n - 0.5) * 1.5;
    puffs.push({ x: x + ((i + 0.5) * w) / n + R.range(-1.5, 1.5), r: 2.5 + mid * R.range(2.5, 5) });
  }
  const [light, midc, low] = cols.map(hex);
  for (let yy = Math.floor(y - 13); yy <= y; yy++)
    for (let xx = Math.floor(x - 7); xx <= x + w + 7; xx++) {
      let inside = false;
      let up = 0;
      for (const puff of puffs) {
        const cy = y - puff.r * 0.5;
        const d = Math.hypot(xx - puff.x, yy - cy);
        if (d <= puff.r) {
          inside = true;
          up = Math.max(up, (cy - yy) / puff.r);
        }
      }
      if (!inside) continue;
      const fromBottom = y - yy;
      let c = light;
      if (fromBottom < 1.5) c = low;
      else if (fromBottom < 3.5) c = dither(xx, yy) < 0.6 ? midc : light;
      else if (up < 0.1) c = dither(xx, yy) < 0.35 ? midc : light;
      p.put(xx, yy, c);
    }
}

export function birdFlock(p, T, R, n, x0, x1, y0, y1, colour) {
  const c = hex(colour ?? T.tone('#2a2f45'));
  for (let i = 0; i < n; i++) {
    const x = R.int(x0, x1);
    const y = R.int(y0, y1);
    if (R.chance(0.5)) p.sprite(x, y, ['o...o', '.o.o.'], { o: c });
    else p.sprite(x, y, ['.o.o.', 'o...o'], { o: c });
  }
}

// ---------- The land ----------

// land under a line, `top(x)` its height at each column, shaded by `colour(x, y, depth)`
export function land(p, top, colour, bottom = p.h) {
  for (let x = 0; x < p.w; x++) {
    const t = Math.round(top(x));
    for (let y = Math.max(0, t); y < bottom; y++) p.put(x, y, colour(x, y, y - t));
  }
}

// grassy hills: a bright edge, then the grass, darker further down
export function hills(p, T, R, base, amp, cols, step = 40, far = 0) {
  const n = noise(R, p.w, step);
  const n2 = noise(R, p.w, step / 3);
  const top = (x) => base - amp * (n(x) * 0.8 + n2(x) * 0.2);
  const [edge, body, low] = cols.map((c) => (far ? T.far(c, far) : T.tone(c)));
  land(p, top, (x, y, d) => (d < 1 ? edge : d < 3 && dither(x, y) < 0.5 ? edge : d > 5 && dither(x, y) < Math.min(0.85, (d - 5) / 9) ? low : body));
  return top;
}

// Mountains the way pixel artists draw them: peaks with a sunlit left face and a shaded right one, gullies running
// down both, and snow on the high ones.
export function mountains(p, T, R, base, height, cols, { far = 0, snow = 0, step = 22 } = {}) {
  const n = Math.max(2, Math.round(p.w / (step * 1.8)));
  const peaks = [];
  for (let i = -1; i <= n; i++)
    peaks.push({ x: ((i + R.range(0.15, 0.85)) / n) * p.w, h: height * R.range(0.5, 1), sl: R.range(0.55, 1.05), sr: R.range(0.55, 1.05), k: R.int(0, 8) });
  const jag = noise(R, p.w, 5);
  const owner = new Int16Array(p.w);
  const tops = new Float32Array(p.w);
  for (let x = 0; x < p.w; x++) {
    let best = -1e9;
    peaks.forEach((pk, i) => {
      const dx = x - pk.x;
      const v = pk.h - Math.abs(dx) * (dx < 0 ? pk.sl : pk.sr);
      if (v > best) (best = v), (owner[x] = i);
    });
    tops[x] = base - Math.max(1, best + jag(x) * 1.2);
  }
  const tone = (c) => (far ? T.far(c, far) : T.tone(c));
  const [lit, shade, snowLit, snowShade] = cols.map(tone);
  const gully = mix(lit, shade, 0.55);
  const gullyS = mix(shade, [0, 0, 0], 0.12);
  land(p, (x) => tops[x], (x, y, d) => {
    const pk = peaks[owner[x]];
    const sunny = x < pk.x || (x - pk.x < 1 && dither(x, y) < 0.5);
    const peakY = base - pk.h;
    const fromPeak = y - peakY;
    if (snow && pk.h > height * 0.62 && fromPeak < snow * (pk.h / height) + jag(x * 3) * 2.5 + 1) return sunny ? snowLit : snowShade;
    const g = (x + Math.round(y * (sunny ? -0.75 : 0.75)) + pk.k) % 7 === 0 && d > 2;
    return sunny ? (g ? gully : lit) : g ? gullyS : shade;
  }, base + 1);
  return (x) => tops[Math.max(0, Math.min(p.w - 1, Math.round(x)))];
}

// a row of round treetops or bushes, lit from the top left, solid below
export function blobRow(p, T, R, base, rmin, rmax, cols, { far = 0, fill = true } = {}) {
  const tone = (c) => (far ? T.far(c, far) : T.tone(c));
  const [lit, body, dark] = cols.map(tone);
  if (fill) p.rect(0, base, p.w, p.h - base, dark);
  for (let x = R.int(-rmax, 0); x < p.w + rmax; ) {
    const r = R.range(rmin, rmax);
    const cy = base - r * 0.55 + R.range(-1, 1);
    for (let y = Math.floor(cy - r); y <= base; y++)
      for (let xx = Math.floor(x - r); xx <= x + r; xx++) {
        const dx = (xx - x + 0.5) / r;
        const dy = (y - cy + 0.5) / r;
        if (dx * dx + dy * dy > 1 && y < cy) continue;
        if (Math.abs(dx) > 1) continue;
        const light = -dx * 0.5 - dy * 0.9;
        p.put(xx, y, light > 0.45 + dither(xx, y) * 0.3 ? lit : light < -0.35 + dither(xx, y) * 0.3 ? dark : body);
      }
    x += r * R.range(1.1, 1.6);
  }
}

// still water between y and the bottom, with the light dancing on it
export function water(p, T, R, y, { sunX = -99, sunR = 0, cols = T.water, x0 = 0, x1 = p.w, sparkle = 1 } = {}) {
  p.grad(y, p.h, cols, x0, x1);
  for (let yy = y; yy < p.h; yy++) {
    const depth = (yy - y) / (p.h - y);
    for (let k = 0; k < ((6 - depth * 4) * (x1 - x0) * sparkle) / 240; k++) {
      const x = R.int(x0, x1);
      const len = R.int(2, 7 - Math.floor(depth * 3));
      for (let i = 0; i < len && x + i < x1; i++) p.tint(x + i, yy, T.shine, 0.5 - depth * 0.3);
    }
    if (sunR) {
      const half = sunR * (1.2 + depth * 0.8) + R.range(-1, 1);
      if (yy % 2 === 0 || R.chance(0.35))
        for (let x = Math.round(sunX - half); x < sunX + half; x++) if (R.chance(0.7)) p.tint(x, yy, T.sun, 0.75 - depth * 0.3);
    }
  }
}

// ---------- Trees ----------

export function pine(p, T, x, base, h, cols, snow = false) {
  const [lit, body, dark] = cols.map((c) => T.tone(c));
  const white = T.tone('#f4f8ff');
  p.rect(x, base - 2, 1, 2, dark);
  const tiers = Math.max(2, Math.round(h / 4));
  for (let i = 0; i < h - 1; i++) {
    const tier = Math.floor((i / (h - 1)) * tiers);
    const inTier = (i / (h - 1)) * tiers - tier;
    const half = Math.round((tier + 1) * 0.9 + inTier * 1.6 + tier * 0.25);
    const y = base - h + i;
    for (let dx = -half; dx <= half; dx++) {
      let c = dx < -half / 3 ? lit : dx > half / 3 ? dark : body;
      if (inTier > 0.8 && Math.abs(dx) === half) c = dark;
      if (snow && inTier < 0.3 && Math.abs(dx) < half) c = white;
      p.put(x + dx, y, c);
    }
  }
  p.put(x, base - h, lit);
}

export function roundTree(p, T, x, base, r, cols, trunk = '#6b4527') {
  const [lit, body, dark] = cols.map((c) => T.tone(c));
  const cy = base - r * 1.6;
  p.rect(x - 1, cy, 2, base - cy, T.tone(trunk));
  p.put(x, base - 1, T.tone(deep(trunk)));
  const blobs = [[0, 0, r], [-r * 0.62, r * 0.3, r * 0.68], [r * 0.62, r * 0.25, r * 0.7], [0, -r * 0.45, r * 0.7]];
  for (let y = Math.floor(cy - r * 1.3); y <= cy + r; y++)
    for (let xx = Math.floor(x - r * 1.5); xx <= x + r * 1.5; xx++) {
      let inside = false;
      for (const [bx, by, br] of blobs) if ((xx - x - bx) ** 2 + (y - cy - by) ** 2 <= br * br) inside = true;
      if (!inside) continue;
      const lx = (xx - x) / r;
      const ly = (y - cy) / r;
      const light = -lx * 0.55 - ly * 0.85;
      p.put(xx, y, light > 0.3 + dither(xx, y) * 0.35 ? lit : light < -0.5 + dither(xx, y) * 0.35 ? dark : body);
    }
}

export function palm(p, T, x, base, h, lean, cols) {
  const trunk = T.tone('#9a6d3c');
  const ring = T.tone('#6a4628');
  let tx = x;
  for (let i = 0; i < h; i++) {
    tx = x + lean * (i / h) ** 1.6;
    p.put(tx, base - i, i % 3 === 0 ? ring : trunk);
    p.put(tx + 1, base - i, ring);
  }
  const [lit, body] = cols.map((c) => T.tone(c));
  const top = base - h;
  for (const [dx, dy, len] of [[-1, 0.15, 10], [1, 0.2, 10], [-0.75, -0.55, 6], [0.8, -0.5, 6], [-0.95, 0.55, 8], [0.95, 0.6, 8]]) {
    for (let i = 0; i < len; i++) {
      const fx = tx + dx * i;
      const fy = top + dy * i + (i * i) / (len * 1.3);
      p.put(fx, fy, i < len / 2 ? lit : body);
      p.put(fx, fy + 1, body);
    }
  }
  p.disc(tx + 0.5, top + 1.5, 1.5, T.tone('#5a3a1e'));
}

// a patch of grass blades and flowers along a line
export function grassTufts(p, T, R, top, cols, flowers = []) {
  const [lit, dark] = cols.map((c) => T.tone(c));
  for (let x = 0; x < p.w; x++) {
    const y = Math.round(top(x));
    if (R.chance(0.35)) p.put(x, y - 1, R.chance(0.5) ? lit : dark);
    if (R.chance(0.08)) p.put(x, y - 2, lit);
    if (flowers.length && R.chance(0.07)) {
      const c = T.tone(R.pick(flowers));
      p.put(x, y - 2, c);
      p.put(x, y - 1, dark);
    }
  }
}
