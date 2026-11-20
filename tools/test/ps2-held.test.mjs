// What a PlayStation 2 holds, as `prove` compares it, without the emulator: memory cards written as one run of bytes
// (kit/ps2/card.js) and compared file by file (lib/saves.mjs), and the console's three memories listed and compared by
// original.json's "workMemory" (lib/memory.mjs). The same on the real emulator is npm run test:ps2-memory.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardBytes, cardEntries } from '../../kit/ps2/card.js';
import { compareCardSaves } from '../lib/saves.mjs';
import { compareMemory, describeMemory, memorySpec, workMemoryOf } from '../lib/memory.mjs';

const bytes = text => Uint8Array.from(Buffer.from(text));

test('memory cards are one run of bytes, each folder before what it holds, in the order of the names\' bytes', () => {
  const written = cardBytes([{ path: 'mc1/B', bytes: bytes('b') }, { path: 'mc0/SAVE/DATA', bytes: bytes('data') }, { path: 'mc0/SAVE/A:1', bytes: bytes('a') }]);
  assert.deepEqual(cardEntries(written).map(({ path, folder, bytes: held }) => [path, folder, held && Buffer.from(held).toString()]), [
    ['mc0/SAVE', true, null], ['mc0/SAVE/A:1', false, 'a'], ['mc0/SAVE/DATA', false, 'data'], ['mc1/B', false, 'b'],
  ]);
  assert.deepEqual(cardBytes(cardEntries(written).map(({ path, bytes: held }) => ({ path, ...(held ? { bytes: held } : {}) }))), written, 'read and written again, the same bytes');
  assert.throws(() => cardBytes([{ path: 'mc2/X', bytes: bytes('x') }]), /mc0/);
});

test('memory cards are compared file by file, and the first that differs is named, with its byte', () => {
  const card = (data, more = []) => cardBytes([{ path: 'mc0/SAVE/DATA', bytes: bytes(data) }, ...more]);
  const same = compareCardSaves([{ frame: 100, bytes: card('abcd') }], [{ frame: 100, bytes: card('abcd') }]);
  assert.deepEqual(same, { original: 1, dreamport: 1, same: 1, first: null });
  const byte = compareCardSaves([{ frame: 100, bytes: card('abcd') }], [{ frame: 101, bytes: card('abXd') }]);
  assert.deepEqual(byte.first, { write: 1, frame: 100, file: 'mc0/SAVE/DATA', at: 2, original: 'c'.charCodeAt(0), dreamport: 'X'.charCodeAt(0) });
  const missing = compareCardSaves([{ frame: 100, bytes: card('abcd', [{ path: 'mc0/SAVE/icon.sys', bytes: bytes('i') }]) }], [{ frame: 100, bytes: card('abcd') }]);
  assert.deepEqual(missing.first, { write: 1, frame: 100, file: 'mc0/SAVE/icon.sys', at: null, original: 'a file', dreamport: 'nothing' });
  const never = compareCardSaves([{ frame: 100, bytes: card('abcd') }], []);
  assert.deepEqual(never.first, { write: 1, frame: 100, file: null, at: null });
  // changes within a second of each other are one write, as a game writes a save a file at a time
  const writes = compareCardSaves([{ frame: 100, bytes: card('ab') }, { frame: 120, bytes: card('abcd') }], [{ frame: 130, bytes: card('abcd') }]);
  assert.equal(writes.same, 1);
});

test('the PlayStation 2\'s three memories are listed by which, at their own addresses, and named where they differ', () => {
  const stretches = workMemoryOf({ console: 'ps2', workMemory: [{ address: '00100000', bytes: 16 }, { address: '1100C000', bytes: 4 }, { memory: 'iop', address: '00001000', bytes: 4 }, { memory: 'spu2', address: '001FFFFC', bytes: 4 }] }, 'original.json');
  assert.deepEqual(stretches.map(s => s.memory), [0, 0, 1, 2]);
  assert.deepEqual([...new Uint32Array(memorySpec(stretches, 7).buffer)], [7, 0, 0x00100000, 16, 0, 0x1100C000, 4, 1, 0x1000, 4, 2, 0x1FFFFC, 4], 'the frame, then each stretch as which, where and how many bytes');
  assert.throws(() => workMemoryOf({ console: 'ps2', workMemory: [{ address: '02000000', bytes: 4 }] }, 'original.json'), /aren't all in the console's memory/, 'main memory is 32 MB');
  assert.throws(() => workMemoryOf({ console: 'ps2', workMemory: [{ memory: 'iop', address: '00000000', bytes: 4 }, { address: '00000000', bytes: 4 }] }, 'original.json'), /the EE's first/);
  assert.throws(() => workMemoryOf({ console: 'gba', workMemory: [{ memory: 'iop', address: '02000000', bytes: 4 }] }, 'original.json'), /workMemory/, 'only a console with several memories names one');
  const original = new Uint8Array(28), dreamport = new Uint8Array(28);
  dreamport[17] = 1;
  dreamport[27] = 2;
  const found = compareMemory(stretches, original, dreamport, 'ps2');
  assert.equal(found.first.address, "0x1100C001, in vector unit 1's data");
  assert.match(describeMemory(5, found, 28, 'ps2'), /The console's memory first differs after frame 5: 2 of 28 bytes, the first at 0x1100C001, in vector unit 1's data, .* They are at 0x1100C001 in vector unit 1's data, 0x001FFFFF in the SPU2's memory\./);
});
