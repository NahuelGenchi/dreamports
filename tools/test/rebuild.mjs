// npm run test:rebuild: the whole cartridge rebuilt (`match --whole`) and every byte accounted for (`proofs --bytes`),
// through the tools as they're typed, on a made-up cartridge of the project's own program (rebuild/cart.c), so it
// needs nobody's copy of any game. The console's compiler builds the program, and the test lays its functions one after
// another on four bytes, as a linker does, after a made-up header, with a table of data after them and fill to the
// end. The same C is a made-up game's version in C, in games/ for as long as this takes.
//
// What it shows: a complete version passes both, with the zeros that line up a function explained as padding; a code
// map that misses a function is caught by both; a twin moved is caught; a code map that holds a function with its
// padding is still complete; and the rebuild writes nothing.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, REPO, gameFolder, proofFolder } from '../lib/paths.mjs';
import { withBuildTools } from '../gba/build.mjs';
import { buildCompilers, isCompilerBuilt } from '../gba/agbcc.mjs';
import { addressFinder, matchFile } from '../gba/match.mjs';
import { firstFiles } from '../lib/new-game.mjs';
import { formatCodeMap, hex, parseCodeMap } from '../lib/proof-files.mjs';
import { CELL, layoutOf } from '../lib/played.mjs';
import { madeUpGame } from './made-up-game.mjs';
import { compiler, place } from './twin/cartridge.mjs';

const HERE = fileURLToPath(new URL('./rebuild/', import.meta.url));
const NAME = 'test-rebuild', VERSION = `${NAME}/c`;
const work = join(LOCAL, 'tmp', 'rebuild-test'), COPIES = join(LOCAL, 'copies.json');
const source = join(gameFolder(VERSION), 'src', 'cart.c'), FILE = `games/${VERSION}/src/cart\\.c`;
// the made-up cartridge: its header, then the program's code from where a game's starts, its data, and fill, 512 KB as
// a cartridge is, since mGBA, which match reads the copy with, takes a file no bigger than the work memory for a
// program sent over the link cable and reads nothing of it as a cartridge
const CARTRIDGE = 0x08000000, SIZE = 0x80000, CODE = 0x080000C0, DATA_BYTES = 40;
const NAMED = new Map([['gDots', 0x03000100], ['gFrame', 0x03000020]]);

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
const last = run => run.out.trim().split('\n').at(-1);
const count = n => n.toLocaleString('en');
const dp = (...args) => {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 24 });
  return { status, out: stdout + stderr };
};
const tidy = () => { for (const path of [gameFolder(NAME), join(LOCAL, 'match', NAME)]) rmSync(path, { recursive: true, force: true }); };
// every file under a folder, with its text
const filesIn = folder => (existsSync(folder) ? readdirSync(folder, { recursive: true, withFileTypes: true }) : [])
  .filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name)).sort().map(file => [relative(folder, file), readFileSync(file, 'utf8')]);
const program = readFileSync(join(HERE, 'cart.c'), 'utf8');
const write = (from, to) => {
  if (from && !program.includes(from)) throw new Error(`The program has no "${from}" for the test to change.`);
  writeFileSync(source, from ? program.replace(from, to) : program);
};

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
if (!isCompilerBuilt(compiler.name)) withBuildTools(console.log, tools => buildCompilers([compiler.name], console.log, tools));
const copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
tidy();
try {
  console.log('A program of the project\'s own, laid out as a linker lays it:');
  // built once, for its code and where each function is in it, with nothing to compare with yet
  const built = await matchFile({
    file: join(HERE, 'cart.c'), compiler, work: join(work, 'built', 'cart'), addressOf: addressFinder({ named: new Map([...NAMED, ['gSpeeds', 0]]) }),
    sizeOf: () => null, original: (address, bytes) => ({ bytes: Buffer.alloc(bytes) }),
  });
  check(!built.error, `the program builds with ${compiler.name}${built.error ? `: ${built.error}` : ''}`);
  if (built.error) process.exit(1);
  const functions = built.functions.map(f => ({ name: f.name, address: CODE + f.at, size: f.length, until: CODE + f.until }));
  const wrong = functions.filter(f => built.functions.find(each => each.name === f.name).address !== f.address);
  check(!wrong.length, `each function's comment names where it sits, one after another${wrong.length ? `: write ${wrong.map(f => `${f.name}, 0x${hex(f.address)}`).join('; ')}` : ''}`);
  const padded = functions.filter(f => f.until > f.address + f.size);
  check(padded.length > 0 && padded.every(f => f.until - f.address - f.size === 2), `the zeros that line up the next function come after ${padded.map(f => f.name).join(', ')}`);

  // the cartridge: a made-up header, the code where each comment says, the data after it, and fill
  const DATA = functions.at(-1).until, names = new Map([...NAMED, ['gSpeeds', DATA]]);
  const { rom } = madeUpGame({ title: 'TEST REBUILD', code: 'TRBD', size: SIZE });
  rom.fill(0xFF, CODE - CARTRIDGE);
  place(rom, readFileSync(join(work, 'built', 'cart.s'), 'utf8'), Object.fromEntries(functions.map(f => [f.name, f.address])), names);
  for (let i = 0; i < DATA_BYTES; i++) rom[DATA - CARTRIDGE + i] = (i * 29 + 7) & 0x7F;
  const copy = join(work, 'cartridge.gba');
  writeFileSync(copy, rom);
  const sha1 = createHash('sha1').update(rom).digest('hex');
  const original = { console: 'gba', name: 'Test Rebuild (World)', title: 'TEST REBUILD', code: 'TRBD', sha1, compiler };

  // the game, in games/ for as long as this takes
  const files = firstFiles(NAME, original, { language: 'c', issue: 900, lead: 'pat-lead', added: '2026-11-19' });
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(gameFolder(NAME), file, '..'), { recursive: true });
    writeFileSync(join(gameFolder(NAME), file), text);
  }
  rmSync(join(gameFolder(VERSION), 'src', 'main.c'));
  mkdirSync(proofFolder(NAME), { recursive: true });
  writeFileSync(join(proofFolder(NAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
  // a code map, with what the version's play used of the cartridge's data, every cell the table is in, as prove keeps
  // it for that code map
  const used = new Uint8Array(Math.ceil(SIZE / CELL / 8));
  for (let at = DATA; at < DATA + DATA_BYTES; at++) used[(at - CARTRIDGE) / CELL >> 3] |= 1 << ((at - CARTRIDGE) / CELL & 7);
  const mapOf = list => {
    const text = formatCodeMap({ original: sha1, from: 'The test\'s own program', functions: list.map(f => ({ address: f.address, size: f.size })) });
    writeFileSync(join(proofFolder(NAME), 'code-map.json'), text);
    mkdirSync(proofFolder(VERSION), { recursive: true });
    const places = layoutOf(parseCodeMap(JSON.parse(text))).places;
    writeFileSync(join(proofFolder(VERSION), 'played.json'), `${JSON.stringify({ original: sha1, places, content: { 'made-up': deflateRawSync(used).toString('base64') } }, null, 2)}\n`);
  };
  mapOf(functions);
  writeFileSync(join(proofFolder(NAME), 'addresses.json'), `${JSON.stringify({ about: 'The test\'s own names.', addresses: Object.fromEntries([...names].map(([name, address]) => [name, hex(address)])) }, null, 2)}\n`);
  cpSync(join(HERE, 'cart.h'), join(gameFolder(VERSION), 'src', 'cart.h'));
  write();

  let run = dp('rom', copy);
  check(run.status === 0 && run.out.includes(NAME), 'rom knows its copy');
  run = dp('proofs', VERSION, '--start');
  check(run.status === 0, 'the version keeps its proofs');
  run = dp('match', VERSION);
  check(run.status === 0 && /5 of 5 functions the same/.test(run.out) && /5 functions kept as proven by the same bytes/.test(run.out), `match proves each function by itself: ${run.out.trim().split('\n').at(-2)}`);
  const code = functions.reduce((sum, f) => sum + f.size, 0), padding = functions.reduce((sum, f) => sum + f.until - f.address - f.size, 0);

  console.log('Complete:');
  const before = filesIn(gameFolder(NAME));
  run = dp('match', VERSION, '--whole');
  check(run.status === 0 && new RegExp(`The same: +${code} bytes, 100%`).test(run.out) && /Every byte of the code map's code is rebuilt the same/.test(run.out), `the whole cartridge is rebuilt the same: ${last(run)}`);
  check(JSON.stringify(filesIn(gameFolder(NAME))) === JSON.stringify(before) && !/kept as proven/.test(run.out), 'and nothing is written, nor any proof kept');
  run = dp('proofs', VERSION, '--bytes');
  const fill = SIZE - (DATA + DATA_BYTES - CARTRIDGE);
  check(run.status === 0 && new RegExp(`Bytes accounted for: 100%, ${count(SIZE)} of ${count(SIZE)} bytes`).test(run.out) && /Every byte is proven code, data used in play or explained/.test(run.out), `every byte is accounted for: ${run.out.split('\n').find(line => line.startsWith('Bytes accounted for'))}`);
  check(new RegExp(`\\b${padding} bytes +Zeros after a function`).test(run.out) && new RegExp(`\\b${code} bytes +Proven code`).test(run.out) && /\b192 bytes +The cartridge's header/.test(run.out)
    && new RegExp(`\\b${DATA_BYTES} bytes +Data used in play`).test(run.out) && new RegExp(`\\b${count(fill)} bytes +Runs of one value`).test(run.out), `the padding, ${padding} bytes, is explained, beside the code, the header, the data and the fill`);
  run = dp('proofs', VERSION);
  check(run.status === 0 && /bytes accounted for 100%/.test(run.out), `proofs says it beside the two numbers: ${run.out.split('\n').find(line => line.includes('bytes accounted for'))}`);

  console.log('A code map that misses a function:');
  const step = functions.find(f => f.name === 'Step');
  mapOf(functions.filter(f => f !== step));
  run = dp('match', VERSION, '--whole');
  check(new RegExp(`Step, ${FILE}: ${step.size} bytes laid where no function of the code map starts`).test(run.out), 'the rebuild finds its twin outside the code map');
  check(new RegExp(`0x${hex(step.address)} +from StepAll`).test(run.out) && /Not every byte/.test(last(run)), 'and a call to it where no function starts');
  run = dp('proofs', VERSION, '--bytes');
  const gap = step.until - step.address;
  check(new RegExp(`0x${hex(step.address)} to 0x${hex(step.until - 1)} +${gap} bytes, data never used`).test(run.out) && /Still unexplained, 1 stretch,/.test(run.out), `the accounting finds its ${gap} bytes, and nothing else, unexplained: ${run.out.split('\n').find(line => line.startsWith('Bytes accounted for'))}`);
  mapOf(functions);

  console.log('A twin moved:');
  const speed = functions.find(f => f.name === 'Speed');
  write(`Speed, 0x${hex(speed.address)}:`, `Speed, 0x${hex(speed.address + 2)}:`);
  run = dp('match', VERSION, '--whole');
  check(new RegExp(`Speed, ${FILE}: ${speed.size} bytes laid where no function of the code map starts`).test(run.out) && new RegExp(`0x${hex(speed.address)} to 0x${hex(speed.address + 1)} +2 bytes, function 0x${hex(speed.address)}`).test(run.out) && /Not every byte/.test(last(run)),
    'two bytes on, the smallest move a function of Thumb code has, it lies outside the code map and leaves its function\'s first bytes uncovered');
  write();

  console.log('A code map that holds a function with the zeros after it:');
  mapOf(functions.map(f => ({ ...f, size: f.until - f.address })));
  run = dp('match', VERSION);
  check(/5 of 5 functions the same/.test(run.out), 'match still finds each the same');
  run = dp('match', VERSION, '--whole');
  check(new RegExp(`Padding: +${padding} bytes`).test(run.out) && /Every byte of the code map's code is rebuilt the same/.test(run.out), `the zeros are the rebuild's padding, and it's complete: ${last(run)}`);
  run = dp('proofs', VERSION, '--bytes');
  check(/Bytes accounted for: 100%/.test(run.out), 'and every byte is still accounted for');
} finally {
  tidy();
  if (copies) writeFileSync(COPIES, copies);
  else rmSync(COPIES, { force: true });
}
check(!existsSync(gameFolder(NAME)), 'nothing is left behind');

rmSync(work, { recursive: true, force: true });
if (failures.length) {
  console.log(`\n${failures.length} failed.`);
  process.exit(1);
}
console.log('\nThe whole cartridge rebuilt and every byte accounted for find what a function\'s own proof can\'t.');
