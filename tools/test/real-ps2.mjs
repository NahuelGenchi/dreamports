// npm run test:real-ps2: the PlayStation 2's real emulator, Play!, built as it's built on a contributor's computer,
// at the commit tools/consoles.mjs fixes, running a small program written here (made-up-ps2.mjs) twice. Both runs must
// show the same pictures and give the same sound, at the numbers kit/consoles.js says, every sample the emulator mixes
// in the frame it was mixed in, and the picture must be the one the program draws. It isn't run on every pull request, as the emulator takes several minutes to build, and on Linux alone,
// as that's where the tools give it a graphics context (docs/CONSOLES.md).

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL } from '../lib/paths.mjs';
import { consoleOf } from '../consoles.mjs';
import { libretroReference } from '../libretro/reference.mjs';
import { BACKGROUND, SQUARE, SQUARE_SIZE, SQUARE_Y, STEP, madeUpPs2 } from './made-up-ps2.mjs';

const FRAMES = 600;
// frames whose picture is looked at, some after the square has gone back to the left edge, at frame 257
const LOOKED_AT = [0, 1, 60, 256, 257, 400, FRAMES - 1];
const WORK = join(LOCAL, 'test-real-ps2');

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};

// a GS colour in the tools' 15-bit colour, red in the low bits
const fifteen = colour => (colour & 0xF8) >> 3 | (colour >> 8 & 0xF8) << 2 | (colour >> 16 & 0xF8) << 7;
const sameSound = (a, b) => a.lengths.every((length, frame) => length === b.lengths[frame] && a.read(frame).every((sample, i) => sample === b.read(frame)[i]));

async function main() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const copy = join(WORK, 'program.elf');
  writeFileSync(copy, madeUpPs2().elf);
  const machine = consoleOf('ps2'), reference = libretroReference(machine);
  reference.ensureOriginal(message => console.log(message));

  console.log(`A small program on ${machine.name}'s real emulator, ${FRAMES} frames, twice`);
  const run = () => reference.runOriginal({ copy, frames: FRAMES, buttons: new Array(FRAMES).fill(0), pictures: LOOKED_AT, sound: true });
  // runOriginal stops if the emulator's sound rate or frame rate isn't what kit/consoles.js says
  const first = await run(), second = await run();
  const { width, height } = { width: machine.screen[0], height: machine.screen[1] };
  check(first.outside.sizes.length === 1 && first.outside.sizes[0].join() === `0,${width},${height}`, `its screen is ${width} by ${height} from the first frame, as kit/consoles.js says: ${JSON.stringify(first.outside.sizes)}`);
  check(first.hashes.every((hash, frame) => hash === second.hashes[frame]), 'both runs show the same pictures');
  // Play! mixes 45 samples at a time, so a frame has the 735 a frame lasts, give or take one block, after the first
  const perFrame = machine.sound * machine.frame[0] / machine.frame[1], lengths = [...first.sound.lengths];
  const samples = lengths.reduce((a, b) => a + b, 0), even = lengths.slice(1).every(length => Math.abs(length - perFrame) <= 45);
  check(sameSound(first.sound, second.sound), 'both runs give the same sound, each sample in the same frame');
  check(even && Math.abs(samples - FRAMES * perFrame) <= 90, `every frame has its own sound, ${perFrame} samples give or take 45: ${samples} in all, for ${FRAMES * perFrame}`);
  check(new Set(first.hashes).size === 512 / STEP + 1, `the square is in ${512 / STEP} places, round and round, after a black first frame: ${new Set(first.hashes).size} different pictures`);

  // the program draws once the first V-blank has started, so the first frame is black and the square is at 0 on the next
  const squareAt = picture => picture.subarray((SQUARE_Y + 1) * width, (SQUARE_Y + 2) * width).indexOf(fifteen(SQUARE));
  check(first.plain[0] === 0, 'frame 0 is black, before the program has drawn');
  for (const frame of LOOKED_AT.filter(frame => frame > 0)) {
    const picture = first.pictures.get(frame), x = (frame - 1) * STEP % 512;
    const square = picture[(SQUARE_Y + 1) * width + x], beside = picture[(SQUARE_Y + 1) * width + x + SQUARE_SIZE], above = picture[(SQUARE_Y - 1) * width + x];
    check(squareAt(picture) === x && square === fifteen(SQUARE) && beside === fifteen(BACKGROUND) && above === fifteen(BACKGROUND), `frame ${frame} shows the square at ${x}, ${SQUARE_Y}, ${SQUARE_SIZE} across, on the background`);
  }
  first.sound.close();
  second.sound.close();
  rmSync(WORK, { recursive: true, force: true });
  if (failures.length) {
    console.log(`\n${failures.length} failed.`);
    process.exit(1);
  }
  console.log('\nAll passed.');
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
