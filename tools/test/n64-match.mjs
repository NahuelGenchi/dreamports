// npm run test:n64-match: match on the Nintendo 64 (../n64/match.mjs), with IDO 5.3 built from decompals/ido-static-recomp
// (../n64/ido.mjs), on a program of the project's own (n64-match/program.c), so it needs nobody's copy of any game. It
// builds the program and makes up a cartridge of it: each function at the address its comment names, the file's own
// values (a switch's table, texts, a table of steps) where the test puts them, and every address filled in by the few
// lines here, not by match's, each word highest byte first as the console keeps it. Then match has to find each
// function the same, with the values it reaches where the original's instructions point; one whose C was changed, or
// whose text was, differs and the rest don't; a name with no address can't be the same; and C IDO won't take says
// where. Last, `npm run dp -- match` on a made-up game with that cartridge as its copy, which the test removes after.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, REPO, gameFolder, proofFolder } from '../lib/paths.mjs';
import { objectOf } from '../ps2/match.mjs';
import { compileFile, matchFile } from '../n64/match.mjs';

const HERE = fileURLToPath(new URL('./n64-match/', import.meta.url));
const WORK = join(LOCAL, 'tmp', 'n64-match-test');
const GAME = 'test-n64-match', VERSION = `${GAME}/c`;
const COPIES = join(LOCAL, 'copies.json');
// how Nintendo 64 games of the time were built: IDO 5.3 at -O2 for the VR4300 in its MIPS II, with no small values
const COMPILER = { name: 'ido', version: '5.3', flags: ['-O2', '-mips2', '-G', '0', '-non_shared', '-Xcpluscomm', '-signed'] };
// the made-up program: where the boot code puts it, its functions, its values, what starts at zero, and the names it
// uses and doesn't define
const LOAD = 0x80000400;
const FUNCTIONS = { Score: 0x80000500, Say: 0x80000600, func_80000700: 0x80000700, Speed: 0x80000800 };
const SECTIONS = { '.rodata': 0x80002000, '.data': 0x80002100, '.bss': 0x80002200 };
const NAMED = new Map([['gFrame', 0x80002800], ['gTotal', 0x80002804], ['Print', 0x80000900]]);

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

// The made-up cartridge's code, from IDO's object: each function where FUNCTIONS says, each section of values where
// SECTIONS says, and every place a linker fills in filled in, as the console keeps a word. { cartridge, sizes }.
function lay(made) {
  const cartridge = Buffer.alloc(0x1000 + 0x100000), at = address => 0x1000 + address - LOAD;
  cartridge.writeUInt32BE(0x80371240, 0);
  cartridge.writeUInt32BE(0x0000000F, 4);
  cartridge.writeUInt32BE(LOAD, 8);
  cartridge.write('DREAMPORTS MATCH'.padEnd(20), 0x20, 'latin1');
  const inCode = offset => made.functions.find(f => offset >= f.at && offset < f.at + f.size);
  const placeOf = (section, offset) => (section === '.text' ? FUNCTIONS[inCode(offset).name] + offset - inCode(offset).at : SECTIONS[section] + offset);
  const sizes = new Map();
  for (const [section, { bytes, relocations, zeroed }] of made.sections) {
    const buffer = Buffer.from(bytes);
    for (const r of relocations) {
      if (section === '.text' && FUNCTIONS[inCode(r.at)?.name] === undefined) continue;
      const target = r.section ? placeOf(r.section, r.addend) : NAMED.get(r.symbol) + r.addend, word = buffer.readUInt32BE(r.at);
      const filled = { hi16: (word & 0xFFFF0000) | ((target + 0x8000) >>> 16), lo16: (word & 0xFFFF0000) | (target & 0xFFFF), jump26: (word & 0xFC000000) | ((target >>> 2) & 0x3FFFFFF), word32: target }[r.kind];
      buffer.writeUInt32BE(filled >>> 0, r.at);
    }
    if (section === '.text') {
      for (const f of made.functions) {
        if (FUNCTIONS[f.name] === undefined) continue;
        buffer.copy(cartridge, at(FUNCTIONS[f.name]), f.at, f.at + f.size);
        sizes.set(FUNCTIONS[f.name], f.size);
      }
    } else if (!zeroed) buffer.copy(cartridge, at(SECTIONS[section]));
  }
  return { cartridge, sizes };
}

const byName = result => Object.fromEntries((result.functions ?? []).map(f => [f.name, f]));

async function main() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });

  console.log('A program of the project\'s own, against a cartridge made from it:');
  const built = await compileFile({ file: join(HERE, 'program.c'), compiler: COMPILER, work: join(WORK, 'built', 'program'), log: line => console.log(`    ${line}`) });
  check(!built.error, `the program builds with IDO ${COMPILER.version}${built.error ? `: ${built.error}` : ''}`);
  if (built.error) return;
  const made = objectOf(built.object);
  check(made.bigEndian && made.functions.length === 5, `IDO's object keeps its numbers highest byte first, with its five functions: ${made.functions.map(f => f.name).join(', ')}`);
  const { cartridge, sizes } = lay(made);
  const program = { load: LOAD, text: cartridge.subarray(0x1000) };
  const matching = (file, extra = {}) => matchFile({
    file, compiler: COMPILER, work: join(WORK, 'built', file.split('/').at(-1).replace(/\.c$/, '')), addressOf: name => NAMED.get(name) ?? null,
    sizeOf: address => sizes.get(address) ?? null, program, ...extra,
  });

  const same = await matching(join(HERE, 'program.c'));
  const functions = byName(same);
  for (const name of Object.keys(FUNCTIONS)) {
    check(functions[name]?.same === true && functions[name].address === FUNCTIONS[name], `${name} is the same as the program's, at 0x${FUNCTIONS[name].toString(16).toUpperCase()}${functions[name]?.same ? '' : `: ${functions[name]?.differing} words differ, ${functions[name]?.data?.filter(value => !value.same).map(value => `${value.name} ${value.why}`).join(', ')}`}`);
  }
  check(functions.Nobody?.address === null && functions.Nobody.same === undefined, 'a function with no address above it is compared with nothing');
  check(same.unknown.length === 0, 'every name has an address');
  check(functions.Score.data.some(value => value.same && value.address >= SECTIONS['.rodata'] && value.address < SECTIONS['.data']) && functions.Score.data.some(value => value.same && value.address === SECTIONS['.data']),
    `Score's switch reads a table of addresses in the file's own values, and its table of steps, each found where the original's instructions point: ${functions.Score.data.map(value => `0x${value.address?.toString(16)}`).join(', ')}`);
  check(functions.Say.data.filter(value => value.same && value.address >= SECTIONS['.rodata'] && value.address < SECTIONS['.data']).length >= 1 && functions.Say.data.some(value => value.same && value.address >= SECTIONS['.bss']),
    'Say\'s texts are found and the same, and its count, which starts at zero');
  check(functions.func_80000700.calls.includes(FUNCTIONS.Score) && functions.func_80000700.calls.includes(FUNCTIONS.Say), 'a call to a function of the same file goes where the original has it');

  // the same program with one sum changed, as a twin written slightly wrong
  const changed = join(WORK, 'changed');
  mkdirSync(changed, { recursive: true });
  const source = readFileSync(join(HERE, 'program.c'), 'utf8');
  writeFileSync(join(changed, 'program.h'), readFileSync(join(HERE, 'program.h')));
  check(source.includes('return x + 1;') && source.includes('"gone"') && source.includes('x * 0.5f'), 'the program has the lines the test changes');
  writeFileSync(join(changed, 'program.c'), source.replace('return x + 1;', 'return x + 2;'));
  const wrong = byName(await matching(join(changed, 'program.c')));
  check(wrong.Score?.same === false && wrong.Score.differing === 1 && wrong.Score.first >= 0, `Score, with x + 1 changed to x + 2, differs: ${wrong.Score?.differing} of ${wrong.Score?.words} words, first at +${wrong.Score?.first}`);
  check(wrong.Say?.same === true && wrong.func_80000700?.same === true && wrong.Speed?.same === true, 'and the other functions are still the same');

  // a fraction changed: a float the code builds in a register, or keeps among the file's values
  writeFileSync(join(changed, 'program.c'), source.replace('x * 0.5f', 'x * 0.25f'));
  const half = byName(await matching(join(changed, 'program.c')));
  check(half.Speed?.same === false, `Speed, with a half changed to a quarter, differs: ${half.Speed?.differing} words, ${half.Speed?.data?.filter(value => !value.same).map(value => value.why).join(', ')}`);

  // a text changed: the code is the same, and the value it reaches isn't
  writeFileSync(join(changed, 'program.c'), source.replace('"gone"', '"done"'));
  const text = byName(await matching(join(changed, 'program.c')));
  check(text.Say?.same === false && text.Say.differing === 0 && text.Say.data.some(value => !value.same && /differs/.test(value.why)), `Say, with a text changed, has the same code and differs in its value: ${text.Say?.data.filter(value => !value.same).map(value => `${value.name} ${value.why}`).join(', ')}`);

  // a name with no address
  const missing = await matching(join(HERE, 'program.c'), { addressOf: name => (name === 'gFrame' ? null : NAMED.get(name) ?? null) });
  const without = byName(missing);
  check(without.Score?.same === false && without.Score.missing.includes('gFrame') && missing.unknown.includes('gFrame'), 'a function that uses a name with no address isn\'t the same, and the name is said');
  check(without.func_80000700?.same === true, 'and one that doesn\'t use it still is');

  // C IDO won't take
  writeFileSync(join(changed, 'program.c'), `${source}\nvoid Broken(void) { return 1 +; }\n`);
  const broken = await matching(join(changed, 'program.c'));
  check(/program\.c/.test(broken.error ?? '') && /Error|error/.test(broken.error ?? ''), `C that doesn't build says where: ${(broken.error ?? '').split('\n').find(line => /rror/.test(line))}`);

  console.log('npm run dp -- match on a made-up game with the cartridge as its copy:');
  await wholeGame(cartridge, sizes);
}

// the cartridge as a game's copy, its C as the game's version in C, and match run on it as a person runs it
async function wholeGame(cartridge, sizes) {
  const before = tracked(), copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
  const tidy = () => {
    for (const path of [gameFolder(GAME), join(LOCAL, 'match', GAME), join(LOCAL, 'results', GAME)]) rmSync(path, { recursive: true, force: true });
  };
  tidy();
  try {
    const copy = join(WORK, `${GAME}.z64`);
    writeFileSync(copy, cartridge);
    const original = { console: 'n64', name: 'Test Nintendo 64 Match (World)', title: 'DREAMPORTS MATCH', code: '', sha1: createHash('sha1').update(cartridge).digest('hex'), compiler: COMPILER };
    mkdirSync(proofFolder(GAME), { recursive: true });
    writeFileSync(join(proofFolder(GAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
    writeFileSync(join(proofFolder(GAME), 'addresses.json'), `${JSON.stringify({ about: 'The test\'s names.', addresses: Object.fromEntries([...NAMED].map(([name, address]) => [name, address.toString(16).toUpperCase()])) }, null, 2)}\n`);
    let run = dp('rom', copy);
    check(run.status === 0 && run.out.includes(GAME), 'rom knows the cartridge');
    run = dp('codemap', GAME, '--from', writeList(sizes));
    check(run.status === 0, `its code map is made: ${run.out.trim().split('\n').at(-1)}`);
    mkdirSync(join(gameFolder(VERSION), 'src'), { recursive: true });
    for (const file of ['program.c', 'program.h']) writeFileSync(join(gameFolder(VERSION), 'src', file), readFileSync(join(HERE, file)));
    // a version is there once it has its page
    writeFileSync(join(gameFolder(VERSION), 'index.html'), '<!doctype html>\n');
    run = dp('match', VERSION);
    if (run.status !== 0) console.log(run.out);
    check(run.status === 0 && /4 of 4 functions the same/.test(run.out), `every twin is the same: ${run.out.trim().split('\n').filter(line => /functions? the same/.test(line)).join(' ')}`);
    run = dp('match', VERSION, 'func_80000700');
    const listing = join(LOCAL, 'match', VERSION, '80000700.txt');
    check(run.status === 0 && /The same {2}0x80000700 func_80000700/.test(run.out) && existsSync(listing) && readFileSync(listing, 'utf8').includes('jal'),
      'one function asked for by its label is compared alone, with its instructions beside the original\'s kept out of the repository');
  } finally {
    tidy();
    if (copies) writeFileSync(COPIES, copies);
    else rmSync(COPIES, { force: true });
  }
  check(!existsSync(gameFolder(GAME)), 'nothing is left behind');
  check(tracked() === before, 'nothing the repository tracks has changed');
}

// the program's functions as a list for codemap --from, with their sizes, as a decompilation's would be, as IDO's code
// puts a function's first steps before its opening and the finder alone would read more than a function
function writeList(sizes) {
  const file = join(WORK, 'functions.csv');
  writeFileSync(file, `address,size\n${Object.values(FUNCTIONS).map(address => `0x${address.toString(16)},${sizes.get(address)}`).join('\n')}\n`);
  return file;
}

main().then(() => {
  rmSync(WORK, { recursive: true, force: true });
  if (failures.length) {
    console.log(`\n${failures.length} failed.`);
    process.exit(1);
  }
  console.log('\nmatch on the Nintendo 64 says the same of what is the same, and where it differs of what isn\'t.');
}).catch(error => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
