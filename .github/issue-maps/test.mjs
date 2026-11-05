// Tests of what keeps each game's progress map in its game's issue (docs/TEAMS.md#how-the-bot-works), against a stand-in for
// GitHub and a made-up copy of the repository. npm run check runs them. The games are made up.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { checkRules } from '../moderation/rules.mjs';
import { field, isNewDreamport } from '../../tools/lib/claims.mjs';
import { mapOf, update, withMap } from './update.mjs';

const REPOSITORY = 'someone/dreamports';
const COMMIT = 'a'.repeat(40), NEWER = 'b'.repeat(40);
const form = game => `### Game\n\nOne\n\n### Game folder\n\n${game}\n\n### Console\n\nGame Boy Advance\n\n### Where it starts\n\nThe logos.\n\n### Your copy\n\n- [X] I have my own legal copy of the game.\n`;
const issue = (number, game, body = form(game)) => ({ number, body, labels: [{ name: 'new-dreamport' }] });
const folders = [];
after(() => folders.forEach(folder => rmSync(folder, { recursive: true, force: true })));

// a copy of the repository, with an entry naming each game's issue, and a map for each of `mapped`
function repo(issues, mapped = Object.keys(issues), title = 'One Dreamport’s progress. Code ported: 5.35%.') {
  const folder = mkdtempSync(join(tmpdir(), 'issue-maps-'));
  folders.push(folder);
  const write = (path, text) => {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  };
  for (const [game, number] of Object.entries(issues)) write(`games/${game}/entry.md`, `---\ntitle: One Dreamport\nissue: ${number}\nlead: someone\n---\n`);
  for (const game of mapped) write(mapOf(game), `<svg><title>${title}</title><g><title>Not this one</title></g></svg>`);
  return folder;
}

// GitHub, with these issues: what it answers, and which issues were edited
function github(issues, commit = COMMIT) {
  const patched = [];
  const api = async (path, method = 'GET', body) => {
    if (method === 'PATCH') {
      const number = Number(/^\/issues\/(\d+)$/.exec(path)[1]);
      issues.find(i => i.number === number).body = body.body;
      patched.push(number);
      return {};
    }
    if (path.startsWith('/issues?')) return /[?&]page=1(&|$)/.test(path) ? issues : [];
    if (path.startsWith('/commits?')) {
      assert.match(path, /[?&]path=\.github%2Freadme%2Fprogress%2F/);
      assert.match(path, /[?&]sha=head(&|$)/);
      return [{ sha: commit }];
    }
    throw new Error(`Nothing here answers ${method} ${path}`);
  };
  return { api, patched };
}
const run = (folder, api) => update({ folder, repository: REPOSITORY, head: 'head', api });

test('a game\'s map goes at the top of its issue, and every field can still be read', async () => {
  const one = issue(7, 'one');
  const { api } = github([one]);
  assert.deepEqual(await run(repo({ one: 7 }), api), [7]);
  assert.ok(one.body.startsWith(`<!-- dreamports-map -->\n\n![One Dreamport’s progress. Code ported: 5.35%.](https://raw.githubusercontent.com/${REPOSITORY}/${COMMIT}/.github/readme/progress/one.svg)\n\n<!-- /dreamports-map -->\n\n### Game\n`));
  assert.ok(isNewDreamport(one));
  assert.equal(field(one.body, 'Game'), 'One');
  assert.equal(field(one.body, 'Game folder'), 'one');
  assert.equal(field(one.body, 'Where it starts'), 'The logos.');
});

test('a second run changes nothing', async () => {
  const one = issue(7, 'one');
  const { api, patched } = github([one]);
  const folder = repo({ one: 7 });
  await run(folder, api);
  assert.deepEqual(await run(folder, api), []);
  assert.deepEqual(patched, [7]);
});

test('a new map is a new address, and the issue holds only the new one', async () => {
  const one = issue(7, 'one');
  const folder = repo({ one: 7 });
  await run(folder, github([one]).api);
  assert.deepEqual(await run(folder, github([one], NEWER).api), [7]);
  assert.ok(one.body.includes(`/${NEWER}/`));
  assert.ok(!one.body.includes(`/${COMMIT}/`));
  assert.equal(one.body.match(/dreamports-map -->/g).length, 2);
  assert.ok(one.body.endsWith(form('one')));
});

test('an issue the game\'s entry doesn\'t name shows no map, and loses one it wrote itself', async () => {
  const named = issue(7, 'one');
  const other = issue(8, 'one', withMap(form('one'), '![Copied](https://example.com/x.svg)'));
  const { api } = github([named, other]);
  assert.deepEqual(await run(repo({ one: 7 }), api), [7, 8]);
  assert.ok(named.body.includes('dreamports-map'));
  assert.equal(other.body, form('one'));
});

test('a game with no entry or no map yet is left as it is', async () => {
  const claimed = issue(7, 'claimed'), unmapped = issue(8, 'unmapped');
  const { api, patched } = github([claimed, unmapped]);
  assert.deepEqual(await run(repo({ unmapped: 8 }, []), api), []);
  assert.deepEqual(patched, []);
});

test('a folder that isn\'t a plain name is never looked for', async () => {
  const folder = repo({ one: 7 });
  const sneaky = issue(7, '../games/one'), task = { number: 9, body: '### Game folder\n\none\n\n### Done when\n\nIt runs.\n' };
  const { api, patched } = github([sneaky, task, { ...issue(10, 'one'), pull_request: {} }]);
  assert.deepEqual(await run(folder, api), []);
  assert.deepEqual(patched, []);
});

test('an edit in the browser, which turns the line ends into two characters, settles after one run', async () => {
  const one = issue(7, 'one');
  const folder = repo({ one: 7 });
  await run(folder, github([one]).api);
  one.body = one.body.replace(/\n/g, '\r\n');
  assert.deepEqual(await run(folder, github([one]).api), [7]);
  assert.deepEqual(await run(folder, github([one]).api), []);
  assert.ok(isNewDreamport(one));
});

test('a bracket in a game\'s title can\'t end the picture\'s description', async () => {
  const one = issue(7, 'one');
  await run(repo({ one: 7 }, ['one'], 'One [Two] Dreamport’s progress.'), github([one]).api);
  assert.ok(one.body.includes('![One \\[Two\\] Dreamport’s progress.](https://'));
});

test('the moderation bot has nothing to say about a person\'s edit of an issue with the map in it', async () => {
  const one = issue(7, 'one');
  await run(repo({ one: 7 }), github([one]).api);
  assert.deepEqual(checkRules(one.body, { author: 'someone', where: 'issue' }), { key: null, rule: null, hints: [] });
});

test('a copy of the repository with its issues turned off has nothing to do', async () => {
  assert.deepEqual(await run(repo({ one: 7 }), async () => null), []);
});
