// npm run test:psp-twin: tries the PlayStation Portable's function check (../psp/twin.mjs) with a made-up program of the
// tools' tests (made-up-psp-twin.mjs) and its twins in C (psp-twin/game.c), so it needs nobody's copy of any game. The
// original's side is PPSSPP's own interpreter, called a function at a time from inside the core by the tools' patch
// (../libretro/ppsspp.patch, ../psp/original.mjs); the twins are built to WebAssembly on the console's kit in C. Every
// twin has to leave the same memory as its original over every path, but those whose original the check can't follow
// or give arguments to, which say why. Then one line of the twins is changed at a time, and the check has to find each:
// a wrong sum, a byte too many, a value one along, a switch with a case too many, which only the edge of what a value
// holds meets, the smaller for the larger, a twin that never comes back, and one that calls what nothing built is. Of
// the functions that use the floating-point unit or the Allegrex's own instructions, each through what the kit's
// psp.h has for it: one that rounds a half down where the original rounds it up, a float cast as C casts it where the
// console gives the nearest whole number a word holds, and a remainder for a quotient.
// Last, the same program as a game of its own, through the tool everyone runs, npm run dp -- twin, which keeps the
// proofs it finds once the version keeps proofs.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, REPO, gameFolder, proofFolder } from '../lib/paths.mjs';
import { startingFiles } from '../lib/new-game.mjs';
import { twinsIn } from '../gba/match.mjs';
import { findFunctions } from '../psp/functions.mjs';
import { checkFile, openPspBuild } from '../psp/twin.mjs';
import { Original } from '../psp/original.mjs';
import { madeUpPspTwin, NAMES, UNITS } from './made-up-psp-twin.mjs';

const GAME = fileURLToPath(new URL('./psp-twin/game.c', import.meta.url));
const work = join(LOCAL, 'tmp', 'psp-twin-test');
const CALLS = 600;

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
const tracked = () => spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: REPO, encoding: 'utf8' }).stdout;
const before = tracked();

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const { elf, at } = madeUpPspTwin();
const copy = join(work, 'twins.prx');
writeFileSync(copy, elf);
// the twins, with each original's address where the program has it
const game = readFileSync(GAME, 'utf8').replace(/@([A-Z_]+)@/g, (_, name) => `0x${at[name.toLowerCase()].toString(16).toUpperCase().padStart(8, '0')}`);
const sizes = new Map(findFunctions(elf).map(f => [f.address, f.size]));
const named = new Map([['values', at.values]]);

console.log('The twins name the program\'s functions:');
{
  const twins = twinsIn(game, [], null, 'psp');
  const wrong = twins.filter(twin => at[twin.name === 'system_time' ? 'clock' : twin.name] !== twin.address);
  check(twins.length === NAMES.length - 1 && !wrong.length, `each of the ${NAMES.length - 1} names the address of its function in the made-up program${wrong.length ? `, but ${wrong.map(t => t.name).join(', ')}` : ''}`);
  check(NAMES.every(name => sizes.has(at[name])), 'and the code map\'s finder finds each of the program\'s functions');
}

const original = new Original(copy);
let tries = 0;
async function tried(changes = [], options = {}) {
  let text = game;
  for (const [from, to] of changes) {
    if (!text.includes(from)) throw new Error(`psp-twin/game.c has no "${from}" for the test to change.`);
    text = text.replace(from, to);
  }
  const root = join(work, `try-${tries++}`);
  mkdirSync(root, { recursive: true });
  const file = join(root, 'game.c');
  writeFileSync(file, text);
  const build = openPspBuild({ root, files: [file] });
  const result = await checkFile({ elf, build, file, addressOf: name => named.get(name) ?? null, sizeOf: address => sizes.get(address) ?? null, original, options: { calls: CALLS, seconds: 1, ...options } });
  if (result.error) throw new Error(result.error);
  if (result.missing) throw new Error(`No address for ${result.missing.join(', ')}`);
  return Object.fromEntries(result.functions.map(f => [f.name, f]));
}

try {
  console.log('The twins as they are:');
  const right = await tried();
  const same = ['sum', 'fill', 'lookup', 'twice', 'pick', 'bigger', 'middle', ...UNITS];
  check(same.every(name => right[name]?.kind === 'same' && right[name].compared === CALLS), `${same.join(', ')}: the same memory on all ${CALLS} calls (${same.filter(name => right[name]?.kind !== 'same').map(name => `${name} ${right[name]?.line}`).join('; ')})`);
  check(same.every(name => right[name]?.whole), `each over every instruction and both ways of each branch (${same.filter(name => !right[name]?.whole).map(name => `${name}: ${right[name]?.left?.map(([address, how]) => `${address.toString(16)} ${how}`).join(', ')}`).join('; ')})`);
  check(right.system_time?.kind === 'unchecked' && /called the system's functions/.test(right.system_time.line), `a function whose original calls the system isn't checked, and says so: ${right.system_time?.line}`);

  console.log('A line changed, a twin at a time:');
  const callers = { sum: ['twice'] };
  const wrong = async (name, changes, kind, what, pattern = null, options = {}) => {
    const run = await tried(changes, options);
    const f = run[name], others = Object.values(run).filter(other => other.name !== name && same.includes(other.name) && !callers[name]?.includes(other.name));
    check(f?.kind === kind && (!pattern || pattern.test(f.line)) && others.every(other => other.kind === 'same'), `${what}: ${f?.kind} ${f?.line}${others.some(other => other.kind !== 'same') ? `, and ${others.filter(other => other.kind !== 'same').map(other => other.name).join(', ')} with it` : ''}`);
  };
  await wrong('sum', [['return a + b;', 'return a - b;']], 'differs', 'a difference instead of a sum', /the twin gave back .* and the original/);
  await wrong('fill', [['while (count != 0) {', 'while (count-- >= 0) {\n    count++;']], 'differs', 'a byte too many', /in the console's memory, the twin left 0x/);
  await wrong('lookup', [['return values[index];', 'return values[index + 1];']], 'differs', 'the value one along');
  await wrong('pick', [['case 2: return 30;', 'case 2: return 30;\n  case 3: return 40;']], 'differs', 'a case too many, which only 3, at the edge of what the original takes, meets', /pick\(0x00000003\)/);
  await wrong('bigger', [['return a > b ? a : b;', 'return a < b ? a : b;']], 'differs', 'the smaller for the larger');
  await wrong('middle', [['return (x >> 4) & 0xFF;', 'for (;;) {}\n  return (x >> 4) & 0xFF;']], 'never', 'a twin that never comes back is stopped after its second', /was still going after 1 second/);
  await wrong('twice', [['return sum(a, a);', 'extern int nowhere(int);\n  return nowhere(a);']], 'unchecked', 'a twin that calls what nothing built is the twin of', /nowhere, which nothing built is the twin of/);
  await wrong('whole', [['return psp_round_w_s(x);', 'return psp_cvt_w_s(x, PSP_FPU_NEAREST);']], 'differs', 'a half rounded to the even whole number, where round.w.s rounds it up', /as floats' bits|the twin gave back/);
  {
    const run = await tried([['return psp_trunc_w_s(x);', 'return (int)x;']]);
    check(['differs', 'stopped'].includes(run.cut?.kind), `a float cast as C casts it, where the console gives the nearest whole number a word holds: ${run.cut?.kind} ${run.cut?.line}`);
  }
  await wrong('quotient', [['return (int)psp_div(a, b).lo;', 'return (int)psp_div(a, b).hi;']], 'differs', 'the remainder for the quotient');
} finally {
  original.close();
}

// The tool as it's typed: the program as a game in games/, for as long as this takes, with its copy shown to the tools.
{
  console.log('Through npm run dp -- twin:');
  const NAME = 'test-psp-twin', VERSION = `${NAME}/c`, COPIES = join(LOCAL, 'copies.json');
  const dp = (...args) => {
    const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 24 });
    return { status, out: stdout + stderr };
  };
  const tidy = () => rmSync(gameFolder(NAME), { recursive: true, force: true });
  const copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
  tidy();
  try {
    mkdirSync(proofFolder(NAME), { recursive: true });
    const theOriginal = { console: 'psp', name: 'Test PlayStation Portable Twin (World)', title: 'twins', code: '', sha1: createHash('sha1').update(elf).digest('hex') };
    writeFileSync(join(proofFolder(NAME), 'original.json'), `${JSON.stringify(theOriginal, null, 2)}\n`);
    writeFileSync(join(proofFolder(NAME), 'addresses.json'), `${JSON.stringify({ addresses: Object.fromEntries([...named].map(([name, address]) => [name, address.toString(16).toUpperCase().padStart(8, '0')])) }, null, 2)}\n`);
    mkdirSync(join(gameFolder(VERSION), 'src'), { recursive: true });
    writeFileSync(join(gameFolder(VERSION), 'index.html'), startingFiles(NAME, theOriginal, { language: 'c' })['index.html']);
    writeFileSync(join(gameFolder(VERSION), 'src', 'game.c'), game);
    let run = dp('rom', copy);
    check(run.status === 0 && run.out.includes(NAME), 'rom knows the program\'s copy');
    run = dp('codemap', NAME);
    check(run.status === 0 && new RegExp(`${NAMES.length} functions`).test(run.out), `its code map is made from the copy: ${run.out.trim().split('\n').at(-1)}`);
    run = dp('twin', VERSION, '--calls', '300');
    // every twin but the one whose original calls the system
    const checkedSame = NAMES.length - 2;
    check(run.status === 0 && new RegExp(`${checkedSame} of ${NAMES.length - 1} functions left the same memory`).test(run.out) && new RegExp(`${checkedSame} of those ${checkedSame} took every path`).test(run.out), `every twin of the version is checked, and it ends with 0: ${run.out.trim().split('\n').slice(-2).join(' ')}`);
    check((run.out.match(/The same memory/g) ?? []).length === checkedSame && (run.out.match(/Not checked/g) ?? []).length === 1, 'a line for each twin');
    run = dp('twin', NAME, 'lookup', '--calls', '300');
    check(run.status === 0 && /1 of 1 function/.test(run.out), `the game's name alone means its version in C, and a twin is named by its own name: ${run.out.trim().split('\n').at(-1)}`);
    run = dp('twin', '--seed', '9', VERSION, at.pick.toString(16).toUpperCase().padStart(8, '0'), '--calls', '300');
    check(run.status === 0 && /1 of 1 function left the same memory/.test(run.out), `one function, by its address, with an option before the version: ${run.out.trim().split('\n').at(-1)}`);
    writeFileSync(join(gameFolder(VERSION), 'src', 'game.c'), game.replace('return a + b;', 'return a - b;'));
    run = dp('twin', VERSION, 'sum', '--calls', '300');
    check(run.status === 3 && /Differs  0x[0-9A-F]{8} sum: call \d+, sum\(/.test(run.out), `a twin that differs ends it with 3: ${run.out.trim().split('\n').find(line => /Differs/.test(line))}`);
    writeFileSync(join(gameFolder(VERSION), 'src', 'game.c'), game);
    // made a function at a time: its proofs are kept once it keeps them
    run = dp('proofs', VERSION, '--start');
    check(run.status === 0, `proofs --start starts the version's proofs: ${run.out.trim().split('\n').at(-1)}`);
    run = dp('twin', VERSION, '--calls', '1000');
    const kept = existsSync(join(proofFolder(VERSION), 'proofs.json')) ? JSON.parse(readFileSync(join(proofFolder(VERSION), 'proofs.json'), 'utf8')).functions : [];
    check(run.status === 0 && kept.length === checkedSame && kept.every(line => line[1] === 'memory' && line[4] === 1000), `twin keeps each of the ${checkedSame} proven by the same memory over 1,000 calls: ${run.out.trim().split('\n').at(-1)}`);
    run = dp('proofs', VERSION, '--check');
    check(run.status === 0, `and proofs --check holds them: ${run.out.trim().split('\n').at(-1)}`);
    writeFileSync(join(gameFolder(VERSION), 'src', 'game.c'), game.replace('return (x >> 4) & 0xFF;', 'return (x >> 4) & 0xFF; /* the same */'));
    run = dp('proofs', VERSION, '--check');
    check(run.status === 0, 'not even when a twin\'s comment changes');
    writeFileSync(join(gameFolder(VERSION), 'src', 'game.c'), game.replace('return (x >> 4) & 0xFF;', 'return (x >> 3) & 0xFF;'));
    run = dp('proofs', VERSION, '--check');
    check(run.status === 1 && /changed since/.test(run.out), `but when its code changes, its proof is stale: ${run.out.trim().split('\n')[0]}`);
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
console.log('\nThe PlayStation Portable\'s function check does what it says.');
