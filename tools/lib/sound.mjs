// What prove counts as the same sound (tools/README.md#how-sound-is-compared). Both play the console's own mix,
// every 256 cycles, in its 10-bit units: the original as mGBA mixes it (gba/original.c), the Dreamport as the kit's
// sound engine does on the page (kit/gba/proof.js). They never match sample for sample, even when the game is
// right: the console makes each frame's sound at its own moment in the frame, where the game's sound library runs,
// and the kit at the frame's start, so the two are a fraction of a frame apart, and the parts of a sound by
// different fractions.
//
// So a frame's sound is compared by how loud it is in each of eight bands of pitches, an octave wide, from 125 Hz
// to 16 kHz, on each side, measured over the frame with the one before and the one after. It's the same when every
// band is within TOLERANCE dB of the original's, a band quieter than one of the console's 10-bit steps counting as
// silent; when one is silent in every band and the other isn't, it differs. The original's sound is taken from as
// far as a frame before or after, wherever it's closest.

/** How far apart two bands' loudness may be, in dB, for a frame's sound to be the same: 10 dB is what listeners
 *  hear as twice or half as loud. Sonic Advance Dreamport's frames are at most 6.8 dB from the original's. */
export const TOLERANCE = 10;
/** The bands' middle pitches, in Hz. */
export const BANDS = [125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const FRAME = 280896 / 256;   // 1097.25 samples a frame
/** How far the original's sound is looked for, before or after the frame's, in samples: a frame. */
export const REACH = Math.round(FRAME);
const STEP = 16;              // the steps it's looked for in
const WIDE = 1;               // the frames either side a frame's sound is measured with
/** How many frames either side of a frame its sound reaches into, measured with its neighbours and looked for a
 *  frame away: the sound of frames this close to a stretch only the original has isn't compared. */
export const NEAR = WIDE + 1;

/**
 * Makes a filter for each band and side, which runs on through a whole recording's sound, frame after frame. It's
 * one function with nothing from outside it, so prove runs the same code in the Dreamport's page (in-page.js).
 * `filter(samples, energies, each)` takes a frame's samples (left and right, interleaved) and adds each band's energy
 * in them to `energies`: 16 numbers, the left side's bands, then the right's. With `each`, it also writes each
 * sample's energy in each band there, band k's at each[k * n + i] for the frame's sample i of n.
 */
export function makeFilter() {
  const rate = 65536, centres = [125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  // a band-pass of an octave around each band's middle (Robert Bristow-Johnson's, peak gain 1)
  const filters = centres.map(centre => {
    const w = 2 * Math.PI * centre / rate, alpha = Math.sin(w) / (2 * Math.SQRT2), a0 = 1 + alpha;
    return [alpha / a0, -alpha / a0, -2 * Math.cos(w) / a0, (1 - alpha) / a0];
  });
  const state = new Float64Array(centres.length * 2 * 4);
  return (samples, energies, each) => {
    const n = samples.length / 2;
    for (let side = 0; side < 2; side++) {
      for (let band = 0; band < centres.length; band++) {
        const [b0, b2, a1, a2] = filters[band], k = side * centres.length + band, at = k * 4;
        let x1 = state[at], x2 = state[at + 1], y1 = state[at + 2], y2 = state[at + 3], sum = 0;
        for (let i = 0; i < n; i++) {
          const x = samples[i * 2 + side], y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
          x2 = x1; x1 = x; y2 = y1; y1 = y;
          sum += y * y;
          if (each) each[k * n + i] = y * y;
        }
        state[at] = x1; state[at + 1] = x2; state[at + 2] = y1; state[at + 3] = y2;
        energies[k] += sum;
      }
    }
  };
}

const KEYS = BANDS.length * 2;
// how far apart two levels are, in dB, a level under one step counting as one step
const apart = (a, b) => Math.abs(20 * Math.log10(Math.max(a, 1) / Math.max(b, 1)));

/**
 * Gets the original's sound ready to compare the Dreamport's with, frame by frame. `original` is the original's
 * sound, frame by frame from power-on, each an Int16Array as runOriginal gives it. Returns `compare(dreamport,
 * originalOf, f)`, which compares the Dreamport's frame `f`: `dreamport` holds its frames so far, each { energies,
 * samples }, each band's energy in it (from makeFilter) and how many samples it had, and `originalOf` the original's
 * frame each of them is compared with. It needs the frame after `f` too, unless `f` is the last. It returns null when
 * the frame's sound is the same, or else how it differs where the original's is closest: { side, band, original,
 * dreamport, dB }, the band furthest apart, with how loud each one is there, in the console's 10-bit steps, and
 * `silent`, 'dreamport' or 'original', when that one is silent and the other isn't.
 */
export function soundOf(original) {
  // the original's energy in each band, gathered over its whole sound a block of STEP samples at a time
  const filter = makeFilter(), starts = [];
  let total = 0;
  for (const samples of original) { starts.push(total); total += samples.length / 2; }
  starts.push(total);
  const blocks = Math.ceil(total / STEP) + 1, gathered = new Float64Array(KEYS * blocks);
  original.forEach((samples, g) => {
    const n = samples.length / 2, each = new Float64Array(KEYS * n);
    filter(samples, new Float64Array(KEYS), each);
    for (let k = 0; k < KEYS; k++) {
      for (let i = 0; i < n; i++) gathered[k * blocks + Math.floor((starts[g] + i) / STEP) + 1] += each[k * n + i];
    }
  });
  for (let k = 0; k < KEYS; k++) for (let b = 1; b < blocks; b++) gathered[k * blocks + b] += gathered[k * blocks + b - 1];

  return (dreamport, originalOf, f) => {
    // the frame with the one before and the one after, so a sound's quick changes weigh less than what goes on
    const first = Math.max(0, f - WIDE), last = Math.min(dreamport.length - 1, f + WIDE);
    let n = 0;
    const energies = new Float64Array(KEYS);
    for (let h = first; h <= last; h++) {
      n += dreamport[h].samples;
      for (let k = 0; k < KEYS; k++) energies[k] += dreamport[h].energies[k];
    }
    const ours = Array.from(energies, e => Math.sqrt(e / Math.max(1, n))), oursSilent = ours.every(level => level < 1);
    let best = null;
    for (let shift = -REACH; shift <= REACH; shift += STEP) {
      const from = Math.round((starts[originalOf[first]] + shift) / STEP), to = from + Math.round(n / STEP);
      if (from < 0 || to >= blocks) continue;
      const theirs = Array.from({ length: KEYS }, (_, k) => Math.sqrt(Math.max(0, gathered[k * blocks + to] - gathered[k * blocks + from]) / ((to - from) * STEP)));
      const theirsSilent = theirs.every(level => level < 1);
      if (oursSilent && theirsSilent) return null;
      let worst = null;
      for (let k = 0; k < KEYS; k++) {
        const dB = apart(theirs[k], ours[k]);
        if (!worst || dB > worst.dB) worst = { side: k < BANDS.length ? 'left' : 'right', band: BANDS[k % BANDS.length], original: theirs[k], dreamport: ours[k], dB };
      }
      // one silent and the other not always differs; otherwise every band close enough is the same
      const silent = oursSilent ? 'dreamport' : theirsSilent ? 'original' : null;
      if (!silent && worst.dB <= TOLERANCE) return null;
      const score = (silent ? 1000 : 0) + worst.dB;
      if (!best || score < best.score) best = { ...worst, silent, score };
    }
    return best && {
      side: best.side, band: best.band, original: Math.round(best.original * 10) / 10, dreamport: Math.round(best.dreamport * 10) / 10,
      dB: Math.round(best.dB * 10) / 10, ...(best.silent ? { silent: best.silent } : {}),
    };
  };
}
