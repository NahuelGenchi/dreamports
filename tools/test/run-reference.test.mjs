// How the tools read what the program that runs the original hands over (lib/run-reference.mjs): every frame or a plain
// error, never a frame read from the middle of a picture (#2097). A stand-in program, this Node.js itself, hands over a
// stream as host.c writes one: for each frame its picture's hash, its one colour, how many functions ran and their
// numbers, and its picture when one is wanted, and on stderr the line that says what it ran at.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runReference } from '../lib/run-reference.mjs';

const WIDTH = 4, HEIGHT = 2, FRAMES = 4;
// Every pixel is 0x0400, the lower screen's colour in the Nintendo DS's test while X is held: two of them read as a
// count of functions are 67,109,888, as the run that found this read them. With RAN, the odd frames' lists have one
// function. PICTURES is how many it hands over, from frame 1 on, and LOSE a frame whose picture it leaves out.
const STAND_IN = `
const [FRAMES, PICTURES, LOSE, RAN] = process.argv.slice(-4).map(Number), out = [];
const word = value => { const b = Buffer.alloc(4); b.writeUInt32LE(value >>> 0); out.push(b); };
for (let frame = 0; frame < FRAMES; frame++) {
  const ran = RAN ? frame % 2 : 0;
  word(0x1000 + frame); word(-1); word(ran); if (ran) word(0);
  if (frame >= 1 && frame <= PICTURES && frame !== LOSE) out.push(Buffer.alloc(${WIDTH * HEIGHT * 2}, Buffer.from([0x00, 0x04])));
}
process.stdout.write(Buffer.concat(out), () => process.stderr.write('{"rate":1,"fps":1,"sizes":[]}\\n'));
`;

const run = ({ handed = 2, wanted = handed, lose = 0, functions = [{ address: 0x100, size: 4 }] } = {}) => runReference({
  program: process.execPath, args: () => ['-e', STAND_IN, String(FRAMES), String(handed), String(lose), functions.length ? '1' : '0'],
  width: WIDTH, height: HEIGHT, frames: FRAMES, buttons: new Array(FRAMES).fill(0), functions,
  pictures: Array.from({ length: wanted }, (_, i) => i + 1),
});

test('a whole stream is read frame by frame', async () => {
  for (const functions of [[{ address: 0x100, size: 4 }], []]) {
    const read = await run({ functions });
    assert.deepEqual([...read.hashes], [0x1000, 0x1001, 0x1002, 0x1003]);
    assert.deepEqual([...read.plain], [-1, -1, -1, -1]);
    assert.deepEqual(read.ran.map(list => [...list]), functions.length ? [[], [0], [], [0]] : [[], [], [], []]);
    assert.deepEqual([...read.pictures.keys()], [1, 2]);
    assert.ok([...read.pictures.get(2)].every(pixel => pixel === 0x0400));
  }
});

test('a stream with part of it missing is a plain error, not a picture read as a frame', async () => {
  await assert.rejects(run({ lose: 1 }), error => {
    assert.doesNotMatch(error.message, /typed array/);
    assert.match(error.message, /^The original's emulator handed over 72 bytes, which don't hold its 4 frames as the tools read them: frame 2 says 67,109,888 functions ran, more than what's left holds\./);
    return true;
  });
  await assert.rejects(run({ lose: 2 }), /handed over 72 bytes, which don't hold its 4 frames as the tools read them: it ends before frame 3/);
});

test('a stream with more than was asked for is one too', async () => {
  await assert.rejects(run({ handed: 3, wanted: 2 }), /handed over 104 bytes, which don't hold its 4 frames as the tools read them: 16 bytes are left after the last frame/);
});

test('with no functions, where the stream\'s size is known, a short or a long one is a plain error', async () => {
  await assert.rejects(run({ functions: [], lose: 2 }), /handed over 64 bytes, which don't hold its 4 frames as the tools read them: 80 were wanted/);
  await assert.rejects(run({ functions: [], handed: 3, wanted: 2 }), /handed over 96 bytes, which don't hold its 4 frames as the tools read them: 80 were wanted/);
});
