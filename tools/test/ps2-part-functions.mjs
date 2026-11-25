// npm run test:ps2-part-functions: what `prove` says each part of a PlayStation 2 game runs, for a version whose tasks
// are its parts (lib/part-functions.mjs, #1871), on the console's real emulator, with a disc of the project's own
// (made-up-ps2-parts.mjs) and nobody's copy of any game.
//
// A function is found running on the console in three ways: one of the program the disc boots, by its own start; one
// of a module or another program, and one of a vector unit's program, by what ran where its bytes are. The disc has one
// of each that first runs in a frame the test chose, and each has to be in the list of the part that frame is in, and in
// none before it. A part's list also has what the original runs in the frame after its last, as a frame matches only
// once that has run too (#1899), so each of the three is first met by a part of one frame, the frame before it runs.
//
// What each list must hold is worked out here from what the emulator itself says ran in each frame, read with no part
// of the tools that makes the lists: an instruction of the boot program by its address, one of the module by where the
// emulator says the IOP loaded it, and one of the vector unit's program by its place in the unit's code memory.
//
// Then the version's tasks are its parts: `proofs` lists each part with the functions it runs that no part before it
// does, a program at a time, a module's functions together and in their order.
//
// It isn't run on every pull request, as the emulator takes minutes to build.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder } from '../lib/paths.mjs';
import { startingEntry, startingFiles } from '../lib/new-game.mjs';
import { cartridgeOf, prepareCopy, readCodeMap, watchesOf } from '../lib/proof-files.mjs';
import { PART_FUNCTIONS, parsePartFunctions } from '../lib/part-functions.mjs';
import { consoleOf } from '../consoles.mjs';
import { libretroReference } from '../libretro/reference.mjs';
import { LOAD_AT } from './made-up-ps2.mjs';
import { LATER_FROM, SERVE_FROM, UNIT_FROM, madeUpPs2Parts } from './made-up-ps2-parts.mjs';

const FRAMES = 100;
const GAME = 'test-ps2-part-functions', IN_C = `${GAME}/c`;
const WORK = join(LOCAL, 'test-ps2-part-functions'), COPIES = join(LOCAL, 'copies.json'), MEDIA = join(REPO, 'public', 'media');
const RAN = 0, EE = 0, IOP = 1, VU1 = 3;

const failures = [];
// what the tool run last said, shown under a check that failed, so a failure on another computer can be read
let said = '';
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (ok) return;
  failures.push(what);
  if (said) console.log(said.trim().split('\n').slice(-30).map(line => `      ${line}`).join('\n'));
  said = '';
};
const dp = (...args) => {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 26 });
  said = stdout + stderr;
  return { status, out: said };
};
const last = run => run.out.trim().split('\n').at(-1);
const hex = number => number.toString(16).toUpperCase().padStart(8, '0');
const tracked = () => spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: REPO, encoding: 'utf8' }).stdout;

function tidy() {
  const made = [gameFolder(GAME), join(LOCAL, 'results', GAME), join(LOCAL, 'captures', GAME), join(REPO, '.github', 'readme', 'progress', `${GAME}.svg`), join(REPO, '.github', 'readme', 'progress', `${GAME}-c.svg`),
    ...readdirSync(MEDIA).filter(file => file.startsWith(GAME)).map(file => join(MEDIA, file))];
  for (const path of made) rmSync(path, { recursive: true, force: true });
}

async function main() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const made = madeUpPs2Parts(), copy = join(WORK, 'made-up.iso');
  writeFileSync(copy, made.disc);
  const machine = consoleOf('ps2'), reference = libretroReference(machine);
  reference.ensureOriginal(message => console.log(message));

  console.log('A made-up disc as a game\'s copy, with its code map as the tools make it:');
  const original = { console: 'ps2', name: 'Test PlayStation 2 Part Functions (World)', title: GAME, code: 'MADE_UP.ELF', sha1: createHash('sha1').update(made.disc).digest('hex'), provenBy: 'draw lists', keysAfterVBlank: true };
  mkdirSync(join(proofFolder(GAME), 'recordings'), { recursive: true });
  writeFileSync(join(proofFolder(GAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
  let run = dp('rom', copy);
  check(run.status === 0 && run.out.includes(GAME), `rom knows the disc: ${run.out.trim().split('\n')[1]?.trim()}`);
  run = dp('codemap', GAME);
  check(run.status === 0, `codemap finds the functions of every program on it: ${last(run)}`);
  const codeMap = readCodeMap(GAME), keys = new Set(codeMap.functions.map(f => f.key));
  // the two functions the frame loop calls, from its own calls: the first is called every frame, the second later
  const code = made.elf.subarray(0x80), calls = [];
  for (let at = 0; at + 4 <= code.length && calls.length < 2; at += 4) {
    const word = code.readUInt32LE(at);
    if (word >>> 26 === 3) calls.push((word & 0x03FFFFFF) << 2);
  }
  const [always, later] = calls.map(hex), answer = `${hex(made.module.answer)}@SOUND.IRX`, unit = made.unit.key;
  check(keys.has(always) && keys.has(later), `the program's two functions are in it, by their addresses: ${always}, ${later}`);
  check(keys.has(answer), `and the module's server's function, by its place in the module: ${answer}`);
  check(keys.has(unit) && made.others.every(key => keys.has(key)), `and the three vector unit programs of its file of data, by their places in it: ${[unit, ...made.others].join(', ')}`);
  if (failures.length) return;

  console.log(`What the emulator says ran in each of ${FRAMES} frames, read here by address:`);
  await prepareCopy(copy, 'ps2');
  const held = cartridgeOf(copy, 'ps2');
  const played = await reference.runOriginal({ copy, frames: FRAMES + 2, buttons: new Array(FRAMES + 2).fill(0), functions: watchesOf(codeMap, held), played: true });
  const records = played.played.records, loads = played.played.modules.filter(load => held.modules().has(load.hash));
  check(loads.length === 1, `the IOP loaded the module once, and the emulator says where: ${loads.map(load => `0x${hex(load.base)}, in frame ${load.frame}`).join('; ')}`);
  // the frames an instruction ran in, from its records: each is a stretch of frames it ran in every one of
  const framesOf = (processor, address, word) => {
    const frames = new Set();
    for (let i = 0; i + 5 <= records.length; i += 5) {
      if (records[i] !== address || records[i + 1] !== word || (records[i + 2] & 0xFF) !== RAN || records[i + 2] >>> 8 !== processor) continue;
      for (let frame = records[i + 3]; frame <= Math.min(records[i + 4], FRAMES + 1); frame++) frames.add(frame);
    }
    return frames;
  };
  const wordAt = address => code.readUInt32LE(address - LOAD_AT);
  const moduleWord = at => readFileSync(copy).readUInt32LE(made.sectors['SOUND.IRX'].at * 2048 + 0x80 + at);
  const ran = {
    [always]: framesOf(EE, parseInt(always, 16), wordAt(parseInt(always, 16))),
    [later]: framesOf(EE, parseInt(later, 16), wordAt(parseInt(later, 16))),
    [unit]: framesOf(VU1, made.unit.at, made.unit.word),
    [answer]: framesOf(IOP, (loads[0]?.base ?? 0) + made.module.answer, moduleWord(made.module.answer)),
  };
  const firstOf = key => Math.min(...ran[key]);
  const first = { always: firstOf(always), later: firstOf(later), unit: firstOf(unit), answer: firstOf(answer) };
  console.log(`  found: the first frame of each: ${JSON.stringify(first)}`);
  check(Number.isFinite(first.always) && first.later - first.always === LATER_FROM, `the function called from frame ${LATER_FROM} of the program's count first runs ${LATER_FROM} frames after the one called from the start`);
  check(first.unit - first.always === UNIT_FROM, `the vector unit's program first runs ${UNIT_FROM} frames after it, when the EE first uploads and starts it`);
  check(first.answer - first.always === SERVE_FROM, `and the module's server's function ${SERVE_FROM} frames after it, when the EE first calls the server`);
  check([always, later, unit, answer].every(key => [...ran[key]].every(frame => frame < firstOf(key) || ran[key].has(frame)) && ran[key].has(FRAMES)), 'each runs in every frame from its first on');
  if (failures.length) return;

  console.log('The game\'s version in C, its recording and its parts:');
  for (const [game, language] of [[GAME, undefined], [IN_C, 'c']]) {
    const files = { ...startingFiles(GAME, original, language ? { language } : undefined), ...(language ? {} : { 'entry.md': startingEntry(GAME, original, { issue: 1, lead: 'nobody', added: '2026-01-01' }) }) };
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(join(gameFolder(game), file, '..'), { recursive: true });
      writeFileSync(join(gameFolder(game), file), text);
    }
  }
  writeFileSync(join(proofFolder(GAME), 'recordings', 'play.json'), `${JSON.stringify({ about: 'Nothing held.', frames: FRAMES, held: [[0, []]] }, null, 2)}\n`);
  // a part of one frame before each first run, which has it only by the frame after, between parts that end two frames
  // before the next first run, which haven't it
  const parts = [
    ['Before anything more', 0, first.later - 2], ['The frame before the second function', first.later - 1, first.later - 1],
    ['With the second function', first.later, first.unit - 2], ['The frame before the vector unit', first.unit - 1, first.unit - 1],
    ['With the vector unit', first.unit, first.answer - 2], ['The frame before the server', first.answer - 1, first.answer - 1],
    ['With the server', first.answer, FRAMES - 1],
  ].map(([name, from, to]) => ({ name, recording: 'play', frames: [from, to] }));
  writeFileSync(join(proofFolder(GAME), 'parts.json'), `${JSON.stringify({ about: 'The test\'s own parts.', parts: [...parts, { name: 'A part nobody has recorded' }] }, null, 2)}\n`);
  run = dp('proofs', IN_C, '--start', '--parts');
  const file = join(proofFolder(GAME), PART_FUNCTIONS);
  check(run.status === 0 && existsSync(file) && parsePartFunctions(readFileSync(file, 'utf8')).parts.size === 0, `proofs --start --parts starts its proofs and its parts' lists, with no part in them: ${last(run).slice(0, 100)}`);

  console.log('prove plays the original and keeps what each part runs:');
  run = dp('prove', IN_C, 'play');
  check(/Written: games\/test-ps2-part-functions\/proof\/part-functions\.json/.test(run.out), `prove writes the lists, whatever the version matches of the recording, which has nothing of the game yet: ${run.out.trim().split('\n').find(line => line.startsWith('Written: games/')) ?? last(run)}`);
  const lists = existsSync(file) ? parsePartFunctions(readFileSync(file, 'utf8')) : { parts: new Map() };
  check(lists.original === original.sha1 && parts.every(part => lists.parts.has(part.name)) && !lists.parts.has('A part nobody has recorded'), `each part the recording plays has its list, and the part with no recording has none: ${[...lists.parts.keys()].length} lists`);
  // a part's list: what ran in each of its frames and in the frame after its last
  const inPart = (key, [from, to]) => Array.from({ length: to - from + 2 }, (_, i) => from + i).some(frame => ran[key].has(frame));
  for (const part of parts) {
    const list = new Set(lists.parts.get(part.name) ?? []);
    const wrong = [always, later, unit, answer].filter(key => list.has(key) !== inPart(key, part.frames));
    const has = [['the second function', later], ['the vector unit\'s program', unit], ['the server\'s function', answer]].filter(([, key]) => list.has(key)).map(([name]) => name);
    check(!wrong.length && list.has(always), `${part.name}, frames ${part.frames.join(' to ')}: the function called every frame${has.length ? `, ${has.join(', ')}` : ' alone of the four'}${wrong.length ? `, wrong for ${wrong.join(', ')}` : ''}`);
  }
  const listOf = name => new Set(lists.parts.get(name) ?? []);
  check(!listOf('Before anything more').has(later) && listOf('The frame before the second function').has(later), 'a function of the program the disc boots is first in the part whose last frame is the one before it runs');
  check(!listOf('With the second function').has(unit) && listOf('The frame before the vector unit').has(unit), 'and so is a vector unit\'s program, found by what ran where its pairs are in the unit\'s memory');
  check(!listOf('With the vector unit').has(answer) && listOf('The frame before the server').has(answer), 'and a module\'s function, found by what the IOP ran where it loaded the module');
  check(made.others.every(key => [...lists.parts.values()].every(list => !list.includes(key))), 'a vector unit program the game never uploads is in no part\'s list');
  const everything = new Set([...lists.parts.values()].flat());
  check([...everything].every(key => keys.has(key)), 'every key listed is one of the code map\'s');
  const again = readFileSync(file, 'utf8');
  run = dp('prove', IN_C, 'play');
  check(readFileSync(file, 'utf8') === again && !/Written: games\/test-ps2-part-functions\/proof\/part-functions\.json/.test(run.out), 'proving it again writes the same lists, and says nothing of them');

  console.log('Its tasks are its parts, each with what it runs that no part before it does:');
  run = dp('proofs', IN_C);
  const line = name => run.out.split('\n').find(each => each.includes(name)) ?? '';
  check(run.status === 0 && parts.every(part => line(part.name)), `proofs lists each part as a task: ${line('Before anything more').trim()}`);
  check(/ 0 of 1 proven/.test(line('The frame before the second function')), `the part that first runs the second function has it alone: ${line('The frame before the second function').trim()}`);
  run = dp('proofs', IN_C, 'Before anything more');
  const listed = [...run.out.matchAll(/^\s*(?:0x)?([0-9A-Fa-f]{8}(?:@\S+?)?(?:~vu)?)[ ,:]/gm)].map(match => match[1].toUpperCase().replace('~VU', '~vu'));
  const programOf = key => (/@(.+)$/.exec(key)?.[1] ?? '') + (key.endsWith('~vu') && !key.includes('@') ? '~vu' : '');
  const runs = listed.map(programOf).filter((program, at, all) => at === 0 || all[at - 1] !== program);
  check(run.status === 0 && listed.length > 2 && new Set(runs).size === runs.length && runs[0] === '', `the first part's functions are listed a program at a time, the one the disc boots first: ${listed.length} functions of ${runs.map(program => program || 'the boot program').join(', then ')}`);
  const ofModule = listed.filter(key => key.endsWith('@SOUND.IRX'));
  check(ofModule.length > 1 && ofModule.every((key, at) => at === 0 || ofModule[at - 1] < key), `and the module's are together and in their order: ${ofModule.join(', ')}`);
}

const before = tracked(), copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
const status = readFileSync(join(REPO, 'docs', 'STATUS.md'));
tidy();
try {
  await main();
} catch (error) {
  check(false, error.stack ?? error.message);
} finally {
  tidy();
  writeFileSync(join(REPO, 'docs', 'STATUS.md'), status);
  if (copies) writeFileSync(COPIES, copies);
  else rmSync(COPIES, { force: true });
  rmSync(WORK, { recursive: true, force: true });
}
check(tracked() === before, 'nothing the repository tracks has changed');
if (failures.length) {
  console.log(`\n${failures.length} failed.`);
  process.exit(1);
}
console.log('\nprove lists each part\'s functions on the PlayStation 2, each kind in the part it first runs in.');
process.exit(0);
