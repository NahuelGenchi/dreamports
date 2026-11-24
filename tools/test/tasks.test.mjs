// What `npm run dp -- tasks` opens: which parts need a task, and text the claims workflow can read.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { field } from '../lib/claims.mjs';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { holdGame, leftoverText, missingParts, startsByFunction, startsByPart, taskText, taskTitled, keepTaking } from '../tasks.mjs';
import { leftoverPieces } from '../lib/played.mjs';

const parts = [
  { name: 'The logos', recording: 'logos', frames: [0, 389] },
  { name: 'The intro' },
  { name: 'The title screen' },
  { name: 'The main menu' },
];

test('leaves out a part with a recording, and one with a piece, open or closed, whatever its capitals', () => {
  const pieces = [{ title: 'Task: the intro', state: 'closed' }, { title: 'The title screen', state: 'open' }];
  assert.deepEqual(missingParts(parts, pieces).map(p => p.name), ['The main menu']);
});

test('a new version in C starts a function at a time on every console whose functions\' proofs the tools keep', () => {
  for (const console of ['gba', 'nes', 'snes', 'ps1', 'ps2']) assert.equal(startsByFunction(console, 'c', []), true, console);
  for (const console of ['n64', 'gb', 'gbc', 'md', 'psp', 'made-up']) assert.equal(startsByFunction(console, 'c', []), false, console);
  // a version with a task already, open or closed, stays as it is, and another language's tasks aren't its own
  assert.equal(startsByFunction('ps2', 'c', [{ title: 'Task: The main menu in C', state: 'closed' }]), false);
  assert.equal(startsByFunction('ps2', 'c', [{ title: 'Task: The main menu', state: 'open' }]), true);
  assert.equal(startsByFunction('ps2', 'js', []), false);
});

test('a new version that keeps its proofs takes its game\'s parts for tasks before its first one', () => {
  const listed = [{ name: 'The logos' }], kept = { original: 'a'.repeat(40), parts: new Map() };
  assert.equal(startsByPart(listed, null, 'c', []), true);
  // once the game keeps what each part runs, with a task already, or with no parts listed, it's as it was
  assert.equal(startsByPart(listed, kept, 'c', []), false);
  assert.equal(startsByPart(listed, null, 'c', [{ title: 'Task: Functions 08000200 to 08000380 in C', state: 'closed' }]), false);
  assert.equal(startsByPart(listed, null, 'c', [{ title: 'Task: The logos', state: 'open' }]), true, 'another language\'s task');
  assert.equal(startsByPart([], null, 'c', []), false);
});

test('needs nothing when every part has its task', () => {
  const pieces = parts.map(p => ({ title: `Task: ${p.name}` }));
  assert.deepEqual(missingParts(parts, pieces), []);
});

test('writes a task the claims workflow reads by its headings, free for anyone to claim', () => {
  const text = taskText('made-up', parts[2], { name: 'The intro', number: 7 });
  assert.equal(field(text, 'Game folder'), 'made-up');
  assert.equal(field(text, 'Kind'), 'Something else');
  assert.match(field(text, 'What it is'), /The title screen.*right after The intro \(#7\)/);
  assert.match(field(text, 'Done when'), /npm run dp -- prove made-up/);
  assert.equal(field(text, 'Taking it'), '- [ ] I\'m taking this task myself.');
  assert.equal(field(text, 'Where it starts'), null);
});

test('writes a foundation under its own kind, with what it is, and leaves the player\'s order out of it', () => {
  const text = taskText('made-up', { name: 'The fighting', foundation: true, what: 'Two fighters in an arena.' });
  assert.equal(field(text, 'Kind'), 'Foundation');
  assert.equal(field(text, 'What it is'), 'The fighting, which other pieces of the game need. Two fighters in an arena.');
  assert.match(field(text, 'Done when'), /npm run dp -- prove made-up/);
  assert.equal(field(taskText('made-up', { name: 'The fighting', foundation: true, done: 'It fights.' }), 'Done when'), 'It fights.');
});

test('says what a piece needs, with its number once it has one', () => {
  const text = taskText('made-up', parts[3], { name: 'The title screen', number: 8 }, [{ name: 'The fighting', number: 9 }, { name: 'The arena' }]);
  assert.match(field(text, 'What it is'), /right after The title screen \(#8\)\. It needs The fighting \(#9\) and The arena first\.$/);
});

test('says the first part is where a player starts', () => {
  assert.match(field(taskText('made-up', parts[0]), 'What it is'), /where a player starts/);
});

test('a version in C needs a task for every part it hasn\'t proven, recorded in JavaScript or not', () => {
  const pieces = [{ title: 'Task: The intro' }, { title: 'Task: The title screen in C' }];
  assert.deepEqual(missingParts(parts, pieces, 'c').map(p => p.name), ['The logos', 'The intro', 'The main menu']);
  assert.deepEqual(missingParts(parts, pieces, 'c', new Set(['the logos'])).map(p => p.name), ['The intro', 'The main menu']);
  assert.deepEqual(missingParts(parts, pieces).map(p => p.name), ['The title screen', 'The main menu'], 'a task in C is no task in JavaScript');
});

test('a task in C keeps the game\'s folder, and is proven with its version', () => {
  const text = taskText('made-up/c', parts[2], { name: 'The intro in C', number: 7 }, [{ name: 'The fighting in C' }]);
  assert.equal(field(text, 'Game folder'), 'made-up');
  assert.match(field(text, 'What it is'), /^The title screen in C, .* right after The intro in C \(#7\)\. It needs The fighting in C first\. .*games\/made-up\/c\//);
  assert.match(field(text, 'Done when'), /npm run dp -- prove made-up\/c` shows the part as proven/);
});

test('a game that started in C opens its tasks in C as a game\'s own, written from the original', () => {
  const pieces = [{ title: 'Task: The intro in C' }, { title: 'Task: The title screen' }];
  assert.deepEqual(missingParts(parts, pieces, 'c', new Set(), 'c').map(p => p.name), ['The title screen', 'The main menu'], 'a part parts.json proves needs no task');
  const text = taskText('made-up/c', parts[2], { name: 'The intro in C', number: 7 }, [], 'c');
  assert.equal(field(text, 'Game folder'), 'made-up');
  assert.match(field(text, 'What it is'), /^The title screen, one of the game's parts\. It comes right after The intro in C \(#7\)\. It's written in `games\/made-up\/c\/` from the original\.$/);
  assert.doesNotMatch(text, /JavaScript/);
  assert.match(field(text, 'Done when'), /npm run dp -- prove made-up\/c` shows the part as proven\. Its place in `games\/made-up\/proof\/parts\.json`/);
});

test('one run opens a game\'s tasks at a time, and takes over from a run that has ended', () => {
  const folder = mkdtempSync(join(tmpdir(), 'dp-tasks-'));
  try {
    const release = holdGame('made-up', folder);
    assert.throws(() => holdGame('made-up', folder), /Another run is opening made-up's tasks already \(process \d+\)/);
    const other = holdGame('other-game', folder);
    other();
    release();
    assert.equal(existsSync(join(folder, 'made-up.lock')), false);
    writeFileSync(join(folder, 'made-up.lock'), '2147483646');
    holdGame('made-up', folder)();
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('finds a task already open under its title, and leaves closed ones and pull requests out', () => {
  const issues = [
    { number: 3, title: 'Task: The intro in C', state: 'closed', body: '### Game folder\n\nsonic-battle' },
    { number: 4, title: 'Task: The intro in C', pull_request: {}, body: '### Game folder\n\nsonic-battle' },
    { number: 5, title: 'task: the intro in c ', state: 'open', body: '### Game folder\n\nsonic-battle\n\n### Kind\n\nPart' },
  ];
  assert.equal(taskTitled(issues, 'Task: The intro in C', 'sonic-battle')?.number, 5);
  assert.equal(taskTitled(issues, 'Task: The intro', 'sonic-battle'), undefined);
});

test('another game\'s task of the same title isn\'t this game\'s, and a label names the game too (#837)', () => {
  const issues = [
    { number: 6, title: 'Task: Time Attack in C', state: 'open', body: '### Game folder\n\nsonic-advance\n\n### Kind\n\nPart', labels: [{ name: 'sonic-advance' }] },
    { number: 7, title: 'Task: Time Attack', state: 'open', body: 'Made before the forms.', labels: [{ name: 'sonic-advance-2' }] },
  ];
  assert.equal(taskTitled(issues, 'Task: Time Attack in C', 'sonic-advance-2'), undefined);
  assert.equal(taskTitled(issues, 'Task: Time Attack in C', 'sonic-advance')?.number, 6);
  assert.equal(taskTitled(issues, 'Task: Time Attack', 'sonic-advance-2')?.number, 7);
});

test('a task in C is written from the original and waits for nothing in JavaScript (#965)', () => {
  const text = taskText('sonic-battle/c', { name: 'The menu', needs: [] }, { name: 'The logos in C', number: 15 }, [], 'js');
  assert.match(text, /from the original, as every version is/);
  assert.match(text, /never waiting for it/);
  assert.doesNotMatch(text, /finished for it first/);
  assert.match(text, /shows the part as proven in C/);
});

test('what\'s left of a version becomes pieces: by the part that reaches it, shared code and code never played by where they are', () => {
  const parts = [{ name: 'The title', recording: 'title' }, { name: 'Act 1', recording: 'act-1' }, { name: 'Act 2', recording: 'act-2' }, { name: 'The ending', recording: 'ending' }];
  const ran = { title: ['08000100', '08010000'], 'act-1': ['08000100', '08020000', '08020400'], 'act-2': ['08000100', '08020000'], ending: ['08000100'] };
  const f = (key, total, played, ways = []) => ({ key, address: parseInt(key, 16), size: 64, total, played, never: played === 0, ways });
  const pieces = leftoverPieces([
    f('08000100', 50, 40),                                   // every part's recording ran it
    f('08020000', 30, 10, [[0x08020010, 'taken']]),          // act 1's first, and act 2's
    f('08020400', 20, 19),
    f('08010000', 10, 9),
    f('08031000', 40, 0), f('08032000', 80, 0),              // never played
  ], parts, ran);
  assert.deepEqual(pieces.map(p => [p.name, p.recording, p.functions.map(each => each.key)]), [
    ["What's left of The title", 'title', ['08010000']],
    ["What's left of Act 1", 'act-1', ['08020000', '08020400']],
    ["What's left of the code the parts share around 08000000", 'title', ['08000100']],
    ['Code never played around 08030000', null, ['08032000', '08031000']],
  ]);

  const text = leftoverText('made-up/c', pieces[1]);
  assert.match(text, /^### Game folder\n\nmade-up\n/);
  assert.match(text, /- `08020000`: 20 of 30 to play; to play: `08020010` taken/);
  assert.match(text, /npm run dp -- route made-up\/c <name> --from act-1 --goal untouched/);
  assert.match(text, /### Done when\n\n`npm run dp -- untouched made-up\/c --all` no longer lists these functions/);
  assert.match(leftoverText('made-up/c', pieces[3]), /- `08032000`: never played, 80 instructions and branch ways\n- `08031000`/);

  // with what untouched --sort found, each branch says what it tests, and the piece how many are of each kind
  const sorted = new Map([[0x08020010, { kind: 'same', held: [[0, 4]], sides: [{ address: 0x0300505C, bytes: 1, held: [0], against: [4] }] }]]);
  const told = leftoverText('made-up/c', pieces[1], sorted);
  assert.match(told, /`08020010` taken \(never differed: the byte at `0300505C` held 0 against 4\)/);
  assert.match(told, /Of its branches gone one way only, as `npm run dp -- untouched made-up\/c --sort` found them: 1 compare something that never differed in any recording/);
  assert.equal(leftoverText('made-up/c', pieces[1], new Map()), text, 'a branch it didn\'t sort says nothing more');
  // written again, a task keeps what it says of who took it
  const taken = text.replace("- [ ] I'm taking this task myself.", "- [x] I'm taking this task myself.\n\nTaken by someone.");
  assert.ok(keepTaking(told, taken).endsWith("- [x] I'm taking this task myself.\n\nTaken by someone."));
  assert.ok(keepTaking(told, taken).startsWith(told.slice(0, told.indexOf('### Taking it'))));
  assert.equal(keepTaking(told, 'a text with no such part'), told);
});
