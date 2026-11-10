// A step that changes a game's code and no frame has no clip to show, as a clip shows what main didn't prove
// (lib/clips.mjs): every recording comes out as main has it. Its proof stands in for the clip (docs/STANDARD.md#clips).
// `prove` keeps a record of each whole proof, `share` publishes it where a clip would go, and the pull request's check
// (tools/clips-check.mjs) reads it again and holds it to the files that would merge. A record holds hashes and counts,
// and nothing from the game.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { versionOf } from '../../src/lib/languages.mjs';
import { LOCAL, REPO } from './paths.mjs';

const sha1 = text => createHash('sha1').update(text).digest('hex');
const git = (args, env = {}) => {
  const run = spawnSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 28, env: { ...process.env, ...env } });
  return run.status === 0 ? run.stdout : null;
};
const proofOf = version => `games/${version}/proof/progress.json`;
const gameOf = version => versionOf(version).game;

/** How a record's address ends on the previews site, which tells it from a clip's measures beside it. */
export const RECORD_END = '-same-proof.json';

/** The addresses of proof records in a text, as share's line links them: …/clips/<version>/…-same-proof.json. */
export function recordLinks(text) {
  return [...String(text).matchAll(/https:\/\/[^\s()<>"'[\]]+\/clips\/[^\s()<>"'[\]]+-same-proof\.json/g)].map(found => found[0]);
}

/** The version a record's address is of, such as sonic-advance/c, or null. */
export const versionIn = link => /\/clips\/([a-z0-9-]+(?:\/[a-z0-9-]+)?)\/[^/]+$/.exec(link)?.[1] ?? null;

/**
 * What these paths change of a game: the versions whose code they change, such as sonic-advance/c, and whether they
 * change its recordings, which every version shares and a clip always shows.
 */
export function changesOf(paths, game) {
  const versions = paths.map(path => /^games\/([a-z0-9-]+(?:\/[a-z0-9-]+)?)\/src\//.exec(path)?.[1]).filter(version => version && gameOf(version) === game);
  return { versions: [...new Set(versions)], recordings: paths.some(path => new RegExp(`^games/${game}/(?:[a-z0-9-]+/)?proof/recordings/`).test(path)) };
}

/**
 * The game's folder and the kits' as git would name them if they were committed as they are now: { game, kit }, each
 * a tree's hash, or null when git can't say. What git ignores, such as a build, is left out, as a commit leaves it.
 */
export function treesNow(version) {
  const index = join(LOCAL, 'tmp', `index-${process.pid}`);
  mkdirSync(dirname(index), { recursive: true });
  const own = { GIT_INDEX_FILE: index };
  try {
    if (git(['read-tree', 'HEAD'], own) === null || git(['add', '--all', '--', `games/${gameOf(version)}`, 'kit'], own) === null) return null;
    const tree = folder => git(['write-tree', `--prefix=${folder}/`], own)?.trim() ?? null;
    return { game: tree(`games/${gameOf(version)}`), kit: tree('kit') };
  } finally {
    rmSync(index, { force: true });
  }
}

/**
 * What a commit holds of a version, to hold a record to: the game's folder and the kits' as trees, its progress.json
 * and main's, each as a SHA-1 or null when there's none, and how many recordings the game has. `main` is the commit
 * of main it's compared with.
 */
export function stateAt(version, commit, main) {
  const hashOf = at => {
    const text = at ? git(['show', `${at}:${proofOf(version)}`]) : null;
    return text === null ? null : sha1(text);
  };
  const tree = folder => git(['rev-parse', '-q', '--verify', `${commit}:${folder}`])?.trim() ?? null;
  const recordings = (git(['ls-tree', '--name-only', `${commit}:games/${gameOf(version)}/proof/recordings/`]) ?? '').split('\n').filter(name => name.endsWith('.json')).length;
  return { trees: { game: tree(`games/${gameOf(version)}`), kit: tree('kit') }, progress: hashOf(commit), mains: hashOf(main), recordings };
}

/**
 * The record of a whole proof that just ended: the version, how many recordings it played, the progress.json it wrote
 * and whether that is main's own (`mains`, its text, or null), and the files it was a proof of.
 */
export function recordOf(version, { recordings, progress, mains }) {
  return { proof: 'dreamports', version, recordings, progress: sha1(progress), same: mains !== null && progress === mains, trees: treesNow(version) };
}

const fileOf = version => join(LOCAL, 'proofs', `${version}.json`);

export function keepRecord(record) {
  mkdirSync(dirname(fileOf(record.version)), { recursive: true });
  writeFileSync(fileOf(record.version), `${JSON.stringify(record, null, 2)}\n`);
}

/** prove's record of a version's last whole proof, or null. */
export function readRecord(version) {
  try {
    return JSON.parse(readFileSync(fileOf(version), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Why a record can't stand in for a clip of a version, as sentences, or none when it can: `state` is what the commit
 * holds (stateAt). It stands when the commit's proof is main's own file, and the record is a whole proof of the very
 * files the commit holds that wrote that file.
 * @returns {string[]}
 */
export function recordProblems(record, version, state) {
  const again = `prove it again with every recording (npm run dp -- prove ${version}), and commit what it writes`;
  if (record?.proof !== 'dreamports' || record.version !== version || !record.trees) return [`There's no record of a whole proof of ${version}: ${again}.`];
  if (state.mains === null) return [`main has no proof of ${version} yet, so there's nothing for this one to be the same as.`];
  if (state.progress !== state.mains) return [`${proofOf(version)} isn't main's, so the step changes what the proof shows, and a clip shows that.`];
  const problems = [];
  if (record.progress !== state.progress) problems.push(`The last whole proof of ${version} didn't come out as the commit has it: ${again}.`);
  if (record.trees.game !== state.trees.game || record.trees.kit !== state.trees.kit) problems.push(`The game's files or its console's kit aren't as they were when ${version} was last proven whole: ${again}.`);
  if (record.recordings !== state.recordings) problems.push(`The proof played ${record.recordings} recordings and the game has ${state.recordings}: ${again}.`);
  return problems;
}

/** The record's line for the pull request, under Clips, with the address share gave it. */
export function recordLines(title, record, url) {
  return `No frame changed: all ${record.recordings} recordings of ${title} came out as main has them, so there's no clip of it. [The record of that proof](${url})`;
}
