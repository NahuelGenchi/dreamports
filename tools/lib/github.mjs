// What share needs from GitHub, through the GitHub CLI (gh) signed in as the contributor: their fork of the
// repository, its GitHub Pages site, and the progress threads in the repository's Discussions. Everything it
// publishes or posts goes out under the contributor's own account.

import { execFileSync } from 'node:child_process';

/** The repository Dreamports are made in, whose Discussions hold the progress threads. */
export const UPSTREAM = 'NahuelGenchi/dreamports';
/** The Discussions category with one thread per game, and the field its threads name their game with. */
export const PROGRESS = 'progress';
export const GAME_FIELD = 'Game folder';

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function gh(args, input) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('share needs the GitHub CLI: install it from https://cli.github.com, then sign in with gh auth login.');
    const message = (error.stderr || error.message).trim();
    const failure = new Error(message);
    failure.status = Number(/\(HTTP (\d{3})\)/.exec(message)?.[1] ?? 0);
    throw failure;
  }
}

/** A call to GitHub's REST API: the answer, or null when there's nothing there (404). */
export function api(path, { method = 'GET', body } = {}) {
  try {
    const out = gh(['api', '-X', method, '-H', 'Accept: application/vnd.github+json', path, ...(body ? ['--input', '-'] : [])], body && JSON.stringify(body));
    return out.trim() ? JSON.parse(out) : {};
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

/** A GraphQL query or change: its data. */
export function graphql(query, variables = {}) {
  const out = JSON.parse(gh(['api', 'graphql', '--input', '-'], JSON.stringify({ query, variables })));
  if (out.errors?.length) throw new Error(out.errors.map(e => e.message).join('\n'));
  return out.data;
}

/** The contributor's GitHub name, or an error saying how to sign in. */
export function signedInAs() {
  try {
    return gh(['api', 'user', '--jq', '.login']).trim();
  } catch (error) {
    if (error.message.startsWith('share needs')) throw error;
    throw new Error('Sign in to GitHub first, with the GitHub CLI: gh auth login.');
  }
}

/** owner/name of a GitHub remote's address, such as https://github.com/me/dreamports.git; or null. */
export function repositoryOf(url) {
  const found = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url);
  return found ? `${found[1]}/${found[2]}` : null;
}

/** The contributor's fork among the remotes ([{ name, url }]), or the one named: { remote, repository, owner, name }. */
export function findFork(remotes, wanted) {
  const tried = [];
  for (const { name: remote, url } of remotes) {
    const repository = repositoryOf(url);
    if (!repository || (wanted && repository.toLowerCase() !== wanted.toLowerCase())) continue;
    const found = api(`repos/${repository}`);
    if (!found) continue;
    const forkOf = found.parent?.full_name ?? found.source?.full_name;
    if (found.full_name.toLowerCase() === UPSTREAM.toLowerCase()) {
      tried.push(`${remote} is ${UPSTREAM} itself, where previews never go`);
    } else if (!found.fork || forkOf?.toLowerCase() !== UPSTREAM.toLowerCase()) {
      tried.push(`${remote} is ${found.full_name}, which isn't a fork of ${UPSTREAM}`);
    } else if (!found.permissions?.push) {
      tried.push(`${remote} is ${found.full_name}, which you can't push to`);
    } else {
      return { remote, repository: found.full_name, owner: found.owner.login, name: found.name };
    }
  }
  const why = tried.length ? ` (${tried.join('; ')})` : '';
  throw new Error(wanted
    ? `${wanted} isn't one of this folder's remotes, or isn't your fork of ${UPSTREAM}${why}.`
    : `share publishes previews on your own fork of ${UPSTREAM}, and none of this folder's remotes is one${why}. `
      + 'gh repo fork --remote makes one and adds it.');
}

/** Whether GitHub has a commit in a repository, so a link to it there works: a commit that was never pushed has none. */
export function hasCommit(repository, commit) {
  try {
    return !!api(`repos/${repository}/commits/${commit}`);
  } catch (error) {
    // GitHub answers 422 for a commit it doesn't have
    if (error.status === 422) return false;
    throw error;
  }
}

/** The fork's GitHub Pages site: { url, branch, status }, or null while Pages is off. */
export function pagesOf(repository) {
  const pages = api(`repos/${repository}/pages`);
  return pages && { url: pages.html_url.replace(/\/?$/, '/'), branch: pages.source?.branch ?? null, path: pages.source?.path ?? '/', type: pages.build_type, status: pages.status };
}

/** Switches Pages on for the fork, serving the branch as it is. */
export function turnOnPages(repository, branch) {
  api(`repos/${repository}/pages`, { method: 'POST', body: { build_type: 'legacy', source: { branch, path: '/' } } });
  return pagesOf(repository);
}

/** The fork's last Pages build: { status, commit, error }, or null before the first. */
export function lastBuild(repository) {
  const build = api(`repos/${repository}/pages/builds/latest`);
  return build && { status: build.status, commit: build.commit, error: build.error?.message ?? null };
}

/** Asks GitHub to build the Pages site again. */
export function buildPages(repository) {
  api(`repos/${repository}/pages/builds`, { method: 'POST' });
}

/** The game a progress thread is for: what its first post gives as its folder, or null. */
export function gameOfThread(body) {
  const found = new RegExp(`^###\\s*${GAME_FIELD}\\s*\\n+\\s*\`?([^\\n\`]+)\`?\\s*$`, 'm').exec(body ?? '');
  const game = found?.[1].trim();
  return game && NAME.test(game) ? game : null;
}

/** The first post of a game's thread, as the Progress category's form writes it. */
export function threadBody(game, about) {
  return `### ${GAME_FIELD}\n\n${game}\n\n### About the game\n\n${about}\n`;
}

/** The Progress category of the repository's Discussions, { repositoryId, categoryId }, or an error if there's none. */
export function progressCategory() {
  const [owner, name] = UPSTREAM.split('/');
  const { repository } = graphql(`query($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) { id hasDiscussionsEnabled discussionCategories(first: 50) { nodes { id slug } } }
  }`, { owner, name });
  const category = repository.hasDiscussionsEnabled && repository.discussionCategories.nodes.find(c => c.slug === PROGRESS);
  if (!category) throw new Error(`${UPSTREAM} has no Progress category in its Discussions yet, so there's nowhere to post.`);
  return { repositoryId: repository.id, categoryId: category.id };
}

/** A game's progress thread, the first one opened that's still open: { id, url, title }; or null. */
export function threadOf(categoryId, game) {
  const [owner, name] = UPSTREAM.split('/');
  for (let after = null; ;) {
    const { repository } = graphql(`query($owner: String!, $name: String!, $category: ID!, $after: String) {
      repository(owner: $owner, name: $name) {
        discussions(first: 100, after: $after, categoryId: $category, orderBy: { field: CREATED_AT, direction: ASC }) {
          nodes { id url title body closed }
          pageInfo { hasNextPage endCursor }
        }
      }
    }`, { owner, name, category: categoryId, after });
    const { nodes, pageInfo } = repository.discussions;
    const thread = nodes.find(t => !t.closed && gameOfThread(t.body) === game);
    if (thread) return { id: thread.id, url: thread.url, title: thread.title };
    if (!pageInfo.hasNextPage) return null;
    after = pageInfo.endCursor;
  }
}

/** Opens a game's progress thread: { id, url, title }. */
export function openThread({ repositoryId, categoryId }, game, title, about) {
  const { createDiscussion } = graphql(`mutation($repository: ID!, $category: ID!, $title: String!, $body: String!) {
    createDiscussion(input: { repositoryId: $repository, categoryId: $category, title: $title, body: $body }) { discussion { id url title } }
  }`, { repository: repositoryId, category: categoryId, title, body: threadBody(game, about) });
  return createDiscussion.discussion;
}

/** Posts in a thread: the post's address. */
export function postIn(threadId, body) {
  const { addDiscussionComment } = graphql(`mutation($thread: ID!, $body: String!) {
    addDiscussionComment(input: { discussionId: $thread, body: $body }) { comment { url } }
  }`, { thread: threadId, body });
  return addDiscussionComment.comment.url;
}
