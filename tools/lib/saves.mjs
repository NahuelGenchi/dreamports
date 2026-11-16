// What a Dreamport saves, next to what the original's cartridge holds (docs/STANDARD.md#saves): a save written wrong, or
// not at all, shows in no frame, so prove compares the two. The program that plays the original gives its save memory
// each time a frame changed it (gba/original.c, DP_SAVES), and the Dreamport's page what the game wrote (kit/gba/save.js).

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
 * as the original's did, and the first that didn't, as { write, frame, at }: which write, the original's frame, and the
 * first byte that differs, or the first past the shorter one's end.
 */
export function compareSaves(original, own) {
  const theirs = writesIn(original), mine = writesIn(own);
  let same = 0, first = null;
  for (let i = 0; i < Math.max(theirs.length, mine.length); i++) {
    const a = theirs[i]?.bytes, b = mine[i]?.bytes;
    let at = -1;
    if (a && b) {
      const shared = Math.min(a.length, b.length);
      for (at = 0; at < shared && a[at] === b[at]; at++);
      if (at === shared && a.length === b.length) {
        same++;
        continue;
      }
    }
    first ??= { write: i + 1, frame: theirs[i]?.frame ?? null, at: at < 0 ? null : at };
  }
  return { original: theirs.length, dreamport: mine.length, same, first };
}
