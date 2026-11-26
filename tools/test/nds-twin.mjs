// npm run test:nds-twin: tries the Nintendo DS's function check (../nds/twin.mjs) with a made-up cartridge written for
// it (made-up-nds-twin.mjs) and its twins in C (nds-twin/game.c), so it needs nobody's copy of any game. The original's
// side is melonDS's own two processors, built from its makers' source (../nds/call.cpp); the twins are built to
// WebAssembly with the console's addresses folded (../lib/wasm-fold.mjs). First the original by itself: a function in
// ARM code and one in Thumb code on the ARM9, and one on the ARM7, each with what it gives back, what it leaves in the
// memory, what it reads and which of its instructions ran, and why one doesn't come back. Then every twin has to leave
// the same memory as its original over every path, but one with a path no call takes, which isn't counted as proven,
// and those whose original the check can't follow, which say why. Then one line of the twins is changed at a time,
// and the check has to find each, with the call and the address that differ. Last, the same cartridge as a game of
// its own, through the tools everyone runs: npm run dp -- twin keeps each proof in proof/proofs.json, and
// npm run dp -- proofs --check reads them.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { LOCAL, REPO, gameFolder, proofFolder } from '../lib/paths.mjs';
import { startingFiles } from '../lib/new-game.mjs';
import { twinsIn } from '../gba/match.mjs';
import { findFunctions, ndsCartridgeOf } from '../nds/functions.mjs';
import { checkFile, imageOf, openNdsBuild } from '../nds/twin.mjs';
import { buildCaller, CAME_BACK, COPROCESSOR, ELSEWHERE, endText, imageAfter, inImage, MEMORY_END, Original, OUT_OF_STEPS } from '../nds/original.mjs';
import { madeUpNdsTwin, MIRRORED, VALUES } from './made-up-nds-twin.mjs';

const GAME = fileURLToPath(new URL('./nds-twin/game.c', import.meta.url));
const work = join(LOCAL, 'tmp', 'nds-twin-test');
const CALLS = 600;

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
const tracked = () => spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: REPO, encoding: 'utf8' }).stdout;
const before = tracked();
const hex = n => (n >>> 0).toString(16).toUpperCase().padStart(8, '0');

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const { rom, sha1, labels, functions } = madeUpNdsTwin();
const game = readFileSync(GAME, 'utf8');
const code = ndsCartridgeOf(rom);
const found = findFunctions(code);
const functionOf = program => address => found.find(f => f.address === address && (f.program ?? null) === program) ?? null;
const named = new Map([['values', labels.values]]);
const of = Object.fromEntries(functions.map(f => [f.name, { ...f, size: functionOf(f.program ?? null)(f.address)?.size }]));

console.log('The cartridge\'s functions, and the twins that name them:');
{
  const missing = functions.filter(f => { const at = functionOf(f.program ?? null)(f.address); return !at || (at.mode ?? null) !== (f.mode ?? null); });
  check(!missing.length && found.length === 19, `the function finder finds each of the two programs' 19 functions, in ARM code or in Thumb as it is${missing.length ? `, but ${missing.map(f => f.name).join(', ')}` : ''}`);
  const twins = twinsIn(game, [], null, 'nds');
  const wrong = twins.filter(twin => { const f = of[twin.name]; return !f || (f.program ? twin.address !== null || twin.keyed?.address !== f.address || twin.keyed?.program !== f.program : twin.address !== f.address); });
  check(twins.length === 15 && !wrong.length, `each of the 15 twins names its function, the ARM7's two by their keys${wrong.length ? `, but ${wrong.map(t => t.name).join(', ')}` : ''}`);
}

const original = new Original(buildCaller());
let tries = 0;
// the twins with `changes` made, each [what's there, what goes there instead], built and checked, a program at a time:
// every result by name
async function tried(changes = [], options = {}) {
  let text = game;
  for (const [from, to] of changes) {
    if (!text.includes(from)) throw new Error(`nds-twin/game.c has no "${from}" for the test to change.`);
    text = text.replace(from, to);
  }
  const root = join(work, `try-${tries++}`);
  mkdirSync(root, { recursive: true });
  const file = join(root, 'game.c');
  writeFileSync(file, text);
  const results = {};
  for (const program of [null, 'ARM7']) {
    const build = openNdsBuild({ root, files: [file], program, thumbAt: address => functionOf(program)(address & ~1)?.mode === 'thumb' });
    const result = await checkFile({ code, program, build, file, addressOf: name => named.get(name) ?? null, functionOf: functionOf(program), original, options: { calls: CALLS, seconds: 1, ...options } });
    if (result.error) throw new Error(result.error);
    if (result.missing) throw new Error(`no address for ${result.missing.join(', ')}`);
    for (const f of result.functions) results[f.name] = f;
  }
  return results;
}

try {
  console.log('The original, a function at a time, in melonDS\'s processors:');
  const { image } = imageOf(code);
  await original.image(image);
  const STACK = 0x023F0000, BACK = 0x01FF8000;
  const call = (name, args = [], more = {}) => {
    const f = of[name], thumb = f.mode === 'thumb';
    const registers = Array.from({ length: 16 }, (_, i) => (i < 4 ? args[i] ?? 0 : i === 13 ? STACK : i === 14 ? BACK | (thumb ? 1 : 0) : i === 15 ? 0 : 0x1000 + i));
    return original.call({ address: f.address, span: f.size, thumb, arm7: f.program === 'ARM7', registers, ...more });
  };
  const word = (bytes, address) => new DataView(bytes.buffer).getUint32(inImage(address), true);
  const sum = await call('arm_sum', [2, 3]);
  check(sum.end === CAME_BACK && sum.registers[0] === 5 && sum.steps === 2 && [...sum.ran].join() === '1,0,1,0' && !sum.reads.length && !sum.chunks.length, `arm_sum(2, 3), in ARM code on the ARM9, comes back with 5 in r0 in two instructions, having read and written nothing (${endText(sum)}, ${sum.registers[0]})`);
  check(isDeepStrictEqual(await call('arm_sum', [2, 3]), sum), 'the same call again gives the same answer');
  const over = await call('arm_clamp', [200]), under = await call('arm_clamp', [0xFFFFFFF0]);
  check(over.registers[0] === 100 && under.registers[0] === 0 && over.ran[2] === (1 | 2) && over.ran[6] === (1 | 4) && under.ran[2] === (1 | 4) && under.ran[6] === (1 | 2), 'an ARM instruction that waits on a condition says whether it held: arm_clamp\'s two moves, one way with 200 and the other with -16');
  const fill = await call('arm_fill', [labels.buffer, 3, 0x5A]);
  check(fill.end === CAME_BACK && word(imageAfter(image, [], fill.chunks), labels.buffer) === 0x005A5A5A && fill.ran[8] === (1 | 2 | 4), `arm_fill writes three bytes and no fourth, its loop's branch going both ways (0x${hex(word(imageAfter(image, [], fill.chunks), labels.buffer))})`);
  const lookup = await call('arm_lookup', [2]);
  check(lookup.registers[0] === VALUES[2] && lookup.reads.some(read => read.address === labels.values + 8 && read.bytes === 4 && read.value === VALUES[2] && !read.beside) && lookup.reads.some(read => read.beside && read.value === labels.values), 'arm_lookup(2) reads the third value and gives it back, and the address it read from beside itself is told apart');
  const max = await call('thumb_max', [1, 2]), other = await call('thumb_max', [7, 2]);
  check(max.registers[0] === 2 && other.registers[0] === 7 && max.ran[1] === (1 | 4) && other.ran[1] === (1 | 2) && max.ran[2] === 1 && other.ran[2] === 0, 'thumb_max, in Thumb code on the ARM9, gives the larger, its branch one way with 1 and 2 and the other with 7 and 2');
  const twice = await call('thumb_twice', [21]);
  check(twice.end === CAME_BACK && twice.registers[0] === 42 && twice.registers[13] === STACK && [...twice.ran].every(ran => ran === 1), 'thumb_twice(21) calls thumb_add and gives back 42, its stack back where it was, each half of its call an instruction that ran');
  const mirrored = await call('thumb_mirror', [], { changes: [[MIRRORED - 0x400000, 4, 0xCAFE]] }), again = await call('thumb_mirror');
  check(mirrored.registers[0] === 0xCAFE && again.registers[0] === 0, 'a word of the main memory is read where it\'s seen again, 4 MB up, and a value changed for one call is as it was for the next');
  const count = await call('seven_count', [labels.arm7.counter]);
  check(count.end === CAME_BACK && count.registers[0] === 1 && word(imageAfter(image, [], count.chunks), labels.arm7.counter) === 1, 'seven_count, in ARM code on the ARM7, adds one to its word of the memory and gives it back');
  const mix = await call('seven_mix', [5, 3]);
  check(mix.end === CAME_BACK && mix.registers[0] === 12 && mix.steps === 3, 'seven_mix(5, 3), in Thumb code on the ARM7, gives back 12');
  const bios = await call('thumb_bios');
  check(bios.end === ELSEWHERE && bios.detail === 0xFFFF0008 && /the BIOS, for a call of the BIOS/.test(endText(bios)), `a call of the BIOS stops where it goes: ${endText(bios)}`);
  const io = await call('arm_io', [1]);
  check(io.end === MEMORY_END && io.detail === 0x04000208 && io.pc === of.arm_io.address + 4 && /the hardware's registers/.test(endText(io)), `a write to a register of the hardware's stops there: ${endText(io)}`);
  const control = await call('arm_control');
  check(control.end === COPROCESSOR && control.steps === 0, `the system control coprocessor stops a call before it's asked: ${endText(control)}`);
  const forever = await original.call({ address: labels.main, span: 32, thumb: true, registers: Array.from({ length: 16 }, (_, i) => (i === 13 ? STACK : i === 14 ? BACK | 1 : 0)), limit: 1000 });
  check(forever.end === OUT_OF_STEPS || forever.end === ELSEWHERE, `the program's main, which never comes back, doesn't: ${endText(forever)}`);

  console.log('The twins as they are:');
  const right = await tried();
  const same = ['arm_sum', 'arm_clamp', 'arm_fill', 'arm_lookup', 'thumb_max', 'thumb_add', 'thumb_twice', 'thumb_store', 'thumb_mirror', 'seven_count', 'seven_mix'];
  check(same.every(name => right[name]?.kind === 'same' && right[name].compared === CALLS), `${same.join(', ')}: the same memory on all ${CALLS} calls (${same.filter(name => right[name]?.kind !== 'same').map(name => `${name} ${right[name]?.line}`).join('; ')})`);
  check(same.every(name => right[name]?.whole), `each over every instruction and both ways of each condition, in ARM code and in Thumb, on the ARM9 and on the ARM7 (${same.filter(name => !right[name]?.whole).map(name => `${name}: ${right[name]?.left?.map(([at, how]) => `${at.toString(16)} ${how}`).join(', ')}`).join('; ')})`);
  const path = right.thumb_path;
  check(path?.kind === 'same' && path.compared === CALLS && !path.whole && path.left.some(([at, how]) => at === of.thumb_path.address + 4 && how === 'its condition never held') && path.left.some(([at, how]) => at === of.thumb_path.address + 10 && how === 'never ran'),
    `a function with a path no call takes is the same on every call and isn't counted as proven: ${path?.left?.map(([at, how]) => `0x${hex(at)} ${how}`).join(', ')}`);
  check(right.thumb_bios?.kind === 'unchecked' && /the BIOS, for a call of the BIOS/.test(right.thumb_bios.line), `a function whose original goes into the BIOS isn't checked, and says so: ${right.thumb_bios?.line}`);
  check(right.arm_io?.kind === 'unchecked' && /0x04000208, the hardware's registers/.test(right.arm_io.line), `nor one whose original writes a register of the hardware's: ${right.arm_io?.line}`);
  check(right.arm_control?.kind === 'unchecked' && /used a coprocessor/.test(right.arm_control.line), `nor one whose original uses the system control coprocessor: ${right.arm_control?.line}`);

  console.log('A line changed, a twin at a time:');
  // the twins that call each, which a change to it changes too
  const callers = { thumb_add: ['thumb_twice'] };
  const wrong = async (name, changes, kind, what, pattern = null, options = {}) => {
    const run = await tried(changes, options);
    const f = run[name], others = Object.values(run).filter(other => other.name !== name && same.includes(other.name) && !callers[name]?.includes(other.name));
    check(f?.kind === kind && (!pattern || pattern.test(f.line)) && others.every(other => other.kind === 'same'), `${what}: ${f?.kind} ${f?.line}${others.some(other => other.kind !== 'same') ? `, and ${others.filter(other => other.kind !== 'same').map(other => other.name).join(', ')} with it` : ''}`);
  };
  await wrong('arm_sum', [['return a + b;\n}\n\n/** 0x0200002C', 'return a - b;\n}\n\n/** 0x0200002C']], 'differs', 'a difference instead of a sum, in ARM code', /^call [\d,]+, arm_sum\(0x[0-9A-F]{8}, 0x[0-9A-F]{8}\): the twin gave back 0x[0-9A-F]{8} and the original 0x[0-9A-F]{8}\.$/);
  await wrong('arm_clamp', [['if (a < 0) a = 0;', 'if (a < 0) a = 1;']], 'differs', 'the wrong number where an ARM instruction\'s condition holds', /the twin gave back 0x00000001 and the original 0x00000000/);
  await wrong('arm_fill', [['while (count != 0) {', 'to[count] = value;\n  while (count != 0) {']], 'differs', 'a byte too many, found with the call and the address', /^call [\d,]+, arm_fill\(0x02[0-9A-F]{6}, 0x[0-9A-F]{8}, 0x[0-9A-F]{8}\).*: at 0x02[0-9A-F]{6}, in the console's main memory, the twin left 0x[0-9A-F]{2} and the original 0x[0-9A-F]{2}/);
  await wrong('arm_lookup', [['return values[index & 3];', 'return values[(index & 3) ^ 1];']], 'differs', 'the value beside the one asked for');
  await wrong('thumb_max', [['if (a >= b) return a;', 'if ((unsigned)a >= (unsigned)b) return a;']], 'differs', 'numbers compared without their signs, in Thumb code', /thumb_max\(/);
  await wrong('thumb_store', [['*(unsigned *)(to + 2) = value;', '*(unsigned *)(to + 1) = value;']], 'differs', 'a word kept two bytes early', /in the console's main memory, the twin left 0x/);
  await wrong('thumb_mirror', [['0x027FFC00', '0x027FFC04']], 'differs', 'the word after the one read through the memory\'s mirror', /after 0x023FFC0[0-7] was set to/);
  await wrong('seven_count', [['*counter += 1;\n  return *counter;', '*counter += 2;\n  return *counter - 1;']], 'differs', 'one too many kept in the memory, on the ARM7', /seven_count\(0x02[0-9A-F]{6}\).*: at 0x02[0-9A-F]{6}, in the console's main memory/);
  await wrong('seven_mix', [['return (a ^ b) << 1;', 'return (a ^ b) << 2;']], 'differs', 'a shift too far, in Thumb code on the ARM7', /the twin gave back/);
  await wrong('arm_sum', [['return a + b;\n}\n\n/** 0x0200002C', '*(volatile unsigned *)0x04000208 = 1;\n  return a + b;\n}\n\n/** 0x0200002C']], 'differs', 'a register of the hardware\'s written where the original writes none', /the twin wrote outside the console's main memory, at an address that ends in 00208/);
  await wrong('thumb_add', [['return a + b;\n}\n\n/** 0x020000B4', 'for (;;) {}\n  return a + b;\n}\n\n/** 0x020000B4']], 'never', 'a twin that never comes back is stopped after its second', /was still going after 1 second/);
  await wrong('thumb_twice', [['return thumb_add(a, a);', 'extern int nowhere(int);\n  return nowhere(a);']], 'unchecked', 'a twin that calls what nothing built is the twin of', /nowhere, which nothing built is the twin of/);
} finally {
  original.close();
}

// The tools as they're typed: the cartridge as a game in games/, for as long as this takes, with its copy shown to the
// tools, made a function at a time.
{
  console.log('Through npm run dp -- twin, and its proofs kept:');
  const NAME = 'test-nds-twin', VERSION = `${NAME}/c`, COPIES = join(LOCAL, 'copies.json');
  const dp = (...args) => {
    const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 24 });
    return { status, out: stdout + stderr };
  };
  const last = run => run.out.trim().split('\n').at(-1);
  const tidy = () => rmSync(gameFolder(NAME), { recursive: true, force: true });
  const copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
  tidy();
  try {
    const copy = join(work, 'made-up.nds');
    writeFileSync(copy, rom);
    mkdirSync(proofFolder(NAME), { recursive: true });
    const made = { console: 'nds', name: 'Test Nintendo DS Twin (World)', title: 'MADE UP TWIN', code: 'MDTE', sha1 };
    writeFileSync(join(proofFolder(NAME), 'original.json'), `${JSON.stringify(made, null, 2)}\n`);
    writeFileSync(join(proofFolder(NAME), 'addresses.json'), `${JSON.stringify({ addresses: Object.fromEntries([...named].map(([name, address]) => [name, hex(address)])) }, null, 2)}\n`);
    // a version is known by its page, which is written as `new` writes one
    mkdirSync(join(gameFolder(VERSION), 'src'), { recursive: true });
    writeFileSync(join(gameFolder(VERSION), 'index.html'), startingFiles(NAME, made, { language: 'c' })['index.html']);
    const source = join(gameFolder(VERSION), 'src', 'game.c');
    writeFileSync(source, game);
    let run = dp('rom', copy);
    check(run.status === 0 && run.out.includes(NAME), `rom knows the cartridge's copy: ${last(run)}`);
    run = dp('codemap', NAME);
    check(run.status === 0 && /19 functions/.test(run.out), `its code map is made from the copy: ${last(run)}`);
    run = dp('twin', VERSION, '--calls', '300');
    check(run.status === 0 && /12 of 15 functions left the same memory/.test(run.out) && /11 of those 12 took every path/.test(run.out), `every twin of the version is checked, the ARM9's and then the ARM7's, and it ends with 0: ${run.out.trim().split('\n').slice(-2).join(' ')}`);
    check((run.out.match(/The same memory/g) ?? []).length === 12 && (run.out.match(/Not checked/g) ?? []).length === 3 && /The same memory {2}0x0238003A@ARM7 seven_mix, 300 calls/.test(run.out) && /Its calls left out 3 of its 9 instructions and the ways they go/.test(run.out), 'a line for each twin, one of the ARM7\'s by its key, and what the calls of the one with a path not taken left out');
    check(!existsSync(join(proofFolder(VERSION), 'proofs.json')), 'a version that keeps no proofs is given none');
    run = dp('twin', '--seed', '9', VERSION, 'func_020000A8', '--calls', '300');
    check(run.status === 0 && /1 of 1 function left the same memory/.test(run.out) && /thumb_max/.test(run.out), `one function, by its label, with an option before the version: ${last(run)}`);
    run = dp('twin', NAME, '0238001C@ARM7', '--calls', '300');
    check(run.status === 0 && /1 of 1 function/.test(run.out) && /seven_count/.test(run.out), `the game's name alone means its version in C, and a function of the ARM7's is named by its key: ${last(run)}`);

    run = dp('proofs', VERSION, '--start');
    const proofs = join(proofFolder(VERSION), 'proofs.json');
    check(run.status === 0 && existsSync(proofs), `proofs --start makes the version one made a function at a time: ${last(run)}`);
    run = dp('twin', VERSION, '--calls', '300');
    check(run.status === 0 && /Nothing was kept as proven: a proof by the same memory is over 1,000 calls or more/.test(run.out) && !JSON.parse(readFileSync(proofs, 'utf8')).functions.length, 'too few calls keep no proof');
    run = dp('twin', VERSION);
    const kept = () => JSON.parse(readFileSync(proofs, 'utf8')).functions;
    const keys = ['02000024', '0200002C', '02000040', '02000058', '020000A8', '020000B0', '020000B4', '020000BE', '020000D2', '0238001C@ARM7', '0238003A@ARM7'];
    check(run.status === 0 && /11 functions kept as proven by the same memory in games\/test-nds-twin\/c\/proof\/proofs\.json/.test(run.out), `twin keeps each function it proved: ${last(run)}`);
    check(isDeepStrictEqual(kept().map(line => line[0]), keys) && kept().every(line => line[1] === 'memory' && line[4] === 2000), `proofs.json has the 11, the ARM7's two by their keys, each by the same memory over 2,000 calls, and not the one with a path no call took nor those not checked (${kept().map(line => line[0]).join(', ')})`);
    run = dp('proofs', VERSION, '--check');
    check(run.status === 0 && /Every proof kept still holds/.test(run.out), `proofs --check passes on them: ${last(run)}`);
    run = dp('proofs', VERSION);
    check(run.status === 0 && /11/.test(run.out), `proofs counts them: ${run.out.trim().split('\n')[0]}`);
    writeFileSync(source, game.replace('return (a ^ b) << 1;', 'return (a ^ b) * 2;'));
    run = dp('proofs', VERSION, '--check');
    check(run.status !== 0 && /0238003A@ARM7, seven_mix in src\/game\.c, is kept as proven and its twin, or a header or another line of its file, changed since/.test(run.out), 'a twin changed since its proof makes proofs --check fail, naming it');
    run = dp('twin', VERSION, 'seven_mix');
    check(run.status === 0 && /1 function kept as proven by the same memory/.test(run.out) && dp('proofs', VERSION, '--check').status === 0, 'and twin proves it again as it\'s written now');
    writeFileSync(source, game.replace('return a + b;\n}\n\n/** 0x0200002C', 'return a - b;\n}\n\n/** 0x0200002C'));
    run = dp('twin', VERSION, 'arm_sum');
    check(run.status === 3 && /Differs {2}0x02000024 arm_sum: call \d+, arm_sum\(/.test(run.out) && !kept().some(line => line[0] === '02000024'), `a twin that differs ends it with 3, and its proof is kept no longer: ${run.out.trim().split('\n').find(line => /Differs/.test(line))}`);
    run = dp('twin', VERSION, '--memories');
    check(run.status === 1 && /--memories isn't there for a Nintendo DS game yet/.test(run.out), 'memories of play aren\'t taken on the Nintendo DS yet, and it says so');
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
console.log('\nThe Nintendo DS\'s function check does what it says.');
