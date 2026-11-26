// npm run dp -- newest: brings this folder to the newest main of the Dreamports repository, as the first thing
// /dreamport does, so nobody follows a command or runs tools that main has since changed (#2051). The text an agent
// follows is the copy in its folder, and before this a folder first met the newest main when its task's branch was
// made, after the old text had been read.
//
// It fetches main and moves the folder there only when nothing in it would be lost or disturbed: a fast-forward on
// main, or off a branch whose work is all committed, which stays as it was. A folder with changes not committed, or
// one another session is making a task in (lib/taking.mjs), stays as it is, and it says how to read the newest command
// from main itself. It says when the command changed, so it's read again, and when the packages did.
//   Exit 0 always, as nothing here is a reason to stop: what it prints says what to do.

import { spawnSync } from 'node:child_process';
import { REPO } from './lib/paths.mjs';

/** Where the /dreamport command is written, and what says which packages the tools need. */
const COMMAND = 'tools/commands', PACKAGES = 'package-lock.json';

/** Fetches main from a remote into the folder's name for it, once more if the first try fails: what went wrong, or null. */
function fetchMain(git, remote) {
  let fetched;
  for (let tries = 0; tries < 2; tries++) {
    fetched = git(['fetch', '--quiet', '--no-tags', remote, `+refs/heads/main:refs/remotes/${remote}/main`]);
    if (fetched.status === 0) return null;
  }
  return (fetched.stderr || '').trim().split('\n').pop() || 'git fetch failed';
}

/**
 * Brings `folder` to the newest main when it can, and answers what it found:
 *   { state: 'newest' }    it has main's last commit already
 *   { state: 'moved' }     it was behind and is on main's last commit now, with `from` the branch it left, if any
 *   { state: 'left' }      it's behind and stays as it is, `why` being 'changes', 'session' or 'git'
 *   { state: 'unreached' } main couldn't be fetched, or the folder has no remote
 * `command` lists the command's files that differ on main, and `packages` says the packages do. `here()` is the task
 * another session makes in this folder, or null, and `fetch(git, remote)` fetches main, which the tests give.
 */
export function bringNewest({ folder = REPO, here = () => null, fetch = fetchMain } = {}) {
  const git = args => spawnSync('git', args, { cwd: folder, encoding: 'utf8' });
  const said = args => {
    const ran = git(args);
    return ran.status === 0 ? ran.stdout.trim() : null;
  };
  const names = (said(['remote']) ?? '').split('\n').filter(Boolean);
  const remote = ['upstream', 'origin'].find(name => names.includes(name));
  if (!remote) return { state: 'unreached', why: 'this folder has no remote named upstream or origin' };
  const failed = fetch(git, remote);
  const main = `${remote}/main`, tip = said(['rev-parse', '--verify', '--quiet', main]);
  if (failed || !tip) return { state: 'unreached', why: failed || `${remote} has no main` };
  if (git(['merge-base', '--is-ancestor', tip, 'HEAD']).status === 0) return { state: 'newest', main };

  const differs = path => (said(['diff', '--name-only', 'HEAD', tip, '--', path]) ?? '').split('\n').filter(Boolean);
  const found = { main, command: differs(COMMAND), packages: differs(PACKAGES).length > 0 };
  if (here() !== null) return { state: 'left', why: 'session', ...found };
  if (said(['status', '--porcelain', '--untracked-files=no']) !== '') return { state: 'left', why: 'changes', ...found };

  // on main with nothing of its own, main goes forward. Anywhere else the folder leaves its branch, which keeps
  // every commit it had
  const from = said(['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const behind = git(['merge-base', '--is-ancestor', 'HEAD', tip]).status === 0;
  const moved = from === 'main' && behind ? git(['merge', '--ff-only', '--quiet', main]) : git(['switch', '--quiet', '--detach', main]);
  if (moved.status !== 0) return { state: 'left', why: 'git', said: (moved.stderr || '').trim().split('\n').pop(), ...found };
  return { state: 'moved', from: from === 'main' && behind ? null : from, ...found };
}

/** What to say of what bringNewest found, as one paragraph. */
export function newestLine(found) {
  if (found.state === 'unreached') return `The newest main couldn't be fetched (${found.why}), so this folder is as it was.`;
  if (found.state === 'newest') return 'This folder has the newest main, and so the newest /dreamport.';
  const packages = found.packages ? ' The tools\' packages changed too: run npm ci.' : '';
  if (found.state === 'moved') {
    const left = found.from ? `, off the branch ${found.from}, which keeps every commit it had` : '';
    const command = found.command.length
      ? ' The /dreamport command changed with it: read tools/commands/dreamport.md again from the top now, and follow it in place of the text you were given.'
      : ' The /dreamport command is as it was.';
    return `This folder was behind main, and is on the newest main now${left}.${command}${packages}`;
  }
  const why = { session: 'another session is making a task in it', changes: 'it has changes that aren\'t committed', git: `git couldn't move it (${found.said})` }[found.why];
  const command = found.command.length
    ? ` The /dreamport command is newer on main: read it with git show ${found.main}:tools/commands/dreamport.md, and each part it names the same way, and follow those in place of this folder's. The task's branch gets main's tools at step 7 or 9.`
    : ' The /dreamport command is the same on main, and the task\'s branch gets main\'s tools at step 7 or 9.';
  return `This folder is behind main and stays as it is, as ${why}.${command}`;
}

export async function run() {
  const { sessions } = await import('./lib/taking.mjs');
  console.log(newestLine(bringNewest({ here: () => sessions().here() })));
  return 0;
}
