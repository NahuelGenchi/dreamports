// npm run test:libraries: a shared library (tools/lib/libraries.mjs) in two games, with a program of the project's own
// as the library, so it needs nobody's copy of anything. The console's compiler builds the library once, and the test
// puts its two functions in two made-up cartridges, each at addresses of its own and with its values elsewhere. The
// library sits in kit/gba/c/lib/ and each game in games/ for as long as this takes.
//
// What it shows: each version takes the library through its proof/libraries.json and nothing else; the port map
// counts its twins in both; the game's build links the library's C; `match` proves it by the same bytes on one copy
// and `twin` by the same memory on the other, each on its own copy at its own addresses; `libraries` says how much of
// the console's shared code is proven; a change to the library's C makes its proofs stale in both games at once; a
// stop in it holds it back in both; and `libraries --check` refuses a library that names an address, a function it
// doesn't list, and a version that puts a function where its code map has another.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { LOCAL, REPO, gameFolder, proofFolder } from '../lib/paths.mjs';
import { withBuildTools } from '../gba/build.mjs';
import { buildCompilers, isCompilerBuilt } from '../gba/agbcc.mjs';
import { matchFile } from '../gba/match.mjs';
import { ensureCaller } from '../gba/twin.mjs';
import { firstFiles } from '../lib/new-game.mjs';
import { formatCodeMap, hex } from '../lib/proof-files.mjs';
import { buildGame } from '../lib/c.mjs';
import { madeUpGame } from './made-up-game.mjs';
import { compiler, place } from './twin/cartridge.mjs';

const LIBRARY = 'gba/test-made-up', FOLDER = join(REPO, 'kit', 'gba', 'c', 'lib', 'test-made-up');
const SOURCE = join(FOLDER, 'test-made-up.c');
const COPIES = join(LOCAL, 'copies.json'), work = join(LOCAL, 'tmp', 'libraries-test');
// the library, as a game's own C would be written, naming nothing of any game
const TEXT = `// The tools' own made-up library, for npm run test:libraries.

extern unsigned gLibCount;
extern unsigned short gLibTable[4];

/** Adds two numbers, and counts each time it's asked. */
unsigned LibAdd(unsigned a, unsigned b) {
  gLibCount++;
  return a + b;
}

/** A number from the table, or for one past its end, one more than it. */
unsigned LibPick(unsigned i) {
  if (i < 4)
    return gLibTable[i];
  return LibAdd(i, 1);
}
`;
// the two games: where each copy has the library's functions and values, in another order in the second
const GAMES = [
  { name: 'test-libraries-a', title: 'LIBRARY A', functions: { LibAdd: 0x08000800, LibPick: 0x08000840 }, values: { gLibCount: 0x03000200, gLibTable: 0x03000210 } },
  { name: 'test-libraries-b', title: 'LIBRARY B', functions: { LibPick: 0x08000900, LibAdd: 0x08000A40 }, values: { gLibCount: 0x03000400, gLibTable: 0x03000500 } },
];
const version = game => `${game.name}/c`;

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
const dp = (...args) => {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 24 });
  return { status, out: stdout + stderr };
};
const last = run => run.out.trim().split('\n').at(-1);
const kept = game => JSON.parse(readFileSync(join(proofFolder(version(game)), 'proofs.json'), 'utf8')).functions;
const writeLibrary = (text = TEXT) => writeFileSync(SOURCE, text);
const tidy = () => {
  rmSync(FOLDER, { recursive: true, force: true });
  for (const game of GAMES) for (const path of [gameFolder(game.name), join(LOCAL, 'match', version(game)), join(LOCAL, 'twin', version(game))]) rmSync(path, { recursive: true, force: true });
};
const librariesJson = (game, functions = game.functions) => `${JSON.stringify({
  about: 'Where the made-up cartridge has the library, as the test placed it.',
  libraries: { [LIBRARY]: { at: Object.fromEntries([...Object.entries(functions), ...Object.entries(game.values)].map(([name, address]) => [name, hex(address)])) } },
}, null, 2)}\n`;

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
if (!isCompilerBuilt(compiler.name)) withBuildTools(console.log, tools => buildCompilers([compiler.name], console.log, tools));
ensureCaller(console.log);
const copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
tidy();
try {
  console.log('A library of the project\'s own, in kit/gba/c/lib/ for as long as this takes:');
  mkdirSync(FOLDER, { recursive: true });
  writeLibrary();
  const built = await matchFile({
    file: SOURCE, compiler, work: join(work, 'built', 'library'), addressOf: () => 0,
    sizeOf: () => null, original: (address, bytes) => ({ bytes: Buffer.alloc(bytes) }), given: new Map([['LibAdd', 0x08000800], ['LibPick', 0x08000840]]),
  });
  check(!built.error, `the library builds with ${compiler.name}${built.error ? `: ${built.error}` : ''}`);
  if (built.error) process.exit(1);
  const sizes = Object.fromEntries(built.functions.map(f => [f.name, f.length]));
  writeFileSync(join(FOLDER, 'library.json'), `${JSON.stringify({
    about: 'A made-up library, for the tools\' own test.',
    compilers: { gba: compiler }, functions: Object.entries(sizes).map(([name, size]) => [name, size, 'test-made-up.c']),
  }, null, 2)}\n`);
  writeFileSync(join(FOLDER, 'NOTICE.md'), 'Written for the tools\' own test, from nothing but itself.\n');
  const assembly = readFileSync(join(work, 'built', 'library.s'), 'utf8');

  console.log('Two games that have it, each at its own addresses:');
  for (const game of GAMES) {
    const { rom } = madeUpGame({ size: 0x1000, title: game.title, code: game.title.slice(-1).repeat(4) });
    place(rom, assembly, game.functions, new Map(Object.entries(game.values)));
    const copy = join(work, `${game.name}.gba`);
    writeFileSync(copy, rom);
    const original = { console: 'gba', name: `Test ${game.title} (World)`, title: game.title, code: game.title.slice(-1).repeat(4), sha1: createHash('sha1').update(rom).digest('hex'), compiler };
    for (const [file, text] of Object.entries(firstFiles(game.name, original, { language: 'c', issue: 900, lead: 'pat-lead', added: '2026-11-18' }))) {
      mkdirSync(join(gameFolder(game.name), file, '..'), { recursive: true });
      writeFileSync(join(gameFolder(game.name), file), text);
    }
    mkdirSync(proofFolder(game.name), { recursive: true });
    writeFileSync(join(proofFolder(game.name), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
    writeFileSync(join(proofFolder(game.name), 'code-map.json'), formatCodeMap({
      original: original.sha1, from: 'The test\'s own placing',
      functions: Object.entries(game.functions).map(([name, address]) => ({ address, size: sizes[name] })).sort((a, b) => a.address - b.address),
    }));
    mkdirSync(proofFolder(version(game)), { recursive: true });
    writeFileSync(join(proofFolder(version(game)), 'libraries.json'), librariesJson(game));
    const run = dp('rom', copy);
    check(run.status === 0 && run.out.includes(game.name), `rom knows ${game.name}'s copy`);
  }
  let run = dp('libraries', '--check');
  check(run.status === 0 && /1 shared library and the 2 versions that take them keep their rules/.test(run.out), `libraries --check passes: ${last(run)}`);
  for (const game of GAMES) {
    run = dp('portmap', version(game));
    check(run.status === 0 && /2 functions named, 0 names inside a function but not at its start, 0 stops/.test(run.out), `${game.name}'s port map names both of the library's functions: ${last(run)}`);
    const map = JSON.parse(readFileSync(join(proofFolder(version(game)), 'port-map.json'), 'utf8'));
    check(map.functions.every(([, where]) => where.startsWith('kit/gba/c/lib/test-made-up/test-made-up.c:')), 'each with its place in the kit');
  }

  console.log('The game\'s build links the library\'s C:');
  const main = join(gameFolder(version(GAMES[0])), 'src', 'main.c');
  writeFileSync(main, '#include "gba.h"\n#include "twins.h"\n\nunsigned LibAdd(unsigned a, unsigned b);\nunsigned LibPick(unsigned i);\nTWIN_TABLE\n\nvoid game_start(void) {}\n\nvoid game_step(uint16_t keys) { gba_pal[0] = LibAdd(keys, 1); }\n');
  const taken = join(proofFolder(version(GAMES[0])), 'libraries.json');
  // what a built game asks of the page: a function it calls and has no code for is one of those
  const imported = async out => WebAssembly.Module.imports(await WebAssembly.compile(readFileSync(out))).map(each => each.name);
  renameSync(taken, `${taken}.aside`);
  let error = null;
  try {
    await buildGame(gameFolder(version(GAMES[0])), join(work, 'without.wasm'));
  } catch (caught) {
    error = caught.message;
  }
  renameSync(`${taken}.aside`, taken);
  check(/nothing defines LibAdd/.test(error ?? ''), 'without its libraries.json, the game has no code for the library\'s function');
  await buildGame(gameFolder(version(GAMES[0])), join(work, 'with.wasm'));
  check(!(await imported(join(work, 'with.wasm'))).includes('LibAdd'), 'with it, the game is built with the library\'s C');
  rmSync(main);

  console.log('Proven on each copy, at its own addresses:');
  for (const game of GAMES) check(dp('proofs', version(game), '--start').status === 0, `${game.name} keeps its proofs`);
  run = dp('match', version(GAMES[0]));
  check(run.status === 0 && /2 of 2 functions the same/.test(run.out) && /2 functions kept as proven by the same bytes/.test(run.out) && kept(GAMES[0]).length === 2, `match proves the library on the first copy: ${last(run)}`);
  run = dp('twin', version(GAMES[1]), '--frames', '2', '--calls', '1000');
  check(run.status === 0 && /2 of 2 functions left the same memory/.test(run.out) && kept(GAMES[1]).every(line => line[1] === 'memory') && kept(GAMES[1]).length === 2, `twin proves it on the second, where it sits elsewhere: ${last(run)}`);
  run = dp('match', version(GAMES[1]));
  check(run.status === 0 && kept(GAMES[1]).every(line => line[1] === 'bytes'), 'and match proves it there by the same bytes too, the stronger proof');
  check(JSON.stringify(kept(GAMES[0]).map(line => line[2]).sort()) === JSON.stringify(kept(GAMES[1]).map(line => line[2]).sort()), 'each twin\'s mark is the same in both, as it\'s the same C');
  check(kept(GAMES[0]).every(line => !kept(GAMES[1]).some(other => other[0] === line[0])), 'and each proof is kept by its own copy\'s address');
  run = dp('proofs', version(GAMES[1]), '08000900');
  check(/0x08000900 +\d+ bytes  LibPick, kit\/gba\/c\/lib\/test-made-up\/test-made-up\.c:\d+: proven by the same bytes/.test(run.out), 'proofs names the twin by its place in the kit');
  run = dp('libraries');
  check(run.status === 0 && /Game Boy Advance: 100% of its known shared code proven, \d+ of \d+ bytes and 2 of 2 functions, in 1 library, taken by 2 versions/.test(run.out), `libraries says how much of the console's shared code is proven: ${run.out.trim().split('\n')[0]}`);
  run = dp('libraries', version(GAMES[0]));
  check(/0x08000800  LibAdd: proven by the same bytes/.test(run.out), 'and with a version, where each function it takes stands');

  console.log('One library, held to its C in every game at once:');
  writeLibrary(TEXT.replace('gLibCount++;', 'gLibCount += 1;'));
  run = dp('proofs', '--check');
  check(run.status === 1 && GAMES.every(game => run.out.includes(version(game))) && /LibAdd/.test(run.out), 'a change to the library\'s code makes its proofs stale in both games');
  run = dp('libraries');
  check(/Game Boy Advance: \d+(\.\d+)?% of its known shared code proven, \d+ of \d+ bytes and 1 of 2 functions/.test(run.out), `and the console's number falls: ${run.out.trim().split('\n')[0]}`);
  writeLibrary(TEXT.replace('    return gLibTable[i];', '    return gLibTable[i]; // dp:stop'));
  run = dp('portmap', version(GAMES[1]));
  check(/1 stop/.test(run.out), `a stop in the library is a stop of each game that has it: ${last(run)}`);
  run = dp('proofs', version(GAMES[1]), '08000900');
  check(/not proven: its twin has a stop/.test(run.out), 'and its function isn\'t proven there');
  writeLibrary();
  for (const game of GAMES) dp('portmap', version(game));
  check(dp('proofs', '--check').status === 0, 'with the library as it was, every proof holds again');

  console.log('The rules:');
  writeLibrary(TEXT.replace('/** Adds two numbers', '/** 0x08000800: adds two numbers'));
  run = dp('libraries', '--check');
  check(run.status === 1 && /names 0x08000800, an address of a game/.test(run.out), 'a library names no address of any game');
  writeLibrary(`${TEXT}\nunsigned LibMore(void) { return 1; }\n`);
  run = dp('libraries', '--check');
  check(run.status === 1 && /defines LibMore, which kit\/gba\/c\/lib\/test-made-up\/library\.json doesn't list/.test(run.out), 'every function of a library is listed, with its size');
  writeLibrary();
  writeFileSync(join(proofFolder(version(GAMES[1])), 'libraries.json'), librariesJson(GAMES[1], { ...GAMES[1].functions, LibAdd: 0x08000900 }));
  run = dp('libraries', '--check');
  check(run.status === 1 && /LibAdd 0x08000900, where the code map's function is \d+ bytes, and the library's is \d+/.test(run.out), 'a version can\'t put a library\'s function where its code map has another');
  writeFileSync(join(proofFolder(version(GAMES[1])), 'libraries.json'), librariesJson(GAMES[1]));
  rmSync(join(FOLDER, 'NOTICE.md'));
  run = dp('libraries', '--check');
  check(run.status === 1 && /test-made-up\/NOTICE\.md isn't there/.test(run.out), 'a library credits what it was written from in a notice beside it');
  writeFileSync(join(FOLDER, 'NOTICE.md'), 'Written for the tools\' own test, from nothing but itself.\n');
  check(dp('libraries', '--check').status === 0, 'and all is well again');
} finally {
  tidy();
  if (copies) writeFileSync(COPIES, copies);
  else rmSync(COPIES, { force: true });
}

if (failures.length) {
  console.log(`\n${failures.length} check${failures.length === 1 ? '' : 's'} failed.`);
  process.exit(1);
}
console.log('\nA library written once is proven in each game that has it, on its own copy.');
