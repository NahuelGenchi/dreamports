// npm run test:ps2-match: match on the PlayStation 2 (../ps2/match.mjs), with Sony's own compiler and assembler for the
// EE, on a program of the project's own (ps2-match/program.c and small.c), so it needs nobody's copy of any game. Its
// original is made as a game's was: the same C compiled by Sony's compiler and linked by Sony's own linker, built from
// the same source (../ps2/gcc.mjs), which puts each function and each of the files' values where it will and fills in
// every address itself, so nothing of match's reading of an object is in it. Then match has to find each function the
// same, with the pieces of the file's values it reaches where the original's instructions point; one whose C was
// changed, or whose text was, differs and the rest don't; a name with no address can't be the same; and a small value
// is reached through $gp. Last, `npm run dp -- match` on a made-up game with that program as its copy, which the test
// removes after. Then the same program built by each of SN Systems' builds of GCC (../ps2/sn.mjs), which many studios
// used, fetched and run through wibo: match with that build finds every function the same.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, REPO, gameFolder, proofFolder } from '../lib/paths.mjs';
import { arch, platform } from 'node:os';
import { assembleEe, linkEe } from '../ps2/gcc.mjs';
import { SN_GCC, WIBO, hasRosetta } from '../ps2/sn.mjs';
import { compileFile, loadedOf, matchFile, objectOf } from '../ps2/match.mjs';
import { sectionsOf } from '../ps2/functions.mjs';
import { gpOf } from '../ps2/twin.mjs';

const HERE = fileURLToPath(new URL('./ps2-match/', import.meta.url));
const WORK = join(LOCAL, 'tmp', 'ps2-match-test');
const GAME = 'test-ps2-match', VERSION = `${GAME}/c`;
const COPIES = join(LOCAL, 'copies.json');
// how the made-up program is built: Sony's compiler at -O2, and one file with small values reached through $gp
const COMPILER = { name: 'ee-gcc', version: '2.9-ee-991111-01', flags: ['-O2', '-G0'] };
const SMALL = { ...COMPILER, flags: ['-O2', '-G8'] };
const LOAD = 0x00100000;
// the program's start, which points $gp as a game's does, and what its files use and don't define: a function that
// prints and two counts, written here as the assembler takes them
const START = `.set noreorder
.globl _start
.ent _start
_start:
 lui $28,%hi(_gp)
 addiu $28,$28,%lo(_gp)
 jr $31
 nop
.end _start
.globl Print
.ent Print
Print:
 jr $31
 nop
.end Print
.data
.globl gFrame
gFrame: .word 7
.globl gTotal
gTotal: .word 0
`;

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
const dp = (...args) => {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 26 });
  return { status, out: stdout + stderr };
};
const tracked = () => spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: REPO, encoding: 'utf8' }).stdout;
const hex8 = address => address.toString(16).toUpperCase().padStart(8, '0');
const byName = result => Object.fromEntries((result.functions ?? []).map(f => [f.name, f]));

// the names a linked program's symbol table gives, each { address, size }
function symbolsOf(elf) {
  const sections = sectionsOf(elf), table = sections.find(s => s.type === 2), strings = sections.find(s => s.name === '.strtab');
  const found = new Map();
  for (let o = table.offset; o + 16 <= table.offset + table.size; o += 16) {
    const name = elf.toString('latin1', strings.offset + elf.readUInt32LE(o), elf.indexOf(0, strings.offset + elf.readUInt32LE(o)));
    if (name) found.set(name, { address: elf.readUInt32LE(o + 4), size: elf.readUInt32LE(o + 8) });
  }
  return found;
}

// a file of the program with each function's address written where @ and its name stand
const withAddresses = (text, where) => text.replace(/@(\w+)/g, (whole, name) => (where.has(name) ? `0x${hex8(where.get(name).address)}` : whole));

async function main() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(join(WORK, 'src'), { recursive: true });
  const log = line => console.log(`    ${line}`);
  const write = (name, text) => writeFileSync(join(WORK, 'src', name), text);
  const sources = Object.fromEntries(['program.c', 'program.h', 'small.c'].map(name => [name, readFileSync(join(HERE, name), 'utf8')]));
  for (const [name, text] of Object.entries(sources)) write(name, text);

  console.log('A program of the project\'s own, compiled by Sony\'s compiler and linked by Sony\'s linker:');
  const objects = [];
  for (const [name, compiler] of [['program', COMPILER], ['small', SMALL]]) {
    const built = await compileFile({ file: join(WORK, 'src', `${name}.c`), compiler, work: join(WORK, 'original', name), log });
    check(!built.error, `${name}.c builds with EE-GCC ${compiler.version} ${compiler.flags.join(' ')}${built.error ? `: ${built.error}` : ''}`);
    if (built.error) return;
    objects.push({ name: `${name}.o`, bytes: built.object });
  }
  const start = await assembleEe(START, { flags: ['-mabi=eabi'], log });
  const linked = start.error ? start : await linkEe([{ name: 'start.o', bytes: start.object }, ...objects], { args: ['-Ttext', `0x${hex8(LOAD)}`, '-e', '_start'], log });
  check(!linked.error, `Sony's linker makes a program of them${linked.error ? `: ${linked.error}` : ''}`);
  if (linked.error) return;
  const elf = linked.program, where = symbolsOf(elf), program = loadedOf(elf), gp = gpOf(elf);
  check(gp === where.get('_gp')?.address && elf.readUInt32LE(36) === 0x20924001, `which points $gp where the linker put _gp, 0x${hex8(gp ?? 0)}, and is a program for the console as a game's is`);
  for (const name of ['program.c', 'small.c']) write(name, withAddresses(sources[name], where));

  const addressOf = name => where.get(name)?.address ?? null;
  const against = { program, gp, addressOf, sizeOf: address => [...where.values()].find(each => each.address === address && each.size)?.size ?? null };
  const matching = (name, extra = {}) => matchFile({ file: join(WORK, 'src', name), compiler: COMPILER, work: join(WORK, 'built', name.replace(/\.c$/, '')), log, ...against, ...extra });

  console.log('match, against that program:');
  const same = await matching('program.c');
  const functions = byName(same);
  for (const name of ['Weigh', 'Tell', 'Blend']) {
    check(functions[name]?.same === true && functions[name].address === where.get(name).address, `${name} is the same as the program's, at 0x${hex8(where.get(name).address)}${functions[name]?.same ? '' : `: ${JSON.stringify({ ...functions[name], made: undefined, ours: undefined, theirs: undefined })}`}`);
  }
  check(functions.Nobody?.address === null && functions.Nobody.same === undefined, 'a function with no address above it is compared with nothing');
  check(same.unknown?.length === 0, 'every name has an address');
  const rodata = sectionsOf(elf).find(s => s.name === '.rodata');
  const inRodata = value => value.address >= rodata.address && value.address < rodata.address + rodata.size;
  check(functions.Weigh.data.some(value => value.name.startsWith('.rodata+') && value.same && inRodata(value) && value.bytes >= 20),
    `Weigh's switch reads a table of addresses of the file's own, found where the original's instructions point: ${functions.Weigh.data.map(value => `${value.name} at 0x${hex8(value.address ?? 0)}`).join(', ')}`);
  check(functions.Weigh.data.some(value => value.name === 'sWeights' && value.same && value.address === where.get('sWeights').address), 'and its table of weights, a static array with values, by its name');
  check(functions.Tell.data.filter(value => value.name.startsWith('.rodata') && value.same && inRodata(value)).length === 2, 'Tell\'s two texts are found and the same');
  check(functions.Tell.data.some(value => value.name === 'sCount' && value.same && value.address >= program.load + program.text.length), 'and its count, which starts at zero, is past the program\'s file');
  check(functions.Blend.calls.includes(where.get('Weigh').address) && functions.Blend.calls.includes(where.get('Tell').address), 'a call to a function of the same file goes where the original has it');
  const small = byName(await matching('small.c', { compiler: SMALL }));
  check(small.Bump?.same === true && small.Bump.data.some(value => value.name === 'gSmall' && value.address === where.get('gSmall').address), 'a small value is reached through $gp, where the linker put it');
  const noGp = byName(await matching('small.c', { compiler: SMALL, gp: 0 }));
  check(noGp.Bump?.same === false, 'and isn\'t the same when the program says nothing of where $gp points');
  const otherFlags = byName(await matching('small.c'));
  check(otherFlags.Bump?.same === false, 'nor built with -G0, which reaches it another way');

  // what an object's places are read as, beside what Sony's linker made of them: the code's words, once filled, are
  // the program's, which the checks above hold; here, that every kind was met
  const kinds = new Set(objects.flatMap(o => [...objectOf(o.bytes).sections.values()].flatMap(section => section.relocations.map(r => r.kind))));
  check(['hi16', 'lo16', 'jump26', 'word32', 'gprel16'].every(kind => kinds.has(kind)), `the two objects hold every kind of place a linker fills in: ${[...kinds].sort().join(', ')}`);

  console.log('One line changed at a time:');
  const changed = (from, to) => write('program.c', withAddresses(sources['program.c'], where).replace(from, to));
  changed('return x + 2;', 'return x + 3;');
  const wrong = byName(await matching('program.c'));
  check(wrong.Weigh?.same === false && wrong.Weigh.differing === 1 && wrong.Weigh.longer === 0, `Weigh, with x + 2 changed to x + 3, differs: ${wrong.Weigh?.differing} of ${wrong.Weigh?.words} words, first at +${wrong.Weigh?.first}`);
  check(wrong.Tell?.same === true && wrong.Blend?.same === true, 'and the other functions are still the same');
  changed('"done"', '"gone"');
  const text = byName(await matching('program.c'));
  check(text.Tell?.same === false && text.Tell.differing === 0 && text.Tell.data.some(value => !value.same && /differs/.test(value.why)), `Tell, with a text changed, has the same code and differs in its value: ${text.Tell?.data.filter(value => !value.same).map(value => `${value.name} ${value.why}`).join(', ')}`);
  check(text.Weigh?.same === true, 'and Weigh, which doesn\'t reach it, is still the same');
  changed('{ 2, 4, 8, 16 }', '{ 2, 4, 8, 17 }');
  const table = byName(await matching('program.c'));
  check(table.Weigh?.same === false && table.Weigh.differing === 0 && table.Weigh.data.some(value => value.name === 'sWeights' && !value.same), 'and with a weight changed, Weigh\'s code is the same and its table isn\'t');
  write('program.c', withAddresses(sources['program.c'], where));
  const missing = await matching('program.c', { addressOf: name => (name === 'gFrame' ? null : addressOf(name)) });
  const without = byName(missing);
  check(without.Weigh?.same === false && without.Weigh.missing.includes('gFrame') && missing.unknown.includes('gFrame'), 'a function that uses a name with no address isn\'t the same, and the name is said');
  check(without.Blend?.same === true, 'and one that doesn\'t use it still is');
  write('program.c', `${withAddresses(sources['program.c'], where)}\nvoid Broken(void) { return 1 +; }\n`);
  const broken = await matching('program.c');
  check(/program\.c:\d+/.test(broken.error ?? ''), `C that doesn't build says where: ${(broken.error ?? '').split('\n').find(line => /program\.c:\d+/.test(line))}`);

  console.log('npm run dp -- match on a made-up game with the program as its copy:');
  await wholeGame(elf, where, sources);
  await withSn(sources, start, log);
}

// The same program built by each of SN Systems' builds of GCC, which the tools fetch and run through wibo, and linked
// by Sony's linker: match with that build finds every function the same, and with Sony's own compiler doesn't, as the
// two save a function's registers differently.
async function withSn(sources, start, log) {
  console.log('The same program, built by SN Systems\' builds of GCC:');
  const here = WIBO[`${platform()}-${arch()}`];
  if (!here || (here.rosetta && !hasRosetta())) {
    console.log(`  (not tried: wibo, which runs them, isn't for ${platform()} ${arch()}${here?.rosetta ? ' without Rosetta 2' : ''})`);
    return;
  }
  for (const version of Object.keys(SN_GCC)) {
    const sn = { name: 'sn-gcc', version, flags: ['-O2', '-G0'] }, small = { ...sn, flags: ['-O2', '-G8'] };
    const folder = join(WORK, `sn-${version}`);
    mkdirSync(folder, { recursive: true });
    for (const [name, text] of Object.entries(sources)) writeFileSync(join(folder, name), text);
    const objects = [];
    for (const [name, compiler] of [['program', sn], ['small', small]]) {
      const built = await compileFile({ file: join(folder, `${name}.c`), compiler, work: join(folder, 'original', name), log });
      if (built.error) {
        check(false, `${name}.c builds with SN Systems' GCC ${version}: ${built.error}`);
        return;
      }
      objects.push({ name: `${name}.o`, bytes: built.object });
    }
    const linked = await linkEe([{ name: 'start.o', bytes: start.object }, ...objects], { args: ['-Ttext', `0x${hex8(LOAD)}`, '-e', '_start'], log });
    if (linked.error) {
      check(false, `Sony's linker makes a program of SN's objects: ${linked.error}`);
      return;
    }
    const elf = linked.program, where = symbolsOf(elf);
    for (const name of ['program.c', 'small.c']) writeFileSync(join(folder, name), withAddresses(sources[name], where));
    const against = { program: loadedOf(elf), gp: gpOf(elf), addressOf: name => where.get(name)?.address ?? null, sizeOf: address => [...where.values()].find(each => each.address === address && each.size)?.size ?? null };
    const matching = (name, compiler) => matchFile({ file: join(folder, name), compiler, work: join(folder, 'built', name.replace(/\.c$/, '')), log, ...against });
    const same = byName(await matching('program.c', sn)), bump = byName(await matching('small.c', small));
    check(['Weigh', 'Tell', 'Blend'].every(name => same[name]?.same === true) && bump.Bump?.same === true, `SN Systems' GCC ${version}, through wibo: every twin is the same as the program it built`);
    const sony = byName(await matching('program.c', COMPILER));
    check(sony.Tell?.same === false && sony.Blend?.same === false, 'and built with Sony\'s own compiler they differ, as the two save a function\'s registers another way');
  }
}

// the program as a game's copy, its C as the game's version in C, and match run on it as a person runs it
async function wholeGame(elf, where, sources) {
  const before = tracked(), copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
  const tidy = () => {
    for (const path of [gameFolder(GAME), join(LOCAL, 'match', GAME), join(LOCAL, 'results', GAME)]) rmSync(path, { recursive: true, force: true });
  };
  tidy();
  try {
    const copy = join(WORK, `${GAME}.elf`);
    writeFileSync(copy, elf);
    // small.c's function is a stretch of its own, built with -G8
    const bump = where.get('Bump');
    const compiler = { ...COMPILER, stretches: [{ from: hex8(bump.address), to: hex8(bump.address + bump.size - 4), flags: SMALL.flags }] };
    const original = { console: 'ps2', name: 'Test PlayStation 2 Match (World)', title: GAME, code: '', sha1: createHash('sha1').update(elf).digest('hex'), compiler };
    mkdirSync(proofFolder(GAME), { recursive: true });
    writeFileSync(join(proofFolder(GAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
    const named = ['gFrame', 'gTotal', 'Print'].map(name => [name, hex8(where.get(name).address)]);
    writeFileSync(join(proofFolder(GAME), 'addresses.json'), `${JSON.stringify({ about: 'The test\'s names.', addresses: Object.fromEntries(named) }, null, 2)}\n`);
    let run = dp('rom', copy);
    check(run.status === 0 && run.out.includes(GAME), `rom knows the program's copy${run.status ? `: ${run.out.trim().split('\n').at(-1)}` : ''}`);
    run = dp('codemap', GAME);
    check(run.status === 0, `its code map is found in the copy: ${run.out.trim().split('\n').at(-1)}`);
    mkdirSync(join(gameFolder(VERSION), 'src'), { recursive: true });
    for (const file of ['program.c', 'small.c']) writeFileSync(join(gameFolder(VERSION), 'src', file), withAddresses(sources[file], where));
    writeFileSync(join(gameFolder(VERSION), 'src', 'program.h'), sources['program.h']);
    // a version is there once it has its page
    writeFileSync(join(gameFolder(VERSION), 'index.html'), '<!doctype html>\n');
    run = dp('match', VERSION);
    if (run.status !== 0 || !/4 of 4 functions the same/.test(run.out)) console.log(run.out);
    check(run.status === 0 && /4 of 4 functions the same/.test(run.out), `every twin is the same, each file built its own way: ${run.out.trim().split('\n').filter(line => /functions? the same/.test(line)).join(' ')}`);
    run = dp('match', VERSION, 'Weigh');
    const listing = join(LOCAL, 'match', VERSION, `${hex8(where.get('Weigh').address)}.txt`);
    check(run.status === 0 && new RegExp(`The same {2}0x${hex8(where.get('Weigh').address)} Weigh`).test(run.out) && existsSync(listing) && readFileSync(listing, 'utf8').includes('jr      $ra'),
      'one function asked for by name is compared alone, with its instructions beside the original\'s kept out of the repository');
  } finally {
    tidy();
    if (copies) writeFileSync(COPIES, copies);
    else rmSync(COPIES, { force: true });
  }
  check(!existsSync(gameFolder(GAME)), 'nothing is left behind');
  check(tracked() === before, 'nothing the repository tracks has changed');
}

main().then(() => {
  rmSync(WORK, { recursive: true, force: true });
  if (failures.length) {
    console.log(`\n${failures.length} failed.`);
    process.exit(1);
  }
  console.log('\nmatch on the PlayStation 2 says the same of what is the same, and where it differs of what isn\'t.');
}).catch(error => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
