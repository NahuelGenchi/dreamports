// The runs of the function check kept on this computer, for a proof by the same memory over several of them (#1768).
// One run of `npm run dp -- twin` proves a function when its calls took every path of the original's. Some
// functions' ways are taken by the calls of one seed and others by another's, and no seed's alone takes them all; but
// every call each run compared left the same memory as the original's, so together they are as much a proof as one
// run with all their calls would be. So for each function a run found the same memory over 1,000 calls or more
// without taking every path, the ways its calls took are kept, with the run's seed and calls and the marks of the twin
// and of the original then (proofs.mjs). A later run of the same twin and original, with another seed, is counted
// with them, and when together they took every path the function is proven by the same memory, its line in
// proofs.json naming each run's seed and calls. One seed makes the same calls again, and its first calls are the same
// in a longer run, so a seed counts once: its run of the most calls is the one kept.
//
// A run that found a function different, or whose twin never came back or stopped, counts for nothing: the runs kept
// for that function are dropped, and its own ways are never kept. Once the twin or the original isn't as it was, the
// runs kept for it count for nothing either.
//
// They're kept in .dreamports/twin/<version>/runs.json, never in the repository: anyone can make the same runs again
// from the seeds and calls a proof's line names. The ways are the addresses of the original's instructions that ran,
// each with the ways it went on, as the check counts them (twin.mjs), and nothing of the game's bytes.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LOCAL } from './paths.mjs';

// what the check found of a function that drops every run kept of it
const DIFFERED = new Set(['differs', 'never', 'stopped']);

/** Where a version's runs are kept. */
export const runsFile = version => join(LOCAL, 'twin', ...version.split('/'), 'runs.json');

/** The runs a version keeps, by each function's key: { twin, original, runs: [{ seed, calls, ran }] }, `ran` the
 *  ways, as [[address, ways], …]. An empty object when there are none, or the file can't be read. */
export function readRuns(version) {
  const file = runsFile(version);
  if (!existsSync(file)) return {};
  try {
    const kept = JSON.parse(readFileSync(file, 'utf8'));
    return kept && typeof kept === 'object' && !Array.isArray(kept) ? kept : {};
  } catch {
    return {};
  }
}

/** Writes a version's runs, as readRuns reads them. */
export function writeRuns(version, kept) {
  mkdirSync(dirname(runsFile(version)), { recursive: true });
  writeFileSync(runsFile(version), `${JSON.stringify(kept)}\n`);
}

/** The runs kept of the function `key` that count with a run of `seed` now: of the same twin and original, `marks`
 *  { twin, original }, and another seed. */
export function runsBefore(kept, key, marks, seed) {
  return runsOf(kept, key, marks).filter(run => run.seed !== seed);
}

// the runs kept of the function `key` of the same twin and original, `marks`
function runsOf(kept, key, marks) {
  const entry = kept[key];
  return entry && entry.twin === marks.twin && entry.original === marks.original ? entry.runs : [];
}

/**
 * What's kept after a run of `seed`, from what it found of each function, `found`, each { key, marks, kind, whole,
 * calls, ran }: `kind` the check's ('same', 'differs', 'never', 'stopped', or 'few' and 'unchecked' for one it
 * couldn't compare enough), `whole` whether its calls alone took every path, `ran` the ways they took, and `marks`
 * { twin, original } as they are now. A function found the same over its calls without taking every path keeps its
 * run, beside those of other seeds of the same twin and original, in place of one of the same seed with no more calls;
 * one that differed, never came back or stopped has every run kept of it dropped. Answers the new runs, leaving `kept`
 * as it was.
 */
export function afterRun(kept, seed, found) {
  const after = { ...kept };
  for (const { key, marks, kind, whole, calls, ran } of found) {
    if (DIFFERED.has(kind)) {
      delete after[key];
      continue;
    }
    if (kind !== 'same' || whole || !ran || !marks.twin || !marks.original) continue;
    const before = runsBefore(after, key, marks, seed);
    const longer = runsOf(after, key, marks).find(run => run.seed === seed && run.calls > calls);
    if (longer) continue;
    after[key] = { twin: marks.twin, original: marks.original, runs: [...before, { seed, calls, ran }].sort((a, b) => a.seed - b.seed) };
  }
  return after;
}
