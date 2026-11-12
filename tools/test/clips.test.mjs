// What a clip has to be before share lets a pull request show it (lib/clips.mjs), where prove's clip starts, how long
// a recording's own "clip" has to be, and what the pull request's check reads (tools/clips-check.mjs), with made-up
// reports, recordings and clips. npm run check runs them.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CLIP_FRAMES, changedText, clipLinks, clipProblems, clipsToShow, clipWindow, firstChanged, gameAt, gamesChanged, gamesShownIn, newFramesIn, recordingHash } from '../lib/clips.mjs';
import { pathsOf } from '../../.github/first-entry/rules.mjs';
import { readRecording } from '../lib/recording.mjs';
import { checkClips } from '../clips-check.mjs';

const RECORDING = '{"about": "A, then nothing.", "frames": 2000, "held": [[0, []]]}\n';
const FILE = 'games/a-game/proof/recordings/a-test.json';
const report = clip => ({
  recording: 'a-test', recordingFile: FILE, recordingSha1: recordingHash(RECORDING),
  clip: { from: 1000, to: 1299, frames: 300, seconds: 5.02, apart: 0, differing: 0, oneColour: 0, same: 40, changed: { frame: 1060, why: 'the first that differed on main and matches now' }, newFrames: 240, base: 'b'.repeat(40), ...clip },
});

test('five seconds of what the step changed, of both in the same place, moving, from the committed recording, can go in a pull request', () => {
  assert.deepEqual(clipProblems(report(), RECORDING), []);
  assert.deepEqual(clipProblems(report({ oneColour: 75, same: 270, newFrames: 150 }), Buffer.from(RECORDING)), []);
});

test('a clip with a frame that differs from the original\'s is refused, whichever video it is', () => {
  // casino-2-opening, as #1003 ran it on: its one new frame matches, and the 299 after it differ
  for (const sideBySide of [true, false]) {
    const [problem, ...rest] = clipProblems(report({ differing: 299 }), RECORDING, { sideBySide });
    assert.match(problem, /299 of the clip's 300 frames differ from the original's, in picture or sound/);
    assert.match(problem, /port what those frames need/);
    assert.deepEqual(rest, []);
  }
  assert.equal(clipProblems(report({ differing: 1 }), RECORDING).length, 1);
});

test('a clip of a fraction of a second, or of two seconds, is refused', () => {
  assert.match(clipProblems(report({ frames: 9, seconds: 0.15, newFrames: 9 }), RECORDING)[0], /9 frames, 0\.15 seconds/);
  assert.match(clipProblems(report({ frames: 120, seconds: 2, newFrames: 120 }), RECORDING)[0], /at least 300 frames, five seconds/);
});

test('a clip of the way there, such as a menu before the act it proves, is refused', () => {
  // casino-2-opening, as #1003 shared it: 300 frames of the course select, and the act in its last
  const [problem] = clipProblems(report({ changed: { frame: 1299, why: 'where the original first runs code main\'s proof doesn\'t count, at 0800C728' }, newFrames: 1 }), RECORDING);
  assert.match(problem, /Only 1 of the clip's 300 frames come from frame 1299 on/);
  assert.match(problem, /until frame 1449 at least, and its "clip", if it has one, starts no earlier than frame 1149/);
  // a special attack two and a half seconds into the clip, as #1023's Chaos recordings have it, shows enough of it
  assert.deepEqual(clipProblems(report({ newFrames: 151 }), RECORDING), []);
  assert.equal(clipProblems(report({ newFrames: 149 }), RECORDING).length, 1);
});

test('a clip of a recording the step changed nothing in is refused', () => {
  const [problem, ...rest] = clipProblems(report({ changed: null, newFrames: 0 }), RECORDING);
  assert.match(problem, /shows nothing this step changed/);
  assert.deepEqual(rest, []);
});

test('a clip that\'s one colour, or a still picture, is refused', () => {
  assert.match(clipProblems(report({ oneColour: 76 }), RECORDING)[0], /one colour in 76 of the clip's 300 frames/);
  assert.match(clipProblems(report({ same: 271 }), RECORDING)[0], /same as the frame before in 271 of the clip's 300 frames/);
});

test('a clip whose original is somewhere else is refused, side by side only', () => {
  const [problem] = clipProblems(report({ apart: 300 }), RECORDING);
  assert.match(problem, /different places/);
  assert.deepEqual(clipProblems(report({ apart: 300 }), RECORDING, { sideBySide: false }), []);
  assert.equal(clipProblems(report({ apart: 76 }), RECORDING).length, 1);
  assert.deepEqual(clipProblems(report({ apart: 75 }), RECORDING), []);
});

test('a clip from a recording that isn\'t committed, or changed since, is refused', () => {
  assert.match(clipProblems(report(), null)[0], /isn't in the commit/);
  assert.match(clipProblems(report(), RECORDING.replace('2000', '2001'))[0], /changed after prove/);
});

test('a clip made against another main than the branch starts from now is refused', () => {
  assert.deepEqual(clipProblems(report(), RECORDING, { base: 'b'.repeat(40) }), []);
  assert.match(clipProblems(report(), RECORDING, { base: 'c'.repeat(40) })[0], /made against main at bbbbbbb.*starts from ccccccc now: prove it again/);
});

test('a clip prove made before it measured what a clip shows is refused', () => {
  assert.match(clipProblems(null, RECORDING)[0], /prove the recording again/);
  for (const field of ['apart', 'differing', 'oneColour', 'same', 'changed']) {
    const old = report();
    delete old.clip[field];
    assert.match(clipProblems(old, RECORDING)[0], /prove the recording again/, field);
  }
});

// main as mainProof gives it, with one recording and the functions its proof counts
const mainWith = ({ recordings = { 'a-test': { frames: 2000, matched: 1060, differs: [[1060, 1999]] } }, proven = ['08000000'], text = RECORDING } = {}) => ({
  base: 'b'.repeat(40), recordings, proven: new Set(proven), files: path => (path === FILE ? text : null),
});

test('the first frame a step changed, in a recording main proved the same', () => {
  const main = mainWith();
  const same = { main, name: 'a-test', file: FILE, text: RECORDING, frames: 2000 };
  assert.deepEqual(firstChanged({ ...same, differs: [] }), { frame: 1060, why: 'the first that differed on main and matches now' });
  assert.deepEqual(firstChanged({ ...same, differs: [[1500, 1999]] }), { frame: 1060, why: 'the first that differed on main and matches now' });
  assert.deepEqual(firstChanged({ ...same, differs: [[300, 1999]] }), { frame: 300, why: 'the first that matched on main and differs now' });
  // the same frames differing as on main is nothing changed, whatever code ran
  assert.equal(firstChanged({ ...same, differs: [[1060, 1999]], ran: () => ['0800C728'] }), null);
  // and before the Dreamport has played, main's own first difference is the guess
  assert.deepEqual(firstChanged({ ...same, differs: null }), { frame: 1060, why: 'the first that differed on main' });
  // the title screen in a step about something else: main matched it all, and still does
  assert.equal(firstChanged({ ...same, main: mainWith({ recordings: { 'a-test': { frames: 2000, matched: 2000, differs: [] } } }), differs: [] }), null);
});

test('a change that\'s only heard comes after one that can be seen, and is marked', () => {
  // the VS menu in a step about an act: main differed in the sound of two frames, and in the picture of a third
  const main = mainWith({ recordings: { 'a-test': { frames: 2000, matched: 1997, differs: [[1267, 1267], [1672, 1672], [1831, 1831]], soundDiffers: [[1267, 1267], [1672, 1672]] } } });
  const same = { main, name: 'a-test', file: FILE, text: RECORDING, frames: 2000 };
  const heard = firstChanged({ ...same, differs: [[1831, 1831]] });
  assert.deepEqual(heard, { frame: 1267, why: 'the first whose sound differed on main and matches now', heard: true });
  assert.match(changedText(heard), /only heard/);
  // once the picture's frame matches too, the clip starts there, not at the sound's
  assert.deepEqual(firstChanged({ ...same, differs: [] }), { frame: 1831, why: 'the first that differed on main and matches now' });
  // and the guess before the Dreamport plays starts at the picture's
  assert.deepEqual(firstChanged({ ...same, differs: null }), { frame: 1831, why: 'the first that differed on main' });
  // sound that matched on main and differs now is only heard when the picture still matches
  const sound = [[1267, 1267], [1672, 1672], [1900, 1900]], differs = [[1267, 1267], [1672, 1672], [1831, 1831], [1900, 1900]];
  assert.deepEqual(firstChanged({ ...same, differs, sound, picture: [[1831, 1831]] }), { frame: 1900, why: 'the first whose sound matched on main and differs now', heard: true });
  assert.deepEqual(firstChanged({ ...same, differs, sound, picture: [[1831, 1831], [1900, 1900]] }), { frame: 1900, why: 'the first that matched on main and differs now' });
});

test('a clip of a change that\'s only heard is left out beside one of a change that can be seen', () => {
  const seen = { name: 'act', changed: { frame: 4326, why: 'w' } }, heard = { name: 'menu', changed: { frame: 2267, why: 'w', heard: true } };
  const of = clip => clip.changed;
  assert.deepEqual(clipsToShow([seen, heard], of), { shown: [seen], heard: [heard] });
  // a step that changes sound only still shows its clips
  assert.deepEqual(clipsToShow([heard], of), { shown: [heard], heard: [] });
  assert.deepEqual(clipsToShow([seen], of), { shown: [seen], heard: [] });
  assert.deepEqual(clipsToShow([], of), { shown: [], heard: [] });
});

test('the first frame a step changed, in a recording main didn\'t prove as it is', () => {
  const fresh = { name: 'a-test', file: FILE, text: RECORDING, frames: 2000, differs: [] };
  // where the original first runs code main's proof doesn't count, as an act after a menu main proves
  const ran = frame => (frame < 1955 ? ['08000000'] : ['08000000', '0800C728']);
  assert.deepEqual(firstChanged({ ...fresh, main: mainWith({ recordings: {} }), ran }), { frame: 1955, why: 'where the original first runs code main\'s proof doesn\'t count, at 0800C728' });
  assert.equal(firstChanged({ ...fresh, main: mainWith({ text: RECORDING.replace('2000', '1999') }), ran }).frame, 1955);
  // with no code map, or no code new, or nothing on main to compare with, all of it is new
  assert.equal(firstChanged({ ...fresh, main: mainWith({ recordings: {} }) }).frame, 0);
  assert.equal(firstChanged({ ...fresh, main: mainWith({ recordings: {} }), ran: () => ['08000000'] }).frame, 0);
  assert.equal(firstChanged({ ...fresh, main: { ...mainWith(), recordings: null } }).frame, 0);
  assert.equal(firstChanged({ ...fresh, main: null }).frame, 0);
});

test('prove\'s clip starts a second before what changed, and ends before the first frame that differs', () => {
  assert.deepEqual(clipWindow({ frames: 2000, changed: { frame: 469 }, firstDifference: -1 }), [409, 708]);
  assert.deepEqual(clipWindow({ frames: 2000, changed: { frame: 469 }, firstDifference: 1500 }), [409, 708]);
  assert.deepEqual(clipWindow({ frames: 2000, changed: { frame: 469 }, firstDifference: 700 }), [400, 699]);
  // a step that makes too few frames match before one differs: five seconds that match, which the rule refuses for
  // showing too little of the step
  const before = clipWindow({ frames: 2000, changed: { frame: 469 }, firstDifference: 500 });
  assert.deepEqual(before, [200, 499]);
  assert.equal(newFramesIn(Array.from({ length: 300 }, (_, i) => before[0] + i), { frame: 469 }), 31);
  // a recording that ends nine frames into what it changed still gets five seconds, which the rule then refuses
  const [first, last] = clipWindow({ frames: 1964, changed: { frame: 1955 }, firstDifference: -1 });
  assert.deepEqual([first, last], [1664, 1963]);
  assert.equal(newFramesIn(Array.from({ length: last - first + 1 }, (_, i) => first + i), { frame: 1955 }), 9);
  // nothing changed: around the first difference, or the last five seconds, as before
  assert.deepEqual(clipWindow({ frames: 2000, changed: null, firstDifference: 1000 }), [760, 1059]);
  assert.deepEqual(clipWindow({ frames: 2000, changed: null, firstDifference: -1 }), [1700, 1999]);
  assert.deepEqual(clipWindow({ frames: 2000, changed: { frame: 900 }, firstDifference: 300 }), [60, 359]);
});

test('a recording\'s own clip lasts at least five seconds, or all of a shorter recording', () => {
  const folder = mkdtempSync(join(tmpdir(), 'clips-'));
  try {
    const read = recording => {
      const file = join(folder, 'recording.json');
      writeFileSync(file, JSON.stringify({ held: [], ...recording }));
      return readRecording(file);
    };
    assert.throws(() => read({ frames: 1710, clip: { at: 1701, frames: 9 } }), new RegExp(`at least ${CLIP_FRAMES}`));
    assert.throws(() => read({ frames: 1964, clip: { at: 1835, frames: 120 } }), /five seconds/);
    assert.doesNotThrow(() => read({ frames: 1964, clip: { at: 1664, frames: 300 } }));
    assert.doesNotThrow(() => read({ frames: 33, clip: { at: 0, frames: 33 } }));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('the clips a text links, as share writes them', () => {
  const text = '[![A, b: a frame of the clip](https://someone.github.io/dreamports/clips/a-game/c/2026-11-08-a68edcf-39fb7e1-still.png)](https://someone.github.io/dreamports/clips/a-game/c/2026-11-08-a68edcf-39fb7e1.mp4)\n\n'
    + '[Watch the clip of b](https://someone.github.io/dreamports/clips/a-game/c/2026-11-08-a68edcf-39fb7e1.mp4) (MP4, 0.3 MB)\nhttps://dreamports.net/play/a-game/';
  assert.deepEqual(clipLinks(text), [
    'https://someone.github.io/dreamports/clips/a-game/c/2026-11-08-a68edcf-39fb7e1-still.png',
    'https://someone.github.io/dreamports/clips/a-game/c/2026-11-08-a68edcf-39fb7e1.mp4',
    'https://someone.github.io/dreamports/clips/a-game/c/2026-11-08-a68edcf-39fb7e1.mp4',
  ]);
});

test('the pull request\'s check reads each clip\'s measures, and the video they\'re of', async () => {
  const video = Buffer.from('a made-up video');
  const hash = createHash('sha1').update(video).digest('hex');
  const at = `https://someone.github.io/dreamports/clips/a-game/2026-11-08-a68edcf-${hash.slice(0, 7)}`;
  const measures = (clip = {}) => ({ clip: 'dreamports', recording: 'a-test', recordingFile: FILE, recordingSha1: recordingHash(RECORDING), commit: 'a68edcf', base: 'b'.repeat(40), sideBySide: true, video: hash, measures: report(clip).clip });
  const site = files => async url => files[url] ?? null;
  const read = path => (path === FILE ? Buffer.from(RECORDING) : null);
  const text = `[![a](${at}-still.png)](${at}.mp4)\n\n[Watch the clip of a-test](${at}.mp4)`;
  assert.deepEqual(await checkClips(text, { fetched: site({ [`${at}.mp4`]: video, [`${at}.json`]: Buffer.from(JSON.stringify(measures())) }), read }), []);
  assert.deepEqual(await checkClips('No clip here.', { fetched: site({}), read }), []);
  // a clip share didn't make has no measures
  assert.match((await checkClips(text, { fetched: site({ [`${at}.mp4`]: video }), read }))[0], /has no measures beside it/);
  // measures of another video, or a recording the pull request changed since, or a clip that breaks a rule
  assert.match((await checkClips(text, { fetched: site({ [`${at}.mp4`]: Buffer.from('another'), [`${at}.json`]: Buffer.from(JSON.stringify(measures())) }), read }))[0], /isn't the video its measures are of/);
  assert.match((await checkClips(text, { fetched: site({ [`${at}.mp4`]: video, [`${at}.json`]: Buffer.from(JSON.stringify(measures())) }), read: () => Buffer.from('{}') }))[0], /changed after prove/);
  assert.match((await checkClips(text, { fetched: site({ [`${at}.mp4`]: video, [`${at}.json`]: Buffer.from(JSON.stringify(measures({ frames: 120, newFrames: 120 }))) }), read }))[0], /a-test: The clip of a-test is 120 frames/);
  // a picture on its own is a clip prove didn't make
  assert.match((await checkClips(`![a](${at}.png)`, { fetched: site({}), read }))[0], /isn't the frame of a clip the text links/);
  // the Dreamport on its own, as #1019 shared it, shows nothing of whether it does what the original does
  const alone = { ...measures(), sideBySide: false };
  assert.match((await checkClips(text, { fetched: site({ [`${at}.mp4`]: video, [`${at}.json`]: Buffer.from(JSON.stringify(alone)) }), read }))[0], /shows the Dreamport on its own/);
  // a clip of a change that's only heard, beside one of a change that can be seen, is refused, and alone it goes
  const menu = Buffer.from('another made-up video'), menuHash = createHash('sha1').update(menu).digest('hex');
  const menuAt = `https://someone.github.io/dreamports/clips/a-game/2026-11-08-a68edcf-${menuHash.slice(0, 7)}`;
  const heard = { ...measures({ changed: { frame: 1060, why: 'the first whose sound differed on main and matches now', heard: true } }), recording: 'a-menu', video: menuHash };
  const both = site({ [`${at}.mp4`]: video, [`${at}.json`]: Buffer.from(JSON.stringify(measures())), [`${menuAt}.mp4`]: menu, [`${menuAt}.json`]: Buffer.from(JSON.stringify(heard)) });
  const menuText = `[![a](${menuAt}-still.png)](${menuAt}.mp4)\n\n[Watch the clip of a-menu](${menuAt}.mp4)`;
  const refused = await checkClips(`${text}\n\n${menuText}`, { fetched: both, read });
  assert.equal(refused.length, 1);
  assert.match(refused[0], /a-menu: only its sound changed/);
  assert.deepEqual(await checkClips(menuText, { fetched: both, read }), []);
  // a pull request that changes a game's code or recordings links a clip of that game, and one that changes neither needs none
  assert.match((await checkClips('Clips: none.', { fetched: site({}), read, games: ['a-game'] }))[0], /changes a-game's code or recordings and links no clip of it/);
  assert.deepEqual(await checkClips('Clips: none.', { fetched: site({}), read, games: [] }), []);
  assert.deepEqual(await checkClips(text, { fetched: site({ [`${at}.mp4`]: video, [`${at}.json`]: Buffer.from(JSON.stringify(measures())) }), read, games: ['a-game'] }), []);
  const other = await checkClips(text, { fetched: site({ [`${at}.mp4`]: video, [`${at}.json`]: Buffer.from(JSON.stringify(measures())) }), read, games: ['another-game'] });
  assert.equal(other.length, 1);
  assert.match(other[0], /another-game/);
});

test('the games whose code or recordings a step changes', () => {
  assert.deepEqual(gamesChanged([
    'games/sonic-battle/c/src/brain.c', 'games/sonic-battle/c/src/game.h', 'games/sonic-advance/proof/recordings/act-1.json',
    'games/mega-man/src/main.js', 'games/sonic-advance/c/proof/progress.json', 'games/sonic-advance/c/proof/port-map.json',
    'games/sonic-advance/notes/a-note.md', 'games/sonic-advance/entry.md', 'kit/gba/c/video.c', 'tools/share.mjs',
  ]), ['sonic-battle', 'sonic-advance', 'mega-man']);
  assert.deepEqual(gamesChanged(null), []);
  // only a game main has already is shown: a first entry adds one nobody can play yet, in either language (#1032)
  const has = game => game !== 'a-new-game';
  for (const language of ['js', 'c']) assert.deepEqual(gamesShownIn(pathsOf('a-new-game', language), has), []);
  assert.deepEqual(gamesShownIn([...pathsOf('a-new-game', 'c'), 'games/sonic-battle/c/src/brain.c'], has), ['sonic-battle']);
  assert.equal(gameAt('HEAD', 'sonic-advance'), true);
  assert.equal(gameAt('HEAD', 'a-new-game'), false);
});
