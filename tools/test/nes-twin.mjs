// npm run test:nes-twin: tries the NES's function check (../nes/twin.mjs) with a program of the project's own
// (made-up-nes.mjs, madeUpTwins) and its twins in C (nes-twin/game.c), so it needs nobody's copy of any game. The
// original's side is FCEUmm's own processor, which the check builds from its makers' source, fetched as the reference
// emulator's is. Every twin has to be the same as its original, from random memories and from memories made up here.
// Then one line of the twins is changed at a time, and the check has to find each: a wrong number, a wrong flag in a
// contract, a register a contract leaves out, a place in a table that doesn't wrap round at 256, a wrong time, a twin
// that falls over, and one that never returns, which a time limit stops. Last, the same program as a game of its own,
// checked through the tool everyone runs, npm run dp -- twin (../twin.mjs), which hands the NES's check the command.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, REPO, gameFolder, proofFolder } from '../lib/paths.mjs';
import { startingFiles } from '../lib/new-game.mjs';
import { buildCheck, checkTwins, contractsIn } from '../nes/twin.mjs';
import { madeUpTwins } from './made-up-nes.mjs';

const GAME = fileURLToPath(new URL('./nes-twin/game.c', import.meta.url));
const work = join(LOCAL, 'tmp', 'nes-twin-test');
const CALLS = 2000;
const quiet = () => {};

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const copy = join(work, 'made-up.nes');
writeFileSync(copy, madeUpTwins());
const game = readFileSync(GAME, 'utf8');

// the twins with `changes` made, each [what's there, what goes there instead], built and checked: every result by its twin's name
function tried(name, changes = [], options = {}) {
  let text = game;
  for (const [from, to] of changes) {
    if (!text.includes(from)) throw new Error(`nes-twin/game.c has no "${from}" for the test to change.`);
    text = text.replace(from, to);
  }
  const sources = join(work, name, 'src');
  mkdirSync(sources, { recursive: true });
  writeFileSync(join(sources, 'game.c'), text);
  const built = buildCheck({ rom: readFileSync(copy), sources, work: join(work, name), log: console.log });
  const { results, same } = checkTwins({ built, copy, calls: CALLS, log: quiet, ...options });
  return { same, results, of: Object.fromEntries(results.map(result => [result.call.match(/^\w+/)[0], result])) };
}
const others = (run, name) => run.results.filter(result => result !== run.of[name]).every(result => result.same);

console.log('The contracts as they\'re read:');
{
  const { contracts, bank, errors } = contractsIn(game, 4);
  check(contracts.length === 6 && !errors.length && bank === 0x10, `six contracts and the bank's byte, $10 (${contracts.length}, ${errors.length} unread)`);
  const add = contracts.find(contract => contract.name === 'sub_C400'), send = contracts.find(contract => contract.name === 'sub_C440');
  check(add?.call === 'add_to_total(A)' && add.back === 'C' && add.given === null && add.offset === 0xC400, 'a call, and after -> what its result equals');
  check(send?.byAddress === 0b10 && send.back === null, 'a register given with & is one the twin changes');
  const more = contractsIn('// dp:twin sub_C2BC +6 start_task(A) -> C ? Y : 0 if A >= 2 && A <= 16 */\n// dp:twin nothing f(X)\n// dp:twin sub_C400 X\n// dp:bank C7', 4);
  const [task] = more.contracts;
  check(task?.allowance === 6 && task.back === 'C ? Y : 0' && task.given === 'A >= 2 && A <= 16', 'cycles beyond the function\'s own, and after if what the game gives');
  check(more.errors.length === 3 && more.errors.map(error => error.line).join() === '2,3,4', 'a line that names no function, has no call or names no byte is said, with its line');
}

console.log('The twins as they are, from random memories:');
const right = tried('right');
check(right.same === 6, `all six twins are the same as their originals (${right.same})`);
check(right.results.every(result => !result.asItWas && result.changed.calls === CALLS), `each on ${CALLS} calls, none left out`);
check(right.of.add_to_total.counts && right.of.pick.counts && !right.of.send.counts, 'the time is compared for the twins that count it');

console.log('And from memories kept in a file:');
{
  const memories = join(work, 'memories.bin'), bytes = Buffer.alloc(40 * 0x800);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 2654435761 >>> 13) & 0xFF;
  writeFileSync(memories, bytes);
  const kept = tried('right', [], { memories });
  check(kept.same === 6 && kept.results.every(result => result.asItWas.calls === CALLS && result.changed.calls === CALLS), `all six the same, on ${CALLS} calls as they were and ${CALLS} changed`);
}

console.log('One line changed at a time:');
{
  const run = tried('wrong-number', [['RAM[0x22]++;', 'RAM[0x22] += 2;']]);
  const { changed } = run.of.add_to_total;
  check(!run.of.add_to_total.same && changed.memory === 0 && changed.gives === CALLS && changed.bytes[0]?.[0] === 0x22 && others(run, 'add_to_total'), 'a wrong number is found, with the byte it leaves different, and no other twin differs');
}
{
  const run = tried('wrong-flag', [['add_to_total(A) -> C', 'add_to_total(A) -> Z']]);
  const { changed } = run.of.add_to_total;
  check(!run.of.add_to_total.same && changed.memory === CALLS && changed.gives < CALLS && others(run, 'add_to_total'), 'a wrong flag in a contract is found: the memory is the same and what it gives back isn\'t');
}
{
  const run = tried('wrong-register', [['send(A, &X)', 'send(Y, &X)']]);
  check(!run.of.send.same && run.of.send.changed.hardware < CALLS, 'a contract that gives the twin another register than the original takes is found');
  const kept = tried('register-kept', [['(*x)++;', '']]);
  check(!kept.of.send.same && kept.of.send.changed.gives === 0 && kept.of.send.changed.memory === CALLS, 'and so is a register the twin doesn\'t leave as the original does');
}
{
  const wide = ['(uint8_t)(index * 4)', 'index * 4'];
  const run = tried('no-wrap', [wide]);
  const { changed } = run.of.pick;
  check(!run.of.pick.same && changed.memory > 0 && changed.memory < CALLS && changed.bytes[0]?.[0] === 0x30 && others(run, 'pick'), `a place in a table that doesn't wrap round at 256 is found (${CALLS - changed.memory} of ${CALLS} calls)`);
  const low = tried('no-wrap-low', [wide, ['pick(X)', 'pick(X) if X < 64']]);
  check(low.of.pick.same, 'and isn\'t when the contract says the game only gives a place below 64');
}
{
  const run = tried('wrong-time', [['? 26 : 22', '? 26 : 23']]);
  const { changed } = run.of.add_to_total;
  check(!run.of.add_to_total.same && changed.same === CALLS && changed.time > 0 && changed.time < CALLS, 'a wrong time is found, where everything else is the same');
  const call = tried('time-with-call', [['? 26 : 22', '? 32 : 28'], ['sub_C400 add_to_total', 'sub_C400 +6 add_to_total']]);
  check(call.of.add_to_total.same, 'and a twin that counts the JSR that calls it says so in its contract');
}
{
  const run = tried('falls-over', [['RAM[0x33] = in_bank', 'volatile uintptr_t nowhere = 16; *(uint8_t *)nowhere = in_bank']]);
  check(!run.of.look.same && run.of.look.changed.fell === CALLS && others(run, 'look'), 'a twin that falls over is counted, and the check goes on');
}
{
  const began = Date.now();
  const run = tried('never-returns', [['void switch_to(uint8_t bank) { RAM[0x10] = bank; }', 'void switch_to(uint8_t bank) { for (volatile uint8_t i = 0; bank < 2; i++) RAM[0x10] = bank; RAM[0x10] = bank; }']], { limit: 100 });
  const seconds = (Date.now() - began) / 1000;
  check(!run.of.switch_to.same && (run.of.switch_to.changed?.ranOn > 0 || run.of.switch_to.stopped) && others(run, 'switch_to'), `a twin that never returns is stopped by the time limit (${seconds.toFixed(1)} s for the whole check)`);
}
{
  let said = '';
  try {
    tried('unknown-name', [['add_to_total(A) -> C', 'add_to_totals(A) -> C']]);
  } catch (error) {
    said = error.message;
  }
  check(/didn't build/.test(said) && /add_to_totals/.test(said) && /game\.c/.test(said), 'a contract that calls a function the C doesn\'t have stops the build, naming it');
}

// The tool as it's typed: the program as a game in games/, for as long as this takes, with its copy shown to the tools.
{
  console.log('Through npm run dp -- twin:');
  const NAME = 'test-nes-twin', VERSION = `${NAME}/c`, COPIES = join(LOCAL, 'copies.json');
  const dp = (...args) => {
    const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 24 });
    return { status, out: stdout + stderr };
  };
  const tidy = () => { for (const path of [gameFolder(NAME), join(LOCAL, 'twin', NAME)]) rmSync(path, { recursive: true, force: true }); };
  const write = text => {
    mkdirSync(join(gameFolder(VERSION), 'src'), { recursive: true });
    writeFileSync(join(gameFolder(VERSION), 'src', 'game.c'), text);
  };
  const copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
  tidy();
  try {
    mkdirSync(proofFolder(NAME), { recursive: true });
    const original = { console: 'nes', name: 'Test NES Twin (World)', title: 'twins', code: '', sha1: createHash('sha1').update(readFileSync(copy)).digest('hex') };
    writeFileSync(join(proofFolder(NAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
    // a version is known by its page, which is written as `new` writes one
    mkdirSync(gameFolder(VERSION), { recursive: true });
    writeFileSync(join(gameFolder(VERSION), 'index.html'), startingFiles(NAME, original, { language: 'c' })['index.html']);
    write(game);
    let run = dp('rom', copy);
    check(run.status === 0 && run.out.includes(NAME), 'rom knows the program\'s copy');
    run = dp('twin', VERSION, '--calls', '300');
    check(run.status === 0 && /6 of 6 twins the same as the original on every call/.test(run.out), `every twin of a version is checked, and it ends with 0: ${run.out.trim().split('\n').at(-1)}`);
    check(/300 calls from random memories/.test(run.out) && (run.out.match(/the same on all 300 calls/g) ?? []).length === 6, 'with as many calls as --calls says, a line for each twin');
    run = dp('twin', '--seed', '9', VERSION, 'add_to_total', 'sub_C440', '--calls', '300', '--seconds', '1');
    check(run.status === 0 && /2 of 2 twins the same/.test(run.out), `functions are named by the twin's name or the original's, with an option before the version: ${run.out.trim().split('\n').at(-1)}`);
    run = dp('twin', NAME, 'pick', '--calls', '300');
    check(run.status === 0 && /1 of 1 twins the same/.test(run.out), 'the game\'s name alone means its version in C');
    // a version that keeps its proofs (../lib/proofs.mjs): each twin whose calls took every path of the original's is kept
    run = dp('codemap', NAME);
    check(run.status === 0 && existsSync(join(proofFolder(NAME), 'code-map.json')), `its code map is made from the copy: ${run.out.trim().split('\n').at(-1)}`);
    run = dp('proofs', VERSION, '--start');
    check(run.status === 0 && existsSync(join(proofFolder(VERSION), 'proofs.json')), 'its proofs start with none');
    const lines = () => JSON.parse(readFileSync(join(proofFolder(VERSION), 'proofs.json'), 'utf8')).functions;
    run = dp('twin', VERSION, '--calls', '1000');
    check(run.status === 0 && /6 of those 6 took every path of the original's function/.test(run.out) && /6 functions kept as proven by the same memory/.test(run.out) && lines().length === 6 && lines().every(line => line[1] === 'memory' && line[4] === 1000),
      `each twin whose calls took every path of the original's is kept as proven by the same memory: ${run.out.trim().split('\n').at(-1)}`);
    run = dp('proofs', VERSION, '--check');
    check(run.status === 0, 'and every proof kept holds');
    write(game.replace('add_to_total(A) -> C', 'add_to_total(A) -> C if A < 200'));
    run = dp('proofs', VERSION, '--check');
    check(run.status === 1 && /add_to_total in src\/game\.c, is kept as proven and its twin, or a header or another line of its file, changed since/.test(run.out) && (run.out.match(/changed since/g) ?? []).length === 1, 'a contract changed makes its twin\'s proof stale, and no other\'s');
    write(game.replace('RAM[0x22]++;', 'RAM[0x22] += 2;'));
    run = dp('twin', VERSION, '--calls', '1000');
    check(run.status === 3 && lines().length === 5, 'a twin that differs loses its line');
    run = dp('twin', VERSION, '--calls', '300');
    check(run.status === 3 && /5 of 6 twins the same/.test(run.out) && /add_to_total\(A\): differs/.test(run.out), `a twin that differs ends it with 3, as on the Game Boy Advance: ${run.out.trim().split('\n').at(-1)}`);
    run = dp('twin', VERSION, '--frames', '10');
    check(run.status === 1 && /--frames isn't one of its options/.test(run.out) && /npm run dp -- twin/.test(run.out), 'an option of another console\'s check is refused, with how the tool is typed');
    run = dp('twin', VERSION, 'nothing_here');
    check(run.status === 1 && /No contract is for nothing_here/.test(run.out), 'and so is a function with no contract');
  } finally {
    tidy();
    if (copies) writeFileSync(COPIES, copies);
    else rmSync(COPIES, { force: true });
  }
  check(!existsSync(gameFolder(NAME)), 'nothing is left behind');
}

rmSync(work, { recursive: true, force: true });
if (failures.length) {
  console.log(`\n${failures.length} failed.`);
  process.exit(1);
}
console.log('\nThe NES\'s function check does what it says.');
