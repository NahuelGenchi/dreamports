// npm run test:n64-twin: tries the Nintendo 64's function check (../n64/twin.mjs) with the made-up program of the tools'
// tests (made-up-n64.mjs) and its twins in C (n64-twin/game.c), so it needs nobody's copy of any game. The original's
// side is Parallel N64's own processor, built from its makers' source (../n64/call.c); the twins are built to
// WebAssembly with the console's addresses folded and its numbers kept highest byte first (../lib/wasm-fold.mjs).
// Every twin has to leave the same memory as its original over every path, but those whose original the check can't
// follow, which say why: 64-bit numbers, floats and doubles in memory and in registers among them. Then one line of the
// twins is changed at a time, and the check has to find each: a wrong sum, a byte too many, a value one along, a
// switch with a case too many, a register of the video interface two bytes off, a halfword where the original kept a
// word, a product of doubles kept as floats, a twin that never comes back, and one that calls what nothing built is.
// Last, the same program as a game of its own, through the tool everyone runs, npm run dp -- twin.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, REPO, gameFolder, proofFolder } from '../lib/paths.mjs';
import { startingFiles } from '../lib/new-game.mjs';
import { twinsIn } from '../gba/match.mjs';
import { buildFor, checkFile, placesOf } from '../n64/twin.mjs';
import { buildCaller, Original } from '../n64/original.mjs';
import { madeUpCartridge } from './made-up-n64.mjs';

const GAME = fileURLToPath(new URL('./n64-twin/game.c', import.meta.url));
const work = join(LOCAL, 'tmp', 'n64-twin-test');
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
const { cartridge, labels, functions } = madeUpCartridge();
const game = readFileSync(GAME, 'utf8');
const sizes = new Map(functions.map(f => [f.address, f.size]));
const named = new Map(['values', 'buffer', 'functions'].map(name => [name, labels[name]]));

console.log('The twins name the program\'s functions, and o32 places their arguments:');
{
  const twins = twinsIn(game, [], null, 'n64');
  const wrong = twins.filter(twin => labels[twin.name === 'game_main' ? 'main' : twin.name] !== twin.address);
  check(twins.length === 18 && !wrong.length, `each of the 18 names the address of its function in the made-up program${wrong.length ? `, but ${wrong.map(t => t.name).join(', ')}` : ''}`);
  const int = { bits: 32 }, float = { bits: 32, float: true }, double = { bits: 64, float: true }, long = { bits: 64 };
  const places = list => placesOf(list).map(({ word, fpr }) => (fpr === null ? `w${word}` : `f${fpr}`)).join(' ');
  check(places([float, float]) === 'f12 f14' && places([double, double]) === 'f12 f14' && places([int, float]) === 'w0 w1' && places([float, int, float]) === 'f12 w1 w2'
    && places([int, long]) === 'w0 w2' && places([double, int, int, int]) === 'f12 w2 w3 w4', 'floats first go in $f12 and $f14, and a 64-bit number on an even word');
}

const original = new Original(buildCaller());
let tries = 0;
// the twins with `changes` made, each [what's there, what goes there instead], built and checked: every result by name
async function tried(changes = [], { only = null, ...options } = {}) {
  let text = game;
  for (const [from, to] of changes) {
    if (!text.includes(from)) throw new Error(`n64-twin/game.c has no "${from}" for the test to change.`);
    text = text.replace(from, to);
  }
  const root = join(work, `try-${tries++}`);
  mkdirSync(root, { recursive: true });
  const file = join(root, 'game.c');
  writeFileSync(file, text);
  const build = buildFor({ root, files: [file] });
  const result = await checkFile({ cartridge, build, file, only, addressOf: name => named.get(name) ?? null, sizeOf: address => sizes.get(address) ?? null, original, options: { calls: CALLS, seconds: 1, ...options } });
  if (result.error) throw new Error(result.error);
  return Object.fromEntries(result.functions.map(f => [f.name, f]));
}

try {
  console.log('The twins as they are:');
  const right = await tried();
  const same = ['sum', 'fill', 'lookup', 'twice', 'wide', 'likely', 'addf', 'square', 'mulf', 'addd', 'bits', 'hardware', 'pick', 'shine', 'game_main'];
  check(same.every(name => right[name]?.kind === 'same' && right[name].compared === CALLS), `${same.join(', ')}: the same memory on all ${CALLS} calls (${same.filter(name => right[name]?.kind !== 'same').map(name => `${name} ${right[name]?.line}`).join('; ')})`);
  check(same.every(name => right[name]?.whole), `each over every instruction and both ways of each branch (${same.filter(name => !right[name]?.whole).map(name => `${name}: ${right[name]?.left?.map(([at, how]) => `${at.toString(16)} ${how}`).join(', ')}`).join('; ')})`);
  check(right.cartridge?.kind === 'unchecked' && /went into the cartridge/.test(right.cartridge.line), `a function whose original reads the cartridge isn't checked, and says so: ${right.cartridge?.line}`);
  check(right.misaligned?.kind === 'unchecked' && /address error/.test(right.misaligned.line), `nor one whose original reads where no word starts: ${right.misaligned?.line}`);
  check(right.trap?.kind === 'unchecked' && /syscall/.test(right.trap.line), `nor one whose original makes a syscall: ${right.trap?.line}`);

  console.log('A line changed, a twin at a time:');
  // each change checks the twin it's in alone, as the twins as they are were all checked above
  const wrong = async (name, changes, kind, what, pattern = null) => {
    const run = await tried(changes, { only: labels[name] });
    const f = run[name];
    check(f?.kind === kind && (!pattern || pattern.test(f.line)) && Object.keys(run).length === 1, `${what}: ${f?.kind} ${f?.line}`);
  };
  await wrong('sum', [['return a + b;', 'return a - b;']], 'differs', 'a difference instead of a sum', /the twin gave back .* and the original/);
  await wrong('fill', [['while (count != 0) {', 'while (count-- >= 0) {\n    count++;']], 'differs', 'a byte too many', /in the console's memory, the twin left 0x/);
  await wrong('lookup', [['return values[index];', 'return values[index + 1];']], 'differs', 'the value one along');
  await wrong('pick', [['case 2: return 30;', 'case 2: return 30;\n  case 3: return 40;']], 'differs', 'a case too many, which only 3, at the edge of what the original takes, meets', /pick\(0x00000003\)/);
  await wrong('hardware', [['0xA440000C', '0xA440000E']], 'differs', 'a register of the video interface two bytes off', /in the video interface's registers/);
  await wrong('wide', [['*to = made;', '*(unsigned *)to = made;']], 'differs', 'the low word kept where the console keeps the high one', /in the console's memory/);
  await wrong('square', [['at[1] = at[0] * at[0];', 'at[1] = (float)at[0] * (float)at[0];']], 'differs', 'a product of doubles made as floats', /in the console's memory/);
  await wrong('mulf', [['return a * b;', 'return a * b + 1;']], 'differs', 'a float one more', /as floats' bits/);
  await wrong('shine', [['  return 1;\n}\n\n/** 0x80000418', '  for (;;) {}\n  return 1;\n}\n\n/** 0x80000418']], 'never', 'a twin that never comes back is stopped after its second', /was still going after 1 second/);
  await wrong('twice', [['return sum(a, a);', 'extern int nowhere(int);\n  return nowhere(a);']], 'unchecked', 'a twin that calls what nothing built is the twin of', /nowhere, which nothing built is the twin of/);
} finally {
  original.close();
}

// The tool as it's typed: the program as a game in games/, for as long as this takes, with its copy shown to the tools.
{
  console.log('Through npm run dp -- twin:');
  const NAME = 'test-n64-twin', VERSION = `${NAME}/c`, COPIES = join(LOCAL, 'copies.json');
  const dp = (...args) => {
    const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 24 });
    return { status, out: stdout + stderr };
  };
  const tidy = () => rmSync(gameFolder(NAME), { recursive: true, force: true });
  const copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
  tidy();
  try {
    // the copy in the .n64 order, each word turned round, as many copies come
    const copy = join(work, 'made-up.n64'), swapped = Buffer.from(cartridge);
    for (let i = 0; i < swapped.length; i += 4) swapped.writeUInt32LE(cartridge.readUInt32BE(i), i);
    writeFileSync(copy, swapped);
    mkdirSync(proofFolder(NAME), { recursive: true });
    const original = { console: 'n64', name: 'Test Nintendo 64 Twin (World)', title: 'DREAMPORTS MADE UP', code: 'NDPE', sha1: createHash('sha1').update(swapped).digest('hex') };
    writeFileSync(join(proofFolder(NAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
    writeFileSync(join(proofFolder(NAME), 'addresses.json'), `${JSON.stringify({ addresses: Object.fromEntries([...named].map(([name, address]) => [name, address.toString(16).toUpperCase()])) }, null, 2)}\n`);
    // a version is known by its page, which is written as `new` writes one
    mkdirSync(join(gameFolder(VERSION), 'src'), { recursive: true });
    writeFileSync(join(gameFolder(VERSION), 'index.html'), startingFiles(NAME, original, { language: 'c' })['index.html']);
    writeFileSync(join(gameFolder(VERSION), 'src', 'game.c'), game);
    let run = dp('rom', copy);
    check(run.status === 0 && run.out.includes(NAME), 'rom knows the program\'s copy');
    run = dp('codemap', NAME);
    check(run.status === 0 && /21 functions/.test(run.out), `its code map is made from the copy: ${run.out.trim().split('\n').at(-1)}`);
    run = dp('twin', VERSION, '--calls', '300');
    check(run.status === 0 && /15 of 18 functions left the same memory/.test(run.out) && /15 of those 15 took every path/.test(run.out), `every twin of the version is checked, and it ends with 0: ${run.out.trim().split('\n').slice(-2).join(' ')}`);
    check((run.out.match(/The same memory/g) ?? []).length === 15 && (run.out.match(/Not checked/g) ?? []).length === 3, 'a line for each twin');
    run = dp('twin', '--seed', '9', VERSION, 'func_800005AC', '--calls', '300');
    check(run.status === 0 && /1 of 1 function left the same memory/.test(run.out), `one function, by its label, with an option before the version: ${run.out.trim().split('\n').at(-1)}`);
    run = dp('twin', NAME, 'lookup', '--calls', '300');
    check(run.status === 0 && /1 of 1 function/.test(run.out), 'the game\'s name alone means its version in C, and a twin is named by its own name');
    writeFileSync(join(gameFolder(VERSION), 'src', 'game.c'), game.replace('return a + b;', 'return a - b;'));
    run = dp('twin', VERSION, 'sum', '--calls', '300');
    check(run.status === 3 && /Differs  0x8000047C sum: call \d+, sum\(/.test(run.out), `a twin that differs ends it with 3: ${run.out.trim().split('\n').find(line => /Differs/.test(line))}`);
    run = dp('twin', VERSION, '--memories');
    check(run.status === 1 && /--memories isn't there yet on the Nintendo 64/.test(run.out), 'what the Nintendo 64\'s check can\'t do yet is said');

    console.log('Its proofs, from proofs --start on:');
    const source = join(gameFolder(VERSION), 'src', 'game.c'), proofs = join(proofFolder(VERSION), 'proofs.json');
    const kept = () => JSON.parse(readFileSync(proofs, 'utf8')).functions;
    const SUM = '8000047C', lastLine = () => run.out.trim().split('\n').at(-1);
    writeFileSync(source, game);
    run = dp('twin', VERSION, 'sum', '--calls', '1000');
    check(run.status === 0 && !/kept as proven/.test(run.out) && !existsSync(proofs), 'a version made a part at a time keeps nothing');
    run = dp('proofs', VERSION, '--start');
    check(run.status === 0 && existsSync(proofs) && kept().length === 0, `its proofs start with none: ${lastLine().slice(0, 90)}…`);
    run = dp('twin', VERSION, '--calls', '300');
    check(run.status === 0 && /Nothing was kept as proven: a proof by the same memory is over 1,000 calls or more/.test(run.out) && kept().length === 0, 'a few calls are no proof');
    run = dp('twin', VERSION, '--calls', '1000');
    check(run.status === 0 && /15 functions kept as proven by the same memory/.test(run.out) && kept().length === 15 && kept().every(line => /^80[0-9A-F]{6}$/.test(line[0]) && line[1] === 'memory' && line[4] === 1000) && kept().some(line => line[0] === SUM),
      `twin keeps each function whose calls took every path of the original's, by its address: ${lastLine()}`);
    const asTwinLeft = readFileSync(proofs, 'utf8');
    run = dp('proofs', VERSION);
    check(run.status === 0 && /15 of 21 functions proven, 0 by the same bytes and 15 by the same memory/.test(run.out) && /The function the console starts the cartridge at is in no task/.test(run.out),
      `the version says how many functions have each proof, and that the one the cartridge starts is in no task: ${run.out.trim().split('\n')[0]}`);
    check(dp('proofs', VERSION, '--check').status === 0, 'proofs --check holds them');
    writeFileSync(source, game.replace('return a + b;', 'return b + a;'));
    run = dp('proofs', VERSION, '--check');
    check(run.status === 1 && run.out.includes(`${SUM}, sum in src/game.c, is kept as proven and its twin, or a header or another line of its file, changed since`) && (run.out.match(/changed since/g) ?? []).length === 1, `a proof goes stale when its twin's C changes, its own and no other's: ${run.out.trim().split('\n')[0]}`);
    // on a computer with no copy of the game, the twins' side is still held
    const known = readFileSync(COPIES);
    rmSync(COPIES);
    run = dp('proofs', VERSION, '--check');
    check(run.status === 1 && run.out.includes(SUM), 'with no copy of the game here, the changed twin is still found');
    writeFileSync(source, game);
    check(dp('proofs', VERSION, '--check').status === 0, 'and the proofs hold again with the twin as it was');
    writeFileSync(COPIES, known);
    // the original's mark is of where the code loads too: a line of other bytes, or of another place, doesn't pass
    writeFileSync(proofs, asTwinLeft.replace(new RegExp(`(\\["${SUM}","memory","[0-9a-f]{16}",)"[0-9a-f]{16}"`), '$1"0123456789abcdef"'));
    run = dp('proofs', VERSION, '--check');
    check(run.status === 1 && run.out.includes(`${SUM}, sum in src/game.c, is kept as proven and the copy has other bytes there`), 'a line of another original than the copy\'s doesn\'t pass for a proof');
    writeFileSync(proofs, asTwinLeft);
    writeFileSync(source, game.replace('return a + b;', 'return a - b;'));
    run = dp('twin', VERSION, 'sum', '--calls', '1000');
    check(run.status === 3 && kept().length === 14 && !kept().some(line => line[0] === SUM), 'a twin that differs loses its proof');
    writeFileSync(source, game);
    run = dp('twin', VERSION, 'sum', '--calls', '1000');
    check(run.status === 0 && /1 function kept as proven by the same memory/.test(run.out) && readFileSync(proofs, 'utf8') === asTwinLeft, 'and proven again, the file is as it was');
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
console.log('\nThe Nintendo 64\'s function check does what it says.');
