// "Nothing that matched before differs" (lib/as-before.mjs): which frames newly differ, which recordings came out
// worse, and what "before" is, on a made-up repository with a real merge. npm run check runs them.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { newlyDiffering, provenBefore, worseThan } from '../lib/as-before.mjs';

const row = (frames, differs = [], more = {}) => ({ frames, matched: frames - differs.reduce((sum, [from, to]) => sum + to - from + 1, 0), differs, functions: [], ...more });

test('frames that differ as they did are nothing new', () => {
  assert.deepEqual(newlyDiffering(row(100, [[40, 99]]), row(100, [[40, 99]])), []);
  assert.deepEqual(newlyDiffering(row(100, [[40, 99]]), row(100, [[60, 99]])), []);
  assert.deepEqual(newlyDiffering(row(100, [[10, 19], [40, 99]]), row(100, [[12, 15], [50, 60]])), []);
  assert.deepEqual(newlyDiffering(row(100), row(100)), []);
});

test('a frame that matched and differs now is found, wherever it is', () => {
  assert.deepEqual(newlyDiffering(row(100, [[40, 99]]), row(100, [[39, 99]])), [[39, 39]]);
  assert.deepEqual(newlyDiffering(row(100), row(100, [[7, 7]])), [[7, 7]]);
  assert.deepEqual(newlyDiffering(row(100, [[10, 19], [40, 49]]), row(100, [[5, 60]])), [[5, 9], [20, 39], [50, 60]]);
  // the ranges before in any order
  assert.deepEqual(newlyDiffering(row(100, [[40, 49], [10, 19]]), row(100, [[5, 60]])), [[5, 9], [20, 39], [50, 60]]);
});

test('frames a recording didn\'t have before matched nothing then', () => {
  assert.deepEqual(newlyDiffering(row(100, [[90, 99]]), row(200, [[90, 199]])), []);
  assert.deepEqual(newlyDiffering(row(100), row(200, [[50, 199]])), [[50, 99]]);
});

test('worse is a frame that matched before, a new place no player could be, or a name the original doesn\'t show', () => {
  const before = { same: row(100, [[40, 99]]), better: row(100, [[40, 99]]), back: row(100, [[40, 99]]), held: row(100), named: row(100) };
  const played = [
    { name: 'same', row: row(100, [[40, 99]]) },
    { name: 'better', row: row(100, [[80, 99]]) },
    { name: 'back', row: row(100, [[20, 99]]) },
    { name: 'held', row: row(100, [], { neverInPlay: [[0, 30]] }) },
    { name: 'named', row: row(100), wrong: 1 },
  ];
  assert.deepEqual(worseThan(before, played), [
    { name: 'back', why: 'frame 20 matched before and differs now' },
    { name: 'held', why: 'it now plays what no player could see' },
    { name: 'named', why: 'the original doesn\'t show what its name says' },
  ]);
  assert.deepEqual(worseThan(before, played.slice(0, 2)), []);
});

test('a recording nothing proved before has to match in every frame', () => {
  assert.deepEqual(worseThan({}, [{ name: 'new', row: row(100) }]), []);
  assert.deepEqual(worseThan({}, [{ name: 'new', row: row(100, [[99, 99]]) }]), [{ name: 'new', why: 'nothing proved it before, and it doesn\'t match in every frame' }]);
});

test('before is the last commit, and the better of both sides while a merge is open, never the file as it is', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'dp-before-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const file = 'games/one/c/proof/progress.json';
    const put = (recordings, other = null) => {
      mkdirSync(dirname(join(cwd, file)), { recursive: true });
      writeFileSync(join(cwd, file), `${JSON.stringify({ recordings }, null, 2)}\n`);
      if (other) writeFileSync(join(cwd, other), 'x');
      git('add', '.');
      git('commit', '-qm', 'step');
    };
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    assert.deepEqual(provenBefore('one/c', cwd), {});
    put({ a: row(100, [[50, 99]]), b: row(100, [[50, 99]]) });
    git('switch', '-qc', 'work');
    put({ a: row(100), b: row(100, [[50, 99]]) }, 'mine.txt');
    git('switch', '-q', 'main');
    put({ a: row(100, [[50, 99]]), b: row(100, [[70, 99]]), c: row(100) }, 'theirs.txt');
    git('switch', '-q', 'work');
    assert.deepEqual(provenBefore('one/c', cwd), { a: row(100), b: row(100, [[50, 99]]) });
    // a run that wrote the file worse doesn't move what it's held to
    writeFileSync(join(cwd, file), `${JSON.stringify({ recordings: { a: row(100, [[0, 99]]) } })}\n`);
    assert.deepEqual(provenBefore('one/c', cwd).a, row(100));
    git('checkout', '-q', '--', file);
    // with a merge open, each recording as the side that matched more of it had it
    try { git('merge', '-q', '--no-commit', 'main'); } catch { /* the proof file conflicts, as both sides wrote it */ }
    assert.deepEqual(provenBefore('one/c', cwd), { a: row(100), b: row(100, [[70, 99]]), c: row(100) });
    assert.deepEqual(provenBefore('one', cwd), {});
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
