// What a Dreamport saves next to the original's cartridge (tools/lib/saves.mjs): a write is a run of changes close
// together, and the Dreamport's count only when they leave the save memory byte for byte as the original's.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ONE_WRITE, compareSaves, writesIn } from '../lib/saves.mjs';
import { proofOf } from '../../src/lib/entries.mjs';

const bytes = (...values) => Uint8Array.from(values);

test('changes close together are one write, with what the last of them left', () => {
  const changes = [{ frame: 100, bytes: bytes(1) }, { frame: 110, bytes: bytes(1, 2) }, { frame: 110 + ONE_WRITE, bytes: bytes(1, 2, 3) }, { frame: 900, bytes: bytes(9) }];
  assert.deepEqual(writesIn(changes).map(w => [w.frame, [...w.bytes]]), [[110 + ONE_WRITE, [1, 2, 3]], [900, [9]]]);
  assert.deepEqual(writesIn([]), []);
});

test('a write is the same only byte for byte, and the first that differs is named', () => {
  const original = [{ frame: 100, bytes: bytes(1, 2, 3, 4) }, { frame: 900, bytes: bytes(5, 6, 7, 8) }];
  assert.deepEqual(compareSaves(original, [{ frame: 98, bytes: bytes(1, 2, 3, 4) }, { frame: 899, bytes: bytes(5, 6, 7, 8) }]),
    { original: 2, dreamport: 2, same: 2, first: null });
  assert.deepEqual(compareSaves(original, [{ frame: 98, bytes: bytes(1, 2, 3, 4) }, { frame: 899, bytes: bytes(5, 6, 0, 8) }]),
    { original: 2, dreamport: 2, same: 1, first: { write: 2, frame: 900, at: 2, original: 7, dreamport: 0 } });
  assert.equal(compareSaves(original, [{ frame: 98, bytes: bytes(1, 2, 3, 4) }, { frame: 899, bytes: bytes(5, 6, 0, 8) }], [[2, 2]]).same, 2, 'a byte the game lists as not its save isn\'t compared');
  assert.deepEqual(compareSaves(original, [{ frame: 98, bytes: bytes(1, 2, 3) }]).first, { write: 1, frame: 100, at: 3, original: 4, dreamport: null }, 'a shorter save memory differs past its end');
  assert.deepEqual(compareSaves(original, []), { original: 2, dreamport: 0, same: 0, first: { write: 1, frame: 100, at: null } });
  assert.deepEqual(compareSaves([], [{ frame: 5, bytes: bytes(1) }]), { original: 0, dreamport: 1, same: 0, first: { write: 1, frame: null, at: null } });
  assert.deepEqual(compareSaves([], []), { original: 0, dreamport: 0, same: 0, first: null });
});

test('a proof says how many of the original\'s writes came out the same, and where they don\'t', () => {
  const row = saves => ({ frames: 10, matched: 10, differs: [], functions: [], ...(saves ? { saves } : {}) });
  const proof = proofOf('made-up', {
    original: { name: 'Made Up', sha1: 'abc' },
    progress: { original: 'abc', recordings: { a: row({ original: 2, dreamport: 2, same: 2 }), b: row({ original: 1, dreamport: 1, same: 0 }), c: row({ original: 0, dreamport: 1, same: 0 }), d: row(null) } },
  });
  assert.deepEqual(proof.saves, { original: 3, same: 2, differ: ['b', 'c'] });
  assert.equal(proofOf('made-up', { original: { name: 'Made Up', sha1: 'abc' }, progress: { original: 'abc', recordings: { d: row(null) } } }).saves, undefined);
});
