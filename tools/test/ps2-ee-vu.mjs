// npm run test:ps2-ee-vu: the PlayStation 2's kit in C, its EE and vector units (kit/ps2/c/), against the console's
// emulator. The program of made-up-ps2-ee-vu.mjs runs on Play!, and its Dreamport in C, a twin of its EE code
// (made-up-ps2-ee-vu.c), runs on the kit on this computer (ps2-frames.c). Every frame, what each gave the GS, its draw
// list, and both vector units' memories, code and data, have to be the same, byte for byte: the FPU's and the MMI's sums,
// DMA chains of every kind of tag, every VIF code and UNPACK format, programs on both vector units, and packets by all
// three of the GIF's paths. Where they first part, it says which write of the list or which bytes of which memory.
//
// Its files are in .dreamports/test-ps2-ee-vu/, which it empties first and removes after. It needs the emulator, built
// once by the tools, so it isn't run on every pull request, and it runs on Linux and macOS (docs/CONSOLES.md).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO } from '../lib/paths.mjs';
import { cKit, SAME_FLAGS } from '../lib/c.mjs';
import { consoleOf } from '../consoles.mjs';
import { libretroReference } from '../libretro/reference.mjs';
import { firstApart, listsIn } from '../lib/draw-lists.mjs';
import { FRAMES, madeUpPs2EeVu } from './made-up-ps2-ee-vu.mjs';

const WORK = join(LOCAL, 'test-ps2-ee-vu');
const MEMORIES = [['vector unit 0\'s code', 4096], ['vector unit 0\'s data', 4096], ['vector unit 1\'s code', 16384], ['vector unit 1\'s data', 16384]];
const VU_BYTES = MEMORIES.reduce((sum, [, size]) => sum + size, 0);
const hex = (value, digits = 8) => `0x${(value >>> 0).toString(16).toUpperCase().padStart(digits, '0')}`;

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};

// the Dreamport's C, from the template, with the program's memory and steps
function dreamportSource(program) {
  const blocks = program.memory.map(([at, words], i) => `static const uint32_t block${i}[] = { ${words.map(w => `0x${w.toString(16)}u`).join(', ')} };`);
  const table = `static const struct { uint32_t at, count; const uint32_t *words; } blocks[] = { ${program.memory.map(([at, words], i) => `{ ${at}u, ${words.length}, block${i} }`).join(', ')} };`;
  const numbers = { ...program.names, BLOCKS: [...blocks, table].join('\n'), STEPS: program.steps.map(line => `  ${line}`).join('\n') };
  return readFileSync(join(REPO, 'tools', 'test', 'made-up-ps2-ee-vu.c'), 'utf8').replace(/@([A-Z_]+)@/g, (_, key) => String(numbers[key]));
}

// the Dreamport built for this computer with the kit and run: each frame's draw list's hash and count, its whole list,
// and the vector units' memories
function runDreamport(source, frames) {
  const kit = cKit('ps2');
  const game = join(WORK, 'game.c'), program = join(WORK, 'game');
  writeFileSync(game, source);
  const sources = [...kit.native.filter(file => !file.endsWith('native.c')), game, join(REPO, 'tools', 'test', 'ps2-frames.c')];
  execFileSync(process.env.CC ?? 'cc', ['-std=c11', ...SAME_FLAGS, '-o', program, ...kit.folders.map(folder => `-I${folder}`), ...sources], { stdio: ['ignore', 'inherit', 'inherit'] });
  const files = { draws: join(WORK, 'draws.bin'), list: join(WORK, 'list.bin'), vu: join(WORK, 'vu.bin') };
  execFileSync(program, [String(frames), files.draws, files.list, files.vu], { stdio: ['ignore', 'inherit', 'inherit'] });
  const draws = new Uint32Array(new Uint8Array(readFileSync(files.draws)).buffer);
  return { hashes: draws.filter((_, i) => i % 2 === 0), counts: draws.filter((_, i) => i % 2 === 1), lists: listsIn(readFileSync(files.list)), vu: readFileSync(files.vu) };
}

// the program on the console's emulator: its draw lists and its vector units' memories at each V-blank
async function runOriginal(elf, frames) {
  const machine = consoleOf('ps2'), reference = libretroReference(machine);
  reference.ensureOriginal(console.log);
  const copy = join(WORK, 'program.elf'), listFile = join(WORK, 'original-list.bin'), vuFile = join(WORK, 'original-vu.bin');
  writeFileSync(copy, elf);
  process.env.DP_DRAW_DUMP = listFile;
  process.env.DP_VU_DUMP = vuFile;
  try {
    const run = await reference.runOriginal({ copy, frames, buttons: new Array(frames).fill(0), draws: true });
    return { hashes: run.draws.hashes, counts: run.draws.counts, lists: listsIn(readFileSync(listFile)), vu: readFileSync(vuFile) };
  } finally {
    delete process.env.DP_DRAW_DUMP;
    delete process.env.DP_VU_DUMP;
  }
}

// where two frames' vector unit memories first differ: which memory, the quadword, and what each holds there
function vuApart(original, dreamport) {
  let from = 0;
  for (const [name, size] of MEMORIES) {
    for (let at = 0; at < size; at += 16) {
      const a = original.subarray(from + at, from + at + 16), b = dreamport.subarray(from + at, from + at + 16);
      if (!a.equals(b)) {
        let count = 0;
        for (let q = at; q < size; q += 16) if (!original.subarray(from + q, from + q + 16).equals(dreamport.subarray(from + q, from + q + 16))) count++;
        const words = bytes => [0, 4, 8, 12].map(i => hex(bytes.readUInt32LE(i))).join(' ');
        return `${name}, quadword ${hex(at / 16, 3)} and ${count - 1} more: the original's ${words(a)}, the Dreamport's ${words(b)}`;
      }
    }
    from += size;
  }
  return null;
}

async function main() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  console.log('The kit\'s EE, DMA controller, VIFs, vector units and GIF against the console\'s emulator');
  const program = madeUpPs2EeVu();
  const original = await runOriginal(program.elf, FRAMES + 8);
  const dreamport = runDreamport(dreamportSource(program), FRAMES);
  // the Dreamport's first frame is the original's after its first V-blanks, as the program waits for one before each
  let offset = -1;
  for (let k = 0; k <= 4 && offset < 0; k++) if (dreamport.hashes.slice(0, 4).every((hash, f) => hash === original.hashes[f + k])) offset = k;
  check(offset >= 0, `the Dreamport's first frames are the original's, from its frame ${offset}`);
  if (offset < 0) {
    const apart = firstApart(original.lists[2] ?? [], dreamport.lists[0] ?? []);
    console.log(`  the original's frame 2 and the Dreamport's first part at write ${apart?.write} of ${apart?.counts.original} and ${apart?.counts.dreamport}: the original's ${apart?.original}, the Dreamport's ${apart?.dreamport}`);
    return;
  }
  let lists = 0, memories = 0, firstList = null, firstMemory = null;
  for (let f = 0; f < FRAMES; f++) {
    if (dreamport.hashes[f] === original.hashes[f + offset]) lists++;
    else firstList ??= { frame: f, apart: firstApart(original.lists[f + offset] ?? [], dreamport.lists[f] ?? []) };
    const theirs = original.vu.subarray((f + offset) * VU_BYTES, (f + offset + 1) * VU_BYTES), ours = dreamport.vu.subarray(f * VU_BYTES, (f + 1) * VU_BYTES);
    if (theirs.equals(ours)) memories++;
    else firstMemory ??= { frame: f, apart: vuApart(theirs, ours) };
  }
  check(lists === FRAMES, `the GS gets what the original gives it, every write in its order, every frame: ${lists} of ${FRAMES}`);
  if (firstList) {
    const { frame, apart } = firstList;
    console.log(`    first at frame ${frame}, write ${apart?.write} of ${apart?.counts.original} and ${apart?.counts.dreamport}:\n      the original:  ${apart?.original}\n      the Dreamport: ${apart?.dreamport}\n      before: ${apart?.before.join('; ')}`);
  }
  check(memories === FRAMES, `both vector units' memories are the original's, byte for byte, every frame: ${memories} of ${FRAMES}`);
  if (firstMemory) console.log(`    first at frame ${firstMemory.frame}: ${firstMemory.apart}`);
}

try {
  await main();
} finally {
  if (!process.env.DP_KEEP) rmSync(WORK, { recursive: true, force: true });
}
if (failures.length) {
  console.log(`\n${failures.length} failed.`);
  process.exit(1);
}
console.log('\nAll passed.');
process.exit(0);
