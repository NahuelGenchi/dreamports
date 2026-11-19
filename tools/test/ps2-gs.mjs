// npm run test:ps2-gs: what the GS can be asked to do, in the PlayStation 2's kit in C (kit/ps2/c/gs.c). Each program of
// made-up-ps2-gs.mjs runs on the console's real emulator, and its Dreamport in C (made-up-ps2-gs.c) does the same steps
// on the kit, in folders of their own that it removes after, so no game's copy is needed. Each is proven twice: by its
// draw list, every frame, which holds what it read back from the GS too, and by its pictures, pixel for pixel, where
// the emulator draws exactly:
//
// - the memory programs move pictures in in one format and read them in another, as textures and read back, and load
//   palettes every way, so their pictures are the kit's layout of the GS's memory against the emulator's, one into a
//   32-bit framebuffer and one into a 16-bit one. One whose Dreamport doesn't read back is found at once.
//
// It isn't run on every pull request, as the emulator takes minutes to build, and on Linux and macOS alone (docs/CONSOLES.md).

import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder, resultFolder } from '../lib/paths.mjs';
import { startingEntry, startingFiles } from '../lib/new-game.mjs';
import { LOAD_AT } from './made-up-ps2.mjs';
import { madeUpPs2Layout } from './made-up-ps2-gs.mjs';

const GAMES = { layout32: 'test-ps2-gs-layout32', layout16: 'test-ps2-gs-layout16' };
const WORK = join(LOCAL, 'test-ps2-gs');
const COPIES = join(LOCAL, 'copies.json');
const STATUS = join(REPO, 'docs', 'STATUS.md');
const MEDIA = join(REPO, 'public', 'media');
const FRAMES = 300;

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};

const dp = (...args) => {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 26 });
  return { status, out: stdout + stderr };
};
const inC = game => `${game}/c`;
const report = game => {
  const file = join(resultFolder(inC(game), 'still'), 'report.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
};
const hex = number => `0x${(number >>> 0).toString(16).toUpperCase()}`;
const table = rows => `{ ${rows.map(row => `{ ${row.join(', ')} }`).join(', ')} }`;
const KIND = { gif: 0, read: 1, screen: 2 };
const asRow = step => step.screen !== undefined ? [KIND.screen, hex(step.screen), hex(step.value)] : step.read !== undefined ? [KIND.read, step.read, step.qwords] : [KIND.gif, step.gif, step.qwords];

// a program's Dreamport in C: made-up-ps2-gs.c with its memory and steps filled in, its reads left out when `noReads`
function writeGame(game, made, { noReads = false } = {}) {
  const keep = step => !(noReads && step.read !== undefined);
  const frames = made.frames.map(steps => steps.filter(keep));
  let first = 0;
  const numbers = {
    MEMORY: `{ ${made.blob.map(hex).join(', ')} }`, SHOWN: hex(made.shownFormat),
    START: table(made.start.map(asRow)),
    STEPS: table(frames.flat().map(asRow)),
    TURNS: table(frames.map(steps => [first, (first += steps.length, steps.length)])),
  };
  const code = readFileSync(join(REPO, 'tools', 'test', 'made-up-ps2-gs.c'), 'utf8').replace(/@([A-Z_0-9]+)@/g, (_, key) => numbers[key]);
  writeFileSync(join(gameFolder(inC(game)), 'src', 'main.c'), code);
}

function tidy() {
  const kept = existsSync(MEDIA) ? readdirSync(MEDIA).filter(file => Object.values(GAMES).some(game => file.startsWith(game))).map(file => join(MEDIA, file)) : [];
  const made = Object.values(GAMES).flatMap(game => [gameFolder(game), join(LOCAL, 'results', game), join(LOCAL, 'captures', game), join(REPO, '.github', 'readme', 'progress', `${game}.svg`)]);
  for (const path of [...made, WORK, ...kept]) rmSync(path, { recursive: true, force: true });
}

// a game of its own for a program: its copy known to `rom`, a code map of its one function, what `new` writes, in
// JavaScript and in C, and a recording that holds nothing
function setUp(game, { elf, sha1 }, provenBy) {
  const copy = join(WORK, `${game}.elf`);
  writeFileSync(copy, elf);
  const original = { console: 'ps2', name: `${game} (World)`, title: game, code: '', sha1, provenBy };
  mkdirSync(join(proofFolder(game), 'recordings'), { recursive: true });
  writeFileSync(join(proofFolder(game), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
  let run = dp('rom', copy);
  check(run.status === 0 && run.out.includes(game), `rom knows ${game}'s copy: ${run.out.trim().split('\n')[1]?.trim()}`);
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

// proves the game's Dreamport by draw lists and then by pictures, and says what each found
function proveBoth(game, original, what) {
  const found = {};
  for (const provenBy of ['draw lists', 'pictures']) {
    writeFileSync(join(proofFolder(game), 'original.json'), `${JSON.stringify({ ...original, provenBy }, null, 2)}\n`);
    const run = dp('prove', inC(game), 'still');
    found[provenBy] = report(game);
    check(run.status === 0 && found[provenBy].matched === FRAMES, `${what}, by ${provenBy}: ${found[provenBy].matched} of ${found[provenBy].frames}, ${JSON.stringify(found[provenBy].firstDifference)}`);
    if (run.status) console.log(run.out.split('\n').slice(-25).join('\n'));
  }
  return found;
}

function main() {
  tidy();
  mkdirSync(WORK, { recursive: true });

  console.log("The GS's memory, into a 32-bit framebuffer: pictures in every format, read in others, read back, and palettes");
  const layout = madeUpPs2Layout(32), original = setUp(GAMES.layout32, layout, 'draw lists');
  writeGame(GAMES.layout32, layout);
  proveBoth(GAMES.layout32, original, 'every format kept and read as the chip lays it out, every frame');
  writeGame(GAMES.layout32, layout, { noReads: true });
  writeFileSync(join(proofFolder(GAMES.layout32), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
  const run = dp('prove', inC(GAMES.layout32), 'still'), found = report(GAMES.layout32);
  check(run.status !== 0 && found.firstDifference?.frame === 0, `a Dreamport that doesn't read back is found at once: ${JSON.stringify(found.firstDifference)}`);

  console.log("The GS's memory, into a 16-bit framebuffer: 16-bit pictures and palettes, in a row, in the buffer's places, and CLD");
  const layout16 = madeUpPs2Layout(16), original16 = setUp(GAMES.layout16, layout16, 'draw lists');
  writeGame(GAMES.layout16, layout16);
  proveBoth(GAMES.layout16, original16, 'every 16-bit format and palette as the chip has them, every frame');
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
