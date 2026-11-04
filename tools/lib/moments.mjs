// Finds the best moments in what was played, for a game's card (tools/capture.mjs): lively, colourful stretches of play,
// from numbers each frame gives. A person chooses among them when one is there, and otherwise the first is taken, and
// it leaves out what never belongs on a card: logos, fades, menus, text and whatever plays with nobody playing.


/** How long a stretch of play is looked at, in frames. A moment is cut from it, so it's as long as one can be. */
export const WINDOW = 360;
const STEP = 30;                     // windows are tried this many frames apart
const SHORTEST = 150;                // a moment lasts at least this long
const AROUND = 300;                  // and is best at about this long
let PLAYING = 0x3F3;                 // the buttons that play, which leave out Start and Select
let WIDTH = 240;

/** Says which console's pictures and buttons these are, for one that isn't the Game Boy Advance. */
export function forConsole({ screen, keys }) {
  WIDTH = screen[0];
  if (keys) PLAYING = Object.entries(keys).reduce((mask, [name, bit]) => (name === 'START' || name === 'SELECT' ? mask : mask | bit), 0);
}
const PLAYED = 0.2;                  // the share of a window's frames some of them have to be held for
const STILL = 0.002, STILLS = 0.25;  // a frame this little of which changes, like the one before it, is still, and a window can hold this share of those
export const FEW_COLOURS = 8;

// colours seen in this frame, marked with the frame's stamp, so they needn't be cleared each time
const seen = new Uint32Array(32768);
let stamp = 0;

/**
 * What a picture is like, from its pixels in 15-bit colour and those of the frame before: { hash, colours, moved,
 * light, colourful }. `hash` is as the original's (tools/gba/original.c), `colours` how many it has, `moved` the share
 * of its pixels that changed, `light` how bright it is, from 0 to 31, and `colourful` how vivid, by Hasler and
 * Süsstrunk's measure, which goes by how far red and green, and yellow and blue, stand apart.
 */
export function measure(picture, previous) {
  stamp++;
  const PIXELS = picture.length;
  let hash = 0x811C9DC5, colours = 0, moved = 0, light = 0, rg = 0, yb = 0, rg2 = 0, yb2 = 0;
  for (let i = 0; i < PIXELS; i++) {
    const c = picture[i];
    hash = Math.imul(hash ^ c, 0x01000193);
    if (seen[c] !== stamp) {
      seen[c] = stamp;
      colours++;
    }
    if (previous && previous[i] !== c) moved++;
    const r = c & 31, g = c >> 5 & 31, b = c >> 10 & 31;
    const a = r - g, d = (r + g) / 2 - b;
    light += r * 0.3 + g * 0.6 + b * 0.1;
    rg += a; yb += d; rg2 += a * a; yb2 += d * d;
  }
  const meanRg = rg / PIXELS, meanYb = yb / PIXELS;
  const spread = Math.sqrt(rg2 / PIXELS - meanRg * meanRg + yb2 / PIXELS - meanYb * meanYb);
  return { hash: hash >>> 0, colours, moved: moved / PIXELS, light: light / PIXELS, colourful: spread + 0.3 * Math.hypot(meanRg, meanYb) };
}

const mean = (frames, key) => frames.reduce((sum, f) => sum + f[key], 0) / frames.length;

// how good a stretch looks, or 0 if it doesn't belong on a card
function worth(frames, buttons, from) {
  const stretch = frames.slice(from, from + WINDOW);
  let played = 0, stills = 0;
  stretch.forEach((f, i) => {
    if (buttons[from + i] & PLAYING) played++;
    // two in a row, as a game drawing every second frame repeats half of them however much is going on
    if (f.moved < STILL && stretch[i - 1]?.moved < STILL) stills++;
  });
  if (played < WINDOW * PLAYED || stills > WINDOW * STILLS) return 0;
  const colours = mean(stretch, 'colours'), light = mean(stretch, 'light'), moved = mean(stretch, 'moved');
  // a fade, a flash to one colour, or a cut from one screen to another, in a stretch that doesn't change that much otherwise
  const breaks = stretch.some((f, i) => f.colours < FEW_COLOURS || f.colours < colours * 0.3 || f.light < light * 0.5 || (i && f.moved > 0.95 && moved < 0.5));
  if (breaks) return 0;
  // the more of the screen moves the better, up to a point: past that it's a blur
  const lively = Math.min(1, moved / 0.05) * (moved > 0.8 ? 0.8 : 1);
  return mean(stretch, 'colourful') * Math.log2(1 + colours) * lively;
}

/**
 * The best stretches of what was played, the first frame of each, best first and none overlapping another: `frames`
 * holds what `measure` said of each frame and `buttons` the buttons held at it, as KEY bits.
 */
export function shortlist(frames, buttons, count = 6) {
  const scored = [];
  for (let from = 0; from + WINDOW <= frames.length; from += STEP) {
    const score = worth(frames, buttons, from);
    if (score) scored.push({ from, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const chosen = [];
  for (const { from } of scored) {
    if (chosen.length < count && chosen.every(other => Math.abs(other - from) >= WINDOW)) chosen.push(from);
  }
  return chosen;
}

/**
 * What each stretch of what was played is like, in numbers, to say where a list of presses led with no picture: at most
 * about forty stretches of { from, moved, colours, held }, with `held` the share of its frames buttons that play were held.
 */
export function stretches(frames, buttons) {
  const size = Math.max(300, Math.ceil(frames.length / 40));
  const out = [];
  for (let from = 0; from < frames.length; from += size) {
    const part = frames.slice(from, from + size);
    const held = buttons.slice(from, from + size).filter(mask => mask & PLAYING).length;
    out.push({ from, moved: mean(part, 'moved'), colours: mean(part, 'colours'), held: held / part.length });
  }
  return out;
}

// every third pixel, each way, which says enough to compare two pictures
const sample = picture => {
  const out = [];
  for (let y = 0; y < picture.length / WIDTH; y += 3) for (let x = 0; x < WIDTH; x += 3) out.push(picture[y * WIDTH + x]);
  return Uint16Array.from(out);
};

/**
 * Where to cut a moment out of the stretch starting at `from`, so that it loops smoothly: `pictureOf(frame)` gives each
 * frame's picture. Resolves to { from, to }, its first frame and the one past its last, which looks as near as can
 * be to its first.
 */
export function loopOf(pictureOf, from) {
  const samples = new Map();
  const of = frame => {
    if (!samples.has(frame)) samples.set(frame, sample(pictureOf(frame)));
    return samples.get(frame);
  };
  let best = null;
  for (let start = from; start < from + STEP; start++) {
    const first = of(start);
    for (let to = start + SHORTEST; to < from + WINDOW; to++) {
      const last = of(to);
      let differ = 0;
      for (let i = 0; i < first.length; i++) if (first[i] !== last[i]) differ++;
      const cost = differ / first.length + Math.abs(to - start - AROUND) / AROUND * 0.02;
      if (!best || cost < best.cost) best = { from: start, to, cost };
    }
  }
  return { from: best.from, to: best.to };
}
