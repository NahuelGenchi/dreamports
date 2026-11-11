// A pull request of its own for what a tool wrote, beside the branch being worked on, which stays as it is: a new game's
// first files, from `new`, and its card, from `capture` (docs/TEAMS.md#a-games-first-files-and-its-card). The Dreamports bot
// reads each by itself, so neither waits for the review of the task being made.
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './paths.mjs';
import { api, findFork, repositoryOf } from './github.mjs';
import { fileAt, remotes } from './preview.mjs';
import { captureMessage, firstFilesMessage, withCapture } from './new-game.mjs';

const git = (args, options = {}) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options }).trim();

// where a pull request to `repository` comes from: its own remote for someone who can push to it, or their fork
function pushesTo(repository) {
  const all = remotes();
  const own = all.find(({ url }) => repositoryOf(url)?.toLowerCase() === repository.toLowerCase());
  if (own && api(`repos/${repository}`)?.permissions?.push) return { remote: own.name, owner: repository.split('/')[0], source: own.name };
  const fork = findFork(all);
  return { remote: fork.remote, owner: fork.owner, source: own?.name ?? `https://github.com/${repository}.git` };
}

// the branch pull requests to `repository` go into, and its newest commit, fetched from where `from` (pushesTo) says
function mainOf(repository, from) {
  const into = api(`repos/${repository}`).default_branch;
  git(['fetch', '--quiet', '--no-tags', from.source, `+refs/heads/${into}:refs/dreamports/main`]);
  return { into, main: git(['rev-parse', 'refs/dreamports/main']) };
}

// Pushes `commit` as `branch` where `from` says and opens a pull request for it into `into`, with the repository's
// template filled in: it only refers to the game's issue, which stays open. Gives the pull request as GitHub answers,
// the one already open for that branch when there is one.
function openPull({ repository, from, into, commit, branch, title, issue, started, changes, review, follows }) {
  // the branch is the tool's own, named after what it sends, so sending again takes the place of what it sent before
  git(['push', '--quiet', '--force', from.remote, `${commit}:refs/heads/${branch}`]);
  const open = api(`repos/${repository}/pulls?state=open&head=${from.owner}:${branch}&per_page=1`)?.[0];
  if (open) return open;
  const milestone = api(`repos/${repository}/issues/${issue}`)?.milestone;
  return api(`repos/${repository}/pulls`, {
    method: 'POST',
    body: {
      title, head: `${from.owner}:${branch}`, base: into, maintainer_can_modify: true,
      body: [
        '## Tracking', '', `Refs #${issue}`, `Milestone: ${milestone?.title ?? 'none'}`, `Branch: ${branch}, ${started}`, '',
        '## Changes', '', changes, '',
        '## Delivery record', '', 'Site build: not run', 'Browser checks: none', 'Preview: none', `Source/diff review: ${review}`, 'Private data: none committed (no ROMs, game files, extracted game assets, private email addresses, or credentials)', '',
        '## Limitations and follow-up', '', follows,
      ].join('\n'),
    },
  });
}

/** The files of a game's capture, by what ends each one's name in public/media/. */
export const MEDIA = ['.h264.mp4', '.av1.mp4', '-still.webp', '-share.png'];
export const mediaPath = (game, end) => `public/media/${game}-dreamport${end}`;
/** The branch a game's capture is sent as, which names its game's issue. */
export const captureBranch = issue => `feat/${issue}-capture`;

/**
 * A whole new game's first files as a pull request of their own: the commit just made, HEAD, when it's alone on a commit
 * of main's, pushed as a branch beside the one being worked on, which stays as it is and goes on from the same commit.
 * `name` is the game's and `issue` its game's issue. Gives the line to say: where it went, or why it goes in with the
 * branch's own pull request.
 */
export function sendFirstFiles({ name, issue, repository }) {
  try {
    const from = pushesTo(repository);
    const { into, main } = mainOf(repository, from);
    const commit = git(['rev-parse', 'HEAD']);
    try {
      git(['merge-base', '--is-ancestor', `${commit}^`, main]);
    } catch {
      return 'Its first files go in with this branch\'s pull request, as this branch doesn\'t start from main alone.';
    }
    const pull = openPull({
      repository, from, into, commit, branch: `feat/${issue}-first-files`, issue, title: firstFilesMessage(name, issue), started: 'the game\'s first files, on the latest main',
      changes: `${name} Dreamport's first files, written by \`npm run dp -- new\`: the start every new game has, unchanged, with the map of the original's code. Nothing of the game is in them.`,
      review: 'what the tool wrote',
      follows: 'The Dreamports bot writes every file again and merges this by itself once its checks pass, so the game\'s issue shows its progress map. Its card comes in a pull request of its own, and every step after that in one that\'s reviewed.',
    });
    return `Sent as a pull request of their own, which merges by itself once its checks pass: ${pull.html_url}`;
  } catch (error) {
    return `Its first files go in with this branch's pull request, as they couldn't go by themselves: ${error.message}`;
  }
}

/**
 * A game's capture as a pull request of its own, its card, in a commit made on main beside the branch being worked on,
 * which stays as it is: the capture's files as this folder has them, and main's entry naming them. A game whose first
 * files aren't on main yet has nowhere for a card to go by itself. `how` says who chose the moment, and `index` is a
 * file to stage the commit in. Gives the line to say.
 */
export function sendCard({ game, name, issue, repository, how, index }) {
  try {
    const from = pushesTo(repository);
    const { into, main } = mainOf(repository, from);
    const onMain = fileAt(main, `games/${game}/entry.md`);
    if (!onMain) return 'It goes in with this branch\'s pull request, as the game\'s first files aren\'t on main yet.';
    const env = { ...process.env, GIT_INDEX_FILE: index };
    rmSync(index, { force: true });
    git(['read-tree', main], { env });
    const add = (path, sha) => git(['update-index', '--add', '--cacheinfo', `100644,${sha},${path}`], { env });
    for (const end of MEDIA) add(mediaPath(game, end), git(['hash-object', '-w', join(REPO, mediaPath(game, end))]));
    add(`games/${game}/entry.md`, git(['hash-object', '-w', '--stdin'], { input: withCapture(onMain.toString('utf8'), game) }));
    const commit = git(['commit-tree', git(['write-tree'], { env }), '-p', main, '-m', captureMessage(name, issue)]);
    rmSync(index, { force: true });
    const pull = openPull({
      repository, from, into, commit, branch: captureBranch(issue), issue, title: captureMessage(name, issue), started: 'from the latest main',
      changes: `${name} Dreamport's capture, for its card in the launcher, written by \`npm run dp -- capture\`. ${how}`,
      review: 'what the tool wrote',
      follows: 'Someone who runs this repository looks at the capture before it appears, and a person can always replace it with one they choose.',
    });
    return `Sent as a pull request of its own: ${pull.html_url}`;
  } catch (error) {
    return `It goes in with this branch's pull request, as it couldn't go by itself: ${error.message}`;
  }
}
