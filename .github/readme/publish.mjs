// Puts the table in docs/STATUS.md and the progress maps on main (.github/workflows/readme.yml). `npm run dp -- readme` has just
// written them from main's own files, and main only takes pull requests, so this opens one with only those files and
// merges it. main also requires the Check and Clips checks (#1033), whose runs GitHub holds on this workflow's own pull
// request until someone approves them, as it treats the Actions bot like a first-time contributor, so it approves them
// and merges once both pass. It asks no model, runs nothing from a pull request, and does nothing when they haven't
// changed.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BRANCH = 'ops/readme-table';
export const TITLE = 'ops: the table of Dreamports and progress maps (#566)';
const BODY = 'Written by the Readme workflow from the proof files on `main`, with nothing else in it. Refs #566';
const TRIES = 5;
/** The checks main requires, as the ruleset main checks names them, each the name of its workflow and of its job. */
export const CHECKS = ['Check', 'Clips'];
// Check takes five to seven minutes, so it's asked every 20 seconds for up to 20 minutes
const WAIT = { every: 20_000, polls: 60 };

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
  await approve({ api, commit, sleep });
  await checked({ api, commit, sleep });
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

/** Approves the runs GitHub holds on this workflow's own pull request at `commit`, once those of the checks main requires
 * are there, and throws when they never come. Each runs main's own workflow on a commit with only the table and maps. */
export async function approve({ api, commit, sleep, wait = WAIT }) {
  for (let poll = 1; ; poll++) {
    const { workflow_runs: runs = [] } = await api(`/actions/runs?head_sha=${commit}&event=pull_request&per_page=50`);
    const ours = runs.filter(run => run.head_sha === commit && run.head_branch === BRANCH);
    for (const run of ours.filter(r => r.conclusion === 'action_required')) await api(`/actions/runs/${run.id}/approve`, 'POST');
    if (CHECKS.every(name => ours.some(run => run.name === name))) return;
    if (poll >= wait.polls) throw new Error(`GitHub started no ${CHECKS.filter(name => !ours.some(run => run.name === name)).join(' or ')} run on ${commit}, so nothing was merged.`);
    await sleep(wait.every);
  }
}

/** Waits until each check main requires has run on `commit`, and throws when one fails or doesn't finish in time. */
export async function checked({ api, commit, sleep, wait = WAIT }) {
  for (let poll = 1; ; poll++) {
    const latest = await Promise.all(CHECKS.map(async name => {
      const { check_runs: runs = [] } = await api(`/commits/${commit}/check-runs?check_name=${name}&filter=latest`);
      return runs.find(run => run.name === name) ?? { name, status: 'not started' };
    }));
    const failed = latest.find(run => run.status === 'completed' && run.conclusion !== 'success');
    if (failed) throw new Error(`${failed.name} ended as ${failed.conclusion} on ${commit}, so nothing was merged: ${failed.html_url}`);
    if (latest.every(run => run.status === 'completed')) return;
    if (poll >= wait.polls) throw new Error(`${latest.filter(run => run.status !== 'completed').map(run => run.name).join(' and ')} didn't finish on ${commit} in time, so nothing was merged.`);
    await sleep(wait.every);
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
    // approving a run answers with no content
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };
  const folder = process.cwd();
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: folder, encoding: 'utf8' }).trim();
  const number = await publish({ api, changed: changedFiles(folder), head, owner: repository.split('/')[0] });
  console.log(number ? `Merged #${number}.` : 'Nothing to put on main.');
}
