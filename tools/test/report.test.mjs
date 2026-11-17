// A player's report (kit/gba/report.js): presses, packed, and a reason, checked so that nothing else gets in. The
// settings pack one from a session (kit/gba/ui/report-view.js), and the tools read it back as a recording.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { FEWEST_FRAMES, MOST_PACKED, MOST_SAVE_BYTES, MOST_SAVES_PACKED, packHeld, packSave, packSaves, readReport, savesUnpack, unpackHeld, unpackSave } from '../../kit/gba/report.js';
import { createSession } from '../../kit/gba/session.js';
import { partingLine, recordingOf } from '../reports.mjs';

const CHANGES = [[0, []], [50, ['A']], [65, []], [104, ['A', 'START']], [400, ['LEFT']]];
const report = (over = {}) => ({ game: 'sonic-advance/c', reason: 'looked', frames: 600, ...packHeld(CHANGES), ...over });

test('presses pack small and come back as they were', () => {
  const packed = packHeld(CHANGES);
  assert.deepEqual(packed, { buttons: ['A', 'START', 'LEFT'], held: '0.0,1e.1,f.0,13.3,88.4' });
  assert.deepEqual(unpackHeld(packed.buttons, packed.held), CHANGES);
  assert.deepEqual(unpackHeld([], ''), []);
  // an hour of play, a change every half second, fits what a report may take
  const hour = packHeld(Array.from({ length: 7200 }, (_, i) => [i * 30, i % 2 ? ['A', 'RIGHT'] : ['RIGHT']]));
  assert.ok(hour.held.length < MOST_PACKED, `${hour.held.length} characters`);
});

test('a report is read back with nothing but what a report holds', () => {
  const read = readReport({ ...report(), note: 'something typed', email: 'someone', token: 'x' });
  assert.deepEqual(Object.keys(read), ['game', 'reason', 'start', 'keptSave', 'saves', 'frames', 'buttons', 'held']);
  assert.equal(read.start, '');
  assert.equal(read.keptSave, false);
  assert.deepEqual(read.saves, []);
  assert.equal(readReport(report({ start: 'unlocked=8&character=3', keptSave: true })).start, 'unlocked=8&character=3');
});

test('what isn\'t presses is refused', () => {
  const refused = over => assert.equal(typeof readReport(report(over)), 'string', JSON.stringify(over));
  refused({ game: '../etc' });
  refused({ game: 'Sonic Advance' });
  refused({ reason: 'because' });
  refused({ frames: FEWEST_FRAMES - 1 });
  refused({ frames: 1e9 });
  refused({ start: 'a b' });
  refused({ start: '<script>' });
  refused({ keptSave: 'yes' });
  refused({ buttons: ['A', 'A'] });
  refused({ buttons: ['a button with spaces'] });
  refused({ buttons: Array.from({ length: 25 }, (_, i) => `B${i}`) });
  refused({ held: 'hello there' });
  refused({ held: '0.0,0.1' });            // not after the one before
  refused({ held: '0.0,zzzz.1' });         // past the frames played
  refused({ held: '0.8' });                // a button the report doesn't name
  refused({ held: 'a'.repeat(MOST_PACKED + 1) });
  assert.equal(typeof readReport(null), 'string');
  assert.equal(typeof readReport('a report'), 'string');
});

test('a session becomes a report, and a report the recording it was', () => {
  const session = createSession({ buttons: ['left', 'jump'], gba: { left: 'LEFT', jump: 'A' } });
  for (let frame = 0; frame < 400; frame++) session.read({ held: frame >= 100 && frame < 130 ? ['jump'] : frame >= 200 ? ['left'] : [], pressed: [] });
  const recording = session.recording('');
  const sent = readReport({ game: 'made-up', reason: 'stopped', frames: recording.frames, ...packHeld(recording.held) });
  assert.equal(typeof sent, 'object');
  const kept = recordingOf({ id: 'ADcC3d8DddTeGROW', created: Date.UTC(2026, 10, 16), game: sent.game, reason: sent.reason, start: sent.start, kept_save: 0, frames: sent.frames, buttons: sent.buttons.join(' '), held: sent.held });
  assert.equal(kept.name, 'report-2026-11-16-adcc3d8dddtegrow');
  assert.equal(kept.version, 'made-up');
  assert.deepEqual(kept.recording.held, recording.held);
  assert.equal(kept.recording.frames, 400);
  assert.match(kept.recording.about, /it froze or stopped/);
  assert.equal(recordingOf({ id: 'ADcC3d8DddTeGROW', created: 1, game: '../x', reason: 'looked', frames: 400, buttons: '', held: '' }), null, 'what the site sends is checked again');
  assert.equal(recordingOf({ id: '../../x', created: 1, game: 'made-up', reason: 'looked', frames: 400, buttons: '', held: '' }), null, 'and its name can\'t lead anywhere');
});

test('a report that can\'t go yet waits on the device, a few at most and for a week at most', async () => {
  const { WAITING_DAYS, WAITING_MOST, keepReport, waitingReports } = await import('../../kit/gba/report-outbox.js');
  const held = new Map();
  const storage = { getItem: key => held.get(key) ?? null, setItem: (key, value) => held.set(key, value), removeItem: key => held.delete(key) };
  const now = Date.UTC(2026, 10, 16), DAY = 86_400_000;
  assert.deepEqual(waitingReports(storage, now), []);
  assert.equal(keepReport(report(), storage, now), true);
  assert.equal(keepReport(report(), storage, now + 1000), true, 'the same report again is still one');
  assert.equal(waitingReports(storage, now + 2000).length, 1);
  for (let i = 1; i <= WAITING_MOST + 1; i++) keepReport(report({ frames: 600 + i }), storage, now + i * 1000);
  const waiting = waitingReports(storage, now + 60_000);
  assert.equal(waiting.length, WAITING_MOST);
  assert.equal(waiting.at(-1).report.frames, 600 + WAITING_MOST + 1, 'the newest are the ones kept');
  assert.deepEqual(waitingReports(storage, now + WAITING_DAYS * DAY + 60_000), [], 'and none past a week');
  // what's in the storage is checked like anything sent: a report, or nothing
  held.set('dreamports.reports', JSON.stringify([{ report: { game: '../x' }, kept: now }, 'junk', { report: report(), kept: now }]));
  assert.equal(waitingReports(storage, now + 1000).length, 1);
  held.set('dreamports.reports', 'not json');
  assert.deepEqual(waitingReports(storage, now), []);
  assert.equal(keepReport(report(), null, now), false, 'with no storage, it says it wasn\'t kept');
  assert.equal(keepReport(report(), { getItem: () => null, setItem() { throw new Error('full'); } }, now), false);
});

test('waiting reports go when the site takes them, and wait on when it doesn\'t', async () => {
  const { keepReport, outcomeOf, sendWaitingReports, waitingReports } = await import('../../kit/gba/report-outbox.js');
  assert.deepEqual([201, 200, 429, 403, 500, 0, 400, 413].map(outcomeOf), ['sent', 'sent', 'later', 'later', 'later', 'later', 'refused', 'refused']);
  const held = new Map();
  const storage = { getItem: key => held.get(key) ?? null, setItem: (key, value) => held.set(key, value), removeItem: key => held.delete(key) };
  const now = Date.UTC(2026, 10, 16);
  for (let i = 1; i <= 3; i++) keepReport(report({ frames: 600 + i }), storage, now + i);
  // the site is still full: nothing goes, and it stops at the first
  let asked = 0;
  assert.equal(await sendWaitingReports(async () => { asked++; return 429; }, storage, now + 10), 0);
  assert.equal(asked, 1);
  assert.equal(waitingReports(storage, now + 10).length, 3);
  // then it takes one, turns one down for good, and is out of reach for the last
  const answers = [201, 400, 0];
  assert.equal(await sendWaitingReports(async () => answers.shift(), storage, now + 20), 1);
  assert.equal(waitingReports(storage, now + 20).length, 1, 'the one out of reach waits on');
  assert.equal(await sendWaitingReports(async () => 201, storage, now + 30), 1);
  assert.equal(held.has('dreamports.reports'), false, 'and nothing is left behind');
});

// a cartridge's flash as a long-played game leaves it: sixteen sectors of 4 KB, each a save of some 1,200 bytes that
// don't pack, a little changed from the one before, and bytes never written
function flash() {
  const bytes = new Uint8Array(0x10000).fill(0xFF), save = new Uint8Array(randomBytes(0x4E0));
  for (let sector = 0; sector < 16; sector++) {
    save.set(randomBytes(32), sector * 64);
    bytes.fill(0, sector * 0x1000, (sector + 1) * 0x1000);
    bytes.set(save, sector * 0x1000);
  }
  return bytes;
}

test('a save packs small and comes back byte for byte', async () => {
  const bytes = flash();
  const packed = await packSave(bytes);
  assert.ok(packed.length < MOST_SAVES_PACKED / 2, `${packed.length} characters`);
  assert.ok(Buffer.from(await unpackSave(packed)).equals(bytes), 'the same bytes');
  // a first save, one sector written, is a few hundred characters
  const first = new Uint8Array(0x10000).fill(0xFF);
  first.set(bytes.subarray(0, 0x430));
  assert.ok((await packSave(first)).length < 2500);
  assert.equal(await packSave(new Uint8Array(0)), null);
  assert.equal(await packSave(new Uint8Array(MOST_SAVE_BYTES + 1)), null);
});

test('what isn\'t a packed save unpacks to nothing', async () => {
  assert.equal(await unpackSave('not base64!'), null);
  assert.equal(await unpackSave(btoa('these are not deflated bytes at all')), null);
  assert.equal(await unpackSave(deflateRawSync(new Uint8Array(0)).toString('base64')), null);
  // a few hundred bytes that would unpack to megabytes are stopped at a save memory's size
  const bomb = deflateRawSync(new Uint8Array(8_000_000)).toString('base64');
  assert.ok(bomb.length < MOST_SAVES_PACKED);
  assert.equal(await unpackSave(bomb), null);
  assert.equal(await savesUnpack(readReport(report({ saves: [{ key: 'made-up-save', packed: bomb }] }))), false);
});

test('a report carries the saves its game began from', async () => {
  const first = new Uint8Array(0x10000).fill(0xFF);
  first.set(flash().subarray(0, 0x430));
  const saves = await packSaves([{ key: 'made-up-save', bytes: first }, { key: 'made-up.name', bytes: Uint8Array.of(1, 2, 3) }]);
  assert.deepEqual(saves.map(save => save.key), ['made-up-save', 'made-up.name']);
  const read = readReport(report({ saves }));
  assert.equal(JSON.stringify(read.saves), JSON.stringify(saves));
  assert.equal(read.keptSave, true, 'a report with a save began from one');
  assert.equal(await savesUnpack(read), true);
  // the site gives it back, and the tools have the bytes again
  const kept = recordingOf({ id: 'ADcC3d8DddTeGROW', created: Date.UTC(2026, 10, 16), game: read.game, reason: read.reason, start: read.start, kept_save: 1, saves, frames: read.frames, buttons: read.buttons.join(' '), held: read.held });
  assert.ok(Buffer.from(await unpackSave(kept.saves[0].packed)).equals(first), 'the same bytes');
  assert.equal(kept.recording.keptSave, true);
  // one too big to send goes without: the report still says it began from a save
  assert.equal((await packSaves([{ key: 'made-up-save', bytes: new Uint8Array(randomBytes(0x10000)) }])).length, 0);
  assert.equal((await packSaves([{ key: 'Not A Key', bytes: first }])).length, 0);
});

test('what isn\'t a save is refused', async () => {
  const packed = await packSave(Uint8Array.of(1, 2, 3));
  const refused = saves => assert.equal(typeof readReport(report({ saves })), 'string', JSON.stringify(saves).slice(0, 80));
  refused('a save');
  refused([null]);
  refused([{ key: 'made-up-save' }]);
  refused([{ key: '../etc', packed }]);
  refused([{ key: 'made-up-save', packed: '<script>' }]);
  refused([{ key: 'made-up-save', packed: '' }]);
  refused([{ key: 'made-up-save', packed }, { key: 'made-up-save', packed }]);
  refused(Array.from({ length: 5 }, (_, i) => ({ key: `save-${i}`, packed })));
  refused([{ key: 'a', packed: 'AAAA'.repeat(MOST_SAVES_PACKED / 8) }, { key: 'b', packed: 'AAAA'.repeat(MOST_SAVES_PACKED / 8 + 1) }]);
  // and what a save carries besides its key and bytes is dropped
  assert.deepEqual(readReport(report({ saves: [{ key: 'made-up-save', packed, note: 'typed' }] })).saves, [{ key: 'made-up-save', packed }]);
});

test('playing a report says where the Dreamport and the original part ways', () => {
  const same = partingLine('report-a', { result: { frames: 600, matched: 600, differs: [], soundDiffers: [] } });
  assert.match(same, /^report-a: the Dreamport and the original stay the same for all 600 frames/);
  const parted = partingLine('report-a', { result: { frames: 3000, matched: 1838, differs: [[1838, 1838]], soundDiffers: [] } }, '.dreamports/results/made-up/report-a/first-difference.png');
  assert.equal(parted, 'report-a: the Dreamport and the original part ways at frame 1838 of 3000, 31 seconds in, in what they show: .dreamports/results/made-up/report-a/first-difference.png.');
  assert.match(partingLine('report-a', { result: { frames: 3000, matched: 90, differs: [[90, 90]], soundDiffers: [[90, 90]] } }), /at frame 90 of 3000, 2 seconds in, in their sound\.$/);
  assert.equal(partingLine('report-a', { error: 'report-a: The game didn\'t start.' }), 'report-a: couldn\'t be played. The game didn\'t start.');
});
