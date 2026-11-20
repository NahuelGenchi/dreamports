// npm run test:ps1-kit: the PlayStation's kit in C (kit/ps1/c/) and `prove` on the PlayStation. A small program of the
// project's own (made-up-ps1.mjs, madeUpGpuExe) runs on the console's real emulator, PCSX ReARMed, and its Dreamport in
// C (ps1-kit/main.c) on the kit, in a game of its own that the test removes after, so no game's copy is needed: every
// frame of 300 has to be the same, pixel for pixel, and so does the sound, silence. Then what `new` writes in C, and the
// Dreamport with its square a shade off, are each found at their first frame. Then a second program of its own
// (madeUpDrawExe) draws what a 3D game is made of, polygons, lines, textures, shading, dithering, mixing, a texture
// window and the mask bit, moving each frame, and its Dreamport in C (ps1-kit/draw.c) has to be the same in every frame
// of 300, and found at its first frame once a corner of one triangle is a pixel off.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder, resultFolder } from '../lib/paths.mjs';
import { startingEntry, startingFiles } from '../lib/new-game.mjs';
import { GPU, drawList, madeUpDrawExe, madeUpGpuExe } from './made-up-ps1.mjs';

const GAME = 'test-ps1-kit', VERSION = `${GAME}/c`;
const DRAWING = 'test-ps1-kit-draw', DRAWN = `${DRAWING}/c`;
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
const report = (version = VERSION) => {
  const file = join(resultFolder(version, 'still'), 'report.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
};
const tracked = () => spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: REPO, encoding: 'utf8' }).stdout;

function tidy() {
  const kept = existsSync(MEDIA) ? readdirSync(MEDIA).filter(file => file.startsWith(GAME)).map(file => join(MEDIA, file)) : [];
  for (const game of [GAME, DRAWING]) for (const path of [gameFolder(game), join(LOCAL, 'results', game), join(LOCAL, 'captures', game), join(REPO, '.github', 'readme', 'progress', `${game}.svg`)]) rmSync(path, { recursive: true, force: true });
  for (const path of [WORK, ...kept]) rmSync(path, { recursive: true, force: true });
}

// the Dreamport in C, with the program's numbers, and `changes`, each [what's there, what goes there instead]
function writeGame(changes = []) {
  let code = readFileSync(join(REPO, 'tools', 'test', 'ps1-kit', 'main.c'), 'utf8').replace(/@([A-Z_]+)@/g, (_, key) => `0x${GPU[key].toString(16).toUpperCase()}`);
  for (const [from, to] of changes) code = code.replace(from, to);
  writeFileSync(join(gameFolder(VERSION), 'src', 'main.c'), code);
}

// a game of the test's own in games/, with the program `exe` as its copy, which rom knows, its code map, its first
// files in JavaScript and in C, and a recording of 300 frames with nothing held
async function makeGame(game, version, exe, name) {
  const copy = join(WORK, `${game}.exe`);
  writeFileSync(copy, exe);
  const original = { console: 'ps1', name, title: game, code: '', sha1: createHash('sha1').update(exe).digest('hex') };
  mkdirSync(join(proofFolder(game), 'recordings'), { recursive: true });
  writeFileSync(join(proofFolder(game), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
  let run = dp('rom', copy);
  check(run.status === 0 && run.out.includes(game), `rom knows ${game}'s copy`);
  run = dp('codemap', game);
  check(run.status === 0, `its code map is found in the copy: ${run.out.trim().split('\n').at(-1)}`);
  const files = { ...startingFiles(game, original), 'entry.md': startingEntry(game, original, { issue: 1, lead: 'nobody', added: '2026-01-01' }) };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(gameFolder(game), file, '..'), { recursive: true });
    writeFileSync(join(gameFolder(game), file), text);
  }
  for (const [file, text] of Object.entries(startingFiles(game, original, { language: 'c' }))) {
    mkdirSync(join(gameFolder(version), file, '..'), { recursive: true });
    writeFileSync(join(gameFolder(version), file), text);
  }
  writeFileSync(join(proofFolder(game), 'recordings', 'still.json'), `${JSON.stringify({ about: 'Nothing held.', frames: FRAMES, held: [[0, []]] }, null, 2)}\n`);
}

// the drawing program's Dreamport in C, with its words, and `changes` as writeGame takes them
function writeDrawing(changes = []) {
  const { setup, frame } = drawList(), words = list => list.map(word => `0x${word.toString(16).toUpperCase()}`).join(', ');
  let code = readFileSync(join(REPO, 'tools', 'test', 'ps1-kit', 'draw.c'), 'utf8').replace('@SETUP@', words(setup)).replace('@FRAME@', words(frame));
  for (const [from, to] of changes) code = code.replace(from, to);
  writeFileSync(join(gameFolder(DRAWN), 'src', 'main.c'), code);
}

async function main() {
  const before = tracked(), copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
  tidy();
  mkdirSync(WORK, { recursive: true });
  try {
    await makeGame(GAME, VERSION, await madeUpGpuExe(), 'Test PlayStation Kit (World)');
    let run;

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

    console.log('Polygons, lines and textures, moving each frame:');
    await makeGame(DRAWING, DRAWN, await madeUpDrawExe(), 'Test PlayStation Drawing (World)');
    writeDrawing();
    run = dp('prove', DRAWN, 'still');
    if (run.status !== 0) console.log(run.out.split('\n').slice(-15).join('\n'));
    check(run.status === 0 && report(DRAWN).frames === FRAMES && !report(DRAWN).firstDifference, `all ${FRAMES} frames the same as the emulator's, pictures and sound: ${run.out.trim().split('\n').at(-1)}`);
    const corner = `0x${(0x20000000 | 200 | 40 << 8 | 40 << 16).toString(16).toUpperCase()}, 0xA000A`;
    writeDrawing([[corner, `${corner.slice(0, -1)}B`]]);
    run = dp('prove', DRAWN, 'still');
    check(run.status !== 0 && report(DRAWN).firstDifference?.frame === 0, `with one triangle's corner a pixel off, the first frame differs: ${JSON.stringify(report(DRAWN).firstDifference)}`);
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
