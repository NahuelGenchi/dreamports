// What a game's pieces need (src/lib/pieces.mjs): the rules for parts.json's foundations and needs, and which pieces are
// free to start. No GitHub here: pieces are as its API gives them.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { needsProblems, planOf, whatCanStart } from '../../src/lib/pieces.mjs';
import { proofOf } from '../../src/lib/entries.mjs';

const file = {
  foundations: [{ name: 'The fighting', needs: ['The arena'] }, { name: 'The arena' }],
  parts: [
    { name: 'The logos', recording: 'logos', frames: [0, 10] },
    { name: 'The menu', needs: ['The logos'] },
    { name: 'Story', needs: ['The fighting'] },
    { name: 'Battle', needs: ['The fighting', 'The menu'] },
    { name: 'Options' },
  ],
};
const piece = (number, title, state = 'open', assignees = []) => ({ number, title, state, assignees });
const pieces = [
  piece(1, 'Task: The menu'), piece(2, 'Task: Story'), piece(3, 'Task: Battle'), piece(4, 'Task: Options'),
  piece(5, 'Task: The fighting'), piece(6, 'Task: the arena'),
];
const numbers = list => list.map(p => p.number);

test('a plan has its foundations first, each piece with its needs', () => {
  assert.deepEqual(planOf(file).map(p => [p.name, p.foundation, p.needs.length]).slice(0, 3), [['The fighting', true, 1], ['The arena', true, 0], ['The logos', false, 0]]);
  assert.deepEqual(planOf(undefined), []);
});

test('finds nothing wrong with a good plan, and with one that has no foundations', () => {
  assert.deepEqual(needsProblems(file), []);
  assert.deepEqual(needsProblems({ parts: [{ name: 'One' }] }), []);
});

test('says what\'s wrong with needs', () => {
  const problems = (more, parts = [{ name: 'One' }]) => needsProblems({ parts, ...more }, 'games/x/proof/').join('\n');
  assert.match(problems({}, [{ name: 'One', needs: ['Nothing'] }]), /games\/x\/proof\/parts\.json's One needs Nothing, which isn't one of its foundations or parts/);
  assert.match(problems({}, [{ name: 'One', needs: ['one'] }]), /One needs itself/);
  assert.match(problems({}, [{ name: 'One', needs: 'Two' }, { name: 'Two' }]), /One has "needs" that aren't a list/);
  assert.match(problems({ foundations: 'Two' }), /"foundations" is a list/);
  assert.match(problems({ foundations: [{}] }), /a foundation with no "name"/);
  assert.match(problems({ foundations: [{ name: 'one' }] }), /lists one twice/i);
});

test('a game\'s proof doesn\'t add up with a name in needs that isn\'t in its file, which stops the build and the check', () => {
  const original = { name: 'Made Up', sha1: 'abc' };
  assert.throws(() => proofOf('made-up', { original, parts: { parts: [{ name: 'One', needs: ['Nothing'] }] } }), /One needs Nothing/);
  const parts = { foundations: [{ name: 'The fighting' }], parts: [{ name: 'One', needs: ['The fighting'] }, { name: 'Two' }] };
  assert.equal(proofOf('made-up', { original, parts }).gameplay.total, 2, 'foundations don\'t count towards the parts');
});

test('finds needs that go round in a circle, however long', () => {
  const circle = needsProblems({ parts: [{ name: 'A', needs: ['B'] }, { name: 'B', needs: ['C'] }, { name: 'C', needs: ['A'] }] });
  assert.equal(circle.length, 1);
  assert.match(circle[0], /A, then B, then C, then A/);
});

test('free has foundations first and leaves out what waits, what\'s taken and what\'s closed', () => {
  const { free, waiting } = whatCanStart([...pieces, piece(7, 'Task: Taken', 'open', [{ login: 'someone' }]), piece(8, 'Task: Closed', 'closed')], file);
  assert.deepEqual(numbers(free), [6, 1, 4]);
  assert.deepEqual(waiting.map(w => [w.piece.number, w.on.map(n => n.number)]), [[2, [5]], [3, [5, 1]], [5, [6]]]);
});

test('a part with no issue is finished once it names its recording, and a foundation with no issue isn\'t', () => {
  const { free, waiting } = whatCanStart([piece(1, 'Task: The menu'), piece(2, 'Task: Story')], file);
  assert.deepEqual(numbers(free), [1]);
  assert.deepEqual(waiting[0].on, [{ name: 'The fighting' }]);
});

test('a closed issue finishes what needs it, and so does a piece the team build holds', () => {
  const closed = pieces.map(p => (p.number === 5 || p.number === 6 ? { ...p, state: 'closed' } : p));
  assert.deepEqual(numbers(whatCanStart(closed, file).free), [1, 2, 4]);
  const { free } = whatCanStart(closed, file, new Set([1]));
  assert.deepEqual(numbers(free), [2, 3, 4], 'the menu is in the team build, so Battle can start, and the menu is nobody\'s to take');
});

test('a piece parts.json doesn\'t list waits on nothing, and no parts.json leaves every piece free', () => {
  assert.deepEqual(numbers(whatCanStart([piece(9, 'Task: A smaller task')], file).free), [9]);
  assert.deepEqual(numbers(whatCanStart(pieces, undefined).free), [1, 2, 3, 4, 5, 6]);
});

test('says how many unfinished pieces need a piece', () => {
  const { needing, isFoundation } = whatCanStart(pieces, file);
  assert.equal(needing(pieces[4]), 2, 'Story and Battle need the fighting');
  assert.equal(isFoundation(pieces[4]), true);
  assert.equal(isFoundation(pieces[0]), false);
});
