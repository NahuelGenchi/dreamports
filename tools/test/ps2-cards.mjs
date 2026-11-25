// npm run test:ps2-cards: the PlayStation 2's memory cards in the kit in C (kit/ps2/c/mc.c), which answers the memory
// cards' RPC server as the console's emulator does. A disc of the project's own (made-up-ps2-cards.mjs) runs on the real
// emulator, and its program's Dreamport in C (made-up-ps2-rpc.c) on the kit, in a folder of its own that it removes
// after, so no game's copy is needed:
//
// - every frame's draw list carries what the server gave the program: the server set up, a card found and found again,
//   folders made and gone into, a file made, written, moved in, read back and closed, a file whose name the emulator
//   keeps another way, the folder listed a few entries at a time, by a pattern and from the card's top, with each
//   entry's size, kind and time, a file renamed, what can't be deleted and what can, and each frame a file written
//   again and the folder listed, the file's time moving on a second every sixty frames with the console's clock;
// - the cards themselves, every file's bytes, are the emulator's after the last frame;
// - a Dreamport that writes the frame after's number is found by the card it leaves, though every answer is the same.
//
// It isn't run on every pull request, as the emulator takes minutes to build, and on Linux, macOS and Windows (docs/CONSOLES.md).

import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder, resultFolder } from '../lib/paths.mjs';
import { startingEntry, startingFiles } from '../lib/new-game.mjs';
import { BACKGROUND, LOAD_AT, SQUARE, SQUARE_SIZE, SQUARE_Y } from './made-up-ps2.mjs';
import { madeUpPs2Cards } from './made-up-ps2-cards.mjs';

const GAME = 'test-ps2-cards';
const WORK = join(LOCAL, 'test-ps2-cards');
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
// what the last proof found of the cards, from the version's progress.json: { original, dreamport, same }
const saves = () => {
  const file = join(proofFolder(inC), 'progress.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).recordings?.still?.saves ?? null : null;
};
const hex = number => `0x${(number >>> 0).toString(16).toUpperCase()}`;

// the Dreamport in C: made-up-ps2-rpc.c with the program's tables filled in, or writing the frame after's number
function writeGame(made, { wrongFrame = false } = {}) {
  const numbers = {
    ...made.forC, LOAD_AT: hex(LOAD_AT), ELF_AT: made.sectors['MADE_UP.ELF'].at, ELF_SECTORS: made.sectors['MADE_UP.ELF'].count,
    BACKGROUND: hex(BACKGROUND), SQUARE: hex(SQUARE), SQUARE_Y, SQUARE_SIZE,
  };
  let code = readFileSync(join(REPO, 'tools', 'test', 'made-up-ps2-rpc.c'), 'utf8').replace(/@([A-Z_0-9]+)@/g, (_, key) => {
    if (numbers[key] === undefined) throw new Error(`made-up-ps2-rpc.c asks for ${key}, which the test doesn't fill in.`);
    return numbers[key];
  });
  if (wrongFrame) code = code.replace('calls[n].base + (frame & calls[n].mask)', 'calls[n].base + ((frame + 1) & calls[n].mask)');
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
  console.log('A disc whose program makes, writes, lists, renames and deletes files on a memory card, and its Dreamport in C');
  const made = madeUpPs2Cards();
  setUp(made);
  writeGame(made);
  let run = dp('prove', inC, 'still');
  let found = report();
  check(run.status === 0 && found.matched === FRAMES, `the memory cards' server gives the Dreamport what the emulator's gives the program, every frame: ${found.matched} of ${found.frames}, ${JSON.stringify(found.firstDifference)}, ${found.drawListApart ? `${found.drawListApart.original} against ${found.drawListApart.dreamport}` : ''}`);
  let cards = saves();
  check(cards?.original >= 1 && cards.same === cards.original && cards.dreamport === cards.original, `the Dreamport's cards hold what the emulator's do: ${JSON.stringify(cards)}`);
  if (run.status) console.log(run.out);
  writeGame(made, { wrongFrame: true });
  run = dp('prove', inC, 'still');
  found = report();
  cards = saves();
  check(found.matched === FRAMES && cards?.same === 0 && /mc0\/MADEUP\/EACH/.test(run.out), `a Dreamport that writes the frame after's number is found by its card, with every answer the same: ${run.out.split('\n').find(line => /^\s*Saves: the original/.test(line))?.trim()}`);
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
