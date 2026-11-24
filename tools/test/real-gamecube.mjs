// npm run test:real-gamecube: the GameCube's real emulator, Dolphin, built as it's built on a contributor's computer, at
// the commit tools/consoles.mjs fixes, running a small program written here (made-up-gamecube.mjs) twice as a program
// alone and once from the disc that boots it. Every run must show the same pictures and give the same sound, at the
// numbers kit/consoles.js says, and the pictures must be the ones the program draws: its square where each field puts
// it, on its background, in the colour of the lines that field shows, the first controller's two words as the buttons
// held give them, and its tone, louder on the left. It isn't part of Check, as the emulator takes a long time to build: the GameCube's workflow runs
// it on Linux, macOS and Windows (.github/workflows/gamecube.yml), each with --write <file>, which keeps every frame's
// picture and sound as hashes, and then with --compare <file> <file>..., which finds them the same on every computer.
// --core says the name the tools give the built emulator, for the workflow to keep it by.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { LOCAL } from '../lib/paths.mjs';
import { consoleOf } from '../consoles.mjs';
import { coreFile } from '../libretro/build.mjs';
import { libretroReference } from '../libretro/reference.mjs';
import { BACKGROUND, BITS_GAP, BITS_X, BITS_Y, BIT_WIDTH, HEIGHT, LOUD, OFF, ON, PERIOD, SQUARE, SQUARE_ODD, SQUARE_SIZE, SQUARE_Y, STEP, TRAVEL, WIDTH, madeUpGameCube, madeUpGameCubeDisc } from './made-up-gamecube.mjs';

const FRAMES = 600;
// frames whose picture is looked at, some after the square has gone back to the left edge
const LOOKED_AT = [2, 3, 60, 101, 201, 256, 257, 258, 301, 400, FRAMES - 1];
// what's held, and from which frame, and what the controller's two words are in the picture a frame later: A, the
// main stick left and the C stick up together, and the left trigger to its click
const HELD = [[100, ['A'], 0x01808080, 0x80800000], [200, ['STICK_LEFT', 'C_UP'], 0x00800180, 0x80FF0000], [300, ['L'], 0x00C08080, 0x8080FF00]];
const WORK = join(LOCAL, 'test-real-gamecube');
// The console shows a field at a time, every other line of the framebuffer, so a picture has half the framebuffer's
// lines, and the square is on the same rows of both fields
const FIELD = HEIGHT / 2, ROW = SQUARE_Y / 2, ROWS = SQUARE_SIZE / 2;

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};

// A pair of the framebuffer's pixels in the tools' 15-bit colour, red in the low bits. A console sends Y, Cb and Cr to
// its video encoder, which makes the picture's signal from them, so red, green and blue are the reference's, which
// works them out in single floats by the sums of the standard for television pictures, ITU-R BT.601, cut to whole numbers
const f = Math.fround, cut = value => Math.max(0, Math.min(255, Math.trunc(value)));
function fifteen(pair) {
  const y = (pair >>> 24) - 16, u = (pair >>> 16 & 0xFF) - 128, v = (pair & 0xFF) - 128, luma = f(f(1.164) * y);
  const r = cut(f(luma + f(f(1.596) * v))), g = cut(f(f(luma - f(f(0.392) * u)) - f(f(0.813) * v))), b = cut(f(luma + f(f(2.017) * u)));
  return r >> 3 | (g >> 3) << 5 | (b >> 3) << 10;
}
const sameSound = (a, b) => a.lengths.every((length, frame) => length === b.lengths[frame] && a.read(frame).every((sample, i) => sample === b.read(frame)[i]));

async function main() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const program = madeUpGameCube(), dol = join(WORK, 'program.dol'), iso = join(WORK, 'disc.iso');
  writeFileSync(dol, program.dol);
  writeFileSync(iso, madeUpGameCubeDisc({ program }).image);
  const machine = consoleOf('gamecube'), reference = libretroReference(machine);
  reference.ensureOriginal(message => console.log(message));

  console.log(`A small program on ${machine.name}'s real emulator, ${FRAMES} frames, twice alone and once from its disc`);
  // each press for one frame; the disc's a frame sooner, as its program starts a frame sooner
  const buttonsAt = sooner => Array.from({ length: FRAMES }, (_, frame) => HELD.find(([at]) => at - sooner === frame)?.[1].reduce((mask, name) => mask | machine.keys[name], 0) ?? 0);
  const run = (copy, sooner) => reference.runOriginal({ copy, frames: FRAMES, buttons: buttonsAt(sooner), pictures: LOOKED_AT, sound: true });
  // runOriginal stops if the emulator's sound rate or frame rate isn't what kit/consoles.js says
  const first = await run(dol, 0), second = await run(dol, 0), booted = await run(iso, 1);
  const sizes = first.outside.sizes.filter(([frame]) => frame >= LOOKED_AT[0]);
  check(first.outside.sizes.length && first.outside.sizes.at(-1).slice(1).join() === `${WIDTH},${FIELD}` && sizes.length <= 1, `its screen is ${WIDTH} by ${FIELD}, a field of its ${HEIGHT} lines: ${JSON.stringify(first.outside.sizes)}`);
  check(machine.screen.join() === `${WIDTH},${FIELD}`, 'which is the screen kit/consoles.js has for the console');
  check(first.hashes.every((hash, frame) => hash === second.hashes[frame]), 'both runs show the same pictures');
  check(sameSound(first.sound, second.sound), 'both runs give the same sound, each sample in the same frame');

  // the square moves a step each field and goes back to the left edge, the same picture TRAVEL / STEP fields later, over
  // frames with nothing held then or TRAVEL / STEP frames on
  const repeats = first.hashes.slice(LOOKED_AT[0], 40).every((hash, n) => hash === first.hashes[LOOKED_AT[0] + n + TRAVEL / STEP]);
  check(repeats && new Set(first.hashes.slice(LOOKED_AT[0], 40)).size === 40 - LOOKED_AT[0], `the square is somewhere else each field, and in the same place ${TRAVEL / STEP} fields later`);
  const square = fifteen(SQUARE), odd = fifteen(SQUARE_ODD), background = fifteen(BACKGROUND);
  const squareAt = picture => picture.subarray((ROW + 1) * WIDTH, (ROW + 2) * WIDTH).findIndex(c => c === square || c === odd);
  const start = squareAt(first.pictures.get(LOOKED_AT[0]));
  check(start >= 0 && start % STEP === 0, `frame ${LOOKED_AT[0]} shows the square, in a colour the console's video encoder gives its Y, Cb and Cr: at ${start}`);
  // a word of the controller's, from its blocks: null where a block is neither colour
  const word = (picture, line) => {
    let value = 0;
    for (let bit = 0; bit < 32; bit++) {
      const colour = picture[line * WIDTH + BITS_X + bit * BIT_WIDTH + BIT_WIDTH / 2];
      if (colour !== fifteen(ON) && colour !== fifteen(OFF)) return null;
      value = (value * 2 + (colour === fifteen(ON) ? 1 : 0)) >>> 0;
    }
    return value;
  };
  const hexOf = value => (value === null ? 'none' : `0x${value.toString(16).toUpperCase().padStart(8, '0')}`);
  for (const frame of LOOKED_AT) {
    const picture = first.pictures.get(frame), x = (start + (frame - LOOKED_AT[0]) * STEP) % TRAVEL, row = (ROW + 1) * WIDTH;
    // a frame with an odd number shows the top field, the framebuffer's even lines, and one with an even number the bottom
    const colour = frame % 2 ? square : odd;
    const rows = [ROW, ROW + ROWS - 1].every(y => picture[y * WIDTH + x] === colour) && picture[(ROW - 1) * WIDTH + x] === background && picture[(ROW + ROWS) * WIDTH + x] === background;
    const across = picture[row + x + SQUARE_SIZE - 1] === colour && picture[row + x + SQUARE_SIZE] === background && (x === 0 || picture[row + x - 1] === background);
    check(squareAt(picture) === x && rows && across, `frame ${frame} shows the square at ${x}, ${ROW}, ${SQUARE_SIZE} across and ${ROWS} down, on the background, in the ${frame % 2 ? 'top' : 'bottom'} field's colour`);
    const [, held, hi, lo] = HELD.find(([at]) => at + 1 === frame) ?? [0, [], 0x00808080, 0x80800000];
    const shown = [word(picture, BITS_Y / 2 + 1), word(picture, (BITS_Y + BITS_GAP) / 2 + 1)];
    check(shown[0] === hi && shown[1] === lo, `and the first controller's words with ${held.join(' and ') || 'nothing'} held the frame before: ${hexOf(shown[0])} ${hexOf(shown[1])}, for ${hexOf(hi)} ${hexOf(lo)}`);
  }

  // the tone: a square wave, as loud as the program's samples, with as many samples a frame as a frame lasts
  const perFrame = machine.sound * machine.frame[0] / machine.frame[1], lengths = [...first.sound.lengths];
  const samples = lengths.reduce((a, b) => a + b, 0);
  check(Math.abs(samples - FRAMES * perFrame) <= perFrame * 2, `the sound lasts what the frames do: ${samples} samples for ${FRAMES * perFrame}`);
  const heard = Int16Array.from(first.sound.read(400)), loud = LOUD >> 6;
  for (const [side, level] of [['left', loud], ['right', loud >> 1]]) {
    const own = heard.filter((_, i) => i % 2 === (side === 'left' ? 0 : 1));
    const high = own.filter(sample => Math.abs(sample - level) <= 1).length, low = own.filter(sample => Math.abs(sample + level) <= 1).length;
    check(own.length > 0 && high + low >= own.length * 0.9 && Math.abs(high - low) <= PERIOD, `frame 400's sound is the tone, on the ${side} half its samples ${level} and half ${-level}: ${high} and ${low} of ${own.length}`);
  }
  let turns = 0;
  for (let i = 2; i < heard.length; i += 2) if (heard[i] > 0 !== heard[i - 2] > 0) turns++;
  const wanted = heard.length / 2 / (PERIOD / 2);
  check(Math.abs(turns - wanted) <= 2, `and it turns over every ${PERIOD / 2} samples: ${turns} times in the frame, for ${wanted.toFixed(1)}`);

  // the same program booted from its disc, through the disc's own apploader, starts a frame sooner, its presses with it:
  // each frame of it shows what the program alone shows a frame later, field and words and all
  const same = booted.hashes.slice(1, FRAMES - 1).every((hash, n) => hash === first.hashes[n + 2]);
  check(same, 'booted from its disc it shows the same pictures, a frame sooner, the same field and the same words in each');

  // every frame's picture and sound, for the other computers to be held to
  const write = process.argv.indexOf('--write');
  if (write > 0) {
    const heardIn = run => createHash('sha1').update(Buffer.concat(lengths.map((_, frame) => Buffer.from(Int16Array.from(run.sound.read(frame)).buffer)))).digest('hex');
    writeFileSync(process.argv[write + 1], JSON.stringify({ alone: { pictures: [...first.hashes], lengths, sound: heardIn(first) }, booted: { pictures: [...booted.hashes], lengths: [...booted.sound.lengths], sound: heardIn(booted) } }));
  }
  for (const each of [first, second, booted]) each.sound.close();
  rmSync(WORK, { recursive: true, force: true });
  if (failures.length) {
    console.log(`\n${failures.length} failed.`);
    process.exit(1);
  }
  console.log('\nAll passed.');
}

// the same on every computer: each file against the first
function compare(files) {
  const [base, ...others] = files.map(file => ({ file, ...JSON.parse(readFileSync(file, 'utf8')) }));
  for (const other of others) {
    for (const run of ['alone', 'booted']) {
      const frame = base[run].pictures.findIndex((hash, n) => hash !== other[run].pictures[n]);
      check(frame < 0 && base[run].pictures.length === other[run].pictures.length, `${other.file} has ${run === 'alone' ? 'the program alone' : 'the disc'} showing the pictures ${base.file} has, all ${base[run].pictures.length}${frame < 0 ? '' : `: frame ${frame} differs`}`);
      check(base[run].sound === other[run].sound && base[run].lengths.join() === other[run].lengths.join(), `and giving the same sound, each sample in the same frame`);
    }
  }
  if (failures.length) process.exit(1);
  console.log('\nThe same on every computer.');
}

const comparing = process.argv.indexOf('--compare');
if (process.argv.includes('--core')) console.log(basename(coreFile(consoleOf('gamecube').core)).replace(/\.[a-z]+$/, ''));
else if (comparing > 0) compare(process.argv.slice(comparing + 1));
else main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
