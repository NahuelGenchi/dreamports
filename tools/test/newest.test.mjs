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
/** GitHub's repository, a writer's clone of it that pushes to main, and the folder /dreamport runs in. */
function folders() {
  const base = join(root, String(++made));
  const github = join(base, 'github.git'), writer = join(base, 'writer'), folder = join(base, 'folder');
  mkdirSync(base, { recursive: true });
  git(base, 'init', '--quiet', '--bare', '--initial-branch=main', github);
  git(base, 'clone', '--quiet', github, writer);
  git(writer, 'checkout', '--quiet', '-B', 'main');
  commit(writer, 'tools/commands/dreamport.md', 'the command, as it was\n');
  commit(writer, 'package-lock.json', '{ "packages": 1 }\n');
  git(writer, 'push', '--quiet', 'origin', 'main');
  git(base, 'clone', '--quiet', github, folder);
  /** What main gets after the folder was cloned. */
  const onMain = (path, text) => {
    const at = commit(writer, path, text);
    git(writer, 'push', '--quiet', 'origin', 'main');
    return at;
  };
  return { folder, onMain, head: () => git(folder, 'rev-parse', 'HEAD') };
}

test('a folder with main\'s last commit is left alone', () => {
  const { folder, head } = folders();
  const before = head();
  const found = bringNewest({ folder });
  assert.equal(found.state, 'newest');
  assert.equal(head(), before);
  assert.match(newestLine(found), /has the newest main/);
});

test('a folder on main that is behind goes forward, and is told the command changed', () => {
  const { folder, onMain, head } = folders();
  const tip = onMain('tools/commands/dreamport.md', 'the command, as it is now\n');
  const found = bringNewest({ folder });
  assert.equal(found.state, 'moved');
  assert.equal(found.from, null);
  assert.deepEqual(found.command, ['tools/commands/dreamport.md']);
  assert.equal(found.packages, false);
  assert.equal(head(), tip);
  assert.equal(git(folder, 'symbolic-ref', '--short', 'HEAD'), 'main');
  assert.match(newestLine(found), /read tools\/commands\/dreamport\.md again from the top/);
});

test('a change that isn\'t the command\'s says the command is as it was, and one to the packages says to install them', () => {
  const { folder, onMain } = folders();
  onMain('tools/find.mjs', '// a tool\n');
  onMain('package-lock.json', '{ "packages": 2 }\n');
  const found = bringNewest({ folder });
  assert.equal(found.state, 'moved');
  assert.deepEqual(found.command, []);
  assert.equal(found.packages, true);
  assert.match(newestLine(found), /command is as it was\..*run npm ci/);
});

test('a folder left on a finished task\'s branch leaves it for the newest main, and the branch keeps its commits', () => {
  const { folder, onMain, head } = folders();
  git(folder, 'switch', '--quiet', '-c', 'feat/1-a-piece');
  const piece = commit(folder, 'games/a-game/src/main.c', 'int main(void) { return 0; }\n');
  const tip = onMain('tools/commands/parts/gaps.md', 'a part of the command\n');
  const found = bringNewest({ folder });
  assert.equal(found.state, 'moved');
  assert.equal(found.from, 'feat/1-a-piece');
  assert.deepEqual(found.command, ['tools/commands/parts/gaps.md']);
  assert.equal(head(), tip);
  assert.equal(git(folder, 'rev-parse', 'feat/1-a-piece'), piece);
  assert.match(newestLine(found), /off the branch feat\/1-a-piece, which keeps every commit it had/);
  // and once there, it has the newest
  assert.equal(bringNewest({ folder }).state, 'newest');
});

test('a folder with changes that aren\'t committed stays as it is, and is told where the newest command is', () => {
  const { folder, onMain, head } = folders();
  git(folder, 'switch', '--quiet', '-c', 'feat/2-half-made');
  const before = commit(folder, 'games/a-game/src/main.c', 'int main(void) { return 0; }\n');
  write(folder, 'games/a-game/src/main.c', 'int main(void) { return 1; }\n');
  onMain('tools/commands/dreamport.md', 'the command, as it is now\n');
  const found = bringNewest({ folder });
  assert.equal(found.state, 'left');
  assert.equal(found.why, 'changes');
  assert.equal(head(), before);
  assert.equal(git(folder, 'symbolic-ref', '--short', 'HEAD'), 'feat/2-half-made');
  assert.match(newestLine(found), /git show origin\/main:tools\/commands\/dreamport\.md/);
  assert.equal(git(folder, 'show', 'origin/main:tools/commands/dreamport.md'), 'the command, as it is now');
});

test('a file nobody committed or added is no change, and stays where it is', () => {
  const { folder, onMain, head } = folders();
  write(folder, '.local/notes.txt', 'mine\n');
  const tip = onMain('tools/find.mjs', '// a tool\n');
  assert.equal(bringNewest({ folder }).state, 'moved');
  assert.equal(head(), tip);
  assert.equal(git(folder, 'status', '--porcelain'), '?? .local/');
});

test('a folder another session is making a task in stays as it is', () => {
  const { folder, onMain, head } = folders();
  const before = head();
  onMain('tools/find.mjs', '// a tool\n');
  const found = bringNewest({ folder, here: () => 1901 });
  assert.equal(found.state, 'left');
  assert.equal(found.why, 'session');
  assert.equal(head(), before);
  assert.match(newestLine(found), /another session is making a task in it\. The \/dreamport command is the same on main/);
});

test('a fork\'s folder takes main from upstream, not from the fork', () => {
  const { folder, onMain, head } = folders();
  git(folder, 'remote', 'rename', 'origin', 'upstream');
  git(folder, 'remote', 'add', 'origin', join(root, 'no-such-fork.git'));
  const tip = onMain('tools/find.mjs', '// a tool\n');
  const found = bringNewest({ folder });
  assert.equal(found.state, 'moved');
  assert.equal(found.main, 'upstream/main');
  assert.equal(head(), tip);
});

test('a main that can\'t be fetched leaves the folder as it was, and says so', () => {
  const { folder, head } = folders();
  const before = head();
  git(folder, 'remote', 'set-url', 'origin', join(root, 'gone.git'));
  const found = bringNewest({ folder });
  assert.equal(found.state, 'unreached');
  assert.equal(head(), before);
  assert.match(newestLine(found), /couldn't be fetched/);
  git(folder, 'remote', 'remove', 'origin');
  assert.equal(bringNewest({ folder }).state, 'unreached');
});
