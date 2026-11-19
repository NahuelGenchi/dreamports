// npm run test:ps1-twin: tries the PlayStation's function check (../ps1/twin.mjs) with the made-up program of the
// tools' tests (made-up-ps1.mjs) and its twins in C (ps1-twin/game.c), so it needs nobody's copy of any game. The
// original's side is PCSX ReARMed's own interpreter, built from its makers' source (../ps1/call.c); the twins are
// built to WebAssembly with the console's addresses folded (../lib/wasm-fold.mjs). Every twin has to leave the same
// memory as its original over every path, but those whose original the check can't follow, which say why. Then one
// line of the twins is changed at a time, and the check has to find each: a wrong sum, a byte too many, a value one
// along, a switch with a case too many, which only the edge of what a value holds meets, a sound register two bytes
// off, a twin that never comes back, and one that calls what nothing built is. Last, the same program as a game of
// its own, through the tool everyone runs, npm run dp -- twin.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, REPO, gameFolder, proofFolder } from '../lib/paths.mjs';
import { startingFiles } from '../lib/new-game.mjs';
import { twinsIn } from '../gba/match.mjs';
import { openBuild } from '../gba/twin.mjs';
import { checkFile } from '../ps1/twin.mjs';
import { buildCaller, Original } from '../ps1/original.mjs';
import { madeUpExe } from './made-up-ps1.mjs';

const GAME = fileURLToPath(new URL('./ps1-twin/game.c', import.meta.url));
const work = join(LOCAL, 'tmp', 'ps1-twin-test');
const CALLS = 600;
const LAYOUT = { base: 0x01000000, memory: 0x04000000, code: address => address };

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
const tracked = () => spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: REPO, encoding: 'utf8' }).stdout;
const before = tracked();

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const { exe, labels, functions } = madeUpExe();
const game = readFileSync(GAME, 'utf8');
const sizes = new Map(functions.map(f => [f.address, f.size]));
const named = new Map(['values', 'buffer', 'functions'].map(name => [name, labels[name]]));

console.log('The twins name the program\'s functions:');
{
  const twins = twinsIn(game, [], null, 'ps1');
  const wrong = twins.filter(twin => labels[twin.name === 'game_main' ? 'main' : twin.name] !== twin.address);
  check(twins.length === 11 && !wrong.length, `each of the 11 names the address of its function in the made-up program${wrong.length ? `, but ${wrong.map(t => t.name).join(', ')}` : ''}`);
}

const original = new Original(buildCaller());
let tries = 0;
// the twins with `changes` made, each [what's there, what goes there instead], built and checked: every result by name
async function tried(changes = [], options = {}) {
  let text = game;
  for (const [from, to] of changes) {
    if (!text.includes(from)) throw new Error(`ps1-twin/game.c has no "${from}" for the test to change.`);
    text = text.replace(from, to);
  }
  const root = join(work, `try-${tries++}`);
  mkdirSync(root, { recursive: true });
  const file = join(root, 'game.c');
  writeFileSync(file, text);
  const build = openBuild({ root, files: [file], console: 'ps1', layout: LAYOUT });
  const result = await checkFile({ exe, build, file, addressOf: name => named.get(name) ?? null, sizeOf: address => sizes.get(address) ?? null, original, options: { calls: CALLS, seconds: 1, ...options } });
  if (result.error) throw new Error(result.error);
  return Object.fromEntries(result.functions.map(f => [f.name, f]));
}

try {
  console.log('The twins as they are:');
  const right = await tried();
  const same = ['sum', 'fill', 'lookup', 'twice', 'hardware', 'pick', 'shine', 'game_main'];
  check(same.every(name => right[name]?.kind === 'same' && right[name].compared === CALLS), `${same.join(', ')}: the same memory on all ${CALLS} calls (${same.filter(name => right[name]?.kind !== 'same').map(name => `${name} ${right[name]?.line}`).join('; ')})`);
  check(same.every(name => right[name]?.whole), `each over every instruction and both ways of each branch (${same.filter(name => !right[name]?.whole).map(name => `${name}: ${right[name]?.left?.map(([at, how]) => `${at.toString(16)} ${how}`).join(', ')}`).join('; ')})`);
  check(right.bios?.kind === 'unchecked' && /went into the BIOS/.test(right.bios.line), `a function whose original goes into the BIOS isn't checked, and says so: ${right.bios?.line}`);
  check(right.misaligned?.kind === 'unchecked' && /address error/.test(right.misaligned.line), `nor one whose original reads where no word starts: ${right.misaligned?.line}`);
  check(right.gte?.kind === 'unchecked' && /geometry processor/.test(right.gte.line), `nor one whose original uses the geometry processor: ${right.gte?.line}`);

  console.log('A line changed, a twin at a time:');
  // the twins that call each, which a change to it changes too
  const callers = { sum: ['twice', 'game_main'], twice: ['game_main'], fill: ['game_main'], lookup: ['game_main'], shine: ['game_main'] };
  const wrong = async (name, changes, kind, what, pattern = null, options = {}) => {
    const run = await tried(changes, options);
    const f = run[name], others = Object.values(run).filter(other => other.name !== name && same.includes(other.name) && !callers[name]?.includes(other.name));
    check(f?.kind === kind && (!pattern || pattern.test(f.line)) && others.every(other => other.kind === 'same'), `${what}: ${f?.kind} ${f?.line}${others.some(other => other.kind !== 'same') ? `, and ${others.filter(other => other.kind !== 'same').map(other => other.name).join(', ')} with it` : ''}`);
  };
  await wrong('sum', [['return a + b;', 'return a - b;']], 'differs', 'a difference instead of a sum', /the twin gave back .* and the original/);
  await wrong('fill', [['while (count != 0) {', 'while (count-- >= 0) {\n    count++;']], 'differs', 'a byte too many', /in the console's memory, the twin left 0x/);
  await wrong('lookup', [['return values[index];', 'return values[index + 1];']], 'differs', 'the value one along');
  await wrong('pick', [['case 2: return 30;', 'case 2: return 30;\n  case 3: return 40;']], 'differs', 'a case too many, which only 3, at the edge of what the original takes, meets', /pick\(0x00000003\)/);
  await wrong('hardware', [['0x1F801C00', '0x1F801C02']], 'differs', 'a register of the sound chip two bytes off', /in the hardware's registers/);
  await wrong('shine', [['  return 1;\n}\n\n/** 0x80010018', '  for (;;) {}\n  return 1;\n}\n\n/** 0x80010018']], 'never', 'a twin that never comes back is stopped after its second', /was still going after 1 second/);
  await wrong('twice', [['return sum(a, a);', 'extern int nowhere(int);\n  return nowhere(a);']], 'unchecked', 'a twin that calls what nothing built is the twin of', /nowhere, which nothing built is the twin of/);
} finally {
  original.close();
}

// The tool as it's typed: the program as a game in games/, for as long as this takes, with its copy shown to the tools.
{
  console.log('Through npm run dp -- twin:');
  const NAME = 'test-ps1-twin', VERSION = `${NAME}/c`, COPIES = join(LOCAL, 'copies.json');
  const dp = (...args) => {
    const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 24 });
    return { status, out: stdout + stderr };
  };
  const tidy = () => rmSync(gameFolder(NAME), { recursive: true, force: true });
  const copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
  tidy();
  try {
    const copy = join(work, 'made-up.exe');
    writeFileSync(copy, exe);
    mkdirSync(proofFolder(NAME), { recursive: true });
    const original = { console: 'ps1', name: 'Test PlayStation Twin (World)', title: 'twins', code: '', sha1: createHash('sha1').update(exe).digest('hex') };
    writeFileSync(join(proofFolder(NAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
    writeFileSync(join(proofFolder(NAME), 'addresses.json'), `${JSON.stringify({ addresses: Object.fromEntries([...named].map(([name, address]) => [name, address.toString(16).toUpperCase()])) }, null, 2)}\n`);
    // a version is known by its page, which is written as `new` writes one
    mkdirSync(join(gameFolder(VERSION), 'src'), { recursive: true });
    writeFileSync(join(gameFolder(VERSION), 'index.html'), startingFiles(NAME, original, { language: 'c' })['index.html']);
    writeFileSync(join(gameFolder(VERSION), 'src', 'game.c'), game);
    let run = dp('rom', copy);
    check(run.status === 0 && run.out.includes(NAME), 'rom knows the program\'s copy');
    run = dp('codemap', NAME);
    check(run.status === 0 && /13 functions/.test(run.out), `its code map is made from the copy: ${run.out.trim().split('\n').at(-1)}`);
    run = dp('twin', VERSION, '--calls', '300');
    check(run.status === 0 && /8 of 11 functions left the same memory/.test(run.out) && /8 of those 8 took every path/.test(run.out), `every twin of the version is checked, and it ends with 0: ${run.out.trim().split('\n').slice(-2).join(' ')}`);
    check((run.out.match(/The same memory/g) ?? []).length === 8 && (run.out.match(/Not checked/g) ?? []).length === 3, 'a line for each twin');
    run = dp('twin', '--seed', '9', VERSION, 'func_80010130', '--calls', '300');
    check(run.status === 0 && /1 of 1 function left the same memory/.test(run.out), `one function, by its label, with an option before the version: ${run.out.trim().split('\n').at(-1)}`);
    run = dp('twin', NAME, 'lookup', '--calls', '300');
    check(run.status === 0 && /1 of 1 function/.test(run.out), 'the game\'s name alone means its version in C, and a twin is named by its own name');
    writeFileSync(join(gameFolder(VERSION), 'src', 'game.c'), game.replace('return a + b;', 'return a - b;'));
    run = dp('twin', VERSION, 'sum', '--calls', '300');
    check(run.status === 3 && /Differs  0x80010080 sum: call \d+, sum\(/.test(run.out), `a twin that differs ends it with 3: ${run.out.trim().split('\n').find(line => /Differs/.test(line))}`);
    run = dp('twin', VERSION, '--memories');
    check(run.status === 1 && /--memories isn't there yet on the PlayStation/.test(run.out), 'what the PlayStation\'s check can\'t do yet is said');
  } finally {
    tidy();
    if (copies) writeFileSync(COPIES, copies);
    else rmSync(COPIES, { force: true });
  }
  check(!existsSync(gameFolder(NAME)), 'nothing is left behind');
}

rmSync(work, { recursive: true, force: true });
check(tracked() === before, 'nothing the repository tracks has changed');
if (failures.length) {
  console.log(`\n${failures.length} failed.`);
  process.exit(1);
}
console.log('\nThe PlayStation\'s function check does what it says.');
