// npm run test:ps2-iop-time: the IOP's own time in the PlayStation 2's kit in C (kit/ps2/c/iop-bios.c), for a twin
// whose original's code takes long enough for it to count, as one that waits in a loop between its writes to the sound
// chip. The timed program of made-up-ps2-iop.mjs, whose EE loads a module of its own on the IOP through the SIF, runs on
// the console's real emulator, and its Dreamport in C (made-up-ps2-iop-time.c) on the kit, in a folder of its own that
// it removes after, so no game's copy is needed:
//
// - every frame's sound list is the module's: its thread writes the chip as it wakes, after a wait of about 40 of the
//   emulator's slices, which a block of samples comes in about half the time, and every 50 frames after a wait of a
//   frame and a half, which the next V-blank comes in, so the thread misses it and wakes a frame later than before.
//   The twin says how many of the IOP's ticks the module's code took (iop_time_pass), and each write comes before the
//   same block of samples, in the same frame;
// - a Dreamport that says nothing of the IOP's time is found by its sound list, as its writes come all at once;
// - one whose long wait is a frame short is found by its sound list on the frame its write comes too early in.
//
// It isn't run on every pull request, as the emulator takes minutes to build, and on Linux and macOS alone (docs/CONSOLES.md).

import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder, resultFolder } from '../lib/paths.mjs';
import { startingEntry, startingFiles } from '../lib/new-game.mjs';
import { BACKGROUND, LOAD_AT, SQUARE, SQUARE_SIZE, SQUARE_Y } from './made-up-ps2.mjs';
import * as sound from './made-up-ps2-iop.mjs';

const GAME = 'test-ps2-iop-time';
const WORK = join(LOCAL, 'test-ps2-iop-time');
const COPIES = join(LOCAL, 'copies.json');
const STATUS = join(REPO, 'docs', 'STATUS.md');
const MEDIA = join(REPO, 'public', 'media');
const FRAMES = 300;
// the IOP's ticks in a frame, about: 1,025 of the emulator's slices of 600, in times round the module's loop of three
const FRAME_OF_WAIT = Math.round(1025 * 600 / 3);

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
const report = (recording = 'still') => {
  const file = join(resultFolder(inC(GAME), recording), 'report.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
};
const hex = number => `0x${(number >>> 0).toString(16).toUpperCase()}`;

// the Dreamport in C: made-up-ps2-iop-time.c with the program's numbers filled in, saying nothing of the IOP's time, or
// with its long wait a frame short
function writeGame({ untimed = false, frameShort = false } = {}) {
  const { R } = sound, { places } = sound.madeUpPs2Sound({ timed: true });
  const numbers = {
    SHORT_WAIT: sound.SHORT_WAIT, LONG_WAIT: sound.LONG_WAIT, TIMED_EVERY: sound.TIMED_EVERY, TIMED_AT: sound.TIMED_AT,
    LONG_WAIT_TAKEN: frameShort ? `(LONG_WAIT - ${FRAME_OF_WAIT})` : 'LONG_WAIT',
    MARK_0: hex(sound.TIMED_MARKS[0]), MARK_1: hex(sound.TIMED_MARKS[1]), MARK_2: hex(sound.TIMED_MARKS[2]), NOTE: hex(R.NOTE),
    KEEP_TIME: untimed ? '' : '  iop_keep_time();',
    LOAD_AT: hex(LOAD_AT), REPLY: hex(places.reply), RECEIVED: hex(places.received), SIF_REND: hex(sound.SIF_REND),
    INIT_TRANSFERS: hex(places.initTransfers), IRX_TRANSFERS: hex(places.irxTransfers), BIND_TRANSFERS: hex(places.bindTransfers), CALL_TRANSFERS: hex(places.callTransfers),
    LABEL_ENUM: sound.LABEL_NAMES.map(name => name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')).join(', '),
    BACKGROUND: hex(BACKGROUND), SQUARE: hex(SQUARE), SQUARE_Y, SQUARE_SIZE,
  };
  let code = readFileSync(join(REPO, 'tools', 'test', 'made-up-ps2-iop-time.c'), 'utf8').replace(/@([A-Z_0-9]+)@/g, (_, key) => {
    if (numbers[key] === undefined) throw new Error(`made-up-ps2-iop-time.c asks for ${key}, which the test doesn't fill in.`);
    return numbers[key];
  });
  // a twin that says nothing of the time its module's code takes
  if (untimed) code = code.replace(/^ *iop_time_pass\(.*\n/gm, '');
  writeFileSync(join(gameFolder(inC(GAME)), 'src', 'main.c'), code);
}

function tidy() {
  const kept = readdirSync(MEDIA).filter(file => file.startsWith(GAME)).map(file => join(MEDIA, file));
  const made = [gameFolder(GAME), join(LOCAL, 'results', GAME), join(LOCAL, 'captures', GAME), join(REPO, '.github', 'readme', 'progress', `${GAME}.svg`)];
  for (const path of [...made, WORK, ...kept]) rmSync(path, { recursive: true, force: true });
}

// the program as a game of its own: its copy known to `rom`, a code map of its one function, what `new` writes, in
// JavaScript and in C, and a recording that holds nothing
function setUp({ elf, sha1 }) {
  const copy = join(WORK, `${GAME}.elf`);
  writeFileSync(copy, elf);
  const original = { console: 'ps2', name: `${GAME} (World)`, title: GAME, code: '', sha1, provenBy: 'draw lists', keysAfterVBlank: true };
  mkdirSync(join(proofFolder(GAME), 'recordings'), { recursive: true });
  writeFileSync(join(proofFolder(GAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
  let run = dp('rom', copy);
  check(run.status === 0 && run.out.includes(GAME), `rom knows the program's copy: ${run.out.trim().split('\n')[1]?.trim()}`);
  const list = join(WORK, `${GAME}.csv`);
  writeFileSync(list, `Address,Size\n${LOAD_AT.toString(16)},${elf.length - 0x80}\n`);
  run = dp('codemap', GAME, '--from', list);
  check(run.status === 0, `codemap takes its one function from a list: ${run.out.trim().split('\n').at(-1)}`);
  const files = { ...startingFiles(GAME, original), 'entry.md': startingEntry(GAME, original, { issue: 1, lead: 'nobody', added: '2026-01-01' }) };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(gameFolder(GAME), file, '..'), { recursive: true });
    writeFileSync(join(gameFolder(GAME), file), text);
  }
  for (const [file, text] of Object.entries(startingFiles(GAME, original, { language: 'c' }))) {
    mkdirSync(join(gameFolder(inC(GAME)), file, '..'), { recursive: true });
    writeFileSync(join(gameFolder(inC(GAME)), file), text);
  }
  writeFileSync(join(proofFolder(GAME), 'recordings', 'still.json'), `${JSON.stringify({ about: 'Nothing held.', frames: FRAMES, held: [[0, []]] }, null, 2)}\n`);
}

function main() {
  tidy();
  mkdirSync(WORK, { recursive: true });

  console.log('A program whose own IOP module waits in loops between its writes to the SPU2, and its Dreamport in C');
  setUp(sound.madeUpPs2Sound({ timed: true }));
  writeGame();
  let run = dp('prove', inC(GAME), 'still');
  let found = report();
  check(run.status === 0 && found.matched === FRAMES && !found.sound?.differs?.length,
    `each of the module's writes comes before the same block of samples and in the same frame as the emulator's, every frame: ${found.matched} of ${found.frames}, ${JSON.stringify(found.firstDifference)}, sound ${JSON.stringify(found.sound?.firstDifference ?? null)}`);
  if (run.status) console.log(run.out);

  writeGame({ untimed: true });
  run = dp('prove', inC(GAME), 'still');
  found = report();
  const untimed = found.sound?.firstDifference;
  check(run.status !== 0 && untimed?.by === 'list', `a Dreamport that says nothing of the IOP's time is found by its sound list: ${JSON.stringify(untimed)}`);

  writeGame({ frameShort: true });
  run = dp('prove', inC(GAME), 'still');
  found = report();
  const short = found.sound?.firstDifference;
  // the thread's frames are the recording's, and its long wait's write comes in the frame after the one it woke in, or
  // in that one when the wait is a frame short
  check(run.status !== 0 && short?.by === 'list' && short.frame === sound.TIMED_AT,
    `one whose long wait is a frame short is found by its sound list on the frame its write comes too early in: ${JSON.stringify(short)}`);
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
