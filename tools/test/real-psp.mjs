// npm run test:real-psp: the PlayStation Portable's real emulator, PPSSPP, built as it's built on a contributor's
// computer, at the commit tools/consoles.mjs fixes, running a small program written here (made-up-psp.mjs) twice. Both
// runs must show the same pictures and give the same sound, at the numbers kit/consoles.js says, every sample in its
// frame, the picture must be the one the program paints, and a button held must show on the frame it's read. It isn't
// part of Check, as the emulator takes a long while to build, and it runs on Windows, macOS and Linux.
//
// With --write FILE it also writes what this computer saw, each frame's picture as its hash and each frame's sound as a
// hash of its samples, and --compare FILE FILE… finds them the same in every file, for the job that compares the three
// systems (.github/workflows/psp.yml).

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL } from '../lib/paths.mjs';
import { consoleOf } from '../consoles.mjs';
import { libretroReference } from '../libretro/reference.mjs';
import { BACKGROUND, BAR, BAR_Y, HALF_WAVE, SQUARE, SQUARE_SIZE, SQUARE_Y, STEP, TURN, madeUpPsp } from './made-up-psp.mjs';

const FRAMES = 600;
// frames whose picture is looked at, some after the square has gone back to the left edge
const LOOKED_AT = [1, 2, 60, 224, 225, 226, 400, FRAMES - 1];
// the frames a button is held on, and the button
const HELD_FROM = 100, HELD_TO = 110;
// the frames around them whose picture shows whether the bar is wide
const BARS = [HELD_FROM - 1, HELD_FROM, HELD_FROM + 1, HELD_FROM + 2, HELD_TO, HELD_TO + 1, HELD_TO + 2];
const WORK = join(LOCAL, 'test-real-psp');

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};

// one of the console's colours in the tools' 15-bit colour, red in the low bits
const fifteen = colour => (colour & 0xF8) >> 3 | (colour >> 8 & 0xF8) << 2 | (colour >> 16 & 0xF8) << 7;
const sameSound = (a, b) => a.lengths.every((length, frame) => length === b.lengths[frame] && a.read(frame).every((sample, i) => sample === b.read(frame)[i]));

// what the files of several computers hold must be the same in every frame
function compare(files) {
  const seen = files.map(file => JSON.parse(readFileSync(file, 'utf8')));
  for (const [index, other] of seen.entries()) {
    if (!index) continue;
    for (const kind of ['pictures', 'sound']) {
      const frame = seen[0][kind].findIndex((hash, at) => hash !== other[kind][at]);
      check(frame < 0 && seen[0][kind].length === other[kind].length, `${files[index]} has the same ${kind} as ${files[0]} in every frame${frame < 0 ? '' : `: frame ${frame} differs`}`);
    }
  }
  if (failures.length) process.exit(1);
  console.log('\nThe same on each.');
}

async function main() {
  const asked = process.argv.slice(2);
  if (asked[0] === '--compare') return compare(asked.slice(1));
  const written = asked[0] === '--write' ? asked[1] : null;
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const copy = join(WORK, 'program.elf');
  writeFileSync(copy, madeUpPsp().elf);
  const machine = consoleOf('psp'), reference = libretroReference(machine);
  reference.ensureOriginal(message => console.log(message));

  console.log(`A small program on ${machine.name}'s real emulator, ${FRAMES} frames, twice`);
  const buttons = new Array(FRAMES).fill(0);
  for (let frame = HELD_FROM; frame < HELD_TO; frame++) buttons[frame] = machine.keys.CROSS;
  const run = () => reference.runOriginal({ copy, frames: FRAMES, buttons, pictures: [...new Set([...LOOKED_AT, ...BARS])].sort((a, b) => a - b), sound: true });
  // runOriginal stops if the emulator's sound rate or frame rate isn't what kit/consoles.js says
  const first = await run(), second = await run();
  const [width, height] = machine.screen;
  check(first.outside.sizes.at(-1).slice(1).join() === `${width},${height}`, `its screen is ${width} by ${height}, as kit/consoles.js says: ${JSON.stringify(first.outside.sizes)}`);
  check(first.hashes.every((hash, frame) => hash === second.hashes[frame]), 'both runs show the same pictures');
  const perFrame = machine.sound * machine.frame[0] / machine.frame[1], lengths = [...first.sound.lengths];
  const samples = lengths.reduce((a, b) => a + b, 0);
  check(sameSound(first.sound, second.sound), 'both runs give the same sound, each sample in the same frame');
  // the console mixes 64 samples at a time
  const even = lengths.slice(2).every(length => Math.abs(length - perFrame) <= 64);
  check(even && Math.abs(samples - FRAMES * perFrame) <= 2 * perFrame, `every frame has its own sound, ${perFrame.toFixed(1)} samples give or take 64: ${samples} in all, for ${Math.round(FRAMES * perFrame)}`);
  // the wave: once it has started, each sample is as loud as the last or the other way up, and it turns every HALF_WAVE
  const heard = [];
  for (let frame = 0; frame < FRAMES; frame++) for (const sample of first.sound.read(frame)) heard.push(sample);
  const left = heard.filter((_, i) => i % 2 === 0), start = left.findIndex(sample => sample !== 0), loud = Math.abs(left[start]);
  let turns = 0, wrong = 0;
  for (let i = start + 1; i < left.length; i++) {
    if (Math.abs(left[i]) !== loud) wrong++;
    else if (left[i] !== left[i - 1]) turns++;
  }
  const expected = (left.length - start) / HALF_WAVE;
  check(start >= 0 && loud > 0 && wrong === 0 && Math.abs(turns - expected) <= 2, `the sound is the program's square wave, turning every ${HALF_WAVE} samples: ${turns} turns for ${expected.toFixed(1)}, ${wrong} samples of another loudness`);

  // where the square is: the first frame that shows it gives the frame the program's count starts from
  const squareAt = picture => picture.subarray((SQUARE_Y + 1) * width, (SQUARE_Y + 2) * width).indexOf(fifteen(SQUARE));
  const barWidth = picture => { let across = 0; while (across < width && picture[(BAR_Y + 1) * width + across] === fifteen(BAR)) across++; return across; };
  const shownFrom = LOOKED_AT.find(frame => squareAt(first.pictures.get(frame)) >= 0);
  const started = shownFrom - squareAt(first.pictures.get(shownFrom)) / STEP;
  for (const frame of LOOKED_AT.filter(frame => frame >= shownFrom)) {
    const picture = first.pictures.get(frame), x = (frame - started) * STEP % TURN;
    const square = picture[(SQUARE_Y + 1) * width + x], beside = picture[(SQUARE_Y + 1) * width + x + SQUARE_SIZE], above = picture[(SQUARE_Y - 1) * width + x];
    check(squareAt(picture) === x && square === fifteen(SQUARE) && beside === fifteen(BACKGROUND) && above === fifteen(BACKGROUND), `frame ${frame} shows the square at ${x}, ${SQUARE_Y}, ${SQUARE_SIZE} across, on the background`);
  }
  check(new Set(first.hashes.slice(shownFrom, HELD_FROM)).size === Math.min(HELD_FROM - shownFrom, TURN / STEP), 'every frame shows the square in its own place');
  // the bar is one pixel wide with nothing held, and wider while CROSS is, whose bit the console keeps at 0x4000
  const bars = BARS.map(frame => [frame, barWidth(first.pictures.get(frame))]);
  const wide = (0x4000 >> 8 & 0xFF) + 1, onFrom = bars.find(([, bar]) => bar === wide)?.[0], offFrom = bars.find(([frame, bar]) => frame >= HELD_TO && bar === 1)?.[0];
  check(bars[0][1] === 1 && onFrom !== undefined && offFrom !== undefined && offFrom - onFrom === HELD_TO - HELD_FROM, `a button held from frame ${HELD_FROM} to ${HELD_TO} shows from frame ${onFrom} to ${offFrom}: ${JSON.stringify(bars)}`);
  console.log(`  the emulator runs at ${first.outside.fps} frames a second and mixes ${first.outside.rate} samples a second; the square shows from frame ${shownFrom}`);
  if (written) {
    const sound = lengths.map((_, frame) => createHash('sha1').update(Buffer.from(Int16Array.from(first.sound.read(frame)).buffer)).digest('hex').slice(0, 16));
    // as plain lists, which JSON keeps as they are, where it would write the hashes' typed array as an object
    writeFileSync(written, `${JSON.stringify({ pictures: Array.from(first.hashes), sound })}\n`);
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
