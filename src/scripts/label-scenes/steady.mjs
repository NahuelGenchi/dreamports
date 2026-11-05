// Keeps the scenes from flickering as the rows glide (docs/LABELS.md). A row moving smoothly spends most of its time
// between two screen pixels, where the screen blends each pixel with its neighbour, so a detail one pixel wide, like
// a dark outline against the sky, keeps going sharp and soft. Only the strongest of those get a little of their
// neighbours, about one pixel in 25, so the rows glide without flickering and stay crisp everywhere else. Screens of
// twice the density or more don't need it: each pixel of a scene is two or more of theirs.

// how strong a pixel's contrast with both its neighbours may be before it softens, in steps of brightness out of 255
const LIMIT = 30;
// how fast it softens past that, and how far at most
const RATE = 0.005;
const MOST = 0.2;

/**
 * A scene, or any picture of the rows, with its flickering details softened.
 * @param {Uint8ClampedArray} pixels RGBA, a row at a time
 * @param {number} width
 * @returns {Uint8ClampedArray}
 */
export function steady(pixels, width) {
  const height = pixels.length / 4 / width;
  const light = new Float32Array(width * height);
  for (let i = 0; i < light.length; i++) light[i] = 0.2126 * pixels[i * 4] + 0.7152 * pixels[i * 4 + 1] + 0.0722 * pixels[i * 4 + 2];
  const out = new Uint8ClampedArray(pixels);
  for (let y = 0; y < height; y++)
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      // the rows only move sideways, so only contrast with the pixels either side flickers
      const sharp = Math.abs(light[i - 1] - 2 * light[i] + light[i + 1]) / 4;
      if (sharp <= LIMIT) continue;
      const a = Math.min(MOST, (sharp - LIMIT) * RATE);
      for (let k = 0; k < 3; k++) out[i * 4 + k] = Math.round(a * pixels[(i - 1) * 4 + k] + (1 - 2 * a) * pixels[i * 4 + k] + a * pixels[(i + 1) * 4 + k]);
    }
  return out;
}
