// npm run test:nes-libraries: a shared library (tools/lib/libraries.mjs) on the NES, with a routine of the project's
// own as the library, so it needs nobody's copy of anything. The routine is put in two made-up programs (made-up-nes.mjs),
// at another place in each and keeping its total in another part of the work memory, as a developer's routine is in
// two of its games, and the second has one more routine of the same size beside it that does something else. The
// library sits in kit/nes/c/lib/ and each game in games/ for as long as this takes.
//
// What it shows: the first game takes the library through its libraries.json and `twin` proves it there by the same
// memory; `libraries --hash` keeps the routine's short hash; `libraries --find` finds it in the second game by that
// hash alone, and where that game keeps each value it names, from the first; `twin` proves it there too; and
// `libraries` counts it in the NES's shared code, with `--shared` listing what the two copies share.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { LOCAL, REPO, gameFolder, proofFolder } from '../lib/paths.mjs';
import { startingFiles } from '../lib/new-game.mjs';
import { formatCodeMap } from '../lib/proof-files.mjs';
import { sharedCode } from '../libraries.mjs';
import { madeUpUnrom } from './made-up-nes.mjs';

const LIBRARY = 'nes/test-made-up', FOLDER = join(REPO, 'kit', 'nes', 'c', 'lib', 'test-made-up');
const COPIES = join(LOCAL, 'copies.json'), work = join(LOCAL, 'tmp', 'nes-libraries-test');
// the library's twin: the routine below, with the work memory it keeps its total in named, not given
const TEXT = `// The tools' own made-up NES library, for npm run test:nes-libraries.

#include "nes.h"

#define RAM nes_ram

/** Adds A to a total of two bytes, counts the call, and gives back whether the low byte went past 255. */
// dp:twin lib_add_total lib_add_total(A) -> C
int lib_add_total(uint8_t amount) {
  uint16_t sum = (uint16_t)(RAM[ADDRESS_gLibLow] + amount);
  RAM[ADDRESS_gLibLow] = (uint8_t)sum;
  if (sum > 0xFF) RAM[ADDRESS_gLibHigh]++;
  RAM[ADDRESS_gLibCount]++;
  nes_spend(sum > 0xFF ? 26 : 22);
  return sum > 0xFF;
}
`;
// CLC, ADC low, STA low, BCC past the next, INC high, INC count, RTS: the routine, keeping its total at `at`
const routine = at => [0x18, 0x65, at, 0x85, at, 0x90, 0x02, 0xE6, at + 1, 0xE6, at + 2, 0x60];
// the two games: where each has the routine, its total, and in the second one more routine of its size that sets the carry first
const GAMES = [
  { name: 'test-nes-libraries-a', at: 0xC400, total: 0x20 },
  { name: 'test-nes-libraries-b', at: 0xC480, total: 0x40, other: 0xC4C0 },
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
const hexOf = n => n.toString(16).toUpperCase().padStart(8, '0');
const tidy = () => {
  rmSync(FOLDER, { recursive: true, force: true });
  for (const game of GAMES) for (const path of [gameFolder(game.name), join(LOCAL, 'twin', game.name)]) rmSync(path, { recursive: true, force: true });
};

// a made-up game with the routine where `game` says, in games/, with its copy, which rom knows
function makeGame(game) {
  const rom = Buffer.from(madeUpUnrom());
  // the program's last bank is at $C000, and an address there is that far into it
  const put = (address, bytes) => Buffer.from(bytes).copy(rom, 16 + 3 * 0x4000 + (address & 0x3FFF));
  put(game.at, routine(game.total));
  if (game.other) put(game.other, [0x38, ...routine(game.total).slice(1)]);
  const copy = join(work, `${game.name}.nes`);
  writeFileSync(copy, rom);
  const original = { console: 'nes', name: `Test ${game.name} (World)`, title: 'library', code: '', sha1: createHash('sha1').update(rom).digest('hex') };
  mkdirSync(proofFolder(game.name), { recursive: true });
  writeFileSync(join(proofFolder(game.name), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
  // the code map numbers a function by where it is in the program: the last bank's $C400 is 0xC400 in four banks
  const offset = address => 3 * 0x4000 + (address & 0x3FFF);
  writeFileSync(join(proofFolder(game.name), 'code-map.json'), formatCodeMap({
    original: original.sha1, from: 'The test\'s own placing',
    functions: [game.at, game.other].filter(Boolean).map(address => ({ address: offset(address), size: 12 })).sort((a, b) => a.address - b.address),
  }));
  mkdirSync(join(gameFolder(version(game)), 'src'), { recursive: true });
  mkdirSync(proofFolder(version(game)), { recursive: true });
  writeFileSync(join(gameFolder(version(game)), 'index.html'), startingFiles(game.name, original, { language: 'c' })['index.html']);
  writeFileSync(join(gameFolder(version(game)), 'src', 'main.c'), '// The game\'s own C, which has none of the library in it.\n\n#include "nes.h"\n');
  const run = dp('rom', copy);
  check(run.status === 0 && run.out.includes(game.name), `rom knows ${game.name}'s copy`);
}

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
tidy();
try {
  console.log('A library of the project\'s own, in kit/nes/c/lib/ for as long as this takes:');
  mkdirSync(FOLDER, { recursive: true });
  writeFileSync(join(FOLDER, 'test-made-up-nes.c'), TEXT);
  writeFileSync(join(FOLDER, 'NOTICE.md'), 'Written for the tools\' own test, from nothing but itself.\n');
  writeFileSync(join(FOLDER, 'library.json'), `{\n  "about": "A made-up library, for the tools' own test.",\n  "functions": [\n    ["lib_add_total", 12, "test-made-up-nes.c"]\n  ]\n}\n`);
  for (const game of GAMES) makeGame(game);
  const [first, second] = GAMES;
  writeFileSync(join(proofFolder(version(first)), 'libraries.json'), `${JSON.stringify({
    about: 'Where the made-up program has the library, as the test placed it.',
    libraries: { [LIBRARY]: { at: { gLibLow: hexOf(first.total), gLibHigh: hexOf(first.total + 1), gLibCount: hexOf(first.total + 2), lib_add_total: hexOf(first.at) } } },
  }, null, 2)}\n`);
  let run = dp('libraries', '--check');
  check(run.status === 0, `libraries --check passes: ${last(run)}`);

  console.log('Proven in the first game, where its libraries.json says it is:');
  check(dp('proofs', version(first), '--start').status === 0, 'it keeps its proofs');
  run = dp('twin', version(first), '--calls', '1000');
  check(run.status === 0 && /1 function kept as proven by the same memory/.test(run.out), `twin proves the library's routine, its total where the first game keeps it: ${last(run)}`);
  run = dp('libraries', version(first), '--hash');
  const hash = JSON.parse(readFileSync(join(FOLDER, 'library.json'), 'utf8')).functions[0][3];
  check(run.status === 0 && /1 short hash written/.test(run.out) && /^[0-9a-f]{16}$/.test(hash ?? ''), `--hash keeps the routine's short hash, as no compiler rebuilds NES code: ${last(run)}`);
  check(dp('libraries', '--check').status === 0, 'which the rules allow');

  console.log('Found in the second, by its hash alone:');
  run = dp('libraries', version(second), '--find');
  const found = existsSync(join(proofFolder(version(second)), 'libraries.json')) ? JSON.parse(readFileSync(join(proofFolder(version(second)), 'libraries.json'), 'utf8')).libraries[LIBRARY]?.at : null;
  const expected = { gLibLow: hexOf(second.total), gLibHigh: hexOf(second.total + 1), gLibCount: hexOf(second.total + 2), lib_add_total: hexOf(second.at) };
  check(run.status === 0 && /1 of 1 function found/.test(run.out) && JSON.stringify(found) === JSON.stringify(expected), `--find finds the routine and not the one beside it of its size, and its total where the second game keeps it: ${JSON.stringify(found)}`);
  check(dp('proofs', version(second), '--start').status === 0, 'the second game keeps its proofs');
  run = dp('twin', version(second), '--calls', '1000');
  check(run.status === 0 && /1 function kept as proven by the same memory/.test(run.out), `and twin proves the library there, on its own copy: ${last(run)}`);
  run = dp('libraries');
  check(/NES: 100% of its known shared code proven, 12 of 12 bytes and 1 of 1 function, in 1 library, taken by 2 games/.test(run.out), `libraries counts it in the NES's shared code: ${run.out.trim().split('\n').find(line => line.startsWith('NES')) ?? last(run)}`);
  check(JSON.stringify(sharedCode().find(each => each.id === 'nes')?.libraries[0].cells.map(cell => cell.state)) === '["memory"]', 'and its map shows it proven by the same memory');
  run = dp('libraries', '--shared', first.name, second.name);
  check(run.status === 0 && /1 function of test-nes-libraries-a is in test-nes-libraries-b too/.test(run.out) && /0x0000C400  0x0000C480  12 bytes/.test(run.out), `--shared lists what the two copies share: ${last(run)}`);
  check(dp('libraries', '--check').status === 0, 'and every rule holds');
} finally {
  tidy();
  if (copies) writeFileSync(COPIES, copies);
  else rmSync(COPIES, { force: true });
}

if (failures.length) {
  console.log(`\n${failures.length} check${failures.length === 1 ? '' : 's'} failed.`);
  process.exit(1);
}
console.log('\nA routine of one NES game is found in another by its short hash, and proven on that one\'s own copy.');
