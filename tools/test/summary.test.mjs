// A Dreamport's summary says something new, in few words (tools/readme.mjs).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summaryProblem } from '../readme.mjs';

test('a short summary without the name is fine', () => {
  assert.equal(summaryProblem('Sonic Battle Dreamport', 'Plays in your browser. No emulator, nothing to install.'), null);
});

test('a summary that names the game stops, whatever its capitals', () => {
  assert.match(summaryProblem('Sonic Battle Dreamport', 'SONIC BATTLE, in your browser.'), /name/);
  assert.match(summaryProblem("Crash Bandicoot Purple: Ripto's Rampage Dreamport", "Crash Bandicoot Purple: Ripto's Rampage, rebuilt."), /name/);
});

test('a long summary stops', () => {
  assert.match(summaryProblem('Sonic Battle Dreamport', 'x'.repeat(81)), /80/);
  assert.equal(summaryProblem('Sonic Battle Dreamport', 'x'.repeat(80)), null);
});
