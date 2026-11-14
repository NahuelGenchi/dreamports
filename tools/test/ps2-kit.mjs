// npm run test:ps2-kit: the PlayStation 2's kit in C (kit/ps2/c/) and `prove` on a game proven by draw lists, as a 3D
// game is (docs/STANDARD.md). The small programs of made-up-ps2.mjs run on the console's real emulator, and their
// Dreamports in C (made-up-ps2.c) on the kit, in folders of their own that it removes after, so no game's copy is needed:
//
// - the one in three dimensions is proven by its draw list, every frame, and one that does its sums with a computer's
//   rounding is found out;
// - the one whose shapes a program on vector unit 1 makes is proven by its draw list too, its Dreamport being that program
//   written again in C with the kit's GIF and the unit's sums;
// - the textured one, whose Dreamport sends the same packets, is proven by its pictures, which is the kit's textures,
//   palettes, blending and 16-bit framebuffer against the emulator's;
// - the flat one is proven by its pictures, pixel for pixel, which is the kit's own drawing against the emulator's.
//
// It isn't run on every pull request, as the emulator takes minutes to build, and on Linux alone (docs/CONSOLES.md).

import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder, resultFolder } from '../lib/paths.mjs';
import { startingEntry, startingFiles } from '../lib/new-game.mjs';
import { BACKGROUND, BACKGROUND_3D, COS, LOAD_AT, MIDDLE, RADIUS, SIN, SQUARE, SQUARE_SIZE, SQUARE_Y, STEP, STILL, TURNING, CORNERS, CORNER_DEPTH, DEPTH_ACROSS, VU1_TAG, UPLOAD, FRAME_PACKET, MOVING_AT, MOVING_Y, madeUpPs2, madeUpPs2In3d, madeUpPs2OnVu1, madeUpPs2Textured } from './made-up-ps2.mjs';

const GAMES = { solid: 'test-ps2-3d', flat: 'test-ps2-flat', vu1: 'test-ps2-vu1', textured: 'test-ps2-textured' };
const WORK = join(LOCAL, 'test-ps2-kit');
const COPIES = join(LOCAL, 'copies.json');
const STATUS = join(REPO, 'docs', 'STATUS.md');
const MEDIA = join(REPO, 'public', 'media');
const FRAMES = 300;

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
const said = what => console.log(`  found: ${what}`);

const dp = (...args) => {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 26 });
  return { status, out: stdout + stderr };
};
const inC = game => `${game}/c`;
// a recording's report, or nothing to go on when prove stopped before writing one
const report = game => {
  const file = join(resultFolder(inC(game), 'still'), 'report.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
};
const hex = number => `0x${(number >>> 0).toString(16).toUpperCase()}`;
const bitsOf = float => new Uint32Array(new Float32Array([float]).buffer)[0];
const table = rows => `{ ${rows.map(row => `{ ${row.map(hex).join(', ')} }`).join(', ')} }`;

// a program's Dreamport in C: made-up-ps2.c with the program's numbers filled in
function writeGame(game, { plainSums = false } = {}) {
  const numbers = {
    PROGRAM: { [GAMES.solid]: 'IN_3D', [GAMES.vu1]: 'ON_VU1', [GAMES.textured]: 'TEXTURED' }[game] ?? 'FLAT', SHOWN_FORMAT: game === GAMES.textured ? '0xA' : '0',
    UPLOAD: `{ ${UPLOAD.map(hex).join(', ')} }`, FRAME_PACKET: `{ ${FRAME_PACKET.map(hex).join(', ')} }`, MOVING_AT, MOVING_Y, PLAIN_SUMS: plainSums ? 1 : 0, RADIUS, COS_BITS: hex(bitsOf(COS)), SIN_BITS: hex(bitsOf(SIN)), MIDDLE_X: MIDDLE[0], MIDDLE_Y: MIDDLE[1],
    CORNER_COUNT: CORNERS.length, PLACES: `{ ${CORNERS.map(([x, y]) => `{ ${x}, ${y}, ${CORNER_DEPTH}, 1 }`).join(', ')} }`, COLOURS: table(CORNERS.map(([, , ...colour]) => [...colour, 0x80])),
    DEPTH_ACROSS: `${DEPTH_ACROSS}f`, VU1_TAG: `{ ${VU1_TAG.map(hex).join(', ')} }`,
    STILL: table(STILL), TURNING: table(TURNING), BACKGROUND_3D: hex(BACKGROUND_3D), BACKGROUND: hex(BACKGROUND), SQUARE: hex(SQUARE), SQUARE_Y, SQUARE_SIZE, STEP,
  };
  const code = readFileSync(join(REPO, 'tools', 'test', 'made-up-ps2.c'), 'utf8').replace(/@([A-Z_0-9]+)@/g, (_, key) => numbers[key]);
  writeFileSync(join(gameFolder(inC(game)), 'src', 'main.c'), code);
}

function tidy() {
  const kept = readdirSync(MEDIA).filter(file => Object.values(GAMES).some(game => file.startsWith(game))).map(file => join(MEDIA, file));
  const made = Object.values(GAMES).flatMap(game => [gameFolder(game), join(LOCAL, 'results', game), join(LOCAL, 'captures', game), join(REPO, '.github', 'readme', 'progress', `${game}.svg`)]);
  for (const path of [...made, WORK, ...kept]) rmSync(path, { recursive: true, force: true });
}

// a game of its own for a program: its copy known to `rom`, a code map of its one function, what `new` writes, in
// JavaScript and in C, and a recording that holds nothing
function setUp(game, { elf, sha1 }, more = {}) {
  const copy = join(WORK, `${game}.elf`);
  writeFileSync(copy, elf);
  const original = { console: 'ps2', name: `${game} (World)`, title: game, code: '', sha1, ...more };
  mkdirSync(join(proofFolder(game), 'recordings'), { recursive: true });
  writeFileSync(join(proofFolder(game), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
  let run = dp('rom', copy);
  check(run.status === 0 && run.out.includes(game), `rom knows ${game}'s copy, a program for the console's processor: ${run.out.trim().split('\n')[1]?.trim()}`);
  const list = join(WORK, `${game}.csv`);
  writeFileSync(list, `Address,Size\n${LOAD_AT.toString(16)},${elf.length - 0x80}\n`);
  run = dp('codemap', game, '--from', list);
  check(run.status === 0, `codemap takes its one function from a list: ${run.out.trim().split('\n').at(-1)}`);
  const files = { ...startingFiles(game, original), 'entry.md': startingEntry(game, original, { issue: 1, lead: 'nobody', added: '2026-01-01' }) };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(gameFolder(game), file, '..'), { recursive: true });
    writeFileSync(join(gameFolder(game), file), text);
  }
  for (const [file, text] of Object.entries(startingFiles(game, original, { language: 'c' }))) {
    mkdirSync(join(gameFolder(inC(game)), file, '..'), { recursive: true });
    writeFileSync(join(gameFolder(inC(game)), file), text);
  }
  writeFileSync(join(proofFolder(game), 'recordings', 'still.json'), `${JSON.stringify({ about: 'Nothing held.', frames: FRAMES, held: [[0, []]] }, null, 2)}\n`);
  return original;
}

function main() {
  tidy();
  mkdirSync(WORK, { recursive: true });

  console.log('A 3D program and its Dreamport in C, proven by draw lists');
  const solid = setUp(GAMES.solid, madeUpPs2In3d(), { provenBy: 'draw lists' });
  let run = dp('prove', inC(GAMES.solid), 'still');
  if (!report(GAMES.solid).frames) console.log(run.out);
  check(run.status !== 0 && report(GAMES.solid).firstDifference?.frame === 0, `what new writes in C, one sprite over the screen, isn't the program's draw list, and differs at once: ${JSON.stringify(report(GAMES.solid).firstDifference)}`);
  writeGame(GAMES.solid);
  run = dp('prove', inC(GAMES.solid), 'still');
  let found = report(GAMES.solid);
  check(run.status === 0 && found.matched === FRAMES, `the Dreamport gives the GS what the original does, bit for bit, every frame: ${found.matched} of ${found.frames}, ${JSON.stringify(found.firstDifference)}`);
  if (run.status) console.log(run.out);
  writeGame(GAMES.solid, { plainSums: true });
  run = dp('prove', inC(GAMES.solid), 'still');
  found = report(GAMES.solid);
  check(run.status !== 0 && found.firstDifference?.frame > 0, `one sum done with a computer's rounding, not the console's, is found: at frame ${found.firstDifference?.frame}`);
  writeGame(GAMES.solid);

  // the same Dreamport measured by its pictures, to say how far the kit's triangles are from the emulator's
  writeFileSync(join(proofFolder(GAMES.solid), 'original.json'), `${JSON.stringify({ ...solid, provenBy: undefined }, null, 2)}\n`);
  run = dp('prove', inC(GAMES.solid), 'still');
  found = report(GAMES.solid);
  said(`by its pictures the same Dreamport matches ${found.matched} of ${found.frames} frames, as the kit shades a triangle its own way: ${JSON.stringify(found.firstDifference)}`);

  console.log('A program whose shapes come from vector unit 1, and its Dreamport in C, proven by draw lists');
  setUp(GAMES.vu1, madeUpPs2OnVu1(), { provenBy: 'draw lists' });
  writeGame(GAMES.vu1);
  run = dp('prove', inC(GAMES.vu1), 'still');
  found = report(GAMES.vu1);
  check(run.status === 0 && found.matched === FRAMES, `the unit's program written again in C, with the kit's GIF and the unit's sums, gives the GS what the original does, every frame: ${found.matched} of ${found.frames}, ${JSON.stringify(found.firstDifference)}`);
  if (run.status) console.log(run.out);
  writeGame(GAMES.vu1, { plainSums: true });
  run = dp('prove', inC(GAMES.vu1), 'still');
  found = report(GAMES.vu1);
  check(run.status !== 0 && found.firstDifference?.frame >= 0, `a division done with a computer's rounding, not the unit's, is found: at frame ${found.firstDifference?.frame}`);

  console.log('Textured sprites in a 16-bit framebuffer, and their Dreamport in C, proven by their pictures');
  setUp(GAMES.textured, madeUpPs2Textured());
  writeGame(GAMES.textured);
  run = dp('prove', inC(GAMES.textured), 'still');
  found = report(GAMES.textured);
  check(run.status === 0 && found.matched === FRAMES, `the kit moves pictures into its memory, loads palettes and draws textures, decals, blending and the alpha test as the emulator does, pixel for pixel, every frame: ${found.matched} of ${found.frames}, ${JSON.stringify(found.firstDifference)}`);
  if (run.status) console.log(run.out);

  console.log('A flat program and its Dreamport in C, proven by its pictures');
  setUp(GAMES.flat, madeUpPs2());
  writeGame(GAMES.flat);
  run = dp('prove', inC(GAMES.flat), 'still');
  found = report(GAMES.flat);
  check(run.status === 0 && found.matched === FRAMES, `the kit draws its sprites as the emulator does, pixel for pixel, every frame: ${found.matched} of ${found.frames}, ${JSON.stringify(found.firstDifference)}`);
  if (run.status) console.log(run.out);
}

const kept = { status: readFileSync(STATUS), copies: existsSync(COPIES) ? readFileSync(COPIES) : null };
const untouched = () => execFileSync('git', ['status', '--porcelain', '--', 'docs/STATUS.md', '.github/readme/progress', 'public/media', 'games'], { cwd: REPO, encoding: 'utf8' });
const dirtyBefore = untouched();
try {
  main();
} finally {
  tidy();
  writeFileSync(STATUS, kept.status);
  if (kept.copies) writeFileSync(COPIES, kept.copies);
  else rmSync(COPIES, { force: true });
}
check(untouched() === dirtyBefore, 'nothing is left behind');

if (failures.length) {
  console.log(`\n${failures.length} failed.`);
  process.exit(1);
}
console.log('\nAll passed.');
process.exit(0);
