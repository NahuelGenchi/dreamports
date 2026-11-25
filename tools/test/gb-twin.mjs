// npm run test:gb-twin: tries the Game Boy's function check (../gbc/twin.mjs) with a program of the project's own
// (made-up-gb.mjs, madeUpTwins) and its twins in C (gb-twin/game.c), so it needs nobody's copy of any game. The
// original's side is Gambatte's own processor, which the check builds from its makers' source, fetched as the reference
// emulator's is. Every twin has to be the same as its original. Then one line of the twins is changed at a time, and
// the check has to find each: a wrong number, a wrong flag in a contract, a register a contract leaves out, a place in
// a table that doesn't wrap round at 256, a wrong time, a twin that falls over, and one that never returns. Last, the
// same program as a game of its own, checked through the tool everyone runs, npm run dp -- twin (../twin.mjs), which
// hands the Game Boy's check the command, with its proofs kept: a twin whose calls leave a path out isn't proven.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, REPO, gameFolder, proofFolder } from '../lib/paths.mjs';
import { startingFiles } from '../lib/new-game.mjs';
import { buildCheck, checkTwins, contractsIn } from '../gbc/twin.mjs';
import { madeUpTwins } from './made-up-gb.mjs';

const GAME = fileURLToPath(new URL('./gb-twin/game.c', import.meta.url));
const work = join(LOCAL, 'tmp', 'gb-twin-test');
const CALLS = 2000;
const quiet = () => {};

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const copy = join(work, 'made-up.gb');
writeFileSync(copy, madeUpTwins());
const game = readFileSync(GAME, 'utf8');

// the twins with `changes` made, each [what's there, what goes there instead], built and checked: every result by its twin's name
function tried(name, changes = [], options = {}) {
  let text = game;
  for (const [from, to] of changes) {
    if (!text.includes(from)) throw new Error(`gb-twin/game.c has no "${from}" for the test to change.`);
    text = text.replace(from, to);
  }
  const sources = join(work, name, 'src');
  mkdirSync(sources, { recursive: true });
  writeFileSync(join(sources, 'game.c'), text);
  const built = buildCheck({ rom: readFileSync(copy), sources, work: join(work, name), log: quiet });
  const { results, same } = checkTwins({ built, copy, calls: CALLS, log: quiet, ...options });
  return { same, results, of: Object.fromEntries(results.map(result => [result.call.match(/^\w+/)[0], result])) };
}
const others = (run, name) => run.results.filter(result => result !== run.of[name]).every(result => result.same);

console.log('The contracts as they\'re read:');
{
  const { contracts, bank, errors } = contractsIn(game, 4);
  check(contracts.length === 7 && !errors.length && bank === 0xC010, `seven contracts and the bank's byte, $C010 (${contracts.length}, ${errors.length} unread)`);
  const add = contracts.find(contract => contract.name === 'sub_0500'), send = contracts.find(contract => contract.name === 'sub_0540'), clear = contracts.find(contract => contract.name === 'sub_05A0');
  check(add?.call === 'add_to_total(A)' && add.back === 'CF' && add.given === null && add.offset === 0x0500, 'a call, and after -> what its result equals');
  check(send?.byAddress === 0b100 && send.back === null, 'a register given with & is one the twin changes');
  check(clear?.byAddress === 0b1100000 && clear.given === 'HL >= 0xC100 && HL < 0xDC00', 'a pair given with & is its two registers, and after if what the game gives');
  check(contracts.find(contract => contract.name === 'sub_01_4100')?.offset === 0x4100, 'a function in a switched bank is where its bank is in the program');
  const more = contractsIn('// one\n// dp:twin sub_9000 nothing(A)\n// dp:twin sub_0500 not a call\n// dp:bank $0010\n// dp:twin sub_0500 takes(&SP)\n// dp:twin sub_0500 +16 counts(SP) -> A ? HL : 0 if B >= 2', 4);
  const counts = more.contracts[0];
  check(counts?.allowance === 16 && counts.back === 'A ? HL : 0' && counts.given === 'B >= 2' && counts.stack, 'cycles beyond the function\'s own, and a contract that names SP is given the stack pointer');
  check(more.errors.length === 4 && more.errors.map(error => error.line).join() === '2,3,4,5', 'a line that names no function, has no call, names no byte or gives SP by address is said, with its line');
}

console.log('The twins as they are, from random memories:');
const right = tried('right');
check(right.same === 7, `all seven twins are the same as their originals (${right.same})`);
check(right.results.every(result => result.changed.calls === CALLS), `each on ${CALLS} calls, none left out`);
check(right.of.add_to_total.counts && right.of.pick.counts && !right.of.send.counts, 'the time is compared for the twins that count it');

console.log('One line changed at a time:');
{
  let run = tried('number', [['RAM(0xC022)++;', 'RAM(0xC022) += 2;']]), changed = run.of.add_to_total.changed;
  check(!run.of.add_to_total.same && changed.memory === 0 && changed.gives === CALLS && changed.differs[0]?.[0] === 0xC022 && others(run, 'add_to_total'), 'a wrong number is found, with the byte it leaves different, and no other twin differs');

  run = tried('flag', [['add_to_total(A) -> CF', 'add_to_total(A) -> ZF']]);
  changed = run.of.add_to_total.changed;
  check(!run.of.add_to_total.same && changed.memory === CALLS && changed.gives < CALLS && others(run, 'add_to_total'), 'a wrong flag in a contract is found: the memory is the same and what it gives back isn\'t');

  run = tried('register', [['send(A, &C)', 'send(B, &C)']]);
  check(!run.of.send.same && run.of.send.changed.hardware < CALLS, 'a contract that gives the twin another register than the original takes is found');
  const kept = tried('kept', [['  (*c)++;\n', '']]);
  check(!kept.of.send.same && kept.of.send.changed.gives === 0 && kept.of.send.changed.memory === CALLS, 'and so is a register the twin doesn\'t leave as the original does');

  run = tried('wrap', [['(uint8_t)(index * 4)', 'index * 4']]);
  changed = run.of.pick.changed;
  check(!run.of.pick.same && changed.memory > 0 && changed.memory < CALLS && changed.differs[0]?.[0] === 0xC030 && others(run, 'pick'), `a place in a table that doesn't wrap round at 256 is found (${CALLS - changed.memory} of ${CALLS} calls)`);
  const low = tried('low', [['(uint8_t)(index * 4)', 'index * 4'], ['pick(B) -> A', 'pick(B) -> A if B < 64']]);
  check(low.of.pick.same, 'and isn\'t when the contract says the game only gives a place below 64');

  run = tried('time', [['gb_spend(64);', 'gb_spend(60);']]);
  changed = run.of.pick.changed;
  check(!run.of.pick.same && changed.same === CALLS && changed.time === 0 && /4 cycles short/.test(run.of.pick.why.join(' ')), 'a wrong time is found, where everything else is the same');
  const call = tried('call', [['gb_spend(64);', 'gb_spend(88);'], ['sub_0520 pick(B)', 'sub_0520 +24 pick(B)']]);
  check(call.of.pick.same, 'and a twin that counts the CALL that calls it says so in its contract');

  run = tried('pair', [['gb_write((*from)++, 0);', 'gb_write(*from, 0);']]);
  changed = run.of.clear.changed;
  check(!run.of.clear.same && changed.gives < CALLS && others(run, 'clear'), 'a pair the twin doesn\'t leave as the original leaves its two registers is found');

  run = tried('bank', [['  RAM(0xC010) = bank;\n', '']]);
  check(!run.of.switch_to.same && run.of.switch_to.changed.memory < CALLS && others(run, 'switch_to'), 'a twin that switches a bank and doesn\'t keep its number where the game says is found');

  run = tried('falls', [['RAM(0xC033) = gb_read((uint16_t)(0x5000 + at));', 'RAM(0xC033) = *(volatile uint8_t *)(uintptr_t)at;']]);
  check(!run.of.look.same && (run.of.look.changed?.fell === CALLS || run.of.look.stopped) && others(run, 'look'), 'a twin that falls over is found, and the check goes on to the others');

  const began = Date.now();
  run = tried('hangs', [['  gb_write(0x2000, bank);\n', '  gb_write(0x2000, bank);\n  for (volatile int i = 0; ; i++) {}\n']], { limit: 200, patience: 4000 });
  const seconds = (Date.now() - began) / 1000;
  check(!run.of.switch_to.same && (run.of.switch_to.changed?.ranOn > 0 || run.of.switch_to.stopped) && others(run, 'switch_to'), `a twin that never returns is stopped (${seconds.toFixed(1)} s for the whole check)`);

  let said = '';
  try {
    tried('missing', [['int add_to_total(uint8_t amount)', 'int add_to_totals(uint8_t amount)']]);
  } catch (error) {
    said = error.message;
  }
  check(/didn't build/.test(said) && /add_to_total/.test(said) && /game\.c/.test(said), 'a contract that calls a function the C doesn\'t have stops the build, naming it');
}

// The tool as it's typed: the program as a game in games/, for as long as this takes, with its copy shown to the tools.
{
  console.log('Through npm run dp -- twin:');
  const NAME = 'test-gb-twin', VERSION = `${NAME}/c`, COPIES = join(LOCAL, 'copies.json');
  const dp = (...args) => {
    const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 24 });
    return { status, out: stdout + stderr };
  };
  const tidy = () => { for (const path of [gameFolder(NAME), join(LOCAL, 'twin', `${NAME}-c`)]) rmSync(path, { recursive: true, force: true }); };
  const write = text => {
    mkdirSync(join(gameFolder(VERSION), 'src'), { recursive: true });
    writeFileSync(join(gameFolder(VERSION), 'src', 'game.c'), text);
  };
  const copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
  tidy();
  try {
    mkdirSync(proofFolder(NAME), { recursive: true });
    const original = { console: 'gb', name: 'Test GB Twin (World)', title: 'MADEUP TWINS', code: '', sha1: createHash('sha1').update(readFileSync(copy)).digest('hex') };
    writeFileSync(join(proofFolder(NAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
    // a version is known by its page, which is written as `new` writes one
    mkdirSync(gameFolder(VERSION), { recursive: true });
    writeFileSync(join(gameFolder(VERSION), 'index.html'), startingFiles(NAME, original, { language: 'c' })['index.html']);
    write(game);
    let run = dp('rom', copy);
    check(run.status === 0 && run.out.includes(NAME), 'rom knows the program\'s copy');
    run = dp('twin', VERSION, '--calls', '300');
    check(run.status === 0 && /7 of 7 twins the same as the original on every call/.test(run.out), `every twin of a version is checked, and it ends with 0: ${run.out.trim().split('\n').at(-1)}`);
    check(/300 calls from a memory of random bytes/.test(run.out) && (run.out.match(/the same on all 300 calls/g) ?? []).length === 7, 'with as many calls as --calls says, a line for each twin');
    run = dp('twin', '--seed', '9', VERSION, 'add_to_total', 'sub_0540', '--calls', '300', '--seconds', '1');
    check(run.status === 0 && /2 of 2 twins the same/.test(run.out), `functions are named by the twin's name or the original's, with an option before the version: ${run.out.trim().split('\n').at(-1)}`);
    run = dp('twin', NAME, 'pick', '--calls', '300');
    check(run.status === 0 && /1 of 1 twins the same/.test(run.out), 'the game\'s name alone means its version in C');
    // a version that keeps its proofs (../lib/proofs.mjs): each twin whose calls took every path of the original's is kept
    run = dp('codemap', NAME);
    check(run.status === 0 && /8 functions/.test(run.out), `its code map is made from the copy: ${run.out.trim().split('\n').at(-1)}`);
    run = dp('proofs', VERSION, '--start');
    check(run.status === 0 && existsSync(join(proofFolder(VERSION), 'proofs.json')), 'its proofs start with none');
    const lines = () => JSON.parse(readFileSync(join(proofFolder(VERSION), 'proofs.json'), 'utf8')).functions;
    run = dp('twin', VERSION, '--calls', '1000');
    check(run.status === 0 && /7 of those 7 took every path of the original's function/.test(run.out) && /7 functions kept as proven by the same memory/.test(run.out) && lines().length === 7 && lines().every(line => line[1] === 'memory' && line[4] === 1000),
      `each twin whose calls took every path of the original's is kept as proven by the same memory: ${run.out.trim().split('\n').at(-1)}`);
    run = dp('proofs', VERSION, '--check');
    check(run.status === 0, 'and every proof kept holds');
    run = dp('proofs', VERSION);
    check(run.status === 0 && /7 of 8 functions proven/.test(run.out) && /Functions 00000500 to 000005A0 +proven/.test(run.out) && /Function 00004100 +proven/.test(run.out),
      `its start at $0100, which never comes back to a caller, is the one no proof can be given of, and its tasks are its other functions, a bank each: ${run.out.trim().split('\n').find(line => line.includes('functions proven'))}`);
    write(game.replace('add_to_total(A) -> CF', 'add_to_total(A) -> CF if A < 200'));
    run = dp('proofs', VERSION, '--check');
    check(run.status === 1 && /add_to_total in src\/game\.c, is kept as proven and its twin, or a header or another line of its file, changed since/.test(run.out) && (run.out.match(/changed since/g) ?? []).length === 1, 'a contract changed makes its twin\'s proof stale, and no other\'s');
    // a twin whose calls never take one of the original's paths is the same and isn't proven
    write(game.replace('if HL >= 0xC100 && HL < 0xDC00', 'if HL >= 0xC100 && HL < 0xDC00 && B == 1'));
    run = dp('twin', VERSION, 'clear', '--calls', '1000');
    check(run.status === 0 && /left out 1 of the original's 7 instructions and branch ways, such as sub_05A3 never taken/.test(run.out) && /0 of those 1 took every path/.test(run.out),
      `a twin that is the same on calls that never take one way of a jump is said, and isn't proven: ${run.out.split('\n').find(line => line.includes('left out'))?.trim()}`);
    run = dp('proofs', VERSION, '--check');
    check(run.status === 1 && /clear in src\/game\.c/.test(run.out), 'and its old proof, of another contract, no longer holds');
    write(game.replace('RAM(0xC022)++;', 'RAM(0xC022) += 2;'));
    run = dp('twin', VERSION, '--calls', '1000');
    check(run.status === 3 && lines().length === 6, 'a twin that differs loses its line');
    run = dp('twin', VERSION, '--calls', '300');
    check(run.status === 3 && /6 of 7 twins the same/.test(run.out) && /add_to_total\(A\): differs/.test(run.out), `a twin that differs ends it with 3, as on the other consoles: ${run.out.trim().split('\n').at(-1)}`);
    run = dp('twin', VERSION, '--frames', '10');
    check(run.status === 1 && /--frames isn't one of its options/.test(run.out) && /npm run dp -- twin/.test(run.out), 'an option of another console\'s check is refused, with how the tool is typed');
    run = dp('twin', VERSION, '--memories');
    check(run.status === 1 && /can't start a call from a memory of play on the Game Boy yet/.test(run.out), 'and so are memories of play, which it can\'t take yet, with why');
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
console.log('\nThe Game Boy\'s function check does what it says.');
