// A pull request of its own for what a tool wrote, beside the branch being worked on, which stays as it is: a new game's
// first files, from `new`, and its card, from `capture` (docs/TEAMS.md#a-games-first-files-and-its-card). The Dreamports bot
// reads each by itself, so neither waits for the review of the task being made.
import { execFileSync } from 'node:child_process';
import { REPO } from './paths.mjs';
import { api, findFork, repositoryOf } from './github.mjs';
import { remotes } from './preview.mjs';

const git = (args, options = {}) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options }).trim();

/** Where a pull request to `repository` comes from: its own remote for someone who can push to it, or their fork. */
export function pushesTo(repository) {
  const all = remotes();
  const own = all.find(({ url }) => repositoryOf(url)?.toLowerCase() === repository.toLowerCase());
  if (own && api(`repos/${repository}`)?.permissions?.push) return { remote: own.name, owner: repository.split('/')[0], source: own.name };
  const fork = findFork(all);
  return { remote: fork.remote, owner: fork.owner, source: own?.name ?? `https://github.com/${repository}.git` };
}

/** The branch pull requests to `repository` go into, and its newest commit, fetched from where `from` (pushesTo) says. */
export function mainOf(repository, from) {
  const into = api(`repos/${repository}`).default_branch;
  git(['fetch', '--quiet', '--no-tags', from.source, `+refs/heads/${into}:refs/dreamports/main`]);
  return { into, main: git(['rev-parse', 'refs/dreamports/main']) };
}

/**
 * Pushes `commit` as `branch` where `from` says and opens a pull request for it into `into`, with the repository's
 * template filled in: it only refers to the game's issue, which stays open. Gives the pull request as GitHub answers,
 * the one already open for that branch when there is one.
 */
export function openPull({ repository, from, into, commit, branch, title, issue, started, changes, review, follows }) {
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
