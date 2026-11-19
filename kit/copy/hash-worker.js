// The SHA-1 of a player's disc, on a thread of its own so the page and the game go on (page.js): the disc's bytes as
// the image it was made from holds them (disc.js), read a few megabytes at a time, never whole.

import { openDisc } from './disc.js';
import { blobSource } from './source.js';
import { Sha1 } from './sha1.js';

addEventListener('message', async ({ data: { files } }) => {
  try {
    const [first, ...others] = files;
    const disc = await openDisc(blobSource(first), { open: async name => {
      const found = others.find(other => other.name === name || other.name.toLowerCase() === name.toLowerCase());
      return found ? blobSource(found) : null;
    } });
    const total = disc.kind === 'cd' ? disc.sectors * 2352 : disc.sectors * 2048, hash = new Sha1();
    let done = 0, told = 0;
    for await (const { bytes } of disc.image()) {
      hash.update(bytes);
      done += bytes.length;
      if (done - told > total / 100) {
        told = done;
        postMessage({ progress: Math.min(1, done / total) });
      }
    }
    postMessage({ sha1: hash.hex() });
  } catch (error) {
    postMessage({ error: error.message });
  }
});
