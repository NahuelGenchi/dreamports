// npm run test:ps2-ledger: what the tools learn of a PlayStation 2 game as it plays, for gameplay proven
// (docs/STANDARD.md#how-progress-is-measured), checked on the console's real emulator, Play!, with the tools' change to it
// (libretro/play.patch), on a disc of the project's own (made-up-ps2-disc.mjs) that boots the program that draws through
// vector unit 1 (made-up-ps2.mjs), with a file of data beside it that nothing reads and one of nothing but zeros.
//
// Every instruction the program runs on the EE is told, with each way of the branch that waits for the V-blank, and so is
// the vector unit's program, with its loop's branch both ways, and the IOP's own code, and the sectors the console reads
// to boot the disc. The same play twice tells the same, and the pictures are the same as with nothing told. Like the
// other checks on the real emulator, it isn't run on every pull request, as the emulator takes minutes to build, and runs
// on Linux and macOS alone (docs/CONSOLES.md).
//
// Then the same disc is a game's copy, in a folder of its own that it removes after, with the program's Dreamport in C
// (made-up-ps2.c), and `prove` writes its played.json, with the program's code and the disc's sectors, and `untouched`
// says what's left of both, which branches the code decides, and what the branch that waits for the V-blank compares.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder, resultFolder } from '../lib/paths.mjs';
import { startingEntry, startingFiles } from '../lib/new-game.mjs';
import { cartridgeOf, bytesText, watchesOf } from '../lib/proof-files.mjs';
import { RAN, TAKEN, NOT_TAKEN, layoutOf, finderOf, playedIn, contentIn, cellsOf } from '../lib/played.mjs';
import { mipsInstructionsOf, vuInstructionsOf } from '../ps2/ledger.mjs';
import { findFunctions } from '../ps2/functions.mjs';
import { consoleOf } from '../consoles.mjs';
import { libretroReference } from '../libretro/reference.mjs';
import { BACKGROUND, BACKGROUND_3D, COS, CORNERS, CORNER_DEPTH, DEPTH_ACROSS, FRAME_PACKET, LOAD_AT, MIDDLE, MOVING_AT, MOVING_Y, RADIUS, SIN, SQUARE, SQUARE_SIZE, SQUARE_Y, STEP, STILL, TURNING, UPLOAD, VU1_PROGRAM, VU1_TAG, madeUpPs2OnVu1 } from './made-up-ps2.mjs';
import { SECTOR, madeUpPs2Disc, systemCnf } from './made-up-ps2-disc.mjs';

const FRAMES = 120;
const WORK = join(LOCAL, 'test-ps2-ledger');
const GAME = 'test-ps2-ledger', IN_C = `${GAME}/c`, MEDIA = join(REPO, 'public', 'media');

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};

// the records the program that runs the original wrote (libretro/ran-ps2.h): { address, word, what, processor, from, to }
const recordsOf = words => Array.from({ length: words.length / 5 }, (_, i) => ({ address: words[i * 5], word: words[i * 5 + 1], what: words[i * 5 + 2] & 0xFF, processor: words[i * 5 + 2] >>> 8, from: words[i * 5 + 3], to: words[i * 5 + 4] }));
const sameWords = (a, b) => a.length === b.length && a.every((word, i) => word === b[i]);

const dp = (...args) => {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 26 });
  return { status, out: stdout + stderr };
};
const hex = number => `0x${(number >>> 0).toString(16).toUpperCase()}`;
const bitsOf = float => new Uint32Array(new Float32Array([float]).buffer)[0];
const table = rows => `{ ${rows.map(row => `{ ${row.map(hex).join(', ')} }`).join(', ')} }`;

function tidy() {
  for (const path of [gameFolder(GAME), join(LOCAL, 'results', GAME), join(LOCAL, 'captures', GAME), join(LOCAL, 'untouched', `${GAME}-c.json`), join(REPO, '.github', 'readme', 'progress', `${GAME}.svg`), ...readdirSync(MEDIA).filter(file => file.startsWith(GAME)).map(file => join(MEDIA, file))]) {
    rmSync(path, { recursive: true, force: true });
  }
}

// the program on vector unit 1 as a game of its own, as npm run test:ps2-kit makes one, but from its disc: proven, then asked
function proveAndAsk(copy, disc, { branch, read, sectors }) {
  tidy();
  const original = { console: 'ps2', name: `${GAME} (World)`, title: GAME, code: 'MADE_UP.ELF', sha1: createHash('sha1').update(disc).digest('hex'), provenBy: 'draw lists' };
  mkdirSync(join(proofFolder(GAME), 'recordings'), { recursive: true });
  writeFileSync(join(proofFolder(GAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
  let run = dp('rom', copy);
  check(run.status === 0 && run.out.includes(GAME), `rom knows the disc: ${run.out.trim().split('\n')[1]?.trim()}`);
  run = dp('codemap', GAME);
  check(run.status === 0, `codemap finds the functions of the program the disc boots: ${run.out.trim().split('\n').at(-1)}`);
  for (const [game, language] of [[GAME, undefined], [IN_C, 'c']]) {
    const files = { ...startingFiles(GAME, original, language ? { language } : undefined), ...(language ? {} : { 'entry.md': startingEntry(GAME, original, { issue: 1, lead: 'nobody', added: '2026-01-01' }) }) };
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(join(gameFolder(game), file, '..'), { recursive: true });
      writeFileSync(join(gameFolder(game), file), text);
    }
  }
  writeFileSync(join(proofFolder(GAME), 'recordings', 'still.json'), `${JSON.stringify({ about: 'Nothing held.', frames: FRAMES, held: [[0, []]] }, null, 2)}\n`);
  const numbers = {
    PROGRAM: 'ON_VU1', SHOWN_FORMAT: '0', UPLOAD: `{ ${UPLOAD.map(hex).join(', ')} }`, FRAME_PACKET: `{ ${FRAME_PACKET.map(hex).join(', ')} }`, MOVING_AT, MOVING_Y, PLAIN_SUMS: 0, RADIUS,
    COS_BITS: hex(bitsOf(COS)), SIN_BITS: hex(bitsOf(SIN)), MIDDLE_X: MIDDLE[0], MIDDLE_Y: MIDDLE[1], CORNER_COUNT: CORNERS.length,
    PLACES: `{ ${CORNERS.map(([x, y]) => `{ ${x}, ${y}, ${CORNER_DEPTH}, 1 }`).join(', ')} }`, COLOURS: table(CORNERS.map(([, , ...colour]) => [...colour, 0x80])),
    DEPTH_ACROSS: `${DEPTH_ACROSS}f`, VU1_TAG: `{ ${VU1_TAG.map(hex).join(', ')} }`, STILL: table(STILL), TURNING: table(TURNING),
    BACKGROUND_3D: hex(BACKGROUND_3D), BACKGROUND: hex(BACKGROUND), SQUARE: hex(SQUARE), SQUARE_Y, SQUARE_SIZE, STEP,
  };
  writeFileSync(join(gameFolder(IN_C), 'src', 'main.c'), readFileSync(join(REPO, 'tools', 'test', 'made-up-ps2.c'), 'utf8').replace(/@([A-Z_0-9]+)@/g, (_, key) => numbers[key]));
  run = dp('prove', IN_C, 'still');
  const report = existsSync(join(resultFolder(IN_C, 'still'), 'report.json')) ? JSON.parse(readFileSync(join(resultFolder(IN_C, 'still'), 'report.json'), 'utf8')) : {};
  check(run.status === 0 && report.matched === FRAMES, `prove matches every frame's draw list: ${report.matched} of ${report.frames}`);
  if (run.status) console.log(run.out);
  const played = existsSync(join(proofFolder(IN_C), 'played.json')) ? JSON.parse(readFileSync(join(proofFolder(IN_C), 'played.json'), 'utf8')) : {};
  check(played.units?.played > 0 && played.units.played <= played.units.total, `prove writes played.json with the program's code played in matching frames: ${JSON.stringify(played.units)}, ${played.percent}%`);
  // the sectors that hold anything: all but those of one value throughout, which NEVER.BIN's middle one is, and ZEROS.BIN's
  const plain = new Set([sectors['NEVER.BIN'].at + 1, ...Array.from({ length: sectors['ZEROS.BIN'].count }, (_, i) => sectors['ZEROS.BIN'].at + i)]);
  const holding = Array.from({ length: disc.length / SECTOR }, (_, sector) => sector).filter(sector => sector >= 16 && !plain.has(sector));
  check(played.cells?.total === holding.length && played.cells.read === read.length, `and the disc's sectors that hold anything, those read to boot it used: ${JSON.stringify(played.cells)}`);
  run = dp('untouched', IN_C);
  if (process.env.DP_SHOW) console.log(run.out);
  check(run.status === 0 && run.out.includes(`sector ${sectors['NEVER.BIN'].at},`) && run.out.includes(`sectors ${sectors['ZEROS.BIN'].at} to ${sectors['ZEROS.BIN'].at + sectors['ZEROS.BIN'].count - 1}`), 'untouched lists the sectors never read, those that hold data apart from those of one value throughout');
  if (run.status) console.log(run.out);
  run = dp('untouched', IN_C, '--decided');
  check(run.status === 0 && /conditional branches of test-ps2-ledger are decided by the code itself, worked out from the program its disc boots alone/.test(run.out), `--decided reads the program the disc boots: ${run.out.trim().split('\n')[0]}`);
  if (run.status) console.log(run.out);
  run = dp('untouched', IN_C, '--why', branch.toString(16).padStart(8, '0'));
  check(run.status === 0 && run.out.includes('from the word at 12001000, changed on the way') && run.out.includes('0, a number in the code'), `--why says the branch that waits for the V-blank compares the GS's status, read and changed, against zero: ${run.out.trim().split('\n')[1]?.trim()}`);
  if (run.status) console.log(run.out);
}

async function main() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const { elf } = madeUpPs2OnVu1();
  const never = Buffer.alloc(5000, 7).fill(9, 100, 200);
  const { disc, sectors } = madeUpPs2Disc({ 'SYSTEM.CNF': systemCnf('MADE_UP.ELF'), 'MADE_UP.ELF': elf, 'NEVER.BIN': never, 'ZEROS.BIN': Buffer.alloc(3 * SECTOR) });
  const copy = join(WORK, 'made-up.iso');
  writeFileSync(copy, disc);
  const machine = consoleOf('ps2'), reference = libretroReference(machine);
  reference.ensureOriginal(message => console.log(message));

  // the program's code map, as the tools make one, and the vector unit's program, which the EE puts in its code memory
  const cartridge = cartridgeOf(copy, 'ps2');
  const vuBytes = new Uint8Array(Uint32Array.from(VU1_PROGRAM).buffer);
  const codeMap = { console: 'ps2', functions: [...findFunctions(elf).map(f => ({ key: `sub_${f.address.toString(16)}`, ...f })), { key: 'vu1_0000', address: 0, size: vuBytes.length, cpu: 'vu1', bytes: bytesText(vuBytes) }] };
  const functions = watchesOf(codeMap, cartridge), buttons = new Array(FRAMES).fill(0);

  console.log(`What runs and what's read of a made-up disc on ${machine.name}'s real emulator, ${FRAMES} frames`);
  const run = played => reference.runOriginal({ copy, frames: FRAMES, buttons, functions, played, pictures: [FRAMES - 1] });
  const first = await run(true), second = await run(true), plain = await reference.runOriginal({ copy, frames: FRAMES, buttons, pictures: [FRAMES - 1] });
  check(first.hashes.every((hash, f) => hash === plain.hashes[f]), 'every picture is the same as when nothing is told: telling the tools changes nothing of the console');
  check(sameWords(first.played.records, second.played.records) && sameWords(first.played.content, second.played.content), 'the same play twice tells the same, every instruction and sector in the same frames');

  const records = recordsOf(first.played.records);
  const on = processor => records.filter(r => r.processor === processor);
  const program = mipsInstructionsOf(cartridge(LOAD_AT, elf.length), [], new Map(), LOAD_AT);
  const eeRan = new Set(on(0).filter(r => r.what === RAN && r.address >= LOAD_AT && r.address < LOAD_AT + elf.length).map(r => r.address - LOAD_AT));
  check([...program.instructions].every(at => eeRan.has(at)), `every one of the program's ${program.instructions.size} instructions on the EE ran, as each is on its way to the frame loop or in it: ${eeRan.size} told`);
  const words = on(0).filter(r => r.address >= LOAD_AT && r.address < LOAD_AT + elf.length);
  check(words.every(r => cartridge(r.address, 4).length === 4 && Buffer.from(cartridge(r.address, 4)).readUInt32LE() === r.word), 'each instruction told has the word the program holds there');
  const both = [...program.branches].filter(at => words.some(r => r.address === LOAD_AT + at && r.what === TAKEN) && words.some(r => r.address === LOAD_AT + at && r.what === NOT_TAKEN));
  check(both.length >= 1, `the branch that waits for the V-blank went both ways: ${both.map(at => `0x${(LOAD_AT + at).toString(16)}`).join(', ')}`);
  check(!words.some(r => r.what !== RAN && !program.branches.has(r.address - LOAD_AT)), 'only conditional branches are told going a way, as `j` and `b` always go');

  const vu = vuInstructionsOf(vuBytes), vuRan = on(3);
  check([...vu.instructions].every(at => vuRan.some(r => r.address === at && r.what === RAN)) && vuRan.every(r => r.word === VU1_PROGRAM[r.address / 4]), `every pair of vector unit 1's program ran, each told with its lower word: ${vu.instructions.size} pairs`);
  check([...vu.branches].every(at => [TAKEN, NOT_TAKEN].every(way => vuRan.some(r => r.address === at && r.what === way))), "the vector unit's loop over the corners went both ways");
  check(on(1).length > 0, `the IOP's own code ran and was told: ${on(1).length} instructions`);

  // what the ledger makes of it, with every frame matched (lib/played.mjs)
  const layout = layoutOf(codeMap), matched = new Uint8Array(FRAMES + 1).fill(1);
  const set = playedIn(first.played.records, matched, layout, finderOf(codeMap, cartridge, new Map()));
  const count = (index, what) => Array.from({ length: layout.first[index + 1] - layout.first[index] }, (_, p) => (set[((layout.first[index] + p) * 3 + what) >> 3] >> (((layout.first[index] + p) * 3 + what) & 7)) & 1).reduce((a, b) => a + b, 0);
  const vuIndex = codeMap.functions.length - 1;
  check(count(vuIndex, RAN) === vu.instructions.size && count(vuIndex, TAKEN) === 1 && count(vuIndex, NOT_TAKEN) === 1, 'gameplay proven finds the vector unit program\'s pairs and its branch\'s two ways in its function');
  const eeCounted = codeMap.functions.slice(0, -1).reduce((sum, _, i) => sum + count(i, RAN), 0);
  check(eeCounted === eeRan.size, `and every instruction the EE ran in the program's functions: ${eeCounted}`);
  const moved = { ...codeMap, functions: codeMap.functions.map(f => (f.cpu ? f : { ...f, address: f.address + 4 })) };
  const elsewhere = playedIn(first.played.records, matched, layoutOf(moved), finderOf(moved, (address, n) => cartridge(address - 4, n), new Map()));
  check(elsewhere.slice(0, Math.ceil(layoutOf(moved).first[vuIndex] * 3 / 8) - 1).every(byte => !byte), 'an instruction counts only where the program holds the word that ran: none does where every word is another');

  // the disc: what's read to boot it, and the file nothing reads
  const content = Array.from({ length: first.played.content.length / 3 }, (_, i) => first.played.content.subarray(i * 3, i * 3 + 3));
  const read = new Set(content.map(([sector]) => sector));
  const elfSectors = Array.from({ length: sectors['MADE_UP.ELF'].count }, (_, i) => sectors['MADE_UP.ELF'].at + i);
  check([16, sectors['SYSTEM.CNF'].at, ...elfSectors].every(sector => read.has(sector)) && content.every(([, from]) => from === 0), `booting reads the volume, SYSTEM.CNF and the whole program, in the first frame: sectors ${[...read].sort((a, b) => a - b).join(', ')}`);
  check(![sectors['NEVER.BIN'], sectors['ZEROS.BIN']].some(({ at, count: n }) => Array.from({ length: n }, (_, i) => at + i).some(sector => read.has(sector))), 'the files nothing opens are never read');
  const cells = cellsOf(codeMap, cartridge), used = contentIn(first.played.content, matched, cells);
  check(cells === disc.length / SECTOR && elfSectors.every(sector => used[sector >> 3] >> (sector & 7) & 1), `the disc's ${cells} sectors are its content, and those read count as used`);

  first.sound?.close();

  console.log('\nThe disc as a game\'s copy, proven with its Dreamport in C, and what untouched says of it');
  const branch = LOAD_AT + both[0];
  try {
    proveAndAsk(copy, disc, { branch, read: [...read], sectors });
  } finally {
    tidy();
  }
  rmSync(WORK, { recursive: true, force: true });
  if (failures.length) {
    console.log(`\n${failures.length} failed.`);
    process.exit(1);
  }
  console.log('\nAll passed.');
}

main().catch(error => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
