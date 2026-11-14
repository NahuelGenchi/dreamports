// npm run test:real-ps2: the PlayStation 2's real emulator, Play!, built as it's built on a contributor's computer,
// at the commit tools/consoles.mjs fixes, running a small program written here (made-up-ps2.mjs) twice. Both runs must
// show the same pictures, at the numbers kit/consoles.js says, and the picture must be the one the program draws. Its
// sound isn't tied to frames yet (docs/CONSOLES.md, The PlayStation 2), so how the sound came out is said, failing
// nothing. It isn't run on every pull request, as the emulator takes several minutes to build, and on Linux alone,
// as that's where the tools give it a graphics context (docs/CONSOLES.md).

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL } from '../lib/paths.mjs';
import { consoleOf } from '../consoles.mjs';
import { libretroReference } from '../libretro/reference.mjs';
import { BACKGROUND, SQUARE, SQUARE_SIZE, SQUARE_Y, STEP, madeUpPs2 } from './made-up-ps2.mjs';

const FRAMES = 600;
// frames whose picture is looked at, some after the square has gone back to the left edge
const LOOKED_AT = [0, 60, 255, 256, 400, FRAMES - 1];
const WORK = join(LOCAL, 'test-real-ps2');

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
// what isn't checked yet, said as it came out
const notYet = (ok, what) => console.log(`  ${ok ? 'this time' : 'not yet'}: ${what}`);

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
  const samples = first.sound.lengths.reduce((a, b) => a + b, 0), wanted = FRAMES * machine.sound * machine.frame[0] / machine.frame[1];
  notYet(sameSound(first.sound, second.sound), 'both runs give the same sound, each block of it in the same frame');
  notYet(samples === wanted, `the emulator hands over every sample it mixes: ${samples} of ${wanted}`);
  check(new Set(first.hashes).size === 512 / STEP, `the square is in ${512 / STEP} places, round and round: ${new Set(first.hashes).size} different pictures`);

  // the emulator runs a frame ahead or more, so the square's place is read off the first frame looked at
  const squareAt = picture => {
    const line = picture.subarray((SQUARE_Y + 1) * width, (SQUARE_Y + 2) * width);
    return line.indexOf(fifteen(SQUARE));
  };
  const start = squareAt(first.pictures.get(0));
  for (const frame of LOOKED_AT) {
    const picture = first.pictures.get(frame), x = (start + frame * STEP) % 512;
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
