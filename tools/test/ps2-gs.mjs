// npm run test:ps2-gs: what the GS can be asked to do, in the PlayStation 2's kit in C (kit/ps2/c/gs.c). Each program of
// made-up-ps2-gs.mjs runs on the console's real emulator, and its Dreamport in C (made-up-ps2-gs.c) does the same steps
// on the kit, in folders of their own that it removes after, so no game's copy is needed. Each is proven twice: by its
// draw list, every frame, which holds what it read back from the GS too, and by its pictures, pixel for pixel, where
// the emulator draws exactly:
//
// - the memory programs move pictures in in one format and read them in another, as textures and read back, and load
//   palettes every way, so their pictures are the kit's layout of the GS's memory against the emulator's, one into a
//   32-bit framebuffer and one into a 16-bit one. One whose Dreamport doesn't read back is found at once.
// - the events program reads what SIGNAL, FINISH and LABEL leave in CSR and SIGLBLID, IMR, and how often the GS's
//   interrupt came, and draws each value as a sprite's colour, so the draw list holds them all;
// - the modes program draws through context 2 by PRMODE, with FBMSK by whole bytes and with ZMSK.
//
// - the masks program keeps sprites off even or odd lines with SCANMSK, and bits of each channel with FBMSK, which the
//   emulator doesn't do exactly, so only its draw list is proven against it;
// - the buffers program reads a picture the GS drew, and its depths, as textures in other formats, and copies pictures
//   within memory in every order, which the emulator keeps on its graphics card, so again only its draw list is. One
//   that reads the drawn picture back too is the strict reference's alone;
// - the effects programs draw sprites in the fog, dithered and blended, and points at every sixteenth of a pixel, into
//   32 bits and into 16, by draw list against the emulator and by pictures against the strict reference.
//
// Where the emulator can't draw exactly, PCSX2's software renderer is the strict reference (gs-reference.mjs): every
// program's Dreamport is run on this computer too, PCSX2 replays what its GS got, and every frame's picture has to be
// the same, every bit of every pixel, alpha too.
//
// It isn't part of Check, as the emulators take minutes to build. On a Mac it leaves the strict reference out and says
// so, as PCSX2's runner is built on Linux alone so far (docs/CONSOLES.md).

import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder, resultFolder } from '../lib/paths.mjs';
import { startingEntry, startingFiles } from '../lib/new-game.mjs';
import { LOAD_AT } from './made-up-ps2.mjs';
import { madeUpPs2Buffers, madeUpPs2Effects, madeUpPs2Events, madeUpPs2Layout, madeUpPs2Masks, madeUpPs2Modes } from './made-up-ps2-gs.mjs';
import { strictCheck } from './gs-reference.mjs';

const GAMES = { layout32: 'test-ps2-gs-layout32', layout16: 'test-ps2-gs-layout16', events: 'test-ps2-gs-events', modes: 'test-ps2-gs-modes', masks: 'test-ps2-gs-masks', buffers: 'test-ps2-gs-buffers', effects32: 'test-ps2-gs-effects32', effects16: 'test-ps2-gs-effects16' };
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
// a step as the Dreamport's table has it: what it does and its two numbers (made-up-ps2-gs.c)
function asRow(step) {
  if (step.gif !== undefined) return [0, step.gif, step.qwords];
  if (step.read !== undefined) return [1, step.read, step.qwords];
  if (step.screen !== undefined) return [2, hex(step.screen), hex(step.value)];
  if (step.peek !== undefined) return [3, hex(step.peek), step.at];
  if (step.wait !== undefined) return [step.clear ? 5 : 4, hex(step.wait), hex(step.mask)];
  return [6, step.handler, step.counter];
}

// a program's Dreamport in C: made-up-ps2-gs.c with its memory and steps filled in, its reads left out when `noReads`
const writeGame = (game, made, options) => writeFileSync(join(gameFolder(inC(game)), 'src', 'main.c'), dreamportOf(made, options));
function dreamportOf(made, { noReads = false } = {}) {
  const keep = step => !(noReads && step.read !== undefined);
  const frames = made.frames.map(steps => steps.filter(keep));
  let first = 0;
  const numbers = {
    MEMORY: `{ ${made.blob.map(hex).join(', ')} }`, SHOWN: hex(made.shownFormat),
    START: table(made.start.map(asRow)),
    STEPS: table(frames.flat().map(asRow)),
    TURNS: table(frames.map(steps => [first, (first += steps.length, steps.length)])),
  };
  return readFileSync(join(REPO, 'tools', 'test', 'made-up-ps2-gs.c'), 'utf8').replace(/@([A-Z_0-9]+)@/g, (_, key) => numbers[key]);
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

// the game's Dreamport, or the C in `mainC`, against the strict reference, every frame, where it can be built: on Linux
const STRICT = process.platform === 'linux';
async function strictly(game, what, mainC = join(gameFolder(inC(game)), 'src', 'main.c')) {
  if (!STRICT) return console.log(`  left out: ${what}, against PCSX2's software renderer, which is built on Linux alone`);
  const work = join(WORK, `${game}-strict`), found = await strictCheck(mainC, FRAMES, work);
  check(found.same === found.frames, `${what}, against PCSX2's software renderer: ${found.same} of ${found.frames}, ${JSON.stringify(found.firstDifference)}`);
  check(found.agrees, 'and PCSX2 draws it the same whichever of the processor\'s instructions it uses, so it is an exact reference for it');
  return join(work, 'pictures.raw');
}

async function main() {
  tidy();
  mkdirSync(WORK, { recursive: true });

  console.log("The GS's memory, into a 32-bit framebuffer: pictures in every format, read in others, read back, and palettes");
  const layout = madeUpPs2Layout(32), original = setUp(GAMES.layout32, layout, 'draw lists');
  writeGame(GAMES.layout32, layout);
  proveBoth(GAMES.layout32, original, 'every format kept and read as the chip lays it out, every frame');
  await strictly(GAMES.layout32, 'every format kept and read as the chip lays it out');
  writeGame(GAMES.layout32, layout, { noReads: true });
  writeFileSync(join(proofFolder(GAMES.layout32), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
  const run = dp('prove', inC(GAMES.layout32), 'still'), found = report(GAMES.layout32);
  check(run.status !== 0 && found.firstDifference?.frame === 0, `a Dreamport that doesn't read back is found at once: ${JSON.stringify(found.firstDifference)}`);

  console.log("The GS's memory, into a 16-bit framebuffer: 16-bit pictures and palettes, in a row, in the buffer's places, and CLD");
  const layout16 = madeUpPs2Layout(16), original16 = setUp(GAMES.layout16, layout16, 'draw lists');
  writeGame(GAMES.layout16, layout16);
  proveBoth(GAMES.layout16, original16, 'every 16-bit format and palette as the chip has them, every frame');
  await strictly(GAMES.layout16, 'every 16-bit format and palette as the chip has them');

  console.log("The GS's status: SIGNAL, FINISH and LABEL, CSR, SIGLBLID, IMR and the GS's interrupt");
  const events = madeUpPs2Events(), originalEvents = setUp(GAMES.events, events, 'draw lists');
  writeGame(GAMES.events, events);
  proveBoth(GAMES.events, originalEvents, 'what CSR, SIGLBLID and IMR read, and how often the interrupt came, every frame');
  await strictly(GAMES.events, 'what CSR, SIGLBLID and IMR read, and how often the interrupt came');

  console.log('PRMODE and the masks: context 2, FBMSK and ZMSK');
  const modes = madeUpPs2Modes(), originalModes = setUp(GAMES.modes, modes, 'draw lists');
  writeGame(GAMES.modes, modes);
  proveBoth(GAMES.modes, originalModes, 'drawn with PRMODE, FBMSK and ZMSK as the emulator draws, every frame');
  await strictly(GAMES.modes, 'drawn with PRMODE, FBMSK and ZMSK');

  console.log('SCANMSK and FBMSK bit by bit, which the emulator does by whole bytes or not at all');
  const masks = madeUpPs2Masks(), originalMasks = setUp(GAMES.masks, masks, 'draw lists');
  writeGame(GAMES.masks, masks);
  const proven = dp('prove', inC(GAMES.masks), 'still'), masked = report(GAMES.masks);
  check(proven.status === 0 && masked.matched === FRAMES, `the same draw list as the original's, every frame: ${masked.matched} of ${masked.frames}, ${JSON.stringify(masked.firstDifference)}`);
  await strictly(GAMES.masks, 'drawn with SCANMSK and FBMSK bit by bit');

  console.log('What the GS drew read as textures in other formats, copies within memory, and the 16-bit depths');
  const buffers = madeUpPs2Buffers(), originalBuffers = setUp(GAMES.buffers, buffers, 'draw lists');
  writeGame(GAMES.buffers, buffers);
  const listed = dp('prove', inC(GAMES.buffers), 'still'), buffered = report(GAMES.buffers);
  check(listed.status === 0 && buffered.matched === FRAMES, `the same draw list as the original's, every frame: ${buffered.matched} of ${buffered.frames}, ${JSON.stringify(buffered.firstDifference)}`);
  await strictly(GAMES.buffers, 'a drawn picture and its depths as textures, and copies in every order');
  // and with the drawn picture read back, which the emulator can't do: what was read is drawn beside the picture itself
  const reading = madeUpPs2Buffers(true), mainC = join(WORK, 'buffers-read.c');
  writeFileSync(mainC, dreamportOf(reading));
  const pictures = await strictly(`${GAMES.buffers}-read`, 'the same with the drawn picture read back', mainC);
  if (pictures) {
    const raw = readFileSync(pictures), at = ([x, y], column, row) => raw.readUInt32LE(((y + row) * 640 + x + column) * 4);
    let same = 0;
    for (let row = 0; row < 32; row++) for (let column = 0; column < 64; column++) if (at(reading.places.back, column, row) === at(reading.places.itself, column, row)) same++;
    check(same === 64 * 32, `what was read back of the drawn picture is the picture, pixel for pixel: ${same} of ${64 * 32}`);
  }

  console.log('Fog, dithering and points');
  for (const [depth, game] of [[32, GAMES.effects32], [16, GAMES.effects16]]) {
    const effects = madeUpPs2Effects(depth);
    setUp(game, effects, 'draw lists');
    writeGame(game, effects);
    const run = dp('prove', inC(game), 'still'), found = report(game);
    check(run.status === 0 && found.matched === FRAMES, `into ${depth} bits, the same draw list as the original's, every frame: ${found.matched} of ${found.frames}, ${JSON.stringify(found.firstDifference)}`);
    await strictly(game, `fog, dithering and points into ${depth} bits`);
  }
}

const kept = { status: readFileSync(STATUS), copies: existsSync(COPIES) ? readFileSync(COPIES) : null };
const untouched = () => execFileSync('git', ['status', '--porcelain', '--', 'docs/STATUS.md', '.github/readme/progress', 'public/media', 'games'], { cwd: REPO, encoding: 'utf8' });
const dirtyBefore = untouched();
try {
  await main();
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
