// The PlayStation Portable kit's vector unit (kit/psp/c/vfpu.c), part of npm run test:psp-kit. A small program of the
// project's own whose two threads do the unit's sums with the same registers (made-up-psp-vfpu.mjs, madeUpPspVfpu) runs
// on the console's real emulator, PPSSPP, with its tables for the unit's sine and the rest, and its Dreamport in C
// (psp-vfpu/main.c) on the kit, in a game of its own that the test removes after: every frame of 300 has to be the
// same, pixel for pixel, and so does every frame's draw list, whose bars each fold a word the unit made into its width,
// so a bit of any of them that differs shows. Then a Dreamport whose reciprocals are worked out as C divides, where the
// unit gives its own, and one whose first thread is made without a vector unit of its own, are each found.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder, resultFolder } from '../lib/paths.mjs';
import { startingEntry, startingFiles } from '../lib/new-game.mjs';
import * as PROGRAM from './made-up-psp-vfpu.mjs';

const GAME = 'test-psp-vfpu', VERSION = `${GAME}/c`;
const WORK = join(LOCAL, 'test-psp-vfpu');
const COPIES = join(LOCAL, 'copies.json');
const MEDIA = join(REPO, 'public', 'media');
const FRAMES = 300;

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
const dp = (...args) => {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 26 });
  return { status, out: stdout + stderr };
};
const report = () => {
  const file = join(resultFolder(VERSION, 'still'), 'report.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
};
const tracked = () => spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: REPO, encoding: 'utf8' }).stdout;
const last = run => run.out.trim().split('\n').at(-1);

function tidy() {
  const kept = existsSync(MEDIA) ? readdirSync(MEDIA).filter(file => file.startsWith(GAME)).map(file => join(MEDIA, file)) : [];
  for (const path of [gameFolder(GAME), join(LOCAL, 'results', GAME), join(LOCAL, 'captures', GAME), join(REPO, '.github', 'readme', 'progress', `${GAME}.svg`), WORK, ...kept]) rmSync(path, { recursive: true, force: true });
}

const hex = word => `0x${(word >>> 0).toString(16).toUpperCase()}u`;
const hexWords = words => [...words].map(hex).join(', ');
// the reciprocals of C020 into C220, in the program
const RCP = PROGRAM.SUMS.find(word => (word & 0xFFFF8080) >>> 0 === 0xD0108080);
// worked out as C divides, in place of the unit's own
const RCP_IN_C = `else if (word == ${hex(RCP)}) {
      for (int r = 0; r < 4; r++) {
        float x;
        __builtin_memcpy(&x, &psp_vfpu_state.v[8 + r], 4);
        x = 1.0f / x;
        __builtin_memcpy(&psp_vfpu_state.v[40 + r], &x, 4);
      }
    } else psp_vfpu(word);`;

// the Dreamport in C, with the program's numbers, list and instructions, and `changes`, each [what's there, what goes
// there instead]
function writeGame(program, changes = []) {
  const numbers = {
    ...PROGRAM, BARS_AT: program.at['bars list'], INPUTS_AT: program.at.inputs, RESULTS_AT: program.at.results, FIRST_EDGE: PROGRAM.firstEdge(),
    VZERO_C700: PROGRAM.vzero('q', 7 << 2),
    ...Object.fromEntries(Object.entries(PROGRAM.CYCLES).map(([name, cycles]) => [`C_${name}`, cycles])),
  };
  const words = { BARS_WORDS: PROGRAM.barsList().words, SUMS_WORDS: PROGRAM.SUMS, OTHER_WORDS: PROGRAM.OTHER };
  let code = readFileSync(join(REPO, 'tools', 'test', 'psp-vfpu', 'main.c'), 'utf8').replace(/@([A-Z_0-9]+)@/g, (_, key) => {
    if (words[key]) return hexWords(words[key]);
    if (typeof numbers[key] !== 'number') throw new Error(`The program has no ${key}.`);
    return `0x${numbers[key].toString(16).toUpperCase()}`;
  });
  for (const [from, to] of changes) {
    if (!code.includes(from)) throw new Error(`The Dreamport has no "${from}" for the test to change.`);
    code = code.split(from).join(to);
  }
  writeFileSync(join(gameFolder(VERSION), 'src', 'main.c'), code);
}

async function main() {
  const before = tracked(), copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
  tidy();
  try {
    mkdirSync(WORK, { recursive: true });
    const program = PROGRAM.madeUpPspVfpu(), copy = join(WORK, `${GAME}.elf`);
    writeFileSync(copy, program.elf);
    const original = { console: 'psp', name: 'Test PlayStation Portable Vector Unit (World)', title: GAME, code: '', sha1: createHash('sha1').update(program.elf).digest('hex'), keysAfterVBlank: true };
    const writeOriginal = more => writeFileSync(join(proofFolder(GAME), 'original.json'), `${JSON.stringify({ ...original, ...more }, null, 2)}\n`);
    mkdirSync(join(proofFolder(GAME), 'recordings'), { recursive: true });
    writeOriginal({});
    let run = dp('rom', copy);
    check(run.status === 0 && run.out.includes(GAME), `rom knows the program's copy: ${last(run)}`);
    const files = { ...startingFiles(GAME, original), 'entry.md': startingEntry(GAME, original, { issue: 1, lead: 'nobody', added: '2026-01-01' }) };
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(join(gameFolder(GAME), file, '..'), { recursive: true });
      writeFileSync(join(gameFolder(GAME), file), text);
    }
    for (const [file, text] of Object.entries(startingFiles(GAME, original, { language: 'c' }))) {
      mkdirSync(join(gameFolder(VERSION), file, '..'), { recursive: true });
      writeFileSync(join(gameFolder(VERSION), file), text);
    }
    writeFileSync(join(proofFolder(GAME), 'recordings', 'still.json'), `${JSON.stringify({ about: 'Nothing held.', frames: FRAMES, held: [[0, []]] }, null, 2)}\n`);

    console.log('The program\'s Dreamport in C, its threads doing the vector unit\'s sums, by its pictures:');
    writeGame(program);
    run = dp('prove', VERSION, 'still');
    if (run.status !== 0) console.log(run.out.split('\n').slice(-15).join('\n'));
    check(run.status === 0 && report().frames === FRAMES && !report().firstDifference, `all ${FRAMES} frames the same as the emulator's: ${last(run)}`);

    console.log('By its draw lists, whose bars fold in every bit the unit made:');
    writeOriginal({ provenBy: 'draw lists' });
    run = dp('prove', VERSION, 'still');
    if (run.status !== 0) console.log(run.out.split('\n').slice(-15).join('\n'));
    check(run.status === 0 && report().frames === FRAMES && !report().firstDifference, `every frame's draw list the same as the emulator's: ${last(run)}`);

    console.log('With the reciprocals worked out as C divides:');
    writeGame(program, [['    else psp_vfpu(word);', `    ${RCP_IN_C}`]]);
    run = dp('prove', VERSION, 'still');
    check(run.status !== 0 && report().firstDifference, `a frame differs, by a reciprocal's last bits: ${JSON.stringify(report().firstDifference)}`);

    console.log('With the sums\' thread made without a vector unit of its own:');
    writeGame(program, [['sceKernelCreateThread("sums", sums, SUMS_PRIORITY, STACK, ATTR_VFPU, 0)', 'sceKernelCreateThread("sums", sums, SUMS_PRIORITY, STACK, 0, 0)']]);
    run = dp('prove', VERSION, 'still');
    check(run.status !== 0 && report().firstDifference?.frame <= 3, `a frame at the start differs, by the sum the other thread's registers took: ${JSON.stringify(report().firstDifference)}`);
  } finally {
    // --keep leaves the test's game in games/, to look at what went wrong
    if (!process.argv.includes('--keep')) tidy();
    if (copies) writeFileSync(COPIES, copies);
    else rmSync(COPIES, { force: true });
  }
  check(tracked() === before, 'nothing the repository keeps was changed');
  if (failures.length) {
    console.log(`\n${failures.length} failed.`);
    process.exit(1);
  }
  console.log('\nAll passed.');
}

main().catch(error => {
  console.error(error.stack);
  process.exit(1);
});
