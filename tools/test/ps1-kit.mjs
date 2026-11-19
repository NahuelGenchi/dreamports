// npm run test:ps1-kit: the PlayStation's kit in C (kit/ps1/c/) and `prove` on the PlayStation. A small program of the
// project's own (made-up-ps1.mjs, madeUpGpuExe) runs on the console's real emulator, PCSX ReARMed, and its Dreamport in
// C (ps1-kit/main.c) on the kit, in a game of its own that the test removes after, so no game's copy is needed: every
// frame of 300 has to be the same, pixel for pixel, and so does the sound, silence. Then what `new` writes in C, and the
// Dreamport with its square a shade off, are each found at their first frame.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder, resultFolder } from '../lib/paths.mjs';
import { startingEntry, startingFiles } from '../lib/new-game.mjs';
import { GPU, madeUpGpuExe } from './made-up-ps1.mjs';

const GAME = 'test-ps1-kit', VERSION = `${GAME}/c`;
const WORK = join(LOCAL, 'test-ps1-kit');
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

function tidy() {
  const kept = existsSync(MEDIA) ? readdirSync(MEDIA).filter(file => file.startsWith(GAME)).map(file => join(MEDIA, file)) : [];
  for (const path of [gameFolder(GAME), join(LOCAL, 'results', GAME), join(LOCAL, 'captures', GAME), join(REPO, '.github', 'readme', 'progress', `${GAME}.svg`), WORK, ...kept]) rmSync(path, { recursive: true, force: true });
}

// the Dreamport in C, with the program's numbers, and `changes`, each [what's there, what goes there instead]
function writeGame(changes = []) {
  let code = readFileSync(join(REPO, 'tools', 'test', 'ps1-kit', 'main.c'), 'utf8').replace(/@([A-Z_]+)@/g, (_, key) => `0x${GPU[key].toString(16).toUpperCase()}`);
  for (const [from, to] of changes) code = code.replace(from, to);
  writeFileSync(join(gameFolder(VERSION), 'src', 'main.c'), code);
}

async function main() {
  const before = tracked(), copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
  tidy();
  mkdirSync(WORK, { recursive: true });
  try {
    const exe = await madeUpGpuExe(), copy = join(WORK, `${GAME}.exe`);
    writeFileSync(copy, exe);
    const original = { console: 'ps1', name: 'Test PlayStation Kit (World)', title: GAME, code: '', sha1: createHash('sha1').update(exe).digest('hex') };
    mkdirSync(join(proofFolder(GAME), 'recordings'), { recursive: true });
    writeFileSync(join(proofFolder(GAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
    let run = dp('rom', copy);
    check(run.status === 0 && run.out.includes(GAME), 'rom knows the program\'s copy');
    run = dp('codemap', GAME);
    check(run.status === 0, `its code map is found in the copy: ${run.out.trim().split('\n').at(-1)}`);
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

    console.log('What new writes in C, on the PlayStation\'s kit:');
    run = dp('prove', VERSION, 'still');
    check(run.status !== 0 && report().firstDifference?.frame === 0, `the whole screen filled blue isn't the program's picture, and differs at once: ${JSON.stringify(report().firstDifference)}`);

    console.log('The program\'s Dreamport in C:');
    writeGame();
    run = dp('prove', VERSION, 'still');
    if (run.status !== 0) console.log(run.out.split('\n').slice(-15).join('\n'));
    check(run.status === 0 && report().frames === FRAMES && !report().firstDifference, `all ${FRAMES} frames the same as the emulator's, pictures and sound: ${run.out.trim().split('\n').at(-1)}`);

    console.log('With its square a shade off:');
    writeGame([[`0x60000000 | 0x${GPU.SQUARE.toString(16).toUpperCase()}`, `0x60000000 | 0x${(GPU.SQUARE + 0x08).toString(16).toUpperCase()}`]]);
    run = dp('prove', VERSION, 'still');
    check(run.status !== 0 && report().firstDifference?.frame === 0, `the first frame differs, at the square: ${JSON.stringify(report().firstDifference)}`);
  } finally {
    tidy();
    if (copies) writeFileSync(COPIES, copies);
    else rmSync(COPIES, { force: true });
  }
  check(!existsSync(gameFolder(GAME)), 'nothing is left behind');
  check(tracked() === before, 'nothing the repository tracks has changed');
  if (failures.length) {
    console.log(`\n${failures.length} failed.`);
    process.exit(1);
  }
  console.log('\nThe PlayStation\'s kit draws as the console does, every frame.');
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
