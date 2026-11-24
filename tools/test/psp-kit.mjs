// npm run test:psp-kit: the PlayStation Portable's kit in C (kit/psp/c/) and `prove` on the PlayStation Portable. A
// small program of the project's own (made-up-psp.mjs, madeUpPsp) runs on the console's real emulator, PPSSPP, and its
// Dreamport in C (psp-kit/main.c) on the kit, in a game of its own that the test removes after, so no game's copy is
// needed: every frame of 300 has to be the same, pixel for pixel, and so does the sound, every sample the console
// mixes and everything the program gave the sound channels, in the order and the frame it gave it. Then what `new`
// writes in C, the Dreamport with its square a shade off, one whose sound thread hands its first block over 64
// samples' time late, and one whose first thread is a microsecond late, which the time it shows each frame gives away,
// are each found. A second recording holds each button and each way of the stick in turn: every frame has to match,
// and a Dreamport that doesn't see one button, or never reads how far down the stick is, is found at the first frame
// that's held.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder, resultFolder } from '../lib/paths.mjs';
import { startingEntry, startingFiles } from '../lib/new-game.mjs';
import { CONSOLES } from '../../kit/consoles.js';
import * as PROGRAM from './made-up-psp.mjs';

const GAME = 'test-psp-kit', VERSION = `${GAME}/c`;
const WORK = join(LOCAL, 'test-psp-kit');
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
const report = (recording = 'still') => {
  const file = join(resultFolder(VERSION, recording), 'report.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
};
const tracked = () => spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: REPO, encoding: 'utf8' }).stdout;
const last = run => run.out.trim().split('\n').at(-1);

function tidy() {
  const kept = existsSync(MEDIA) ? readdirSync(MEDIA).filter(file => file.startsWith(GAME)).map(file => join(MEDIA, file)) : [];
  for (const path of [gameFolder(GAME), join(LOCAL, 'results', GAME), join(LOCAL, 'captures', GAME), join(REPO, '.github', 'readme', 'progress', `${GAME}.svg`), WORK, ...kept]) rmSync(path, { recursive: true, force: true });
}

// the Dreamport in C, with the program's numbers, and `changes`, each [what's there, what goes there instead]
function writeGame(program, changes = []) {
  const numbers = { ...PROGRAM, WAVE_AT: program.at.wave, PAD_AT: program.at.pad, ...Object.fromEntries(Object.entries(PROGRAM.CYCLES).map(([name, cycles]) => [`C_${name}`, cycles])) };
  let code = readFileSync(join(REPO, 'tools', 'test', 'psp-kit', 'main.c'), 'utf8').replace(/@([A-Z_]+)@/g, (_, key) => {
    if (typeof numbers[key] !== 'number') throw new Error(`The program has no ${key}.`);
    return `0x${numbers[key].toString(16).toUpperCase()}`;
  });
  for (const [from, to] of changes) {
    if (!code.includes(from)) throw new Error(`The Dreamport has no "${from}" for the test to change.`);
    code = code.replace(from, to);
  }
  writeFileSync(join(gameFolder(VERSION), 'src', 'main.c'), code);
}

// a recording that holds each of the console's buttons, and each way of its stick, for five frames in turn
function padRecording() {
  const held = [[0, []]];
  CONSOLES.psp.buttons.forEach((button, index) => held.push([20 + index * 10, [button]], [25 + index * 10, []]));
  return { about: 'Each button and each way of the stick, in turn.', frames: FRAMES, held };
}

async function main() {
  const before = tracked(), copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
  tidy();
  try {
    mkdirSync(WORK, { recursive: true });
    const program = PROGRAM.madeUpPsp(), copy = join(WORK, `${GAME}.elf`);
    writeFileSync(copy, program.elf);
    // the console samples its buttons as each V-blank ends, from what the emulator was given as the frame started
    const original = { console: 'psp', name: 'Test PlayStation Portable (World)', title: GAME, code: '', sha1: createHash('sha1').update(program.elf).digest('hex'), keysAfterVBlank: true };
    mkdirSync(join(proofFolder(GAME), 'recordings'), { recursive: true });
    writeFileSync(join(proofFolder(GAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
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
    writeFileSync(join(proofFolder(GAME), 'recordings', 'buttons.json'), `${JSON.stringify(padRecording(), null, 2)}\n`);

    console.log('What new writes in C, on the PlayStation Portable\'s kit:');
    run = dp('prove', VERSION, 'still');
    if (!report().firstDifference) console.log(run.out.split('\n').slice(-15).join('\n'));
    check(run.status !== 0 && report().firstDifference?.frame <= 1, `the whole screen filled blue isn't the program's picture, and differs at once: ${JSON.stringify(report().firstDifference)}`);

    console.log('The program\'s Dreamport in C:');
    writeGame(program);
    run = dp('prove', VERSION, 'still');
    if (run.status !== 0) console.log(run.out.split('\n').slice(-15).join('\n'));
    check(run.status === 0 && report().frames === FRAMES && !report().firstDifference && report().sound?.heard, `all ${FRAMES} frames the same as the emulator's, pictures and sound, and sound heard: ${last(run)}`);

    console.log('With its square a shade off:');
    writeGame(program, [['#define SQUARE 0x', '#define SQUARE 0x080000 + 0x']]);
    run = dp('prove', VERSION, 'still');
    check(run.status !== 0 && report().firstDifference?.frame === 1, `the first frame with the square differs: ${JSON.stringify(report().firstDifference)}`);

    console.log('With its sound a block late:');
    // the thread's first block is handed over 64 samples' time later, so it's mixed from the next block of 64 on
    writeGame(program, [['  for (;;) {\n    sceAudioOutputBlocking', `  psp_time_pass(${Math.floor(222000000 * 64 / 44100)});\n  for (;;) {\n    sceAudioOutputBlocking`]]);
    run = dp('prove', VERSION, 'still');
    const heard = report().sound?.firstDifference;
    check(run.status !== 0 && heard?.frame <= 1 && heard.by === 'list', `its sound differs where the wave starts, by what it gave the channels and when: ${JSON.stringify(heard)}`);

    console.log('With its first thread a microsecond late:');
    // 222 of the processor's cycles more in each frame's work, before it asks the time, which its bars are as wide as
    writeGame(program, [['    sceDisplayWaitVblankStart();', '    sceDisplayWaitVblankStart();\n    psp_time_pass(222);']]);
    run = dp('prove', VERSION, 'still');
    const late = report().firstDifference;
    check(run.status !== 0 && late?.frame <= 1 && late.box?.[1] >= PROGRAM.TIME_Y && late.box?.[3] < PROGRAM.TIME_AGAIN_Y + PROGRAM.BAR_HEIGHT, `the first frame that shows the time differs, in the time's bars: ${JSON.stringify(late)}`);

    console.log('The buttons and the stick, each held in turn:');
    writeGame(program);
    run = dp('prove', VERSION, 'buttons');
    if (run.status !== 0) console.log(run.out.split('\n').slice(-15).join('\n'));
    check(run.status === 0 && report('buttons').frames === FRAMES && !report('buttons').firstDifference, `all ${FRAMES} frames the same as the emulator's, every button: ${last(run)}`);
    writeGame(program, [['uint32_t held = psp_read32(PAD_AT + 4);', 'uint32_t held = psp_read32(PAD_AT + 4) & ~0x4000u;']]);
    run = dp('prove', VERSION, 'buttons');
    const first = report('buttons').firstDifference;
    check(run.status !== 0 && first?.frame >= 20 && first?.frame <= 23, `a Dreamport that doesn't see CROSS differs at the first frame it's held: ${JSON.stringify(first)}`);
    const stickFrom = 20 + CONSOLES.psp.buttons.indexOf('STICK_UP') * 10;
    writeGame(program, [['(uint32_t)(psp_read8(PAD_AT + 9) >> 2)', '(uint32_t)(128 >> 2)']]);
    run = dp('prove', VERSION, 'buttons');
    const stick = report('buttons').firstDifference;
    check(run.status !== 0 && stick?.frame >= stickFrom && stick?.frame <= stickFrom + 3, `and one that never reads how far down the stick is differs at the first frame it's held up, frame ${stickFrom} or just after: ${JSON.stringify(stick)}`);

    console.log('Its code map:');
    run = dp('codemap', GAME);
    const mapFile = join(proofFolder(GAME), 'code-map.json'), map = existsSync(mapFile) ? JSON.parse(readFileSync(mapFile, 'utf8')) : null;
    const expected = [PROGRAM.LOAD_AT, program.at.sound].map(address => address.toString(16).toUpperCase().padStart(8, '0'));
    check(run.status === 0 && map?.functions.map(([address]) => address).join() === expected.join() && /tools\/psp\/functions\.mjs/.test(map.from), `codemap finds the program's two functions, its start and its sound thread, and nothing of what it keeps for the system: ${map ? JSON.stringify(map.functions) : last(run)}`);
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
