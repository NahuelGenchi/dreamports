// What `npm run dp -- tasks` opens: which parts need a task, and text the claims workflow can read.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { field } from '../lib/claims.mjs';
import { missingParts, taskText } from '../tasks.mjs';

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
