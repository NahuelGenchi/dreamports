// Tests of what keeps dreamports.net up to date with main (docs/LIVE-SITE.md): what's wrong with a page's cards, when
// a build is asked for and when an issue opens, and a whole run against a stand-in for the site, Cloudflare and GitHub.
// npm run check runs them. The games are made up.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { problemsWith } from '../../src/lib/cards.mjs';
import { TITLE, liveProblems, run, watch } from './watch.mjs';

const made = (game, ported, gameplay, screen = true) => ({
  game,
  entry: { title: `${game} Dreamport`, ...(screen ? { screen: { clip: '/media/x' } } : {}) },
  proof: { ported: { percent: ported }, gameplay: gameplay === null ? null : { percent: gameplay } },
});
const meter = (label, text, width) => `<span class="meter"><span class="meter-head"><span>${label}</span><span class="meter-num">${text}</span></span><span class="meter-bar" aria-hidden="true"><i style="width: ${width}%"></i></span></span>`;
const card = (id, ported, gameplay) => `<dialog class="card view" id="${id}" data-card="x">${meter('Code ported', ported[0], ported[1])}<details><summary>${meter('Gameplay proven', gameplay[0], gameplay[1])}</summary></details></dialog>`;
const slot = (id, numbers) => `<a class="slot" href="/make/x/" data-card="make-${id}" data-title="x" data-numbers="${numbers}" draggable="false"></a>`;

// the pages of a made-up game at 5.35% and 10.53%, each with the launcher's other cards beside its own
const PAGES = {
  '/dreamports/one-dreamport/': card('inspect-one-dreamport', ['5%', 5.35], ['11%', 10.53]) + card('make-one-dreamport', ['1%', 1], ['1%', 1]),
  '/make/one/': card('inspect-one-dreamport', ['1%', 1], ['1%', 1]) + card('make-one-dreamport', ['5%', 5.35], ['11%', 10.53]),
  '/make/': slot('one-dreamport', 'Code ported 5% · Gameplay proven 11%'),
};
const reader = (pages = PAGES) => path => pages[path] ?? null;
const one = made('one', 5.35, 10.53);

test('pages that show what the proof makes have nothing wrong', async () => {
  assert.deepEqual(await problemsWith([one], reader()), []);
});

test('a card in the Make row showing old numbers is found, and the page and the number named', async () => {
  const stale = { ...PAGES, '/make/one/': card('make-one-dreamport', ['4%', 4.37], ['5%', 5.26]) };
  const problems = await problemsWith([one], reader(stale));
  assert.equal(problems.length, 2);
  assert.match(problems[0], /^\/make\/one\/: one Dreamport's card in the Make row shows Code ported 4% .*makes 5% \(5\.35%\)/);
  assert.match(problems[1], /Gameplay proven 5% .*makes 11% \(10\.53%\)/);
});

test('a card in the Dreamports row showing old numbers is found', async () => {
  const stale = { ...PAGES, '/dreamports/one-dreamport/': card('inspect-one-dreamport', ['4%', 4.37], ['11%', 10.53]) };
  const [problem, ...rest] = await problemsWith([one], reader(stale));
  assert.match(problem, /in the Dreamports row shows Code ported 4%/);
  assert.deepEqual(rest, []);
});

test('a bar that disagrees with its number is found, as a % can round the same', async () => {
  const stale = { ...PAGES, '/make/one/': card('make-one-dreamport', ['5%', 4.9], ['11%', 10.53]) };
  assert.match((await problemsWith([one], reader(stale)))[0], /its bar at 4\.9%/);
});

test('a place in the Make row with old numbers, or none, is found', async () => {
  const old = { ...PAGES, '/make/': slot('one-dreamport', 'Code ported 4% · Gameplay proven 5%') };
  assert.match((await problemsWith([one], reader(old)))[0], /says "Code ported 4% · Gameplay proven 5%"/);
  assert.match((await problemsWith([one], reader({ ...PAGES, '/make/': '' })))[0], /has no numbers in the Make row/);
});

test('a version in another language has its own numbers on the card, named by the language', async () => {
  const both = { ...one, versions: [{ language: 'c', proof: { ported: { percent: 2 }, gameplay: { percent: 0 } } }] };
  const withC = (ported, gameplay) => meter('Code ported in C', ...ported) + `<details><summary>${meter('Gameplay proven in C', ...gameplay)}</summary></details>`;
  const pages = Object.fromEntries(Object.entries(PAGES).map(([path, html]) => [path, html.replaceAll('</dialog>', `${withC(['2%', 2], ['0%', 0])}</dialog>`)]));
  assert.deepEqual(await problemsWith([both], reader(pages)), []);
  assert.match((await problemsWith([both], reader()))[0], /^\/dreamports\/one-dreamport\/: .* has no Code ported in C\.$/);
  const stale = { ...pages, '/make/one/': card('make-one-dreamport', ['5%', 5.35], ['11%', 10.53]).replace('</dialog>', `${withC(['1%', 1], ['0%', 0])}</dialog>`) };
  const [problem, ...rest] = await problemsWith([both], reader(stale));
  assert.match(problem, /in the Make row shows Code ported in C 1% .*makes 2% \(2%\)/);
  assert.deepEqual(rest, []);
});

test('a missing page or a card that isn\'t on it is found', async () => {
  const { '/make/one/': _, ...gone } = PAGES;
  assert.match((await problemsWith([one], reader(gone)))[0], /^\/make\/one\/: .* has no page/);
  assert.match((await problemsWith([one], reader({ ...PAGES, '/make/one/': '<p>' })))[0], /isn't on its page/);
});

test('only the cards a game has are looked for', async () => {
  // no code yet: only in the Make row
  const fresh = made('new', 0, 0);
  const pages = { '/make/new/': card('make-new-dreamport', ['0%', 0], ['0%', 0]), '/make/': slot('new-dreamport', 'Code ported 0% · Gameplay proven 0%') };
  assert.deepEqual(await problemsWith([fresh], reader(pages)), []);
  // no capture yet: not in the Make row
  const noCapture = made('bare', 5.35, 10.53, false);
  assert.deepEqual(await problemsWith([noCapture], reader({ '/dreamports/bare-dreamport/': card('inspect-bare-dreamport', ['5%', 5.35], ['11%', 10.53]) })), []);
  // every part proven: not in the Make row any more
  const done = made('done', 100, 100);
  assert.deepEqual(await problemsWith([done], reader({ '/dreamports/done-dreamport/': card('inspect-done-dreamport', ['100%', 100], ['100%', 100]) })), []);
});

test('a number not measured yet shows as that', async () => {
  const none = made('none', 5.35, null);
  const pages = {
    '/dreamports/none-dreamport/': card('inspect-none-dreamport', ['5%', 5.35], ['Not measured yet', 0]),
    '/make/none/': card('make-none-dreamport', ['5%', 5.35], ['Not measured yet', 0]),
    '/make/': slot('none-dreamport', 'Code ported 5% · Gameplay proven not measured yet'),
  };
  assert.deepEqual(await problemsWith([none], reader(pages)), []);
});

// a run of watch on a made-up clock, in minutes after the commit, with what the site shows at each moment
async function clocked({ start = 0, behindUntil = Infinity, committed = 0, last = false }) {
  let time = start;
  const asked = [];
  const found = await watch({
    minute: 1,
    committed,
    last,
    now: () => time,
    sleep: async (by) => { time += by; },
    problems: async () => (time >= behindUntil ? [] : ['behind']),
    ask: async () => asked.push(time),
  });
  return { found: found.length > 0, ended: time, asked };
}

test('a build that goes live in time means no request for another', async () => {
  assert.deepEqual(await clocked({ behindUntil: 5 }), { found: false, ended: 5, asked: [] });
});

test('a build that fails is asked for again, and the second going live ends it', async () => {
  assert.deepEqual(await clocked({ behindUntil: 15 }), { found: false, ended: 15, asked: [10] });
});

test('twenty minutes behind is as long as Cloudflare\'s builds get after a commit', async () => {
  assert.deepEqual(await clocked({}), { found: true, ended: 20, asked: [10] });
});

test('a later run that finds the site long behind asks at once, and looks for ten minutes', async () => {
  assert.deepEqual(await clocked({ start: 600 }), { found: true, ended: 610, asked: [600] });
  assert.deepEqual(await clocked({ start: 600, behindUntil: 605 }), { found: false, ended: 605, asked: [600] });
});

test('a later run soon after a commit still gives it its time', async () => {
  assert.deepEqual(await clocked({ start: 5 }), { found: true, ended: 20, asked: [10] });
  assert.deepEqual(await clocked({ start: 15 }), { found: true, ended: 25, asked: [15] });
});

test('the last look asks for nothing, and only waits a little', async () => {
  assert.deepEqual(await clocked({ start: 600, last: true }), { found: true, ended: 603, asked: [] });
  assert.deepEqual(await clocked({ start: 600, last: true, behindUntil: 601 }), { found: false, ended: 601, asked: [] });
});

// a stand-in for dreamports.net, its Deploy Hook and GitHub's API
async function standIn({ head, stale = 'old', buildsThatFail = 0 }) {
  const state = { commit: stale, hooks: 0, issues: [], comments: [], left: buildsThatFail };
  const server = createServer((request, response) => {
    let text = '';
    request.on('data', (part) => { text += part; });
    request.on('end', () => {
      const { pathname } = new URL(request.url, 'http://x');
      const send = (body, status = 200) => {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(typeof body === 'string' ? body : JSON.stringify(body));
      };
      if (pathname === '/hook') {
        assert.equal(request.method, 'POST');
        state.hooks++;
        if (state.left-- <= 0) state.commit = head;
        return send({});
      }
      if (pathname === '/build.json') return send({ commit: state.commit });
      if (pathname === '/repos/x/y/issues' && request.method === 'GET') return send(state.issues.filter(issue => issue.state === 'open'));
      if (pathname === '/repos/x/y/issues') {
        assert.equal(request.headers.authorization, 'Bearer made-up');
        const issue = { number: state.issues.length + 1, state: 'open', ...JSON.parse(text) };
        state.issues.push(issue);
        return send(issue);
      }
      const assign = /^\/repos\/x\/y\/issues\/(\d+)\/assignees$/.exec(pathname);
      if (assign) {
        if (state.unassignable) return send({}, 422);
        Object.assign(state.issues[Number(assign[1]) - 1], JSON.parse(text));
        return send({});
      }
      const comment = /^\/repos\/x\/y\/issues\/(\d+)\/comments$/.exec(pathname);
      if (comment) {
        state.comments.push(JSON.parse(text).body);
        return send({});
      }
      const patch = /^\/repos\/x\/y\/issues\/(\d+)$/.exec(pathname);
      if (patch) {
        Object.assign(state.issues[Number(patch[1]) - 1], JSON.parse(text));
        return send({});
      }
      if (PAGES[pathname]) {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        return response.end(PAGES[pathname]);
      }
      return send('', 404);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { state, url, close: () => server.close() };
}

const options = (stand, head, extra = {}) => ({
  site: stand.url,
  hook: `${stand.url}/hook`,
  head,
  list: [one],
  committed: Date.now() - 60 * 60_000,
  minute: 20,
  log: () => {},
  behind: () => { stand.state.behind = (stand.state.behind ?? 0) + 1; },
  github: { repository: 'x/y', api: stand.url, token: 'made-up', run: 'https://example.test/run' },
  ...extra,
});

test('a site behind main gets a build from the hook, and then shows nothing wrong, with no issue', async () => {
  const stand = await standIn({ head: 'new' });
  try {
    assert.equal(await run(options(stand, 'new')), true);
    assert.equal(stand.state.hooks, 1);
    assert.equal(stand.state.behind, undefined);
    assert.deepEqual(stand.state.issues, []);
    assert.deepEqual(await liveProblems(stand.url, 'new', [one]), []);
  } finally {
    stand.close();
  }
});

test('builds that keep failing are left for the workflow, which can put main live itself, with no issue yet', async () => {
  const stand = await standIn({ head: 'new', buildsThatFail: 99 });
  try {
    assert.equal(await run(options(stand, 'new')), true);
    assert.ok(stand.state.hooks >= 1);
    assert.equal(stand.state.behind, 1);
    assert.deepEqual(stand.state.issues, []);

    // what the workflow put live shows on the last look: no issue at all
    stand.state.commit = 'new';
    assert.equal(await run(options(stand, 'new', { last: true })), true);
    assert.deepEqual(stand.state.issues, []);
  } finally {
    stand.close();
  }
});

test('a site still behind on the last look opens one issue, which says what it found, and no more after it', async () => {
  const stand = await standIn({ head: 'new-commit', stale: 'old-commit', buildsThatFail: 99 });
  try {
    const hooks = stand.state.hooks;
    assert.equal(await run(options(stand, 'new-commit', { last: true })), false);
    assert.equal(stand.state.hooks, hooks);
    assert.equal(stand.state.issues.length, 1);
    const [issue] = stand.state.issues;
    assert.equal(issue.title, TITLE);
    assert.deepEqual(issue.labels, ['bug']);
    assert.deepEqual(issue.assignees, ['x']);
    assert.match(issue.body, /built from old-com.*main is at new-com/);
    assert.match(issue.body, /https:\/\/example\.test\/run/);

    // the next runs: still behind, the same issue, and no second failure to mail anyone about
    assert.equal(await run(options(stand, 'new-commit', { last: true })), true);
    assert.equal(stand.state.issues.length, 1);

    // Cloudflare recovers: the issue closes itself, with a word to say so
    stand.state.left = 0;
    assert.equal(await run(options(stand, 'new-commit')), true);
    assert.equal(stand.state.issues[0].state, 'closed');
    assert.equal(stand.state.issues[0].state_reason, 'completed');
    assert.match(stand.state.comments[0], /up to date/);
  } finally {
    stand.close();
  }
});

test('an issue opens even when its owner can\'t be assigned', async () => {
  const stand = await standIn({ head: 'new', buildsThatFail: 99 });
  stand.state.unassignable = true;
  try {
    assert.equal(await run(options(stand, 'new', { last: true })), false);
    assert.equal(stand.state.issues.length, 1);
    assert.equal(stand.state.issues[0].assignees, undefined);
  } finally {
    stand.close();
  }
});

test('a site at the right commit that shows the wrong numbers is still behind', async () => {
  const stand = await standIn({ head: 'same', stale: 'same' });
  try {
    const wrong = made('one', 40.26, 13.89);
    const found = await liveProblems(stand.url, 'same', [wrong]);
    assert.ok(found.some(problem => /Code ported 5% .*makes 40%/.test(problem)));
  } finally {
    stand.close();
  }
});

test('a site that doesn\'t answer, or a build with no commit, counts as behind', async () => {
  const found = await liveProblems('http://127.0.0.1:9', 'abcdef1234', [one]);
  assert.match(found[0], /built from a commit it doesn't name, and main is at abcdef1/);
});

test('without a Deploy Hook it says so, and doesn\'t stop', async () => {
  const stand = await standIn({ head: 'new', buildsThatFail: 99 });
  const said = [];
  try {
    assert.equal(await run(options(stand, 'new', { hook: undefined, log: line => said.push(line) })), true);
    assert.ok(said.some(line => /no CLOUDFLARE_DEPLOY_HOOK secret/.test(line)));
    assert.equal(stand.state.hooks, 0);
    assert.equal(stand.state.behind, 1);
  } finally {
    stand.close();
  }
});
