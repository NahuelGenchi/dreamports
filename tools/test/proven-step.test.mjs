// A step that only proves functions shows their proofs in a clip's place, in a game made a function at a time that
// has no recording yet (lib/proven-step.mjs): what's covered by a proof and what isn't, each way round it refused, and
// what the pull request's check (tools/clips-check.mjs) and share make of it, with a made-up game. npm run check runs them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join, relative, sep } from 'node:path';
import { parseCodeMap } from '../lib/proof-files.mjs';
import { marksIn, parseProofs, withProofs } from '../lib/proofs.mjs';
import { proofLines, provenStep, recordingsAt, showsProofs, standProblems, stepProofs } from '../lib/proven-step.mjs';
import { recordLines } from '../lib/same-proof.mjs';
import { twinsIn } from '../gba/match.mjs';
import { checkClips } from '../clips-check.mjs';
import { foreignLinks, keepProof, missingLines, savedLines } from '../share.mjs';

const V = 'a-game/c';
const codeMap = { ...parseCodeMap({ original: 'abc', functions: [['08000200', 40], ['08000240', 12], ['08000260', 12], ['08000300', 20]] }), console: 'gba' };
const HEADER = ['#define FLOOR 100', 'extern short gY;', 'void Fall(void);', ''].join('\n');
const FALL = ['/** Fall, 0x08000200: the ball a frame further down. */', 'void Fall(void) {', '  if (gY > FLOOR) gY = FLOOR;', '}', ''].join('\n');
const STEP = ['/** Step, 0x08000240: a step on. */', 'void Step(void) { gY += 3; }', ''].join('\n');
const SKIP = ['/** Skip, 0x08000260: far on. */', 'void Skip(void) { gY += 100; }', ''].join('\n');
const MAIN = ['#include "game.h"', 'int started = 0;', '// the Dreamport\'s own side: what the kit calls', 'void game_step(void) { Fall(); }', ''].join('\n');
const files = each => new Map(Object.entries(each));
// main: a game with one proven twin, a header its main.c is built with too, and no recording
const MAINS = files({ 'src/game.h': HEADER, 'src/twins.c': `#include "game.h"\n\n${FALL}`, 'src/main.c': MAIN });
// the step: a second twin beside the first, declared in the game's header
const STEPS = files({ 'src/game.h': `${HEADER}void Step(void);\n`, 'src/twins.c': `#include "game.h"\n\n${FALL}\n${STEP}`, 'src/main.c': MAIN });

// each twin's mark, as the tools take it of these files
function marksOf(after) {
  const sources = [...after.keys()].filter(path => path.endsWith('.c')).map(path => join('/version', path));
  // by its path inside the folder with /, as the tools read a file, whichever way the computer writes a path
  const read = path => after.get(relative('/version', path).split(sep).join('/')) ?? null;
  return marksIn(codeMap, { folder: '/version', files: sources, twinsOf: new Map(sources.map(file => [file, twinsIn(read(file))])), read });
}
// proofs.json as `match` leaves it after proving these functions of these files, and `twin` those in `memory`
function provenBy(after, keys, memory = []) {
  const given = { functions: codeMap.functions, marks: marksOf(after), stopped: new Set(), mark: f => `0123456789${f.key.slice(2)}`.toLowerCase() };
  const bytes = withProofs(new Map(), { kind: 'bytes', proven: keys.map(key => ({ key })), ...given }).functions;
  return { original: 'abc', functions: withProofs(bytes, { kind: 'memory', proven: memory.map(key => ({ key, calls: 2000 })), ...given }).functions };
}
const stepOf = (after, proofs = provenBy(after, ['08000200', '08000240']), more = {}) => provenStep({ codeMap, before: MAINS, after, proofs, ...more });
const names = step => step.functions.map(f => f.name);

test('a step that only adds a proven twin, and declares it, is covered by its proof', () => {
  const step = stepOf(STEPS);
  assert.deepEqual(step.problems, []);
  assert.deepEqual(step.functions, [{ key: '08000240', address: 0x08000240, name: 'Step', file: 'src/twins.c', kind: 'bytes' }]);
  // one proven by the same memory says over how many calls, and a twin put right is named as changed
  const fixed = files({ ...Object.fromEntries(MAINS), 'src/twins.c': MAINS.get('src/twins.c').replace('gY > FLOOR', 'gY >= FLOOR') });
  const again = stepOf(fixed, provenBy(fixed, [], ['08000200']));
  assert.deepEqual([again.problems, again.functions], [[], [{ key: '08000200', address: 0x08000200, name: 'Fall', file: 'src/twins.c', kind: 'memory', calls: 2000 }]]);
  assert.match(proofLines('A Game in C', again.functions), /^No clip: A Game in C has no recording yet, so nothing of it plays, and this step only proves functions\. The function it adds or changes is a twin, with its proof in `proofs\.json`:\n\n- `Fall`, 0x08000200: the same memory, over 2,000 calls$/);
  // a file of its own for new twins, with a header only they include, is theirs to write as they need
  const apart = files({ ...Object.fromEntries(MAINS), 'src/more.h': '#include "game.h"\n#define FAR 100\n', 'src/more.c': `#include "more.h"\n#define STEP 3\n${STEP}\n${SKIP}` });
  const two = stepOf(apart, provenBy(apart, ['08000200', '08000240', '08000260']));
  assert.deepEqual([two.problems, names(two)], [[], ['Step', 'Skip']]);
});

test('a proof line written by hand is refused', () => {
  const typed = provenBy(STEPS, ['08000200']);
  typed.functions.set('08000240', { kind: 'bytes', twin: '0123456789abcdef', original: 'fedcba9876543210' });
  const step = stepOf(STEPS, typed);
  assert.equal(step.problems.length, 1);
  assert.match(step.problems[0], /^Step, in src\/twins\.c, has a line in proofs\.json that is of other code: .* or the line wasn't written by match or twin/);
  assert.deepEqual(step.functions, []);
  // and a file that isn't shaped as the tools write it isn't read at all
  assert.throws(() => parseProofs({ original: 'abc', functions: [['08000240', 'bytes', 'proven']] }), /only they write a function's proof/);
  // nor does a line for something the code map doesn't have pass
  const more = provenBy(STEPS, ['08000200', '08000240']);
  more.functions.set('08000999', { kind: 'bytes', twin: '0123456789abcdef', original: 'fedcba9876543210' });
  assert.match(stepOf(STEPS, more).problems[0], /has a line for 08000999, which isn't a function of the code map/);
});

test('a twin changed after its proof is refused, and so is one whose file or header changed after it', () => {
  const proofs = provenBy(STEPS, ['08000200', '08000240']);
  const changed = text => files({ ...Object.fromEntries(STEPS), 'src/twins.c': text });
  const body = stepOf(changed(STEPS.get('src/twins.c').replace('gY += 3', 'gY += 4')), proofs);
  assert.equal(body.problems.length, 1);
  assert.match(body.problems[0], /^Step, in src\/twins\.c, has a line in proofs\.json that is of other code: it changed after its proof/);
  // what the file holds outside its functions is what they're built with, so both proofs are of other code now
  const around = stepOf(changed(STEPS.get('src/twins.c').replace('#include "game.h"', '#include "game.h"\n#define FLOOR 90')), proofs);
  assert.deepEqual(around.problems.map(problem => problem.split(',')[0]).sort(), ['Fall', 'Step']);
  const header = stepOf(files({ ...Object.fromEntries(STEPS), 'src/game.h': STEPS.get('src/game.h').replace('100', '90') }), proofs);
  assert.ok(header.problems.some(problem => /^Fall, in src\/twins\.c, has a line in proofs\.json that is of other code/.test(problem)));
  // a comment changes nothing a proof is of
  assert.deepEqual(stepOf(changed(STEPS.get('src/twins.c').replace('a step on', 'one step on')), proofs).problems, []);
});

test('a function added or changed with no line is refused, twin or not', () => {
  const unproven = stepOf(STEPS, provenBy(STEPS, ['08000200']));
  assert.deepEqual(unproven.problems, ['Step, in src/twins.c, has no line in proofs.json: npm run dp -- match or npm run dp -- twin proves it.']);
  // the game's own side, such as its main.c, is no twin: no proof is of it, so a clip shows it
  const glue = files({ ...Object.fromEntries(STEPS), 'src/main.c': MAIN.replace('Fall();', 'Fall(); Step();') });
  assert.deepEqual(stepOf(glue, provenBy(glue, ['08000200', '08000240'])).problems, ['game_step, in src/main.c, isn\'t a twin, so no proof is of it.']);
  const helper = files({ ...Object.fromEntries(STEPS), 'src/twins.c': `${STEPS.get('src/twins.c')}\nstatic void Helper(void) { gY = 0; }\n` });
  assert.match(stepOf(helper, provenBy(helper, ['08000200', '08000240'])).problems[0], /^Helper, in src\/twins\.c, isn't a twin/);
  const inHeader = files({ ...Object.fromEntries(STEPS), 'src/game.h': `${STEPS.get('src/game.h')}static inline void Reset(void) { gY = 0; }\n` });
  assert.ok(stepOf(inHeader, provenBy(inHeader, ['08000200', '08000240'])).problems.some(problem => /^Reset, in src\/game\.h, isn't a twin/.test(problem)));
});

test('a twin with a stop is refused, whatever its line says', () => {
  const step = stepOf(STEPS, undefined, { stopped: new Set(['08000240']) });
  assert.deepEqual(step.problems, ['Step, in src/twins.c, has a stop in it, a path left out, so it isn\'t proven.']);
  // and one proven before that has a stop now takes the step's cover with it
  assert.match(stepOf(STEPS, undefined, { stopped: new Set(['08000200']) }).problems[0], /^Fall, in src\/twins\.c, has a stop in it/);
});

test('code that is no twin is no way round: outside the twins a step only adds declarations', () => {
  const proofs = after => provenBy(after, ['08000200', '08000240']);
  const withHeader = text => files({ ...Object.fromEntries(STEPS), 'src/game.h': text });
  const tried = after => stepOf(after, proofs(after)).problems;
  // the game's header is built into main.c too, so a line of it that changes can change code with no proof
  assert.match(tried(withHeader(STEPS.get('src/game.h').replace('100', '90'))).find(problem => problem.startsWith('src/game.h')), /is also built into code with no proof, and the step changes or takes out a line of it outside its functions: #define FLOOR 100/);
  assert.match(tried(withHeader(`${STEPS.get('src/game.h')}#define game_step Skip\n`))[0], /defines game_step in it, a name the game's code on main already uses/);
  assert.match(tried(withHeader(`#include "other.h"\n${STEPS.get('src/game.h')}`))[0], /adds a line for the preprocessor to it, which can change that code: #include "other\.h"/);
  assert.match(tried(withHeader(`${STEPS.get('src/game.h')}void game_step(void) __attribute__((weak));\n`))[0], /adds a declaration that says how something is built/);
  // a name main's code never uses, and a declaration, reach nothing that's there
  assert.deepEqual(tried(withHeader(`${STEPS.get('src/game.h')}#define gSpeed (*(short *)0x03000010)\nextern short gX;\nstruct Ball { short x; };\n`)), []);
  // main.c itself: not a line of it, though no function of it changed
  const main = text => files({ ...Object.fromEntries(STEPS), 'src/main.c': text });
  assert.match(tried(main(MAIN.replace('started = 0', 'started = 1')))[0], /^src\/main\.c holds code with no proof, and the step changes or takes out a line of it outside its functions: int started = 0;/);
  assert.match(tried(main(MAIN.replace('#include "game.h"', '#include "game.h"\n#define Fall Skip')))[0], /defines Fall in it, a name the game's code on main already uses/);
  // nothing goes but a twin proven elsewhere, and nothing that isn't C changes
  const moved = files({ ...Object.fromEntries(MAINS), 'src/twins.c': '#include "game.h"\n', 'src/fall.c': `#include "game.h"\n${FALL}` });
  assert.deepEqual(stepOf(moved, provenBy(moved, ['08000200'])).problems, []);
  const gone = files({ 'src/game.h': HEADER, 'src/twins.c': MAINS.get('src/twins.c') });
  assert.deepEqual(stepOf(gone, provenBy(gone, ['08000200'])).problems, ['game_step is taken out of src/main.c, and no proof shows the game without it.']);
  assert.deepEqual(stepOf(STEPS, undefined, { others: ['games/a-game/c/src/start.s'] }).problems, ['games/a-game/c/src/start.s isn\'t C, and a proof is of a twin in C.']);
});

test('a game with no proofs.json can\'t go this way', async () => {
  assert.deepEqual(provenStep({ codeMap, before: MAINS, after: STEPS, proofs: null }), { functions: [], problems: ['It keeps no proofs.json, so none of its functions has a proof.'] });
  assert.match(standProblems(V, { keeps: false, functions: [], problems: [] }, { main: 0, now: 0 })[0], /a-game\/c keeps no proofs\.json: it's made a part at a time/);
  // every game on main is made a part at a time today
  assert.deepEqual(stepProofs('sonic-battle/c', 'HEAD'), { keeps: false, functions: [], problems: [] });
  assert.ok(recordingsAt('sonic-battle/c', 'HEAD') > 0);
  // the check: lines written as if it could change nothing, with or without a record to go by
  const text = `Clips:\n\n${proofLines('A Game in C', stepOf(STEPS).functions)}`;
  const partAtATime = () => ({ recordings: false, versions: [{ version: V, state: state(), proofs: () => ({ step: { keeps: false, functions: [], problems: [] }, recordings: { main: 0, now: 0 } }) }] });
  const problems = await checkClips(text, { games: ['a-game'], stepOf: partAtATime });
  assert.match(problems[0], /links no clip of it.* It links no record of a-game\/c's proof\. a-game\/c keeps no proofs\.json/);
  // and without those lines the check says what it always said
  assert.doesNotMatch((await checkClips('Clips: none', { games: ['a-game'], stepOf: partAtATime }))[0], /proofs\.json/);
});

// what would merge of a version, as the check holds a record to it (lib/same-proof.mjs)
const state = (over = {}) => ({ trees: { game: 'g1', kit: 'k1' }, progress: null, mains: null, recordings: 0, ...over });
const record = (over = {}) => ({ proof: 'dreamports', version: V, recordings: 7, progress: 'p1', same: true, trees: { game: 'g1', kit: 'k1' }, ...over });
const LINK = 'https://someone.github.io/dreamports/clips/a-game/c/2026-11-17-abcdef0-same-proof.json';
const checked = (step, recordings, held = state()) => () => ({ recordings: false, versions: [{ version: V, state: held, proofs: () => ({ step: { keeps: true, ...step }, recordings }) }] });

test('the check passes a right step of a game with no recording by its proofs, named in the text', async () => {
  const step = stepOf(STEPS), none = { main: 0, now: 0 };
  const text = `Clips:\n\n${proofLines('A Game in C', step.functions)}\n`;
  assert.ok(showsProofs(text));
  assert.deepEqual(await checkClips(text, { games: ['a-game'], stepOf: checked(step, none) }), []);
  // the text names each function with its proof, as share wrote it: none left out, none reworded, none of another kind
  for (const without of ['Clips: none', text.replace('- `Step`, 0x08000240: the same bytes', ''), text.replace('the same bytes', 'the same memory, over 2,000 calls'), text.replace('has no recording yet, so nothing of it plays', 'is proven')]) {
    assert.match((await checkClips(without, { games: ['a-game'], stepOf: checked(step, none) }))[0], /links no clip of it.* The text doesn't name .* the step proves of a-game\/c, each with its proof/);
  }
  // what isn't covered is refused whatever the text says
  const glue = files({ ...Object.fromEntries(STEPS), 'src/main.c': MAIN.replace('Fall();', 'Fall(); Step();') });
  const wrong = stepOf(glue, provenBy(glue, ['08000200', '08000240']));
  assert.match((await checkClips(text, { games: ['a-game'], stepOf: checked(wrong, none) }))[0], /Not everything it changes of a-game\/c's code is covered by a proof, and code with no proof is shown in a clip, which takes a recording that plays it: game_step, in src\/main\.c, isn't a twin/);
  // a step that changes the game's recordings shows a clip, as its first recording does
  assert.match((await checkClips(text, { games: ['a-game'], stepOf: () => ({ ...checked(step, none)(), recordings: true }) }))[0], /links no clip of it/);
});

test('a game with recordings still shows them: a step that changes frames has a clip, and one that changes none its record', async () => {
  const step = stepOf(STEPS);
  const lines = proofLines('A Game in C', step.functions);
  // proofs alone don't stand in once anything plays, on main or in the step
  for (const recordings of [{ main: 3, now: 3 }, { main: 3, now: 0 }, { main: 0, now: 1 }]) {
    const problems = await checkClips(`Clips:\n\n${lines}`, { games: ['a-game'], stepOf: checked(step, recordings, state({ progress: 'p1', mains: 'p1', recordings: recordings.now })) });
    assert.match(problems[0], /links no clip of it.* It links no record of a-game\/c's proof\. a-game has recordings, so its functions' proofs don't stand in for a clip by themselves/);
  }
  // frames changed and no clip: the record doesn't stand, and neither do the proofs
  const withRecord = `Clips:\n\n${recordLines('A Game in C', record(), LINK)}\n\n${lines}`;
  const fetched = async url => (url === LINK ? Buffer.from(JSON.stringify(record({ progress: 'p2' }))) : null);
  const changed = await checkClips(withRecord, { fetched, games: ['a-game'], stepOf: checked(step, { main: 7, now: 7 }, state({ progress: 'p2', mains: 'p1', recordings: 7 })) });
  assert.match(changed[0], /progress\.json isn't main's, so the step changes what the proof shows, and a clip shows that\. a-game has recordings/);
  // recordings that all still come out as main has them: the record of that whole proof stands, as for any game
  const same = async url => (url === LINK ? Buffer.from(JSON.stringify(record())) : null);
  const unread = () => ({ recordings: false, versions: [{ version: V, state: state({ progress: 'p1', mains: 'p1', recordings: 7 }), proofs: () => assert.fail('the record stands, so the proofs aren\'t asked') }] });
  assert.deepEqual(await checkClips(withRecord, { fetched: same, games: ['a-game'], stepOf: unread }), []);
});

test('share keeps the proofs\' lines for the pull request as it keeps a record\'s', () => {
  const lines = proofLines('A Game in C', stepOf(STEPS).functions);
  const saved = keepProof(null, 'feat/1-a', V, lines);
  assert.equal(savedLines(saved), lines);
  assert.deepEqual(missingLines(`Clips:\n\n${lines}\n`, saved), []);
  assert.deepEqual(missingLines('Clips: none', saved)[0].key, V);
  assert.deepEqual(foreignLinks(`Clips:\n\n${lines}\n`, saved), []);
  assert.match(proofLines('A Game in C', []), /adds or changes no function: only declarations its proven twins are built with\.$/);
});
