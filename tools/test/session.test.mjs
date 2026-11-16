// A visit's presses as a recording (kit/gba/session.js), which the settings save as a file: what the game read at each
// frame, kept as changes, with the console's names for its buttons, and nothing else.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, noteKeptSave, recordingText, startOf } from '../../kit/gba/session.js';
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
  noteKeptSave();
  const kept = JSON.parse(recordingText(createSession(LAYOUT).recording('A session.')));
  assert.equal(kept.keptSave, true);
  assert.deepEqual(kept.held, []);
});
