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

test('says the first part is where a player starts', () => {
  assert.match(field(taskText('made-up', parts[0]), 'What it is'), /where a player starts/);
});
