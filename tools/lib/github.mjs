// What share needs from GitHub, through the GitHub CLI (gh) signed in as the contributor: their fork of the
// repository and its GitHub Pages site. Everything it publishes goes out under the contributor's own account.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** The repository Dreamports are made in. */
export const UPSTREAM = 'NahuelGenchi/dreamports';

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

/**
 * The contributor's fork: the first of the folder's remotes ([{ name, url }]) that is one, or the one named `wanted`; or,
 * when none of them is, a fork of the repository on GitHub that they can push to, theirs before an organization's, which
 * it adds to the folder as a remote, so a folder cloned from the repository itself finds a fork made elsewhere. Returns
 * { remote, repository, owner, name }, or throws with what to run when they have none. `github` is what it asks GitHub
 * and the folder, for tests: { repository(name), forks(), login(), addRemote(name, url) }.
 */
export function findFork(remotes, wanted, github = FROM_GITHUB) {
  const tried = [];
  for (const { name: remote, url } of remotes) {
    const repository = repositoryOf(url);
    if (!repository || (wanted && repository.toLowerCase() !== wanted.toLowerCase())) continue;
    const found = github.repository(repository);
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

  // none of the remotes is: a fork on GitHub they can push to, which becomes one
  const login = github.login();
  const mine = github.forks()
    .filter(f => f.permissions?.push && (!wanted || f.full_name.toLowerCase() === wanted.toLowerCase()))
    .sort((a, b) => (b.owner.login === login) - (a.owner.login === login));
  if (mine.length) {
    const found = mine[0];
    const taken = new Set(remotes.map(r => r.name));
    let remote = 'fork';
    for (let n = 2; taken.has(remote); n++) remote = `fork-${n}`;
    github.addRemote(remote, found.clone_url);
    console.log(`Your fork ${found.full_name} isn't one of this folder's remotes, so it is now, as ${remote}.`);
    return { remote, repository: found.full_name, owner: found.owner.login, name: found.name };
  }

  const why = tried.length ? ` (${tried.join('; ')})` : '';
  if (wanted) throw new Error(`${wanted} isn't a fork of ${UPSTREAM} you can push to${why}.`);
  // GitHub doesn't let someone who can push to the repository itself fork it to their own account, only to an organization
  const canPush = github.repository(UPSTREAM)?.permissions?.push;
  throw new Error(`This needs your own fork of ${UPSTREAM}, and you have none yet${why}. `
    + (canPush
      ? `You can push to ${UPSTREAM} itself, so GitHub only lets you fork it to an organization: make one at https://github.com/organizations/plan if you have none, then, in this folder, run gh repo fork --org <the organization> --remote --remote-name fork, and run this again.`
      : 'Run gh repo fork --remote, which makes it and adds it to this folder, and run this again.'));
}

// GitHub as the GitHub CLI sees it, and this folder's git
const FROM_GITHUB = {
  repository: name => api(`repos/${name}`),
  forks() {
    const all = [];
    for (let page = 1; page <= 10; page++) {
      const some = api(`repos/${UPSTREAM}/forks?per_page=100&page=${page}`) ?? [];
      all.push(...some);
      if (some.length < 100) break;
    }
    return all;
  },
  login: () => signedInAs(),
  addRemote(name, url) {
    execFileSync('git', ['remote', 'add', name, url], { cwd: fileURLToPath(new URL('../../', import.meta.url)), stdio: ['ignore', 'pipe', 'pipe'] });
  },
};

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
