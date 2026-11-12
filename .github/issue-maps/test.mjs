// Tests of what keeps each game's progress map in its game's issue (docs/TEAMS.md#how-the-bot-works), against a stand-in for
// GitHub and a made-up copy of the repository. npm run check runs them. The games are made up.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { checkRules } from '../moderation/rules.mjs';
import { field, isNewDreamport } from '../../tools/lib/claims.mjs';
import { REF, mapOf, update, withMap } from './update.mjs';

const REPOSITORY = 'someone/dreamports';
// the commits GitHub's stand-in makes under the maps' ref, in order
const commitNumber = n => String(n).padStart(40, 'c');
const COMMIT = commitNumber(1), NEWER = commitNumber(2);
const MAP = title => `<svg><title>${title}</title><g><title>Not this one</title></g></svg>`;
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
  for (const game of mapped) write(mapOf(game), MAP(title));
  return folder;
}

// GitHub, with these issues: what it answers, which issues were edited, and the commits under the maps' ref, the
// newest last, each with its files. `git` is a stand-in from an earlier run, to carry on from what it kept
function github(issues, git = { ref: null, commits: [], trees: new Map() }) {
  const patched = [];
  const commit = sha => git.commits.find(c => c.sha === sha);
  const api = async (path, method = 'GET', body) => {
    if (method === 'PATCH' && path.startsWith('/issues/')) {
      const number = Number(/^\/issues\/(\d+)$/.exec(path)[1]);
      issues.find(i => i.number === number).body = body.body;
      patched.push(number);
      return {};
    }
    if (path.startsWith('/issues?')) return /[?&]page=1(&|$)/.test(path) ? issues : [];
    if (path === `/git/ref/${REF.slice(5)}`) return git.ref && { object: { sha: git.ref } };
    if (path === '/git/trees' && method === 'POST') {
      for (const file of body.tree) assert.deepEqual([file.mode, file.type], ['100644', 'blob']);
      const files = Object.fromEntries(body.tree.map(file => [file.path, file.content]));
      const sha = JSON.stringify(files);
      git.trees.set(sha, files);
      return { sha };
    }
    if (path === '/git/commits' && method === 'POST') {
      assert.deepEqual(body.parents, git.ref ? [git.ref] : []);
      git.commits.push({ sha: commitNumber(git.commits.length + 1), tree: body.tree, message: body.message });
      return { sha: git.commits.at(-1).sha };
    }
    if (path.startsWith('/git/commits/')) return { tree: { sha: commit(path.slice('/git/commits/'.length)).tree } };
    if ((path === '/git/refs' && method === 'POST' && body.ref === REF && !git.ref) || (path === `/git/refs/${REF.slice(5)}` && method === 'PATCH' && git.ref)) {
      git.ref = body.sha;
      return {};
    }
    if (path.startsWith('/commits?')) {
      // the newest commit under the ref that changed this file, as GitHub answers
      const file = decodeURIComponent(/[?&]path=([^&]*)/.exec(path)[1]), from = /[?&]sha=([^&]*)/.exec(path)[1];
      assert.equal(from, git.ref, 'a picture is looked for under the maps\' ref');
      const text = at => git.trees.get(git.commits[at].tree)[file];
      let at = git.commits.length - 1;
      while (at > 0 && text(at - 1) === text(at)) at--;
      return [{ sha: git.commits[at].sha }];
    }
    throw new Error(`Nothing here answers ${method} ${path}`);
  };
  return { api, patched, git };
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

test('a game\'s version in C has its map first, once it has its page, and its JavaScript one is folded under it', async () => {
  const one = issue(7, 'one');
  const { api } = github([one]);
  const folder = repo({ one: 7 }, ['one', 'one/c'], 'One Dreamport’s progress in C. Code ported: 5.35% (10/187 bytes). Gameplay proven: 50% (1/2 parts).');
  assert.ok(one.body === form('one'));
  await run(folder, api);
  assert.ok(!one.body.includes('one-c.svg'), 'a map with no page for its version is left out');
  assert.ok(!one.body.includes('<details>'), 'a game\'s only map is never folded');
  mkdirSync(join(folder, 'games/one/c'), { recursive: true });
  writeFileSync(join(folder, 'games/one/c/index.html'), '');
  await run(folder, api);
  assert.match(one.body, /^<!-- dreamports-map -->\n\n!\[[^\]]*\]\([^)]*progress\/one-c\.svg\)\n\n<details>\n<summary>JavaScript version: code ported 5\.35%, gameplay proven 50%<\/summary>\n\n!\[[^\]]*\]\([^)]*progress\/one\.svg\)\n\n<\/details>\n\n<!-- \/dreamports-map -->\n\n### Game\n/);
  assert.equal(field(one.body, 'Game folder'), 'one');
  assert.deepEqual(await run(folder, api), [], 'and a second run changes nothing');
  assert.deepEqual(checkRules(one.body, { author: 'someone', where: 'issue' }), { key: null, rule: null, hints: [] });
});

test('a folded map with no numbers in its title, or only one, says what it has', async () => {
  for (const [title, summary] of [['One Dreamport’s progress.', 'JavaScript version'], ['One. Code ported: 100%. Gameplay proven: no list of parts yet.', 'JavaScript version: code ported 100%']]) {
    const one = issue(7, 'one');
    const folder = repo({ one: 7 }, ['one', 'one/c'], title);
    mkdirSync(join(folder, 'games/one/c'), { recursive: true });
    writeFileSync(join(folder, 'games/one/c/index.html'), '');
    await run(folder, github([one]).api);
    assert.ok(one.body.includes(`<summary>${summary}</summary>`));
  }
});

test('a game that started in C shows its version in C\'s map alone', async () => {
  const one = issue(7, 'one');
  const { api } = github([one]);
  const folder = repo({ one: 7 }, ['one/c']);
  mkdirSync(join(folder, 'games/one/c'), { recursive: true });
  writeFileSync(join(folder, 'games/one/c/index.html'), '');
  await run(folder, api);
  assert.match(one.body, /<!-- dreamports-map -->\n\n!\[[^\]]*\]\([^)]*progress\/one-c\.svg\)\n\n<!-- \/dreamports-map -->/);
  assert.ok(!one.body.includes('<details>'));
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
  const { git } = github([one]);
  await run(folder, github([one], git).api);
  writeFileSync(join(folder, mapOf('one')), MAP('One Dreamport’s progress. Code ported: 6%.'));
  assert.deepEqual(await run(folder, github([one], git).api), [7]);
  assert.ok(one.body.includes(`/${NEWER}/`));
  assert.ok(!one.body.includes(`/${COMMIT}/`));
  assert.equal(one.body.match(/dreamports-map -->/g).length, 2);
  assert.ok(one.body.endsWith(form('one')));
});

test('the maps are kept under a ref of their own, and only a game whose map changed has its issue edited', async () => {
  const one = issue(7, 'one'), two = issue(8, 'two');
  const folder = repo({ one: 7, two: 8 });
  const { api, patched, git } = github([one, two]);
  assert.deepEqual(await run(folder, api), [7, 8]);
  assert.equal(git.ref, COMMIT);
  assert.equal(git.commits[0].message, 'The progress maps of head');
  assert.deepEqual(Object.keys(git.trees.get(git.commits[0].tree)), [mapOf('one'), mapOf('two')]);
  assert.deepEqual(await run(folder, api), [], 'a run with the same maps edits nothing');
  assert.equal(git.commits.length, 1, 'and keeps nothing new');
  writeFileSync(join(folder, mapOf('two')), MAP('Two Dreamport’s progress. Code ported: 6%.'));
  assert.deepEqual(await run(folder, api), [8]);
  assert.equal(git.ref, NEWER);
  assert.ok(one.body.includes(`/${COMMIT}/${mapOf('one')}`), 'a map that didn\'t change keeps its address');
  assert.ok(two.body.includes(`![Two Dreamport’s progress. Code ported: 6%.](https://raw.githubusercontent.com/${REPOSITORY}/${NEWER}/${mapOf('two')})`));
  assert.deepEqual(patched, [7, 8, 8]);
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
  const { api, patched, git } = github([claimed, unmapped]);
  assert.deepEqual(await run(repo({ unmapped: 8 }, []), api), []);
  assert.deepEqual(patched, []);
  assert.equal(git.ref, null, 'and nothing is kept while no issue shows a map');
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
