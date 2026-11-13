// What a recording can say about a start point (tools/README.md): what the Dreamport's address adds and the values the
// original is given on the way, which go in a commit, so they're held to numbers and plain words. And how a part proven
// through one is marked.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkStart, namesNeverInPlay, originalButtons, readRecording, writeRecording } from '../lib/recording.mjs';
import { fromStartPoint, proofOf } from '../../src/lib/entries.mjs';

const folder = mkdtempSync(join(tmpdir(), 'recording-'));
test.after(() => rmSync(folder, { recursive: true, force: true }));

const read = recording => {
  const file = join(folder, 'recording.json');
  writeFileSync(file, JSON.stringify({ frames: 100, held: [], ...recording }));
  return readRecording(file);
};
const set = more => ({ frame: 3, address: '03005168', bytes: 1, value: 2, ...more });
const stretch = sets => ({ onlyInOriginal: [{ at: 0, frames: 10, sets }] });

test('a start point is words and values, and nothing else the address could read', () => {
  for (const start of ['level=2', 'level=2&character=1', 'act-name=a.b_c-1']) assert.doesNotThrow(() => checkStart(start, 'x'));
  for (const start of ['', 'level', 'level=', 'level=2&', '&level=2', 'Level=2', 'level=2#top', 'level=a b', 'next=https://example.com/', 'level=<b>', 2, null]) {
    assert.throws(() => checkStart(start, 'x'), /a start point is/, String(start));
  }
});

test('a start point can\'t turn the proof off or change what it reads', () => {
  assert.throws(() => checkStart('proof=record', 'x'), /and not proof/);
  assert.throws(() => checkStart('level=2&proof=1', 'x'), /and not proof/);
});

test('a recording\'s start and values are checked as it\'s read', () => {
  assert.equal(read({ start: 'level=2' }).start, 'level=2');
  assert.throws(() => read({ start: 'level 2' }), /a start point is/);
  assert.deepEqual(read(stretch([set()])).onlyInOriginal[0].sets, [set()]);
  assert.equal(read({ onlyInOriginal: [{ at: 0, frames: 10 }] }).onlyInOriginal[0].sets, undefined, 'values are optional');
});

test('a value is a frame of its stretch, an address, how many bytes and a number that fits them', () => {
  const fine = [set(), set({ frame: 9 }), set({ bytes: 2, address: '03005160', value: 65535 }), set({ bytes: 4, address: '03005160', value: 2 ** 32 - 1 }), set({ address: '0300516a', bytes: 2 })];
  for (const one of fine) assert.doesNotThrow(() => read(stretch([one])), JSON.stringify(one));
  const wrong = [
    set({ frame: 10 }), set({ frame: -1 }), set({ frame: 1.5 }),
    set({ address: '3005168' }), set({ address: '0x3005168' }), set({ address: 50352488 }), set({ address: undefined }),
    set({ bytes: 3 }), set({ bytes: 8 }), set({ bytes: '1' }),
    set({ bytes: 2, address: '03005161' }), set({ bytes: 4, address: '03005162' }),
    set({ value: 256 }), set({ bytes: 2, value: 65536 }), set({ value: -1 }), set({ value: 1.5 }), set({ value: '2' }),
    null,
  ];
  for (const one of wrong) assert.throws(() => read(stretch([one])), /isn't a frame of the stretch/, JSON.stringify(one));
  assert.throws(() => read(stretch(set())), /"sets" is a list/);
});

test('a recording written again keeps its start', () => {
  const file = join(folder, 'written.json');
  writeRecording(file, { about: 'A level.', start: 'level=2', frames: 5, held: [[0, []]], onlyInOriginal: [{ at: 0, frames: 2, sets: [set({ frame: 1 })] }] });
  const again = readRecording(file);
  assert.equal(again.start, 'level=2');
  assert.deepEqual(again.onlyInOriginal[0].sets, [set({ frame: 1 })]);
  writeRecording(file, { about: 'From power-on.', frames: 5, held: [[0, []]] });
  assert.doesNotMatch(readFileSync(file, 'utf8'), /"start"/);
});

test('a frame comes from a start point when the address opens there or a value was set before it', () => {
  assert.equal(fromStartPoint({ onlyInOriginal: [] }, 50), false);
  assert.equal(fromStartPoint({}, 50), false);
  assert.equal(fromStartPoint({ onlyInOriginal: [{ at: 10, frames: 5 }] }, 50), false, 'a stretch with no values is how a player gets there');
  assert.equal(fromStartPoint({ start: 'level=2', onlyInOriginal: [] }, 0), true);
  assert.equal(fromStartPoint({ onlyInOriginal: [{ at: 10, frames: 5, sets: [set()] }] }, 10), true);
  assert.equal(fromStartPoint({ onlyInOriginal: [{ at: 10, frames: 5, sets: [set()] }] }, 9), false, 'what comes before the values is from power-on');
  assert.equal(fromStartPoint({ onlyInOriginal: [{ at: 10, frames: 5, sets: [] }] }, 50), false);
});

test('a part proven from a start point counts, and says so', () => {
  const original = { name: 'Made Up', sha1: 'abc' };
  const parts = { parts: [{ name: 'The logos', recording: 'logos', frames: [0, 9] }, { name: 'A late level', recording: 'late', frames: [0, 9] }] };
  const recordings = { logos: { onlyInOriginal: [] }, late: { start: 'level=2', onlyInOriginal: [{ at: 0, frames: 50, sets: [set()] }] } };
  const progress = { original: 'abc', recordings: { logos: { frames: 10 }, late: { frames: 10 } } };
  const { gameplay } = proofOf('made-up', { original, parts, progress, recordings });
  assert.equal(gameplay.proven, 2);
  assert.equal(gameplay.percent, 100);
  assert.deepEqual(gameplay.parts.map(p => [p.name, p.proven, p.fromStart]), [['The logos', true, false], ['A late level', true, true]]);
});

test('a part from a start point isn\'t proven with a frame that differs, or frames of the original\'s inside it', () => {
  const original = { name: 'Made Up', sha1: 'abc' };
  const parts = { parts: [{ name: 'A late level', recording: 'late', frames: [0, 9] }] };
  const recordings = { late: { start: 'level=2', onlyInOriginal: [{ at: 0, frames: 50, sets: [set()] }] } };
  const differs = proofOf('made-up', { original, parts, recordings, progress: { original: 'abc', recordings: { late: { frames: 10, differs: [[4, 4]] } } } });
  assert.deepEqual(differs.gameplay.parts.map(p => [p.proven, p.difference]), [[false, 4]]);
  const inside = { late: { start: 'level=2', onlyInOriginal: [{ at: 5, frames: 50, sets: [set()] }] } };
  const gap = proofOf('made-up', { original, parts, recordings: inside, progress: { original: 'abc', recordings: { late: { frames: 10 } } } });
  assert.deepEqual(gap.gameplay.parts.map(p => [p.proven, p.gap]), [[false, 5]]);
});

test('frames no player could ever see stop the proof, however they compared', () => {
  const original = { name: 'Made Up', sha1: 'abc' };
  const measured = more => ({ original, recordings: { placed: { held: [], frames: 100 } }, progress: { original: 'abc', recordings: { placed: { frames: 100, matched: 100, differs: [], functions: [], ...more } } } });
  assert.doesNotThrow(() => proofOf('made-up', measured({})));
  assert.throws(
    () => proofOf('made-up', measured({ neverInPlay: [{ from: 0, to: 16, why: 'Sonic is in the air during the countdown' }] })),
    /recordings\/placed\.json plays what no player could ever see at frames 0 to 16: Sonic is in the air during the countdown\..*Start points/,
  );
});

test('a game\'s code can name what no player could see in any of its files, and only its code counts', () => {
  const folder = mkdtempSync(join(tmpdir(), 'dreamports-never-'));
  try {
    mkdirSync(join(folder, 'stage'));
    writeFileSync(join(folder, 'main.js'), 'export const game = 1;\n');
    writeFileSync(join(folder, 'stage', 'plan.txt'), 'neverInPlay\n');
    assert.equal(namesNeverInPlay(folder), false);
    writeFileSync(join(folder, 'stage', 'countdown.js'), "dreamportsProof.neverInPlay = 'He is in the air during the countdown';\n");
    assert.equal(namesNeverInPlay(folder), true);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('a list of presses gives the original every frame, with the stretches only it has in their places', () => {
  const buttons = originalButtons({ frames: 3, held: [[1, ['A']]], onlyInOriginal: [{ at: 1, frames: 2, held: [[1, ['START']]] }, { at: 3, frames: 1 }] });
  assert.deepEqual(buttons, [[], [], ['START'], ['A'], ['A'], []]);
  assert.throws(() => originalButtons({ frames: 3, held: [], onlyInOriginal: [{ at: 0, frames: 2, sets: [set()] }] }), /only real play/);
});

test('values the original is given as it plays the recording\'s own frames go in at the original\'s frame, and are kept', async () => {
  const { originalPlay } = await import('../lib/recording.mjs');
  const recording = read({ frames: 20, held: [[0, []]], onlyInOriginal: [{ at: 5, frames: 7 }], sets: [set({ frame: 10 })] });
  assert.deepEqual(recording.sets, [set({ frame: 10 })]);
  const { sets, originalOf } = originalPlay(recording);
  assert.equal(originalOf[10], 17, 'the stretch before puts the recording\'s frame 10 at the original\'s 17');
  assert.deepEqual(sets, [{ ...set(), frame: 17, address: 0x03005168 }]);
  assert.deepEqual(originalPlay(recording, { frames: 10 }).sets, [], 'a value past the frames played isn\'t written');
  assert.throws(() => read({ frames: 20, held: [], sets: [set({ frame: 20 })] }), /isn't a frame of the recording/);
  assert.throws(() => originalButtons(recording), /only real play/);
  assert.equal(fromStartPoint(recording, 10), true);
  assert.equal(fromStartPoint(recording, 9), false, 'what comes before the values is from power-on');
  const file = join(folder, 'with-values.json');
  writeRecording(file, { about: 'Menus and all.', frames: 20, held: [[0, []]], sets: [set({ frame: 10 })] });
  assert.deepEqual(readRecording(file).sets, [set({ frame: 10 })]);
});
