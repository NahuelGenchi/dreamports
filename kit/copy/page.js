// The player's disc on a Dreamport's page: the File they chose or dropped, read a few sectors at a time (disc.js), so a
// disc of gigabytes never fills the page's memory. A .cue comes with the files it names, chosen or dropped with it.
// Which version of the game it is takes the SHA-1 of the whole disc, which takes seconds, so it's worked out on a thread
// of its own (hash-worker.js) after the game can start, and kept in this browser for that file, which never leaves it.

import { openDisc } from './disc.js';
import { whatDisc } from './iso9660.js';
import { blobSource } from './source.js';

/** Whether a file is too large to read whole on a page: past this, a copy is read in pieces. */
export const WHOLE = 256 * 1024 * 1024;

/**
 * Opens `file`, a disc in any of the files disc.js reads, with `others`, the other files chosen with it, which a .cue's
 * tracks are taken from by name. Resolves to { disc, what, files }: `what` is whatDisc's { console, title, code }, and
 * `files` every File it reads; or to null for a file that isn't a disc at all, such as a program for the console's
 * processor, which a page reads whole. Throws, with a sentence for the player, for a disc it can't read.
 */
export async function openCopy(file, others = []) {
  const files = [file];
  const named = name => {
    const found = others.find(other => other.name === name || other.name.toLowerCase() === name.toLowerCase());
    if (found) files.push(found);
    return found ? blobSource(found) : null;
  };
  let disc;
  try {
    disc = await openDisc(blobSource(file), { open: async name => named(name) });
  } catch (error) {
    throw new Error(`${file.name} can't be read: ${error.message}`);
  }
  if (!disc) {
    if (/\.cue$/i.test(file.name)) throw new Error(`${file.name} names files that weren't chosen with it: choose the .cue and its .bin files together.`);
    if (file.size > WHOLE) throw new Error(`${file.name} isn't a disc, and it's too large to be anything else.`);
    return null;
  }
  return { disc, what: await whatDisc(disc), files };
}

// the version found for a file, by its name, size and when it last changed, kept in this browser
const KEY = 'dreamports-copy-sha1';
const remembered = () => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; }
};
const idOf = files => files.map(f => `${f.name}|${f.size}|${f.lastModified ?? 0}`).join(';');

/**
 * The SHA-1 of the disc in `files` (openCopy's), as the image it was made from holds them, as rom.mjs works it out:
 * from what this browser kept for these files, or on a thread of its own, `progress(fraction)` told as it goes.
 */
export function sha1Of(files, progress = () => {}) {
  const id = idOf(files), kept = remembered()[id];
  if (kept) return Promise.resolve(kept);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./hash-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.progress !== undefined) return progress(data.progress);
      worker.terminate();
      if (data.error) return reject(new Error(data.error));
      try {
        const all = remembered();
        all[id] = data.sha1;
        localStorage.setItem(KEY, JSON.stringify(all));
      } catch { /* a browser that keeps nothing finds it again next time */ }
      resolve(data.sha1);
    };
    worker.onerror = event => { worker.terminate(); reject(new Error(event.message || 'The version couldn\'t be worked out.')); };
    worker.postMessage({ files });
  });
}
