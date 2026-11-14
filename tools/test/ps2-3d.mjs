// npm run test:ps2-3d: how a 3D game is proven, tried on a small 3D program written here (made-up-ps2.mjs), on the
// PlayStation 2's real emulator. A 3D picture depends on what draws it, so a 3D game is proven by its draw list: what the
// console gives its graphics chip each frame, compared exactly (docs/STANDARD.md). This shows the three things that rests on:
//
// - the original's draw list is the same in every run;
// - the program written again, here in JavaScript with the console's own arithmetic, gives the same draw list bit for bit,
//   which is what a Dreamport has to do;
// - on a computer with a graphics card Mesa knows, the card and Mesa's llvmpipe are given the same draw list and draw
//   different pictures, while a flat program's pictures come out the same.
//
// It isn't run on every pull request, as the emulator takes minutes to build, and on Linux alone (docs/CONSOLES.md).

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL } from '../lib/paths.mjs';
import { consoleOf } from '../consoles.mjs';
import { libretroReference } from '../libretro/reference.mjs';
import { BACKGROUND_3D, COS, MIDDLE, RADIUS, SIN, STILL, TURNING, madeUpPs2, madeUpPs2In3d } from './made-up-ps2.mjs';

const FRAMES = 600;
const WORK = join(LOCAL, 'test-ps2-3d');
const [WIDTH, HEIGHT] = consoleOf('ps2').screen;

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
const said = what => console.log(`  found: ${what}`);

// The console's float arithmetic: a sum or a product is cut towards zero to a float, where a computer rounds to the
// nearest. Each is worked out in a double, which holds these exactly, and stepped back if rounding took it further out.
const steps = new Float32Array(1), bits = new Int32Array(steps.buffer);
function cut(exact) {
  steps[0] = exact;
  if (Math.abs(steps[0]) > Math.abs(exact)) bits[0] -= 1;
  return steps[0];
}
const add = (a, b) => cut(a + b), subtract = (a, b) => cut(a - b), multiply = (a, b) => cut(a * b);

// The draw list's hash as the emulator keeps it (tools/libretro/play.patch): FNV-1a over each write, in order
function hashOf(writes) {
  let hash = 0x811C9DC5;
  const mix = byte => { hash = Math.imul(hash ^ byte, 0x01000193); };
  for (const write of writes) {
    if (write.screen) for (const word of write.screen) for (let i = 0; i < 4; i++) mix(word >>> (i * 8) & 255);
    else {
      mix(write[0]);
      for (const word of [write[1], write[2]]) for (let i = 0; i < 4; i++) mix(word >>> (i * 8) & 255);
    }
  }
  return hash >>> 0;
}

// The program written again: each frame's draw list, as the program gives it to the GS. This is all a Dreamport of it
// would have to get right, whatever it then draws the list with.
function* drawLists() {
  const XYZ = (x, y) => (x << 4 | y << 20) >>> 0, ONE = 0x3F800000, FBW = WIDTH / 64;
  // before its first V-blank it only says what the screen shows: each register's two halves, as it writes them
  const GS = 0x12000000;
  yield [[0x00, 0xFF25, 0], [0x20, 1, 0], [0x70, FBW << 9, 0], [0x80, (656 | 36 << 12 | 3 << 23) >>> 0, (WIDTH * 4 - 1 | (HEIGHT - 1) << 12) >>> 0]]
    .flatMap(([register, low, high]) => [{ screen: [GS + register, low] }, { screen: [GS + register + 4, high] }]);
  let x = RADIUS, y = 0;
  for (;;) {
    const xs = multiply(x, 16), ys = multiply(y, 16), mx = MIDDLE[0] * 16, my = MIDDLE[1] * 16;
    const corner = (across, down) => ((Math.trunc(across) & 0xFFFF) | Math.trunc(down) << 16) >>> 0;
    const corners = [corner(add(mx, xs), add(my, ys)), corner(subtract(mx, ys), add(my, xs)), corner(subtract(mx, xs), subtract(my, ys))];
    yield [
      [0x4C, FBW << 16, 0], [0x40, (WIDTH - 1) << 16, (HEIGHT - 1) << 16], [0x18, 0, 0], [0x4E, Math.ceil(WIDTH * HEIGHT * 4 / 8192), 0], [0x1A, 1, 0],
      [0x47, 0x30000, 0], [0x00, 6, 0], [0x01, BACKGROUND_3D, ONE], [0x05, XYZ(0, 0), 0], [0x05, XYZ(WIDTH, HEIGHT), 0],
      [0x47, 0x50000, 0], [0x00, 0xB, 0],
      ...STILL.flatMap(([sx, sy, colour, depth]) => [[0x01, colour, ONE], [0x05, XYZ(sx, sy), depth]]),
      ...TURNING.flatMap(([colour, depth], i) => [[0x01, colour, ONE], [0x05, corners[i], depth]]),
    ];
    const turned = subtract(multiply(x, COS), multiply(y, SIN));
    y = add(multiply(x, SIN), multiply(y, COS));
    x = turned;
  }
}

const differing = (a, b) => a.reduce((count, value, i) => count + (value !== b[i]), 0);
// how many pixels of two pictures differ, and the most any colour is out by, in the 32 steps the tools keep of each
function apart(a, b) {
  let pixels = 0, most = 0;
  for (let p = 0; p < a.length; p++) {
    if (a[p] === b[p]) continue;
    pixels++;
    for (const shift of [0, 5, 10]) most = Math.max(most, Math.abs((a[p] >> shift & 31) - (b[p] >> shift & 31)));
  }
  return { pixels, most };
}

async function main() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const flat = join(WORK, 'flat.elf'), solid = join(WORK, '3d.elf');
  writeFileSync(flat, madeUpPs2().elf);
  writeFileSync(solid, madeUpPs2In3d().elf);
  const machine = consoleOf('ps2'), reference = libretroReference(machine);
  reference.ensureOriginal(message => console.log(message));
  const LOOKED_AT = [1, 150, 300, 450, FRAMES - 1];
  const run = copy => reference.runOriginal({ copy, frames: FRAMES, buttons: new Array(FRAMES).fill(0), pictures: LOOKED_AT, draws: true });
  // on whatever this computer draws with, where the tools ask Mesa for llvmpipe
  const onAnything = async copy => {
    process.env.DP_ANY_GRAPHICS = '1';
    try {
      return await run(copy);
    } finally {
      delete process.env.DP_ANY_GRAPHICS;
    }
  };

  console.log(`A small 3D program on ${machine.name}'s real emulator, ${FRAMES} frames`);
  const first = await run(solid), second = await run(solid);
  check(first.draws.hashes.every((hash, frame) => hash === second.draws.hashes[frame]), 'the original gives the same draw list in both runs, every frame');
  check(new Set(first.draws.hashes).size > FRAMES / 2 && first.draws.counts[1] === 24, `the triangle turns: ${new Set(first.draws.hashes).size} different draw lists, ${first.draws.counts[1]} writes a frame`);

  const written = drawLists(), expected = Array.from({ length: FRAMES }, () => hashOf(written.next().value));
  const wrong = first.draws.hashes.findIndex((hash, frame) => hash !== expected[frame]);
  check(wrong < 0, wrong < 0 ? `the program written again gives the same draw list, bit for bit, on all ${FRAMES} frames` : `the program written again gives the same draw list: frame ${wrong} differs`);
  // with a computer's own rounding the lists part, so the console's arithmetic is what makes them match:
  // the same turn with each kind of rounding, to the first frame where a corner lands on another sixteenth of a pixel
  let cutX = RADIUS, cutY = 0, nearX = RADIUS, nearY = 0, parts = -1;
  for (let frame = 1; frame < FRAMES && parts < 0; frame++) {
    const cutCorner = [Math.trunc(add(MIDDLE[0] * 16, multiply(cutX, 16))), Math.trunc(add(MIDDLE[1] * 16, multiply(cutY, 16)))];
    const nearCorner = [Math.trunc(Math.fround(MIDDLE[0] * 16 + Math.fround(nearX * 16))), Math.trunc(Math.fround(MIDDLE[1] * 16 + Math.fround(nearY * 16)))];
    if (cutCorner[0] !== nearCorner[0] || cutCorner[1] !== nearCorner[1]) parts = frame;
    const turned = subtract(multiply(cutX, COS), multiply(cutY, SIN));
    cutY = add(multiply(cutX, SIN), multiply(cutY, COS));
    cutX = turned;
    const nearTurned = Math.fround(Math.fround(nearX * COS) - Math.fround(nearY * SIN));
    nearY = Math.fround(Math.fround(nearX * SIN) + Math.fround(nearY * COS));
    nearX = nearTurned;
  }
  check(parts > 0, `with a computer's own rounding, not the console's, a corner is on another sixteenth of a pixel by frame ${parts}`);

  console.log('The same draw list, drawn by this computer\'s graphics card');
  let other = null;
  try {
    other = await onAnything(solid);
  } catch (error) {
    said(`this computer gives no other graphics context to compare with: ${error.message.split('\n')[0]}`);
  }
  if (other && /llvmpipe/.test(other.outside.drawnBy)) said('this computer draws with llvmpipe whatever is asked, so there\'s nothing to compare');
  else if (other) {
    said(`drawn by ${other.outside.drawnBy}, next to ${first.outside.drawnBy}`);
    check(other.draws.hashes.every((hash, frame) => hash === first.draws.hashes[frame]), 'the draw list is the same on both, every frame');
    const pictures = differing([...first.hashes], [...other.hashes]);
    const worst = LOOKED_AT.map(frame => ({ frame, ...apart(first.pictures.get(frame), other.pictures.get(frame)) })).sort((a, b) => b.pixels - a.pixels)[0];
    check(pictures > 0, `the pictures aren't: ${pictures} of ${FRAMES} frames differ, frame ${worst.frame} in ${worst.pixels} of ${WIDTH * HEIGHT} pixels, by up to ${worst.most} of a colour's 32 steps`);
    const flatHere = await run(flat), flatThere = await onAnything(flat);
    const flatPictures = differing([...flatHere.hashes], [...flatThere.hashes]);
    said(`the flat program's pictures, a square on a background: ${flatPictures} of ${FRAMES} frames differ`);
  }

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
