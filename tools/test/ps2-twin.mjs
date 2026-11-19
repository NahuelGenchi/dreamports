// npm run test:ps2-twin: tries the PlayStation 2's function check (../ps2/twin.mjs) with the made-up program of
// ps2-twin/program.mjs and its twins in C (ps2-twin/game.c), so it needs nobody's copy of any game. The original's side
// is Play!'s own processor code, built from its makers' source (../ps2/call.cpp); the twins are built to WebAssembly on
// the console's kit, with the console's addresses folded by a table (../lib/wasm-fold.mjs). Every twin has to leave the
// same memory as its original over every path, but those whose original the check can't follow, which say why. Then one
// line of the twins is changed at a time, and the check has to find each: a wrong sum, a byte too many, a value one
// along, a 64-bit sum cut to 32, a product rounded as a computer rounds, one that clamps a float the console takes as a number, a
// quadword copied from where the console doesn't, an argument in t3 left out, one on the stack left out, a switch with a case too many, a GS
// register four bytes off, a twin that never comes back, one that takes a struct as it is, and one that calls what
// nothing built is. Last, the same
// program as a game of its own, through the tool everyone runs, npm run dp -- twin.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, REPO, gameFolder, proofFolder } from '../lib/paths.mjs';
import { startingFiles } from '../lib/new-game.mjs';
import { twinsIn } from '../gba/match.mjs';
import { checkFile, openPs2Build } from '../ps2/twin.mjs';
import { buildCaller, Original } from '../ps2/original.mjs';
import { madeUpElf } from './ps2-twin/program.mjs';

const GAME = fileURLToPath(new URL('./ps2-twin/game.c', import.meta.url));
const work = join(LOCAL, 'tmp', 'ps2-twin-test');
const CALLS = 300;

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
const tracked = () => spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: REPO, encoding: 'utf8' }).stdout;
const before = tracked();

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const { elf, labels, functions } = madeUpElf();
const game = readFileSync(GAME, 'utf8');
const sizes = new Map(functions.map(f => [f.address, f.size]));
const named = new Map(['values', 'buffer', 'functions'].map(name => [name, labels[name]]));
const TWINS = ['sum', 'fill', 'lookup', 'twice', 'wide', 'scale', 'eight', 'copy16', 'biggest', 'likely', 'pick', 'hardware', 'shine', 'ten', 'game_main', 'kernel', 'misaligned', 'vu0'];

console.log('The twins name the program\'s functions:');
{
  const twins = twinsIn(game, [], null, 'ps2').filter(twin => twin.address !== null);
  const wrong = twins.filter(twin => labels[twin.name === 'game_main' ? 'main' : twin.name] !== twin.address);
  check(twins.length === TWINS.length && !wrong.length, `each of the ${TWINS.length} names the address of its function in the made-up program${wrong.length ? `, but ${wrong.map(t => t.name).join(', ')}` : ''}`);
}

const original = new Original(await buildCaller(), 'ee');
let tries = 0;
// the twins with `changes` made, each [what's there, what goes there instead], built and checked: every result by name
async function tried(changes = [], options = {}) {
  let text = game;
  for (const [from, to] of changes) {
    if (!text.includes(from)) throw new Error(`ps2-twin/game.c has no "${from}" for the test to change.`);
    text = text.replace(from, to);
  }
  const root = join(work, `try-${tries++}`);
  mkdirSync(root, { recursive: true });
  const file = join(root, 'game.c');
  writeFileSync(file, text);
  const build = openPs2Build({ root, files: [file], includes: [root] });
  const result = await checkFile({ elf, build, file, addressOf: name => named.get(name) ?? null, sizeOf: address => sizes.get(address) ?? null, original, options: { calls: CALLS, seconds: 1, ...options } });
  if (result.error) throw new Error(result.error);
  return Object.fromEntries(result.functions.map(f => [f.name, f]));
}

try {
  console.log('The twins as they are:');
  const right = await tried();
  const same = TWINS.filter(name => !['kernel', 'misaligned', 'vu0'].includes(name));
  check(same.every(name => right[name]?.kind === 'same' && right[name].compared === CALLS), `${same.join(', ')}: the same memory on all ${CALLS} calls (${same.filter(name => right[name]?.kind !== 'same').map(name => `${name} ${right[name]?.line}`).join('; ')})`);
  check(same.every(name => right[name]?.whole), `each over every instruction and both ways of each branch (${same.filter(name => !right[name]?.whole).map(name => `${name}: ${right[name]?.left?.map(([at, how]) => `${at.toString(16)} ${how}`).join(', ')}`).join('; ')})`);
  check(right.kernel?.kind === 'unchecked' && /called the console's kernel \(syscall 60\)/.test(right.kernel.line), `a function whose original calls the kernel isn't checked, and says so: ${right.kernel?.line}`);
  check(right.misaligned?.kind === 'unchecked' && /where none of its size starts/.test(right.misaligned.line), `nor one whose original reads where no word starts: ${right.misaligned?.line}`);
  check(right.vu0?.kind === 'unchecked' && /vector unit 0's registers/.test(right.vu0.line), `nor one whose original leaves vector unit 0's registers changed: ${right.vu0?.line}`);
  check(right.product?.address === null, 'a function of the C\'s own, with no address, is named as one');

  console.log('A line changed, a twin at a time:');
  // the twins that call each, which a change to it changes too
  const callers = { sum: ['twice', 'game_main'], twice: ['game_main'], fill: ['game_main'], lookup: ['game_main'], wide: ['game_main'], likely: ['game_main'], pick: ['game_main'], shine: ['game_main'] };
  const wrong = async (name, changes, kind, what, pattern = null, options = {}) => {
    const run = await tried(changes, options);
    const f = run[name], others = Object.values(run).filter(other => other.name !== name && same.includes(other.name) && !callers[name]?.includes(other.name));
    check(f?.kind === kind && (!pattern || pattern.test(f.line)) && others.every(other => other.kind === 'same'), `${what}: ${f?.kind} ${f?.line}${others.some(other => other.kind !== 'same') ? `, and ${others.filter(other => other.kind !== 'same').map(other => other.name).join(', ')} with it` : ''}`);
  };
  await wrong('sum', [['return a + b;', 'return a - b;']], 'differs', 'a difference instead of a sum', /the twin gave back .* and the original/);
  await wrong('fill', [['while (count != 0) {', 'while (count-- >= 0) {\n    count++;']], 'differs', 'a byte too many', /in the console's memory, the twin left 0x/);
  await wrong('lookup', [['return values[index];', 'return values[index + 1];']], 'differs', 'the value one along');
  await wrong('wide', [['return a + b;\n}\n\n// a product', 'return (int)a + b;\n}\n\n// a product']], 'differs', 'a 64-bit sum with one of its numbers cut to 32 bits', /gave back 0x[0-9A-F]{16}/);
  await wrong('scale', [['return ee_mul(a, b);', 'return a * b;']], 'differs', 'a product rounded to the nearest, as a computer rounds, where the EE cuts', /as floats' bits/);
  await wrong('scale', [['return ee_mul(a, b);', 'unsigned x;\n  __builtin_memcpy(&x, &a, 4);\n  if ((x & 0x7F800000u) == 0x7F800000u) x = (x & 0x80000000u) | 0x7F7FFFFFu;\n  __builtin_memcpy(&a, &x, 4);\n  return ee_mul(a, b);']], 'differs', 'a product of a float clamped first, as a computer would need, where the console takes it as a number');
  await wrong('copy16', [['*(unsigned __int128 *)((unsigned)to & ~15u) = *(const unsigned __int128 *)((unsigned)from & ~15u);', '*to = *from;']], 'differs', 'a quadword copied from where the address says, where LQ and SQ leave its low bits out');
  await wrong('eight', [['+ g + h;', '+ g;']], 'differs', 'the eighth argument, in t3, left out');
  await wrong('ten', [['+ i + j;', '+ i;']], 'differs', 'the tenth argument, the second on the stack, left out');
  await wrong('pick', [['case THIRD: return 30;', 'case THIRD: return 30;\n  case 3: return 40;']], 'differs', 'a case too many, which only 3, at the edge of what the original takes, meets', /pick\(0x00000003\)/);
  await wrong('hardware', [['0x12000070', '0x12000074']], 'differs', 'a register of the GS four bytes off', /in the GS's registers/);
  await wrong('shine', [['  return 1;\n}\n\n/** 0x001001F0', '  for (;;) {}\n  return 1;\n}\n\n/** 0x001001F0']], 'never', 'a twin that never comes back is stopped after its second', /was still going after 1 second/);
  await wrong('shine', [['/** 0x001001E8', 'struct pair { int a, b; };\n\n/** 0x001001E8'], ['int shine(int a) {', 'int shine(struct pair a) {']], 'unchecked', 'a twin that takes a struct as it is isn\'t called, and says so', /no register carries/);
  await wrong('twice', [['return sum(a, a);', 'extern int nowhere(int);\n  return nowhere(a);']], 'unchecked', 'a twin that calls what nothing built is the twin of', /nowhere, which nothing built is the twin of/);
} finally {
  original.close();
}

// The tool as it's typed: the program as a game in games/, for as long as this takes, with its copy shown to the tools.
{
  console.log('Through npm run dp -- twin:');
  const NAME = 'test-ps2-twin', VERSION = `${NAME}/c`, COPIES = join(LOCAL, 'copies.json');
  const dp = (...args) => {
    const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 24 });
    return { status, out: stdout + stderr };
  };
  const tidy = () => rmSync(gameFolder(NAME), { recursive: true, force: true });
  const copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
  tidy();
  try {
    const copy = join(work, 'made-up.elf');
    writeFileSync(copy, elf);
    mkdirSync(proofFolder(NAME), { recursive: true });
    const original = { console: 'ps2', name: 'Test PlayStation 2 Twin (World)', title: 'twins', code: '', sha1: createHash('sha1').update(elf).digest('hex') };
    writeFileSync(join(proofFolder(NAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
    writeFileSync(join(proofFolder(NAME), 'addresses.json'), `${JSON.stringify({ addresses: Object.fromEntries([...named].map(([name, address]) => [name, address.toString(16).toUpperCase().padStart(8, '0')])) }, null, 2)}\n`);
    // a version is known by its page, which is written as `new` writes one
    mkdirSync(join(gameFolder(VERSION), 'src'), { recursive: true });
    writeFileSync(join(gameFolder(VERSION), 'index.html'), startingFiles(NAME, original, { language: 'c' })['index.html']);
    writeFileSync(join(gameFolder(VERSION), 'src', 'game.c'), game);
    let run = dp('rom', copy);
    check(run.status === 0 && run.out.includes(NAME), 'rom knows the program\'s copy');
    run = dp('codemap', NAME);
    check(run.status === 0 && /20 functions/.test(run.out), `its code map is made from the copy: ${run.out.trim().split('\n').at(-1)}`);
    run = dp('twin', VERSION, '--calls', '200');
    check(run.status === 0 && /15 of 18 functions left the same memory/.test(run.out) && /15 of those 15 took every path/.test(run.out), `every twin of the version is checked, and it ends with 0: ${run.out.trim().split('\n').slice(-2).join(' ')}`);
    check((run.out.match(/The same memory/g) ?? []).length === 15 && (run.out.match(/Not checked/g) ?? []).length === 3, 'a line for each twin');
    run = dp('twin', '--seed', '9', VERSION, 'func_00100158', '--calls', '200');
    check(run.status === 0 && /1 of 1 function left the same memory/.test(run.out), `one function, by its label, with an option before the version: ${run.out.trim().split('\n').at(-1)}`);
    run = dp('twin', NAME, 'lookup', '--calls', '200');
    check(run.status === 0 && /1 of 1 function/.test(run.out), 'the game\'s name alone means its version in C, and a twin is named by its own name');
    // made a function at a time: twin keeps each proof it finds over enough calls, and a proof goes stale with its twin
    run = dp('proofs', VERSION, '--start');
    check(run.status === 0 && /made a function at a time/.test(run.out), `proofs --start makes it a version made a function at a time: ${run.out.trim().split('\n').at(-1)}`);
    run = dp('twin', VERSION, 'sum', '--calls', '200');
    check(run.status === 0 && /Nothing was kept as proven: a proof by the same memory is over 1,000 calls/.test(run.out), 'a proof isn\'t kept over fewer than 1,000 calls');
    run = dp('twin', VERSION, 'sum', '--calls', '1000');
    check(run.status === 0 && /1 function kept as proven by the same memory in games\/test-ps2-twin\/c\/proof\/proofs\.json/.test(run.out), `over 1,000 calls, a twin proven is kept: ${run.out.trim().split('\n').at(-1)}`);
    run = dp('proofs', VERSION, '--check');
    check(run.status === 0, `and its proof holds, the original's side read from the program twin kept: ${run.out.trim().split('\n').at(-1)}`);
    run = dp('proofs', VERSION);
    check(run.status === 0 && /1 of 20 functions proven, 0 by the same bytes and 1 by the same memory/.test(run.out), `proofs says where the version stands: ${run.out.trim().split('\n')[0]}`);
    writeFileSync(join(gameFolder(VERSION), 'src', 'game.c'), game.replace('return a + b;', 'return a - b;'));
    run = dp('proofs', VERSION, '--check');
    check(run.status !== 0 && /sum/.test(run.out) && /changed/.test(run.out), `a twin changed since its proof makes the check fail: ${run.out.trim().split('\n').find(line => /sum/.test(line))}`);
    run = dp('twin', VERSION, 'sum', '--calls', '200');
    check(run.status === 3 && /Differs  0x00100094 sum: call \d+, sum\(/.test(run.out), `a twin that differs ends it with 3: ${run.out.trim().split('\n').find(line => /Differs/.test(line))}`);
    run = dp('twin', VERSION, '--memories');
    check(run.status === 1 && /--memories isn't there yet on the PlayStation 2/.test(run.out), 'what the PlayStation 2\'s check can\'t do yet is said');
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
console.log('\nThe PlayStation 2\'s function check does what it says.');
