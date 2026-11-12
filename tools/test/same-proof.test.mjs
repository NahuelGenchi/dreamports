// The record of a proof that stands in for a clip, for a step that changes a game's code and no frame
// (lib/same-proof.mjs): what it's held to, how share keeps it, and what the pull request's check reads
// (tools/clips-check.mjs), with made-up records. npm run check runs them.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { clipLinks } from '../lib/clips.mjs';
import { changesOf, recordLines, recordLinks, recordProblems, stateAt, treesNow, versionIn } from '../lib/same-proof.mjs';
import { foreignLinks, keepClip, keepProof, missingLines, savedLines, stillGood } from '../share.mjs';
import { checkClips } from '../clips-check.mjs';
import { REPO } from '../lib/paths.mjs';

const V = 'a-game/c';
const state = (over = {}) => ({ trees: { game: 'g1', kit: 'k1' }, progress: 'p1', mains: 'p1', recordings: 7, ...over });
const record = (over = {}) => ({ proof: 'dreamports', version: V, recordings: 7, progress: 'p1', same: true, trees: { game: 'g1', kit: 'k1' }, ...over });
const LINK = 'https://someone.github.io/dreamports/clips/a-game/c/2026-11-10-abcdef0-same-proof.json';
const site = files => async url => files[url] ?? null;
const published = each => Buffer.from(JSON.stringify(each));

test('a whole proof of the commit\'s own files, whose progress.json is main\'s, stands in for a clip', () => {
  assert.deepEqual(recordProblems(record(), V, state()), []);
});

test('a proof that isn\'t main\'s shows in a clip, whatever the record says', () => {
  assert.match(recordProblems(record({ progress: 'p2' }), V, state({ progress: 'p2' }))[0], /isn't main's, so the step changes what the proof shows/);
  assert.match(recordProblems(record(), V, state({ mains: null }))[0], /main has no proof of a-game\/c yet/);
});

test('a record of other files, another proof or fewer recordings doesn\'t stand, and neither does none', () => {
  assert.match(recordProblems(record({ trees: { game: 'g0', kit: 'k1' } }), V, state())[0], /aren't as they were when a-game\/c was last proven whole/);
  assert.match(recordProblems(record({ trees: { game: 'g1', kit: 'k0' } }), V, state())[0], /console's kit/);
  assert.match(recordProblems(record({ progress: 'p0' }), V, state())[0], /didn't come out as the commit has it/);
  assert.match(recordProblems(record({ recordings: 6 }), V, state())[0], /played 6 recordings and the game has 7/);
  for (const none of [null, {}, record({ version: 'a-game' }), record({ proof: 'other' }), record({ trees: null })]) {
    assert.match(recordProblems(none, V, state())[0], /no record of a whole proof of a-game\/c/);
  }
});

test('what a step changes of a game: the versions whose code it changes, and its recordings', () => {
  const paths = ['games/a-game/c/src/act.c', 'games/a-game/c/src/levels.h', 'games/a-game/src/engine/game.js', 'games/other/src/main.js', 'tools/prove.mjs', 'games/a-game/notes/a.md'];
  assert.deepEqual(changesOf(paths, 'a-game'), { versions: ['a-game/c', 'a-game'], recordings: false });
  assert.deepEqual(changesOf(paths, 'other'), { versions: ['other'], recordings: false });
  assert.deepEqual(changesOf(['games/a-game/proof/recordings/a.json'], 'a-game'), { versions: [], recordings: true });
  assert.equal(changesOf(['games/a-game/c/proof/recordings/a.json', 'games/a-game/c/src/a.c'], 'a-game').recordings, true);
});

test('a record\'s address is told from a clip\'s and its measures\', and names its version', () => {
  const clip = 'https://someone.github.io/dreamports/clips/a-game/c/2026-11-10-abcdef0-1234567';
  const text = `${recordLines('A Game in C', record(), LINK)}\n[Watch](${clip}.mp4) and ${clip}.json`;
  assert.deepEqual(recordLinks(text), [LINK]);
  assert.deepEqual(clipLinks(text), [`${clip}.mp4`, `${clip}.json`]);
  assert.equal(versionIn(LINK), V);
  assert.equal(versionIn('https://someone.github.io/dreamports/clips/a-game/2026-11-10-abcdef0-same-proof.json'), 'a-game');
});

test('the check takes a record in a clip\'s place only for a step that changes code and no frame', async () => {
  const text = `Clips: ${recordLines('A Game in C', record(), LINK)}`;
  const stepOf = () => ({ recordings: false, versions: [{ version: V, state: state() }] });
  const fetched = site({ [LINK]: published(record()) });
  assert.deepEqual(await checkClips(text, { fetched, games: ['a-game'], stepOf }), []);
  // nothing says what it changes, or it changes the recordings: a clip, as before
  assert.match((await checkClips(text, { fetched, games: ['a-game'] }))[0], /links no clip of it/);
  assert.match((await checkClips(text, { fetched, games: ['a-game'], stepOf: () => ({ recordings: true, versions: [{ version: V, state: state() }] }) }))[0], /links no clip of it/);
  // no record linked, one that can't be read, and one that isn't of what would merge
  assert.match((await checkClips('Clips: none', { fetched, games: ['a-game'], stepOf }))[0], /links no clip of it/);
  assert.match((await checkClips(text, { fetched: site({}), games: ['a-game'], stepOf }))[0], /can't be read as a record share made/);
  assert.match((await checkClips(text, { fetched: site({ [LINK]: published(record({ trees: { game: 'g0', kit: 'k1' } })) }), games: ['a-game'], stepOf }))[0], /aren't as they were/);
  assert.match((await checkClips(text, { fetched, games: ['a-game'], stepOf: () => ({ recordings: false, versions: [{ version: V, state: state({ progress: 'p2' }) }] }) }))[0], /isn't main's/);
});

test('every version whose code the step changes needs its own record', async () => {
  const text = `Clips: ${recordLines('A Game in C', record(), LINK)}`;
  const both = () => ({ recordings: false, versions: [{ version: V, state: state() }, { version: 'a-game', state: state() }] });
  const fetched = site({ [LINK]: published(record()) });
  assert.match((await checkClips(text, { fetched, games: ['a-game'], stepOf: both }))[0], /It links no record of a-game's proof/);
  const other = LINK.replace('/a-game/c/', '/a-game/');
  const two = `${text}\n\n${recordLines('A Game', record({ version: 'a-game' }), other)}`;
  assert.deepEqual(await checkClips(two, { fetched: site({ [LINK]: published(record()), [other]: published(record({ version: 'a-game' })) }), games: ['a-game'], stepOf: both }), []);
});

test('share keeps a record\'s line with the branch\'s clips, and lets it go once it no longer stands', () => {
  const lines = recordLines('A Game in C', record(), LINK);
  let saved = keepProof(null, 'enh/1-a', V, lines);
  assert.deepEqual(saved, { branch: 'enh/1-a', clips: [], proofs: [{ key: V, lines }] });
  assert.equal(savedLines(saved), lines);
  assert.deepEqual(missingLines('Clips: none', saved), [{ key: V, lines: [lines] }]);
  assert.deepEqual(missingLines(`Clips:\n\n${lines}\n`, saved), []);
  assert.deepEqual(foreignLinks(`Clips:\n\n${lines}\n`, saved), []);
  assert.deepEqual(foreignLinks(lines.replace('abcdef0', '0000000'), saved), [LINK.replace('abcdef0', '0000000')]);
  // shared again for the same version, it takes the first one's place, and another branch's is another step's
  saved = keepProof(saved, 'enh/1-a', V, 'again');
  assert.deepEqual(saved.proofs, [{ key: V, lines: 'again' }]);
  assert.deepEqual(keepProof(saved, 'enh/2-b', V, lines), { branch: 'enh/2-b', clips: [], proofs: [{ key: V, lines }] });
  // a clip shared later keeps it, until the commit's proof isn't the one recorded
  saved = keepClip(saved, 'enh/1-a', 'a-test', 'clip lines');
  assert.equal(savedLines(saved), 'clip lines\n\nagain');
  const none = { ...saved, clips: [] };
  assert.deepEqual(stillGood(none, 'enh/1-a', 'c'.repeat(40), null, () => null, () => true).proofs, [{ key: V, lines: 'again' }]);
  assert.deepEqual(stillGood(none, 'enh/1-a', 'c'.repeat(40), null, () => null, () => false).proofs, []);
});

test('the files as they are now are named as a commit of them would be', t => {
  const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
  if (git('status', '--porcelain', '--', 'games/sonic-battle', 'kit')) return t.skip('games/sonic-battle or kit has changes not committed');
  const before = git('status', '--porcelain');
  assert.deepEqual(treesNow('sonic-battle/c'), stateAt('sonic-battle/c', 'HEAD', 'HEAD').trees);
  // and reading them leaves the folder's own index alone
  assert.equal(git('status', '--porcelain'), before);
  const held = stateAt('sonic-battle/c', 'HEAD', 'HEAD');
  assert.equal(held.progress, held.mains);
  assert.ok(held.recordings > 0);
});
