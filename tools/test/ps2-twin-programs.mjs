// npm run test:ps2-twin-programs: tries the PlayStation 2's function check on the programs a disc has beside the one it
// boots (../ps2/twin.mjs, ../ps2/twin-iop.mjs), with a made-up disc and nobody's copy of any game: the made-up program
// of ps2-twin/program.mjs as the one it boots, and beside it a module for the IOP, a second program for the EE and a
// file of data with three programs for vector unit 1 (ps2-twin/module.mjs), with their twins in C (ps2-twin/module.c,
// ps2-twin/other.c, ps2-twin/unit.c), each named by its code map's key. A unit's program is written again in C on the
// kit's unit, and one of them is started the way the kit starts a program in C for a game.
// The module is loaded as the console's loader loads one, its addresses moved, and its calls made as the IOP's compiler
// makes them. Every twin has to leave the same memory as its original, but the one whose original calls another
// module, which says so. Then one line of the twins is changed at a time, and the check has to find each. Last, their
// proofs are kept and checked by key, and their functions are in tasks, a program at a time.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, REPO, gameFolder, proofFolder } from '../lib/paths.mjs';
import { startingFiles } from '../lib/new-game.mjs';
import { twinsIn } from '../gba/match.mjs';
import { groupsOf } from '../lib/proofs.mjs';
import { readCodeMap } from '../lib/proof-files.mjs';
import { LOAD, loadModule } from '../ps2/twin-iop.mjs';
import { madeUpElf } from './ps2-twin/program.mjs';
import { madeUpModule, madeUpOther, madeUpUnit, COUNTER, LIBRARY, ASKED } from './ps2-twin/module.mjs';
import { isoOf } from './made-up-ps2-disc.mjs';

const here = name => fileURLToPath(new URL(`./ps2-twin/${name}`, import.meta.url));
const work = join(LOCAL, 'tmp', 'ps2-twin-programs-test');
const NAME = 'test-ps2-twin-programs', VERSION = `${NAME}/c`, COPIES = join(LOCAL, 'copies.json');

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
const tracked = () => spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: REPO, encoding: 'utf8' }).stdout;
const before = tracked();
const dp = (...args) => {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 24 });
  return { status, out: stdout + stderr };
};
const last = run => run.out.trim().split('\n').at(-1);
const line = (run, word) => run.out.trim().split('\n').find(each => each.includes(word)) ?? last(run);

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const boot = madeUpElf(), module = madeUpModule(), other = madeUpOther(), unit = madeUpUnit();
const texts = { 'game.c': readFileSync(here('game.c'), 'utf8'), 'module.c': readFileSync(here('module.c'), 'utf8'), 'other.c': readFileSync(here('other.c'), 'utf8'), 'unit.c': readFileSync(here('unit.c'), 'utf8') };
const key = (address, program) => `${address.toString(16).toUpperCase().padStart(8, '0')}@${program}`;

console.log('The module, as the check loads it:');
{
  const loaded = loadModule(module.irx), view = new DataView(loaded.image.buffer), word = at => view.getUint32(LOAD + at, true);
  check(word(module.labels.counter) === COUNTER && word(module.labels.table) === LOAD + module.labels.one && word(module.labels.table + 4) === LOAD + module.labels.two, 'its values are where it\'s loaded, and its table of functions holds their addresses there');
  check(word(module.labels.store) === (0x3C030000 | LOAD >>> 16) >>> 0 && (word(module.labels.store + 4) & 0xFFFF) === module.labels.counter, 'an address in two instructions is moved in both');
  check((word(module.labels.twice + 12) & 0x03FFFFFF) === (LOAD + module.labels.add3) >>> 2, 'a call is moved');
  check(loaded.stubs.length === 1 && loaded.stubs[0].library === LIBRARY && loaded.stubs[0].number === ASKED && word(module.labels.stub) === 0x0C, 'its stub to another module is found, and stops a call that reaches it');
  check(loaded.wordAt(module.labels.twice + 12) === 0x0C000000, 'and its words are still read as the file has them');
  const twins = twinsIn(texts['module.c'], [], null, 'ps2');
  const wrong = twins.filter(twin => twin.address !== null || twin.keyed?.program !== 'MADE_UP.IRX' || module.labels[twin.name] !== twin.keyed.address);
  check(twins.length === module.functions.length && !wrong.length, `each of the ${twins.length} twins names its function by its key${wrong.length ? `, but ${wrong.map(t => t.name).join(', ')}` : ''}`);
  const [second] = twinsIn(texts['other.c'], [], null, 'ps2');
  check(second.keyed?.program === 'OTHER.ELF' && second.keyed.address === other.labels.other_sum, 'and the second program\'s twin names its own');
}

const copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
const tidy = () => rmSync(gameFolder(NAME), { recursive: true, force: true });
tidy();
try {
  const disc = isoOf({
    'SYSTEM.CNF': Buffer.from('BOOT2 = cdrom0:\\MADE_UP.ELF;1\r\nVER = 1.00\r\nVMODE = NTSC\r\n'),
    'MADE_UP.ELF': boot.elf, 'MADE_UP.IRX': module.irx, 'OTHER.ELF': other.elf, 'DATA/UNIT.BIN': unit.bytes,
  });
  const copy = join(work, 'made-up.iso');
  writeFileSync(copy, disc);
  mkdirSync(proofFolder(NAME), { recursive: true });
  const original = { console: 'ps2', name: 'Test PlayStation 2 Programs (World)', title: 'MADE_UP', code: '', sha1: createHash('sha1').update(disc).digest('hex') };
  writeFileSync(join(proofFolder(NAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
  const named = ['values', 'buffer', 'functions', 'mode'].map(name => [name, boot.labels[name].toString(16).toUpperCase().padStart(8, '0')]);
  writeFileSync(join(proofFolder(NAME), 'addresses.json'), `${JSON.stringify({ addresses: Object.fromEntries(named) }, null, 2)}\n`);
  mkdirSync(join(gameFolder(VERSION), 'src'), { recursive: true });
  writeFileSync(join(gameFolder(VERSION), 'index.html'), startingFiles(NAME, original, { language: 'c' })['index.html']);
  const write = (name, text = texts[name]) => writeFileSync(join(gameFolder(VERSION), 'src', name), text);
  for (const name of Object.keys(texts)) write(name);

  console.log('\nThrough the tool, on a made-up disc:');
  let run = dp('rom', copy);
  check(run.status === 0 && run.out.includes(NAME), `rom knows the disc: ${last(run)}`);
  run = dp('codemap', NAME);
  check(run.status === 0, `its code map is made from the disc: ${last(run)}`);
  const codeMap = readCodeMap(NAME);
  const mapped = module.functions.filter(f => codeMap.functions.some(each => each.key === key(f.address, 'MADE_UP.IRX') && each.size === f.size));
  check(mapped.length === module.functions.length && codeMap.functions.some(f => f.key === key(other.labels.other_sum, 'OTHER.ELF')), `with every function of the module and of the second program, by its key (${mapped.length} of ${module.functions.length})`);

  run = dp('twin', VERSION, '--calls', '200');
  const same = name => new RegExp(`The same memory  0x[0-9A-F]{8}@MADE_UP\\.IRX ${name},`).test(run.out);
  const sames = ['add3', 'store', 'five', 'wide', 'twice', 'one', 'two', 'pick', 'voice'].filter(same);
  check(run.status === 0 && sames.length === 9, `the module's twins leave the same memory as their originals (${sames.join(', ')}): ${last(run)}`);
  check(/Not checked  0x000000B4@MADE_UP\.IRX ask: no call could be compared: the original called function 12 of sysclib, another module/.test(run.out), `a function that calls another module says so: ${line(run, ' ask')}`);
  check(/The same memory  0x00300000@OTHER\.ELF other_sum,/.test(run.out), `the second EE program's twin is checked against its own program: ${line(run, 'other_sum')}`);
  for (const program of unit.programs) check(new RegExp(`The same memory  0x${program.at.toString(16).toUpperCase().padStart(8, '0')}@DATA/UNIT\\.BIN~vu ${program.name}, 200 calls`).test(run.out), `a vector unit program's twin in C leaves the same registers, flags, memory and packets, and stops where it does: ${line(run, ` ${program.name}`).trim()}`);
  check(/30 of 33 functions left the same memory/.test(run.out) && (run.out.match(/The same memory/g) ?? []).length === 30, `beside the boot program's, in one run: ${line(run, 'functions left the same memory')}`);
  check(!run.out.split('\n').some(each => /No address/.test(each) && [...module.functions.map(f => f.name), 'other_sum'].some(name => each.includes(` ${name},`))), 'and no twin named by a key is said to have no address');

  run = dp('twin', VERSION, '78@MADE_UP.IRX', '--calls', '200');
  check(run.status === 0 && /1 of 1 function left the same memory/.test(run.out) && /pick/.test(run.out), `one function by its key, with as few digits as it's typed with: ${last(run)}`);
  run = dp('twin', VERSION, 'other_sum', '--calls', '200');
  check(run.status === 0 && /1 of 1 function left the same memory/.test(run.out), 'or by its twin\'s name');
  run = dp('twin', VERSION, '0x00000000@NOWHERE.IRX');
  check(run.status !== 0 && /says it's the twin of/.test(run.out), `a key no twin names is said: ${last(run)}`);

  console.log('\nOne line of a twin changed at a time:');
  const broken = async (file, from, to, name, what, expect = /Differs/) => {
    if (!texts[file].includes(from)) throw new Error(`ps2-twin/${file} has no "${from}" for the test to change.`);
    write(file, texts[file].replace(from, to));
    const tried = dp('twin', VERSION, name, '--calls', '200');
    write(file);
    check(tried.status === 3 && expect.test(tried.out), `${what}: ${line(tried, 'Differs').trim()}`);
  };
  await broken('module.c', 'return a + b + c;', 'return a + b - c;', 'add3', 'a wrong sum');
  await broken('module.c', 'D_00000100 = value;', 'D_00000100 = value + 1;', 'store', 'a value one off in the module\'s own memory', /in the IOP's memory/);
  await broken('module.c', 'return a + b + c + d + e;', 'return a + b + c + d;', 'five', 'an argument on the stack left out');
  await broken('module.c', 'long long wide(long long a, long long b) {\n  return a + b;', 'long long wide(long long a, long long b) {\n  return (unsigned)a + (unsigned)b;', 'wide', 'a 64-bit sum cut to 32');
  await broken('module.c', 'D_00000104[n & 1](n)', 'D_00000104[0](n)', 'pick', 'the wrong function of the table');
  await broken('module.c', '0xBF900000', '0xBF900002', 'voice', 'an SPU2 register two bytes off', /the SPU2's registers/);
  await broken('module.c', 'return a + 2;', 'return a + 3;', 'two', 'a function reached only through the table');
  await broken('other.c', 'a + b + D_00300040', 'a + b', 'other_sum', 'the second program\'s own value left out');
  await broken('unit.c', 'vu_sum(1, VU_ADD, vu_vf(1, 2), vu_vf(1, 1), vu_vf(1, 1), VU_XYZW);', 'vu_add(vu_vf(1, 2), vu_vf(1, 1), vu_vf(1, 1), VU_XYZW);', 'doubler', 'a sum on the unit that leaves its flags as they were', /in vector unit 1's (status|MAC) flag/);
  await broken('unit.c', 'data[1] = *vu_vf(1, 2);', 'data[3] = *vu_vf(1, 2);', 'doubler', 'a store a vector along in the unit\'s memory', /in vector unit 1's data memory/);
  await broken('unit.c', 'vu1_kick(vu_vi(1, 1) * 16);', 'vu1_kick(vu_vi(1, 1) * 16 + 16);', 'doubler', 'a packet sent from a quadword along', /packet 1 starts at/);
  await broken('unit.c', 'vu1_kick(vu_vi(1, 1) * 16);', '', 'doubler', 'a packet never sent', /the twin sent the GS 0 packets and the original 1/);
  await broken('unit.c', 'data[1] = *vu_vf(1, 2);\n  vu_set_vi(1, 1, 2);\n  vu1_kick(vu_vi(1, 1) * 16);', 'vu_set_vi(1, 1, 2);\n  vu1_kick(vu_vi(1, 1) * 16);\n  data[1] = *vu_vf(1, 2);', 'doubler', 'a packet sent before the store that it holds', /of packet 1 the twin sent the GS/);
  await broken('unit.c', 'return 48;', 'return 40;', 'doubler', 'a program said to stop a pair early', /the twin says the program stops at/);
  await broken('unit.c', 'vu_vi(1, 1) != 0', 'vu_vi(1, 1) != 1', 'counter', 'a count that stops one short', /in vector unit 1's VI1/);
  await broken('unit.c', 'vu_program(1, 0x200, counted);', '', 'started', 'a program started with no C given to the kit for its place, which runs the unit\'s empty code memory', /in vector unit 1's/);

  console.log('\nTheir proofs and tasks:');
  run = dp('proofs', VERSION, '--start');
  check(run.status === 0 && /made a function at a time/.test(run.out), `proofs --start makes it a version made a function at a time: ${last(run)}`);
  run = dp('twin', VERSION, 'add3', '--calls', '1000');
  check(run.status === 0 && /1 function kept as proven by the same memory/.test(run.out), `a module's twin proven over 1,000 calls is kept: ${last(run)}`);
  check(new RegExp(`"${key(0, 'MADE_UP.IRX')}"`).test(readFileSync(join(proofFolder(VERSION), 'proofs.json'), 'utf8')), 'by its key');
  run = dp('twin', VERSION, 'other_sum', '--calls', '1000');
  check(run.status === 0 && /1 function kept as proven by the same memory/.test(run.out), 'and the second program\'s');
  run = dp('twin', VERSION, 'doubler', '--calls', '1000');
  check(run.status === 0 && /1 function kept as proven by the same memory/.test(run.out) && readFileSync(join(proofFolder(VERSION), 'proofs.json'), 'utf8').includes(`"${unit.programs[0].at.toString(16).toUpperCase().padStart(8, '0')}@DATA/UNIT.BIN~vu"`), `and a vector unit program's, every pair of it run, by its key: ${last(run)}`);
  run = dp('twin', VERSION, `${unit.programs[1].at.toString(16)}@DATA/UNIT.BIN~vu`, '--calls', '1000');
  check(run.status === 0 && /1 function kept as proven by the same memory/.test(run.out), `one whose branch went both ways, named by its key: ${last(run)}`);
  run = dp('proofs', VERSION, '--check');
  check(run.status === 0, `their proofs hold, the original's side read from what twin kept of each: ${last(run)}`);
  write('module.c', texts['module.c'].replace('return a + b + c;', 'return c + b + a;'));
  run = dp('proofs', VERSION, '--check');
  write('module.c');
  check(run.status !== 0 && /add3/.test(run.out) && /changed/.test(run.out), `a twin changed since its proof makes the check fail: ${line(run, 'add3')}`);
  const groups = groupsOf(codeMap);
  const mixed = groups.filter(group => new Set(group.functions.map(f => `${f.program ?? ''}${f.vu ? '~vu' : ''}`)).size > 1);
  const inTasks = module.functions.filter(f => groups.some(group => group.functions.some(each => each.key === key(f.address, 'MADE_UP.IRX'))));
  check(groups.some(group => group.functions.every(f => f.vu) && group.functions.length === unit.programs.length), 'the vector unit programs are a task of their own');
  check(!mixed.length && inTasks.length === module.functions.length, `the module's functions are in tasks, and no task mixes two programs (${groups.map(group => group.name).join('; ')})`);
} finally {
  tidy();
  if (copies) writeFileSync(COPIES, copies);
  else rmSync(COPIES, { force: true });
}
check(!existsSync(gameFolder(NAME)), 'nothing is left behind');

rmSync(work, { recursive: true, force: true });
check(tracked() === before, 'nothing the repository tracks has changed');
if (failures.length) {
  console.log(`\n${failures.length} failed.`);
  process.exit(1);
}
console.log('\nThe PlayStation 2\'s function check reaches a disc\'s other programs.');
