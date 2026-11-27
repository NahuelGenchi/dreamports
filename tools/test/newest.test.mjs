// Tests of how /dreamport brings its folder to the newest main before it starts (../newest.mjs), on made-up
// repositories: one that stands for GitHub's, and a folder cloned from it. npm run check runs them.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { LOCAL } from '../lib/paths.mjs';
import { bringNewest, newestLine } from '../newest.mjs';

mkdirSync(join(LOCAL, 'tmp'), { recursive: true });
const root = mkdtempSync(join(LOCAL, 'tmp', 'newest-'));
after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5 }));

const git = (cwd, ...args) => {
  const ran = spawnSync('git', ['-c', 'user.name=Someone', '-c', 'user.email=someone@example.com', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(ran.status, 0, `git ${args.join(' ')}: ${ran.stderr}`);
  return ran.stdout.trim();
};
const write = (folder, path, text) => {
  mkdirSync(dirname(join(folder, path)), { recursive: true });
  writeFileSync(join(folder, path), text);
};
const commit = (folder, path, text, message = `change ${path}`) => {
  write(folder, path, text);
  git(folder, 'add', '-A');
  git(folder, 'commit', '--quiet', '-m', message);
  return git(folder, 'rev-parse', 'HEAD');
};

let made = 0;
/**
 * GitHub's repository and the folder /dreamport runs in, cloned from it. The folder reads GitHub's objects where they
 * are, so the tests' fetch is the folder's name for main moved to GitHub's commit, with no program started to carry
 * them: on some Windows computers git's own way between two folders fails now and then. `onMain` is what main gets
 * after the folder was cloned.
 */
function folders() {
  const base = join(root, String(++made));
  const github = join(base, 'github'), folder = join(base, 'folder');
  mkdirSync(github, { recursive: true });
  git(github, 'init', '--quiet', '--initial-branch=main');
  // line endings as they're written, kept in each repository's own settings: the tool runs git with the folder's
  // settings, and a Windows computer's own would otherwise check a file out changed
  git(github, 'config', 'core.autocrlf', 'false');
  commit(github, 'tools/commands/dreamport.md', 'the command, as it was\n');
  commit(github, 'package-lock.json', '{ "packages": 1 }\n');
  // the folder as a clone leaves one, made with no clone: git's way between two folders is what fails now and then,
  // and it failed here too, in two of three full checks of one day (#2080)
  mkdirSync(folder, { recursive: true });
  git(folder, 'init', '--quiet', '--initial-branch=main');
  git(folder, 'config', 'core.autocrlf', 'false');
  writeFileSync(join(folder, '.git', 'objects', 'info', 'alternates'), `${join(github, '.git', 'objects').replaceAll('\\', '/')}\n`);
  const tip = git(github, 'rev-parse', 'main');
  git(folder, 'remote', 'add', 'origin', github);
  git(folder, 'update-ref', 'refs/remotes/origin/main', tip);
  git(folder, 'reset', '--quiet', '--hard', tip);
  git(folder, 'config', 'branch.main.remote', 'origin');
  git(folder, 'config', 'branch.main.merge', 'refs/heads/main');
  const fetch = (run, remote) => (run(['update-ref', `refs/remotes/${remote}/main`, git(github, 'rev-parse', 'main')]).status === 0 ? null : 'the name for main didn\'t move');
  return { folder, fetch, onMain: (path, text) => commit(github, path, text), head: () => git(folder, 'rev-parse', 'HEAD') };
}

test('a folder with main\'s last commit is left alone', () => {
  const { folder, fetch, head } = folders();
  const before = head();
  const found = bringNewest({ folder, fetch });
  assert.equal(found.state, 'newest');
  assert.equal(head(), before);
  assert.match(newestLine(found), /has the newest main/);
});

test('a folder on main that is behind goes forward, and is told the command changed', () => {
  const { folder, fetch, onMain, head } = folders();
  const tip = onMain('tools/commands/dreamport.md', 'the command, as it is now\n');
  const found = bringNewest({ folder, fetch });
  assert.equal(found.state, 'moved');
  assert.equal(found.from, null);
  assert.deepEqual(found.command, ['tools/commands/dreamport.md']);
  assert.equal(found.packages, false);
  assert.equal(head(), tip);
  assert.equal(git(folder, 'symbolic-ref', '--short', 'HEAD'), 'main');
  assert.match(newestLine(found), /read tools\/commands\/dreamport\.md again from the top/);
});

test('a change that isn\'t the command\'s says the command is as it was, and one to the packages says to install them', () => {
  const { folder, fetch, onMain } = folders();
  onMain('tools/find.mjs', '// a tool\n');
  onMain('package-lock.json', '{ "packages": 2 }\n');
  const found = bringNewest({ folder, fetch });
  assert.equal(found.state, 'moved');
  assert.deepEqual(found.command, []);
  assert.equal(found.packages, true);
  assert.match(newestLine(found), /command is as it was\..*run npm ci/);
});

test('a folder left on a finished task\'s branch leaves it for the newest main, and the branch keeps its commits', () => {
  const { folder, fetch, onMain, head } = folders();
  git(folder, 'switch', '--quiet', '-c', 'feat/1-a-piece');
  const piece = commit(folder, 'games/a-game/src/main.c', 'int main(void) { return 0; }\n');
  const tip = onMain('tools/commands/parts/gaps.md', 'a part of the command\n');
  const found = bringNewest({ folder, fetch });
  assert.equal(found.state, 'moved');
  assert.equal(found.from, 'feat/1-a-piece');
  assert.deepEqual(found.command, ['tools/commands/parts/gaps.md']);
  assert.equal(head(), tip);
  assert.equal(git(folder, 'rev-parse', 'feat/1-a-piece'), piece);
  assert.match(newestLine(found), /off the branch feat\/1-a-piece, which keeps every commit it had/);
  // and once there, it has the newest
  assert.equal(bringNewest({ folder, fetch }).state, 'newest');
});

test('a folder with changes that aren\'t committed stays as it is, and is told where the newest command is', () => {
  const { folder, fetch, onMain, head } = folders();
  git(folder, 'switch', '--quiet', '-c', 'feat/2-half-made');
  const before = commit(folder, 'games/a-game/src/main.c', 'int main(void) { return 0; }\n');
  write(folder, 'games/a-game/src/main.c', 'int main(void) { return 1; }\n');
  onMain('tools/commands/dreamport.md', 'the command, as it is now\n');
  const found = bringNewest({ folder, fetch });
  assert.equal(found.state, 'left');
  assert.equal(found.why, 'changes');
  assert.equal(head(), before);
  assert.equal(git(folder, 'symbolic-ref', '--short', 'HEAD'), 'feat/2-half-made');
  assert.match(newestLine(found), /git show origin\/main:tools\/commands\/dreamport\.md/);
  assert.equal(git(folder, 'show', 'origin/main:tools/commands/dreamport.md'), 'the command, as it is now');
});

test('a file nobody committed or added is no change, and stays where it is', () => {
  const { folder, fetch, onMain, head } = folders();
  write(folder, '.local/notes.txt', 'mine\n');
  const tip = onMain('tools/find.mjs', '// a tool\n');
  assert.equal(bringNewest({ folder, fetch }).state, 'moved');
  assert.equal(head(), tip);
  assert.equal(git(folder, 'status', '--porcelain'), '?? .local/');
});

test('a folder another session is making a task in stays as it is', () => {
  const { folder, fetch, onMain, head } = folders();
  const before = head();
  onMain('tools/find.mjs', '// a tool\n');
  const found = bringNewest({ folder, fetch, here: () => 1901 });
  assert.equal(found.state, 'left');
  assert.equal(found.why, 'session');
  assert.equal(head(), before);
  assert.match(newestLine(found), /another session is making a task in it\. The \/dreamport command is the same on main/);
});

test('a fork\'s folder takes main from upstream, not from the fork', () => {
  const { folder, fetch, onMain, head } = folders();
  git(folder, 'remote', 'rename', 'origin', 'upstream');
  git(folder, 'remote', 'add', 'origin', join(root, 'no-such-fork.git'));
  const tip = onMain('tools/find.mjs', '// a tool\n');
  const found = bringNewest({ folder, fetch });
  assert.equal(found.state, 'moved');
  assert.equal(found.main, 'upstream/main');
  assert.equal(head(), tip);
});

test('a main that can\'t be fetched leaves the folder as it was, and says so', () => {
  const { folder, fetch, onMain, head } = folders();
  const before = head();
  onMain('tools/find.mjs', '// a tool\n');
  const found = bringNewest({ folder, fetch: () => 'Could not resolve host: github.com' });
  assert.equal(found.state, 'unreached');
  assert.equal(head(), before);
  assert.match(newestLine(found), /couldn't be fetched \(Could not resolve host: github\.com\), so this folder is as it was/);
  // and a folder with no remote at all is never asked to fetch
  git(folder, 'remote', 'remove', 'origin');
  assert.equal(bringNewest({ folder, fetch }).state, 'unreached');
});
