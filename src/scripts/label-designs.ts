// The site's own designs for the places in the label rows that nobody has asked for (docs/LABELS.md): small pixel
// pictures drawn here from a number, each one different, so the rows are always full and never show the same design
// twice. They're landscapes and patterns only: never words, a brand, a game's art or a character.

// drawn at half a label's size, so each of their pixels is two of the screen's, like the site's own frames
export const DW = 120;
export const DH = 30;

type Colour = [number, number, number];

interface Colours {
  light: Colour;
  mid: Colour;
  deep: Colour;
  dark: Colour;
  pop: Colour;
  sun: Colour;
  night: Colour;
}

type Motif = (p: Pic, r: () => number, c: Colours) => void;

// the same numbers for the same seed, every time
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hsl(h: number, s: number, l: number): Colour {
  const hue = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const part = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [part(hue + 1 / 3), part(hue), part(hue - 1 / 3)].map((v) => Math.round(v * 255)) as Colour;
}

const mix = (a: Colour, b: Colour, t: number): Colour => a.map((v, i) => Math.round(v + (b[i] - v) * t)) as Colour;

class Pic {
  private readonly px: Uint8ClampedArray;

  constructor(image: ImageData) {
    this.px = image.data;
  }

  dot(x: number, y: number, c: Colour) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= DW || y >= DH) return;
    const i = (y * DW + x) * 4;
    this.px[i] = c[0];
    this.px[i + 1] = c[1];
    this.px[i + 2] = c[2];
    this.px[i + 3] = 255;
  }

  rect(x: number, y: number, w: number, h: number, c: Colour) {
    for (let yy = Math.floor(y); yy < y + h; yy++) for (let xx = Math.floor(x); xx < x + w; xx++) this.dot(xx, yy, c);
  }

  fill(c: Colour) {
    this.rect(0, 0, DW, DH, c);
  }

  // a sky in four bands, from its top colour to its bottom one
  sky(top: Colour, bottom: Colour, until = DH) {
    for (let y = 0; y < until; y++) this.rect(0, y, DW, 1, mix(top, bottom, Math.floor((y / until) * 4) / 3));
  }

  disc(cx: number, cy: number, radius: number, c: Colour) {
    for (let y = Math.floor(cy - radius); y <= cy + radius; y++)
      for (let x = Math.floor(cx - radius); x <= cx + radius; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius + radius * 0.6) this.dot(x, y, c);
  }
}

// little pictures for the patterns of icons, five by five
const SPRITES = [
  ['.#.#.', '#####', '#####', '.###.', '..#..'],
  ['..#..', '.###.', '#####', '.###.', '..#..'],
  ['..#..', '..#..', '#####', '..#..', '..#..'],
  ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  ['.###.', '#...#', '#...#', '#...#', '.###.'],
  ['..#..', '.###.', '#.#.#', '..#..', '..#..'],
  ['.#.#.', '#.#.#', '.###.', '#.#.#', '.#.#.'],
  ['#####', '#...#', '#.#.#', '#...#', '#####'],
];

const MOTIFS: Motif[] = [
  // rolling hills under a sun
  (p, r, c) => {
    p.sky(c.light, mix(c.light, c.pop, 0.5));
    p.disc(10 + r() * 100, 5 + r() * 6, 3 + r() * 3, c.sun);
    [c.mid, c.deep, c.dark].forEach((col, layer) => {
      const base = 13 + layer * 5 + r() * 3;
      const amp = 1.5 + r() * 3;
      const f = 0.04 + r() * 0.08;
      const ph = r() * 7;
      for (let x = 0; x < DW; x++) {
        const top = base + amp * Math.sin(x * f + ph) + amp * 0.5 * Math.sin(x * f * 2.3 + ph * 1.7);
        p.rect(x, top, 1, DH, col);
      }
    });
  },
  // mountains with snow on their tops
  (p, r, c) => {
    p.sky(mix(c.light, c.pop, 0.3), c.light);
    const peaks = Array.from({ length: 3 + Math.floor(r() * 4) }, () => ({ x: r() * DW, top: 3 + r() * 14, slope: 0.6 + r() * 0.9 }));
    for (let x = 0; x < DW; x++) {
      let top = DH;
      for (const peak of peaks) top = Math.min(top, peak.top + Math.abs(x - peak.x) * peak.slope);
      for (let y = Math.floor(top); y < DH; y++) p.dot(x, y, y - top < 2 && top < 16 ? c.light : y > 25 ? c.dark : c.deep);
    }
  },
  // a city at night
  (p, r, c) => {
    p.sky(c.night, c.dark);
    for (let i = 0; i < 30; i++) p.dot(r() * DW, r() * 16, c.light);
    const block = mix(c.night, [0, 0, 0], 0.35);
    for (let x = 0; x < DW; ) {
      const w = 5 + Math.floor(r() * 8);
      const h = 6 + Math.floor(r() * 20);
      p.rect(x, DH - h, w - 1, h, block);
      for (let wy = DH - h + 2; wy < DH - 1; wy += 3) for (let wx = x + 1; wx < x + w - 2; wx += 2) if (r() < 0.4) p.dot(wx, wy, c.sun);
      x += w;
    }
  },
  // a pine forest
  (p, r, c) => {
    p.sky(c.light, c.mid, 26);
    p.rect(0, 26, DW, 4, c.dark);
    for (let x = -4; x < DW; x += 3 + Math.floor(r() * 5)) {
      const h = 8 + Math.floor(r() * 15);
      const col = r() < 0.5 ? c.deep : c.dark;
      for (let y = 0; y < h; y++) p.rect(x - Math.floor(y / 2.4), 27 - h + y, Math.floor(y / 2.4) * 2 + 1, 1, col);
    }
  },
  // the sea, with the sun on the horizon
  (p, r, c) => {
    const horizon = 11 + Math.floor(r() * 7);
    p.sky(mix(c.pop, c.light, 0.4), c.light, horizon);
    p.disc(15 + r() * 90, horizon, 3 + r() * 4, c.sun);
    const ph = r() * 7;
    for (let y = horizon; y < DH; y++)
      for (let x = 0; x < DW; x++)
        p.dot(x, y, Math.sin(x * 0.55 + y * 1.4 + ph) > 0.82 ? c.light : mix(c.mid, c.deep, (y - horizon) / (DH - horizon)));
  },
  // a planet with a ring, among stars
  (p, r, c) => {
    p.fill(c.night);
    for (let i = 0; i < 45; i++) p.dot(r() * DW, r() * DH, r() < 0.7 ? c.mid : c.light);
    const cx = 15 + r() * 90;
    const cy = 8 + r() * 14;
    const radius = 5 + r() * 5;
    p.disc(cx, cy, radius, c.pop);
    p.disc(cx + radius * 0.3, cy + radius * 0.3, radius * 0.7, mix(c.pop, c.night, 0.25));
    for (let x = Math.floor(cx - radius * 2); x <= cx + radius * 2; x++) p.dot(x, cy + (x - cx) * 0.2, c.light);
  },
  // a checkerboard
  (p, r, c) => {
    const cell = 2 + Math.floor(r() * 5);
    const shift = r() < 0.5 ? 0 : Math.floor(cell / 2);
    for (let y = 0; y < DH; y++)
      for (let x = 0; x < DW; x++) {
        const row = Math.floor(y / cell);
        p.dot(x, y, (Math.floor((x + row * shift) / cell) + row) % 2 ? c.light : c.mid);
      }
  },
  // diagonal stripes in three colours
  (p, r, c) => {
    const w = 2 + Math.floor(r() * 5);
    const dir = r() < 0.5 ? 1 : -1;
    const cols = [c.light, c.mid, r() < 0.5 ? c.pop : c.deep];
    for (let y = 0; y < DH; y++)
      for (let x = 0; x < DW; x++) p.dot(x, y, cols[(((Math.floor((x + dir * y + 60) / w)) % 3) + 3) % 3]);
  },
  // a pattern of little icons
  (p, r, c) => {
    p.fill(c.light);
    const sprite = SPRITES[Math.floor(r() * SPRITES.length)];
    const sx = 8 + Math.floor(r() * 6);
    const sy = 7 + Math.floor(r() * 3);
    let n = 0;
    for (let y = 1, row = 0; y < DH; y += sy, row++)
      for (let x = row % 2 ? sx / 2 : 1; x < DW; x += sx, n++)
        sprite.forEach((line, dy) => [...line].forEach((on, dx) => on === '#' && p.dot(x + dx, y + dy, n % 2 ? c.mid : c.pop)));
  },
  // zigzag bands
  (p, r, c) => {
    const bh = 4 + Math.floor(r() * 5);
    const period = 6 + Math.floor(r() * 10);
    const cols = [c.light, c.mid, c.deep, c.pop];
    for (let y = 0; y < DH; y++)
      for (let x = 0; x < DW; x++) {
        const tri = Math.abs((x % period) - period / 2);
        p.dot(x, y, cols[Math.floor((y + tri) / bh) % cols.length]);
      }
  },
  // a mosaic of blocks
  (p, r, c) => {
    const block = 3 + Math.floor(r() * 4);
    const cols = [c.light, c.light, c.mid, c.deep, c.pop];
    for (let y = 0; y < DH; y += block) for (let x = 0; x < DW; x += block) p.rect(x, y, block, block, cols[Math.floor(r() * cols.length)]);
  },
  // swirling bands of colour
  (p, r, c) => {
    const [a, b, f, d] = [0.05 + r() * 0.15, 0.1 + r() * 0.3, 0.03 + r() * 0.1, 0.1 + r() * 0.2];
    const [ph1, ph2, ph3] = [r() * 7, r() * 7, r() * 7];
    const cx = r() * DW;
    const cy = r() * DH;
    const cols = [c.light, c.mid, c.pop, c.deep, c.dark];
    for (let y = 0; y < DH; y++)
      for (let x = 0; x < DW; x++) {
        const v = Math.sin(x * a + ph1) + Math.sin(y * b + ph2) + Math.sin((x + y) * f + ph3) + Math.sin(Math.hypot(x - cx, (y - cy) * 2) * d);
        p.dot(x, y, cols[Math.min(4, Math.floor(((v + 4) / 8) * 5))]);
      }
  },
  // a meadow with flowers
  (p, r, c) => {
    const ground = 15 + Math.floor(r() * 5);
    p.sky(c.light, mix(c.light, c.pop, 0.4), ground);
    p.rect(0, ground, DW, DH, c.mid);
    for (let x = 0; x < DW; x++) p.rect(x, ground - Math.floor(r() * 3), 1, 3, r() < 0.5 ? c.deep : c.mid);
    for (let i = 0; i < 16; i++) {
      const x = r() * DW;
      const y = ground + 2 + r() * (DH - ground - 3);
      p.dot(x, y + 1, c.deep);
      p.dot(x, y, r() < 0.5 ? c.sun : c.pop);
    }
  },
  // polka dots
  (p, r, c) => {
    p.fill(c.mid);
    const gap = 6 + Math.floor(r() * 5);
    const radius = 1 + r() * 1.6;
    for (let y = gap / 2, row = 0; y < DH + gap; y += gap, row++)
      for (let x = row % 2 ? gap / 2 : 0; x < DW + gap; x += gap) p.disc(x, y, radius, r() < 0.15 ? c.pop : c.light);
  },
  // a brick wall
  (p, r, c) => {
    p.fill(c.light);
    const bw = 8 + Math.floor(r() * 7);
    const bh = 4 + Math.floor(r() * 3);
    for (let y = 0, row = 0; y < DH; y += bh, row++)
      for (let x = row % 2 ? -Math.floor(bw / 2) : 0; x < DW; x += bw) p.rect(x, y, bw - 1, bh - 1, mix(c.mid, c.deep, r() * 0.7));
  },
  // waves stacked on waves
  (p, r, c) => {
    const bh = 3 + Math.floor(r() * 4);
    const f = 0.08 + r() * 0.2;
    const amp = 1 + r() * 3;
    const ph = r() * 7;
    const cols = [c.light, c.mid, c.pop, c.mid];
    for (let y = 0; y < DH; y++)
      for (let x = 0; x < DW; x++) p.dot(x, y, cols[Math.floor((y + 40 + amp * Math.sin(x * f + ph + y * 0.1)) / bh) % cols.length]);
  },
  // a sunset over the plains, the sun cut in stripes
  (p, r, c) => {
    const horizon = 18 + Math.floor(r() * 6);
    for (let y = 0; y < horizon; y++) p.rect(0, y, DW, 1, mix(c.pop, c.sun, Math.floor((y / horizon) * 6) / 5));
    const cx = 15 + r() * 90;
    const radius = 7 + r() * 6;
    for (let y = Math.floor(horizon - radius); y < horizon; y++)
      if (y < horizon - radius / 2 || y % 3)
        for (let x = Math.floor(cx - radius); x <= cx + radius; x++) if ((x - cx) ** 2 + (y - horizon) ** 2 <= radius * radius) p.dot(x, y, c.light);
    p.rect(0, horizon, DW, DH, c.dark);
    for (let x = 0; x < DW; x += 6) for (let y = horizon + 1; y < DH; y++) p.dot(x + (x - DW / 2) * ((y - horizon) / (DH - horizon)) * 0.5, y, c.deep);
  },
  // falling confetti
  (p, r, c) => {
    p.fill(c.deep);
    for (let i = 0; i < 55; i++) {
      const x = r() * DW;
      const y = r() * DH;
      const col = [c.light, c.pop, c.sun, c.mid][Math.floor(r() * 4)];
      for (let k = 0; k < 3; k++) p.dot(x + k, y + k * (r() < 0.5 ? 1 : 0), col);
    }
  },
];

export const KINDS = MOTIFS.length;

/**
 * Draws one design into `image`, which is DW x DH. `kind` picks its picture, so neighbours can be kept apart, and
 * `seed` everything else: its colours, sizes and places, so no two seeds make the same design.
 */
export function drawDesign(image: ImageData, kind: number, seed: number) {
  const r = random(seed);
  const h = r() * 360;
  const colours: Colours = {
    light: hsl(h, 0.55, 0.86),
    mid: hsl(h + 25, 0.5, 0.64),
    deep: hsl(h + 50, 0.45, 0.42),
    dark: hsl(h + 70, 0.4, 0.26),
    pop: hsl(h + 180, 0.6, 0.62),
    sun: hsl(h + 200, 0.75, 0.78),
    night: hsl(h + 220, 0.45, 0.16),
  };
  MOTIFS[((kind % KINDS) + KINDS) % KINDS](new Pic(image), r, colours);
  return image;
}
