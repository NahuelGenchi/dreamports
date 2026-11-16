// Stops (docs/STANDARD.md#stops): a path of the original a Dreamport's code says it hasn't ported, written as dp:stop
// and the address. The port map lists them (tools/portmap.mjs), and a function with one in it doesn't count towards
// code ported, however it's named or played (src/lib/entries.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STOP, namesAndStops } from '../portmap.mjs';
import { portedFunctions, proofOf, stoppedFunctions } from '../../src/lib/entries.mjs';

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

test('a function with a stop in it doesn\'t count towards code ported, named or played', () => {
  const whole = proofOf('made-up', files({ functions: [['08001000', 'src/a.c:1']], unmatched: [], stops: [] }));
  assert.equal(whole.ported.percent, 50);
  assert.deepEqual([whole.ported.stops, whole.ported.stopped, whole.ported.unnamed], [0, 0, 3]);

  // two stops in the named function, one in the played one
  const stops = [['08001000', 'src/a.c:9', '0x08001020'], ['08001000', 'src/a.c:12', '0x08001040'], ['08002000', 'src/b.c:3', '0x08002000']];
  const stopped = proofOf('made-up', files({ functions: [['08001000', 'src/a.c:1']], unmatched: [], stops }));
  assert.equal(stopped.ported.percent, 0);
  assert.deepEqual([stopped.ported.stops, stopped.ported.stopped, stopped.ported.unnamed], [3, 2, 3]);
  assert.equal(stopped.percent, 25, 'what ran in matching play is counted as it was');
});

test('a stop in no function of the code map is still a stop, and one in a function the map lacks fails', () => {
  const nowhere = proofOf('made-up', files({ functions: [], unmatched: [], stops: [[null, 'src/a.c:4', '0x08009000']] }));
  assert.deepEqual([nowhere.ported.stops, nowhere.ported.stopped, nowhere.ported.percent], [1, 0, 25]);
  assert.throws(() => proofOf('made-up', files({ functions: [], unmatched: [], stops: [['08007000', 'src/a.c:4', '0x08007000']] })), /port-map\.json counts 1 function the code map doesn't have/);
});

test('a port map from before stops counts as one with none', () => {
  const portMap = { functions: [['08001000', 'src/a.c:1']], unmatched: [] };
  assert.deepEqual([...stoppedFunctions(portMap)], []);
  assert.deepEqual([...portedFunctions(portMap, progress(['08002000']))].sort(), ['08001000', '08002000']);
});
