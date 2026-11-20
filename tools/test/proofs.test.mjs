// A version's proofs, function by function (../lib/proofs.mjs): what a proof is a proof of, when it goes stale, what
// can't be kept as proven, and the tasks a version made a function at a time has (../tasks.mjs), all on a made-up
// program in a folder of its own.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { twinsIn } from '../gba/match.mjs';
import { parseCodeMap } from '../lib/proof-files.mjs';
import { beyondProof, countsOf, formatProofs, groupNamed, groupsOf, markOf, marksIn, parseProofs, stateOf, stateText, withProofs } from '../lib/proofs.mjs';
import { functionTaskText, functionTasks } from '../tasks.mjs';
import { whatToTake } from '../lib/take.mjs';
import { whatCanStart } from '../../src/lib/pieces.mjs';
import { field } from '../lib/claims.mjs';

const HEADER = '#define FLOOR 100\nextern int gY;\n';
const PROGRAM = [
  '#include "game.h"',
  '',
  '/** Fall, 0x08000200: the ball a frame further down. */',
  'void Fall(void) {',
  '  if (gY > FLOOR) gY = FLOOR; // stopped at the floor',
  '}',
  '',
  '/** Step, 0x08000240: a step on. */',
  'void Step(void) { gY += 3; }',
  '',
  '/** Skip, 0x08000260: far on. */',
  'void Skip(void) { gY += 100; }',
  '',
].join('\n');
const codeMap = { ...parseCodeMap({ original: 'abc', functions: [['08000200', 40], ['08000240', 12, 'StepOn'], ['08000260', 12], ['08000300', 20], ['03000100/0011223344556677', 16]] }), console: 'gba' };
const ORIGINAL = new Map(codeMap.functions.map(f => [f.key, `bytes of ${f.key}`]));

// a version's folder with the program in it, and what reads it as the tools do
function version(program = PROGRAM, header = HEADER) {
  const folder = mkdtempSync(join(tmpdir(), 'dp-proofs-'));
  mkdirSync(join(folder, 'src'));
  writeFileSync(join(folder, 'src', 'game.h'), header);
  writeFileSync(join(folder, 'src', 'game.c'), program);
  const files = [join(folder, 'src', 'game.c')];
  return { folder, files, twinsOf: new Map(files.map(file => [file, twinsIn(readFileSync(file, 'utf8'))])) };
}
const marksOf = (program, header) => {
  const made = version(program, header);
  try {
    return marksIn(codeMap, made);
  } finally {
    rmSync(made.folder, { recursive: true, force: true });
  }
};
const mark = (bytes = ORIGINAL) => f => markOf(bytes.get(f.key));
// the lines `match` would keep of the program as it is: Fall and Step by the same bytes
const proven = (marks = marksOf()) => withProofs(new Map(), { kind: 'bytes', proven: [{ key: '08000200' }, { key: '08000240' }], functions: codeMap.functions, marks, stopped: new Set(), mark: mark() }).functions;
const states = options => new Map(stateOf('made-up/c', { codeMap, stopped: new Set(), mark: mark(), marks: marksOf(), ...options }).map(state => [state.key, state]));

test('a twin of a run is the twin of each function of it, with one mark', () => {
  const marks = marksOf(PROGRAM.replace('/** Fall, 0x08000200: the ball a frame further down. */', '/** Fall, 0x08000200 to 0x08000260: the ball a frame further down, as one routine. */').replace(/\/\*\* Step[^\n]*\n[^\n]*\n\n\/\*\* Skip[^\n]*\n[^\n]*\n/, ''));
  assert.deepEqual([...marks.keys()], ['08000200', '08000240', '08000260']);
  assert.ok([...marks.values()].every(each => each.name === 'Fall' && each.mark === marks.get('08000200').mark));
});

test('how a hand-written routine takes and gives in registers is part of its twin\'s mark, as the rest of its comment isn\'t', () => {
  const plain = marksOf(), said = marksOf(PROGRAM.replace('/** Step, 0x08000240: a step on. */', '/** Step, 0x08000240: a step on, dp:registers r3 = (Step(), r3) */'));
  const other = marksOf(PROGRAM.replace('/** Step, 0x08000240: a step on. */', '/** Step, 0x08000240: a step on, dp:registers r2 = (Step(), r2) */'));
  assert.notEqual(said.get('08000240').mark, plain.get('08000240').mark);
  assert.notEqual(other.get('08000240').mark, said.get('08000240').mark);
  assert.equal(said.get('08000200').mark, plain.get('08000200').mark);
});

test('a twin that gives its routine\'s length is the twin of each function of the run it covers, and of its first alone when the length ends in a function', () => {
  const run = length => marksOf(PROGRAM.replace('/** Fall, 0x08000200: the ball a frame further down. */', `/** Fall, 0x08000200, dp:run ${length}: the ball a frame further down, as one routine. */`).replace(/\/\*\* Step[^\n]*\n[^\n]*\n\n\/\*\* Skip[^\n]*\n[^\n]*\n/, ''));
  assert.deepEqual([...run(0x6C).keys()], ['08000200', '08000240', '08000260']);
  assert.deepEqual([...run(0x4C).keys()], ['08000200', '08000240']);
  assert.deepEqual([...run(0x50).keys()], ['08000200']);
});

test('a twin is marked by its code and its file\'s own headers, and not by its comments or its spaces', () => {
  const marks = marksOf();
  assert.deepEqual([...marks.keys()], ['08000200', '08000240', '08000260']);
  assert.deepEqual(marks.get('08000240'), { name: 'Step', file: 'src/game.c', line: 9, mark: marks.get('08000240').mark });
  assert.match(marks.get('08000200').mark, /^[0-9a-f]{16}$/);
  const reworded = marksOf(PROGRAM.replace('// stopped at the floor', '/* it stops at the floor */').replace('void Step(void) { gY += 3; }', 'void Step(void)\n{\n  gY += 3;\n}'));
  assert.equal(reworded.get('08000200').mark, marks.get('08000200').mark);
  assert.equal(reworded.get('08000240').mark, marks.get('08000240').mark);
  // one function's code changes its mark and no other's
  const changed = marksOf(PROGRAM.replace('gY > FLOOR', 'gY >= FLOOR'));
  assert.notEqual(changed.get('08000200').mark, marks.get('08000200').mark);
  assert.equal(changed.get('08000240').mark, marks.get('08000240').mark);
  // a header the file includes changes what every function of the file is built from
  const header = marksOf(PROGRAM, HEADER.replace('100', '120'));
  assert.notEqual(header.get('08000200').mark, marks.get('08000200').mark);
  assert.notEqual(header.get('08000240').mark, marks.get('08000240').mark);
  assert.equal(marksOf(PROGRAM, `${HEADER}// a note\n`).get('08000200').mark, marks.get('08000200').mark);
});

test('each function says whether it has a twin and a proof, and which', () => {
  const found = states({ proofs: { functions: proven() } });
  assert.deepEqual([...found.values()].map(state => [state.key, state.kind, state.why]), [
    ['03000100/0011223344556677', null, 'no twin'], ['08000200', 'bytes', null], ['08000240', 'bytes', null], ['08000260', null, 'unproven'], ['08000300', null, 'no twin'],
  ]);
  assert.deepEqual(countsOf([...found.values()]), { functions: 5, bytes: 2, memory: 0, unproven: 3 });
  assert.equal(stateText(found.get('08000200')), 'proven by the same bytes');
  assert.equal(stateText(found.get('08000260')), 'not proven yet');
  assert.match(stateText(found.get('03000100/0011223344556677')), /makes it in its work memory/);
  // a version that keeps no proofs has none
  assert.ok([...states({ proofs: null }).values()].every(state => !state.kind));
});

test('a proof goes stale when the twin\'s C changes, and when the original\'s bytes do', () => {
  const kept = { functions: proven() };
  const twinChanged = states({ proofs: kept, marks: marksOf(PROGRAM.replace('gY > FLOOR', 'gY >= FLOOR')) });
  assert.deepEqual([twinChanged.get('08000200').kind, twinChanged.get('08000200').why], [null, 'twin changed']);
  assert.equal(twinChanged.get('08000240').kind, 'bytes', 'the function beside it keeps its proof');
  assert.match(stateText(twinChanged.get('08000200')), /its twin changed since its proof/);
  const originalChanged = states({ proofs: kept, mark: mark(new Map([...ORIGINAL, ['08000240', 'other bytes']])) });
  assert.deepEqual([originalChanged.get('08000240').kind, originalChanged.get('08000240').why], [null, 'original changed']);
  assert.equal(originalChanged.get('08000200').kind, 'bytes');
  // with no copy on the computer only the twin's side is looked at
  assert.equal(states({ proofs: kept, mark: null }).get('08000240').kind, 'bytes');
  // a twin that's gone leaves no proof behind
  assert.equal(states({ proofs: kept, marks: marksOf(PROGRAM.replace('/** Step, 0x08000240: a step on. */', '')) }).get('08000240').why, 'no twin');
});

test('a twin with a stop, a path marked as left out, can\'t be kept as proven, and isn\'t proven with a line', () => {
  const marks = marksOf(), given = { functions: codeMap.functions, marks, mark: mark() };
  const stopped = new Set(['08000200']);
  for (const kind of ['bytes', 'memory']) {
    const { functions, result } = withProofs(new Map(), { ...given, kind, proven: [{ key: '08000200', calls: 2000 }, { key: '08000240', calls: 2000 }], stopped });
    assert.deepEqual([...functions.keys()], ['08000240'], kind);
    assert.deepEqual([result.kept, result.stopped], [['08000240'], ['08000200']]);
  }
  // a line from before the stop was written goes when the tool runs, and doesn't count meanwhile
  const before = proven(marks);
  assert.deepEqual([...withProofs(before, { ...given, kind: 'bytes', proven: [{ key: '08000200' }], stopped }).functions.keys()], ['08000240']);
  const found = states({ proofs: { functions: before }, stopped });
  assert.deepEqual([found.get('08000200').kind, found.get('08000200').why], [null, 'stop']);
  assert.match(stateText(found.get('08000200')), /stop, a path marked as left out/);
});

test('the same bytes stay over the same memory, a failed proof loses its line, and only functions with a twin have one', () => {
  const marks = marksOf(), given = { functions: codeMap.functions, marks, stopped: new Set(), mark: mark() };
  const bytes = proven(marks);
  const after = withProofs(bytes, { ...given, kind: 'memory', proven: [{ key: '08000200', calls: 2000 }, { key: '08000260', calls: 1500 }] });
  assert.deepEqual(after.result, { kept: ['08000260'], stopped: [], already: ['08000200'] });
  assert.deepEqual([after.functions.get('08000200').kind, after.functions.get('08000260')], ['bytes', { kind: 'memory', twin: marks.get('08000260').mark, original: markOf('bytes of 08000260'), calls: 1500 }]);
  // the same memory is kept over the same bytes once those are of other code
  const stale = new Map([...bytes, ['08000200', { ...bytes.get('08000200'), twin: '0'.repeat(16) }]]);
  assert.equal(withProofs(stale, { ...given, kind: 'memory', proven: [{ key: '08000200', calls: 2000 }] }).functions.get('08000200').kind, 'memory');
  // match found Step differs: its line of the same bytes goes; the function check failing leaves the same bytes be
  assert.deepEqual([...withProofs(bytes, { ...given, kind: 'bytes', failed: ['08000240'] }).functions.keys()], ['08000200']);
  assert.deepEqual([...withProofs(bytes, { ...given, kind: 'memory', failed: ['08000240'] }).functions.keys()], ['08000200', '08000240']);
  // no twin, or no such function: nothing to keep
  assert.deepEqual(withProofs(new Map(), { ...given, kind: 'bytes', proven: [{ key: '08000300' }, { key: '08009999' }] }).result.kept, []);
});

test('the file is a function to a line, read back as it was written, and nothing else is taken for one', () => {
  const functions = withProofs(proven(), { functions: codeMap.functions, marks: marksOf(), stopped: new Set(), mark: mark(), kind: 'memory', proven: [{ key: '08000260', calls: 2000 }] }).functions;
  const text = formatProofs({ original: 'abc', functions });
  assert.equal(text.split('\n').filter(line => line.startsWith('    [')).length, 3);
  assert.deepEqual(parseProofs(JSON.parse(text)), { original: 'abc', functions });
  assert.equal(formatProofs({ original: 'abc', functions: new Map() }).includes('"functions": []'), true);
  for (const wrong of [
    { original: 'abc' }, { original: 'abc', functions: [['08000200', 'played', 'a'.repeat(16), 'b'.repeat(16)]] },
    { original: 'abc', functions: [['08000200', 'memory', 'a'.repeat(16), 'b'.repeat(16)]] }, { original: 'abc', functions: [['08000200', 'bytes', 'yes', 'b'.repeat(16)]] },
    { original: 'abc', functions: [['08000200', 'bytes', 'a'.repeat(16), 'b'.repeat(16)], ['08000200', 'bytes', 'a'.repeat(16), 'b'.repeat(16)]] },
  ]) assert.throws(() => parseProofs(wrong), /npm run dp -- match and npm run dp -- twin write it/);
});

test('a function that starts as the original\'s does is listed apart, and is no proof', () => {
  const starts = new Map([['08000300', { twin: 'a'.repeat(16), original: 'b'.repeat(16), bytes: 6 }]]);
  const text = formatProofs({ original: 'abc', functions: new Map(), starts });
  assert.deepEqual(parseProofs(JSON.parse(text)), { original: 'abc', functions: new Map(), starts });
  assert.equal(formatProofs({ original: 'abc', functions: new Map(), starts: new Map() }).includes('starts'), false);
  for (const wrong of [[['08000300', 'a'.repeat(16), 'b'.repeat(16), 0]], [['08000300', 'a'.repeat(16), 'b'.repeat(16)]], 'yes']) {
    assert.throws(() => parseProofs({ original: 'abc', functions: [], starts: wrong }), /only it writes which functions start/);
  }
});

// a longer made-up map: 30 functions of 100 bytes in a row, a gap of data, then 3 more, and one in the work memory
const long = { ...parseCodeMap({ original: 'abc', functions: [
  ...Array.from({ length: 30 }, (_, i) => [(0x08000200 + i * 100).toString(16).toUpperCase().padStart(8, '0'), 100]),
  ['08010000', 3000], ['08010BB8', 40], ['08010BE0', 40], ['03000100/0011223344556677', 16],
] }), console: 'gba' };

test('a version\'s tasks are the code map\'s functions in groups that sit together', () => {
  const groups = groupsOf(long);
  assert.deepEqual(groups.map(group => group.functions.length), [12, 12, 6, 1, 2]);
  assert.equal(groups[0].name, 'Functions 08000200 to 0800064C');
  assert.equal(groups[3].name, 'Function 08010000', 'a function bigger than a group is one by itself');
  assert.equal(groups.flatMap(group => group.functions).length, 33, 'every function of the cartridge is in one, and none made in the work memory');
  // a cartridge's start, its header's jump and the code right after its header, is the kit's to do: in no task
  const started = { ...parseCodeMap({ original: 'abc', functions: [['08000000', 4], ['080000C0', 28], ['08000100', 12], ['08000120', 40]] }), console: 'gba' };
  assert.deepEqual(groupsOf(started).map(group => group.name), ['Functions 08000100 to 08000120']);
  assert.deepEqual(started.functions.map(f => beyondProof(started, f)), ['start', 'start', null, null]);
  assert.match(stateText(stateOf('made-up/c', { codeMap: started, proofs: null, marks: new Map(), stopped: new Set(), mark: null })[1]), /the cartridge's start, which is the kit's to do/);
  // only where the cartridge does start with its header's jump, and only on that console
  assert.equal(beyondProof({ ...started, functions: started.functions.slice(1) }, started.functions[1]), null);
  assert.equal(beyondProof({ ...started, console: 'nes' }, started.functions[0]), null);
  assert.equal(groupNamed(groups, 'Task: functions 08000200 to 0800064c in C'), groups[0]);
  assert.equal(groupNamed(groups, '0x08000266'), groups[0], 'any address inside one of its functions');
  assert.equal(groupNamed(groups, '08010BE0'), groups[4]);
  assert.equal(groupNamed(groups, 'the title screen'), null);
  // a task named before the code map found more functions is the group its first function is in now (#1473)
  assert.equal(groupNamed(groups, 'Task: Functions 08000200 to 08000640 in C'), groups[0]);
  assert.equal(groupNamed(groups, 'Functions 08000210 to 08000640'), groups[0]);
  assert.equal(groupNamed(groups, 'Function 08010BE0'), groups[4]);
  assert.equal(groupNamed(groups, 'Functions 07000000 to 07000100'), null);
  // on the NES a group stays in one bank
  const nes = groupsOf({ ...parseCodeMap({ original: 'abc', functions: [['00003FC0', 30], ['00003FF0', 16], ['00004000', 30]] }), console: 'nes' });
  assert.deepEqual(nes.map(group => group.functions.length), [2, 1]);
});

test('tasks opens a task for each group with something to prove and none open, so many at once', () => {
  const groups = groupsOf(long), none = new Map();
  const title = group => `Task: ${group.name} in C`;
  assert.deepEqual(functionTasks(groups, none, []).wanted.map(group => group.first), ['08000200', '080006B0', '08000B60', '08010000', '08010BB8']);
  // an open task is left, a closed one whose functions aren't proven gets another, and a proven group needs none
  const allProven = new Map(groups[1].functions.map(f => [f.key, { kind: 'bytes' }]));
  const pieces = [{ title: title(groups[0]), state: 'open' }, { title: title(groups[2]).toUpperCase(), state: 'closed' }];
  const found = functionTasks(groups, allProven, pieces);
  assert.deepEqual([found.open.map(group => group.first), found.wanted.map(group => group.first), found.waiting], [['08000200'], ['08000B60', '08010000', '08010BB8'], 0]);
  // an open task named for where its group ended before the code map found more functions is still its group's, and
  // one in another language isn't
  const moved = [{ title: 'Task: Functions 08000200 to 08000640 in C', state: 'open' }, { title: `Task: ${groups[1].name}`, state: 'open' }];
  assert.deepEqual(functionTasks(groups, none, moved).open.map(group => group.first), ['08000200']);
  // no more open at once than asked, the first in the map's order, and the rest wait
  const few = functionTasks(groups, none, pieces, 'c', 3);
  assert.deepEqual([few.wanted.map(group => group.first), few.waiting], [['080006B0', '08000B60'], 2]);
});

test('a task says of every function whether it\'s named, has a twin, and is proven and how', () => {
  const [group] = groupsOf(codeMap);
  const text = functionTaskText('made-up/c', group, states({ proofs: { functions: withProofs(proven(), { functions: codeMap.functions, marks: marksOf(), stopped: new Set(), mark: mark(), kind: 'memory', proven: [{ key: '08000260', calls: 2000 }] }).functions } }));
  assert.equal(field(text, 'Game folder'), 'made-up');
  assert.equal(field(text, 'Kind'), 'Something else');
  const what = field(text, 'What it is');
  assert.match(what, /Functions 08000200 to 08000300: 4 functions of the original that sit together/);
  assert.match(what, /- `08000200`, 40 bytes: `Fall` in `src\/game\.c`, proven by the same bytes/);
  assert.match(what, /- `08000240` `StepOn`, 12 bytes: `Step` in `src\/game\.c`, proven by the same bytes/);
  assert.match(what, /- `08000260`, 12 bytes: `Skip` in `src\/game\.c`, proven by the same memory, over 2,000 calls/);
  assert.match(what, /- `08000300`, 20 bytes: no twin yet/);
  assert.match(what, /npm run dp -- match made-up\/c <address>.*npm run dp -- twin made-up\/c <address>/);
  assert.match(field(text, 'Done when'), /npm run dp -- ready made-up\/c --task 08000200` says each of these functions has its proof/);
  assert.equal(field(text, 'Taking it'), '- [ ] I\'m taking this task myself.');
});

test('a task of functions is free as soon as it\'s open and nobody\'s, with no part\'s recording asked of it', () => {
  const groups = groupsOf(long);
  const pieces = groups.slice(0, 3).map((group, i) => ({ number: 10 + i, title: `Task: ${group.name} in C`, state: 'open', assignees: i === 1 ? [{ login: 'pat' }] : [] }));
  // the game's parts are names for people: none is a task, and none is waited on
  const parts = { parts: [{ name: 'The title screen' }, { name: 'The first level', needs: ['The title screen'] }] };
  const { free, waiting } = whatCanStart(pieces, parts, new Set(), { main: 'c' });
  assert.deepEqual([free.map(piece => piece.number), waiting], [[10, 12], []]);
  const took = whatToTake({ pieces, free, waiting, reviewing: new Map(), login: 'sam', language: 'c', has: () => true, missing: () => 2 });
  assert.deepEqual([took.do, took.piece.number], ['take', 10]);
  assert.equal(whatToTake({ pieces, free: [], waiting, reviewing: new Map(), login: 'sam', language: 'c', has: () => true, missing: () => 2 }).do, 'open-tasks');
});
