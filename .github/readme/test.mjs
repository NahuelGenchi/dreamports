// What the Readme workflow does on GitHub, with GitHub stood in for.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BRANCH, CHECKS, publish } from './publish.mjs';

// `runs` gives the workflow runs GitHub has on the pull request's commit, by how many times it was asked: Check and Clips,
// held for approval. `checks` gives each required check's run, by its name and how many times it was asked: finished and
// passed unless it says.
const HELD = [{ id: 1, name: 'Check' }, { id: 2, name: 'Clips' }, { id: 3, name: 'Builds on' }];
function github({ main = 'head', branch = false, open = null, refuse = 0, runs = () => HELD.map(run => ({ ...run, conclusion: 'action_required' })), checks = () => ({ status: 'completed', conclusion: 'success' }) } = {}) {
  const calls = [];
  const asked = {};
  const api = async (path, method = 'GET', body, missingIsFine) => {
    calls.push({ path, method, body });
    if (path === '/actions/runs?head_sha=commit&event=pull_request&per_page=50') {
      asked.runs = (asked.runs ?? 0) + 1;
      return { workflow_runs: runs(asked.runs).map(run => ({ head_sha: 'commit', head_branch: BRANCH, status: 'completed', ...run })) };
    }
    if (/^\/actions\/runs\/\d+\/approve$/.test(path)) return null;
    const run = /^\/commits\/commit\/check-runs\?check_name=(\w+)&filter=latest$/.exec(path);
    if (run) {
      asked[run[1]] = (asked[run[1]] ?? 0) + 1;
      const found = checks(run[1], asked[run[1]]);
      return { check_runs: found ? [{ name: run[1], html_url: `https://example.test/${run[1]}`, ...found }] : [] };
    }
    if (path === '/git/ref/heads/main') return { object: { sha: main } };
    if (path.startsWith('/git/commits/')) return { tree: { sha: 'tree' } };
    if (path === '/git/blobs') return { sha: 'blob' };
    if (path === '/git/trees') return { sha: 'new-tree' };
    if (path === '/git/commits') return { sha: 'commit' };
    if (path === `/git/ref/heads/${BRANCH}`) { assert.ok(missingIsFine); return branch ? { object: {} } : null; }
    if (path.startsWith('/pulls?')) return open ? [open] : [];
    if (path === '/pulls') return { number: 9 };
    if (path.endsWith('/merge') && refuse-- > 0) throw new Error('not yet');
    return {};
  };
  return { api, calls };
}
const go = (stand, changed = [{ path: 'docs/STATUS.md', text: 'new' }, { path: '.github/readme/progress/gone.svg', text: null }]) => publish({ api: stand.api, changed, head: 'head', owner: 'o', sleep: async () => {} });

test('nothing changed asks GitHub nothing', async () => {
  const stand = github();
  assert.equal(await go(stand, []), null);
  assert.equal(stand.calls.length, 0);
});

test('main having moved leaves it to a later run', async () => {
  const stand = github({ main: 'newer' });
  assert.equal(await go(stand), null);
  assert.ok(!stand.calls.some(call => call.method !== 'GET'));
});

test('a pull request with only those files, merged at that very commit', async () => {
  const stand = github();
  assert.equal(await go(stand), 9);
  const tree = stand.calls.find(call => call.path === '/git/trees').body;
  assert.equal(tree.base_tree, 'tree');
  assert.deepEqual(tree.tree.map(file => [file.path, file.sha]), [['docs/STATUS.md', 'blob'], ['.github/readme/progress/gone.svg', null]]);
  assert.deepEqual(stand.calls.find(call => call.path === '/git/refs').body, { ref: `refs/heads/${BRANCH}`, sha: 'commit' });
  const merged = stand.calls.find(call => call.path === '/pulls/9/merge');
  assert.equal(merged.body.sha, 'commit');
  assert.ok(!/\b(clos|fix|resolv)(e|es|ed)?\s+#/i.test(stand.calls.find(call => call.path === '/pulls').body.body));
});

test('a branch and pull request left by a failed run are used again', async () => {
  const stand = github({ branch: true, open: { number: 4 } });
  assert.equal(await go(stand), 4);
  assert.equal(stand.calls.find(call => call.method === 'PATCH').body.force, true);
  assert.ok(!stand.calls.some(call => call.path === '/pulls' || call.path === '/git/refs'));
});

test('waits for GitHub to be able to merge, and says so when it never can', async () => {
  assert.equal(await go(github({ refuse: 2 })), 9);
  await assert.rejects(go(github({ refuse: 99 })), /not yet/);
});

test('approves the runs GitHub holds on its pull request, and merges only once Check and Clips passed', async () => {
  const stand = github({
    // GitHub takes a moment to start the runs, and one of another branch at the same commit is left alone
    runs: asked => (asked < 2 ? [] : [...HELD.map(run => ({ ...run, conclusion: asked === 2 ? 'action_required' : null, status: asked === 2 ? 'completed' : 'queued' })), { id: 9, name: 'Check', head_branch: 'elsewhere', conclusion: 'action_required' }]),
    checks: (name, asked) => (asked < 3 ? (name === 'Check' ? { status: 'in_progress' } : null) : { status: 'completed', conclusion: 'success' }),
  });
  assert.equal(await go(stand), 9);
  const approved = stand.calls.filter(call => call.path.endsWith('/approve'));
  assert.deepEqual(approved.map(call => [call.path, call.method]), [1, 2, 3].map(id => [`/actions/runs/${id}/approve`, 'POST']));
  const merge = stand.calls.findIndex(call => call.path === '/pulls/9/merge');
  assert.ok(stand.calls.findLastIndex(call => call.path.endsWith('/approve')) < stand.calls.findIndex(call => call.path.includes('/check-runs')));
  assert.ok(stand.calls.findLastIndex(call => call.path.includes('/check-runs')) < merge);
  assert.equal(stand.calls.filter(call => call.path.includes('check_name=Check')).length, 3);
  assert.deepEqual(CHECKS, ['Check', 'Clips']);
});

test('a check that fails, never finishes, or never starts merges nothing', async () => {
  const failing = github({ checks: name => (name === 'Clips' ? { status: 'completed', conclusion: 'failure' } : { status: 'completed', conclusion: 'success' }) });
  await assert.rejects(go(failing), /Clips ended as failure on commit, so nothing was merged: https:\/\/example\.test\/Clips/);
  assert.ok(!failing.calls.some(call => call.path.endsWith('/merge')));
  const stuck = github({ checks: name => (name === 'Check' ? { status: 'queued' } : { status: 'completed', conclusion: 'success' }) });
  await assert.rejects(go(stuck), /Check didn't finish on commit in time/);
  assert.ok(!stuck.calls.some(call => call.path.endsWith('/merge')));
  const none = github({ runs: () => [{ id: 2, name: 'Clips', conclusion: 'action_required' }] });
  await assert.rejects(go(none), /GitHub started no Check run on commit, so nothing was merged/);
  assert.ok(!none.calls.some(call => call.path.endsWith('/merge')));
});
