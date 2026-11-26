// npm run test:real-gb: the Game Boy kit in C (kit/gbc/c/) against Gambatte, the console's real emulator, built as it's
// built on a contributor's computer, at the commit tools/consoles.mjs fixes, for the Game Boy and for the Game Boy
// Color. It runs a small program written here (made-up-gb.mjs), with a Dreamport of it in C in a folder of its own that
// it removes after, so no game's copy is needed. `prove` has to find every frame the same, picture and sound, from
// power-on and from a start point, and a sprite moved a pixel too far where it first shows. And as `prove` hears sound
// by how loud it is in each band of pitches, the test also compares the kit's with the emulator's itself: every pixel
// of every frame, and every sample of the sound, all 16 bits of it, with the recording's presses and then with 900
// frames of presses drawn from a seed, any buttons at once, pressed again before their sounds have ended.

import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder, resultFolder } from '../lib/paths.mjs';
import { startingEntry, startingFiles } from '../lib/new-game.mjs';
import { consoleOf } from '../consoles.mjs';
import { readCodeMap } from '../lib/proof-files.mjs';
import { libretroReference } from '../libretro/reference.mjs';
import { RAM, madeUpGb, numbersFor } from './made-up-gb.mjs';

const WORK = join(LOCAL, 'test-real-gb');
const COPIES = join(LOCAL, 'copies.json');
const STATUS = join(REPO, 'docs', 'STATUS.md');
const MEDIA = join(REPO, 'public', 'media');
// the frames a recording that starts later has only the original play, which the Dreamport plays ahead through
const PLAYS_FROM = 8;

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};

const dp = (...args) => {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 26 });
  return { status, out: stdout + stderr };
};

const gameOf = id => `test-real-${id}`;
function tidy() {
  for (const id of ['gb', 'gbc']) {
    const game = gameOf(id);
    const kept = readdirSync(MEDIA).filter(file => file.startsWith(game)).map(file => join(MEDIA, file));
    for (const path of [gameFolder(game), join(LOCAL, 'results', game), join(LOCAL, 'captures', game), join(REPO, '.github', 'readme', 'progress', `${game}.svg`), ...kept]) rmSync(path, { recursive: true, force: true });
  }
  rmSync(WORK, { recursive: true, force: true });
}

// each button, then none: what a recording holds, and the same as the bits the emulator and the kit are given
const HELD = [[0, []], [30, ['A']], [40, []], [50, ['B']], [80, []], [90, ['SELECT']], [95, []], [100, ['START']], [103, []], [110, ['RIGHT', 'DOWN']], [130, ['LEFT', 'UP']], [140, []], [150, ['START']], [153, []], [160, ['A', 'B']], [170, ['SELECT', 'RIGHT']], [180, []]];
// it copies its sprites to the screen before it moves them, so a move shows in the frame after its button
const FRAMES = 240, MOVE_SHOWS = 111;
const heldIn = list => frame => list.findLast(([from]) => from <= frame)[1];
// and any buttons at once, changing every few frames, the same every run
const SEED = Number(process.env.SEED || 0x5EED), MANY = 900;
function drawn(machine) {
  let state = SEED >>> 0;
  const next = () => {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7FFFFFFF;
    return state / 0x7FFFFFFF;
  };
  const list = [[0, []]];
  for (let frame = 10; frame < MANY - 20; frame += 1 + Math.floor(next() * 12)) list.push([frame, machine.buttons.filter(() => next() < 0.25)]);
  return list;
}

// The kit as WebAssembly, run here with no browser: each frame's picture, in the console's 15-bit colour, and the
// samples a frame's time holds, 16 bits each.
function playInC(wasm, rom, machine, frames, heldAt) {
  const nothing = () => {};
  const { exports: game } = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(wasm)), { dreamports: { save_read: nothing, save_write: nothing } });
  const at = game.dp_rom(rom.length);
  new Uint8Array(game.memory.buffer, at, rom.length).set(rom);
  game.dp_start_point(0);
  game.dp_start();
  const [width, height] = machine.screen, pictures = [], sound = [];
  const each = machine.sound * machine.frame[0] / machine.frame[1], most = game.dp_sound_render_max();
  for (let frame = 0; frame < frames; frame++) {
    game.dp_step(heldAt(frame).reduce((bits, name) => bits | 1 << machine.buttons.indexOf(name), 0));
    const drawn = game.dp_draw(), words = new Uint32Array(game.memory.buffer, drawn, width * height);
    pictures.push(Uint16Array.from(words, c => (c & 0xFF) >> 3 | ((c >> 8 & 0xFF) >> 3) << 5 | ((c >> 16 & 0xFF) >> 3) << 10));
    const count = Math.floor((frame + 1) * each) - Math.floor(frame * each);
    const made = game.dp_sound_render(count), samples = new Float32Array(game.memory.buffer, made, most * 2);
    for (let i = 0; i < count; i++) sound.push(Math.round(samples[i] * 32768), Math.round(samples[most + i] * 32768));
  }
  return { pictures, sound };
}

async function oneConsole(id) {
  const colour = id === 'gbc', machine = consoleOf(id), game = gameOf(id), inC = `${game}/c`;
  console.log(`A small program on the ${machine.name}'s real emulator, and its Dreamport in C on the kit`);
  const { rom, sha1, at } = madeUpGb({ colour });
  const copy = join(WORK, `program${machine.files[0]}`);
  writeFileSync(copy, rom);
  // it reads its buttons as its V-blank starts, which is where the emulator's frame starts, as most of the console's games do
  const original = { console: id, name: `Test Real ${colour ? 'GBC' : 'GB'} (World)`, title: colour ? 'MADEUP GBC' : 'MADEUP GB', code: '', sha1, keysAfterVBlank: true };
  mkdirSync(join(proofFolder(game), 'recordings'), { recursive: true });
  writeFileSync(join(proofFolder(game), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
  let run = dp('rom', copy);
  check(run.status === 0 && run.out.includes(game), `rom knows the copy by its header: ${run.out.trim().split('\n')[1]?.trim()}`);

  run = dp('codemap', game);
  const mapped = (readCodeMap(game)?.functions ?? []).map(f => f.address);
  check(run.status === 0 && [0x40, 0x48, 0x50, 0x100, at.vblank, at.stat, at.timer, at.copy, at.fill].every(place => mapped.includes(place)) && mapped.length === 9,
    `codemap finds the program's functions, from where the console starts it and from its three interrupts: ${run.out.trim().split('\n').at(-1)}`);

  const files = { ...startingFiles(game, original), 'entry.md': startingEntry(game, original, { issue: 1, lead: 'nobody', added: '2026-01-01' }) };
  for (const [file, text] of Object.entries({ ...files, ...Object.fromEntries(Object.entries(startingFiles(game, original, { language: 'c' })).map(([file, text]) => [`c/${file}`, text])) })) {
    mkdirSync(join(gameFolder(game), file, '..'), { recursive: true });
    writeFileSync(join(gameFolder(game), file), text);
  }
  const recording = (name, value) => writeFileSync(join(proofFolder(game), 'recordings', `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
  recording('buttons', { about: 'Each button, then none.', frames: FRAMES, held: HELD });
  // the program's scroll, set in the console's work memory, which the tools count from $C000, once it plays, and the
  // Dreamport starts there
  recording('later', { about: 'From later on.', start: 'scroll=50', frames: 60, held: [[0, []], [20, ['B']], [40, []]], onlyInOriginal: [{ at: 0, frames: PLAYS_FROM, held: [[0, []]], sets: [{ frame: PLAYS_FROM - 1, address: (RAM.scroll - 0xC000).toString(16).padStart(8, '0'), bytes: 1, value: 49 }] }] });
  const report = name => JSON.parse(readFileSync(join(resultFolder(inC, name), 'report.json'), 'utf8'));
  const write = options => {
    const numbers = numbersFor({ colour, playsFrom: PLAYS_FROM, ...options });
    writeFileSync(join(gameFolder(inC), 'src', 'main.c'), readFileSync(join(REPO, 'tools', 'test', 'made-up-gb.c'), 'utf8').replace(/@([A-Z_]+)@/g, (_, key) => numbers[key]));
  };

  run = dp('prove', inC, 'buttons');
  check(run.status !== 0 && report('buttons').firstDifference, `what new writes in C draws on the kit, and isn't the program: ${JSON.stringify(report('buttons').firstDifference)}`);
  write();
  run = dp('prove', inC, 'buttons');
  const same = report('buttons');
  check(run.status === 0 && same.matched === FRAMES && same.sound.heard, `the kit in C matches the emulator on every frame, picture and sound: ${same.matched} of ${same.frames}, ${JSON.stringify(same.firstDifference)}, ${JSON.stringify(same.sound.firstDifference)}`);
  if (run.status) console.log(run.out);
  // what ran in matching play, which the emulator tells the tools of with their change to it (libretro/gambatte.patch)
  const progress = () => JSON.parse(readFileSync(join(proofFolder(inC), 'progress.json'), 'utf8'));
  const ran = () => (progress().recordings.buttons?.functions ?? []).map(key => parseInt(key, 16));
  // its power-on runs on into the first frame compared, so its routines are among them
  check(mapped.every(place => ran().includes(place)),
    `prove says which functions ran in matching play, the interrupts' code and the power-on's that runs into the first frame compared: ${ran().map(place => place.toString(16)).join(', ')}`);
  check(!/outside every function of the code map: [\d,]+ in the cartridge/.test(run.out) && /outside every function of the code map: [\d,]+ outside the cartridge's program/.test(run.out),
    'and nothing ran outside them in the cartridge, and the copy of the sprites it runs from the high memory is said, as no code map can hold it');
  const { units } = JSON.parse(readFileSync(join(proofFolder(inC), 'played.json'), 'utf8'));
  check(units?.played > 0 && units.played < units.total, `played.json counts its instructions and the ways of its jumps with a condition: ${units?.played} of ${units?.total}`);
  run = dp('prove', inC, 'later');
  check(run.status === 0 && report('later').matched === 60, `and from a start point: ${report('later').matched} of ${report('later').frames}`);
  if (run.status) console.log(run.out);
  write({ moved: 2 });
  run = dp('prove', inC, 'buttons');
  check(run.status !== 0 && report('buttons').firstDifference?.frame === MOVE_SHOWS, `a sprite that moves too far is found where it first shows, at frame ${MOVE_SHOWS}: ${JSON.stringify(report('buttons').firstDifference)}`);
  write();

  // and with no tolerance at all: prove built the game, so the same WebAssembly runs here beside the emulator
  const { buildGame } = await import('../lib/c.mjs');
  const wasm = await buildGame(gameFolder(inC), join(WORK, `${id}.wasm`));
  const reference = libretroReference(machine);
  // the same pictures and sound, sample for sample, whether the emulator tells of its instructions or not
  {
    const heldAt = heldIn(HELD), pressed = Array.from({ length: FRAMES + 1 }, (_, frame) => (frame ? heldAt(frame - 1).reduce((bits, name) => bits | reference.KEY[name], 0) : 0));
    const watched = readCodeMap(game).functions.map(({ address, size }, index) => ({ address, size, index }));
    const untold = await reference.runOriginal({ copy, frames: pressed.length, buttons: pressed, sound: true });
    const told = await reference.runOriginal({ copy, frames: pressed.length, buttons: pressed, sound: true, functions: watched, played: true });
    const sameFrames = pressed.filter((_, frame) => untold.hashes[frame] === told.hashes[frame] && Buffer.from(untold.sound.read(frame)).equals(Buffer.from(told.sound.read(frame)))).length;
    untold.sound.close();
    told.sound.close();
    const vblank = watched.findIndex(f => f.address === at.vblank);
    // a Game Boy Color's power-on takes three frames and more, as it writes the colours and the tiles' palettes too
    check(sameFrames === pressed.length && told.ran.filter(list => list.includes(vblank)).length >= FRAMES - 4,
      `the emulator plays the same while it tells of every instruction, and its V-blank's code runs each frame: ${sameFrames} of ${pressed.length} frames, picture and sound`);
  }
  for (const [presses, list, frames] of [['the recording\'s presses', HELD, FRAMES], [`presses drawn from seed 0x${SEED.toString(16).toUpperCase()}`, drawn(machine), MANY]]) {
    const heldAt = heldIn(list);
    const buttons = Array.from({ length: frames + 1 }, (_, frame) => (frame ? heldAt(frame - 1).reduce((bits, name) => bits | reference.KEY[name], 0) : 0));
    const exact = `exact-${process.pid}-${id}.bin`;
    const theirs = await reference.runOriginal({ copy, frames: frames + 1, buttons, sound: true, pictures: buttons.map((_, frame) => frame), env: { DP_SOUND_EXACT: exact } });
    theirs.sound.close();
    const ours = playInC(wasm, rom, machine, frames, heldAt);
    const wrongPicture = ours.pictures.findIndex((picture, frame) => picture.some((pixel, i) => pixel !== theirs.pictures.get(frame + 1)[i]));
    check(wrongPicture < 0, `with ${presses}, every pixel of every frame is the emulator's${wrongPicture < 0 ? `: ${frames} frames, ${new Set(theirs.hashes).size} different pictures among them` : `, but not in frame ${wrongPicture}`}`);
    // the emulator's samples as it made them, each frame's count and then its samples, from the frame after its first
    const kept = readFileSync(join(LOCAL, 'tmp', exact)), heard = [];
    rmSync(join(LOCAL, 'tmp', exact), { force: true });
    for (let frame = 0, at = 0; frame <= frames; frame++) {
      const count = kept.readUInt32LE(at);
      if (frame) for (let i = 0; i < count * 2; i++) heard.push(kept.readInt16LE(at + 4 + i * 2));
      at += 4 + count * 4;
    }
    const wrongSample = ours.sound.findIndex((sample, i) => sample !== heard[i]), loudest = ours.sound.reduce((most, sample) => Math.max(most, Math.abs(sample)), 0);
    check(wrongSample < 0 && loudest > 4000 && heard.length >= ours.sound.length, `and every sample of its sound is the emulator's, all 16 bits${wrongSample < 0 ? `: ${ours.sound.length / 2} samples a side, the loudest ${loudest}` : `, but not sample ${wrongSample >> 1}, in frame ${Math.floor((wrongSample >> 1) / 548.625)}: ${ours.sound[wrongSample]} and the emulator's ${heard[wrongSample]}`}`);
  }
}

async function main() {
  tidy();
  mkdirSync(WORK, { recursive: true });
  for (const id of ['gb', 'gbc']) await oneConsole(id);
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
// A throwaway lower piece for the Stack demonstration (#2034), closed without merging.
// Its second commit, pushed before the piece on top carries it.
