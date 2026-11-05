// Puts the table in docs/STATUS.md and the progress maps on main (.github/workflows/readme.yml). `npm run dp -- readme` has just
// written them from main's own files, and main only takes pull requests, so this opens one with only those files and
// merges it. It asks no model, runs nothing from a pull request, and does nothing when they haven't changed.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BRANCH = 'ops/readme-table';
export const TITLE = 'ops: the table of Dreamports and progress maps (#566)';
const BODY = 'Written by the Readme workflow from the proof files on `main`, with nothing else in it. Refs #566';
const TRIES = 5;

/** `api(path, method, body)` is GitHub's, `changed` the files as [{ path, text }], with text null for a file that's gone. Gives the pull request's number, or null with nothing to do. */
export async function publish({ api, changed, head, owner, sleep = ms => new Promise(done => setTimeout(done, ms)) }) {
  if (!changed.length) return null;
  const { object: { sha: main } } = await api('/git/ref/heads/main');
  // main moved since this was written, so a later run has the newer numbers
  if (main !== head) return null;
  const { tree: baseTree } = await api(`/git/commits/${main}`);
  const tree = await Promise.all(changed.map(async ({ path, text }) => ({ path, mode: '100644', type: 'blob', sha: text === null ? null : (await api('/git/blobs', 'POST', { content: text, encoding: 'utf-8' })).sha })));
  const { sha: newTree } = await api('/git/trees', 'POST', { base_tree: baseTree.sha, tree });
  const { sha: commit } = await api('/git/commits', 'POST', { message: TITLE, tree: newTree, parents: [main] });
  const ref = await api(`/git/ref/heads/${BRANCH}`, 'GET', undefined, true);
  if (ref) await api(`/git/refs/heads/${BRANCH}`, 'PATCH', { sha: commit, force: true });
  else await api('/git/refs', 'POST', { ref: `refs/heads/${BRANCH}`, sha: commit });
  const [open] = await api(`/pulls?state=open&head=${owner}:${BRANCH}`);
  const { number } = open ?? await api('/pulls', 'POST', { title: TITLE, head: BRANCH, base: 'main', body: BODY });
  // GitHub needs a moment before a new pull request can merge
  for (let tries = 1; ; tries++) {
    try {
      await api(`/pulls/${number}/merge`, 'PUT', { sha: commit, merge_method: 'squash', commit_title: `${TITLE} (#${number})` });
      return number;
    } catch (error) {
      if (tries >= TRIES) throw error;
      await sleep(tries * 3000);
    }
  }
}

/** What `npm run dp -- readme` changed in the folder, from git. */
export function changedFiles(folder) {
  const names = execFileSync('git', ['status', '--porcelain', '--no-renames', '-z', '--', 'docs/STATUS.md', '.github/readme/progress'], { cwd: folder, encoding: 'utf8' }).split('\0').filter(Boolean);
  return names.map(row => ({ path: row.slice(3), text: row.slice(0, 2).includes('D') ? null : readFileSync(join(folder, row.slice(3)), 'utf8') }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const repository = process.env.GITHUB_REPOSITORY;
  const api = async (path, method = 'GET', body, missingIsFine) => {
    const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
      method,
      headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(30_000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (missingIsFine && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub API ${method} ${path}: HTTP ${response.status}: ${await response.text()}`);
    return response.json();
  };
  const folder = process.cwd();
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: folder, encoding: 'utf8' }).trim();
  const number = await publish({ api, changed: changedFiles(folder), head, owner: repository.split('/')[0] });
  console.log(number ? `Merged #${number}.` : 'Nothing to put on main.');
}
