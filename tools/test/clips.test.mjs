// What a clip has to be before share lets a pull request show it (lib/clips.mjs), and how long a recording's own
// "clip" has to be, with made-up reports and recordings. npm run check runs them.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CLIP_FRAMES, clipProblems, recordingHash } from '../lib/clips.mjs';
import { readRecording } from '../lib/recording.mjs';

const RECORDING = '{"about": "A, then nothing.", "frames": 2000, "held": [[0, []]]}\n';
const report = clip => ({
  recording: 'a-test', recordingFile: 'games/a-game/proof/recordings/a-test.json', recordingSha1: recordingHash(RECORDING),
  clip: { from: 1000, to: 1299, frames: 300, seconds: 5.02, apart: 0, ...clip },
});

test('five seconds of both in the same place, from the committed recording, can go in a pull request', () => {
  assert.deepEqual(clipProblems(report(), RECORDING), []);
  assert.deepEqual(clipProblems(report({ frames: CLIP_FRAMES, apart: CLIP_FRAMES / 4 }), Buffer.from(RECORDING)), []);
});

test('a clip of a fraction of a second is refused', () => {
  const [problem] = clipProblems(report({ frames: 9, seconds: 0.15 }), RECORDING);
  assert.match(problem, /9 frames, 0\.15 seconds/);
});

test('a clip whose original is somewhere else is refused, side by side only', () => {
  const [problem] = clipProblems(report({ apart: 300 }), RECORDING);
  assert.match(problem, /different places/);
  assert.deepEqual(clipProblems(report({ apart: 300 }), RECORDING, { sideBySide: false }), []);
  assert.equal(clipProblems(report({ apart: 76 }), RECORDING).length, 1);
});

test('a clip from a recording that isn\'t committed, or changed since, is refused', () => {
  assert.match(clipProblems(report(), null)[0], /isn't in the commit/);
  assert.match(clipProblems(report(), RECORDING.replace('2000', '2001'))[0], /changed after prove/);
});

test('a clip prove made before it measured clips is refused', () => {
  assert.match(clipProblems(null, RECORDING)[0], /prove the recording again/);
  const old = report();
  delete old.clip.apart;
  assert.match(clipProblems(old, RECORDING)[0], /prove the recording again/);
});

test('a recording\'s own clip lasts at least two seconds, or all of a shorter recording', () => {
  const folder = mkdtempSync(join(tmpdir(), 'clips-'));
  try {
    const read = recording => {
      const file = join(folder, 'recording.json');
      writeFileSync(file, JSON.stringify({ held: [], ...recording }));
      return readRecording(file);
    };
    assert.throws(() => read({ frames: 1710, clip: { at: 1701, frames: 9 } }), /at least 120/);
    assert.doesNotThrow(() => read({ frames: 1710, clip: { at: 1590, frames: 120 } }));
    assert.doesNotThrow(() => read({ frames: 33, clip: { at: 0, frames: 33 } }));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
