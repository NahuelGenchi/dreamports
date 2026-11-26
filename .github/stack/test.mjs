// Tests of what a stack of pull requests runs (stack.mjs): which pull request one above carries, so its heavy runs stop
// and its Check and Clips fail saying which one to merge it through, what can't switch a pull request's tests off, what
// a pull request's own events stop and start again, and that every heavy workflow has Stack in front of its jobs.
// npm run check runs them, against a stand-in for GitHub.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { carries, gate, gatedWorkflows, namedBelow, stop, topsOf } from './stack.mjs';

const REPOSITORY = 'dreamports/dreamports';
const WORKFLOWS = new URL('../workflows/', import.meta.url);

// a stand-in for GitHub's API: pull requests, commits with their parents, runs and their jobs
function stand({ pulls = [], parents = {}, runs = [], jobs = {}, endsAfter = 1, broken = false }) {
  const ancestors = sha => {
    const seen = new Set();
    const queue = [...(parents[sha] ?? [])];
    while (queue.length) {
      const each = queue.shift();
      if (seen.has(each)) continue;
      seen.add(each);
      queue.push(...(parents[each] ?? []));
    }
    return seen;
  };
  const polls = new Map();
  const gh = {
    repository: REPOSITORY,
    asked: [],
    cancelled: [],
    rerun: [],
    async list(path) {
      if (broken) throw new Error('GitHub API GET /pulls: HTTP 502');
      assert.equal(path, '/pulls?state=open');
      return pulls.filter(pull => pull.state === 'open');
    },
    async get(path) {
      gh.asked.push(path);
      let found;
      if ((found = path.match(/^\/pulls\/(\d+)$/))) return pulls.find(pull => pull.number === Number(found[1])) ?? null;
      if ((found = path.match(/^\/compare\/(\w+)\.\.\.(\w+)\?per_page=1$/))) {
        const [, base, head] = found;
        return { status: base === head ? 'identical' : ancestors(head).has(base) ? 'ahead' : ancestors(base).has(head) ? 'behind' : 'diverged' };
      }
      if ((found = path.match(/^\/actions\/runs\?event=pull_request&head_sha=(\w+)&per_page=100$/))) return { workflow_runs: runs.filter(run => run.head_sha === found[1]) };
      if ((found = path.match(/^\/actions\/runs\/(\d+)\/jobs\?per_page=100$/))) return { jobs: jobs[found[1]] ?? [] };
      if ((found = path.match(/^\/actions\/runs\/(\d+)$/))) {
        const run = runs.find(each => each.id === Number(found[1]));
        const count = (polls.get(run.id) ?? 0) + 1;
        polls.set(run.id, count);
        return gh.cancelled.includes(run.id) && count >= endsAfter ? { ...run, status: 'completed', conclusion: 'cancelled' } : run;
      }
      throw new Error(`no stand-in for GET ${path}`);
    },
    async post(path) {
      let found;
      // forced, or Check's last job, which runs whatever happened, would keep a stopped run going
      if ((found = path.match(/^\/actions\/runs\/(\d+)\/force-cancel$/))) gh.cancelled.push(Number(found[1]));
      else if ((found = path.match(/^\/actions\/runs\/(\d+)\/rerun$/))) gh.rerun.push(Number(found[1]));
      else throw new Error(`no stand-in for POST ${path}`);
      return {};
    },
  };
  return gh;
}

const pull = (number, sha, { body = '', fork = false, base = 'main', state = 'open', merged = false } = {}) => ({
  number,
  state,
  merged,
  body,
  base: { ref: base },
  head: { sha, repo: { full_name: fork ? 'someone/dreamports' : REPOSITORY } },
});
// a stack's commits: a, then b on it, then c on b; x is on a beside b
const PARENTS = { b: ['a'], c: ['b'], x: ['a'] };
const event = lower => ({ pull_request: lower });
const said = async (gh, lower, eventName = 'pull_request') => (await gate({ gh, eventName, event: event(lower), log: () => {} }))?.message ?? null;

test('a pull request a stack above carries is tested through its top, which is named', async () => {
  const one = pull(1, 'a');
  const two = pull(2, 'b', { body: '## Tracking\n\nCloses #10\nBuilds on #1\n' });
  const three = pull(3, 'c', { body: 'Builds on #2' });
  const gh = stand({ pulls: [one, two, three], parents: PARENTS });
  assert.equal(await said(gh, one), 'This pull request is tested through #3, which carries its commits at the top of its stack. Merge it through #3.');
  assert.match(await said(gh, two), /tested through #3\b/);
  assert.equal(await said(gh, three), null);
});

test('a piece two pieces build on, with one on top of both, is tested through that one only', async () => {
  const parents = { b1: ['a'], b2: ['a'], m: ['b1', 'b2'] };
  const one = pull(1, 'a');
  const gh = stand({
    pulls: [one, pull(2, 'b1', { body: 'Builds on #1' }), pull(3, 'b2', { body: 'builds on #1' }), pull(4, 'm', { body: 'Builds on #2\nBuilds on #3' })],
    parents,
  });
  assert.equal((await topsOf(gh, one)).map(top => top.number).join(), '4');
});

test('two stacks that each carry a pull request both name it', async () => {
  const one = pull(1, 'a');
  const gh = stand({ pulls: [one, pull(2, 'b', { body: 'Builds on #1' }), pull(3, 'x', { body: 'Builds on #1' })], parents: PARENTS });
  assert.equal(await said(gh, one), 'This pull request is tested through #2 or #3, which each carry its commits at the top of a stack. Merge it through one of them.');
  const four = stand({ pulls: [one, ...[2, 3, 4].map(number => pull(number, `y${number}`, { body: 'Builds on #1' }))], parents: { y2: ['a'], y3: ['a'], y4: ['a'] } });
  assert.equal((await gate({ gh: four, eventName: 'pull_request', event: event(one), log: () => {} })).above, '#2 or #3 or #4');
});

test("someone else's pull request can't switch a pull request's tests off", async () => {
  const one = pull(1, 'a');
  // from a fork, though it names it and carries its head
  assert.equal(await said(stand({ pulls: [one, pull(2, 'b', { body: 'Builds on #1', fork: true })], parents: PARENTS }), one), null);
  // naming it with a head beside its own, at its own head, or behind it
  for (const [mine, theirs] of [['b', 'x'], ['a', 'a'], ['c', 'b']]) {
    const lower = pull(1, mine);
    assert.equal(await said(stand({ pulls: [lower, pull(2, theirs, { body: 'Builds on #1' })], parents: PARENTS }), lower), null, `${mine} under ${theirs}`);
  }
  // carrying it on another base, or closed
  assert.equal(await said(stand({ pulls: [one, pull(2, 'b', { body: 'Builds on #1', base: 'other' })], parents: PARENTS }), one), null);
  assert.equal(await said(stand({ pulls: [one, pull(2, 'b', { body: 'Builds on #1', state: 'closed' })], parents: PARENTS }), one), null);
  // carrying its commits without naming it, or naming it only in a sentence or the template's comment
  for (const body of ['', 'Refs #1', 'This builds on #1 too.', '<!-- Builds on #1 -->', 'Builds on #12'])
    assert.equal(await said(stand({ pulls: [one, pull(2, 'b', { body })], parents: PARENTS }), one), null, body);
});

test('a pull request pushed past what the one above carries runs in full, at the commit its run is for', async () => {
  const upper = pull(2, 'b', { body: 'Builds on #1' });
  const gh = stand({ pulls: [pull(1, 'c'), upper], parents: PARENTS });
  assert.equal(await said(gh, pull(1, 'c')), null);
  // a run again of an older run reads the commit that run was for
  assert.match(await said(gh, pull(1, 'a')), /tested through #2\b/);
});

test('a run not on a pull request, or GitHub not answering, runs in full', async () => {
  const one = pull(1, 'a');
  const gh = stand({ pulls: [one, pull(2, 'b', { body: 'Builds on #1' })], parents: PARENTS });
  for (const eventName of ['push', 'schedule', 'workflow_dispatch']) assert.equal(await said(gh, one, eventName), null);
  assert.equal(await gate({ gh, eventName: 'push', event: {}, log: () => {} }), null);
  const lines = [];
  assert.equal(await gate({ gh: stand({ broken: true }), eventName: 'pull_request', event: event(one), log: line => lines.push(line) }), null);
  assert.match(lines.join('\n'), /^::warning title=Stack::GitHub didn't say .* HTTP 502$/);
});

test('Builds on lines are read as the Builds on check reads them', async () => {
  assert.deepEqual([...namedBelow('Closes #5\nBuilds on #1\n  builds on #22 \nBUILDS ON #3, as it needs it')], [1, 22, 3]);
  assert.deepEqual([...namedBelow(null)], []);
  assert.equal(await carries(stand({ parents: PARENTS }), pull(1, 'b', { body: 'Builds on #1' }), pull(1, 'a'), 'a'), false);
});

// runs of the heavy workflows and others, at a head, with their jobs
const GATED = new Set(['check', 'clips', 'gb', 'gba', 'nes', 'ps1', 'psp', 'nds'].map(name => `.github/workflows/${name}.yml`));
const run = (id, path, head_sha, status, conclusion = null, extra = {}) => ({
  id, path, head_sha, status, conclusion, workflow_id: path, name: path.split('/').at(-1), html_url: `https://github.com/r/${id}`,
  created_at: `2026-11-25T10:00:${String(id).padStart(2, '0')}Z`, pull_requests: [{ number: 1 }], ...extra,
});
const job = (name, status, conclusion = null, steps) => ({ name, status, conclusion, ...(steps ? { steps } : {}) });
const step = (name, status, conclusion = null) => ({ name, status, conclusion });
const quiet = { log: () => {}, wait: async () => {} };

test("a pull request newly naming one it carries stops the runs Stack let through, and runs them again to say so", async () => {
  const lines = [];
  const gh = stand({
    pulls: [pull(1, 'a'), pull(2, 'b', { body: 'Builds on #1' })],
    parents: PARENTS,
    endsAfter: 2,
    runs: [
      run(11, '.github/workflows/check.yml', 'a', 'in_progress'),
      run(12, '.github/workflows/clips.yml', 'a', 'in_progress'),
      run(13, '.github/workflows/gb.yml', 'a', 'in_progress'),
      run(14, '.github/workflows/nes.yml', 'a', 'in_progress'),
      run(15, '.github/workflows/builds-on.yml', 'a', 'in_progress'),
      run(16, '.github/workflows/ps1.yml', 'a', 'queued'),
      run(17, '.github/workflows/check.yml', 'z', 'in_progress'),
      // ended before the line was there: passed in full, failed in full, and an older run of a workflow run since
      run(18, '.github/workflows/gba.yml', 'a', 'completed', 'success'),
      run(19, '.github/workflows/psp.yml', 'a', 'completed', 'failure'),
      run(9, '.github/workflows/nes.yml', 'a', 'completed', 'success'),
      // stopped once, and never run again
      run(20, '.github/workflows/nds.yml', 'a', 'completed', 'cancelled'),
    ],
    jobs: {
      11: [job('Stack', 'completed', 'success'), job('Check (site)', 'in_progress'), job('Check', 'queued')],
      12: [job('Clips', 'in_progress', null, [step('Set up job', 'completed', 'success'), step('Stack', 'completed', 'success'), step('Run node tools/clips-check.mjs', 'in_progress')])],
      // Stack still to start, so it reads GitHub as it is now, and Stack already failed
      13: [job('Stack', 'queued'), job('Mac (Game Boy)', 'queued')],
      14: [job('Stack', 'completed', 'failure'), job('Mac (NES)', 'completed', 'skipped')],
      // a workflow with no Stack, which isn't stopped
      15: [job('Builds on', 'in_progress')],
      16: [],
      18: [job('Stack', 'completed', 'success'), job('Mac (Game Boy Advance)', 'completed', 'success')],
      19: [job('Stack', 'completed', 'success'), job('Mac (PlayStation Portable)', 'completed', 'failure')],
      9: [job('Stack', 'completed', 'success'), job('Mac (NES)', 'completed', 'success')],
      20: [job('Stack', 'completed', 'success'), job('Mac (Nintendo DS)', 'completed', 'cancelled')],
    },
  });
  await stop({ gh, event: { action: 'edited', pull_request: pull(2, 'b', { body: 'Builds on #1' }), changes: { body: { from: '' } } }, gated: GATED, log: line => lines.push(line), wait: async () => {} });
  assert.deepEqual(gh.cancelled, [12, 11]);
  assert.deepEqual(gh.rerun, [20, 18, 12, 11]);
  assert.match(lines.join('\n'), /Stopped check\.yml on #1 \(https:\/\/github\.com\/r\/11\), as #2 carries it\./);
});

test('a run that was going before Stack was there stops and stays stopped, and one that takes too long to stop is left', async () => {
  const lines = [];
  const gh = stand({
    pulls: [pull(1, 'a'), pull(2, 'b', { body: 'Builds on #1' })],
    parents: PARENTS,
    endsAfter: 99,
    runs: [run(11, '.github/workflows/check.yml', 'a', 'in_progress'), run(12, '.github/workflows/gb.yml', 'a', 'in_progress')],
    jobs: { 11: [job('Check (site)', 'in_progress')], 12: [job('Stack', 'in_progress')] },
  });
  await stop({ gh, event: { action: 'synchronize', pull_request: pull(2, 'b', { body: 'Builds on #1' }) }, gated: GATED, log: line => lines.push(line), wait: async () => {}, tries: 3 });
  assert.deepEqual(gh.cancelled, [12, 11]);
  assert.deepEqual(gh.rerun, []);
  assert.match(lines.join('\n'), /check\.yml .* has no Stack in its workflow, so it stays stopped/);
  assert.match(lines.join('\n'), /gb\.yml .* hasn't stopped yet/);
});

test("a pull request that doesn't carry the one it names, from a fork, or merged, stops nothing", async () => {
  const runs = [run(11, '.github/workflows/check.yml', 'c', 'in_progress')];
  const jobs = { 11: [job('Stack', 'completed', 'success')] };
  const lower = pull(1, 'c');
  for (const upper of [pull(2, 'b', { body: 'Builds on #1' }), pull(2, 'd', { body: 'Builds on #1', fork: true })]) {
    const gh = stand({ pulls: [lower, upper], parents: { ...PARENTS, d: ['c'] }, runs, jobs });
    await stop({ gh, event: { action: 'synchronize', pull_request: upper }, gated: GATED, ...quiet });
    assert.deepEqual([gh.cancelled, gh.rerun], [[], []]);
  }
  // a fork's or a merged pull request's events ask GitHub nothing, though nothing carries the one below now
  const stopped = { runs: [run(11, '.github/workflows/check.yml', 'a', 'completed', 'failure')], jobs: { 11: [job('Stack', 'completed', 'failure')] } };
  for (const upper of [pull(2, 'b', { body: 'Builds on #1', fork: true }), pull(2, 'b', { body: 'Builds on #1', state: 'closed', merged: true })]) {
    const gh = stand({ pulls: [pull(1, 'a'), upper], parents: PARENTS, ...stopped });
    await stop({ gh, event: { action: upper.merged ? 'closed' : 'synchronize', pull_request: upper }, gated: GATED, ...quiet });
    assert.deepEqual([gh.cancelled, gh.rerun, gh.asked], [[], [], []]);
  }
});

// a pull request's runs after Stack stopped them, and one that ran in full before
const STOPPED = {
  runs: [
    run(11, '.github/workflows/check.yml', 'a', 'completed', 'failure'),
    run(12, '.github/workflows/clips.yml', 'a', 'completed', 'failure'),
    run(13, '.github/workflows/gb.yml', 'a', 'completed', 'cancelled'),
    run(14, '.github/workflows/nes.yml', 'a', 'completed', 'success'),
    run(5, '.github/workflows/check.yml', 'a', 'completed', 'failure'),
    run(15, '.github/workflows/builds-on.yml', 'a', 'completed', 'failure'),
  ],
  jobs: {
    11: [job('Stack', 'completed', 'failure'), job('Check', 'completed', 'failure')],
    12: [job('Clips', 'completed', 'failure', [step('Stack', 'completed', 'failure')])],
    13: [job('Stack', 'completed', 'cancelled')],
    14: [job('Stack', 'completed', 'success'), job('Mac (NES)', 'completed', 'success')],
    5: [job('Stack', 'completed', 'failure')],
  },
};

test('once the one above is closed without merging, the runs Stack stopped run again in full', async () => {
  const upper = pull(2, 'b', { body: 'Builds on #1', state: 'closed' });
  const gh = stand({ pulls: [pull(1, 'a'), upper], parents: PARENTS, ...STOPPED });
  await stop({ gh, event: { action: 'closed', pull_request: upper }, gated: GATED, ...quiet });
  assert.deepEqual([gh.cancelled, gh.rerun.sort()], [[], [11, 12, 13]]);
});

test('once its line is taken out, they run again in full, unless another pull request above still carries it', async () => {
  const edited = pull(2, 'b', { body: 'Closes #10' });
  const gh = stand({ pulls: [pull(1, 'a'), edited], parents: PARENTS, ...STOPPED });
  await stop({ gh, event: { action: 'edited', pull_request: edited, changes: { body: { from: 'Builds on #1' } } }, gated: GATED, ...quiet });
  assert.deepEqual(gh.rerun.sort(), [11, 12, 13]);
  const still = stand({ pulls: [pull(1, 'a'), edited, pull(3, 'c', { body: 'Builds on #1' })], parents: PARENTS, ...STOPPED });
  await stop({ gh: still, event: { action: 'edited', pull_request: edited, changes: { body: { from: 'Builds on #1' } } }, gated: GATED, ...quiet });
  assert.deepEqual(still.rerun, []);
});

// what main's rules require of a pull request, and the workflows that run heavy tests on one
const REQUIRED = ['Check', 'Clips'];
const HEAVY = ['check', 'clips', 'gamecube', 'gb', 'gba', 'mac', 'nds', 'nes', 'ps1', 'psp', 'snes-n64'];
const workflow = name => parse(readFileSync(new URL(name, WORKFLOWS), 'utf8'));
const STATUS = /\b(always|cancelled|failure)\(\)/;

test('every heavy workflow runs Stack before any of its jobs, and the required checks are never skipped', () => {
  const gated = gatedWorkflows(fileURLToPath(WORKFLOWS));
  for (const name of HEAVY) assert.ok(gated.has(`.github/workflows/${name}.yml`), `${name}.yml runs Stack`);
  for (const path of gated) {
    const file = path.split('/').at(-1);
    const { on, jobs } = workflow(file);
    assert.ok(on.pull_request !== undefined, `${file} runs on pull requests`);
    const required = Object.entries(jobs).filter(([, each]) => REQUIRED.includes(each.name));
    if (jobs.stack) {
      const { name, permissions, steps } = jobs.stack;
      assert.equal(name, 'Stack', file);
      assert.deepEqual(permissions, { contents: 'read', 'pull-requests': 'read' }, file);
      assert.equal(steps.at(-1).name, 'Stack', file);
      assert.equal(steps.at(-1).run, 'node .github/stack/stack.mjs', file);
      for (const [id, each] of Object.entries(jobs)) {
        if (id === 'stack' || (file === 'check.yml' && id === 'credit')) continue;
        assert.ok([each.needs].flat().includes('stack'), `${file}'s ${id} job needs Stack`);
        // a job that runs whatever the jobs before it did runs only once Stack passed, or is a required check that fails
        if (STATUS.test(String(each.if ?? ''))) {
          if (REQUIRED.includes(each.name)) assert.match(JSON.stringify(each.steps), /needs\.stack\.result.*needs\.stack\.outputs\.message/, `${file}'s ${id} job fails when Stack did`);
          else assert.match(String(each.if), /!cancelled\(\) && needs\.stack\.result == 'success'/, `${file}'s ${id} job`);
        }
      }
      for (const [id, each] of required) assert.equal(each.if, 'always()', `${file}'s ${id} job is never skipped`);
    } else {
      // Stack as a step, before anything of the pull request's runs, in a job that is never skipped
      assert.equal(Object.keys(jobs).length, 1, file);
      const [[id, only]] = Object.entries(jobs);
      assert.equal(only.if, undefined, `${file}'s ${id} job is never skipped`);
      const first = only.steps.findIndex(each => each.run);
      assert.equal(only.steps[first].name, 'Stack', file);
      assert.equal(only.steps[first].run, 'node .github/stack/stack.mjs', file);
      assert.equal(workflow(file).permissions['pull-requests'], 'read', file);
    }
  }
  // Clips and Check are each in a heavy workflow
  const names = [...gated].flatMap(path => Object.values(workflow(path.split('/').at(-1)).jobs).map(each => each.name));
  for (const name of REQUIRED) assert.ok(names.includes(name), name);
});

test('runs are stopped and started only on the events of a pull request from this repository, never by a heavy workflow', () => {
  const writes = file => {
    const { permissions, jobs } = workflow(file);
    return [permissions, ...Object.values(jobs).map(each => each.permissions)].some(each => each?.actions === 'write');
  };
  for (const path of gatedWorkflows(fileURLToPath(WORKFLOWS))) assert.equal(writes(path.split('/').at(-1)), false, path);
  const { on, permissions, jobs } = workflow('stack.yml');
  assert.deepEqual(on.pull_request.types, ['opened', 'reopened', 'synchronize', 'edited', 'ready_for_review', 'closed']);
  assert.deepEqual(permissions, { contents: 'read' });
  assert.match(jobs.stack.if, /^github\.event\.pull_request\.head\.repo\.full_name == github\.repository &&/);
  assert.equal(jobs.stack.steps.at(-1).run, 'node .github/stack/stack.mjs --stop');
  assert.ok(readdirSync(WORKFLOWS).includes('stack.yml'));
});
