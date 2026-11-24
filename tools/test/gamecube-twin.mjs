// npm run test:gamecube-twin: tries the GameCube's function check (../gamecube/twin.mjs) with the made-up program of the
// tools' tests (made-up-gamecube.mjs), booted from its disc in Dolphin, and its twins in C (gamecube-twin/game.c), so it
// needs nobody's copy of any game. The original's side is Dolphin's own interpreter, through the tools' change to it
// (../libretro/dolphin.patch); the twins are built to WebAssembly with the console's addresses folded and its numbers
// kept highest byte first (../lib/wasm-fold.mjs). Every twin has to leave the same memory as its original over every
// path, the hardware's registers among it, but the one whose original waits for the beam, which in a call never moves,
// and says so. Then one line of the twins is changed at a time, and the check has to find each: a difference for a sum,
// a shift left by 32 or more that keeps bits, a division by zero that gives 0 whatever the sign, a 64-bit sum short of
// its carry, a case of a switch one off, the square's colours the other way round, a line of the controller's blocks
// short, a register of the serial interface one off, and a twin that never comes back. Last, the same program as a game
// of its own, through the tool everyone runs, npm run dp -- twin, which keeps a proof once the version is made a
// function at a time, the original's side read from the program twin kept on this computer, and loses it when its twin
// changes.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, REPO, gameFolder, proofFolder } from '../lib/paths.mjs';
import { startingFiles } from '../lib/new-game.mjs';
import { formatCodeMap } from '../lib/proof-files.mjs';
import { twinsIn } from '../gba/match.mjs';
import { buildFor, checkFile, placesOf } from '../gamecube/twin.mjs';
import { buildCaller, Original } from '../gamecube/original.mjs';
import * as made from './made-up-gamecube.mjs';

const GAME = fileURLToPath(new URL('./gamecube-twin/game.c', import.meta.url));
const work = join(LOCAL, 'tmp', 'gamecube-twin-test');
const CALLS = 500;

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
const tracked = () => spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: REPO, encoding: 'utf8' }).stdout;
const before = tracked();
const hex = value => `0x${(value >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const program = made.madeUpGameCube(), disc = made.madeUpGameCubeDisc({ program }).image, copy = join(work, 'disc.iso');
writeFileSync(copy, disc);
const { functions } = program;
const sizes = new Map(Object.values(functions).map(f => [f.address, f.size]));
// the twins with the program's numbers written in: a function's address by its name, as `square`, and a number by its
// name in capitals, as `SQUARE`, the square's colour
const numbers = { ...made, VALUES: made.VALUES, TONE: program.tone, TONE_BLOCKS: made.tone().length / 32 };
const game = readFileSync(GAME, 'utf8').replace(/@([A-Za-z_]+)@/g, (_, key) => {
  if (functions[key]) return hex(functions[key].address);
  if (typeof numbers[key] !== 'number' || key !== key.toUpperCase()) throw new Error(`The made-up program has no function or number called ${key}.`);
  return `0x${(numbers[key] >>> 0).toString(16).toUpperCase()}`;
});

console.log('The twins name the program\'s functions, and the embedded ABI places their arguments:');
{
  const twins = twinsIn(game, [], null, 'gamecube');
  const wrong = twins.filter(twin => functions[twin.name]?.address !== twin.address);
  check(twins.length === 11 && !wrong.length, `each of the 11 names the address of its function in the made-up program${wrong.length ? `, but ${wrong.map(t => t.name).join(', ')}` : ''}`);
  const int = { bits: 32 }, float = { bits: 32, float: true }, double = { bits: 64, float: true }, long = { bits: 64 };
  const places = list => placesOf(list).map(place => (place === null ? 'stack' : place.fpr !== null ? `f${place.fpr}` : `r${place.gpr}`)).join(' ');
  check(places([int, int]) === 'r3 r4' && places([float, double, int]) === 'f1 f2 r3' && places([int, long]) === 'r3 r5' && places([long, long]) === 'r3 r5'
    && places(Array(9).fill(int)).endsWith('r10 stack') && places(Array(9).fill(float)).endsWith('f8 stack'), 'whole numbers in r3 to r10, a 64-bit one from an odd one, and floats in f1 to f8');
}

const original = new Original(buildCaller(), copy);
let tries = 0;
// the twins with `changes` made, each [what's there, what goes there instead], built and checked: every result by name
async function tried(changes = [], { only = null, ...options } = {}) {
  let text = game;
  for (const [from, to] of changes) {
    if (!text.includes(from)) throw new Error(`gamecube-twin/game.c has no "${from}" for the test to change.`);
    text = text.replace(from, to);
  }
  const root = join(work, `try-${tries++}`);
  mkdirSync(root, { recursive: true });
  const file = join(root, 'game.c');
  writeFileSync(file, text);
  const build = buildFor({ root, files: [file] });
  const result = await checkFile({ dol: program.dol, build, file, only, addressOf: () => null, sizeOf: address => sizes.get(address) ?? null, original, options: { calls: CALLS, seconds: 1, ...options } });
  if (result.error) throw new Error(result.error);
  return Object.fromEntries(result.functions.map(f => [f.name, f]));
}

try {
  console.log('The twins as they are:');
  const right = await tried();
  const same = ['fill', 'square', 'bits', 'setup', 'sum', 'compare', 'shift', 'divide', 'wide', 'pick'];
  check(same.every(name => right[name]?.kind === 'same' && right[name].compared === CALLS), `${same.join(', ')}: the same memory on all ${CALLS} calls (${same.filter(name => right[name]?.kind !== 'same').map(name => `${name} ${right[name]?.line}`).join('; ')})`);
  check(same.every(name => right[name]?.whole), `each over every instruction and both ways of each branch (${same.filter(name => !right[name]?.whole).map(name => `${name}: ${right[name]?.left?.map(([address, how]) => `${address.toString(16)} ${how}`).join(', ')}`).join('; ')})`);
  check(right.wait?.kind === 'unchecked' && /didn't come back/.test(right.wait.line), `a function whose original waits for the beam, which never moves in a call, isn't checked, and says so: ${right.wait?.line}`);

  console.log('A line changed, a twin at a time:');
  // each change checks the twin it's in alone, as the twins as they are were all checked above
  const wrong = async (name, changes, kind, what, pattern = null) => {
    const run = await tried(changes, { only: functions[name].address });
    const f = run[name];
    check(f?.kind === kind && (!pattern || pattern.test(f.line)) && Object.keys(run).length === 1, `${what}: ${f?.kind} ${f?.line}`);
  };
  await wrong('sum', [['return a + b;', 'return a - b;']], 'differs', 'a difference instead of a sum', /the twin gave back .* and the original/);
  await wrong('shift', [['unsigned left = n & 32 ? 0 : a << n,', 'unsigned left = a << n,']], 'differs', 'a shift left by 32 or more that keeps bits, where the processor shifts them all out');
  await wrong('divide', [['return a < 0 ? -1 : 0;', 'return 0;']], 'differs', 'a division by zero that gives 0 whatever the sign');
  await wrong('wide', [['unsigned long long wide(unsigned long long a, unsigned long long b) {\n  return a + b;', 'unsigned long long wide(unsigned long long a, unsigned long long b) {\n  return ((a + b) & 0xFFFFFFFF00000000ull) - (((unsigned)a + (unsigned long long)(unsigned)b) & 0x100000000ull) + (unsigned)(a + b);']], 'differs', 'a 64-bit sum short of the carry from its low words');
  await wrong('pick', [['case 2: return 35;', 'case 2: return 36;']], 'differs', 'a case one off', /pick\(0x00000002\)/);
  await wrong('square', [['for (int pair = 0; pair < SQUARE_SIZE / 2; pair++) at[pair] = even;', 'for (int pair = 0; pair < SQUARE_SIZE / 2; pair++) at[pair] = odd;']], 'differs', 'the colours of the lines the other way round', /in the console's memory/);
  await wrong('bits', [['line = 0x8;', 'line = 0x7;']], 'differs', 'a line of each block short', /in the console's memory/);
  await wrong('setup', [['*(volatile unsigned *)0xCC006430u = ', '*(volatile unsigned *)0xCC006430u = 1 + ']], 'differs', 'a register of the serial interface one off', /in the hardware's registers/);
  await wrong('compare', [['int compare(int a, int b) {\n', 'int compare(int a, int b) {\n  if (a == b) for (;;) {}\n']], 'never', 'a twin that never comes back is stopped after its second', /was still going after 1 second/);
} finally {
  original.close();
}

// The tool as it's typed: the program as a game in games/, for as long as this takes, with its disc shown to the tools.
{
  console.log('Through npm run dp -- twin:');
  const NAME = 'test-gamecube-twin', VERSION = `${NAME}/c`, COPIES = join(LOCAL, 'copies.json');
  const dp = (...args) => {
    const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 24 });
    return { status, out: stdout + stderr };
  };
  const tidy = () => rmSync(gameFolder(NAME), { recursive: true, force: true });
  const copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
  tidy();
  try {
    mkdirSync(proofFolder(NAME), { recursive: true });
    const original = { console: 'gamecube', name: 'Test GameCube Twin (World)', title: 'Made-up program', code: 'GMUE00', sha1: createHash('sha1').update(disc).digest('hex') };
    writeFileSync(join(proofFolder(NAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
    writeFileSync(join(proofFolder(NAME), 'code-map.json'), formatCodeMap({ original: original.sha1, from: 'The test\'s own program', functions: Object.values(functions).map(({ address, size }) => ({ address, size })) }));
    // a version is known by its page, which is written as `new` writes one
    mkdirSync(join(gameFolder(VERSION), 'src'), { recursive: true });
    writeFileSync(join(gameFolder(VERSION), 'index.html'), startingFiles(NAME, original, { language: 'c' })['index.html']);
    writeFileSync(join(gameFolder(VERSION), 'src', 'game.c'), game);
    let run = dp('rom', copy);
    check(run.status === 0 && run.out.includes(NAME), 'rom knows the program\'s disc');
    run = dp('twin', VERSION, '--calls', '200');
    check(run.status === 0 && /10 of 11 functions left the same memory/.test(run.out) && /10 of those 10 took every path/.test(run.out), `every twin of the version is checked, and it ends with 0: ${run.out.trim().split('\n').slice(-2).join(' ')}`);
    run = dp('twin', '--seed', '9', VERSION, `fn_${hex(functions.pick.address).slice(2)}`, '--calls', '200');
    check(run.status === 0 && /1 of 1 function left the same memory/.test(run.out), `one function, by its label, with an option before the version: ${run.out.trim().split('\n').at(-1)}`);
    run = dp('twin', NAME, 'divide', '--calls', '200');
    check(run.status === 0 && /1 of 1 function/.test(run.out), 'the game\'s name alone means its version in C, and a twin is named by its own name');
    // made a function at a time: twin keeps each proof it finds over enough calls, and a proof goes stale with its twin
    run = dp('proofs', VERSION, '--start');
    check(run.status === 0 && /made a function at a time/.test(run.out), `proofs --start makes it a version made a function at a time: ${run.out.trim().split('\n').at(-1)}`);
    run = dp('twin', VERSION, 'sum', '--calls', '200');
    check(run.status === 0 && /Nothing was kept as proven: a proof by the same memory is over 1,000 calls/.test(run.out), 'a proof isn\'t kept over fewer than 1,000 calls');
    run = dp('twin', VERSION, 'sum', '--calls', '1000');
    check(run.status === 0 && /1 function kept as proven by the same memory in games\/test-gamecube-twin\/c\/proof\/proofs\.json/.test(run.out), `over 1,000 calls, a twin proven is kept: ${run.out.trim().split('\n').at(-1)}`);
    run = dp('proofs', VERSION, '--check');
    check(run.status === 0, `and its proof holds, the original's side read from the program twin kept: ${run.out.trim().split('\n').at(-1)}`);
    run = dp('proofs', VERSION);
    check(run.status === 0 && /1 of 12 functions proven, 0 by the same bytes and 1 by the same memory/.test(run.out), `proofs says where the version stands: ${run.out.trim().split('\n')[0]}`);
    writeFileSync(join(gameFolder(VERSION), 'src', 'game.c'), game.replace('return a + b;\n}\n\n/**', 'return a - b;\n}\n\n/**'));
    run = dp('proofs', VERSION, '--check');
    check(run.status !== 0 && /sum/.test(run.out) && /changed/.test(run.out), `a twin changed since its proof makes the check fail: ${run.out.trim().split('\n').find(line => /sum/.test(line))}`);
    run = dp('twin', VERSION, 'sum', '--calls', '200');
    check(run.status === 3 && new RegExp(`Differs  ${hex(functions.sum.address)} sum: call \\d+, sum\\(`).test(run.out), `a twin that differs ends it with 3: ${run.out.trim().split('\n').find(line => /Differs/.test(line))}`);
    run = dp('twin', VERSION, '--memories');
    check(run.status === 1 && /--memories isn't there yet on the GameCube/.test(run.out), 'what the GameCube\'s check can\'t do yet is said');
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
console.log('\nThe GameCube\'s function check does what it says.');
