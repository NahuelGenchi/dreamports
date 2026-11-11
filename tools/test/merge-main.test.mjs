// What `npm run dp -- update` does in git, on a made-up repository, with real merges.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { optionsOf } from '../update.mjs';
import { withRowOf } from '../readme.mjs';
import { builtOn, finishMerge, holding, isHolding, keepMainsTable, merging, newGames, provedOnBothSides, startMerge } from '../lib/merge-main.mjs';

const START = '<!-- The proof tools write this table from each Dreamport\'s entry: npm run dp -- readme. -->';
const END = '<!-- End of the table of Dreamports. -->';
const readme = (table, words = 'Words.') => `${words}\n\n${START}\n\n${table}\n\n${END}\n\nMore words.\n`;
const progress = recordings => `${JSON.stringify({ original: 'x', proven: Object.keys(recordings).length, recordings }, null, 2)}\n`;
const MAP = '.github/readme/progress/one.svg';
const PORT = 'games/one/proof/port-map.json';
const PROGRESS = 'games/one/proof/progress.json';

let cwd;
const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const put = files => {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), text);
  }
  git('add', '.');
  git('commit', '-qm', 'step');
};
const read = file => readFileSync(join(cwd, file), 'utf8');

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'dp-merge-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  put({ 'docs/STATUS.md': readme('table 0'), [MAP]: 'map 0', [PORT]: 'port 0', [PROGRESS]: progress({ a: { matched: 5 } }), 'games/one/code.js': 'a\nb\nc\n' });
  git('switch', '-qc', 'work');
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

/** A change on the branch and one on main, with the branch checked out. */
function both(mine, theirs) {
  put(mine);
  git('switch', '-q', 'main');
  put(theirs);
  git('switch', '-q', 'work');
}

test('a branch with main in it has nothing to do', () => {
  assert.deepEqual(startMerge(cwd, 'main'), { upToDate: true, conflicts: [] });
  assert.equal(merging(cwd), false);
});

test('refuses with changes not committed, and touches nothing', () => {
  git('switch', '-q', 'main');
  put({ 'other.txt': 'x' });
  git('switch', '-q', 'work');
  writeFileSync(join(cwd, 'games/one/code.js'), 'changed\n');
  assert.throws(() => startMerge(cwd, 'main'), /Commit what you've changed/);
  assert.equal(merging(cwd), false);
  assert.equal(read('games/one/code.js'), 'changed\n');
});

test('conflicts in every file the tools write settle by themselves', () => {
  both({ 'docs/STATUS.md': readme('table mine'), [MAP]: 'map mine', [PORT]: 'port mine', [PROGRESS]: progress({ a: { matched: 5 }, b: { matched: 7 } }) },
    { 'docs/STATUS.md': readme('table main'), [MAP]: 'map main', [PORT]: 'port main', [PROGRESS]: progress({ a: { matched: 9 }, c: { matched: 3 } }) });
  assert.deepEqual(startMerge(cwd, 'main').conflicts, []);
  assert.equal(git('diff', '--name-only', '--diff-filter=U'), '');
  assert.equal(read('docs/STATUS.md'), readme('table main'));
  assert.equal(read(MAP), 'map main');
  assert.equal(read(PORT), 'port main');
  assert.deepEqual(JSON.parse(read(PROGRESS)).recordings, { a: { matched: 9 }, b: { matched: 7 }, c: { matched: 3 } });
  assert.deepEqual(provedOnBothSides(cwd), ['one']);
});

test('the status doc\'s words on the branch stay when only main changed the table', () => {
  both({ 'docs/STATUS.md': readme('table mine', 'My words.') }, { 'docs/STATUS.md': readme('table main') });
  assert.deepEqual(startMerge(cwd, 'main').conflicts, []);
  assert.equal(read('docs/STATUS.md'), readme('table main', 'My words.'));
});

test('words both sides changed are for a person', () => {
  both({ 'docs/STATUS.md': readme('table 0', 'My words.') }, { 'docs/STATUS.md': readme('table 0', 'Their words.') });
  assert.deepEqual(startMerge(cwd, 'main').conflicts, ['docs/STATUS.md']);
  assert.equal(merging(cwd), true);
});

test('code is for a person, and the rest still settles, and a second run goes on', () => {
  both({ 'games/one/code.js': 'a\nmine\nc\n', [PORT]: 'port mine' }, { 'games/one/code.js': 'a\nmain\nc\n', [PORT]: 'port main' });
  assert.deepEqual(startMerge(cwd, 'main').conflicts, ['games/one/code.js']);
  assert.equal(read(PORT), 'port main');
  assert.match(read('games/one/code.js'), /<<<<<<</);
  // still open, so a second run says the same
  assert.deepEqual(startMerge(cwd, 'main').conflicts, ['games/one/code.js']);
  writeFileSync(join(cwd, 'games/one/code.js'), 'a\nboth\nc\n');
  git('add', 'games/one/code.js');
  assert.deepEqual(startMerge(cwd, 'main'), { upToDate: false, conflicts: [] });
  keepMainsTable(cwd);
  finishMerge(cwd, ['one'], 'Merge main');
  assert.equal(merging(cwd), false);
  assert.equal(git('log', '-1', '--format=%s'), 'Merge main');
  assert.equal(git('rev-list', '--parents', '-1', 'HEAD').split(' ').length, 3);
  assert.equal(git('status', '--porcelain'), '');
});

test('a progress.json that isn\'t JSON is for a person', () => {
  both({ [PROGRESS]: 'not json mine' }, { [PROGRESS]: 'not json main' });
  assert.deepEqual(startMerge(cwd, 'main').conflicts, [PROGRESS]);
});

test('with no conflict, the table and maps still end up as main\'s, so the branch stops changing them', () => {
  both({ 'docs/STATUS.md': readme('table mine'), [MAP]: 'map mine', '.github/readme/progress/stray.svg': 'stray' }, { 'other.txt': 'x' });
  assert.deepEqual(startMerge(cwd, 'main').conflicts, []);
  keepMainsTable(cwd);
  finishMerge(cwd, [], 'Merge main');
  assert.equal(git('diff', '--name-only', 'main', 'HEAD'), '');
});

test('main having removed a map takes it off the branch, as a conflict', () => {
  put({ [MAP]: 'map mine' });
  git('switch', '-q', 'main');
  git('rm', '-q', MAP);
  git('commit', '-qm', 'gone');
  git('switch', '-q', 'work');
  assert.deepEqual(startMerge(cwd, 'main').conflicts, []);
  assert.equal(existsSync(join(cwd, MAP)), false);
});

test('a new game keeps its own map and the table written for it', () => {
  both({ 'games/two/entry.md': 'new', '.github/readme/progress/two.svg': 'two', [MAP]: 'map mine', 'docs/STATUS.md': readme('table with two') }, { 'other.txt': 'x' });
  startMerge(cwd, 'main');
  assert.deepEqual(newGames(cwd), ['two']);
  keepMainsTable(cwd, ['two']);
  finishMerge(cwd, [], 'Merge main');
  assert.equal(read('.github/readme/progress/two.svg'), 'two');
  assert.equal(read(MAP), 'map 0');
  assert.equal(read('docs/STATUS.md'), readme('table with two'));
});

test('a branch with no progress.json of main\'s leaves nothing to prove twice', () => {
  both({ 'games/one/code.js': 'a\nb\nc\nd\n' }, { [PROGRESS]: progress({ a: { matched: 6 } }) });
  startMerge(cwd, 'main');
  assert.deepEqual(provedOnBothSides(cwd), []);
});

/** A pull request's branch from main, with a commit of its own, and the work branch checked out again. */
function pull(branch, files) {
  git('switch', '-q', 'main');
  git('switch', '-qc', branch);
  put(files);
  git('switch', '-q', 'work');
}
const more = (branch, files) => { git('switch', '-q', branch); put(files); git('switch', '-q', 'work'); };
const sha = ref => git('rev-parse', ref);
// GitHub, as far as builtOn asks it: the pull requests it lists for a commit, each one's facts and its newest commit.
// `listed` is false for one GitHub no longer lists by its commits, as one that merged and lost its branch
const github = pulls => ({
  pullsWith: commit => pulls.filter(each => each.listed !== false).filter(each => { try { git('merge-base', '--is-ancestor', commit, each.branch); return true; } catch { return false; } }).map(each => each.number),
  pullOf: number => pulls.find(each => each.number === number) ?? null,
  fetchHead: number => sha(pulls.find(each => each.number === number).branch),
});

test('a branch built on nothing has nothing under it', () => {
  put({ 'games/one/own.js': 'mine\n' });
  assert.deepEqual(builtOn(cwd, 'main', 'work', github([{ number: 12, branch: 'work', open: true }])), []);
});

test('a branch that merged a pull request in is built on it, and knows when that one has gone on', () => {
  pull('lower', { 'games/one/lower.js': 'one\n' });
  git('merge', '-q', '--no-ff', '--no-edit', 'lower');
  put({ 'games/one/own.js': 'mine\n' });
  const pulls = [{ number: 10, branch: 'lower', open: true }, { number: 12, branch: 'work', open: true }];
  assert.deepEqual(builtOn(cwd, 'main', 'work', github(pulls)), [{ number: 10, head: sha('lower'), has: true, inMain: false }]);
  more('lower', { 'games/one/lower.js': 'two\n' });
  assert.deepEqual(builtOn(cwd, 'main', 'work', github(pulls)), [{ number: 10, head: sha('lower'), has: false, inMain: false }]);
  // its newest commits come in like main does, and then the branch has them
  assert.deepEqual(startMerge(cwd, sha('lower')), { upToDate: false, conflicts: [] });
  finishMerge(cwd, [], 'Merge #10');
  assert.equal(read('games/one/lower.js'), 'two\n');
  assert.equal(builtOn(cwd, 'main', 'work', github(pulls))[0].has, true);
});

test('another piece built on the same pull request isn\'t under this one', () => {
  pull('lower', { 'games/one/lower.js': 'one\n' });
  git('merge', '-q', '--no-ff', '--no-edit', 'lower');
  git('switch', '-q', 'main');
  git('switch', '-qc', 'beside');
  git('merge', '-q', '--no-ff', '--no-edit', 'lower');
  put({ 'games/one/beside.js': 'theirs\n' });
  git('switch', '-q', 'work');
  const found = builtOn(cwd, 'main', 'work', github([{ number: 10, branch: 'lower', open: true }, { number: 11, branch: 'beside', open: true }, { number: 12, branch: 'work', open: true }]));
  assert.deepEqual(found.map(each => each.number), [10]);
});

test('one that merged is still brought in whole, and one closed without merging is left out', () => {
  pull('lower', { 'games/one/lower.js': 'one\n' });
  pull('dropped', { 'games/one/dropped.js': 'one\n' });
  git('merge', '-q', '--no-ff', '--no-edit', 'lower');
  git('merge', '-q', '--no-ff', '--no-edit', 'dropped');
  more('lower', { 'games/one/lower.js': 'two\n' });
  const found = builtOn(cwd, 'main', 'work', github([{ number: 10, branch: 'lower', open: false, merged: true }, { number: 9, branch: 'dropped', open: false, merged: false }]));
  assert.deepEqual(found, [{ number: 10, head: sha('lower'), has: false, inMain: false }]);
});

test('one GitHub no longer lists is found by what its merge is called', () => {
  pull('lower', { 'games/one/lower.js': 'one\n' });
  git('merge', '-q', '--no-ff', '-m', "Merge commit 'refs/pull/10/head' into work", 'lower');
  more('lower', { 'games/one/lower.js': 'two\n' });
  const gone = [{ number: 10, branch: 'lower', open: false, merged: true, listed: false }];
  assert.deepEqual(builtOn(cwd, 'main', 'work', github(gone)), [{ number: 10, head: sha('lower'), has: false, inMain: false }]);
  // and by the name update gives its own merges of it
  startMerge(cwd, sha('lower'));
  finishMerge(cwd, [], 'Merge #10, which this branch is built on');
  more('lower', { 'games/one/lower.js': 'three\n' });
  assert.deepEqual(builtOn(cwd, 'main', 'work', github(gone)), [{ number: 10, head: sha('lower'), has: false, inMain: false }]);
});

test('a number in a merge\'s name that isn\'t a pull request, or isn\'t that side\'s, is nothing', () => {
  pull('lower', { 'games/one/lower.js': 'one\n' });
  pull('other', { 'games/one/other.js': 'one\n' });
  git('merge', '-q', '--no-ff', '-m', "Merge branch 'pr77' into work", 'lower');
  assert.deepEqual(builtOn(cwd, 'main', 'work', github([{ number: 10, branch: 'lower', open: true, listed: false }])), []);
  // pull request 77 is another branch, which this side was never on
  assert.deepEqual(builtOn(cwd, 'main', 'work', github([{ number: 77, branch: 'other', open: true, listed: false }])), []);
});

// main takes a pull request as GitHub's squash does: one new commit with its changes, and none of its own commits
function squash(branch) {
  git('switch', '-q', 'main');
  git('merge', '-q', '--squash', branch);
  git('commit', '-qm', `${branch}, squashed`);
  git('switch', '-q', 'work');
  return sha('main');
}

test('a branch that took the other\'s commits with no merge of its own is found by what its pull request says', () => {
  pull('lower', { 'games/one/lower.js': 'one\n' });
  git('merge', '-q', '--ff-only', 'lower');
  put({ 'games/one/own.js': 'mine\n' });
  const pulls = [{ number: 10, branch: 'lower', open: true }, { number: 11, branch: 'other', open: true }];
  pull('other', { 'games/one/other.js': 'one\n' });
  assert.deepEqual(builtOn(cwd, 'main', 'work', github(pulls)), []);
  assert.deepEqual(builtOn(cwd, 'main', 'work', { ...github(pulls), stated: [10] }), [{ number: 10, head: sha('lower'), has: true, inMain: false }]);
  // one it names and carries nothing of isn't under it
  assert.deepEqual(builtOn(cwd, 'main', 'work', { ...github(pulls), stated: [11, 99] }), []);
});

test('once what it\'s built on is squashed into main, main comes in saying it holds it, and only the branch\'s own work is left', () => {
  pull('lower', { 'games/one/code.js': 'a\nlower\nc\n' });
  git('merge', '-q', '--no-ff', '-m', "Merge commit 'refs/pull/10/head' into work", 'lower');
  put({ 'games/one/code.js': 'a\nlower, and more\nc\n' });
  const pulls = [{ number: 10, branch: 'lower', open: false, merged: true, listed: false, mergedAs: squash('lower') }];
  assert.deepEqual(builtOn(cwd, 'main', 'work', github(pulls)), [{ number: 10, head: sha('lower'), has: true, inMain: true }]);
  // main alone conflicts in the line the branch changed on top of the pull request
  assert.deepEqual(startMerge(cwd, 'main').conflicts, ['games/one/code.js']);
  git('merge', '--abort');
  const told = holding(cwd, 'main', [sha('lower')], 'main, which holds #10');
  assert.equal(isHolding(cwd, told, 'main'), true);
  assert.equal(holding(cwd, 'main', [sha('lower')], 'main, which holds #10'), told);
  assert.deepEqual(startMerge(cwd, told), { upToDate: false, conflicts: [] });
  finishMerge(cwd, [], 'Merge main');
  assert.equal(read('games/one/code.js'), 'a\nlower, and more\nc\n');
  // the branch has main now, and the commit that told it so isn't taken for a pull request under it
  assert.deepEqual(startMerge(cwd, 'main'), { upToDate: true, conflicts: [] });
  let asked = 0;
  const found = builtOn(cwd, 'main', 'work', { ...github(pulls), pullsWith: () => { asked++; return []; } });
  assert.deepEqual([found.map(each => each.number), asked], [[10], 1]);
});

test('main holds nothing more when it has every commit already, and a plain commit isn\'t one that says so', () => {
  pull('lower', { 'games/one/lower.js': 'one\n' });
  git('switch', '-q', 'main');
  git('merge', '-q', '--no-ff', '--no-edit', 'lower');
  git('switch', '-q', 'work');
  assert.equal(holding(cwd, 'main', [sha('lower')], 'main, which holds #10'), 'main');
  assert.equal(isHolding(cwd, sha('lower'), 'main'), false);
});

test('a merge of main isn\'t a pull request the branch is built on', () => {
  both({ 'games/one/own.js': 'mine\n' }, { 'other.txt': 'x' });
  git('merge', '-q', '--no-ff', '--no-edit', 'main');
  let asked = 0;
  assert.deepEqual(builtOn(cwd, 'main', 'work', { pullsWith: () => { asked++; return []; }, pullOf: () => { asked++; return null; }, fetchHead: () => null }), []);
  assert.equal(asked, 0);
});

test('the command\'s words, in any order', () => {
  assert.deepEqual(optionsOf(['one']), { game: 'one', base: 'main' });
  assert.deepEqual(optionsOf(['one', '--base', 'other']), { game: 'one', base: 'other' });
  assert.deepEqual(optionsOf(['--base', 'other', 'one']), { game: 'one', base: 'other' });
  assert.equal(optionsOf(['--base', 'other']).game, undefined);
  assert.equal(optionsOf(['one', '--base']).base, undefined);
});

test('a new game adds only its own row to the table main has, however far behind the games\' folders it is (#1098)', () => {
  const row = (name, percent) => `| **[${name}](../games/${name}/)** | [${percent}](../.github/readme/progress/${name}.svg) |`;
  const head = '| Dreamport | Code ported |\n| :--- | :--- |';
  const before = readme(`${head}\n${row('one/c', '21.94%')}\n${row('two', '5%')}`);
  // written whole, the table has one's new number too, which main's own workflow hasn't written yet
  const leading = readme(`${head}\n${row('new/c', '0%')}\n${row('one/c', '24.68%')}\n${row('two', '5%')}`);
  assert.equal(withRowOf(before, leading, 'new/c'), readme(`${head}\n${row('new/c', '0%')}\n${row('one/c', '21.94%')}\n${row('two', '5%')}`));
  // a version under its game's row goes after that row
  const under = readme(`${head}\n${row('one/c', '24.68%')}\n${row('one', '0%')}\n${row('two', '5%')}`);
  assert.equal(withRowOf(before, under, 'one'), readme(`${head}\n${row('one/c', '21.94%')}\n${row('one', '0%')}\n${row('two', '5%')}`));
  assert.equal(withRowOf(before, leading, 'one/c'), null, 'a row the table has already');
  assert.equal(withRowOf(before, leading, 'other'), null, 'no row to add');
  assert.equal(withRowOf(readme(head), leading, 'new/c'), null, 'a table with no row to put it by');
});
