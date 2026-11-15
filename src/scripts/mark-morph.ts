// The logo in Settings moves from one pose to another as one dolphin (#1328): its body bends, its tail swings and,
// asleep, its eye closes, where the launcher's other marks swap one drawing for the next (mark.ts).
//
// The poses are the same dolphin drawn three times (src/lib/mark.ts, mark-poses.ts), each outline traced on its own,
// so nothing in the drawings says which point of one is which point of another. This file works that out, in the
// browser, from the drawings themselves, so no second copy of them is kept:
// - an outline has no sharp corners to count, so two outlines are lined up by where they turn: a fin's tip and a
//   tail's tips turn the same however the body is bent;
// - the body then moves by turning and stretching each edge of its outline, which swings a tail where moving each
//   point in a straight line would squash it on the way;
// - the belly, the smile, the flipper's line and the eye ride the stretch of body nearest to them;
// - what only one pose has (drops, waves, small stars, the fluke over a sleeping belly) fades.
// Everything is in one square 1000 wide, whatever box a pose was drawn in.
import { MARK, POSES, type Art, type PoseName } from '../lib/mark';

type Point = [number, number];
type Cubic = [Point, Point, Point, Point];

/** One pose as lists of numbers: point i of a list is the same spot on the dolphin in every pose. */
interface PoseData {
  body: number[];
  belly: number[];
  soft: number[];
  smile: number[];
  eye: number[];
  star: number[];
  /** the eye's white dot: its middle and its size */
  dot: [number, number, number];
  /** where the body's, the belly's and the star's runs of colour start and end */
  gb: number[];
  gw: number[];
  gs: number[];
  softW: number;
  smileW: number;
  /** how thick the eye's own line is: nothing for an open eye, the eyelid's width for a closed one */
  eyeW: number;
  starO: number;
  /** from the pose's own drawing to the square: its size, then its move */
  k: number;
  tx: number;
  ty: number;
  /** what only this pose has, as drawn */
  props: string;
  /** the tail's fluke lying over the belly: its line, cut to the body, and its fill */
  fluke?: { line: string; fill: string };
}

/** What is on screen: a pose, or a moment between two. */
interface Look {
  body: number[];
  belly: number[];
  soft: number[];
  smile: number[];
  eye: number[];
  star: number[];
  dot: [number, number, number];
  gb: number[];
  gw: number[];
  gs: number[];
  softW: number;
  smileW: number;
  eyeW: number;
  starO: number;
  props: Record<string, number>;
  holds?: Record<Held, Hold>;
}

const HELD = ['belly', 'soft', 'smile', 'eye', 'dotAt'] as const;
type Held = (typeof HELD)[number];

/** How a list of points rides the body: for each, the stretches of outline it rides, how much, and where it sits from each. */
interface Hold {
  idx: Int32Array;
  w: Float64Array;
  ox: Float64Array;
  oy: Float64Array;
  m: number;
}

const numbers = (text: string) => (text.match(/-?\d*\.?\d+/g) ?? []).map(Number);

// ---------- reading the drawings ----------

interface Part {
  tag: string;
  attrs: Record<string, string>;
  src: string;
}

function parts(svg: string): Part[] {
  return [...svg.matchAll(/<(path|circle)\b([^>]*?)\/?>/g)].map((found) => ({
    tag: found[1],
    attrs: Object.fromEntries([...found[2].matchAll(/([\w-]+)="([^"]*)"/g)].map((attr) => [attr[1], attr[2]])),
    src: found[0],
  }));
}

/** A path of `M` and `C` alone, as its curves. */
function cubics(d: string): Cubic[] {
  const n = numbers(d);
  const out: Cubic[] = [];
  let from: Point = [n[0], n[1]];
  for (let i = 2; i + 5 < n.length; i += 6) {
    const to: Point = [n[i + 4], n[i + 5]];
    out.push([from, [n[i], n[i + 1]], [n[i + 2], n[i + 3]], to]);
    from = to;
  }
  return out;
}

function at(c: Cubic, t: number): Point {
  const u = 1 - t;
  const on = (k: 0 | 1) => u * u * u * c[0][k] + 3 * u * u * t * c[1][k] + 3 * u * t * t * c[2][k] + t * t * t * c[3][k];
  return [on(0), on(1)];
}

/** Points along an open line: a few on each curve, and its end. */
function sampled(d: string, per: number): Point[] {
  const curves = cubics(d);
  const out: Point[] = [];
  for (const c of curves) for (let k = 0; k < per; k++) out.push(at(c, k / per));
  out.push(curves[curves.length - 1][3]);
  return out;
}

/** Points evenly spaced along a closed outline. */
function evenly(curves: Cubic[], count: number): Point[] {
  const fine: Point[] = [];
  for (const c of curves) for (let k = 0; k < 24; k++) fine.push(at(c, k / 24));
  const run = [0];
  for (let i = 0; i < fine.length; i++) {
    const a = fine[i];
    const b = fine[(i + 1) % fine.length];
    run.push(run[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const out: Point[] = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const want = (k / count) * run[fine.length];
    while (run[j + 1] < want) j++;
    const a = fine[j];
    const b = fine[(j + 1) % fine.length];
    const f = (want - run[j]) / (run[j + 1] - run[j] || 1);
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}

/** How sharply an outline turns at each point, looking a few points each way. */
function turning(points: Point[], reach: number): number[] {
  const n = points.length;
  return points.map((p, i) => {
    const a = points[(i - reach + n) % n];
    const b = points[(i + reach) % n];
    const t = Math.atan2(b[1] - p[1], b[0] - p[0]) - Math.atan2(p[1] - a[1], p[0] - a[0]);
    return t - 2 * Math.PI * Math.round(t / (2 * Math.PI));
  });
}

/** Lines up two outlines by how they turn, so tips meet tips: for each point of the first, its place along the second.
 *  A step takes one point of each, or two of one for one of the other, so neither is ever stretched past double. */
function linedUp(a: number[], b: number[]): number[] {
  const n = a.length;
  const m = b.length;
  const STEPS = [
    [1, 1],
    [1, 2],
    [2, 1],
  ];
  const cost = new Float64Array(n * m).fill(Infinity);
  const came = new Int8Array(n * m);
  const apart = (i: number, j: number) => (a[i] - b[j]) ** 2;
  cost[0] = apart(0, 0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const here = cost[i * m + j];
      if (here === Infinity) continue;
      for (let k = 0; k < STEPS.length; k++) {
        const x = i + STEPS[k][0];
        const y = j + STEPS[k][1];
        if (x >= n || y >= m) continue;
        // a step that isn't one for one costs a little, so the two stay in step where nothing tells them apart
        let v = here + apart(x, y) + (k ? 0.004 : 0);
        if (STEPS[k][0] === 2) v += apart(i + 1, y);
        if (STEPS[k][1] === 2) v += apart(x, j + 1);
        if (v < cost[x * m + y]) {
          cost[x * m + y] = v;
          came[x * m + y] = k;
        }
      }
    }
  }
  const place = new Array<number>(n).fill(0);
  for (let i = n - 1, j = m - 1; ; ) {
    place[i] = j;
    if (i === 0 && j === 0) break;
    const [di, dj] = STEPS[came[i * m + j]];
    if (di === 2) place[i - 1] = j - dj / 2;
    i -= di;
    j -= dj;
  }
  // the steps evened out a little, still in order
  const even = place.map((_, k) => {
    let sum = 0;
    let count = 0;
    for (let d = -3; d <= 3; d++) {
      if (k + d < 0 || k + d >= n) continue;
      sum += place[k + d];
      count++;
    }
    return sum / count;
  });
  even[0] = 0;
  return even;
}

/** An outline drawn once in each pose, as the same number of points at the same spots of the dolphin. The first pose
 *  is the measure: its points are evenly spaced, and the others' are where theirs line up with them. */
function sameSpots(outlines: string[], count: number): Point[][] {
  const FINE = 900;
  const fine = outlines.map((d) => evenly(cubics(d), FINE));
  const turns = fine.map((points) => turning(points, 6));
  const along = (points: Point[], x: number): Point => {
    const i = Math.floor(x);
    const f = x - i;
    const a = points[i % FINE];
    const b = points[(i + 1) % FINE];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  };
  return fine.map((points, pose) => {
    const place = pose ? linedUp(turns[0], turns[pose]) : null;
    const out: Point[] = [];
    for (let k = 0; k < count; k++) {
      const x = (k / count) * FINE;
      if (!place) {
        out.push(along(points, x));
        continue;
      }
      const i = Math.floor(x);
      const low = place[i];
      const high = i + 1 < FINE ? place[i + 1] : FINE;
      out.push(along(points, low + (high - low) * (x - i)));
    }
    return out;
  });
}

/** How one list of points sits on another: a turn, a size and a move. */
function fitted(a: Point[], b: Point[]): (p: Point) => Point {
  const middle = (points: Point[]): Point => [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length];
  const ca = middle(a);
  const cb = middle(b);
  let sin = 0;
  let cos = 0;
  let na = 0;
  let nb = 0;
  a.forEach((p, i) => {
    const ax = p[0] - ca[0];
    const ay = p[1] - ca[1];
    const bx = b[i][0] - cb[0];
    const by = b[i][1] - cb[1];
    sin += ax * by - ay * bx;
    cos += ax * bx + ay * by;
    na += ax * ax + ay * ay;
    nb += bx * bx + by * by;
  });
  const turn = Math.atan2(sin, cos);
  const size = Math.sqrt(nb / na);
  return (p) => {
    const x = (p[0] - ca[0]) * size;
    const y = (p[1] - ca[1]) * size;
    return [cb[0] + x * Math.cos(turn) - y * Math.sin(turn), cb[1] + x * Math.sin(turn) + y * Math.cos(turn)];
  };
}

const pairs = (list: number[]): Point[] => Array.from({ length: list.length / 2 }, (_, i): Point => [list[2 * i], list[2 * i + 1]]);

/** The poses as lists of matching points, read from their drawings. The first pose is the measure for the others. */
function read(art: Record<string, Art>): Record<string, PoseData> {
  const names = Object.keys(art);
  const drawn = names.map((name) => parts(art[name].svg));
  const big = (fill: string) => (part: Part) => part.tag === 'path' && part.attrs.fill === fill && (part.attrs.d ?? '').length > 1500;
  const found = (pose: number, test: (part: Part) => boolean) => drawn[pose].find(test);
  const need = (pose: number, what: string, test: (part: Part) => boolean) => {
    const part = found(pose, test);
    if (!part) throw new Error(`the logo's ${names[pose]} has no ${what}`);
    return part;
  };
  const bodies = sameSpots(names.map((_, pose) => need(pose, 'body', big('url(#ID-b)')).attrs.d), 400);
  const bellies = sameSpots(names.map((_, pose) => need(pose, 'belly', big('url(#ID-w)')).attrs.d), 220);

  const lids: (Point[] | null)[] = [];
  const out: Record<string, PoseData> = {};
  names.forEach((name, pose) => {
    const [vx, vy, vw] = art[name].viewBox.split(' ').map(Number);
    const k = 1000 / vw;
    const square = (p: Point): Point => [(p[0] - vx) * k, (p[1] - vy) * k];
    const flat = (points: Point[]) => points.flatMap(square);
    const soft = need(pose, "flipper's line", (part) => part.attrs.class === 'mk-line mk-soft' && part.attrs['stroke-width'] === '10.5');
    const smile = need(pose, 'smile', (part) => part.attrs.class === 'mk-line');
    const eye = found(pose, (part) => part.attrs.class === 'mk-eye');
    const lid = found(pose, (part) => part.attrs.class === 'mk-lid');
    const dot = found(pose, (part) => part.tag === 'circle' && part.attrs.fill === '#fff');
    const star = found(pose, (part) => part.attrs.fill === 'url(#ID-s)');
    const run = (id: string) => {
      const ends = new RegExp(`id="ID-${id}"[^>]*x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"`).exec(art[name].svg);
      return ends ? [...square([+ends[1], +ends[2]]), ...square([+ends[3], +ends[4]])] : [];
    };
    const stars = star ? (star.attrs.d.match(/M[^M]*/g) ?? []) : [];
    const fluke = /<g clip-path="url\(#ID-f\)">(.*?)<\/g>(<path fill="url\(#ID-b\)"[^>]*>)/s.exec(art[name].svg);
    lids.push(lid ? sampled(lid.attrs.d, 8).map(square) : null);
    out[name] = {
      body: flat(bodies[pose]),
      belly: flat(bellies[pose]),
      soft: flat(sampled(soft.attrs.d, 6)),
      smile: flat(sampled(smile.attrs.d, 6)),
      eye: eye ? flat(sampled(eye.attrs.d, 3).slice(0, -1)) : [],
      star: stars.length ? pairs(numbers(stars[0])).flatMap(square) : [],
      dot: dot ? [...square([+dot.attrs.cx, +dot.attrs.cy]), +dot.attrs.r * k] : [0, 0, 0],
      gb: run('b'),
      gw: run('w'),
      gs: run('s'),
      softW: 10.5 * k,
      smileW: 8 * k,
      eyeW: lid ? +lid.attrs['stroke-width'] * k : 0,
      starO: stars.length ? 1 : 0,
      k,
      tx: -vx,
      ty: -vy,
      props:
        drawn[pose]
          .filter((part) => (part.tag === 'circle' && part.attrs.fill === 'url(#ID-b)') || part.attrs.stroke === 'url(#ID-b)')
          .map((part) => part.src)
          .join('') + (stars.length > 1 ? `<path fill="url(#ID-s)" d="${stars.slice(1).join('')}"/>` : ''),
      fluke: fluke ? { line: fluke[1], fill: fluke[2] } : undefined,
    };
  });

  const first = out[names[0]];
  names.forEach((name, pose) => {
    const data = out[name];
    const lid = lids[pose];
    // A closed eye is the open one pressed flat onto the eyelid, so an eye closes as it moves: the open eye is carried
    // onto this head, by how the smile moved, and each of its points goes as far along the lid as it is across the eye.
    if (!data.eye.length && lid) {
      const fine: Point[] = [];
      for (let i = 0; i + 1 < lid.length; i++) {
        for (let k = 0; k < 8; k++) fine.push([lid[i][0] + ((lid[i + 1][0] - lid[i][0]) * k) / 8, lid[i][1] + ((lid[i + 1][1] - lid[i][1]) * k) / 8]);
      }
      fine.push(lid[lid.length - 1]);
      const start = fine[0];
      const end = fine[fine.length - 1];
      const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
      const across = pairs(first.eye)
        .map(fitted(pairs(first.smile), pairs(data.smile)))
        .map((p) => (p[0] * (end[0] - start[0]) + p[1] * (end[1] - start[1])) / length);
      const low = Math.min(...across);
      const high = Math.max(...across);
      data.eye = across.flatMap((v) => fine[Math.round(((v - low) / (high - low)) * (fine.length - 1))]);
      const middle = fine[Math.floor(fine.length / 2)];
      data.dot = [middle[0], middle[1], 0];
    }
    // a pose with no star keeps the first one's, unseen
    if (!data.star.length) {
      data.star = first.star;
      data.gs = first.gs;
    }
  });
  return out;
}

// ---------- moving ----------

interface Edges {
  len: Float64Array;
  ang: Float64Array;
  cx: number;
  cy: number;
}

/** An outline as its edges: how long each is and which way it points, and where its middle is. */
function edges(p: number[]): Edges {
  const n = p.length / 2;
  const len = new Float64Array(n);
  const ang = new Float64Array(n);
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = p[2 * j] - p[2 * i];
    const dy = p[2 * j + 1] - p[2 * i + 1];
    len[i] = Math.hypot(dx, dy);
    ang[i] = Math.atan2(dy, dx);
    cx += p[2 * i] / n;
    cy += p[2 * i + 1] / n;
  }
  return { len, ang, cx, cy };
}

interface Bend {
  a: Edges;
  b: Edges;
  /** how far each edge turns */
  by: Float64Array;
  n: number;
}

function bend(from: number[], to: number[]): Bend {
  const a = edges(from);
  const b = edges(to);
  const n = a.len.length;
  let sin = 0;
  let cos = 0;
  for (let i = 0; i < n; i++) {
    const weight = a.len[i] + b.len[i];
    sin += weight * Math.sin(b.ang[i] - a.ang[i]);
    cos += weight * Math.cos(b.ang[i] - a.ang[i]);
  }
  // each edge takes the short way round, measured from the turn of the body as a whole
  const whole = Math.atan2(sin, cos);
  const by = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const rest = b.ang[i] - a.ang[i] - whole;
    by[i] = whole + rest - 2 * Math.PI * Math.round(rest / (2 * Math.PI));
  }
  return { a, b, by, n };
}

/** The outline a share e of the way through a bend. */
function bent(T: Bend, e: number): number[] {
  const n = T.n;
  const out = new Array<number>(2 * n);
  let x = 0;
  let y = 0;
  for (let i = 0; i < n; i++) {
    out[2 * i] = x;
    out[2 * i + 1] = y;
    const length = T.a.len[i] + (T.b.len[i] - T.a.len[i]) * e;
    const angle = T.a.ang[i] + T.by[i] * e;
    x += length * Math.cos(angle);
    y += length * Math.sin(angle);
  }
  // the outline has to close: what's left over is shared out along it
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    out[2 * i] -= (x * i) / n;
    out[2 * i + 1] -= (y * i) / n;
    cx += out[2 * i] / n;
    cy += out[2 * i + 1] / n;
  }
  const mx = T.a.cx + (T.b.cx - T.a.cx) * e - cx;
  const my = T.a.cy + (T.b.cy - T.a.cy) * e - cy;
  for (let i = 0; i < n; i++) {
    out[2 * i] += mx;
    out[2 * i + 1] += my;
  }
  return out;
}

/** How many stretches of outline a point rides. */
const NEAR = 10;

/** The stretches of an outline nearest to each point, and how much each counts. */
function nearest(points: number[], outline: number[]): Pick<Hold, 'idx' | 'w' | 'm'> {
  const n = outline.length / 2;
  const m = points.length / 2;
  const idx = new Int32Array(m * NEAR);
  const w = new Float64Array(m * NEAR);
  const far = new Float64Array(n);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let k = 0; k < m; k++) {
    for (let i = 0; i < n; i++) far[i] = (outline[2 * i] - points[2 * k]) ** 2 + (outline[2 * i + 1] - points[2 * k + 1]) ** 2;
    order.sort((a, b) => far[a] - far[b]);
    let sum = 0;
    for (let q = 0; q < NEAR; q++) {
      idx[k * NEAR + q] = order[q];
      w[k * NEAR + q] = 1 / (far[order[q]] + 4) ** 2;
      sum += w[k * NEAR + q];
    }
    for (let q = 0; q < NEAR; q++) w[k * NEAR + q] /= sum;
  }
  return { idx, w, m };
}

const lerp = (a: number, b: number, e: number) => a + (b - a) * e;
const lerpList = (a: number[], b: number[], e: number) => a.map((v, i) => v + (b[i] - v) * e);

function step(x: number, from: number, to: number) {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

function path(p: number[], closed: boolean) {
  let d = `M${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
  for (let i = 2; i < p.length; i += 2) d += `L${p[i].toFixed(1)} ${p[i + 1].toFixed(1)}`;
  return closed ? d + 'Z' : d;
}

export interface Morph {
  /** Shows a pose. With a time, in milliseconds, the dolphin moves into it from wherever it is, even mid-move. */
  show(pose: string, ms?: number): void;
}

/** Draws the logo into an empty `svg` as one drawing that can move between the poses given, and shows `pose`.
 *  The first pose given is the measure for the others, and should be the one with the body stretched out. */
export function makeMorph(svg: SVGSVGElement, art: Record<string, Art>, id: string, pose: string): Morph {
  const data = read(art);
  const names = Object.keys(data);
  const first = data[names[0]];
  const asleep = names.find((name) => data[name].fluke);

  // a pose's own run of colour, for the parts kept as drawn, in that drawing's own measures
  const own = (name: string, g: number[]) => [g[0] / data[name].k - data[name].tx, g[1] / data[name].k - data[name].ty, g[2] / data[name].k - data[name].tx, g[3] / data[name].k - data[name].ty];
  const run = (name: string, stops: string, ends?: number[]) =>
    `<linearGradient id="${id}-${name}" gradientUnits="userSpaceOnUse"${ends ? ` x1="${ends[0]}" y1="${ends[1]}" x2="${ends[2]}" y2="${ends[3]}"` : ''}>${stops}</linearGradient>`;
  const B = '<stop class="mk-b1"/><stop offset=".5" class="mk-b2"/><stop offset="1" class="mk-b3"/>';
  const W = '<stop class="mk-w1"/><stop offset="1" class="mk-w2"/>';
  const S = '<stop class="mk-s1"/><stop offset=".5" class="mk-s2"/><stop offset="1" class="mk-s3"/>';
  const placed = (name: string, inner: string) =>
    `<g transform="scale(${data[name].k}) translate(${data[name].tx} ${data[name].ty})">${inner.replaceAll('ID-b', `${id}-b-${name}`).replaceAll('ID-s', `${id}-s-${name}`)}</g>`;
  svg.setAttribute('viewBox', '0 0 1000 1000');
  svg.innerHTML =
    `<defs>${run('b', B)}${run('w', W)}${run('s', S)}` +
    names.map((name) => run(`b-${name}`, B, own(name, data[name].gb)) + run(`s-${name}`, S, own(name, data[name].gs))).join('') +
    `<clipPath id="${id}-clip"><use href="#${id}-body"/></clipPath></defs>` +
    `<path id="${id}-body" fill="url(#${id}-b)"/><path data-part="belly" fill="url(#${id}-w)"/><path data-part="soft" class="mk-line mk-soft"/>` +
    (asleep
      ? `<g data-part="fluke-line" clip-path="url(#${id}-clip)"><g data-part="fluke-ride">${placed(asleep, data[asleep].fluke!.line)}</g></g>` +
        `<g data-part="fluke-fill">${placed(asleep, data[asleep].fluke!.fill)}</g>`
      : '') +
    `<path data-part="smile" class="mk-line"/><path data-part="eye" class="mk-eye mk-eye-line"/><circle data-part="dot" fill="#fff"/>` +
    `<path data-part="star" fill="url(#${id}-s)"/>` +
    names.map((name) => `<g data-part="props-${name}">${placed(name, data[name].props)}</g>`).join('');
  const el: Record<string, SVGElement> = { body: svg.querySelector<SVGElement>(`#${CSS.escape(id)}-body`)! };
  for (const part of svg.querySelectorAll<SVGElement>('[data-part]')) el[part.dataset.part!] = part;
  const runs = { gb: svg.querySelector(`#${CSS.escape(id)}-b`)!, gw: svg.querySelector(`#${CSS.escape(id)}-w`)!, gs: svg.querySelector(`#${CSS.escape(id)}-s`)! };

  // Asleep, the tail's fluke lies over the belly as a drawing of its own. It rides the stretch of outline around it,
  // so it travels with the tail as the body curls up or uncurls.
  const around: number[] = [];
  if (asleep) {
    const p = data[asleep];
    const box = pairs(numbers(p.fluke!.fill.replace(/^.*?\sd="/, ''))).map((q): Point => [(q[0] + p.tx) * p.k, (q[1] + p.ty) * p.k]);
    const x0 = Math.min(...box.map((q) => q[0])) - 25;
    const x1 = Math.max(...box.map((q) => q[0])) + 25;
    const y0 = Math.min(...box.map((q) => q[1])) - 25;
    const y1 = Math.max(...box.map((q) => q[1])) + 25;
    for (let i = 0; i < p.body.length / 2; i++) if (p.body[2 * i] > x0 && p.body[2 * i] < x1 && p.body[2 * i + 1] > y0 && p.body[2 * i + 1] < y1) around.push(i);
  }
  function flukeAt(body: number[]) {
    const home = data[asleep!].body;
    const fit = fitted(
      around.map((i): Point => [home[2 * i], home[2 * i + 1]]),
      around.map((i): Point => [body[2 * i], body[2 * i + 1]]),
    );
    const o = fit([0, 0]);
    const x = fit([1, 0]);
    const y = fit([0, 1]);
    return `matrix(${[x[0] - o[0], x[1] - o[1], y[0] - o[0], y[1] - o[1], o[0], o[1]].map((v) => v.toFixed(4)).join(' ')})`;
  }

  // what a pose looks like
  const looks: Record<string, Look> = {};
  function look(name: string): Look {
    const p = data[name];
    return (looks[name] ??= {
      body: p.body,
      belly: p.belly,
      soft: p.soft,
      smile: p.smile,
      eye: p.eye,
      star: p.star,
      dot: p.dot,
      gb: p.gb,
      gw: p.gw,
      gs: p.gs,
      softW: p.softW,
      smileW: p.smileW,
      eyeW: p.eyeW,
      starO: p.starO,
      props: Object.fromEntries(names.map((other) => [other, other === name ? 1 : 0])),
    });
  }

  // Which stretches of body a point rides is settled once, in the first pose, where the body is stretched out: curled
  // up asleep, the tail lies beside the head, and the eye must not ride the tail.
  const held = (from: { dot: number[] } & Record<Exclude<Held, 'dotAt'>, number[]>, key: Held) => (key === 'dotAt' ? [from.dot[0], from.dot[1]] : from[key]);
  let ties: Record<Held, Pick<Hold, 'idx' | 'w' | 'm'>> | null = null;
  function holds(s: Look): Record<Held, Hold> {
    if (s.holds) return s.holds;
    ties ??= Object.fromEntries(HELD.map((key) => [key, nearest(held(first, key), first.body)])) as Record<Held, Pick<Hold, 'idx' | 'w' | 'm'>>;
    const out = {} as Record<Held, Hold>;
    for (const key of HELD) {
      const tie = ties[key];
      const points = held(s, key);
      const ox = new Float64Array(tie.m * NEAR);
      const oy = new Float64Array(tie.m * NEAR);
      for (let q = 0; q < tie.m * NEAR; q++) {
        const p = Math.floor(q / NEAR);
        ox[q] = points[2 * p] - s.body[2 * tie.idx[q]];
        oy[q] = points[2 * p + 1] - s.body[2 * tie.idx[q] + 1];
      }
      out[key] = { ...tie, ox, oy };
    }
    return (s.holds = out);
  }

  interface Turn {
    bend: Bend;
    /** how much the outline turns and stretches around each of its points, evened out over its neighbours */
    rot: Float64Array;
    grow: Float64Array;
    ha: Record<Held, Hold>;
    hb: Record<Held, Hold>;
  }
  function turn(a: Look, b: Look): Turn {
    const T = bend(a.body, b.body);
    const rot = new Float64Array(T.n);
    const grow = new Float64Array(T.n);
    for (let i = 0; i < T.n; i++) {
      let turned = 0;
      let la = 0;
      let lb = 0;
      for (let d = -4; d <= 3; d++) {
        const j = (i + d + T.n) % T.n;
        turned += (T.a.len[j] + T.b.len[j]) * T.by[j];
        la += T.a.len[j];
        lb += T.b.len[j];
      }
      rot[i] = turned / (la + lb);
      grow[i] = lb / la;
    }
    return { bend: T, rot, grow, ha: holds(a), hb: holds(b) };
  }

  /** The look a share e of the way from one to another. */
  function mix(a: Look, b: Look, e: number, T: Turn): Look {
    const body = bent(T.bend, e);
    const n = T.bend.n;
    // each point's turn and size now, seen from where it started and from where it will end
    const ac = new Float64Array(n);
    const as = new Float64Array(n);
    const bc = new Float64Array(n);
    const bs = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const size = 1 + (T.grow[i] - 1) * e;
      ac[i] = size * Math.cos(T.rot[i] * e);
      as[i] = size * Math.sin(T.rot[i] * e);
      bc[i] = (size / T.grow[i]) * Math.cos(T.rot[i] * (e - 1));
      bs[i] = (size / T.grow[i]) * Math.sin(T.rot[i] * (e - 1));
    }
    function ride(H: Hold, cos: Float64Array, sin: Float64Array, out: number[], share: number) {
      for (let p = 0; p < H.m; p++) {
        let x = 0;
        let y = 0;
        for (let q = p * NEAR; q < (p + 1) * NEAR; q++) {
          const v = H.idx[q];
          x += H.w[q] * (body[2 * v] + H.ox[q] * cos[v] - H.oy[q] * sin[v]);
          y += H.w[q] * (body[2 * v + 1] + H.ox[q] * sin[v] + H.oy[q] * cos[v]);
        }
        out[2 * p] += share * x;
        out[2 * p + 1] += share * y;
      }
    }
    // a point rides the body from where it was and from where it will be, more of the second as the move goes on
    function carried(key: Held) {
      const out = new Array<number>(2 * T.ha[key].m).fill(0);
      ride(T.ha[key], ac, as, out, 1 - e);
      ride(T.hb[key], bc, bs, out, e);
      return out;
    }
    const dot = carried('dotAt');
    return {
      body,
      belly: carried('belly'),
      soft: carried('soft'),
      smile: carried('smile'),
      eye: carried('eye'),
      star: lerpList(a.star, b.star, e),
      dot: [dot[0], dot[1], lerp(a.dot[2], b.dot[2], e)],
      gb: lerpList(a.gb, b.gb, e),
      gw: lerpList(a.gw, b.gw, e),
      gs: lerpList(a.gs, b.gs, e),
      softW: lerp(a.softW, b.softW, e),
      smileW: lerp(a.smileW, b.smileW, e),
      eyeW: lerp(a.eyeW, b.eyeW, e),
      starO: lerp(a.starO, b.starO, e),
      // what only one pose has: the old is gone before the body is half way, and the new comes at the end, the fluke
      // last of all, once the tail is nearly under it
      props: Object.fromEntries(
        names.map((name) => [name, b.props[name] >= a.props[name] ? lerp(a.props[name], b.props[name], step(e, name === asleep ? 0.7 : 0.55, 1)) : lerp(a.props[name], b.props[name], step(e, 0, 0.4))]),
      ),
    };
  }

  function paint(s: Look) {
    const set = (part: string, name: string, value: string) => el[part].setAttribute(name, value);
    set('body', 'd', path(s.body, true));
    set('belly', 'd', path(s.belly, true));
    set('soft', 'd', path(s.soft, false));
    set('soft', 'stroke-width', s.softW.toFixed(2));
    set('smile', 'd', path(s.smile, false));
    set('smile', 'stroke-width', s.smileW.toFixed(2));
    set('eye', 'd', path(s.eye, true));
    set('eye', 'stroke-width', s.eyeW.toFixed(2));
    set('dot', 'cx', s.dot[0].toFixed(1));
    set('dot', 'cy', s.dot[1].toFixed(1));
    set('dot', 'r', Math.max(0, s.dot[2]).toFixed(2));
    const t = s.star.map((v) => v.toFixed(1));
    set('star', 'd', `M${t[0]} ${t[1]}Q${t.slice(2, 6).join(' ')}Q${t.slice(6, 10).join(' ')}Q${t.slice(10, 14).join(' ')}Q${t.slice(14, 18).join(' ')}Z`);
    set('star', 'opacity', s.starO.toFixed(3));
    for (const key of ['gb', 'gw', 'gs'] as const) {
      ['x1', 'y1', 'x2', 'y2'].forEach((name, i) => runs[key].setAttribute(name, s[key][i].toFixed(1)));
    }
    for (const name of names) set(`props-${name}`, 'opacity', s.props[name].toFixed(3));
    if (asleep) {
      set('fluke-line', 'opacity', s.props[asleep].toFixed(3));
      set('fluke-fill', 'opacity', s.props[asleep].toFixed(3));
      if (s.props[asleep] > 0.001) {
        const where = flukeAt(s.body);
        set('fluke-ride', 'transform', where);
        set('fluke-fill', 'transform', where);
      }
    }
  }

  let now = look(pose);
  let moves = 0;
  paint(now);
  return {
    show(name, ms = 0) {
      const to = look(name);
      const mine = ++moves;
      if (!ms) {
        paint((now = to));
        return;
      }
      const from = now;
      const T = turn(from, to);
      let start = 0;
      const frame = (time: number) => {
        if (mine !== moves) return;
        start ||= time;
        const t = Math.min(1, (time - start) / ms);
        // slow away, slow home
        paint((now = t < 1 ? mix(from, to, t * t * t * (t * (6 * t - 15) + 10), T) : to));
        if (t < 1) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      // a page that isn't being drawn gets no frames: the pose still lands
      setTimeout(() => {
        if (mine !== moves || now === to) return;
        moves++;
        paint((now = to));
      }, ms + 400);
    },
  };
}

// ---------- the logo in Settings ----------

/** How long the dolphin takes to move into a pose, and to fade out before it shows one under calm motion. */
const MOVE_MS = 760;
const FADE_MS = 150;

let morph: Promise<Morph> | null = null;
/** the pose asked for, and the pose on screen */
let wanted: PoseName | null = null;
let onScreen: PoseName | null = null;
let fading = 0;

async function poseArt(): Promise<Record<string, Art>> {
  const { POSE_ART } = await import('../lib/mark-poses');
  return Object.fromEntries(POSES.map((pose) => [pose, pose === 'leap' ? MARK : POSE_ART[pose].whole]));
}

/** The drawing that can move, made once, showing what is on screen at that moment. */
function moving(svg: SVGSVGElement) {
  return (morph ??= poseArt().then((art) => makeMorph(svg, art, 'set', onScreen ?? 'leap')));
}

/** Shows the logo in Settings in a pose: at once, moving into it, or, under calm motion, fading to it.
 *  The first time, it is drawn as the pose is, which costs nothing, and the drawing that can move is made a little
 *  later, when the browser has nothing to do, so opening Settings never waits for it. */
export async function showSettingsLogo(svg: SVGSVGElement, pose: PoseName, how: 'at-once' | 'move' | 'fade') {
  if (pose === wanted) return;
  const firstTime = wanted === null;
  wanted = pose;
  clearTimeout(fading);
  if (firstTime) {
    try {
      const art = pose === 'leap' ? MARK : (await poseArt())[pose];
      if (wanted !== pose) return;
      svg.setAttribute('viewBox', art.viewBox);
      svg.innerHTML = art.svg.replaceAll('ID-', 'set-');
    } catch {
      // the other poses couldn't be fetched: Settings shows no logo, and its choices still work
      wanted = null;
      return;
    }
    onScreen = pose;
    svg.dataset.pose = pose;
    const later = window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 400));
    later(() => void moving(svg).catch(() => (morph = null)));
    return;
  }
  let made: Morph;
  try {
    made = await moving(svg);
  } catch {
    morph = null;
    wanted = onScreen;
    return;
  }
  if (wanted !== pose) return;
  svg.dataset.pose = pose;
  svg.classList.remove('is-out');
  if (how === 'move') {
    onScreen = pose;
    made.show(pose, MOVE_MS);
  } else if (how === 'fade') {
    svg.classList.add('is-out');
    fading = window.setTimeout(() => {
      onScreen = pose;
      made.show(pose);
      svg.classList.remove('is-out');
    }, FADE_MS);
  } else {
    onScreen = pose;
    made.show(pose);
  }
}
