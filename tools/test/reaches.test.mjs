// What a part reaches (src/lib/reaches.mjs): a part that names a goal is proven only when the original gets there within
// its frames, as Neo Green Hill Zone act 2 once counted as proven on a recording that never beat its boss. What prove
// does with it on a console is tried by npm run test:consoles.
// Run with: node --test tools/test/reaches.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reachedAt, reachesProblem, whyUnreached } from '../../src/lib/reaches.mjs';
import { proofOf } from '../../src/lib/entries.mjs';
import { goalsNamed, heldOver } from '../lib/route.mjs';
import { worseThan } from '../lib/as-before.mjs';

const route = {
  values: {
    x: { address: '03005A20', bytes: 4, signed: true, per: 256 },
    stage: { address: '03005004', bytes: 2 },
    boss: { found: { from: '03000600', to: '03001100', mark: '0804FD85' }, bytes: 1, signed: true },
  },
  cells: { x: 32 },
  goals: { 'act-end': 'stage&2', far: { when: 'x>=100,stage!&2', cells: { x: 16 } }, 'boss-comes': 'boss>=0' },
};

test('a goal counts when it comes true within the part\'s frames', () => {
  assert.equal(reachedAt([[120, 180]], [100, 200]), 120);
  assert.equal(reachedAt([[100, 100]], [100, 200]), 100, 'at its first frame');
  assert.equal(reachedAt([[200, 260]], [100, 200]), 200, 'at its last frame');
  assert.equal(reachedAt([[10, 20], [150, 160]], [100, 200]), 150, 'again, after an earlier time');
  assert.equal(reachedAt([[201, 260]], [100, 200]), null, 'a frame too late');
  assert.equal(reachedAt([[90, 180]], [100, 200]), null, 'one that held already says nothing of the part');
  assert.equal(reachedAt([], [100, 200]), null);
  assert.equal(reachedAt(undefined, [100, 200]), null);
});

test('why a goal doesn\'t count says where the original got to it', () => {
  assert.match(whyUnreached('act-end', [], [100, 200]), /never reaches act-end in this recording/);
  assert.match(whyUnreached('act-end', [[260, 300]], [100, 200]), /only reaches act-end at frame 260, past the part's last frame, 200/);
  assert.match(whyUnreached('act-end', [[90, 180]], [100, 200]), /already reached act-end at frame 90, before the part's first frame, 100/);
  assert.match(whyUnreached('act-end', [[10, 20], [260, 300]], [100, 200]), /only reaches act-end at frame 260/, 'the one a longer part would take in');
});

test('what a part says it reaches is a goal\'s name, measured since', () => {
  assert.equal(reachesProblem('act-end', { reached: { 'act-end': [] } }, 'act', 'part 1'), null);
  assert.equal(reachesProblem('act-end', null, '', 'part 1'), null, 'a part nothing plays yet');
  assert.match(reachesProblem('act-end', {}, 'act', 'part 1'), /part 1 says it reaches act-end, and act hasn't been proven since/);
  assert.match(reachesProblem('act-end', { reached: { other: [] } }, 'act', 'part 1'), /hasn't been proven since/);
  for (const wrong of ['', 'Act End', 3, null, ['act-end']]) assert.match(reachesProblem(wrong, null, '', 'part 1'), /part 1's "reaches" names one of the goals/, String(wrong));
});

test('prove reads each goal\'s values, once each', () => {
  const parts = [{ name: 'One', reaches: 'act-end' }, { name: 'Two', reaches: 'far' }, { name: 'Three', reaches: 'act-end' }, { name: 'Four' }];
  const named = goalsNamed(parts, route, 'games/made-up/proof/');
  assert.deepEqual(named.goals.map(goal => goal.name), ['act-end', 'far']);
  assert.deepEqual(named.values, [{ name: 'stage', address: 0x03005004, bytes: 2, signed: false }, { name: 'x', address: 0x03005A20, bytes: 4, signed: true }]);
  assert.deepEqual(goalsNamed([{ name: 'Four' }], null, 'here/'), { goals: [], values: [] }, 'a game whose parts name nothing needs no route.json');
});

test('a goal the game doesn\'t list, or one only the search can read, stops prove', () => {
  assert.throws(() => goalsNamed([{ name: 'One', reaches: 'the-end' }], route, 'games/made-up/proof/'), /reaches "the-end", which isn't one of the goals in games\/made-up\/proof\/route\.json: act-end, far, boss-comes/);
  assert.throws(() => goalsNamed([{ name: 'One', reaches: 'act-end' }], null, 'games/made-up/proof/'), /needs games\/made-up\/proof\/route\.json/);
  assert.throws(() => goalsNamed([{ name: 'One', reaches: 'boss-comes' }], route, 'games/made-up/proof/'), /reads boss, a value only the route finder's search can find/);
});

test('the frames a goal held over are kept as stretches', () => {
  const named = goalsNamed([{ name: 'One', reaches: 'act-end' }, { name: 'Two', reaches: 'far' }], route, 'here/');
  // each frame's stage, then its x: the act ends at frames 3 and 4, and x is past 100 pixels from frame 2, a negative x before
  const read = [0x21, 2 ** 32 - 256, 0, 50 * 256, 0, 100 * 256, 0x23, 120 * 256, 0x23, 120 * 256, 0x21, 130 * 256];
  assert.deepEqual(heldOver(named, read, 6, route), { 'act-end': [[3, 4]], far: [[2, 2], [5, 5]] });
  assert.deepEqual(heldOver(named, read.map((value, i) => (i % 2 ? value : 0)), 6, route)['act-end'], [], 'never');
});

const original = { name: 'Made Up', sha1: 'abc' };
const files = ({ reaches = 'act-end', reached, frames = [100, 200], differs = [] } = {}) => ({
  original,
  recordings: { act: { held: [], frames: 300 } },
  parts: { parts: [{ name: 'The act', recording: 'act', frames, ...(reaches === null ? {} : { reaches }) }, { name: 'The boss', reaches: 'act-end' }] },
  progress: { original: 'abc', recordings: { act: { frames: 300, matched: 300 - differs.length, differs, ...(reached ? { reached } : {}), functions: [] } } },
});

test('a part is proven only when the original gets to what it names within its frames', () => {
  const part = found => proofOf('made-up', files(found)).gameplay.parts[0];
  assert.deepEqual([part({ reached: { 'act-end': [[150, 200]] } }).proven, part({ reached: { 'act-end': [[150, 200]] } }).unreached], [true, null]);
  assert.deepEqual([part({ reached: { 'act-end': [] } }).proven, part({ reached: { 'act-end': [] } }).unreached], [false, 'act-end'], 'every frame the same, and it never gets there');
  assert.equal(part({ reached: { 'act-end': [[250, 280]] } }).proven, false, 'only past its last frame');
  assert.equal(part({ reached: { 'act-end': [[250, 280]] }, frames: [100, 260] }).proven, true, 'a longer part takes it in, with nothing proven again');
  assert.equal(part({ reached: { 'act-end': [[150, 200]] }, differs: [[120, 120]] }).proven, false, 'a frame that differs still counts');
  assert.equal(part({ reaches: null }).proven, true, 'a part that names nothing is held to its frames alone');
  assert.equal(proofOf('made-up', files({ reached: { 'act-end': [] } })).gameplay.proven, 0);
});

test('npm run check stops on a goal nothing has measured, and on one that is no name', () => {
  assert.throws(() => proofOf('made-up', files()), /part 1 says it reaches act-end, and act hasn't been proven since/);
  assert.throws(() => proofOf('made-up', files({ reaches: 'Act End', reached: { 'act-end': [] } })), /part 1's "reaches" names one of the goals/);
  const unplayed = files({ reached: { 'act-end': [[150, 200]] } });
  unplayed.parts.parts[1].reaches = 7;
  assert.throws(() => proofOf('made-up', unplayed), /part 2's "reaches" names one of the goals/);
});

test('a part that reached what it names before and doesn\'t now is a step back', () => {
  const row = (reached, more = {}) => ({ frames: 300, matched: 300, differs: [], reached: { 'act-end': reached }, functions: [], ...more });
  const unreached = [{ name: 'The act', goal: 'act-end', frames: [100, 200] }];
  assert.deepEqual(worseThan({ act: row([[150, 200]]) }, [{ name: 'act', row: row([]), unreached }]), [{ name: 'act', why: 'the original got to act-end within The act before and doesn\'t now' }]);
  assert.deepEqual(worseThan({ act: row([]) }, [{ name: 'act', row: row([]), unreached }]), [], 'as it was');
  assert.deepEqual(worseThan({ act: { frames: 300, matched: 300, differs: [], functions: [] } }, [{ name: 'act', row: row([]), unreached }]), [], 'never measured before, so found, not lost');
  assert.match(worseThan({}, [{ name: 'act', row: row([]), unreached }])[0].why, /nothing proved it before, and the original doesn't get to act-end, which The act says it reaches/);
  assert.deepEqual(worseThan({ act: row([[150, 200]]) }, [{ name: 'act', row: row([[150, 200]]), unreached: [] }]), []);
});
