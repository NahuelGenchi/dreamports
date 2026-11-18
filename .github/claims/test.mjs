// Tests of where the claims workflow puts a new task (docs/TEAMS.md#how-the-bot-works): the script in
// .github/workflows/claims.yml itself, run as it is against a stand-in for GitHub, with this folder's src/lib as the
// default branch's. npm run check runs them. The games are made up.
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
const workflow = readFileSync(join(REPO, '.github', 'workflows', 'claims.yml'), 'utf8').split('\n');
const first = workflow.findIndex(line => line.trim() === 'node --input-type=module <<\'NODE\'');
const last = workflow.findIndex((line, index) => index > first && line.trim() === 'NODE');
const indent = workflow[first].length - workflow[first].trimStart().length;
const SCRIPT = workflow.slice(first + 1, last).map(line => line.slice(indent)).join('\n');

const folder = mkdtempSync(join(tmpdir(), 'claims-'));
after(() => rmSync(folder, { recursive: true, force: true }));

const game = name => `### Game\n\nOne\n\n### Game folder\n\n${name}\n\n### Console\n\nGame Boy Advance\n\n### Where it starts\n\nThe logos.\n`;
const task = name => `### Game folder\n\n${name}\n\n### Done when\n\nIt matches the original.\n`;
const milestone = { number: 1, title: 'One Dreamport' };

/**
 * A stand-in for GitHub's API with these issues and the default branch's files, as far as the workflow asks: `calls` is
 * every change it made. A request it has no answer for throws, so a test never passes on a guess.
 */
function github(issues, files) {
  const calls = [];
  const all = issues.map((issue, index) => ({
    id: 1000 + issue.number, url: `${ROOT}/issues/${issue.number}`, repository_url: ROOT, state: 'open', labels: [], assignees: [],
    milestone, user: { login: 'someone' }, created_at: `2026-01-0${index + 1}T00:00:00Z`, updated_at: `2026-01-0${index + 1}T00:00:00Z`, ...issue,
  }));
  const numbered = number => all.find(issue => issue.number === Number(number));
  const answer = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status });
  return {
    calls,
    issues: all,
    async fetch(url, { method = 'GET', body } = {}) {
      const { pathname, searchParams } = new URL(url);
      const path = pathname.slice(new URL(ROOT).pathname.length), sent = body ? JSON.parse(body) : undefined;
      if (method !== 'GET') calls.push(`${method} ${path}`);
      const found = /^\/issues\/(\d+)(\/\w+)?$/.exec(path), issue = found && numbered(found[1]);
      if (method === 'GET') {
        if (path.startsWith('/labels/')) return answer({});
        if (path === '/contents/games') return answer([...new Set(files.map(file => file.split('/')[1]))].map(name => ({ name, type: 'dir' })));
        if (path.startsWith('/contents/')) {
          const file = files.includes(path.slice('/contents/'.length));
          return file ? answer({ content: Buffer.from('---\ntitle: One Dreamport\nissue: 1\n---\n').toString('base64') }) : answer({}, 404);
        }
        if (path === '/pulls' || found?.[2] === '/comments') return answer([]);
        if (path === '/issues') {
          const label = searchParams.get('labels');
          return answer(all.filter(i => (searchParams.get('state') === 'all' || i.state === 'open') && (!label || i.labels.some(l => l.name === label))));
        }
        if (found?.[2] === '/sub_issues') return answer(all.filter(i => i.parent_issue_url === issue.url));
        if (found && !found[2]) return issue ? answer(issue) : answer({}, 404);
      }
      if (method === 'POST' && path === '/issues') {
        const made = { id: 2000 + all.length, number: all.length + 1, state: 'open', repository_url: ROOT, assignees: [], user: { login: 'github-actions[bot]' }, ...sent,
          labels: sent.labels.map(name => ({ name })), milestone: sent.milestone ? milestone : null };
        made.url = `${ROOT}/issues/${made.number}`;
        all.push(made);
        return answer(made, 201);
      }
      if (method === 'POST' && found?.[2] === '/sub_issues') {
        all.find(i => i.id === sent.sub_issue_id).parent_issue_url = issue.url;
        return answer(issue, 201);
      }
      if (method === 'POST' && found?.[2] === '/labels') {
        issue.labels.push(...sent.labels.map(name => ({ name })));
        return answer(issue.labels);
      }
      throw new Error(`The stand-in for GitHub has no answer for ${method} ${path}.`);
    },
  };
}

// one run of the workflow for a new issue, as GitHub starts it, and what it said it did
let runs = 0;
async function run(site, number) {
  const file = name => join(folder, `${runs}-${name}`);
  runs += 1;
  writeFileSync(file('event.json'), JSON.stringify({ issue: { number } }));
  writeFileSync(file('claims.mjs'), SCRIPT);
  Object.assign(process.env, {
    GITHUB_REPOSITORY: REPOSITORY, GITHUB_EVENT_PATH: file('event.json'), GITHUB_WORKSPACE: pathToFileURL(REPO).href, GH_TOKEN: 'none', DAYS: '14',
    GITHUB_STEP_SUMMARY: file('summary.md'), GITHUB_OUTPUT: file('output'),
  });
  const real = globalThis.fetch;
  globalThis.fetch = site.fetch;
  try {
    await import(pathToFileURL(file('claims.mjs')).href);
  } finally {
    globalThis.fetch = real;
  }
  return readFileSync(file('summary.md'), 'utf8');
}
const parentOf = (site, number) => Number(site.issues.find(i => i.number === number).parent_issue_url?.split('/').pop()) || null;

test('a task in C for a game with no files on main yet goes under the game\'s issue, as a new game starts in C (#1095)', async () => {
  const site = github([
    { number: 1, title: 'Dreamport: One', body: game('one'), labels: [{ name: 'new-dreamport' }, { name: 'one' }] },
    { number: 2, title: 'Task: The title screen in C', body: task('one') },
  ], []);
  const summary = await run(site, 2);
  assert.equal(parentOf(site, 2), 1, summary);
  assert.equal(site.issues.length, 2, 'no issue of its own for the game\'s tasks in C');
  assert.ok(!site.calls.includes('POST /issues'));
});

test('a task in C for a game that started in C goes under the game\'s issue', async () => {
  const site = github([
    { number: 1, title: 'Dreamport: One', body: game('one'), labels: [{ name: 'new-dreamport' }, { name: 'one' }] },
    { number: 2, title: 'Task: The title screen in C', body: task('one') },
  ], ['games/one/entry.md', 'games/one/c/index.html']);
  await run(site, 2);
  assert.equal(parentOf(site, 2), 1);
  assert.equal(site.issues.length, 2);
});

test('a game with a JavaScript version keeps its tasks in C under an issue of their own, and its JavaScript ones under its own (#905)', async () => {
  const site = github([
    { number: 1, title: 'Dreamport: One', body: game('one'), labels: [{ name: 'new-dreamport' }, { name: 'one' }] },
    { number: 2, title: 'Task: The title screen in C', body: task('one') },
    { number: 3, title: 'Task: The title screen', body: task('one') },
  ], ['games/one/entry.md', 'games/one/index.html', 'games/one/c/index.html']);
  await run(site, 2);
  const inC = site.issues.find(i => i.title === 'One Dreamport in C');
  assert.ok(inC, 'the issue for its tasks in C');
  assert.equal(parentOf(site, inC.number), 1);
  assert.equal(parentOf(site, 2), inC.number);
  await run(site, 3);
  assert.equal(parentOf(site, 3), 1);
});

// A game made a function at a time (#1473): its tasks of functions go under the issue of a stretch of its code, against
// the stand-in that keeps GitHub's limits on issues under issues (tools/test/stand-in/github.mjs).
const { BOT, MOST_UNDER, filesOf, github: standIn, newSite, runClaims } = await import('../../tools/test/stand-in/github.mjs');
const rules = await import('../../src/lib/pieces.mjs');
const address = number => number.toString(16).toUpperCase().padStart(8, '0');
const functions = (first, last = first) => ({ title: `Task: Function${last === first ? '' : 's'} ${address(first)}${last === first ? '' : ` to ${address(last)}`} in C`, body: task('one') });
const lead = { number: 1, title: 'Dreamport: One', body: game('one'), labels: [{ name: 'new-dreamport' }, { name: 'one' }], milestone };
const madeByFunctions = filesOf({ 'games/one/entry.md': '---\ntitle: One Dreamport\nissue: 1\n---\n', 'games/one/c/index.html': '', 'games/one/c/proof/proofs.json': '{}' });
const parent = (site, number) => site.issues.find(i => i.number === number).parent;
const titled = (site, title) => site.issues.find(i => i.title === title);

test('a task of functions of a version that keeps its proofs goes under its stretch\'s issue, under its version\'s issue (#1473)', async () => {
  const site = newSite([lead, { number: 2, ...functions(0x080001C4, 0x0800024C) }, { number: 3, ...functions(0x0801F000) }, { number: 4, ...functions(0x08000300, 0x08000400) }]);
  const summary = await runClaims(site, 2, folder, { files: madeByFunctions });
  const inC = titled(site, 'One Dreamport in C'), stretch = titled(site, 'One Dreamport in C, code 08000000 to 0800FFFF');
  assert.ok(inC && stretch, summary);
  assert.equal(parent(site, inC.number), 1, 'the version\'s issue is under the game\'s, though C is the game\'s main language');
  assert.equal(parent(site, stretch.number), inC.number);
  assert.equal(parent(site, 2), stretch.number);
  assert.deepEqual(rules.stretchOfIssue(stretch), { language: 'c', from: 0x08000000, to: 0x0800FFFF });
  assert.equal(rules.languageOfIssue(stretch), null, 'a stretch\'s issue isn\'t taken for a version\'s');
  assert.deepEqual([stretch.labels.map(l => l.name), stretch.milestone?.number], [['one'], milestone.number], 'with the game\'s label and milestone');
  await runClaims(site, 3, folder, { files: madeByFunctions });
  await runClaims(site, 4, folder, { files: madeByFunctions });
  const next = titled(site, 'One Dreamport in C, code 08010000 to 0801FFFF');
  assert.equal(parent(site, 3), next.number, 'another stretch has its own issue');
  assert.equal(parent(site, 4), stretch.number, 'and a second task of a stretch joins the first');
  assert.equal(site.issues.length, 7, 'one issue for the version and one for each stretch');
  assert.deepEqual(site.refused, []);
  // the tools, the bot and the Make pages all read a game's tasks this way
  const { request } = standIn(site, { files: madeByFunctions });
  const under = issue => request('GET', `/issues/${issue.number}/sub_issues?per_page=100`).body;
  assert.deepEqual((await rules.piecesUnder({ number: 1 }, under)).map(i => i.number), [2, 4, 3]);
  assert.deepEqual(rules.piecesUnderNow({ number: 1 }, under).map(i => i.number), [2, 4, 3]);
});

test('a task named after functions stays where every task goes in a version that keeps no proofs', async () => {
  const site = newSite([lead, { number: 2, ...functions(0x080001C4, 0x0800024C) }]);
  await runClaims(site, 2, folder, { files: filesOf({ 'games/one/entry.md': '---\ntitle: One Dreamport\nissue: 1\n---\n', 'games/one/c/index.html': '' }) });
  assert.equal(parent(site, 2), 1);
  assert.equal(site.issues.length, 2, 'no issue was opened for it');
});

test('a stretch with more tasks than an issue holds gets a second issue, and none is ever full past GitHub\'s limit', async () => {
  // 130 tasks of one stretch, the first 60 closed as they'd be once done, as closed ones count too
  const tasks = Array.from({ length: 130 }, (_, index) => ({ number: 2 + index, ...functions(0x08000100 + index * 0x40) }));
  const site = newSite([lead, ...tasks]);
  for (const [index, each] of tasks.entries()) {
    await runClaims(site, each.number, folder, { files: madeByFunctions });
    if (index < 60) site.issues.find(i => i.number === each.number).state = 'closed';
  }
  const first = titled(site, 'One Dreamport in C, code 08000000 to 0800FFFF'), second = titled(site, 'One Dreamport in C, code 08000000 to 0800FFFF, 2');
  assert.ok(first && second);
  const underOf = issue => site.issues.filter(i => i.parent === issue.number).length;
  assert.deepEqual([underOf(first), underOf(second)], [MOST_UNDER, 30]);
  assert.deepEqual(site.refused, [], 'GitHub never had to refuse one');
  assert.ok(tasks.every(each => [first.number, second.number].includes(parent(site, each.number))), 'every task has its home');
  const { request } = standIn(site, { files: madeByFunctions });
  const pieces = await rules.piecesUnder({ number: 1 }, issue => request('GET', `/issues/${issue.number}/sub_issues?per_page=100`).body);
  assert.equal(pieces.length, 130);
  assert.equal(rules.whatCanStart(pieces, {}, new Set(), { main: 'c' }).free.length, 70, 'the open ones are free, as the Make pages count them');
});

test('a task under a stretch\'s issue is claimed as any task, and the stretch\'s issue can\'t be', async () => {
  const site = newSite([lead, { number: 2, ...functions(0x080001C4, 0x0800024C) }]);
  await runClaims(site, 2, folder, { files: madeByFunctions });
  const stretch = titled(site, 'One Dreamport in C, code 08000000 to 0800FFFF');
  const { request } = standIn(site, { files: madeByFunctions });
  request('POST', '/issues/2/comments', { body: '/claim' }, 'pat');
  await runClaims(site, 2, folder, { files: madeByFunctions });
  assert.deepEqual(site.issues.find(i => i.number === 2).assignees, [{ login: 'pat' }]);
  request('POST', `/issues/${stretch.number}/comments`, { body: '/claim' }, 'pat');
  await runClaims(site, stretch.number, folder, { files: madeByFunctions });
  assert.deepEqual(stretch.assignees, []);
  assert.match(stretch.comments.find(c => c.user.login === BOT).body, /holds the tasks of a stretch of a game's code, each under it, and isn't a task itself/);
});
