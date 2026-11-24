// npm run test:nds-kit: proves programs of the project's own on the Nintendo DS kit in C (kit/nds/c/) against melonDS,
// the reference emulator, built as test:real-nds builds it, every frame of both screens and the sound, each with a
// Dreamport in C in a folder of its own that it removes after, so no game's copy is needed. test:real-nds proves the
// kit's two programs side by side, its buttons, touch screen and sound; this proves what's drawn: the video memory's
// banks and the 2D engines' text backgrounds (made-up-nds-bg.mjs), then their sprites (made-up-nds-obj.mjs), the two
// processors talking (made-up-nds-ipc.mjs), their interrupts and timers (made-up-nds-irq.mjs), and their DMA channels
// (made-up-nds-dma.mjs), and finds Dreamports that get them wrong.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder, resultFolder } from '../lib/paths.mjs';
import { startingEntry, startingFiles } from '../lib/new-game.mjs';
import { writeRecording } from '../lib/recording.mjs';
import { madeUpNdsBackgrounds } from './made-up-nds-bg.mjs';
import { madeUpNdsSprites, setupInC } from './made-up-nds-obj.mjs';
import { madeUpNdsIpc } from './made-up-nds-ipc.mjs';
import { madeUpNdsIrq } from './made-up-nds-irq.mjs';
import { madeUpNdsDma } from './made-up-nds-dma.mjs';

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

  console.log('The two processors talking: the shared memory, the message queue and the sync register');
  const talking = madeUpNdsIpc(), talkingCopy = join(WORK, 'talking.nds');
  writeFileSync(talkingCopy, talking.rom);
  writeFileSync(join(proofFolder(GAME), 'original.json'), `${JSON.stringify({ ...original, title: 'MADE UP IPC', code: 'MDIE', sha1: talking.sha1 }, null, 2)}\n`);
  run = dp('rom', talkingCopy);
  check(run.status === 0 && run.out.includes(GAME), 'rom knows the third program\'s copy');
  rmSync(join(proofFolder(GAME), 'recordings', 'sprites.json'));
  writeRecording(join(proofFolder(GAME), 'recordings', 'talking.json'), {
    about: 'The two processors talking, with A, B, Select and Start held at times.', frames: FRAMES,
    held: [[0, []], [20, ['A']], [50, ['B', 'START']], [90, []], [120, ['SELECT']], [150, []]],
  });
  const writeTalking = ({ wramcnt = '0' } = {}) => writeFileSync(join(gameFolder(C_GAME), 'src', 'main.c'), readFileSync(join(REPO, 'tools', 'test', 'nds-kit', 'ipc.c'), 'utf8').replace('@WRAMCNT@', wramcnt));
  writeTalking();
  run = dp('prove', C_GAME, 'talking');
  const talked = report('talking');
  check(run.status === 0 && talked?.matched === FRAMES, `the kit's two processors talk as melonDS's do on every frame, through the queue, the sync register and the shared memory given from one to the other, the ARM9's fast data memory over it: ${talked?.matched} of ${FRAMES}, ${JSON.stringify(talked?.firstDifference)}`);
  if (run.status) console.log(run.out);
  writeTalking({ wramcnt: '2' });
  run = dp('prove', C_GAME, 'talking');
  check(run.status !== 0 && report('talking')?.firstDifference?.frame === 1, `a Dreamport that takes the wrong half of the shared memory is found once the ARM7's first reply shows, at frame 1: ${JSON.stringify(report('talking')?.firstDifference)}`);

  console.log('The interrupts and the timers, with the BIOS waiting for the V-blank');
  const counting = madeUpNdsIrq(), countingCopy = join(WORK, 'counting.nds');
  writeFileSync(countingCopy, counting.rom);
  writeFileSync(join(proofFolder(GAME), 'original.json'), `${JSON.stringify({ ...original, title: 'MADE UP IRQ', code: 'MDQE', sha1: counting.sha1 }, null, 2)}\n`);
  run = dp('rom', countingCopy);
  check(run.status === 0 && run.out.includes(GAME), 'rom knows the fourth program\'s copy');
  rmSync(join(proofFolder(GAME), 'recordings', 'talking.json'));
  writeRecording(join(proofFolder(GAME), 'recordings', 'counting.json'), {
    about: 'The interrupts counted, with A, B and Start held at times.', frames: FRAMES,
    held: [[0, []], [30, ['A']], [60, []], [90, ['B']], [120, ['START']], [150, ['B', 'START']], [180, []]],
  });
  const writeCounting = ({ timer0 = '0x00C3FC00' } = {}) => writeFileSync(join(gameFolder(C_GAME), 'src', 'main.c'), readFileSync(join(REPO, 'tools', 'test', 'nds-kit', 'interrupts.c'), 'utf8').replace('@TIMER0@', timer0));
  writeCounting();
  run = dp('prove', C_GAME, 'counting');
  const counted = report('counting');
  check(run.status === 0 && counted?.matched === FRAMES, `the kit's interrupts and timers run as melonDS's do on every frame: the V-blank's and the timers', a timer that counts another's overflows, one stopped and started again, the sync register's and the queue's from the other processor, and the BIOS waiting for the V-blank through them, each timer read in the V-blank's handler to the tick: ${counted?.matched} of ${FRAMES}, ${JSON.stringify(counted?.firstDifference)}`);
  if (run.status) console.log(run.out);
  writeCounting({ timer0: '0x00C2FC00' });
  run = dp('prove', C_GAME, 'counting');
  check(run.status !== 0 && report('counting')?.firstDifference?.frame === 1, `a Dreamport whose timer counts four times as fast is found in the first frame that shows the counts, frame 1: ${JSON.stringify(report('counting')?.firstDifference)}`);

  console.log('The DMA channels, copying and filling at once and at each V-blank');
  const copying = madeUpNdsDma(), copyingCopy = join(WORK, 'copying.nds');
  writeFileSync(copyingCopy, copying.rom);
  writeFileSync(join(proofFolder(GAME), 'original.json'), `${JSON.stringify({ ...original, title: 'MADE UP DMA', code: 'MDDE', sha1: copying.sha1 }, null, 2)}\n`);
  run = dp('rom', copyingCopy);
  check(run.status === 0 && run.out.includes(GAME), 'rom knows the fifth program\'s copy');
  rmSync(join(proofFolder(GAME), 'recordings', 'counting.json'));
  writeRecording(join(proofFolder(GAME), 'recordings', 'copying.json'), { about: 'The DMA channels copying, with no button held.', frames: FRAMES, held: [[0, []]] });
  const writeCopying = ({ reverse = '0x80200020' } = {}) => writeFileSync(join(gameFolder(C_GAME), 'src', 'main.c'), readFileSync(join(REPO, 'tools', 'test', 'nds-kit', 'dma.c'), 'utf8').replace('@REVERSE@', reverse));
  writeCopying();
  run = dp('prove', C_GAME, 'copying');
  const copied = report('copying');
  check(run.status === 0 && copied?.matched === FRAMES, `the kit's DMA channels copy and fill as melonDS's do on every frame, by halfwords and words, up, down and from a fill register, at once and at each V-blank with its interrupt's flag, on both processors, each of four ways timed to the tick, the main memory's bursts among them: ${copied?.matched} of ${FRAMES}, ${JSON.stringify(copied?.firstDifference)}`);
  if (run.status) console.log(run.out);
  writeCopying({ reverse: '0x80000020' });
  run = dp('prove', C_GAME, 'copying');
  check(run.status !== 0 && report('copying')?.firstDifference?.frame === 2, `a Dreamport whose copy counts up where it counts down is found in the first frame that shows it, frame 2: ${JSON.stringify(report('copying')?.firstDifference)}`);
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
