// npm run test:ps2-disc: the PlayStation 2's disc drive in the kit in C (kit/ps2/c/cdvd.c), which answers the drive's RPC
// servers as the console's emulator does. A disc of the project's own (made-up-ps2-reads.mjs) runs on the real emulator,
// and its program's Dreamport in C (made-up-ps2-rpc.c) on the kit, reading the same disc, in a folder of its own that it
// removes after, so no game's copy is needed:
//
// - every frame's draw list carries what the drive's servers gave the program: the drive set up, the kind of disc, the
//   clock, the layers, the drive's status, the disc ready, a file found by its path with its sector and size and one
//   that isn't there, and each frame one of the file's sectors, a different one each frame, read into the EE's memory
//   when the drive's time for it has passed, with the clock, which moves on a second every sixty frames;
// - a Dreamport that reads the sector after the one asked for is found on its first frame.
//
// It isn't run on every pull request, as the emulator takes minutes to build, and on Linux, macOS and Windows (docs/CONSOLES.md).

import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder, resultFolder } from '../lib/paths.mjs';
import { startingEntry, startingFiles } from '../lib/new-game.mjs';
import { BACKGROUND, LOAD_AT, SQUARE, SQUARE_SIZE, SQUARE_Y } from './made-up-ps2.mjs';
import { madeUpPs2Reads } from './made-up-ps2-reads.mjs';

const GAME = 'test-ps2-disc';
const WORK = join(LOCAL, 'test-ps2-disc');
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
const inC = `${GAME}/c`;
const report = () => {
  const file = join(resultFolder(inC, 'still'), 'report.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
};
const hex = number => `0x${(number >>> 0).toString(16).toUpperCase()}`;

// the Dreamport in C: made-up-ps2-rpc.c with the program's tables filled in, or reading a sector on from the one asked
function writeGame(made, { wrongSector = false } = {}) {
  const numbers = {
    ...made.forC, LOAD_AT: hex(LOAD_AT), ELF_AT: made.sectors['MADE_UP.ELF'].at, ELF_SECTORS: made.sectors['MADE_UP.ELF'].count,
    BACKGROUND: hex(BACKGROUND), SQUARE: hex(SQUARE), SQUARE_Y, SQUARE_SIZE,
  };
  let code = readFileSync(join(REPO, 'tools', 'test', 'made-up-ps2-rpc.c'), 'utf8').replace(/@([A-Z_0-9]+)@/g, (_, key) => {
    if (numbers[key] === undefined) throw new Error(`made-up-ps2-rpc.c asks for ${key}, which the test doesn't fill in.`);
    return numbers[key];
  });
  if (wrongSector) code = code.replace('calls[n].base + (frame & calls[n].mask)', 'calls[n].base + ((frame + 1) & calls[n].mask)');
  writeFileSync(join(gameFolder(inC), 'src', 'main.c'), code);
}

function tidy() {
  const kept = readdirSync(MEDIA).filter(file => file.startsWith(GAME)).map(file => join(MEDIA, file));
  const made = [gameFolder(GAME), join(LOCAL, 'results', GAME), join(LOCAL, 'captures', GAME), join(REPO, '.github', 'readme', 'progress', `${GAME}.svg`)];
  for (const path of [...made, WORK, ...kept]) rmSync(path, { recursive: true, force: true });
}

function setUp(made) {
  const copy = join(WORK, `${GAME}.iso`);
  writeFileSync(copy, made.disc);
  const original = { console: 'ps2', name: `${GAME} (World)`, title: GAME, code: 'MADE_UP.ELF', sha1: createHash('sha1').update(made.disc).digest('hex'), provenBy: 'draw lists', keysAfterVBlank: true };
  mkdirSync(join(proofFolder(GAME), 'recordings'), { recursive: true });
  writeFileSync(join(proofFolder(GAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
  let run = dp('rom', copy);
  check(run.status === 0 && run.out.includes(GAME), `rom knows the disc: ${run.out.trim().split('\n')[1]?.trim()}`);
  const list = join(WORK, `${GAME}.csv`);
  writeFileSync(list, `Address,Size\n${LOAD_AT.toString(16)},${made.elf.length - 0x80}\n`);
  run = dp('codemap', GAME, '--from', list);
  check(run.status === 0, `codemap takes its one function from a list: ${run.out.trim().split('\n').at(-1)}`);
  const files = { ...startingFiles(GAME, original), 'entry.md': startingEntry(GAME, original, { issue: 1, lead: 'nobody', added: '2026-01-01' }) };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(gameFolder(GAME), file, '..'), { recursive: true });
    writeFileSync(join(gameFolder(GAME), file), text);
  }
  for (const [file, text] of Object.entries(startingFiles(GAME, original, { language: 'c' }))) {
    mkdirSync(join(gameFolder(inC), file, '..'), { recursive: true });
    writeFileSync(join(gameFolder(inC), file), text);
  }
  writeFileSync(join(proofFolder(GAME), 'recordings', 'still.json'), `${JSON.stringify({ about: 'Nothing held.', frames: FRAMES, held: [[0, []]] }, null, 2)}\n`);
}

function main() {
  tidy();
  mkdirSync(WORK, { recursive: true });
  console.log('A disc whose program asks the drive about it and reads a sector of a file each frame, and its Dreamport in C');
  const made = madeUpPs2Reads();
  setUp(made);
  writeGame(made);
  let run = dp('prove', inC, 'still');
  let found = report();
  check(run.status === 0 && found.matched === FRAMES, `the drive's servers give the Dreamport what the emulator's give the program, every frame: ${found.matched} of ${found.frames}, ${JSON.stringify(found.firstDifference)}, ${found.drawListApart ? `${found.drawListApart.original} against ${found.drawListApart.dreamport}` : ''}`);
  if (run.status) console.log(run.out);
  writeGame(made, { wrongSector: true });
  run = dp('prove', inC, 'still');
  found = report();
  check(run.status !== 0 && found.firstDifference?.frame === 0 && /^LABEL = /.test(found.drawListApart?.original ?? ''), `a Dreamport that reads the sector after is found at once, by the LABEL write that carries the sector's first word: ${found.drawListApart?.original} in the original, ${found.drawListApart?.dreamport} in the Dreamport`);
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
