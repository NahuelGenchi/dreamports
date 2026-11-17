// A visit's presses as a recording (kit/gba/session.js), which the settings save as a file: what the game read at each
// frame, kept as changes, with the console's names for its buttons, and nothing else.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, noteStartSave, recordingText, savesAtStart, startOf } from '../../kit/gba/session.js';
import { cartridgeSave, proofStorage } from '../../kit/gba/save.js';
import { expand } from '../lib/recording.mjs';

const LAYOUT = { buttons: ['left', 'right', 'jump', 'boost'], gba: { left: 'LEFT', right: 'RIGHT', jump: 'A' } };

test('a session keeps what the game read as changes, by the console\'s names', () => {
  const session = createSession(LAYOUT);
  for (const held of [[], [], ['right'], ['right'], ['right', 'jump'], ['right'], [], ['boost']]) session.read({ held, pressed: [] });
  const recording = session.recording('What it plays.');
  assert.equal(recording.frames, 8);
  assert.deepEqual(recording.held, [[0, []], [2, ['RIGHT']], [4, ['A', 'RIGHT']], [5, ['RIGHT']], [6, []], [7, ['boost']]], 'a button the console doesn\'t have keeps the game\'s name');
  assert.deepEqual(expand(recording.held, 8), [[], [], ['RIGHT'], ['RIGHT'], ['A', 'RIGHT'], ['RIGHT'], [], ['boost']], 'and the tools read it back frame for frame');
  assert.equal(recording.start, undefined);
  assert.equal(recording.keptSave, undefined);
});

test('a press shorter than a frame is held for its first frame only', () => {
  const session = createSession(LAYOUT);
  session.read({ held: [], pressed: ['jump'] });      // pressed and let go within the frame
  session.read({ held: [], pressed: ['jump'] });      // "just pressed" still set, as the game hasn't cleared it
  session.read({ held: [], pressed: [] });
  assert.deepEqual(session.recording('x').held, [[0, ['A']], [1, []]]);
});

test('the address\'s start point is kept, and the proof tools\' own word left out', () => {
  assert.equal(startOf('?unlocked=8&character=3'), 'unlocked=8&character=3');
  assert.equal(startOf('?proof=record&level=1'), 'level=1');
  assert.equal(startOf('?proof'), '');
  assert.equal(startOf(''), '');
  const session = createSession(LAYOUT);
  session.read({ held: [] });
  assert.equal(session.recording('x', '?level=1').start, 'level=1');
});

test('the file is a recording a line to a change, and says when the game began from a save', () => {
  const session = createSession(LAYOUT);
  session.read({ held: ['left'] });
  session.read({ held: [] });
  const text = recordingText(session.recording('A session.'));
  assert.equal(text, '{\n  "about": "A session.",\n  "frames": 2,\n  "held": [\n    [0,["LEFT"]],\n    [1,[]]\n  ]\n}\n');
  assert.deepEqual(Object.keys(JSON.parse(text)), ['about', 'frames', 'held'], 'presses, and nothing of the game or of who played');
  // a key that held nothing as the game started isn't a save
  noteStartSave('made-up-empty', null);
  assert.deepEqual(savesAtStart(), []);
  assert.equal(createSession(LAYOUT).recording('A session.').keptSave, undefined);
});

test('the save a visit began from is kept, whatever the game writes after', () => {
  const kept = new Map([['made-up-save', btoa('\x01\x02\xFF')]]);
  const storage = { getItem: key => kept.get(key) ?? null, setItem: (key, text) => kept.set(key, text), removeItem: key => kept.delete(key) };
  const save = cartridgeSave('made-up-save', storage);
  assert.deepEqual([...save.read()], [1, 2, 255]);
  save.write(Uint8Array.of(9, 9, 9, 9));
  // the game's other saves opened later, and the same key opened again, change nothing of it
  cartridgeSave('made-up-save', storage);
  cartridgeSave('made-up-other', storage);
  cartridgeSave('made-up-apart', null);
  assert.deepEqual(savesAtStart().map(({ key, bytes }) => [key, [...bytes]]), [['made-up-save', [1, 2, 255]]]);
  const recording = JSON.parse(recordingText(createSession(LAYOUT).recording('A session.')));
  assert.equal(recording.keptSave, true);
  assert.deepEqual(recording.held, []);
});

test('a proof tool gives the game the saves a report began from, and they last the run', () => {
  globalThis.dreamportsProofSaves = { 'made-up-given': btoa('\x07\x08') };
  const storage = proofStorage();
  const save = cartridgeSave('made-up-given', storage);
  assert.deepEqual([...save.read()], [7, 8]);
  assert.equal(save.write(Uint8Array.of(1)), true);
  assert.deepEqual([...cartridgeSave('made-up-given', proofStorage()).read()], [1], 'what the game writes it reads back');
  assert.equal(cartridgeSave('made-up-none', storage).read(), null);
  assert.equal(globalThis.localStorage?.getItem?.('made-up-given') ?? null, null, 'and nothing of it is kept in the browser');
  delete globalThis.dreamportsProofSaves;
});
