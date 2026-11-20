// npm run test:ps2-spu2: the PlayStation 2's sound chip in the kit in C (kit/ps2/c/spu2.c), which the tools' emulator
// mixes with too, checked against a second emulator's: PCSX2's SPU2 (https://github.com/PCSX2/pcsx2, GPL-3.0-or-later),
// whose own source, at the commit named here, is fetched and built into a small program beside the kit's chip
// (spu2-check/). The sound test's program (made-up-ps2-iop.mjs) runs on the tools' emulator, which keeps everything it
// gave the chip, every register write and every byte moved by DMA with a mark for each block mixed, and the program
// gives the same to both chips and compares:
//
// - every sample the two mix, 48,000 a second for 300 frames, of a program with envelopes, volume sweeps, a pitch
//   that moves, noise, a voice bent by another, the reverb, master and effect volumes and both cores, is the same;
// - every word the two leave in the chip's memory is the same: what they write back as they mix, and the reverb's work;
// - the kit's chip with its volumes divided as the tools' emulator once divided them, in place of the console's shift,
//   is found.
//
// What goes into the chip's memory from the IOP (the data port, DMA, the sound input's blocks) is the kit's, copied to
// PCSX2's, as that side of the chip follows the tools' emulator: the mixing is what's compared. PCSX2's two filters for
// the reverb are built in its own plain version, which it keeps beside the ones written for a processor's instructions.
//
// It isn't run on every pull request, as the emulator takes minutes to build, and on Linux and macOS alone (docs/CONSOLES.md).

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, REPO } from '../lib/paths.mjs';
import { consoleOf } from '../consoles.mjs';
import { libretroReference } from '../libretro/reference.mjs';
import { madeUpPs2Sound } from './made-up-ps2-iop.mjs';

const PCSX2 = '15afef683235e4941ff7de15c2c19699811a1448';
const FILES = ['defs.h', 'regs.h', 'spu2.h', 'Dma.h', 'interpolate_table.h', 'Mixer.cpp', 'ADSR.cpp', 'Reverb.cpp', 'ReverbResample.cpp', 'RegTable.cpp', 'spu2sys.cpp', 'ReadInput.cpp'];
const BUILT = ['Mixer.cpp', 'ADSR.cpp', 'Reverb.cpp', 'ReverbResample.cpp', 'RegTable.cpp', 'spu2sys.cpp', 'ReadInput.cpp'];
const HERE = join(dirname(fileURLToPath(import.meta.url)), 'spu2-check');
const WORK = join(LOCAL, 'test-ps2-spu2');
const FRAMES = 300;

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};

// PCSX2's SPU2, as its makers have it at the commit, kept from one run to the next
async function fetched() {
  const folder = join(WORK, `pcsx2-${PCSX2.slice(0, 12)}`, 'SPU2');
  mkdirSync(folder, { recursive: true });
  for (const file of FILES) {
    if (existsSync(join(folder, file))) continue;
    const answer = await fetch(`https://raw.githubusercontent.com/PCSX2/pcsx2/${PCSX2}/pcsx2/SPU2/${file}`);
    if (!answer.ok) throw new Error(`PCSX2's ${file} couldn't be fetched (${answer.status}).`);
    writeFileSync(join(folder, file), Buffer.from(await answer.arrayBuffer()));
  }
  return dirname(folder);
}

// A function's whole text taken out of a file, from where `start` matches to its closing brace
function without(text, start) {
  for (let found; (found = start.exec(text));) {
    let at = text.indexOf('{', found.index + found[0].length - 1), depth = 0;
    for (;; at++) {
      if (text[at] === '{') depth++;
      else if (text[at] === '}' && --depth === 0) break;
    }
    text = text.slice(0, found.index) + text.slice(at + 1);
  }
  return text;
}
// PCSX2's reverb filters in its own plain version: the versions written with a processor's instructions, which need
// the rest of PCSX2, are left out, and the two names the mixer calls go to the plain ones
function plainFilters(folder) {
  const file = join(folder, 'SPU2', 'ReverbResample.cpp');
  let text = readFileSync(file, 'utf8');
  if (text.includes('return ReverbDownsample_reference(core, right); }')) return;
  for (const start of [/s32 __forceinline ReverbDownsample_(avx|sse)\(V_Core& core, bool right\)\s*\{/, /StereoOut32 __forceinline ReverbUpsample_(avx|sse)\(V_Core& core\)\s*\{/,
    /s32 ReverbDownsample\(V_Core& core, bool right\)\s*\{/, /StereoOut32 ReverbUpsample\(V_Core& core\)\s*\{/]) text = without(text, start);
  text = text.replace(/#if _M_SSE >= 0x501\s*#endif/g, '');
  const end = text.lastIndexOf('MULTI_ISA_UNSHARED_END');
  if (end < 0 || !text.includes('ReverbDownsample_reference') || !text.includes('ReverbUpsample_reference')) throw new Error("PCSX2's ReverbResample.cpp isn't as the check expects it.");
  text = `${text.slice(0, end)}s32 ReverbDownsample(V_Core& core, bool right) { return ReverbDownsample_reference(core, right); }\nStereoOut32 ReverbUpsample(V_Core& core) { return ReverbUpsample_reference(core); }\n${text.slice(end)}`;
  writeFileSync(file, text);
}

const run = (program, args) => {
  const { status, stdout, stderr, error } = spawnSync(program, args, { encoding: 'utf8', maxBuffer: 2 ** 26 });
  if (error?.code === 'ENOENT') throw new Error(`The check needs ${program}, which isn't installed.`);
  return { status, out: stdout + stderr };
};

// The program that compares the two chips, built with the kit's chip as it is, or with `change` made to its text
function build(pcsx2, name, change = text => text) {
  const chip = join(WORK, `chip-${name}`);
  mkdirSync(chip, { recursive: true });
  writeFileSync(join(chip, 'spu2.c'), change(readFileSync(join(REPO, 'kit', 'ps2', 'c', 'spu2.c'), 'utf8')));
  writeFileSync(join(chip, 'ps2-kit.h'), readFileSync(join(HERE, 'chip', 'ps2-kit.h')));
  const object = join(chip, 'spu2.o'), program = join(WORK, `check-${name}`);
  let made = run(process.env.CC || 'cc', ['-O2', '-std=gnu11', '-c', join(chip, 'spu2.c'), '-o', object]);
  if (made.status !== 0) throw new Error(`The kit's chip didn't build: ${made.out}`);
  made = run(process.env.CXX || 'c++', ['-std=c++20', '-O2', '-w', '-I', HERE, '-I', pcsx2, '-o', program, join(HERE, 'check.cpp'), ...BUILT.map(file => join(pcsx2, 'SPU2', file)), object]);
  if (made.status !== 0) throw new Error(`The check didn't build: ${made.out}`);
  return program;
}

// what the check says of a run: { samples, loud, apart, furthest, words }
function result(text) {
  const found = /(\d+) samples, (\d+) of them not silent: (\d+) apart, the furthest by (\d+); (\d+) words/.exec(text);
  return found ? { samples: +found[1], loud: +found[2], apart: +found[3], furthest: +found[4], words: +found[5] } : null;
}

async function main() {
  rmSync(WORK, { recursive: true, force: true, maxRetries: 3 });
  mkdirSync(WORK, { recursive: true });
  console.log("The kit's sound chip and PCSX2's, given what the sound test's program gives the tools' emulator's");
  const pcsx2 = await fetched();
  plainFilters(pcsx2);
  // the program on the tools' emulator, which keeps what it gave the chip
  const copy = join(WORK, 'sound.elf'), dump = join(WORK, 'sound-dump.bin'), data = join(WORK, 'sound-data.bin');
  writeFileSync(copy, madeUpPs2Sound().elf);
  process.env.DP_SOUND_DUMP = dump;
  process.env.DP_SOUND_DATA = data;
  const played = await libretroReference(consoleOf('ps2')).runOriginal({ copy, frames: FRAMES, buttons: Array(FRAMES).fill(0), sound: true });
  played.sound.close();
  delete process.env.DP_SOUND_DUMP;
  delete process.env.DP_SOUND_DATA;
  check(existsSync(dump) && readFileSync(dump).length > 10000, "the tools' emulator kept what the program gave the chip");

  let said = run(build(pcsx2, 'same'), [dump, data]);
  let found = result(said.out);
  check(said.status === 0 && found?.apart === 0 && found.samples >= FRAMES * 790 && found.loud > found.samples / 2, `the kit's chip mixes every sample as PCSX2's does: ${found ? `${found.samples.toLocaleString('en')} samples, ${found.loud.toLocaleString('en')} of them not silent, ${found.apart} apart` : said.out.trim()}`);
  check(found?.words === 0, `and leaves the chip's memory as PCSX2's does, what it writes back as it mixes and the reverb's work: ${found?.words} words apart`);
  if (said.status !== 0) console.log(said.out);

  // the console multiplies by a volume and shifts fifteen bits: dividing by 0x7FFF, as the tools' emulator's own chip did, isn't it
  const divided = text => {
    const shifted = 'static int32_t scaled(int32_t sample, int32_t volume) { return (volume * sample) >> 15; }';
    if (!text.includes(shifted)) throw new Error("The kit's chip doesn't scale a sample where the check expects it to.");
    return text.replace(shifted, 'static int32_t scaled(int32_t sample, int32_t volume) { return (volume * sample) / 0x7FFF; }');
  };
  said = run(build(pcsx2, 'divided', divided), [dump, data]);
  found = result(said.out);
  check(said.status === 1 && found?.apart > 0, `a chip that divides by its volumes' top in place of the console's shift is found: ${said.out.trim().split('\n')[0]}`);
}

try {
  await main();
} finally {
  // PCSX2's source stays for the next run, which the fetch above would otherwise ask its makers for again
  for (const name of ['chip-same', 'chip-divided', 'check-same', 'check-divided', 'sound.elf', 'sound-dump.bin', 'sound-data.bin']) rmSync(join(WORK, name), { recursive: true, force: true });
}

if (failures.length) {
  console.log(`\n${failures.length} failed.`);
  process.exit(1);
}
console.log('\nAll passed.');
process.exit(0);
