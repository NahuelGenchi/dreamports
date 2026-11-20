// npm run test:snes-kit: the Super Nintendo's kit in C (kit/snes/c/) and `prove` on the Super Nintendo. Small programs
// of the project's own (made-up-snes.mjs) run on the console's real emulator, Snes9x, and their Dreamports in C
// (snes-kit/) on the kit, each in a game of its own that the test removes after, so no game's copy is needed: what
// `new` writes in C has to differ at once, and each Dreamport's every frame of 300 has to be the same, pixel for pixel,
// and so does the sound. Then each Dreamport with one thing a little off is found where it's first seen or heard.
//
// The picture program fills video memory, the colours and two maps by DMA, shows two backgrounds of mode 1, the third
// in front, scrolls them both ways, and steps the screen's brightness through every value. The sprite program shows
// 128 sprites over a background, every size $2101 chooses in turn, flips, priorities, more than 32 sprites on a line
// and more than 34 of their tiles, moves 8 of them through their table's port each frame, and turns $2103's priority
// rotation on and off, from an even address and an odd one. The modes program goes through modes 0 to 4, with offsets
// for each column of tiles, 256-colour tiles, direct colours and mosaic, and windows over them. The mode 7 program
// turns its field a step each frame, through every way outside the field, both flips, mosaic, the second background,
// direct colours, windows and colour maths, and reads the matrix's product back each frame. The HDMA program runs
// seven channels at once, through every way a channel reads its table, onto scrolls, brightness, windows, colours,
// mosaic and the mode. The raster program changes registers partway down the frame from its IRQ handler, by the V
// timer, the H and V timers and the H timer alone, and reads $4212. The colour program goes through 16 settings of windows
// and colour maths, the sub screen and the fixed colour, added, taken away and halved, at brightness 15 and below. The
// music program sends the sound processor a program
// with its samples through the console's start-up program, waits for its first answer, and gives it the frame's count
// each frame; that program plays three voices through the sound chip, with envelopes, BRR's filters, a bent pitch,
// noise and the echo, and changes them as its timer counts.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder, resultFolder } from '../lib/paths.mjs';
import { startingEntry, startingFiles } from '../lib/new-game.mjs';
import { COLOUR, HDMA, madeUpColourCartridge, madeUpHdmaCartridge, madeUpMode7Cartridge, madeUpRasterCartridge, madeUpModesCartridge, madeUpMusicCartridge, madeUpPictureCartridge, madeUpSpriteCartridge, MODE7, MODES, MUSIC, PICTURE, RASTER, SPRITES } from './made-up-snes.mjs';

const COPIES = join(LOCAL, 'copies.json');
const MEDIA = join(REPO, 'public', 'media');
const FRAMES = 300;

const PROGRAMS = [
  {
    name: 'picture', game: 'test-snes-kit', title: 'DREAMPORTS PICTURE', cartridge: madeUpPictureCartridge, data: PICTURE, file: 'main.c',
    wrongs: [
      [[['snes_write(0x2105, 0x09);', 'snes_write(0x2105, 0x01);']], 'the third background behind the first, not in front'],
      [[['snes_write(0x210D, low);', 'snes_write(0x210D, (uint8_t)(low + 1));']], 'the first background a pixel off'],
      [[['snes_write(0x2100, (uint8_t)((low >> 3 & 0x0F) ^ 0x0F));', 'snes_write(0x2100, (uint8_t)((low >> 3 & 0x0F) ^ 0x0E));']], 'the brightness a step off'],
    ],
  },
  {
    name: 'sprite', game: 'test-snes-kit-sprites', title: 'DREAMPORTS SPRITES', cartridge: madeUpSpriteCartridge, data: SPRITES, file: 'sprites.c',
    wrongs: [
      [[['snes_write(0x2104, (uint8_t)(x ^ low));', 'snes_write(0x2104, (uint8_t)((x ^ low) ^ 0x30));']], 'a sprite\'s priority off'],
      [[['snes_write(0x2104, (uint8_t)((x << 4) + low));', 'snes_write(0x2104, (uint8_t)((x << 4) + low + 1));']], 'a sprite a pixel off'],
      [[['snes_write(0x2101, (uint8_t)(SNES_RAM[2] | (low & 0x80) >> 4));', 'snes_write(0x2101, (uint8_t)(SNES_RAM[2] | 0x18));']], 'the sprites\' second table on the background\'s tiles'],
    ],
  },
  {
    name: 'colour', game: 'test-snes-kit-colour', title: 'DREAMPORTS COLOUR', cartridge: madeUpColourCartridge, data: COLOUR, file: 'colour.c',
    wrongs: [
      [[['+ 10 + x));', '+ 10 + x) ^ 0x80);']], 'taking away where it adds', 16],
      [[['snes_write(0x2132, (uint8_t)((low >> 1 & 0x1F) | 0x40));', 'snes_write(0x2132, (uint8_t)(((low >> 1) + 1 & 0x1F) | 0x40));']], 'the fixed colour\'s green a step off', 16],
      [[['+ 6 + x));', '+ 6 + x) & 0x00);']], 'no sub screen', 32],
      [[['snes_write(0x2127, (uint8_t)(one + 70));', 'snes_write(0x2127, (uint8_t)(one + 71));']], 'window 1 a pixel wider', 144],
    ],
  },
  {
    name: 'modes', game: 'test-snes-kit-modes', title: 'DREAMPORTS MODES', cartridge: madeUpModesCartridge, data: MODES, file: 'modes.c',
    wrongs: [
      [[['snes_write(0x2111, (uint8_t)(low * 3));', 'snes_write(0x2111, (uint8_t)(low * 3 + 1));']], 'BG3, whose map holds the offsets, a pixel across'],
      // first seen as mode 0's BG3, whose tiles of its far map's numbers reach them
      [[['store16(0x2116, 0x2000);', 'store16(0x2116, 0x2020);']], 'the 256-colour tiles a tile off', 16],
      [[['+ 8 + x));', '+ 8 + x) & 0xFE);']], 'no direct colours', 80],
      [[['+ 1 + x));', '+ 1 + x) + 0x10);']], 'the mosaic a pixel bigger', 128],
    ],
  },
  {
    name: 'mode7', game: 'test-snes-kit-mode7', title: 'DREAMPORTS MODE 7', cartridge: madeUpMode7Cartridge, data: MODE7, file: 'mode7.c',
    wrongs: [
      [[['twice(0x211C, sine);', 'twice(0x211C, (uint16_t)(sine + 1));']], 'the matrix\'s B a step off'],
      // found where the product first isn't 0, once the sine's top byte is 1
      [[['snes_write(0x2122, snes_read(0x2134));', 'snes_write(0x2122, snes_read(0x2135));']], 'the product\'s bytes mixed up', 42],
      [[['snes_write(0x211A, snes_bus(', 'snes_write(0x211A, 0x00 & snes_bus(']], 'the field always wrapped and never flipped', 16],
    ],
  },
  {
    name: 'hdma', game: 'test-snes-kit-hdma', title: 'DREAMPORTS HDMA', cartridge: madeUpHdmaCartridge, data: HDMA, file: 'hdma.c',
    wrongs: [
      [[['channel(0, 0x02, 0x0D,', 'channel(0, 0x02, 0x0F,']], 'the scroll\'s HDMA on BG2 rather than BG1'],
      [[['channel(1, 0x40,', 'channel(1, 0x00,']], 'the brightness\'s table read as it stands, not through its addresses'],
      [[['SNES_RAM[0x2000] = (uint8_t)((low & 0x3F) | 0x80);', 'SNES_RAM[0x2000] = (uint8_t)((low & 0x3F) | 0xC0);']], 'the window table\'s first count off'],
      [[['(((low & 0x20) >> 2) ^ 0x7F)', '(0x7F)']], 'channel 3 never turned off', 32],
    ],
  },
  {
    name: 'raster', game: 'test-snes-kit-raster', title: 'DREAMPORTS RASTER', cartridge: madeUpRasterCartridge, data: RASTER, file: 'raster.c',
    wrongs: [
      [[['  snes_write(0x4209, 0x28);\n  snes_write(0x420A, 0x00);\n  snes_write(0x4200, 0xA1);\n  uint16_t', '  snes_write(0x4209, 0x29);\n  snes_write(0x420A, 0x00);\n  snes_write(0x4200, 0xA1);\n  uint16_t']], 'the first split a line late'],
      [[['    snes_write(0x2122, (uint8_t)(LINES << 2));\n    snes_write(0x2122, (uint8_t)((LINES >> 1) | SNES_RAM[0x12]));\n', '']], 'the H timer\'s backdrop colours left out'],
      [[['snes_write(0x210F, (uint8_t)(snes_read(0x4212) & 0xC1));', 'snes_write(0x210F, (uint8_t)(snes_read(0x4212) & 0x80));']], '$4212 read as V-blank alone'],
      [[['  snes_interrupts(1);\n', '']], 'IRQs never let in'],
    ],
  },
  {
    name: 'music', game: 'test-snes-kit-music', title: 'DREAMPORTS MUSIC', cartridge: madeUpMusicCartridge, data: MUSIC, file: 'sound.c',
    wrongs: [
      // each found where it's first heard: voice 0 fading out, and the echo once voice 1's rise has made it loud
      [[['(uint8_t)((count >> 1 & 0x1F) | 0x1C)', '(uint8_t)((count >> 1 & 0x1F) | 0x0C)']], 'the noise slower'],
      [[['if (phase == 0x20) {', 'if (phase == 0x01) {']], 'voice 0 keyed off at once', 2],
      [[['(uint8_t)((count >> 1 & 0x1F) | 0x1C)', '(uint8_t)((count >> 1 & 0x1F) | 0x3C)']], 'the echo never written', 14],
    ],
  },
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
const tracked = () => spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: REPO, encoding: 'utf8' }).stdout;

function tidy(game) {
  const kept = existsSync(MEDIA) ? readdirSync(MEDIA).filter(file => file.startsWith(game)).map(file => join(MEDIA, file)) : [];
  for (const path of [gameFolder(game), join(LOCAL, 'results', game), join(LOCAL, 'captures', game), join(REPO, '.github', 'readme', 'progress', `${game}.svg`), join(LOCAL, game), ...kept]) rmSync(path, { recursive: true, force: true });
}

async function prove({ game, title, cartridge, data, file, wrongs }) {
  const version = `${game}/c`, work = join(LOCAL, game);
  const report = () => {
    const at = join(resultFolder(version, 'still'), 'report.json');
    return existsSync(at) ? JSON.parse(readFileSync(at, 'utf8')) : {};
  };
  // the Dreamport in C, with the program's numbers, and `changes`, each [what's there, what goes there instead]
  const writeGame = (changes = []) => {
    let code = readFileSync(join(REPO, 'tools', 'test', 'snes-kit', file), 'utf8').replace(/@([A-Z_]+)@/g, (_, key) => `0x${data[key].toString(16).toUpperCase()}`);
    for (const [from, to] of changes) {
      if (!code.includes(from)) throw new Error(`snes-kit/${file} has no "${from}" for the test to change.`);
      code = code.replace(from, to);
    }
    writeFileSync(join(gameFolder(version), 'src', 'main.c'), code);
  };
  tidy(game);
  mkdirSync(work, { recursive: true });
  try {
    const { rom } = cartridge(), copy = join(work, `${game}.sfc`);
    writeFileSync(copy, rom);
    const original = { console: 'snes', name: `Test ${title.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase())} (World)`, title, code: '', sha1: createHash('sha1').update(rom).digest('hex') };
    mkdirSync(join(proofFolder(game), 'recordings'), { recursive: true });
    writeFileSync(join(proofFolder(game), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
    let run = dp('rom', copy);
    check(run.status === 0 && run.out.includes(game), 'rom knows the program\'s copy');
    run = dp('codemap', game);
    check(run.status === 0, `its code map is found in the copy: ${run.out.trim().split('\n').at(-1)}`);
    const files = { ...startingFiles(game, original), 'entry.md': startingEntry(game, original, { issue: 1, lead: 'nobody', added: '2026-01-01' }) };
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(join(gameFolder(game), name, '..'), { recursive: true });
      writeFileSync(join(gameFolder(game), name), text);
    }
    for (const [name, text] of Object.entries(startingFiles(game, original, { language: 'c' }))) {
      mkdirSync(join(gameFolder(version), name, '..'), { recursive: true });
      writeFileSync(join(gameFolder(version), name), text);
    }
    writeFileSync(join(proofFolder(game), 'recordings', 'still.json'), `${JSON.stringify({ about: 'Nothing held.', frames: FRAMES, held: [[0, []]] }, null, 2)}\n`);

    run = dp('prove', version, 'still');
    check(run.status !== 0 && report().firstDifference?.frame === 0, `what new writes in C, the backdrop in blue, isn't the program's picture, and differs at once: ${JSON.stringify(report().firstDifference)}`);
    writeGame();
    run = dp('prove', version, 'still');
    if (run.status !== 0) console.log(run.out.split('\n').slice(-15).join('\n'));
    check(run.status === 0 && report().frames === FRAMES && !report().firstDifference, `its Dreamport in C: all ${FRAMES} frames the same as the emulator's, pictures and sound`);
    for (const [changes, what, at = 0] of wrongs) {
      writeGame(changes);
      run = dp('prove', version, 'still');
      const first = report().firstDifference;
      check(run.status !== 0 && first?.frame === at, `${what}, at ${at ? `frame ${at}, where it first differs` : 'the first frame'}: ${JSON.stringify(first)}`);
    }
  } finally {
    tidy(game);
  }
  check(!existsSync(gameFolder(game)), 'nothing is left behind');
}

async function main() {
  const before = tracked(), copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
  try {
    // one program alone when it's named, as `npm run test:snes-kit -- music`
    for (const program of PROGRAMS.filter(each => !process.argv[2] || each.name === process.argv[2])) {
      console.log(`The ${program.name} program:`);
      await prove(program);
    }
  } finally {
    if (copies) writeFileSync(COPIES, copies);
    else rmSync(COPIES, { force: true });
  }
  check(tracked() === before, 'nothing the repository tracks has changed');
  if (failures.length) {
    console.log(`\n${failures.length} failed.`);
    process.exit(1);
  }
  console.log('\nThe Super Nintendo\'s kit draws and plays as the console does, every frame.');
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
