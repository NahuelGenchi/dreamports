// npm run test:ps1-libraries: a shared library (tools/lib/libraries.mjs) on the PlayStation, with a program of the
// project's own as the library, so it needs nobody's copy of anything. GCC 2.7.2 and maspsx build the library once, as
// match does, and the test lays it into two made-up PS-X EXEs, each with its functions and values at addresses of its
// own, as Sony's libraries are linked into each game. One of its functions is written by hand in the programs, as
// Sony wrote its calls into the BIOS in assembly, so no compiler gives it back, and the second program has one more
// function of the size of another beside it, which does something else. The library sits in kit/ps1/c/lib/ and each
// game in games/ for as long as this takes.
//
// What it shows: the first game takes the library through its libraries.json; `match` proves the two functions GCC
// gives back by the same bytes, building them with the library's own compiler from its folder alone, and `twin` the
// third by the same memory; `libraries --hash` keeps the third's short hash; `libraries --find` finds all three in the
// second game, the first two by building the library and the third by its hash, with where that game keeps the
// values they name, from its own instructions, and not the function of the same size beside them; `match` and `twin`
// prove them there too; and `libraries` counts them in the PlayStation's shared code, with `--shared` listing what
// the two copies share, and `libraries --check` refuses the library once it names an address of a game.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { LOCAL, REPO, gameFolder, proofFolder } from '../lib/paths.mjs';
import { formatCodeMap } from '../lib/proof-files.mjs';
import { compileFile, stopCompiler } from '../ps1/match.mjs';
import { builtLibrary, compilerOf, findLibrary } from '../ps1/libraries.mjs';
import { readLibrary } from '../lib/libraries.mjs';

const LIBRARY = 'ps1/test-made-up', FOLDER = join(REPO, 'kit', 'ps1', 'c', 'lib', 'test-made-up');
const SOURCE = join(FOLDER, 'test-made-up-ps1.c');
const COPIES = join(LOCAL, 'copies.json'), WORK = join(LOCAL, 'tmp', 'ps1-libraries-test');
// how the library was built: GCC 2.7.2 at -O2, and Sony's assembler of version 2.56
const COMPILER = { name: 'gcc', version: '2.7.2', flags: ['-O2', '-G0'], maspsx: { aspsxVersion: '2.56' } };
// the library, as a game's own C would be written, naming nothing of any game
const TEXT = `// The tools' own made-up PlayStation library, for npm run test:ps1-libraries.

extern int gLibTotal;
extern int gLibCount;

/** Adds to a total kept in memory, counts the call, and gives the total back. */
int LibAdd(int amount) {
  gLibTotal += amount;
  gLibCount++;
  return gLibTotal;
}

/** Adds the same amount twice, each time through LibAdd. */
int LibTwice(int amount) {
  LibAdd(amount);
  return LibAdd(amount);
}

/** Three times a number, which the library's maker wrote by hand. */
int LibTriple(int x) {
  return x * 3;
}
`;
// LibTriple as its maker wrote it: x + x, then + x, in the return's delay slot
const TRIPLE = [0x00841021, 0x03E00008, 0x00441021];
// the made-up programs: loaded at LOAD, SIZE bytes, where each has the library's functions and values, and the second
// one more function of LibAdd's size that counts by two
const LOAD = 0x80010000, SIZE = 0x4000, GP = 0x80018000;
const GAMES = [
  { name: 'test-ps1-libraries-a', functions: { LibAdd: 0x80010100, LibTwice: 0x80010200, LibTriple: 0x80010300 }, values: { gLibTotal: 0x80012000, gLibCount: 0x80012004 } },
  { name: 'test-ps1-libraries-b', functions: { LibTwice: 0x80010400, LibAdd: 0x80010600, LibTriple: 0x80010800 }, values: { gLibTotal: 0x80013000, gLibCount: 0x80013100 }, other: 0x80010700 },
];
const version = game => `${game.name}/c`;

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
const dp = (...args) => {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 26 });
  return { status, out: stdout + stderr };
};
const last = run => run.out.trim().split('\n').at(-1);
// starts a version's proofs, saying what went wrong if it doesn't
const start = game => {
  const run = dp('proofs', version(game), '--start');
  if (run.status !== 0) console.log(run.out);
  return run.status === 0;
};
const hexOf = n => n.toString(16).toUpperCase().padStart(8, '0');
const tracked = () => spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: REPO, encoding: 'utf8' }).stdout;
const kinds = game => Object.fromEntries(JSON.parse(readFileSync(join(proofFolder(version(game)), 'proofs.json'), 'utf8')).functions.map(([key, kind]) => [key, kind]));
const tidy = () => {
  rmSync(FOLDER, { recursive: true, force: true });
  for (const game of GAMES) for (const path of [gameFolder(game.name), join(LOCAL, 'twin', game.name), join(LOCAL, 'match', game.name), join(LOCAL, 'match', version(game))]) rmSync(path, { recursive: true, force: true });
};

// A PS-X EXE with the library's functions and values where `game` says, every address the assembler left filled in
// as a linker fills it, LibTriple as written by hand, and the function that counts by two where `game.other` says.
function programOf(made, game) {
  const image = Buffer.alloc(SIZE), text = made.sections.get('.text');
  const sizes = new Map();
  for (const f of made.functions.filter(each => each.section === '.text')) {
    const bytes = Buffer.from(text.bytes.subarray(f.at, f.at + f.size)), at = game.functions[f.name];
    for (const { at: place, kind, symbol, addend } of text.relocations.filter(r => r.at >= f.at && r.at < f.at + f.size)) {
      const target = (game.functions[symbol] ?? game.values[symbol]) + addend, word = bytes.readUInt32LE(place - f.at);
      const filled = { hi16: (word & 0xFFFF0000) | ((target + 0x8000) >>> 16), lo16: (word & 0xFFFF0000) | (target & 0xFFFF), jump26: (word & 0xFC000000) | ((target >>> 2) & 0x3FFFFFF) }[kind];
      bytes.writeUInt32LE(filled >>> 0, place - f.at);
    }
    if (f.name === 'LibTriple') {
      bytes.fill(0);
      TRIPLE.forEach((word, i) => bytes.writeUInt32LE(word, i * 4));
    }
    bytes.copy(image, at - LOAD);
    sizes.set(at, f.size);
    if (f.name === 'LibAdd' && game.other) {
      // count += 2: the ADDIU that adds one to the count, given two
      const other = Buffer.from(bytes);
      for (let i = 0; i < other.length; i += 4) if ((other.readUInt32LE(i) >>> 26) === 9 && (other.readUInt32LE(i) & 0xFFFF) === 1) other.writeUInt32LE(other.readUInt32LE(i) + 1, i);
      other.copy(image, game.other - LOAD);
      sizes.set(game.other, f.size);
    }
  }
  const header = Buffer.alloc(0x800);
  header.write('PS-X EXE', 0, 'latin1');
  header.writeUInt32LE(game.functions.LibTwice, 0x10);
  header.writeUInt32LE(GP, 0x14);
  header.writeUInt32LE(LOAD, 0x18);
  header.writeUInt32LE(SIZE, 0x1C);
  header.writeUInt32LE(0x801FFF00, 0x30);
  header.write('Sony Computer Entertainment Inc. for North America area', 0x4C, 'latin1');
  return { exe: Buffer.concat([header, image]), sizes };
}

// a made-up game with the program `game` says in games/, its code map, its version in C, and its copy, which rom knows
function makeGame(game, made) {
  const { exe, sizes } = programOf(made, game);
  const copy = join(WORK, `${game.name}.exe`);
  writeFileSync(copy, exe);
  const original = { console: 'ps1', name: `Test ${game.name} (World)`, title: game.name, code: '', sha1: createHash('sha1').update(exe).digest('hex'), compiler: COMPILER };
  mkdirSync(proofFolder(game.name), { recursive: true });
  writeFileSync(join(proofFolder(game.name), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
  writeFileSync(join(proofFolder(game.name), 'code-map.json'), formatCodeMap({
    original: original.sha1, from: 'The test\'s own placing', functions: [...sizes].map(([address, size]) => ({ address, size })).sort((a, b) => a.address - b.address),
  }));
  mkdirSync(join(gameFolder(version(game)), 'src'), { recursive: true });
  mkdirSync(proofFolder(version(game)), { recursive: true });
  // a version is there once it has its page
  writeFileSync(join(gameFolder(version(game)), 'index.html'), '<!doctype html>\n');
  writeFileSync(join(gameFolder(version(game)), 'src', 'main.c'), '// The game\'s own C, which has none of the library in it.\n');
  const run = dp('rom', copy);
  check(run.status === 0 && run.out.includes(game.name), `rom knows ${game.name}'s copy`);
}

async function main() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const copies = existsSync(COPIES) ? readFileSync(COPIES) : null, before = tracked();
  tidy();
  try {
    console.log('A library of the project\'s own, in kit/ps1/c/lib/ for as long as this takes:');
    mkdirSync(FOLDER, { recursive: true });
    writeFileSync(SOURCE, TEXT);
    writeFileSync(join(FOLDER, 'NOTICE.md'), 'Written for the tools\' own test, from nothing but itself.\n');
    const built = await compileFile({ file: SOURCE, root: FOLDER, includes: [FOLDER], compiler: COMPILER, work: join(WORK, 'library') });
    check(!built.error, `GCC ${COMPILER.version} and maspsx build it${built.error ? `: ${built.error}` : ''}`);
    if (built.error) return;
    const sizeOf = name => built.made.functions.find(f => f.name === name).size;
    check(sizeOf('LibTriple') >= TRIPLE.length * 4, `LibTriple as GCC builds it is ${sizeOf('LibTriple')} bytes, room for the hand-written one`);
    writeFileSync(join(FOLDER, 'library.json'), `${JSON.stringify({
      about: 'A made-up library, for the tools\' own test.',
      compilers: { ps1: COMPILER },
      functions: ['LibAdd', 'LibTwice', 'LibTriple'].map(name => [name, sizeOf(name), 'test-made-up-ps1.c']),
    }, null, 2).replace(/\[\n\s+"(\w+)",\n\s+(\d+),\n\s+"([\w.-]+)"\n\s+\]/g, '["$1", $2, "$3"]')}\n`);
    for (const game of GAMES) makeGame(game, built.made);
    const [first, second] = GAMES;
    writeFileSync(join(proofFolder(version(first)), 'libraries.json'), `${JSON.stringify({
      about: 'Where the made-up program has the library, as the test placed it.',
      libraries: { [LIBRARY]: { at: Object.fromEntries(Object.entries({ ...first.functions, ...first.values }).map(([name, address]) => [name, hexOf(address)])) } },
    }, null, 2)}\n`);
    let run = dp('libraries', '--check');
    check(run.status === 0, `libraries --check passes: ${last(run)}`);

    console.log('Proven in the first game, where its libraries.json says it is:');
    check(start(first), 'it keeps its proofs');
    run = dp('match', version(first));
    check(run.status === 0 && /2 of 3 functions the same/.test(run.out) && /The same {2}0x80010100 LibAdd/.test(run.out) && /Differs {3}0x80010300 LibTriple/.test(run.out),
      `match builds the library with its own compiler, and finds the two functions GCC gives back the same, and the hand-written one not: ${run.out.trim().split('\n').filter(line => /functions? the same/.test(line)).join(' ')}`);
    run = dp('twin', version(first), '--calls', '1000');
    const firstKinds = kinds(first);
    if (run.status !== 0 || firstKinds['80010300'] !== 'memory') console.log(run.out);
    check(run.status === 0 && firstKinds['80010100'] === 'bytes' && firstKinds['80010200'] === 'bytes' && firstKinds['80010300'] === 'memory',
      `twin proves the hand-written one by the same memory, with the library's values where the first game keeps them: ${JSON.stringify(firstKinds)}`);
    run = dp('libraries', version(first), '--hash');
    const hashes = Object.fromEntries(JSON.parse(readFileSync(join(FOLDER, 'library.json'), 'utf8')).functions.map(([name, , , hash]) => [name, hash ?? null]));
    check(run.status === 0 && /1 short hash written/.test(run.out) && /^[0-9a-f]{16}$/.test(hashes.LibTriple ?? '') && hashes.LibAdd === null,
      `--hash keeps the short hash of the one no compiler gives back, and only it: ${last(run)}`);
    check(dp('libraries', '--check').status === 0, 'which the rules allow');

    console.log('Found in the second, which says nothing of it:');
    run = dp('libraries', version(second), '--find');
    const file = join(proofFolder(version(second)), 'libraries.json');
    const found = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).libraries[LIBRARY]?.at : null;
    const expected = Object.fromEntries(Object.entries({ ...second.functions, ...second.values }).sort((a, b) => a[1] - b[1]).map(([name, address]) => [name, hexOf(address)]));
    if (run.status !== 0 || JSON.stringify(found) !== JSON.stringify(expected)) console.log(run.out);
    check(run.status === 0 && /3 of 3 functions found/.test(run.out) && JSON.stringify(found) === JSON.stringify(expected),
      `--find finds two by building them and one by its hash, not the one beside them that counts by two, and the values where the second game keeps them: ${JSON.stringify(found)}`);
    check(start(second), 'the second game keeps its proofs');
    run = dp('match', version(second));
    check(run.status === 0 && /2 of 3 functions the same/.test(run.out), `match proves the two there on its own copy: ${run.out.trim().split('\n').filter(line => /functions? the same/.test(line)).join(' ')}`);
    run = dp('twin', version(second), '--calls', '1000');
    if (run.status !== 0) console.log(run.out);
    const secondKinds = kinds(second);
    check(run.status === 0 && secondKinds['80010600'] === 'bytes' && secondKinds['80010400'] === 'bytes' && secondKinds['80010800'] === 'memory', `and twin the third: ${JSON.stringify(secondKinds)}`);
    run = dp('libraries');
    const line = run.out.split('\n').find(each => each.trim().startsWith(LIBRARY)) ?? '';
    check(/3 of 3 functions proven, taken by test-ps1-libraries-a\/c, test-ps1-libraries-b\/c/.test(line), `libraries counts it in the PlayStation's shared code: ${line.trim() || last(run)}`);
    run = dp('libraries', '--shared', first.name, second.name);
    check(run.status === 0 && /3 functions of test-ps1-libraries-a are in test-ps1-libraries-b too/.test(run.out) && /0x80010100  0x80010600 {2}\d+ bytes/.test(run.out), `--shared lists what the two copies share: ${last(run)}`);
    check(dp('libraries', '--check').status === 0, 'and every rule holds');

    console.log('A function whose instructions aren\'t the library\'s, placed by its file\'s order:');
    // the library's functions one after another, as a linker lays a file, and LibTwice with a bigger stack frame
    const third = { functions: { LibAdd: 0x80010100 }, values: { gLibTotal: 0x80012000, gLibCount: 0x80012004 } };
    third.functions.LibTwice = third.functions.LibAdd + sizeOf('LibAdd');
    third.functions.LibTriple = third.functions.LibTwice + sizeOf('LibTwice');
    const laid = programOf(built.made, third), twice = 0x800 + third.functions.LibTwice - LOAD;
    check(laid.exe.readUInt32LE(twice) >>> 16 === 0x27BD, 'LibTwice opens with its stack frame');
    laid.exe.writeUInt32LE(laid.exe.readUInt32LE(twice) - 8, twice);
    const library = readLibrary(LIBRARY);
    const placed = findLibrary({ library, files: library.files, built: await builtLibrary(library, compilerOf(library)), exe: laid.exe, codeMap: { functions: [...laid.sizes].map(([address, size]) => ({ address, size })) } });
    check(placed.functions.get('LibTwice') === third.functions.LibTwice && [...placed.unmatched].join() === 'LibTwice' && placed.functions.get('LibAdd') === third.functions.LibAdd && placed.functions.get('LibTriple') === third.functions.LibTriple && placed.values.get('gLibCount') === third.values.gLibCount,
      `--find puts it where the function before it in its file ends, and says its instructions aren't the library's: ${JSON.stringify(Object.fromEntries([...placed.functions].map(([name, address]) => [name, hexOf(address)])))}`);
    writeFileSync(SOURCE, TEXT.replace('extern int gLibCount;', 'extern int gLibCount; /* at D_80012004 */'));
    run = dp('libraries', '--check');
    check(run.status !== 0 && /names D_80012004, an address of a game/.test(run.out), `--check refuses a library that names a PlayStation address: ${last(run)}`);
    writeFileSync(SOURCE, TEXT);
  } finally {
    stopCompiler();
    tidy();
    if (copies) writeFileSync(COPIES, copies);
    else rmSync(COPIES, { force: true });
    rmSync(WORK, { recursive: true, force: true });
  }
  check(!existsSync(FOLDER) && GAMES.every(game => !existsSync(gameFolder(game.name))), 'nothing is left behind');
  check(tracked() === before, 'nothing the repository tracks has changed');
}

// a run that ends before its last check, as one whose process had nothing left to wait for would, fails
let finished = false;
process.on('exit', code => {
  if (!finished && code === 0) {
    console.log('\nThe test ended before its last check.');
    process.exitCode = 1;
  }
});
main().then(() => {
  finished = true;
  if (failures.length) {
    console.log(`\n${failures.length} check${failures.length === 1 ? '' : 's'} failed.`);
    process.exit(1);
  }
  console.log('\nA PlayStation library is proven in one game, found in another by building it and by its hash, and proven on that one\'s own copy.');
});
