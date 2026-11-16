// What a Dreamport saves, next to what the original's cartridge holds (docs/STANDARD.md#saves): a save written wrong, or
// not at all, shows in no frame, so prove compares the two. The program that plays the original gives its save memory
// each time a frame changed it (gba/original.c, DP_SAVES), and the Dreamport's page what the game wrote (kit/gba/save.js).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sharedProofFolder } from './paths.mjs';

/** How many frames apart two changes of the save memory can be and still be one write: a flash takes a sector over
 *  some twenty frames. */
export const ONE_WRITE = 60;

/** The writes in a list of changes, each { frame, bytes }, in order: each run of changes no more than ONE_WRITE frames
 *  apart is one write, with the bytes the last of them left and its frame. */
export function writesIn(changes) {
  const writes = [];
  changes.forEach((change, i) => {
    if (i && change.frame - changes[i - 1].frame <= ONE_WRITE) writes[writes.length - 1] = change;
    else writes.push(change);
  });
  return writes;
}

/**
 * Compares the saves a recording wrote, in order: `original` and `own` are each side's changes. Returns
 * { original, dreamport, same, first }: how many writes each made, how many of the Dreamport's left the save memory
 * as the original's did, and the first that didn't, as { write, frame, at, original, dreamport }: which write, the original's frame,
 * the first byte that differs, or the first past the shorter one's end, and what each side holds there.
 */
export function compareSaves(original, own, leftover = []) {
  const left = at => leftover.some(([from, to]) => at >= from && at <= to);
  const theirs = writesIn(original), mine = writesIn(own);
  let same = 0, first = null;
  for (let i = 0; i < Math.max(theirs.length, mine.length); i++) {
    const a = theirs[i]?.bytes, b = mine[i]?.bytes;
    let at = -1;
    if (a && b) {
      const shared = Math.min(a.length, b.length);
      for (at = 0; at < shared && (a[at] === b[at] || left(at)); at++);
      if (at === shared && a.length === b.length) {
        same++;
        continue;
      }
    }
    first ??= { write: i + 1, frame: theirs[i]?.frame ?? null, at: at < 0 ? null : at, ...(at < 0 ? {} : { original: a[at] ?? null, dreamport: b[at] ?? null }) };
  }
  return { original: theirs.length, dreamport: mine.length, same, first };
}

/**
 * The bytes of a game's save memory that aren't its save: games/<game>/proof/saves.json's "leftover", each stretch as
 * [first byte, last byte, why], the bytes in hexadecimal. A cartridge's flash takes a whole sector at a time, so a game
 * that hands it a save shorter than a sector writes whatever its memory held after the save too, and never reads it
 * back. A person reads each stretch before it goes in, as it takes those bytes out of what's compared: say how it's
 * known the original never reads them. Returns a list of [from, to] as numbers.
 */
export function readLeftover(game) {
  const file = join(sharedProofFolder(game), 'saves.json');
  if (!existsSync(file)) return [];
  return (JSON.parse(readFileSync(file, 'utf8')).leftover ?? []).map(([from, to, why]) => {
    const stretch = [parseInt(from, 16), parseInt(to, 16)];
    if (!/^[0-9A-F]{8}$/.test(from) || !/^[0-9A-F]{8}$/.test(to) || stretch[0] > stretch[1] || typeof why !== 'string' || !why.trim()) {
      throw new Error(`${file}: "leftover" lists stretches as [first byte, last byte, why], the bytes as eight capital hexadecimal digits.`);
    }
    return stretch;
  });
}
