// The pull request's text share writes (lib/pull-request.mjs).
// Run with: node --test tools/test/pull-request.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { issueOfBranch, numberLines, pullRequestText, unfilled } from '../lib/pull-request.mjs';

const TEMPLATE = readFileSync(new URL('../../.github/pull_request_template.md', import.meta.url), 'utf8');
const CLIPS = '[![a frame of the clip](https://someone.github.io/dreamports/clips/walk/still.png)](https://someone.github.io/dreamports/clips/walk/clip.mp4)\n\n[Watch the clip](https://someone.github.io/dreamports/clips/walk/clip.mp4)';
const KNOWN = {
  issue: 741, milestone: 'Walk Dreamport', branch: 'feat/741-the-late-room', buildsOn: [730], about: 'The late room plays.', clips: CLIPS,
  numbers: { ported: 'Code ported in C: 10% → 15%', gameplay: 'Gameplay proven in C: 0%, 0 of 2 parts → 50%, 1 of 2 parts, adding The late room' },
  notes: ['The room counts from a black frame.'], preview: 'https://someone.github.io/dreamports/walk-late-room/',
};

test('a branch names its issue', () => {
  assert.equal(issueOfBranch('feat/741-ice-mountain-act-2'), 741);
  assert.equal(issueOfBranch('enh/12-x'), 12);
  assert.equal(issueOfBranch('claude/some-words'), null);
  assert.equal(issueOfBranch('main'), null);
});

test('what the tools know is filled in, and the rest keeps the template\'s words', () => {
  const text = pullRequestText(TEMPLATE, KNOWN);
  for (const line of ['Closes #741', 'Builds on #730', 'Milestone: Walk Dreamport', 'Branch: feat/741-the-late-room, new from the latest main and used only for this issue',
    'The late room plays.', KNOWN.numbers.ported, KNOWN.numbers.gameplay, 'Notes: "The room counts from a black frame."', `Preview: ${KNOWN.preview}`]) {
    assert.ok(text.split('\n').includes(line), line);
  }
  assert.ok(text.includes(`Clips:\n\n${CLIPS}\n\nCode ported in C:`));
  assert.ok(!text.includes('<!--'));
  assert.deepEqual(unfilled(text).map(line => line.split(':')[0]), ['Sources', 'Start points', 'Site build', 'Browser checks', 'Source/diff review', '<what still differs, what wasn\'t checked and what follows, or None when that\'s true>']);
});

test('what isn\'t known stays to fill in', () => {
  const text = pullRequestText(TEMPLATE, { clips: '', notes: [] });
  assert.ok(unfilled(text).includes('Closes #<issue-number>'));
  assert.ok(text.includes('Clips: none'));
  assert.ok(text.includes('Notes: none'));
  assert.ok(unfilled(text).some(line => line.startsWith('Milestone: <')));
  assert.ok(unfilled(text).some(line => line.startsWith('Code ported: <')));
});

test('a text filled in before keeps what someone wrote, with the tools\' lines written again', () => {
  const first = pullRequestText(TEMPLATE, KNOWN);
  const filled = first.replace(/^Sources: .*$/m, 'Sources: the game\'s decompilation (no license), read as a guide; no code came in')
    .replace(/^Site build: .*$/m, 'Site build: `npm run dp -- ready walk/c`, passed').replace('The late room plays.', 'The late room plays, with its door.');
  const again = pullRequestText(TEMPLATE, { ...KNOWN, about: 'Other words.', clips: `${CLIPS}\n\n[Watch the second clip](https://someone.github.io/dreamports/clips/walk/two.mp4)`,
    numbers: { ported: 'Code ported in C: 10% → 20%', gameplay: KNOWN.numbers.gameplay }, notes: [], preview: 'https://someone.github.io/dreamports/walk-late-room-2/' }, filled);
  assert.ok(again.includes('Sources: the game\'s decompilation (no license), read as a guide; no code came in'));
  assert.ok(again.includes('Site build: `npm run dp -- ready walk/c`, passed'));
  assert.ok(again.includes('The late room plays, with its door.'));
  assert.ok(!again.includes('Other words.'));
  assert.ok(again.includes('Code ported in C: 10% → 20%'));
  assert.ok(!again.includes('Code ported in C: 10% → 15%'));
  assert.ok(again.includes('Watch the second clip'));
  assert.equal(again.split('Watch the clip').length, 2);
  assert.ok(again.includes('Notes: none'));
  assert.ok(again.includes('Preview: https://someone.github.io/dreamports/walk-late-room-2/'));
  assert.ok(again.includes('Closes #741'));
});

test('the numbers, before and after, name the language and the parts added', () => {
  const proof = (functions, proven) => ({
    ported: { percent: functions * 5, functions }, codeMap: { functions: 2238 },
    gameplay: { percent: proven.length * 50, proven: proven.length, total: 2, parts: ['The walk', 'The late room'].map(name => ({ name, proven: proven.includes(name) })) },
  });
  const lines = numberLines('walk/c', proof(2, ['The walk']), proof(3, ['The walk', 'The late room']));
  assert.equal(lines.ported, 'Code ported in C: 10% → 15%');
  assert.equal(lines.gameplay, 'Gameplay proven in C: 50%, 1 of 2 parts → 100%, 2 of 2 parts, adding The late room');
  assert.equal(numberLines('walk', null, proof(1, [])).ported, 'Code ported: not measured yet → 5%');
});

test('a line with words in angle brackets that someone wrote isn\'t one to fill in', () => {
  assert.deepEqual(unfilled('Sources: none\nIt reads <game>/c and `a < b`.\nSite build: not run'), []);
});
