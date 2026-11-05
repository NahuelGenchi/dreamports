// What `npm run dp -- update` does in git, on a made-up repository, with real merges.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { optionsOf } from '../update.mjs';
import { finishMerge, keepMainsTable, merging, newGames, provedOnBothSides, startMerge } from '../lib/merge-main.mjs';

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

test('the command\'s words, in any order', () => {
  assert.deepEqual(optionsOf(['one']), { game: 'one', base: 'main' });
  assert.deepEqual(optionsOf(['one', '--base', 'other']), { game: 'one', base: 'other' });
  assert.deepEqual(optionsOf(['--base', 'other', 'one']), { game: 'one', base: 'other' });
  assert.equal(optionsOf(['--base', 'other']).game, undefined);
  assert.equal(optionsOf(['one', '--base']).base, undefined);
});
