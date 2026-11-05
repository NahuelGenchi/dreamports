// Keeps the rows from flickering as they glide (docs/LABELS.md). A row moving smoothly spends most of its time
// between two screen pixels, where the screen blends each pixel with its neighbour, so a detail one pixel wide, like
// a dark outline against the sky, keeps going sharp and soft. So do a hard upright edge, like the line where one place
// meets the next, and dots, like the band where one colour of the sky fades into the next. Those get a little of their
// neighbours: the strongest details, long upright edges, which the eye follows, dots, and always the line where two
// places meet, about one pixel in four in all. Everything else stays crisp. Screens of twice the density or more don't
// need it: each pixel of a picture is two or more of theirs.

// how strong a pixel's contrast with both its neighbours may be before it softens, in steps of brightness out of 255
const LIMIT = 30;
// how fast it softens past that, and how far at most
const RATE = 0.005;
const MOST = 0.2;
// a long upright edge: the contrast it keeps over this many pixels above and below softens sooner, and further
const REACH = 3;
const LONG_LIMIT = 8;
const LONG_RATE = 0.01;
const LONG_MOST = 0.25;
// dots soften sooner too, but keep some of their pattern
const DOTS_LIMIT = 8;
const DOTS_RATE = 0.01;
const DOTS_MOST = 0.15;
// where two places meet, the edge always softens this far
const SEAM = 0.25;

/**
 * A row's picture, or a single place's, with its flickering details softened. The picture is read round, as the rows
 * are shown: its last column meets its first where the repeat begins.
 * @param {Uint8ClampedArray} pixels RGBA, a line at a time
 * @param {number} width
 * @param {number[]} [seams] the columns where a place starts, so it and the column before it soften
 * @returns {Uint8ClampedArray}
 */
export function steady(pixels, width, seams = []) {
  const height = pixels.length / 4 / width;
  const size = width * height;
  // brightness as it shows over a light page, so a clear part of a label counts as the page behind it
  const light = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const a = pixels[i * 4 + 3] / 255;
    light[i] = a * (0.2126 * pixels[i * 4] + 0.7152 * pixels[i * 4 + 1] + 0.0722 * pixels[i * 4 + 2]) + (1 - a) * 255;
  }
  // the rows only move sideways, so only contrast with the pixels either side flickers
  const side = new Float32Array(size);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      side[i] = (light[y * width + ((x + width - 1) % width)] - 2 * light[i] + light[y * width + ((x + 1) % width)]) / 4;
    }
  const meet = new Set(seams.flatMap((x) => [x % width, (x + width - 1) % width]));
  const out = new Uint8ClampedArray(pixels);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const sharp = Math.abs(side[i]);
      let a = sharp > LIMIT ? Math.min(MOST, (sharp - LIMIT) * RATE) : 0;
      // how much of the same contrast runs up and down from here
      let run = 0;
      for (let dy = -REACH; dy <= REACH; dy++) {
        const yy = Math.min(height - 1, Math.max(0, y + dy));
        run += Math.max(0, side[yy * width + x] * Math.sign(side[i]));
      }
      run /= 2 * REACH + 1;
      if (run > LONG_LIMIT) a = Math.max(a, Math.min(LONG_MOST, (run - LONG_LIMIT) * LONG_RATE));
      const l = y * width + ((x + width - 1) % width);
      const r = y * width + ((x + 1) % width);
      // dots, where this pixel stands out one way and both its neighbours the other, as where one colour of the sky
      // fades into the next: a moving row smooths them flat and back, so the band pulses
      if (side[l] * side[i] < 0 && side[r] * side[i] < 0) {
        const dots = Math.min(sharp, Math.abs(side[l]), Math.abs(side[r]));
        if (dots > DOTS_LIMIT) a = Math.max(a, Math.min(DOTS_MOST, (dots - DOTS_LIMIT) * DOTS_RATE));
      }
      if (meet.has(x)) a = Math.max(a, SEAM);
      if (!a) continue;
      // blended by how much of each pixel there is, so a clear pixel never darkens its neighbour
      const wl = a * pixels[l * 4 + 3];
      const wi = (1 - 2 * a) * pixels[i * 4 + 3];
      const wr = a * pixels[r * 4 + 3];
      const cover = wl + wi + wr;
      out[i * 4 + 3] = Math.round(cover);
      if (cover) for (let k = 0; k < 3; k++) out[i * 4 + k] = Math.round((wl * pixels[l * 4 + k] + wi * pixels[i * 4 + k] + wr * pixels[r * 4 + k]) / cover);
    }
  return out;
}
