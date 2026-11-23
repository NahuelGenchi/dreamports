// Tests of which milestone the tracking workflow gives a record (docs/TRACKING.md): the script in
// .github/workflows/project-tracking.yml itself, run as it is against a stand-in for GitHub. npm run check runs them.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPOSITORY = 'someone/dreamports';
const ROOT = `https://api.github.com/repos/${REPOSITORY}`;

// the workflow's script: what its step gives node, between the two NODE lines, without the step's indent
const workflow = readFileSync(join(REPO, '.github', 'workflows', 'project-tracking.yml'), 'utf8').split('\n');
const first = workflow.findIndex(line => line.trim() === 'node --input-type=module <<\'NODE\'');
const last = workflow.findIndex((line, index) => index > first && line.trim() === 'NODE');
const indent = workflow[first].length - workflow[first].trimStart().length;
const SCRIPT = workflow.slice(first + 1, last).map(line => line.slice(indent)).join('\n');

const folder = mkdtempSync(join(tmpdir(), 'tracking-'));
after(() => rmSync(folder, { recursive: true, force: true }));

// the milestones the workflow keeps, as its own list names them, and two more: a later M one and a game's
const kept = [...SCRIPT.matchAll(/^\s+M\d: \['(M\d — [^']+)'/gm)].map(match => match[1]);
const MILESTONES = [...kept, 'M8 — Lighter tools, on any console', 'M10 — Dreamports in more languages', 'One Dreamport'].map((title, at) => ({ number: at + 1, title }));
const numbered = title => MILESTONES.find(each => each.title === title).number;

/** A stand-in for GitHub's API with these issues and pull requests, as far as the workflow asks. A request it has no
 *  answer for throws, so a test never passes on a guess. */
function github(records) {
  const all = records.map(record => ({ state: 'open', labels: [], milestone: null, body: '', ...record, labels: (record.labels ?? []).map(name => ({ name })) }));
  const answer = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status });
  return {
    records: all,
    async fetch(url, { method = 'GET', body } = {}) {
      const { pathname, searchParams } = new URL(url);
      const path = pathname.slice(new URL(ROOT).pathname.length), sent = body ? JSON.parse(body) : undefined;
      const found = /^\/issues\/(\d+)(\/labels(?:\/([\w-]+))?)?$/.exec(path), record = found && all.find(each => each.number === Number(found[1]));
      const page = list => answer(searchParams.get('page') === '1' ? list : []);
      if (method === 'GET' && path === '/milestones') return page(MILESTONES);
      if (method === 'GET' && path === '/labels') return page(['documentation', 'research', 'implementation', 'bug', 'enhancement', 'operations', 'needs-tracking'].map(name => ({ name })));
      if (method === 'GET' && path === '/issues') return page(all.filter(each => searchParams.get('state') === 'all' || each.state === 'open'));
      if (method === 'GET' && found && !found[2]) return record ? answer(record) : answer({}, 404);
      if (method === 'PATCH' && record && !found[2]) {
        record.milestone = MILESTONES.find(each => each.number === sent.milestone);
        return answer(record);
      }
      if (method === 'POST' && record && found[2] === '/labels') {
        record.labels.push(...sent.labels.map(name => ({ name })));
        return answer(record.labels);
      }
      if (method === 'DELETE' && record && found[3]) {
        record.labels = record.labels.filter(label => label.name !== found[3]);
        return answer(null, 204);
      }
      throw new Error(`The stand-in for GitHub has no answer for ${method} ${path}.`);
    },
  };
}

// one run of the workflow, as GitHub starts it for a record, and each record as it left it
let runs = 0;
async function run(records) {
  const site = github(records), file = name => join(folder, `${runs}-${name}`);
  runs += 1;
  writeFileSync(file('event.json'), JSON.stringify({ issue: { number: records[0].number } }));
  writeFileSync(file('tracking.mjs'), SCRIPT);
  Object.assign(process.env, { GITHUB_REPOSITORY: REPOSITORY, GITHUB_EVENT_PATH: file('event.json'), GITHUB_EVENT_NAME: 'issues', GH_TOKEN: 'none', GITHUB_STEP_SUMMARY: file('summary.md') });
  const real = globalThis.fetch;
  globalThis.fetch = site.fetch;
  try {
    await import(pathToFileURL(file('tracking.mjs')).href);
  } finally {
    globalThis.fetch = real;
  }
  return number => {
    const record = site.records.find(each => each.number === number);
    return { milestone: record.milestone?.title ?? null, waits: record.labels.some(label => label.name === 'needs-tracking') };
  };
}

test('a record goes in the milestone its text names, by its whole name or its M number, whichever milestone that is', async () => {
  const of = await run([
    { number: 1, title: 'fix: one', body: '### Milestone\n\nM8 — Lighter tools, on any console\n' },
    { number: 2, title: 'fix: two', body: 'Milestone: One Dreamport\n' },
    { number: 3, title: 'fix: three', body: 'Milestone: M10\n' },
    { number: 4, title: 'fix: four', body: `Milestone: ${kept[1]}\n` },
    { number: 5, title: 'fix: five', body: 'Milestone: M1\n' },
  ]);
  assert.deepEqual(of(1), { milestone: 'M8 — Lighter tools, on any console', waits: false });
  assert.deepEqual(of(2), { milestone: 'One Dreamport', waits: false });
  assert.deepEqual(of(3), { milestone: 'M10 — Dreamports in more languages', waits: false });
  assert.deepEqual(of(4), { milestone: kept[1], waits: false });
  // M1 is M1, not M10
  assert.equal(numbered(of(5).milestone), numbered(kept[1]));
});

test('one that names none, or none there is, gets none and waits for someone to choose', async () => {
  const of = await run([
    { number: 1, title: 'fix: one', body: 'Nothing about it.' },
    { number: 2, title: 'fix: two', body: 'Milestone: Another Dreamport\n' },
    { number: 3, title: 'fix: three', body: 'Milestone: <same milestone as the primary issue; also set the GitHub sidebar>\n' },
    { number: 4, title: 'Task: a part', body: '### Game folder\n\none\n' },
  ]);
  assert.deepEqual(of(1), { milestone: null, waits: true });
  assert.deepEqual(of(2), { milestone: null, waits: true });
  assert.deepEqual(of(3), { milestone: null, waits: true });
  // a game's issue is the claims workflow's to place
  assert.deepEqual(of(4), { milestone: null, waits: false });
});

test('a pull request takes its issue\'s milestone, and one set by hand is kept and stops waiting', async () => {
  const game = MILESTONES.find(each => each.title === 'One Dreamport');
  const of = await run([
    { number: 1, title: 'feat: the kit', body: 'Milestone: One Dreamport\n' },
    { number: 2, title: 'feat: the kit (#1)', body: 'Closes #1\nMilestone: One Dreamport\n', pull_request: {} },
    { number: 3, title: 'fix: three', body: 'Nothing about it.', milestone: game, labels: ['needs-tracking'] },
  ]);
  assert.deepEqual(of(2), { milestone: 'One Dreamport', waits: false });
  assert.deepEqual(of(3), { milestone: 'One Dreamport', waits: false });
});
