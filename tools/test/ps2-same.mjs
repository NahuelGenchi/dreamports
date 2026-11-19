// npm run test:ps2-same -- --write <file>, or --compare <file> <file>: the PlayStation 2's emulator gives the same proofs
// on every computer the tools run on. --write runs the small programs of made-up-ps2.mjs in Play!, 300 frames each, and
// writes what a proof compares of them: each frame's draw list and how many things it held, each frame's sound, sample
// by sample, and the program's own bytes in the console's memory every 30 frames, where it keeps what changes, with each
// frame's picture. --compare reads two such files, one from Linux and one from a Mac in the Mac workflow, and fails on
// any draw list, sound or memory that isn't the same in both, and on any picture of a program proven by its pictures.
// The pictures of one proven by its draw list are drawn by each computer's own renderer, llvmpipe or Apple's, and are
// only counted (docs/CONSOLES.md). A program added to PROGRAMS is compared too. It runs on Linux and macOS alone, where
// the tools give the emulator a graphics context.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL } from '../lib/paths.mjs';
import { consoleOf } from '../consoles.mjs';
import { libretroReference } from '../libretro/reference.mjs';
import { LOAD_AT, madeUpPs2, madeUpPs2In3d, madeUpPs2OnVu1, madeUpPs2Textured } from './made-up-ps2.mjs';
import { madeUpPs2Layout } from './made-up-ps2-gs.mjs';
import { madeUpPs2Sound } from './made-up-ps2-iop.mjs';

// each program, and what it's proven by
const PROGRAMS = {
  flat: [madeUpPs2, 'pictures'],
  '3d': [madeUpPs2In3d, 'draw lists'],
  vu1: [madeUpPs2OnVu1, 'draw lists'],
  textured: [madeUpPs2Textured, 'pictures'],
  // pictures moved into the GS's memory in one format and read in another, and read back into the console's memory
  layout32: [() => madeUpPs2Layout(32), 'pictures'],
  layout16: [() => madeUpPs2Layout(16), 'pictures'],
  // a module on the IOP playing through the sound chip, reverb and all, which is the sound that's compared
  sound: [madeUpPs2Sound, 'pictures'],
};
const FRAMES = 300, MEMORY_EVERY = 30;
const WORK = join(LOCAL, 'test-ps2-same');
const USAGE = 'Usage: node tools/test/ps2-same.mjs --write <file> | --compare <file> <file>';

const hashOf = bytes => createHash('sha1').update(bytes).digest('hex').slice(0, 16);

async function write(file) {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const machine = consoleOf('ps2'), reference = libretroReference(machine);
  reference.ensureOriginal(message => console.log(message));
  const found = { computer: `${process.platform} ${process.arch}`, frames: FRAMES, programs: {} };
  for (const [name, [make, provenBy]] of Object.entries(PROGRAMS)) {
    const { elf } = make(), copy = join(WORK, `${name}.elf`);
    writeFileSync(copy, elf);
    const words = Math.floor((elf.length - 0x80) / 4), looked = [];
    for (let frame = MEMORY_EVERY - 1; frame < FRAMES; frame += MEMORY_EVERY) looked.push(frame);
    const reads = looked.flatMap(frame => Array.from({ length: words }, (_, i) => ({ frame, address: LOAD_AT + i * 4, bytes: 4 })));
    const run = await reference.runOriginal({ copy, frames: FRAMES, buttons: new Array(FRAMES).fill(0), draws: true, sound: true, reads });
    const values = Uint32Array.from(run.outside.reads);
    found.programs[name] = {
      provenBy,
      drawnBy: run.outside.drawnBy,
      draws: [...run.draws.hashes],
      things: [...run.draws.counts],
      sound: Array.from({ length: FRAMES }, (_, frame) => `${run.sound.lengths[frame]}:${hashOf(run.sound.read(frame))}`),
      memory: looked.map((frame, i) => `${frame}:${hashOf(values.subarray(i * words, (i + 1) * words))}`),
      pictures: [...run.hashes],
    };
    run.sound.close();
    console.log(`${name}: ${FRAMES} frames, drawn by ${run.outside.drawnBy}, ${new Set(run.draws.hashes).size} different draw lists, ${words * 4} bytes of its memory read at ${looked.length} frames`);
  }
  rmSync(WORK, { recursive: true, force: true });
  writeFileSync(file, `${JSON.stringify(found)}\n`);
  console.log(`Written: ${file}`);
}

function compare(firstFile, secondFile) {
  const [first, second] = [firstFile, secondFile].map(file => JSON.parse(readFileSync(file, 'utf8')));
  console.log(`The PlayStation 2's emulator on ${first.computer} and on ${second.computer}, ${first.frames} frames of each program`);
  const failures = [];
  const check = (ok, what) => {
    console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
    if (!ok) failures.push(what);
  };
  const apart = (a = [], b = []) => {
    const at = Array.from({ length: Math.max(a.length, b.length) }, (_, i) => i).find(i => a[i] !== b[i]);
    return at === undefined ? null : at;
  };
  for (const name of Object.keys(PROGRAMS)) {
    const a = first.programs[name], b = second.programs[name];
    if (!a || !b) {
      check(false, `${name}: run on both`);
      continue;
    }
    for (const [key, what] of [['draws', 'draw list'], ['things', 'count of things in its draw list'], ['sound', 'sound'], ['memory', 'memory']]) {
      const at = apart(a[key], b[key]);
      check(at === null, at === null ? `${name}: every frame's ${what} is the same on both` : `${name}: every frame's ${what} is the same on both, and the ${at + 1}th of ${a[key].length} differs: ${a[key][at]} and ${b[key][at]}`);
    }
    const differing = a.pictures.filter((hash, frame) => hash !== b.pictures[frame]).length;
    if (a.provenBy === 'pictures') check(differing === 0, `${name}, proven by its pictures: every picture is the same, drawn by ${a.drawnBy} and by ${b.drawnBy}${differing ? `, and ${differing} of ${a.pictures.length} differ` : ''}`);
    else console.log(`  found: ${name}, proven by its draw list: ${differing} of ${a.pictures.length} pictures differ, drawn by ${a.drawnBy} and by ${b.drawnBy}`);
  }
  if (failures.length) {
    console.log(`\n${failures.length} failed.`);
    process.exit(1);
  }
  console.log('\nAll passed.');
}

const [mode, ...files] = process.argv.slice(2);
if (mode === '--write' && files.length === 1) await write(files[0]);
else if (mode === '--compare' && files.length === 2) compare(...files);
else {
  console.error(USAGE);
  process.exit(1);
}
