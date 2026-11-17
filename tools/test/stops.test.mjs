// Stops (docs/STANDARD.md#stops): a path of the original a Dreamport's code says it hasn't ported, written as dp:stop
// and the address. The port map lists them (tools/portmap.mjs), and a function with one in it doesn't count towards
// code ported, though it's named. Neither does one no code names, though it ran in matching play (src/lib/entries.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STOP, namesAndStops } from '../portmap.mjs';
import { isBeingMade, leftToDo, portedFunctions, proofOf, stoppedFunctions } from '../../src/lib/entries.mjs';

const names = line => [...line.matchAll(/0x0?([238][0-9A-F]{6})/g)].map(([name, digits]) => [name, parseInt(digits, 16), false]);

test('the names after dp:stop on a line are stops, and those before it still names', () => {
  assert.deepEqual(namesAndStops('/** 0x08001000: the menu. */', names), [[['0x08001000', 0x08001000, false]], []]);
  assert.deepEqual(namesAndStops('  if (paused) { stop(); return; }   // dp:stop 0x08001020', names), [[], [['0x08001020', 0x08001020, false]]]);
  assert.deepEqual(namesAndStops('// 0x08001000 goes on to the save. dp:stop 0x08002000 0x08003000', names),
    [[['0x08001000', 0x08001000, false]], [['0x08002000', 0x08002000, false], ['0x08003000', 0x08003000, false]]]);
  assert.ok(!STOP.test('// the game stops here'), 'only the words dp:stop mark one');
  assert.ok(!STOP.test('// xdp:stop 0x08001000'));
});

const original = { name: 'Made Up', sha1: 'abc' };
const map = { original: 'abc', functions: [['08001000', 100], ['08002000', 100], ['08003000', 100], ['08004000', 100]] };
const progress = functions => {
  const proven = functions.reduce((sum, key) => sum + map.functions.find(([k]) => k === key)[1], 0);
  return {
    original: 'abc', percent: Math.round(proven / 400 * 10000) / 100, codeMap: { functions: 4, bytes: 400 }, proven: { functions: functions.length, bytes: proven },
    recordings: { walk: { frames: 10, matched: 10, differs: [], functions } },
  };
};
const files = (portMap, played = ['08002000']) => ({ original, map, progress: progress(played), portMap: { original: 'abc', ...portMap }, recordings: { walk: { held: [], frames: 10 } } });

test('only a function the code names counts towards code ported, and not one with a stop in it', () => {
  const whole = proofOf('made-up', files({ functions: [['08001000', 'src/a.c:1']], unmatched: [], stops: [] }));
  assert.equal(whole.ported.percent, 25, 'the function that only ran in matching play has no twin');
  assert.deepEqual([whole.ported.functions, whole.ported.named, whole.ported.played], [1, 1, 1], 'and it still shows as played with no name');
  assert.deepEqual([whole.ported.stops, whole.ported.stopped, whole.ported.unnamed], [0, 0, 3]);
  // once the code names it too, it counts
  const both = proofOf('made-up', files({ functions: [['08001000', 'src/a.c:1'], ['08002000', 'src/b.c:1']], unmatched: [], stops: [] }));
  assert.deepEqual([both.ported.percent, both.ported.functions, both.ported.played, both.ported.unnamed], [50, 2, 0, 2]);

  // two stops in the named function, one in the played one
  const stops = [['08001000', 'src/a.c:9', '0x08001020'], ['08001000', 'src/a.c:12', '0x08001040'], ['08002000', 'src/b.c:3', '0x08002000']];
  const stopped = proofOf('made-up', files({ functions: [['08001000', 'src/a.c:1']], unmatched: [], stops }));
  assert.equal(stopped.ported.percent, 0);
  assert.deepEqual([stopped.ported.stops, stopped.ported.stopped, stopped.ported.unnamed], [3, 2, 3]);
  assert.equal(stopped.percent, 25, 'what ran in matching play is counted as it was');
});

test('a stop in no function of the code map is still a stop, and one in a function the map lacks fails', () => {
  const nowhere = proofOf('made-up', files({ functions: [], unmatched: [], stops: [[null, 'src/a.c:4', '0x08009000']] }));
  assert.deepEqual([nowhere.ported.stops, nowhere.ported.stopped, nowhere.ported.percent], [1, 0, 0]);
  assert.throws(() => proofOf('made-up', files({ functions: [], unmatched: [], stops: [['08007000', 'src/a.c:4', '0x08007000']] })), /port-map\.json counts 1 function the code map doesn't have/);
});

test('a port map from before stops counts as one with none', () => {
  const portMap = { functions: [['08001000', 'src/a.c:1']], unmatched: [] };
  assert.deepEqual([...stoppedFunctions(portMap)], []);
  assert.deepEqual([...portedFunctions(portMap)], ['08001000']);
  assert.equal(proofOf('made-up', files(portMap)).ported.percent, 25);
});

test('a version that keeps its functions\' proofs isn\'t done while one has none, and one that keeps none is asked for none', () => {
  const portMap = { functions: [['08001000', 'c/a.c:1'], ['08002000', 'c/a.c:9'], ['08003000', 'c/b.c:3']], unmatched: [], stops: [['08002000', 'c/a.c:12', '0x08002020']] };
  const lines = [['08001000', 'bytes', 'a'.repeat(16), 'b'.repeat(16)], ['08002000', 'memory', 'a'.repeat(16), 'b'.repeat(16), 2000], ['08003000', 'memory', 'a'.repeat(16), 'b'.repeat(16), 2000]];
  const proof = proofOf('made-up/c', { ...files(portMap), proofs: { original: 'abc', functions: lines } });
  // the function with a stop isn't proven, whatever its line says, and the fourth has no twin at all
  assert.deepEqual(proof.proofs, { bytes: 1, memory: 1, unproven: 2 });
  assert.ok(leftToDo(proof).includes('2 functions with no proof'));
  assert.equal(proofOf('made-up/c', files(portMap)).proofs, undefined);
  assert.ok(!leftToDo(proofOf('made-up/c', files(portMap))).some(line => /proof/.test(line)));
  assert.throws(() => proofOf('made-up/c', { ...files(portMap), proofs: { original: 'other', functions: [] } }), /proofs\.json is for another copy/);
  assert.throws(() => proofOf('made-up/c', { ...files(portMap), proofs: { original: 'abc', functions: [['08009999', 'bytes', 'a', 'b']] } }), /proofs\.json counts 1 function the code map doesn't have/);
});

test('a Dreamport is done only with both numbers whole, no stop, every function named and every save the same', () => {
  const whole = { ported: { percent: 100, stops: 0, unnamed: 0 }, gameplay: { percent: 100 } };
  assert.deepEqual(leftToDo(whole), []);
  assert.equal(isBeingMade({ screen: 'x.webm' }, whole), false);
  assert.deepEqual(leftToDo({ ported: { percent: 100, stops: 2, unnamed: 1 }, gameplay: { percent: 99.99 }, saves: { original: 3, same: 2, differ: ['a'] } }),
    ['gameplay proven is 99.99%', '2 stops in its code', '1 function of the original no code names', "its saves differ from the original's in 1 recording"]);
  // every part proven no longer makes it done
  assert.equal(isBeingMade({ screen: 'x.webm' }, { ...whole, ported: { percent: 100, stops: 1, unnamed: 0 } }), true);
  assert.equal(isBeingMade({}, { ported: { percent: 5 }, gameplay: { percent: 0 } }), false, 'not before its card has a capture');
  assert.deepEqual(leftToDo(null), ['code ported is not measured yet', 'gameplay proven is not measured yet']);
});
