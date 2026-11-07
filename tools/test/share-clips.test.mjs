// Tests of where `share` puts a step's clips and the lines it prints for them, with made-up files.
// npm run check runs them.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { clipFiles, clipLines, keepClip, missingLines, savedLines } from '../share.mjs';

const COMMIT = 'a68edcf'.padEnd(40, '0');
const SITE = 'https://someone.github.io/dreamports/';
const TITLE = 'A Game Dreamport';

function withClips(check) {
  const folder = mkdtempSync(join(tmpdir(), 'dreamports-clips-'));
  try {
    const clip = (name, text, recording) => {
      const file = join(folder, name);
      writeFileSync(file, text);
      return { file, bytes: 300_000, still: null, sideBySide: true, recording };
    };
    check(clip);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

test('two clips of one commit on one day keep an address each', () => {
  withClips(clip => {
    const [first] = clipFiles('a-game', COMMIT, clip('logos.mp4', 'first', 'logos'), '2026-11-03');
    const [second] = clipFiles('a-game', COMMIT, clip('skipped.mp4', 'second', 'logos-skipped'), '2026-11-03');
    assert.notEqual(first.path, second.path);
  });
});

test('two files of the same name keep an address each', () => {
  withClips(clip => {
    const [first] = clipFiles('a-game', COMMIT, clip('clip.mp4', 'first', null), '2026-11-03');
    const [second] = clipFiles('a-game', COMMIT, clip('clip.mp4', 'second', null), '2026-11-03');
    assert.notEqual(first.path, second.path);
  });
});

test('the same clip shared again has the same address, so its lines are the same', () => {
  withClips(clip => {
    const made = clip('clip.mp4', 'first', 'logos');
    assert.deepEqual(clipFiles('a-game', COMMIT, made, '2026-11-03'), clipFiles('a-game', COMMIT, made, '2026-11-03'));
  });
});

test('a clip and its frame sit under clips/, named alike', () => {
  withClips(clip => {
    const still = clip('still.png', 'a frame', null).file;
    const [video, frame] = clipFiles('a-game', COMMIT, { ...clip('clip.mp4', 'first', 'logos'), still }, '2026-11-03');
    assert.match(video.path, /^clips\/a-game\/2026-11-03-a68edcf-[0-9a-f]{7}\.mp4$/);
    assert.equal(frame.path, video.path.replace('.mp4', '-still.png'));
    assert.equal(frame.file, still);
  });
});

test('each clip\'s lines say which recording it plays', () => {
  withClips(clip => {
    const lines = made => clipLines(TITLE, made, clipFiles('a-game', COMMIT, made, '2026-11-03'), SITE);
    assert.match(lines(clip('a.mp4', 'first', 'logos')), /\[Watch the clip of logos\]\(https:/);
    assert.match(lines(clip('b.mp4', 'second', 'logos-skipped')), /\[Watch the clip of logos-skipped\]\(https:/);
    assert.match(lines({ ...clip('c.png', 'third', 'logos'), sideBySide: false }), /^!\[A Game Dreamport, logos\]\(https:/);
  });
});

test('a clip\'s line says who the original\'s memory says it plays', () => {
  withClips(clip => {
    const made = { ...clip('a.mp4', 'first', 'shadow-moving'), shows: { fighter: 'Shadow' } };
    assert.match(clipLines(TITLE, made, clipFiles('a-game', COMMIT, made, '2026-11-03'), SITE), /same button presses, and the original's fighter is Shadow\)/);
  });
});

test('a clip from elsewhere has no recording to name', () => {
  withClips(clip => {
    const made = clip('a.mp4', 'first', null);
    assert.match(clipLines(TITLE, made, clipFiles('a-game', COMMIT, made, '2026-11-03'), SITE), /\[Watch the clip\]\(https:/);
  });
});

test('a step\'s clips are kept for its branch, one per recording, and another branch starts again', () => {
  let saved = keepClip(null, 'feat/1-a', 'logos', 'first');
  saved = keepClip(saved, 'feat/1-a', 'menu', 'second');
  saved = keepClip(saved, 'feat/1-a', 'logos', 'first again');
  assert.deepEqual(saved.clips.map(c => c.lines), ['second', 'first again']);
  assert.equal(savedLines(saved), 'second\n\nfirst again');
  assert.deepEqual(keepClip(saved, 'feat/2-b', 'menu', 'other').clips, [{ key: 'menu', lines: 'other' }]);
});

test('a text with a clip\'s link and no frame is missing the frame', () => {
  withClips(clip => {
    const still = clip('clip-middle.png', 'a frame', null).file;
    const made = { ...clip('clip.mp4', 'first', 'amy-moves'), still };
    const lines = clipLines(TITLE, made, clipFiles('a-game', COMMIT, made, '2026-11-07'), SITE);
    const saved = keepClip(null, 'feat/1-a', 'amy-moves', lines);
    const [frame, , link] = lines.split('\n');
    assert.match(frame, /^\[!\[A Game Dreamport, amy-moves: a frame of the clip\]\(https:.*-still\.png\)\]\(https:.*\.mp4\)$/);
    assert.deepEqual(missingLines(`Clips:\n${link}\n`, saved), [{ key: 'amy-moves', lines: [frame] }]);
    assert.deepEqual(missingLines(`Clips:\n\n${savedLines(saved)}\n\nCode ported: …`, saved), []);
    assert.deepEqual(missingLines(`Clips:\n  ${frame}\n\n  ${link}\n`, saved), []);
  });
});
