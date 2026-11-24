// npm run test:nds-kit: proves programs of the project's own on the Nintendo DS kit in C (kit/nds/c/) against melonDS,
// the reference emulator, built as test:real-nds builds it, every frame of both screens and the sound, each with a
// Dreamport in C in a folder of its own that it removes after, so no game's copy is needed. test:real-nds proves the
// kit's two programs side by side, its buttons, touch screen and sound; this proves what's drawn: the video memory's
// banks and the 2D engines' text backgrounds (made-up-nds-bg.mjs), then their sprites (made-up-nds-obj.mjs), and finds
// Dreamports that draw them wrong.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder, resultFolder } from '../lib/paths.mjs';
import { startingEntry, startingFiles } from '../lib/new-game.mjs';
import { writeRecording } from '../lib/recording.mjs';
import { madeUpNdsBackgrounds } from './made-up-nds-bg.mjs';
import { madeUpNdsSprites, setupInC } from './made-up-nds-obj.mjs';

const GAME = 'test-nds-kit', C_GAME = `${GAME}/c`;
const WORK = join(LOCAL, 'test-nds-kit');
const COPIES = join(LOCAL, 'copies.json'), STATUS = join(REPO, 'docs', 'STATUS.md'), MEDIA = join(REPO, 'public', 'media');
const FRAMES = 240;

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
const dp = (...args) => {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 26 });
  return { status, out: stdout + stderr };
};
const report = recording => {
  const file = join(resultFolder(C_GAME, recording), 'report.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
};

function tidy() {
  const kept = readdirSync(MEDIA).filter(file => file.startsWith(GAME)).map(file => join(MEDIA, file));
  for (const path of [gameFolder(GAME), WORK, join(LOCAL, 'results', GAME), join(LOCAL, 'captures', GAME), join(REPO, '.github', 'readme', 'progress', `${GAME}.svg`), ...kept]) rmSync(path, { recursive: true, force: true });
}

// the Dreamport, with the map's flips and the second background's control as the original has them unless told
function writeGame({ flip = '<< 10', front = '0x0104' } = {}) {
  const numbers = { FLIP: flip, FRONT: front };
  writeFileSync(join(gameFolder(C_GAME), 'src', 'main.c'), readFileSync(join(REPO, 'tools', 'test', 'nds-kit', 'backgrounds.c'), 'utf8').replace(/@([A-Z_]+)@/g, (_, key) => numbers[key]));
}

async function main() {
  tidy();
  mkdirSync(WORK, { recursive: true });
  const { rom, sha1 } = madeUpNdsBackgrounds();
  const copy = join(WORK, 'backgrounds.nds');
  writeFileSync(copy, rom);
  const original = { console: 'nds', name: 'Test Nintendo DS Kit (World)', title: 'MADE UP BGS', code: 'MDBE', sha1 };
  mkdirSync(join(proofFolder(GAME), 'recordings'), { recursive: true });
  writeFileSync(join(proofFolder(GAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
  writeFileSync(join(gameFolder(GAME), 'entry.md'), startingEntry(GAME, original, { issue: 1, lead: 'nobody', added: '2026-01-01' }));
  for (const [name, text] of Object.entries(startingFiles(GAME, original, { language: 'c' }))) {
    mkdirSync(join(gameFolder(C_GAME), name, '..'), { recursive: true });
    writeFileSync(join(gameFolder(C_GAME), name), text);
  }
  let run = dp('rom', copy);
  check(run.status === 0 && run.out.includes(GAME), `rom knows the copy: ${run.out.trim().split('\n')[1]?.trim()}`);
  writeRecording(join(proofFolder(GAME), 'recordings', 'scroll.json'), {
    about: 'The backgrounds scrolling, with A and Right held at times.', frames: FRAMES,
    held: [[0, []], [40, ['A']], [80, []], [100, ['RIGHT']], [140, ['A', 'RIGHT']], [180, []]],
  });

  console.log('Text backgrounds, on both engines, from the video memory\'s banks');
  writeGame();
  run = dp('prove', C_GAME, 'scroll');
  const same = report('scroll');
  check(run.status === 0 && same?.matched === FRAMES, `the kit's engines draw the program's backgrounds as melonDS does on every frame, 16 and 256 colours, two priorities, flips and scrolling, and a byte written to a colour lost: ${same?.matched} of ${FRAMES}, ${JSON.stringify(same?.firstDifference)}`);
  if (run.status) console.log(run.out);
  writeGame({ flip: '* 0' });
  run = dp('prove', C_GAME, 'scroll');
  check(run.status !== 0 && report('scroll')?.firstDifference?.frame === 0, `a map whose tiles aren't flipped is found at once: ${JSON.stringify(report('scroll')?.firstDifference)}`);
  writeGame({ front: '0x0106' });
  run = dp('prove', C_GAME, 'scroll');
  check(run.status !== 0 && report('scroll')?.firstDifference?.frame === 0, `and a background behind where it should be in front: ${JSON.stringify(report('scroll')?.firstDifference)}`);

  console.log('Sprites, on both engines, their tiles mapped both ways');
  const sprites = madeUpNdsSprites(), spritesCopy = join(WORK, 'sprites.nds');
  writeFileSync(spritesCopy, sprites.rom);
  writeFileSync(join(proofFolder(GAME), 'original.json'), `${JSON.stringify({ ...original, title: 'MADE UP OBJS', code: 'MDOE', sha1: sprites.sha1 }, null, 2)}\n`);
  run = dp('rom', spritesCopy);
  check(run.status === 0 && run.out.includes(GAME), 'rom knows the second program\'s copy');
  rmSync(join(proofFolder(GAME), 'recordings', 'scroll.json'));
  writeRecording(join(proofFolder(GAME), 'recordings', 'sprites.json'), {
    about: 'The sprites moving, with A and Right held at times.', frames: FRAMES,
    held: [[0, []], [30, ['A']], [60, []], [100, ['RIGHT']], [130, ['A', 'RIGHT']], [160, []]],
  });
  const writeSprites = ({ flip = '0x1000', sprite1 = '0x0801' } = {}) => {
    const numbers = { SETUP: setupInC(), FLIP: flip, SPRITE1: sprite1 };
    writeFileSync(join(gameFolder(C_GAME), 'src', 'main.c'), readFileSync(join(REPO, 'tools', 'test', 'nds-kit', 'sprites.c'), 'utf8').replace(/@([A-Z_0-9]+)@/g, (_, key) => numbers[key]));
  };
  writeSprites();
  run = dp('prove', C_GAME, 'sprites');
  const drawn = report('sprites');
  check(run.status === 0 && drawn?.matched === FRAMES, `the kit's engines draw the program's sprites as melonDS does on every frame, 16 and 256 colours, flipped, mapped both ways, off each edge, among the backgrounds, the earlier over the later: ${drawn?.matched} of ${FRAMES}, ${JSON.stringify(drawn?.firstDifference)}`);
  if (run.status) console.log(run.out);
  writeSprites({ flip: '0' });
  run = dp('prove', C_GAME, 'sprites');
  check(run.status !== 0 && report('sprites')?.firstDifference?.frame === 100, `a sprite that isn't flipped while Right is held is found where it first shows, at frame 100: ${JSON.stringify(report('sprites')?.firstDifference)}`);
  writeSprites({ sprite1: '0x0001' });
  run = dp('prove', C_GAME, 'sprites');
  check(run.status !== 0 && report('sprites')?.firstDifference?.frame === 0, `and a sprite in front of the background where it's behind: ${JSON.stringify(report('sprites')?.firstDifference)}`);
}

const kept = { status: readFileSync(STATUS), copies: existsSync(COPIES) ? readFileSync(COPIES) : null };
const untouched = () => execFileSync('git', ['status', '--porcelain', '--', 'docs/STATUS.md', '.github/readme/progress', 'public/media', 'games'], { cwd: REPO, encoding: 'utf8' });
const dirtyBefore = untouched();
try {
  await main();
} finally {
  tidy();
  writeFileSync(STATUS, kept.status);
  if (kept.copies) writeFileSync(COPIES, kept.copies);
  else rmSync(COPIES, { force: true });
}
check(untouched() === dirtyBefore, 'nothing is left behind');

if (failures.length) {
  console.log(`\n${failures.length} failed.`);
  process.exit(1);
}
console.log('\nAll passed.');
process.exit(0);
