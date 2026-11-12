// "Nothing that matched before differs": what a proof is held to where not every recording matches yet, such as a
// version in C behind its JavaScript, which shares the game's recordings and can't match them all until it's done.
// `prove` ends with DIFFERS_AS_BEFORE, not 1, when frames differ but none that matched before, and `update` commits a
// merge on that (tools/update.mjs). What matched before is what the last commit's progress.json has, and the one being
// merged when a merge is open: never the file itself, which a run before this one may have written worse.

import { spawnSync } from 'node:child_process';
import { REPO } from './paths.mjs';
import { reachedAt } from '../../src/lib/reaches.mjs';

/** How prove ends when frames differ, but none that matched before: neither a whole match, 0, nor a step back, 1. */
export const DIFFERS_AS_BEFORE = 3;

/**
 * The frames that differ now and matched before, as ranges of first and last, in a recording as it was proven before
 * and as it came out now: each a row of progress.json, with `frames` and `differs`. Frames past the ones it had before
 * are new, and matched nothing then.
 */
export function newlyDiffering(before, now) {
  const found = [];
  for (const [first, last] of now.differs ?? []) {
    let from = first;
    const to = Math.min(last, before.frames - 1);
    for (const [gapFrom, gapTo] of [...(before.differs ?? [])].sort((a, b) => a[0] - b[0])) {
      if (gapTo < from) continue;
      if (gapFrom > to) break;
      if (gapFrom > from) found.push([from, gapFrom - 1]);
      from = gapTo + 1;
    }
    if (from <= to) found.push([from, to]);
  }
  return found;
}

/**
 * The recordings that came out worse than before, each { name, why }: one with a frame that matched before and differs
 * now, one a start point now plays where no player could be, one that shows something else than its name says, and one
 * whose part reached what it names before and doesn't now. One nothing proved before has to match in every frame and
 * get its parts where they say. `before` is each recording's row then, by name, and `played` what was played now:
 * [{ name, row, wrong, unreached }], with how many things its name says that the original doesn't show, and the parts
 * whose goal doesn't come true within their frames, each { name, goal, frames } (src/lib/reaches.mjs).
 */
export function worseThan(before, played) {
  const worse = [];
  for (const { name, row, wrong = 0, unreached = [] } of played) {
    const was = before[name];
    if (wrong) worse.push({ name, why: 'the original doesn\'t show what its name says' });
    else if (!was) {
      if (row.matched < row.frames || row.neverInPlay?.length) worse.push({ name, why: 'nothing proved it before, and it doesn\'t match in every frame' });
      else if (unreached.length) worse.push({ name, why: `nothing proved it before, and the original doesn't get to ${unreached[0].goal}, which ${unreached[0].name} says it reaches` });
    } else {
      const [first] = newlyDiffering(was, row);
      const lost = unreached.find(({ goal, frames }) => reachedAt(was.reached?.[goal], frames) !== null);
      if (first) worse.push({ name, why: `frame ${first[0]} matched before and differs now` });
      else if ((row.neverInPlay?.length ?? 0) > (was.neverInPlay?.length ?? 0)) worse.push({ name, why: 'it now plays what no player could see' });
      else if (lost) worse.push({ name, why: `the original got to ${lost.goal} within ${lost.name} before and doesn't now` });
    }
  }
  return worse;
}

/**
 * Each recording's row as the last commit has it, by name, and, when a merge is open, the better of that and the one
 * being merged, as the merged progress.json takes them (lib/merge-main.mjs). {} when the commit has no proof of it.
 * @param {string} game such as sonic-advance or sonic-battle/c
 */
export function provenBefore(game, cwd = REPO) {
  const rows = commit => {
    const shown = spawnSync('git', ['show', `${commit}:games/${game}/proof/progress.json`], { cwd, encoding: 'utf8', maxBuffer: 2 ** 28 });
    try {
      return shown.status === 0 ? JSON.parse(shown.stdout).recordings ?? {} : {};
    } catch {
      return {};
    }
  };
  const mine = rows('HEAD');
  const merging = spawnSync('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd, stdio: 'ignore' }).status === 0;
  if (!merging) return mine;
  const both = { ...mine };
  for (const [name, row] of Object.entries(rows('MERGE_HEAD'))) if (!both[name] || row.matched >= both[name].matched) both[name] = row;
  return both;
}
