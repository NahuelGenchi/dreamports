// npm run test:ps1-match: match on the PlayStation (../ps1/match.mjs), with GCC 2.7.2, maspsx's rules and the tools'
// assembler, on a program of the project's own (ps1-match/program.c and small.c), so it needs nobody's copy of any
// game. It builds the program and makes up a PS-X EXE of it: each function at the address its comment names, the
// file's own values (a switch's table, texts, a table of steps) where the test puts them, and every address filled in
// by the few lines here, not by match's. Then match has to find each function the same, with the values it reaches
// where the original's instructions point; one whose C was changed, or whose text was, differs and the rest don't; a
// name with no address can't be the same; and a small value is reached through $gp. Last, `npm run dp -- match` on a
// made-up game with that program as its copy, which the test removes after.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, REPO, gameFolder, proofFolder } from '../lib/paths.mjs';
import { assemble } from '../ps1/assemble.mjs';
import { matchFile } from '../ps1/match.mjs';
import { runIn } from '../gba/match.mjs';

const HERE = fileURLToPath(new URL('./ps1-match/', import.meta.url));
const WORK = join(LOCAL, 'tmp', 'ps1-match-test');
const GAME = 'test-ps1-match', VERSION = `${GAME}/c`;
const COPIES = join(LOCAL, 'copies.json');
// how PlayStation games of the time were built: GCC 2.7.2 at -O2, and Sony's assembler of version 2.56
const COMPILER = { name: 'gcc', version: '2.7.2', flags: ['-O2', '-G0'], maspsx: { aspsxVersion: '2.56' } };
const SMALL = { ...COMPILER, flags: ['-O2', '-G8'] };
// the made-up program: loaded at LOAD, its file SIZE bytes, its values at VALUES, and what starts at zero past its end
const LOAD = 0x80010000, SIZE = 0x3000, VALUES = 0x80012000, ZEROED = 0x80020000, GP = 0x80020800;
const FUNCTIONS = { Score: 0x80010100, Say: 0x80010200, func_80010300: 0x80010300, Bump: 0x80010400 };
const NAMED = new Map([['gFrame', 0x80012800], ['gTotal', 0x80012804], ['Print', 0x80010800]]);

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

// The made-up program's bytes, from what the assembler made of each file: each function where FUNCTIONS says, each of
// the file's values after the one before, the ones that start at zero past the file's end, and every place the
// assembler left filled in.
function lay(builds, image) {
  const where = new Map(NAMED), sizes = new Map();
  let values = VALUES, zeroed = ZEROED;
  for (const made of builds) {
    const inCode = at => made.functions.find(f => at >= f.at && at < f.at + f.size);
    for (const [name, symbol] of made.symbols) {
      if (symbol.section === '.text') {
        const f = inCode(symbol.at);
        if (f && FUNCTIONS[f.name] !== undefined) where.set(name, FUNCTIONS[f.name] + symbol.at - f.at);
      } else if (!where.has(name)) {
        const zero = symbol.section === '.bss' || symbol.section === '.sbss';
        const at = ((zero ? zeroed : values) + 7 & ~7) >>> 0;
        where.set(name, at);
        if (zero) zeroed = at + symbol.size;
        else values = at + symbol.size;
      }
    }
    const placeOf = (section, at) => {
      if (section === '.text') return where.get(inCode(at)?.name) + at - inCode(at).at;
      const [name, symbol] = [...made.symbols].filter(([, s]) => s.section === section && s.at <= at).sort((a, b) => b[1].at - a[1].at)[0];
      return where.get(name) + at - symbol.at;
    };
    for (const [section, { bytes, relocations }] of made.sections) {
      const buffer = Buffer.from(bytes);
      for (const { at, kind, symbol, addend } of relocations) {
        if (section === '.text' && FUNCTIONS[inCode(at)?.name] === undefined) continue;
        const target = where.get(symbol) + addend, word = buffer.readUInt32LE(at);
        const filled = { hi16: (word & 0xFFFF0000) | ((target + 0x8000) >>> 16), lo16: (word & 0xFFFF0000) | (target & 0xFFFF),
          gprel16: (word & 0xFFFF0000) | ((target - GP) & 0xFFFF), jump26: (word & 0xFC000000) | ((target >>> 2) & 0x3FFFFFF), word32: target }[kind];
        buffer.writeUInt32LE(filled >>> 0, at);
      }
      if (section === '.text') {
        for (const f of made.functions) {
          if (FUNCTIONS[f.name] === undefined) continue;
          buffer.copy(image, FUNCTIONS[f.name] - LOAD, f.at, f.at + f.size);
          sizes.set(FUNCTIONS[f.name], f.size);
        }
      } else if (section !== '.bss' && section !== '.sbss') {
        for (const [name, symbol] of made.symbols) if (symbol.section === section && symbol.size) buffer.copy(image, placeOf(section, symbol.at) - LOAD, symbol.at, symbol.at + symbol.size);
      }
    }
  }
  return { where, sizes };
}

// a PS-X EXE of the made-up program, as a disc would boot it
function exeOf(image) {
  const header = Buffer.alloc(0x800);
  header.write('PS-X EXE', 0, 'latin1');
  header.writeUInt32LE(FUNCTIONS.func_80010300, 0x10);
  header.writeUInt32LE(GP, 0x14);
  header.writeUInt32LE(LOAD, 0x18);
  header.writeUInt32LE(image.length, 0x1C);
  header.writeUInt32LE(0x801FFF00, 0x30);
  header.write('Sony Computer Entertainment Inc. for North America area', 0x4C, 'latin1');
  return Buffer.concat([header, image]);
}

const byName = result => Object.fromEntries((result.functions ?? []).map(f => [f.name, f]));

async function main() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const empty = { load: LOAD, text: Buffer.alloc(SIZE) };
  const matching = (file, extra = {}) => matchFile({
    file, compiler: COMPILER, work: join(WORK, 'built', file.split('/').at(-1).replace(/\.c$/, '')), addressOf: name => NAMED.get(name) ?? null,
    sizeOf: () => null, program: empty, gp: GP, log: line => console.log(`    ${line}`), ...extra,
  });

  console.log('A program of the project\'s own, against a PS-X EXE made from it:');
  const first = await matching(join(HERE, 'program.c'));
  check(!first.error, `the program builds with GCC ${COMPILER.version} and maspsx's rules${first.error ? `: ${first.error}` : ''}`);
  const small = await matching(join(HERE, 'small.c'), { compiler: SMALL });
  check(!small.error, `and small.c with -G8${small.error ? `: ${small.error}` : ''}`);
  if (first.error || small.error) return;
  const builds = ['program', 'small'].map(name => assemble(readFileSync(join(WORK, 'built', `${name}.aspsx.s`), 'utf8')));
  const image = Buffer.alloc(SIZE);
  const { where, sizes } = lay(builds, image);
  const program = { load: LOAD, text: image };
  const against = { program, sizeOf: address => sizes.get(address) ?? null };

  const same = await matching(join(HERE, 'program.c'), against);
  const functions = byName(same);
  for (const name of ['Score', 'Say', 'func_80010300']) {
    check(functions[name]?.same === true && functions[name].address === FUNCTIONS[name], `${name} is the same as the program's, at 0x${FUNCTIONS[name].toString(16).toUpperCase()}`);
  }
  check(functions.Nobody?.address === null && functions.Nobody.same === undefined, 'a function with no address above it is compared with nothing');
  check(same.unknown.length === 0, 'every name has an address');
  const assembly = readFileSync(join(WORK, 'built', 'program.aspsx.s'), 'utf8');
  check(/\.word\s+\$L\d+/.test(assembly) && functions.Score.data.some(value => value.name.startsWith('$L') && value.same && value.address >= VALUES),
    `Score's switch reads a table of addresses of the file's own, found where the original's instructions point: ${functions.Score.data.map(value => `${value.name} at 0x${value.address?.toString(16)}`).join(', ')}`);
  check(functions.Score.data.some(value => value.name === 'sSteps' && value.same), 'and its table of steps, a static array with values');
  check(functions.Say.data.filter(value => value.name.startsWith('$LC') && value.same).length === 2, 'Say\'s two texts are found and the same');
  check(functions.Say.data.some(value => value.name === 'sCount' && value.same && value.address >= ZEROED), 'and its count, which starts at zero, is past the program\'s file');
  check(functions.func_80010300.calls.includes(FUNCTIONS.Score) && functions.func_80010300.calls.includes(FUNCTIONS.Say), 'a call to a function of the same file goes where the original has it');
  check(where.get('$L3') !== undefined || [...where.keys()].some(name => name.startsWith('$L')), 'the test laid the switch\'s cases where the function is');

  // the same program with one sum changed, as a twin written slightly wrong
  const changed = join(WORK, 'changed');
  mkdirSync(changed, { recursive: true });
  const source = readFileSync(join(HERE, 'program.c'), 'utf8');
  writeFileSync(join(changed, 'program.h'), readFileSync(join(HERE, 'program.h')));
  check(source.includes('return x + 1;') && source.includes('"gone"'), 'the program has the lines the test changes');
  writeFileSync(join(changed, 'program.c'), source.replace('return x + 1;', 'return x + 2;'));
  const wrong = byName(await matching(join(changed, 'program.c'), against));
  check(wrong.Score?.same === false && wrong.Score.differing === 1 && wrong.Score.first >= 0, `Score, with x + 1 changed to x + 2, differs: ${wrong.Score?.differing} of ${wrong.Score?.words} words, first at +${wrong.Score?.first}`);
  check(wrong.Say?.same === true && wrong.func_80010300?.same === true, 'and the other functions are still the same');

  // a text changed: the code is the same, and the value it reaches isn't
  writeFileSync(join(changed, 'program.c'), source.replace('"gone"', '"done"'));
  const text = byName(await matching(join(changed, 'program.c'), against));
  check(text.Say?.same === false && text.Say.differing === 0 && text.Say.data.some(value => !value.same && /differs/.test(value.why)), `Say, with a text changed, has the same code and differs in its value: ${text.Say?.data.filter(value => !value.same).map(value => `${value.name} ${value.why}`).join(', ')}`);

  // a name with no address
  const missing = await matching(join(HERE, 'program.c'), { ...against, addressOf: name => (name === 'gFrame' ? null : NAMED.get(name) ?? null) });
  const without = byName(missing);
  check(without.Score?.same === false && without.Score.missing.includes('gFrame') && missing.unknown.includes('gFrame'), 'a function that uses a name with no address isn\'t the same, and the name is said');
  check(without.func_80010300?.same === true, 'and one that doesn\'t use it still is');

  // a function the code map holds as two, compared with both together when its comment names the run
  const whole = sizes.get(FUNCTIONS.Score), split = 0x20;
  const halves = [{ address: FUNCTIONS.Score, size: split, key: '80010100' }, { address: FUNCTIONS.Score + split, size: whole - split, key: '80010120' }];
  writeFileSync(join(changed, 'program.c'), source.replace('/* Score, 0x80010100:', '/* Score, 0x80010100 to 0x80010120:'));
  const run = byName(await matching(join(changed, 'program.c'), { ...against, sizeOf: address => (address === FUNCTIONS.Score ? split : sizes.get(address) ?? null), runOf: (address, through) => runIn(halves, address, through) }));
  check(run.Score?.same === true && run.Score.run?.length === 2 && run.Score.bytes === whole, `named as the run to 0x80010120, it's the same as both together, ${run.Score?.bytes} bytes`);

  // a small value through $gp, built with -G8
  const gp = byName(await matching(join(HERE, 'small.c'), { ...against, compiler: SMALL }));
  check(readFileSync(join(WORK, 'built', 'small.aspsx.s'), 'utf8').includes('%gp_rel(gSmall)') && gp.Bump?.same === true, 'Bump reaches its small value through $gp, and is the same');
  const noGp = byName(await matching(join(HERE, 'small.c'), { ...against, compiler: SMALL, gp: 0 }));
  check(noGp.Bump?.same === false, 'and isn\'t when the program says nothing of where $gp points');

  // C GCC won't take
  writeFileSync(join(changed, 'program.c'), `${source}\nvoid Broken(void) { return 1 +; }\n`);
  const broken = await matching(join(changed, 'program.c'), against);
  check(/program\.c:\d+/.test(broken.error ?? ''), `C that doesn't build says where: ${(broken.error ?? '').split('\n')[0]}`);

  console.log('npm run dp -- match on a made-up game with the program as its copy:');
  await wholeGame(exeOf(image));
}

// the program as a game's copy, its C as the game's version in C, and match run on it as a person runs it
async function wholeGame(exe) {
  const before = tracked(), copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
  const tidy = () => {
    for (const path of [gameFolder(GAME), join(LOCAL, 'match', GAME), join(LOCAL, 'results', GAME)]) rmSync(path, { recursive: true, force: true });
  };
  tidy();
  try {
    const copy = join(WORK, `${GAME}.exe`);
    writeFileSync(copy, exe);
    const original = { console: 'ps1', name: 'Test PlayStation Match (World)', title: GAME, code: '', sha1: createHash('sha1').update(exe).digest('hex'), compiler: COMPILER };
    mkdirSync(proofFolder(GAME), { recursive: true });
    writeFileSync(join(proofFolder(GAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
    writeFileSync(join(proofFolder(GAME), 'addresses.json'), `${JSON.stringify({ about: 'The test\'s names.', addresses: Object.fromEntries([...NAMED].map(([name, address]) => [name, address.toString(16).toUpperCase()])) }, null, 2)}\n`);
    let run = dp('rom', copy);
    check(run.status === 0 && run.out.includes(GAME), 'rom knows the program\'s copy');
    run = dp('codemap', GAME);
    check(run.status === 0, `its code map is found in the copy: ${run.out.trim().split('\n').at(-1)}`);
    mkdirSync(join(gameFolder(VERSION), 'src'), { recursive: true });
    for (const file of ['program.c', 'program.h']) writeFileSync(join(gameFolder(VERSION), 'src', file), readFileSync(join(HERE, file)));
    // a version is there once it has its page
    writeFileSync(join(gameFolder(VERSION), 'index.html'), '<!doctype html>\n');
    run = dp('match', VERSION);
    if (run.status !== 0) console.log(run.out);
    check(run.status === 0 && /3 of 3 functions the same/.test(run.out), `every twin is the same: ${run.out.trim().split('\n').filter(line => /functions? the same/.test(line)).join(' ')}`);
    run = dp('match', VERSION, 'Score');
    const listing = join(LOCAL, 'match', VERSION, '80010100.txt');
    check(run.status === 0 && /The same {2}0x80010100 Score/.test(run.out) && existsSync(listing) && readFileSync(listing, 'utf8').includes('jr      $ra'),
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
  console.log('\nmatch on the PlayStation says the same of what is the same, and where it differs of what isn\'t.');
}).catch(error => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
