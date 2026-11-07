// What a game's pieces need (src/lib/pieces.mjs): the rules for parts.json's foundations and needs, and which pieces are
// free to start. No GitHub here: pieces are as its API gives them.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { freeOrder, inReview, needsProblems, pieceOf, planOf, taskTitle, whatCanStart } from '../../src/lib/pieces.mjs';
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

test('free is in the order a player meets the parts, and leaves out what waits, what\'s taken and what\'s closed', () => {
  const { free, waiting } = whatCanStart([...pieces, piece(7, 'Task: Taken', 'open', [{ login: 'someone' }]), piece(8, 'Task: Closed', 'closed')], file);
  assert.deepEqual(numbers(free), [1, 6, 4], 'the menu, then the arena, which Story needs through the fighting, then Options');
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

test('a pull request that isn\'t a draft has the tasks it closes in review', () => {
  const pulls = [
    { number: 20, draft: false, body: 'Closes #5\n\nAlso fixes: #6, and refs #1.' },
    { number: 21, draft: true, body: 'Closes #4' },
    { number: 22, draft: false, body: 'Resolves NahuelGenchi/dreamports#3 and closes other/repo#2' },
    { number: 19, draft: false, body: 'closes #5' },
    { number: 23, draft: false, state: 'closed', body: 'Closes #7' },
    { number: 24, draft: false, body: null },
  ];
  assert.deepEqual([...inReview(pulls, 'NahuelGenchi/dreamports')], [[5, 19], [6, 20], [3, 22]], 'the first pull request for a task, no draft, no other repository, no "refs"');
});

test('a piece whose unfinished needs are all in review is free, on top of their pull requests', () => {
  const claimed = pieces.map(p => (p.number === 6 ? { ...p, state: 'closed' } : p.number === 5 ? { ...p, assignees: [{ login: 'someone' }] } : p));
  const before = whatCanStart(claimed, file);
  assert.deepEqual(numbers(before.free), [1, 4], 'the fighting is claimed, so Story waits');
  const reviewing = new Map([[5, 30]]);
  const { free, waiting, buildsOn } = whatCanStart(claimed, file, new Set(), { reviewing });
  assert.deepEqual(numbers(free), [1, 2, 4], 'Story starts on top of the fighting\'s pull request');
  assert.deepEqual(buildsOn(claimed[1]), [{ name: 'The fighting', number: 5, pull: 30 }]);
  assert.deepEqual(buildsOn(claimed[0]), [], 'the menu needs nothing unfinished');
  assert.deepEqual(waiting.map(w => [w.piece.number, w.on]), [[3, [{ name: 'The fighting', number: 5, pull: 30 }, { name: 'The menu', number: 1 }]]], 'Battle also needs the menu, which nobody has finished');
  const both = whatCanStart(claimed, file, new Set(), { reviewing: new Map([[5, 30], [1, 31]]) });
  assert.deepEqual(numbers(both.free), [2, 3, 4], 'with the menu in review too, Battle starts on both, and the menu is nobody\'s to take');
  assert.deepEqual(both.buildsOn(claimed[2]).map(b => b.pull), [30, 31]);
});

test('a piece in C starts on top of the same piece in JavaScript while that one is in review', () => {
  const twins = [piece(1, 'Task: Options'), piece(2, 'Task: Options in C')];
  assert.deepEqual(numbers(whatCanStart(twins, file).free), [1]);
  const { free, buildsOn } = whatCanStart(twins, file, new Set(), { reviewing: new Map([[1, 40]]) });
  assert.deepEqual(numbers(free), [2]);
  assert.deepEqual(buildsOn(twins[1]), [{ name: 'Options', number: 1, pull: 40 }]);
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

test('a task in another language is the same part with the language\'s name after it', () => {
  assert.deepEqual(pieceOf(piece(1, 'Task: The menu in C')), { name: 'The menu', language: 'c' });
  assert.deepEqual(pieceOf(piece(1, 'Task: The menu')), { name: 'The menu', language: 'js' });
  assert.deepEqual(pieceOf(piece(1, 'Task: in C')), { name: 'in C', language: 'js' });
  assert.equal(taskTitle('The menu', 'c'), 'Task: The menu in C');
  assert.equal(taskTitle('The menu'), 'Task: The menu');
});

test('a piece in C waits for the same piece in JavaScript, and for what it needs in C', () => {
  const inC = [
    piece(11, 'Task: The menu in C'), piece(12, 'Task: Options in C'), piece(13, 'Task: The arena in C'), piece(14, 'Task: The fighting in C'),
    piece(15, 'Task: The logos in C'),
  ];
  // Options and the arena are finished in JavaScript; the menu and the fighting aren't
  const js = pieces.map(p => (p.number === 4 || p.number === 6 ? { ...p, state: 'closed' } : p));
  const { free, waiting } = whatCanStart([...js, ...inC], file);
  assert.deepEqual(numbers(free).filter(n => n > 10), [15, 13, 12], 'the logos, which parts.json proves in JavaScript, then the arena, which Story needs, then Options');
  assert.ok(numbers(free).findIndex(n => n < 10) > numbers(free).findLastIndex(n => n > 10), 'C, the default language, comes first');
  const on = Object.fromEntries(waiting.map(w => [w.piece.number, w.on]));
  assert.deepEqual(on[11], [{ name: 'The menu', number: 1 }, { name: 'The logos in C', number: 15 }]);
  assert.deepEqual(on[14], [{ name: 'The fighting', number: 5 }, { name: 'The arena in C', number: 13 }]);
  // a need with no task in C yet isn't finished, though parts.json proves it in JavaScript
  const alone = whatCanStart([...pieces, { ...piece(1, 'Task: The menu'), state: 'closed' }, piece(21, 'Task: The menu in C')].filter(p => p.number !== 1 || p.state === 'closed'), file);
  assert.deepEqual(alone.waiting.find(w => w.piece.number === 21).on, [{ name: 'The logos in C' }]);
  // and the JavaScript pieces are free as they were
  assert.deepEqual(numbers(free).filter(n => n < 10), numbers(whatCanStart(js, file).free));
});

test('a game that started in C has its pieces in C alone, which wait on nothing in JavaScript', () => {
  const inC = [
    piece(11, 'Task: The menu in C'), piece(12, 'Task: Options in C'), piece(13, 'Task: The arena in C'), piece(14, 'Task: The fighting in C'),
    piece(16, 'Task: Story in C'),
  ];
  const { free, waiting } = whatCanStart(inC, file, new Set(), { main: 'c' });
  // the logos have no task, and parts.json names their recording, proven in C as the game has no other version
  assert.deepEqual(numbers(free), [11, 13, 12]);
  const on = Object.fromEntries(waiting.map(w => [w.piece.number, w.on]));
  assert.deepEqual(on[14], [{ name: 'The arena in C', number: 13 }]);
  assert.deepEqual(on[16], [{ name: 'The fighting in C', number: 14 }]);
  // a JavaScript version added later waits for the same part in C, as it's written from it
  const later = whatCanStart([...inC, piece(21, 'Task: Options')], file, new Set(), { main: 'c' });
  assert.deepEqual(later.waiting.find(w => w.piece.number === 21).on, [{ name: 'Options in C', number: 12 }]);
});

test('work goes in the order a player meets it, C first, each foundation just before the first part that needs it', () => {
  const plan = planOf({
    foundations: [{ name: 'The fighting', needs: ['The arena'] }, { name: 'The arena' }, { name: 'A spare tool' }],
    parts: [{ name: 'The intro' }, { name: 'The title screen' }, { name: 'The menu' }, { name: 'Story', needs: ['The fighting'] }, { name: 'Options' }],
  });
  const titles = ['Task: A spare tool', 'Task: Options', 'Task: The fighting', 'Task: Story', 'Task: The arena', 'Task: The menu in C', 'Task: An extra', 'Task: The fighting in C', 'Task: The title screen in C', 'Task: The intro'];
  const ordered = freeOrder(titles.map((title, number) => piece(number, title)), plan).map(p => p.title.replace('Task: ', ''));
  assert.deepEqual(ordered, ['The title screen in C', 'The menu in C', 'The fighting in C', 'The intro', 'The arena', 'The fighting', 'Story', 'Options', 'A spare tool', 'An extra']);
});

test('a foundation needed through another comes before it, and needs that go round in a circle still give an order', () => {
  const plan = planOf({ foundations: [{ name: 'Top', needs: ['Middle'] }, { name: 'Middle', needs: ['Bottom'] }, { name: 'Bottom' }, { name: 'Loop', needs: ['Loop 2'] }, { name: 'Loop 2', needs: ['Loop'] }], parts: [{ name: 'Part', needs: ['Top'] }] });
  const ordered = freeOrder(['Task: Top', 'Task: Part', 'Task: Middle', 'Task: Loop', 'Task: Bottom', 'Task: Loop 2'].map((title, number) => piece(number, title)), plan).map(p => p.title.replace('Task: ', ''));
  assert.deepEqual(ordered, ['Bottom', 'Middle', 'Top', 'Part', 'Loop', 'Loop 2']);
});
