// Tests of where `share` puts a step's clips and the lines it prints for them, with made-up files.
// npm run check runs them.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { clipFiles, clipLines, foreignLinks, keepClip, missingLines, sameVideoOnce, savedLines, seenFirst, stillGood, waitUntilOnline } from '../share.mjs';
import { recordingHash, repeatedClips } from '../lib/clips.mjs';

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
    assert.match(lines({ ...clip('c.mp4', 'third', 'logos'), sideBySide: false }), /\[Watch the clip of logos\]\(https:[^)]*\.mp4\) \(MP4, 0\.3 MB\)$/);
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

test('a clip\'s measures go beside it, and none for a clip prove didn\'t measure', () => {
  withClips(clip => {
    const made = { ...clip('clip.mp4', 'first', 'logos'), report: { recording: 'logos', recordingFile: 'games/a-game/proof/recordings/logos.json', recordingSha1: 'f'.repeat(40), clip: { frames: 300, bytes: 1, bitrate: 2, dreamport: {} } } };
    const files = clipFiles('a-game', COMMIT, made, '2026-11-03', 'b'.repeat(40));
    assert.equal(files.length, 2);
    const [video, measures] = files;
    assert.equal(measures.path, video.path.replace('.mp4', '.json'));
    const read = JSON.parse(measures.bytes.toString('utf8'));
    assert.deepEqual({ ...read, video: undefined }, { clip: 'dreamports', recording: 'logos', recordingFile: 'games/a-game/proof/recordings/logos.json', recordingSha1: 'f'.repeat(40), commit: COMMIT, base: 'b'.repeat(40), sideBySide: true, video: undefined, measures: { frames: 300 } });
    assert.equal(clipFiles('a-game', COMMIT, clip('clip.mp4', 'first', 'logos'), '2026-11-03').length, 1);
  });
});

test('a clip shared before that breaks a rule now leaves the branch\'s clips', () => {
  const text = '{"frames": 2000, "held": []}';
  const measures = (clip = {}) => ({ recording: 'r', recordingFile: 'games/a-game/proof/recordings/r.json', recordingSha1: recordingHash(text), sideBySide: true, base: 'b'.repeat(40),
    measures: { frames: 300, seconds: 5, apart: 0, differing: 0, oneColour: 0, same: 0, changed: { frame: 10, why: 'w' }, newFrames: 290, base: 'b'.repeat(40), ...clip } });
  let saved = keepClip(null, 'feat/1-a', 'good', 'g', measures());
  saved = keepClip(saved, 'feat/1-a', 'title', 't', measures({ changed: null, newFrames: 0 }));
  saved = keepClip(saved, 'feat/1-a', 'old', 'o');
  const kept = stillGood(saved, 'feat/1-a', COMMIT, 'b'.repeat(40), () => Buffer.from(text));
  assert.deepEqual(kept.clips.map(c => c.key), ['good']);
  assert.deepEqual(stillGood(saved, 'feat/1-a', COMMIT, 'c'.repeat(40), () => Buffer.from(text)).clips, []);
  assert.equal(stillGood(saved, 'feat/2-b', COMMIT, null), saved);
});

test('a clip of a change that\'s only heard leaves the branch\'s clips once one shows a change that can be seen', () => {
  const measures = changed => ({ measures: { changed } });
  let saved = keepClip(null, 'feat/1-a', 'menu', 'm', measures({ frame: 2267, why: 'w', heard: true }));
  assert.deepEqual(seenFirst(saved).clips.map(c => c.key), ['menu']);
  saved = keepClip(saved, 'feat/1-a', 'act', 'a', measures({ frame: 4326, why: 'w' }));
  assert.deepEqual(seenFirst(saved).clips.map(c => c.key), ['act']);
  assert.equal(seenFirst(null), null);
});

test('a video several recordings gave shows once, with the others named beside it', () => {
  withClips(clip => {
    const still = clip('clip-middle.png', 'a frame', null).file;
    // five recordings pass the title screen with the same presses, so prove cut the same video out of each (#2075)
    const title = ['amy-act', 'knuckles-act', 'sonic-act', 'tails-act', 'vs-menu'].map((name, i) => ({ ...clip(`${name}.mp4`, 'the title screen', name), still, shows: { character: i === 4 ? 'Sonic' : 'Amy' } }));
    const reset = ['reset-act', 'reset-menu'].map(name => ({ ...clip(`${name}.mp4`, 'after a reset', name), still, shows: { character: 'Sonic' } }));
    const own = { ...clip('own.mp4', 'its own', 'own-act'), still };
    const once = sameVideoOnce([...title, own, ...reset]);
    assert.deepEqual(once.map(c => [c.recording, c.also]), [['amy-act', ['knuckles-act', 'sonic-act', 'tails-act', 'vs-menu']], ['own-act', []], ['reset-act', ['reset-menu']]]);
    const lines = once.map(c => clipLines(TITLE, c, clipFiles('a-game', COMMIT, c, '2026-11-27'), SITE));
    const text = lines.join('\n\n');
    assert.equal(text.split('a frame of the clip').length - 1, 3);
    assert.equal(text.split('[Watch the clip').length - 1, 3);
    assert.deepEqual(repeatedClips(text), []);
    // who the original plays is said only when every recording of the video agrees, as one video can't show two
    assert.match(lines[0], /with the same button presses\) The very same video came out of 4 more recordings, knuckles-act, sonic-act and tails-act among them\.$/);
    assert.match(lines[1], /with the same button presses\)$/);
    assert.match(lines[2], /and the original's character is Sonic\) The very same video came out of reset-menu too\.$/);
    // and the text one clip for each recording made, as #2068 had, is refused
    const each = [...title, own, ...reset].map(c => clipLines(TITLE, c, clipFiles('a-game', COMMIT, c, '2026-11-27'), SITE)).join('\n\n');
    assert.equal(repeatedClips(each).length, 2);
  });
});

test('a clip kept from before goes when a new one is the same video, or stands for its recording', () => {
  const measures = (video, also) => ({ video, ...(also ? { also } : {}) });
  let saved = keepClip(null, 'feat/1-a', 'amy-act', 'amy', measures('v1'));
  saved = keepClip(saved, 'feat/1-a', 'sonic-act', 'sonic', measures('v1'));
  assert.deepEqual(saved.clips.map(c => c.key), ['sonic-act']);
  // a recording that had a clip of its own and now shares another's video
  saved = keepClip(saved, 'feat/1-a', 'tails-act', 'tails', measures('v2'));
  saved = keepClip(saved, 'feat/1-a', 'amy-act', 'amy and tails', measures('v3', ['tails-act']), ['tails-act']);
  assert.deepEqual(saved.clips.map(c => c.key), ['sonic-act', 'amy-act']);
  // and one that shared another's and has its own now
  saved = keepClip(saved, 'feat/1-a', 'tails-act', 'tails alone', measures('v4'));
  assert.deepEqual(saved.clips.map(c => c.key), ['sonic-act', 'tails-act']);
  // clips with no measures, as a test's or an old share's, are told apart by their recording only
  assert.deepEqual(keepClip(keepClip(null, 'feat/1-a', 'a', 'a'), 'feat/1-a', 'b', 'b').clips.map(c => c.key), ['a', 'b']);
});

test('a text linking a clip share didn\'t make for the branch is caught', () => {
  withClips(clip => {
    const made = clip('clip.mp4', 'first', 'other-fighter');
    const lines = clipLines(TITLE, made, clipFiles('a-game', COMMIT, made, '2026-11-08'), SITE);
    const saved = keepClip(null, 'feat/1-a', 'other-fighter', lines);
    assert.deepEqual(foreignLinks(lines, saved), []);
    const title = `${SITE}clips/a-game/2026-11-08-7e9a578-5a4f393.mp4`;
    assert.deepEqual(foreignLinks(`${lines}\n\n[Watch the clip of other-fighter](${title}) (MP4, 0.04 MB)`, saved), [title]);
  });
});

test('waitUntilOnline does not re-trigger Pages while the pushed commit is already building (#2087)', async () => {
  let time = 0, triggers = 0;
  const statuses = [
    ...Array.from({ length: 16 }, () => ({ commit: COMMIT, status: 'building', error: null })),
    { commit: COMMIT, status: 'built', error: null },
  ];
  let poll = 0;
  await waitUntilOnline('me/dreamports', COMMIT, 'https://me.github.io/dreamports/p/info.json', '2026-11-27T00:00:00Z', {
    last: () => statuses[Math.min(poll++, statuses.length - 1)],
    trigger: () => { triggers++; },
    wait: async ms => { time += ms; },
    fetch: async () => ({ json: async () => ({ made: '2026-11-27T00:00:00Z' }) }),
    now: () => time,
    write: () => {},
  });
  assert.equal(triggers, 0);
  assert.ok(time >= 80_000);
});

test('waitUntilOnline triggers Pages once after 60s when no build started for the pushed commit (#2087)', async () => {
  let time = 0, triggers = 0;
  await waitUntilOnline('me/dreamports', COMMIT, 'https://me.github.io/dreamports/p/info.json', 'm1', {
    last: () => (triggers ? { commit: COMMIT, status: 'built', error: null } : { commit: '0'.repeat(40), status: 'built', error: null }),
    trigger: () => { triggers++; },
    wait: async ms => { time += ms; },
    fetch: async () => ({ json: async () => ({ made: 'm1' }) }),
    now: () => time,
    write: () => {},
  });
  assert.equal(triggers, 1);
});

test('waitUntilOnline tolerates a brief reasonless errored status while a replacement build starts, and fails on real errors (#2087)', async () => {
  let time = 0, poll = 0;
  const sequence = [
    { commit: COMMIT, status: 'errored', error: null },
    { commit: COMMIT, status: 'building', error: null },
    { commit: COMMIT, status: 'built', error: null },
  ];
  await waitUntilOnline('me/dreamports', COMMIT, 'https://me.github.io/dreamports/p/info.json', 'm2', {
    last: () => sequence[Math.min(poll++, sequence.length - 1)],
    trigger: () => {},
    wait: async ms => { time += ms; },
    fetch: async () => ({ json: async () => ({ made: 'm2' }) }),
    now: () => time,
    write: () => {},
  });
  assert.equal(poll, 3);

  await assert.rejects(() => waitUntilOnline('me/dreamports', COMMIT, 'https://me.github.io/dreamports/p/info.json', 'm2', {
    last: () => ({ commit: COMMIT, status: 'errored', error: 'page build failed' }),
    trigger: () => {},
    wait: async () => {},
    now: () => 0,
    write: () => {},
  }), /page build failed/);

  let persistent = 0;
  await assert.rejects(() => waitUntilOnline('me/dreamports', COMMIT, 'https://me.github.io/dreamports/p/info.json', 'm2', {
    last: () => { persistent++; return { commit: COMMIT, status: 'errored', error: null }; },
    trigger: () => {},
    wait: async () => {},
    now: () => 0,
    write: () => {},
  }), /it gave no reason/);
  assert.equal(persistent, 3);
});
