// npm run test:ps2-memory: what the PlayStation 2 holds, its memory and its memory cards, as the console's real
// emulator, Play!, says them with the tools' change to it (libretro/play.patch, libretro/held.h), on the program that draws
// through vector unit 1 (made-up-ps2.mjs), for `prove` to compare with a Dreamport's (lib/memory.mjs, lib/saves.mjs).
//
// Every one of the console's memories is hashed as each frame ends: the EE's main memory, its scratchpad and the vector
// units' code and data, the IOP's memory and scratchpad, and the SPU2's, the same in two runs, and their bytes where the
// program is and where the vector unit's program went are what the program put there, with a value a recording set on
// the way, as one that starts at a start point does. The console's clock is the same in
// every run. Memory cards a recording starts from go where the emulator keeps them, as kit/ps2/card.js writes them.
//
// Then the program is a game of its own, in a folder of its own that it removes after, whose Dreamport in C keeps a
// stretch of main memory where the console does (kit/ps2/c/memory.c), and `prove` compares it after every frame: a
// stretch neither writes is the same in every frame, and the program's own code, which the Dreamport doesn't hold, is
// found differing at once, at its first byte. And `route` searches it, saving the console's state and bringing it back
// at every step, as Play! does with its own save states, until the flat program's square reaches a place: it gets
// there at the frame the program does. Like the other checks on the real emulator, it isn't run on every pull
// request, as the emulator takes minutes to build, and runs on Linux and macOS alone (docs/CONSOLES.md).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder, resultFolder } from '../lib/paths.mjs';
import { startingEntry, startingFiles } from '../lib/new-game.mjs';
import { memorySpec, workMemoryOf } from '../lib/memory.mjs';
import { programReader } from '../ps2/ledger.mjs';
import { cardBytes, cardEntries } from '../../kit/ps2/card.js';
import { consoleOf } from '../consoles.mjs';
import { libretroReference } from '../libretro/reference.mjs';
import { BACKGROUND, BACKGROUND_3D, COS, CORNERS, CORNER_DEPTH, DEPTH_ACROSS, FRAME_PACKET, LOAD_AT, MIDDLE, MOVING_AT, MOVING_Y, RADIUS, SIN, SQUARE, SQUARE_SIZE, SQUARE_Y, STEP, STILL, TURNING, UPLOAD, VU1_PROGRAM, VU1_TAG, madeUpPs2, madeUpPs2OnVu1 } from './made-up-ps2.mjs';

const FRAMES = 90, LOOKED_AT = 60;
const WORK = join(LOCAL, 'test-ps2-memory');
const GAME = 'test-ps2-memory', IN_C = `${GAME}/c`, MEDIA = join(REPO, 'public', 'media');

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
const same = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);

// every byte of the console's memories, as original.json would list them
const EVERYTHING = [
  { address: '00000000', bytes: 0x02000000 }, { address: '11000000', bytes: 0x1000 }, { address: '11004000', bytes: 0x1000 },
  { address: '11008000', bytes: 0x4000 }, { address: '1100C000', bytes: 0x4000 }, { address: '70000000', bytes: 0x4000 },
  { memory: 'iop', address: '00000000', bytes: 0x200000 }, { memory: 'iop', address: '1F800000', bytes: 0x400 },
  { memory: 'spu2', address: '00000000', bytes: 0x200000 },
];

const dp = (...args) => {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 26 });
  return { status, out: stdout + stderr };
};
const hex = number => `0x${(number >>> 0).toString(16).toUpperCase()}`;
const bitsOf = float => new Uint32Array(new Float32Array([float]).buffer)[0];
const table = rows => `{ ${rows.map(row => `{ ${row.map(hex).join(', ')} }`).join(', ')} }`;

function tidy() {
  for (const path of [gameFolder(GAME), join(LOCAL, 'results', GAME), join(LOCAL, 'captures', GAME), join(REPO, '.github', 'readme', 'progress', `${GAME}.svg`), ...readdirSync(MEDIA).filter(file => file.startsWith(GAME)).map(file => join(MEDIA, file))]) {
    rmSync(path, { recursive: true, force: true });
  }
}

// the program as a game of its own, its Dreamport in C keeping 64 KB of main memory from 0x00100000 where the console
// does, and `prove` with original.json listing `workMemory`
function prove(copy, elf, workMemory) {
  tidy();
  const original = { console: 'ps2', name: `${GAME} (World)`, title: GAME, code: '', sha1: createHash('sha1').update(elf).digest('hex'), provenBy: 'draw lists', workMemory };
  mkdirSync(join(proofFolder(GAME), 'recordings'), { recursive: true });
  writeFileSync(join(proofFolder(GAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
  if (dp('rom', copy).status) return { status: 1, out: 'rom failed' };
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
  const code = readFileSync(join(REPO, 'tools', 'test', 'made-up-ps2.c'), 'utf8').replace(/@([A-Z_0-9]+)@/g, (_, key) => numbers[key])
    .replace('void game_start(void) {', 'static uint8_t main_memory[0x10000];\nvoid game_start(void) {\n  ps2_console_memory(PS2_EE, 0x00100000, sizeof main_memory, main_memory);');
  writeFileSync(join(gameFolder(IN_C), 'src', 'main.c'), code);
  const run = dp('prove', IN_C, 'still');
  const file = join(resultFolder(IN_C, 'still'), 'report.json');
  return { ...run, report: existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {} };
}

async function main() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const { elf } = madeUpPs2OnVu1();
  const copy = join(WORK, 'program.elf');
  writeFileSync(copy, elf);
  const machine = consoleOf('ps2'), reference = libretroReference(machine);
  reference.ensureOriginal(message => console.log(message));

  console.log(`What ${machine.name}'s real emulator holds of a small program, ${FRAMES} frames`);
  const stretches = workMemoryOf({ console: 'ps2', workMemory: EVERYTHING }, 'the test');
  const total = stretches.reduce((sum, { bytes }) => sum + bytes, 0);
  // with a value set in main memory on the way, as a recording that starts at a start point sets one (tools/README.md#start-points)
  const SET = { frame: 10, address: 0x001F0000, bytes: 4, value: 0x12345678 };
  const run = () => reference.runOriginal({ copy, frames: FRAMES, buttons: new Array(FRAMES).fill(0), sets: [SET], memory: { spec: memorySpec(stretches, LOOKED_AT) } });
  const first = await run(), second = await run();
  check(first.memory.hashes.length === FRAMES && same(first.memory.hashes, second.memory.hashes), `all ${total.toLocaleString('en')} bytes of the console's memories are the same in two runs, as every frame ends`);
  check(new Set(first.memory.hashes).size > FRAMES / 2, `and change as the program plays: ${new Set(first.memory.hashes).size} different in ${FRAMES} frames`);
  const bytes = first.memory.bytes, at = (memory, address) => {
    let offset = 0;
    for (const s of stretches) {
      if (s.memory === memory && address >= s.address && address < s.address + s.bytes) return offset + address - s.address;
      offset += s.bytes;
    }
    return -1;
  };
  const code = programReader(elf)(LOAD_AT, 256);
  check(bytes?.length === total && same(bytes.subarray(at(0, LOAD_AT), at(0, LOAD_AT) + 256), code), `at frame ${LOOKED_AT} main memory holds the program where it's loaded`);
  check(Buffer.from(bytes.subarray(at(0, SET.address), at(0, SET.address) + 4)).readUInt32LE() === SET.value, `a value a recording sets in main memory at frame ${SET.frame}, as one that starts at a start point does, is there after`);
  const vu = new Uint8Array(Uint32Array.from(VU1_PROGRAM).buffer);
  check(same(bytes.subarray(at(0, 0x11008000), at(0, 0x11008000) + vu.length), vu), "and vector unit 1's code memory the program it was given");

  console.log('Memory cards a recording starts from');
  const icon = Buffer.alloc(964, 3).fill(4, 100, 200), data = Buffer.from('a made-up save, nothing of any game\n'), other = Buffer.alloc(70, 9);
  const entries = [{ path: 'mc0/BADATA-SYSTEM/icon.sys', bytes: icon }, { path: 'mc0/BADATA-SYSTEM/DATA', bytes: data }, { path: 'mc1/BAMADE-UP:1', bytes: other }, { path: 'mc0/EMPTY' }];
  const canonical = cardBytes(entries), start = join(WORK, 'cards.bin');
  const cardRun = async startBytes => {
    writeFileSync(start, startBytes);
    return reference.runOriginal({ copy, frames: 30, buttons: new Array(30).fill(0), saves: true, startSave: start });
  };
  const kept = await cardRun(canonical);
  check(kept.saves.length === 0, 'cards a recording starts from go where the emulator keeps them, every file and folder as they were, so a program that never writes leaves them as they were');
  const reordered = Buffer.concat([cardBytes([entries[2]]), cardBytes(entries.filter((_, i) => i !== 2))]);
  const read = await cardRun(reordered);
  check(read.saves.length === 1 && read.saves[0].frame === 0 && same(read.saves[0].bytes, canonical), 'and the emulator\'s cards come back in the order kit/ps2/card.js writes them, a name with ":" and all');
  check(cardEntries(canonical).map(e => e.path).join() === 'mc0/BADATA-SYSTEM,mc0/BADATA-SYSTEM/DATA,mc0/BADATA-SYSTEM/icon.sys,mc0/EMPTY,mc1/BAMADE-UP:1', 'each folder before what it holds, in the order of the names\' bytes');

  console.log("route, with the console's state saved and brought back at every step");
  {
    const { elf: flat } = madeUpPs2(), words = new Uint32Array(flat.buffer.slice(flat.byteOffset + 0x80, flat.byteOffset + flat.length));
    // where the square's first corner is in the packet the program sends each frame: its place across, in sixteenths
    const packet = words.findIndex((word, i) => word === 0x800D && words[i + 1] === 0x10000000 && words[i + 2] === 0xE);
    const corner = LOAD_AT + packet * 4 + 16 + 11 * 16, across = 300, goal = across * 16;
    const folder = join(WORK, 'route');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'flat.elf'), flat);
    writeFileSync(join(folder, 'prefix.bin'), Buffer.alloc(0));
    writeFileSync(join(folder, 'spec.txt'), [`prefix ${join(folder, 'prefix.bin')}`, 'sets -', `archive ${join(folder, 'archive.bin')}`, `out ${join(folder, 'out.bin')}`, `value ${corner} 2 0`, 'cell 0 320', `goal 0 0 5 ${goal}`, 'buttons 0', 'buttons 8', 'seed 1', 'seconds 120', 'threads 1', ''].join('\n'));
    const search = reference.searchOriginal({ copy: join(folder, 'flat.elf'), spec: join(folder, 'spec.txt') });
    const found = spawnSync(search.program, search.args, { cwd: join(LOCAL, 'tmp'), env: { ...process.env, ...search.env }, encoding: 'utf8', timeout: 300000 });
    search.done();
    const said = found.stdout.trim().split('\n'), reached = Number(said.at(-1).match(/^goal (\d+)/)?.[1] ?? -1);
    // the square moves two pixels a frame from frame 1, and a frame's packet is what the frame before worked out
    const expected = across / STEP + 2, tries = Number(said.at(-2)?.match(/tries (\d+)/)?.[1] ?? 0);
    check(found.status === 0 && reached === expected && readFileSync(join(folder, 'out.bin')).length === expected * 4, `the search reaches the square at ${across} across at frame ${reached}, where the program gets there, through ${tries} states brought back: ${said.at(-1)}`);
  }

  console.log('The program as a game of its own, whose Dreamport keeps 64 KB of main memory where the console does');
  try {
    let proven = prove(copy, elf, [{ address: '0010F000', bytes: 0x100 }]);
    check(proven.status === 0 && proven.report.matched === FRAMES, `prove compares a stretch neither writes after every frame, and every frame matches: ${proven.report.matched} of ${proven.report.frames}`);
    if (proven.status) console.log(proven.out);
    proven = prove(copy, elf, [{ address: '00100000', bytes: 0x100 }]);
    const said = proven.out.match(/The console's memory first differs after frame (\d+): [^\n]*/)?.[0] ?? '';
    check(proven.status !== 0 && said.includes('the first at 0x00100000, in main memory') && said.includes(`holds 0x${code[0].toString(16).toUpperCase().padStart(2, '0')} in the original and 0x00 in the Dreamport`), `and finds the program's own code, which the Dreamport doesn't keep, differing at once: ${said}`);
  } finally {
    tidy();
  }

  for (const r of [first, second, kept, read]) r.sound?.close();
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
