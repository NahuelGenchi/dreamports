// The PlayStation Portable kit's semaphores and event flags (kit/psp/c/sync.c), part of npm run test:psp-kit. A small
// program of the project's own whose two threads wait for each other on them (made-up-psp-sync.mjs, madeUpPspSync)
// runs on the console's real emulator, PPSSPP, and its Dreamport in C (psp-sync/main.c) on the kit, in a game of its
// own that the test removes after: every frame of 300 has to be the same, pixel for pixel, and so does every frame's
// draw list, whose bars are as wide as when each thread was woken, to the microsecond, and what each wait gave back.
// Then a Dreamport whose semaphore's timeout is a microsecond longer, one whose flag is set every frame, and one that
// waits for the flag a microsecond late, are each found.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder, resultFolder } from '../lib/paths.mjs';
import { startingEntry, startingFiles } from '../lib/new-game.mjs';
import * as PROGRAM from './made-up-psp-sync.mjs';

const GAME = 'test-psp-sync', VERSION = `${GAME}/c`;
const WORK = join(LOCAL, 'test-psp-sync');
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

const hexWords = words => [...words].map(word => `0x${word.toString(16).toUpperCase()}u`).join(', ');
// the Dreamport in C, with the program's numbers and list, and `changes`, each [what's there, what goes there instead]
function writeGame(program, changes = []) {
  const numbers = {
    ...PROGRAM, BARS_AT: program.at['bars list'], IDS_AT: program.at.ids, FRAME_AT: program.at['frame number'], TIMEOUTS_AT: program.at.timeouts, OUT_AT: program.at.out, RESULT_AT: program.at['worker result'],
    ...Object.fromEntries(Array.from({ length: PROGRAM.BARS }, (_, index) => [`BAR${index}`, PROGRAM.barEdge(index)])),
    ...Object.fromEntries(Object.entries(PROGRAM.CYCLES).map(([name, cycles]) => [`C_${name}`, cycles])),
  };
  const words = { BARS_WORDS: PROGRAM.barsList().words };
  let code = readFileSync(join(REPO, 'tools', 'test', 'psp-sync', 'main.c'), 'utf8').replace(/@([A-Z_0-9]+)@/g, (_, key) => {
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
    const program = PROGRAM.madeUpPspSync(), copy = join(WORK, `${GAME}.elf`);
    writeFileSync(copy, program.elf);
    const original = { console: 'psp', name: 'Test PlayStation Portable Semaphores (World)', title: GAME, code: '', sha1: createHash('sha1').update(program.elf).digest('hex'), keysAfterVBlank: true };
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

    console.log('The program\'s Dreamport in C, its threads waiting for each other, by its pictures:');
    writeGame(program);
    run = dp('prove', VERSION, 'still');
    if (run.status !== 0) console.log(run.out.split('\n').slice(-15).join('\n'));
    check(run.status === 0 && report().frames === FRAMES && !report().firstDifference, `all ${FRAMES} frames the same as the emulator's: ${last(run)}`);

    console.log('By its draw lists, whose bars say what each wait gave back:');
    writeOriginal({ provenBy: 'draw lists' });
    run = dp('prove', VERSION, 'still');
    if (run.status !== 0) console.log(run.out.split('\n').slice(-15).join('\n'));
    check(run.status === 0 && report().frames === FRAMES && !report().firstDifference, `every frame's draw list the same as the emulator's: ${last(run)}`);

    console.log('With the semaphore\'s timeout a microsecond longer:');
    writeGame(program, [['SEMA_TIMEOUT = 0x', 'SEMA_TIMEOUT = 1 + 0x']]);
    run = dp('prove', VERSION, 'still');
    check(run.status !== 0 && report().firstDifference?.frame <= 2, `a frame at the start differs, by what was left of the timeout: ${JSON.stringify(report().firstDifference)}`);

    console.log('With the flag set every frame:');
    writeGame(program, [['if ((psp_read32(FRAME_AT) & 3) == 3) continue;', '']]);
    run = dp('prove', VERSION, 'still');
    const every = report().firstDifference;
    check(run.status !== 0 && every?.frame >= 3 && every?.frame <= 6, `the first frame whose flag the original doesn't set differs: ${JSON.stringify(every)}`);

    console.log('Waiting for the flag a microsecond late:');
    writeGame(program, [['    int result = sceKernelWaitEventFlag(', '    psp_time_pass(222);\n    int result = sceKernelWaitEventFlag(']]);
    run = dp('prove', VERSION, 'still');
    check(run.status !== 0 && report().firstDifference?.frame <= 2, `a frame at the start differs: ${JSON.stringify(report().firstDifference)}`);
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
