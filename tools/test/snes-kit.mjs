// npm run test:snes-kit: the Super Nintendo's kit in C (kit/snes/c/) and `prove` on the Super Nintendo. A small program
// of the project's own (made-up-snes.mjs, madeUpPictureCartridge) runs on the console's real emulator, Snes9x, and its
// Dreamport in C (snes-kit/main.c) on the kit, in a game of its own that the test removes after, so no game's copy is
// needed: what `new` writes in C has to differ at once, and the Dreamport's every frame of 300 has to be the same,
// pixel for pixel, and so does the sound, silence. The program fills
// video memory, the colours and two maps by DMA, shows two backgrounds of mode 1, the third in front, scrolls them
// both ways, and steps the screen's brightness through every value. Then the Dreamport with a tile's row a colour off,
// a scroll a pixel off and a brightness a step off is each found at its first frame.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder, resultFolder } from '../lib/paths.mjs';
import { startingEntry, startingFiles } from '../lib/new-game.mjs';
import { madeUpPictureCartridge, PICTURE } from './made-up-snes.mjs';

const GAME = 'test-snes-kit', VERSION = `${GAME}/c`;
const WORK = join(LOCAL, 'test-snes-kit');
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
  let code = readFileSync(join(REPO, 'tools', 'test', 'snes-kit', 'main.c'), 'utf8').replace(/@([A-Z_]+)@/g, (_, key) => `0x${PICTURE[key].toString(16).toUpperCase()}`);
  for (const [from, to] of changes) {
    if (!code.includes(from)) throw new Error(`snes-kit/main.c has no "${from}" for the test to change.`);
    code = code.replace(from, to);
  }
  writeFileSync(join(gameFolder(VERSION), 'src', 'main.c'), code);
}

async function main() {
  const before = tracked(), copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
  tidy();
  mkdirSync(WORK, { recursive: true });
  try {
    const { rom } = madeUpPictureCartridge(), copy = join(WORK, `${GAME}.sfc`);
    writeFileSync(copy, rom);
    const original = { console: 'snes', name: 'Test Super Nintendo Kit (World)', title: 'DREAMPORTS PICTURE', code: '', sha1: createHash('sha1').update(rom).digest('hex') };
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

    console.log('What new writes in C, on the Super Nintendo\'s kit:');
    run = dp('prove', VERSION, 'still');
    check(run.status !== 0 && report().firstDifference?.frame === 0, `the backdrop in blue isn't the program's picture, and differs at once: ${JSON.stringify(report().firstDifference)}`);

    console.log('The program\'s Dreamport in C:');
    writeGame();
    run = dp('prove', VERSION, 'still');
    if (run.status !== 0) console.log(run.out.split('\n').slice(-15).join('\n'));
    check(run.status === 0 && report().frames === FRAMES && !report().firstDifference, `all ${FRAMES} frames the same as the emulator's, pictures and sound: ${run.out.trim().split('\n').at(-1)}`);

    console.log('With one thing a little off:');
    const wrong = async (changes, what) => {
      writeGame(changes);
      run = dp('prove', VERSION, 'still');
      const first = report().firstDifference;
      check(run.status !== 0 && first?.frame === 0, `${what}: ${JSON.stringify(first)}`);
    };
    await wrong([['snes_write(0x2105, 0x09);', 'snes_write(0x2105, 0x01);']], 'the third background behind the first, not in front, differs at the first frame');
    await wrong([['snes_write(0x210D, low);', 'snes_write(0x210D, (uint8_t)(low + 1));']], 'the first background a pixel off, at the first frame');
    await wrong([['snes_write(0x2100, (uint8_t)((low >> 3 & 0x0F) ^ 0x0F));', 'snes_write(0x2100, (uint8_t)((low >> 3 & 0x0F) ^ 0x0E));']], 'the brightness a step off, at the first frame');
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
  console.log('\nThe Super Nintendo\'s kit draws as the console does, every frame.');
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
