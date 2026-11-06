// What `npm run dp -- update` does in git (tools/update.mjs): merges main into a branch and settles, with no one asked,
// the conflicts in files the tools write. Everything takes the repository's folder, so tools/test/merge-main.test.mjs
// can run it on a made-up repository.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATUS, splitTable } from '../readme.mjs';

const MAPS = '.github/readme/progress';
const MAP = /^\.github\/readme\/progress\/[^/]+\.svg$/;
// a game's, or its version's in another language, such as games/sonic-battle/c/proof/ (src/lib/languages.mjs)
const PORT_MAP = /^games\/[^/]+(?:\/[^/]+)?\/proof\/port-map\.json$/;
const PROGRESS = /^games\/([^/]+(?:\/[^/]+)?)\/proof\/progress\.json$/;
const ENTRY = /^games\/([^/]+)\/entry\.md$/;

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 2 ** 28, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const lines = text => text.split('\n').filter(Boolean);
const passes = (cwd, args) => spawnSync('git', args, { cwd, stdio: 'ignore' }).status === 0;

/** One side of a conflict: 1 where they parted, 2 the branch, 3 main. Null when that side has no such file. */
function side(cwd, number, file) {
  const shown = spawnSync('git', ['show', `:${number}:${file}`], { cwd, encoding: 'utf8', maxBuffer: 2 ** 28 });
  return shown.status === 0 ? shown.stdout : null;
}

const unmerged = cwd => lines(git(cwd, ['diff', '--name-only', '--diff-filter=U']));
export const merging = cwd => passes(cwd, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']);

function write(cwd, file, text) {
  if (text === null) {
    git(cwd, ['rm', '--quiet', '--force', '--', file]);
    return;
  }
  writeFileSync(join(cwd, file), text);
  git(cwd, ['add', '--', file]);
}

/** Both sides' recordings, the one that matched more where both have it. `prove` writes all of it again; until then, what it finds is compared with the best anyone had. */
function bothProgress(ours, theirs) {
  const mine = JSON.parse(ours), main = JSON.parse(theirs);
  const recordings = { ...mine.recordings };
  for (const [name, row] of Object.entries(main.recordings ?? {})) {
    if (!recordings[name] || row.matched >= recordings[name].matched) recordings[name] = row;
  }
  return `${JSON.stringify({ ...main, recordings }, null, 2)}\n`;
}

/** docs/STATUS.md with main's table and whichever side changed the words around it, or null when both did. */
function bothStatus(base, ours, theirs) {
  const [was, mine, main] = [base, ours, theirs].map(text => (text === null ? null : splitTable(text)));
  if (!was || !mine || !main) return null;
  const same = (a, b) => a.before === b.before && a.after === b.after;
  if (same(mine, was) || same(mine, main)) return theirs;
  return same(main, was) ? `${mine.before}${main.table}${mine.after}` : null;
}

/** The text a conflict in a file the tools write settles to, or undefined when it isn't one. */
function settled(cwd, file) {
  const [base, ours, theirs] = [1, 2, 3].map(number => side(cwd, number, file));
  if (MAP.test(file) || PORT_MAP.test(file)) return theirs;
  if (PROGRESS.test(file) && ours !== null && theirs !== null) {
    try {
      return bothProgress(ours, theirs);
    } catch {
      return undefined;
    }
  }
  if (file === STATUS) return bothStatus(base, ours, theirs) ?? undefined;
  return undefined;
}

/**
 * Merges `main`, a commit, into the branch, leaving the merge uncommitted, or goes on with one already started.
 * { upToDate } when it has nothing to add, otherwise { conflicts }, the files only a person or an agent can settle.
 */
export function startMerge(cwd, main) {
  if (!merging(cwd)) {
    if (passes(cwd, ['merge-base', '--is-ancestor', main, 'HEAD'])) return { upToDate: true, conflicts: [] };
    const changed = git(cwd, ['status', '--porcelain', '--untracked-files=no']);
    if (changed) throw new Error(`Commit what you've changed first, so a merge can't touch it:\n${changed}`);
    const merge = spawnSync('git', ['merge', '--no-ff', '--no-commit', '--no-edit', main], { cwd, encoding: 'utf8' });
    if (merge.status !== 0 && !unmerged(cwd).length) throw new Error(`git couldn't merge main:\n${merge.stderr || merge.stdout}`);
  }
  const conflicts = [];
  for (const file of unmerged(cwd)) {
    const text = settled(cwd, file);
    if (text === undefined) conflicts.push(file);
    else write(cwd, file, text);
  }
  return { upToDate: false, conflicts };
}

/** The games the branch and main both proved, as their progress.json has to be measured again for each of them, with a
 *  version by its name, such as sonic-battle/c (git's * takes in the /). */
export function provedOnBothSides(cwd) {
  const parted = git(cwd, ['merge-base', 'HEAD', 'MERGE_HEAD']);
  const games = range => lines(git(cwd, ['diff', '--name-only', parted, range, '--', 'games/*/proof/progress.json'])).map(file => PROGRESS.exec(file)?.[1]).filter(Boolean);
  const main = new Set(games('MERGE_HEAD'));
  return games('HEAD').filter(game => main.has(game));
}

/** The games the branch brings that main doesn't have yet, whose first entry carries its row and map. */
export function newGames(cwd) {
  return lines(git(cwd, ['diff', '--name-only', '--diff-filter=A', 'MERGE_HEAD', '--', 'games/*/entry.md'])).map(file => ENTRY.exec(file)[1]);
}

/**
 * The table in docs/STATUS.md and the progress maps are main's own, written after each merge by .github/workflows/readme.yml,
 * so a branch carries main's and the next merge has nothing to conflict over. A new game keeps its row, its map and
 * nothing else, as a first entry has to have them, with the table just written with its row.
 */
export function keepMainsTable(cwd, games = []) {
  const onMain = new Set(lines(git(cwd, ['ls-tree', '-r', '--name-only', 'MERGE_HEAD', '--', MAPS])));
  for (const file of lines(git(cwd, ['ls-files', '--', MAPS]))) {
    if (onMain.has(file)) git(cwd, ['checkout', 'MERGE_HEAD', '--', file]);
    else if (!games.some(game => file === `${MAPS}/${game}.svg`)) git(cwd, ['rm', '--quiet', '--force', '--', file]);
  }
  for (const file of onMain) if (!existsSync(join(cwd, file))) git(cwd, ['checkout', 'MERGE_HEAD', '--', file]);
  if (games.length) return;
  const mine = splitTable(readFileSync(join(cwd, STATUS), 'utf8'));
  const main = splitTable(git(cwd, ['show', `MERGE_HEAD:${STATUS}`]));
  if (mine && main) writeFileSync(join(cwd, STATUS), `${mine.before}${main.table}${mine.after}`);
}

/** Commits the merge, with what the tools wrote for `games`. */
export function finishMerge(cwd, games, message) {
  git(cwd, ['add', '--update']);
  for (const game of games) git(cwd, ['add', '--', `games/${game}/proof`]);
  git(cwd, ['commit', '--quiet', '-m', message]);
}
