// npm run test:gamecube-kit: the GameCube's kit in C (kit/gamecube/c/) and `prove` on the GameCube. The made-up
// program of the tools' tests (made-up-gamecube.mjs) boots from its disc in the console's reference, Dolphin: it draws
// each field's lines in their own colour, the first controller's two words as blocks, and a square that moves, and plays
// a tone louder on the left. Its Dreamport in C (gamecube-kit/main.c) runs on the kit, in a game of its own that the test
// removes after, with a recording that presses every button, both sticks in every direction and both triggers: every
// frame has to be the same, picture and sound. Then what `new` writes in C, and the Dreamport with a field's colour, a
// controller's bit or the tone's right side wrong, are each found at their first frame.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder, resultFolder } from '../lib/paths.mjs';
import { startingEntry, startingFiles } from '../lib/new-game.mjs';
import { formatCodeMap } from '../lib/proof-files.mjs';
import * as program from './made-up-gamecube.mjs';

const GAME = 'test-gamecube-kit', VERSION = `${GAME}/c`;
const WORK = join(LOCAL, 'test-gamecube-kit');
const COPIES = join(LOCAL, 'copies.json');
const MEDIA = join(REPO, 'public', 'media');
const FRAMES = 300;
// what the recording presses, and from which frame: every button, each direction of both sticks, a diagonal of each,
// and both triggers to their click and short of it
const PRESSES = [
  [30, ['A']], [36, ['B']], [42, ['X']], [48, ['Y']], [54, ['Z']], [60, ['START']], [66, ['UP']], [72, ['DOWN']], [78, ['LEFT']],
  [84, ['RIGHT']], [90, ['L']], [96, ['R']], [102, ['L_ANALOG']], [108, ['R_ANALOG']], [114, ['STICK_LEFT']], [120, ['STICK_RIGHT']],
  [126, ['STICK_UP']], [132, ['STICK_DOWN']], [138, ['STICK_LEFT', 'STICK_UP']], [144, ['STICK_RIGHT', 'STICK_DOWN']], [150, ['C_LEFT']],
  [156, ['C_RIGHT']], [162, ['C_UP']], [168, ['C_DOWN']], [174, ['C_RIGHT', 'C_UP']], [180, ['A', 'B', 'X', 'Y', 'Z']], [186, []],
];

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
  const file = join(resultFolder(VERSION, 'presses'), 'report.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
};
const tracked = () => spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: REPO, encoding: 'utf8' }).stdout;
const hex = value => `0x${(value >>> 0).toString(16).toUpperCase()}`;

function tidy() {
  const kept = existsSync(MEDIA) ? readdirSync(MEDIA).filter(file => file.startsWith(GAME)).map(file => join(MEDIA, file)) : [];
  for (const path of [gameFolder(GAME), join(LOCAL, 'results', GAME), join(LOCAL, 'captures', GAME), join(REPO, '.github', 'readme', 'progress', `${GAME}.svg`), join(REPO, '.github', 'readme', 'progress', `${GAME}-c.svg`), WORK, ...kept]) rmSync(path, { recursive: true, force: true });
}

// the Dreamport in C, with the program's numbers, and `changes`, each [what's there, what goes there instead]
function writeGame(changes = []) {
  const made = program.madeUpGameCube(), tone = program.tone();
  const numbers = { ...program, TONE: made.tone, TONE_BLOCKS: tone.length / 32 };
  let code = readFileSync(join(REPO, 'tools', 'test', 'gamecube-kit', 'main.c'), 'utf8')
    .replace('@VIDEO@', program.VIDEO.map(([at, value]) => `{ ${hex(at)}, ${hex(value)} }`).join(', '))
    .replace('@TONE_BYTES@', [...tone].map(byte => hex(byte)).join(', '))
    .replace(/@([A-Z_]+)@/g, (_, key) => {
      if (typeof numbers[key] !== 'number') throw new Error(`The made-up program has no number called ${key}.`);
      return `${hex(numbers[key])}u`;
    });
  for (const [from, to] of changes) {
    if (!code.includes(from)) throw new Error(`The Dreamport has no "${from}" for the test to change.`);
    code = code.replace(from, to);
  }
  writeFileSync(join(gameFolder(VERSION), 'src', 'main.c'), code);
}

async function main() {
  const before = tracked(), copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
  tidy();
  mkdirSync(WORK, { recursive: true });
  try {
    const made = program.madeUpGameCube(), disc = program.madeUpGameCubeDisc({ program: made }).image, copy = join(WORK, `${GAME}.iso`);
    writeFileSync(copy, disc);
    const original = { console: 'gamecube', name: 'Test GameCube Kit (World)', title: 'Made-up program', code: 'GMUE00', sha1: createHash('sha1').update(disc).digest('hex') };
    mkdirSync(join(proofFolder(GAME), 'recordings'), { recursive: true });
    writeFileSync(join(proofFolder(GAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
    let run = dp('rom', copy);
    check(run.status === 0 && run.out.includes(GAME), 'rom knows the program\'s disc');
    writeFileSync(join(proofFolder(GAME), 'code-map.json'), formatCodeMap({
      original: original.sha1, from: 'The test\'s own program',
      functions: Object.values(made.functions).map(({ address, size }) => ({ address, size })),
    }));
    const files = { ...startingFiles(GAME, original), 'entry.md': startingEntry(GAME, original, { issue: 1, lead: 'nobody', added: '2026-01-01' }) };
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(join(gameFolder(GAME), file, '..'), { recursive: true });
      writeFileSync(join(gameFolder(GAME), file), text);
    }
    for (const [file, text] of Object.entries(startingFiles(GAME, original, { language: 'c' }))) {
      mkdirSync(join(gameFolder(VERSION), file, '..'), { recursive: true });
      writeFileSync(join(gameFolder(VERSION), file), text);
    }
    writeFileSync(join(proofFolder(GAME), 'recordings', 'presses.json'), `${JSON.stringify({ about: 'Every button, both sticks and both triggers, one after another.', frames: FRAMES, held: [[0, []], ...PRESSES] }, null, 2)}\n`);

    console.log('What new writes in C, on the GameCube\'s kit:');
    run = dp('prove', VERSION, 'presses');
    check(run.status !== 0 && report().firstDifference?.frame === 0, `a blue picture isn't the program's, and differs at once: ${JSON.stringify(report().firstDifference)}`);

    console.log('The program\'s Dreamport in C:');
    writeGame();
    run = dp('prove', VERSION, 'presses');
    if (run.status !== 0) console.log(run.out.split('\n').slice(-15).join('\n'));
    check(run.status === 0 && report().frames === FRAMES && !report().firstDifference && report().sound?.heard && !report().sound?.firstDifference, `all ${FRAMES} frames the same as the reference's, pictures and sound: ${run.out.trim().split('\n').at(-1)}`);

    console.log('With the fields\' colours the other way round:');
    writeGame([['square(x, SQUARE, SQUARE_ODD);', 'square(x, SQUARE_ODD, SQUARE);']]);
    run = dp('prove', VERSION, 'presses');
    check(run.status !== 0 && report().firstDifference?.frame === 0, `the first frame differs, at the square: ${JSON.stringify(report().firstDifference)}`);

    console.log('With the B button\'s bit read as another\'s:');
    writeGame([['bits(gc_read32(SI_C0_IN_HI), at);', 'bits(gc_read32(SI_C0_IN_HI) & 0x02000000u ? (gc_read32(SI_C0_IN_HI) ^ 0x06000000u) : gc_read32(SI_C0_IN_HI), at);']]);
    run = dp('prove', VERSION, 'presses');
    check(run.status !== 0 && report().firstDifference?.frame === PRESSES[1][0], `the frame B is first held differs, ${PRESSES[1][0]}: ${JSON.stringify(report().firstDifference)}`);

    console.log('With the tone silent on the right:');
    writeGame([['for (unsigned i = 0; i < sizeof tone; i++) gc_write8(TONE + i, tone[i]);', 'for (unsigned i = 0; i < sizeof tone; i++) gc_write8(TONE + i, i % 4 < 2 ? 0 : tone[i]);']]);
    run = dp('prove', VERSION, 'presses');
    const sound = report().sound?.firstDifference;
    check(run.status !== 0 && sound?.frame <= 2 && report().firstDifference?.pixels === 0, `the sound differs from the start, and the picture doesn't: ${JSON.stringify(sound)}`);
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
  console.log('\nThe GameCube\'s kit shows, plays and reads the controller as the console\'s reference does, every frame.');
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
