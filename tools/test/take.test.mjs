// Which task someone takes next (lib/take.mjs), by /dreamport's rules.
// Run with: node --test tools/test/take.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { pieceNamed, whatToTake } from '../lib/take.mjs';

let next = 100;
const task = (title, { by = [], state = 'open' } = {}) => ({ number: next++, title: `Task: ${title}`, state, assignees: by.map(login => ({ login })) });
// a game with both versions, where everything is free unless said
const game = () => {
  const logos = task('The logos in C'), title = task('Title screen in C'), options = task('The Options menu in C');
  const jsTitle = task('Title screen'), jsOptions = task('The Options menu');
  return { logos, title, options, jsTitle, jsOptions, pieces: [logos, title, options, jsTitle, jsOptions] };
};
const ask = (g, given = {}) => whatToTake({
  pieces: g.pieces, free: g.pieces.filter(p => p.state === 'open' && !p.assignees.length), waiting: [], reviewing: new Map(), login: 'sam', language: 'c',
  has: () => true, missing: () => 0, ...given,
});

test('with nothing asked, the first free one in C', () => {
  const g = game();
  assert.deepEqual(ask(g), { do: 'take', piece: g.logos, notes: [] });
});

test('one they have already comes before a free one, in the language asked for first', () => {
  const g = game();
  g.jsTitle.assignees = [{ login: 'Sam' }];
  assert.equal(ask(g).do, 'carry-on');
  assert.equal(ask(g).piece, g.jsTitle);
  g.options.assignees = [{ login: 'sam' }];
  assert.equal(ask(g).piece, g.options);
  assert.equal(ask(g, { language: 'js' }).piece, g.jsTitle);
});

test('theirs that a pull request has in review is finished, so they take the next', () => {
  const g = game();
  g.logos.assignees = [{ login: 'sam' }];
  const found = ask(g, { reviewing: new Map([[g.logos.number, 900]]), free: [g.title, g.options, g.jsTitle, g.jsOptions] });
  assert.deepEqual([found.do, found.piece], ['take', g.title]);
});

test('the piece they named, by its words or its number, in the language asked for', () => {
  const g = game();
  assert.equal(ask(g, { named: 'the options' }).piece, g.options);
  assert.equal(ask(g, { named: 'options menu', language: 'js' }).piece, g.jsOptions);
  assert.equal(ask(g, { named: `#${g.jsTitle.number}` }).piece, g.jsTitle);
  assert.equal(ask(g, { named: String(g.title.number) }).piece, g.title);
  assert.equal(pieceNamed(g.pieces, 'Title Screen', 'c'), g.title);
  assert.equal(pieceNamed(g.pieces, 'the', 'c'), null);
});

test('a named piece that is theirs is carried on with, even when another of theirs comes first', () => {
  const g = game();
  g.logos.assignees = [{ login: 'sam' }];
  g.options.assignees = [{ login: 'sam' }];
  assert.deepEqual([ask(g, { named: 'options' }).do, ask(g, { named: 'options' }).piece], ['carry-on', g.options]);
});

test('a named piece that waits gives the first of what it needs that is free', () => {
  const g = game();
  const found = ask(g, { named: 'options', free: [g.logos, g.title, g.jsTitle, g.jsOptions], waiting: [{ piece: g.options, on: [{ name: 'Fonts in C' }, { name: 'Title screen in C', number: g.title.number }] }] });
  assert.deepEqual([found.do, found.piece], ['take', g.title]);
  assert.match(found.notes[0], /The Options menu in C waits on it/);
});

test('a named piece nobody can take says why, and the next rule decides', () => {
  const g = game();
  g.options.assignees = [{ login: 'alex' }];
  const taken = ask(g, { named: 'options' });
  assert.deepEqual([taken.do, taken.piece], ['take', g.logos]);
  assert.match(taken.notes[0], /is @alex's/);
  const unknown = ask(g, { named: 'the credits' });
  assert.equal(unknown.piece, g.logos);
  assert.match(unknown.notes[0], /No open task goes by "the credits"/);
  const waits = ask(g, { named: 'title', free: [g.logos, g.options, g.jsTitle, g.jsOptions], waiting: [{ piece: g.title, on: [{ name: 'Fonts in C' }] }] });
  assert.match(waits.notes[0], /waits on Fonts in C, and none of that is free/);
});

test('nothing free in C: its version is started, or its tasks opened, before anything else', () => {
  const g = game();
  const none = g.pieces.filter(p => !/ in C$/.test(p.title));
  assert.deepEqual(ask(g, { free: none, has: language => language === 'js' }), { do: 'start-version', language: 'c', notes: [] });
  assert.deepEqual(ask(g, { free: none, missing: language => (language === 'c' ? 4 : 0) }), { do: 'open-tasks', language: 'c', notes: [] });
});

test('nothing free in C and nothing to open: the first in JavaScript, unless they named C', () => {
  const g = game();
  const none = g.pieces.filter(p => !/ in C$/.test(p.title));
  const found = ask(g, { free: none });
  assert.deepEqual([found.do, found.piece], ['take', g.jsTitle]);
  assert.match(found.notes[0], /Nothing is free in C/);
  assert.deepEqual(ask(g, { free: none, languageNamed: true }), { do: 'stop', notes: [] });
});

test('nothing free at all stops, and JavaScript never falls back to C', () => {
  const g = game();
  assert.deepEqual(ask(g, { free: [] }), { do: 'stop', notes: [] });
  assert.deepEqual(ask(g, { free: g.pieces.filter(p => / in C$/.test(p.title)), language: 'js', languageNamed: true }), { do: 'stop', notes: [] });
  assert.deepEqual(ask(g, { free: [], language: 'js', missing: () => 2 }), { do: 'open-tasks', language: 'js', notes: [] });
});

test('nobody signed in has nothing of their own', () => {
  const g = game();
  g.logos.assignees = [{ login: 'sam' }];
  const found = ask(g, { login: null, free: [g.title, g.options, g.jsTitle, g.jsOptions] });
  assert.deepEqual([found.do, found.piece], ['take', g.title]);
});
