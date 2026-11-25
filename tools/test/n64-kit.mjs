// npm run test:n64-kit: the Nintendo 64's kit in C (kit/n64/c/) and `prove` on the Nintendo 64. A small program of the
// project's own (made-up-n64.mjs, madeUpKitCartridge) runs on the console's emulator, Parallel N64 with angrylion's RDP
// and cxd4's RSP: each frame it gives the RSP a microcode of its own, which makes the RDP's commands for a square and
// adds the frame's shade to its colour with the vector unit, and the RDP fills the background and the square. Its
// Dreamport in C (n64-kit/main.c) runs on the kit, in a game of its own that the test removes after, with the same
// microcode copied from the same cartridge, so no game's copy is needed: every frame of 300 has to be the same, pixel
// for pixel, and so does the sound, silence. The microcodes are the RSP's whole test: a second one runs every sum,
// load and store of its vector unit on numbers that change every frame and sends the results into the picture's rows,
// every bit of them, so the kit's RSP is compared with the emulator's on each. Then what `new` writes in C, the
// Dreamport without that check, and the Dreamport with its square a shade off, are each found at their first frame.
// First, the emulator itself with the tools' change to it, which says which functions start in each frame (told).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder, resultFolder } from '../lib/paths.mjs';
import { startingEntry, startingFiles } from '../lib/new-game.mjs';
import { consoleOf } from '../consoles.mjs';
import { libretroReference } from '../libretro/reference.mjs';
import { KIT, KIT_COMMANDS, LOAD, PARTS, VECTOR_AT, madeUpKitCartridge, madeUpKitMicrocode, madeUpPartsCartridge } from './made-up-n64.mjs';

const GAME = 'test-n64-kit', VERSION = `${GAME}/c`;
const WORK = join(LOCAL, 'test-n64-kit');
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
const hex = value => `0x${(value >>> 0).toString(16).toUpperCase()}`;

function tidy() {
  const kept = existsSync(MEDIA) ? readdirSync(MEDIA).filter(file => file.startsWith(GAME)).map(file => join(MEDIA, file)) : [];
  for (const path of [gameFolder(GAME), join(LOCAL, 'results', GAME), join(LOCAL, 'captures', GAME), join(REPO, '.github', 'readme', 'progress', `${GAME}.svg`), WORK, ...kept]) rmSync(path, { recursive: true, force: true });
}

// the Dreamport in C, with the program's numbers, and `changes`, each [what's there, what goes there instead]
function writeGame(changes = []) {
  const microcode = madeUpKitMicrocode();
  const numbers = { ...KIT, LOAD, MICROCODE: microcode.address, MICROCODE_BYTES: microcode.bytes, VECTOR_AT, COMMANDS: null };
  let code = readFileSync(join(REPO, 'tools', 'test', 'n64-kit', 'main.c'), 'utf8')
    .replace('@COMMANDS@', KIT_COMMANDS.map(hex).join(', '))
    .replace(/@([A-Z_]+)@/g, (_, key) => hex(numbers[key]));
  for (const [from, to] of changes) code = code.replace(from, to);
  writeFileSync(join(gameFolder(VERSION), 'src', 'main.c'), code);
}

// Parallel N64 with the tools' change to it (../libretro/parallel-n64.patch), which tells the program that plays the
// original where the processor is before each instruction: the parts program (madeUpPartsCartridge) has to play the
// same, picture and sound, while it tells and while it doesn't, and the functions it says start in each frame have to
// be those the program is known to start, from its own words. No game of the repository is needed.
async function told() {
  console.log('Parallel N64 says which functions start in each frame:');
  const reference = libretroReference(consoleOf('n64'));
  reference.ensureOriginal(console.log);
  const { cartridge, labels } = madeUpPartsCartridge(), copy = join(WORK, 'parts.z64');
  writeFileSync(copy, cartridge);
  const names = ['start', 'count', 'red', 'blue', 'bonus'], frames = 90, buttons = new Array(frames).fill(0);
  const functions = names.map((name, index) => ({ address: labels[name], size: 4, index }));
  const untold = await reference.runOriginal({ copy, frames, buttons, sound: true });
  const heard = await reference.runOriginal({ copy, frames, buttons, sound: true, functions });
  const same = buttons.filter((_, frame) => untold.hashes[frame] === heard.hashes[frame] && Buffer.from(untold.sound.read(frame)).equals(Buffer.from(heard.sound.read(frame)))).length;
  untold.sound.close();
  heard.sound.close();
  check(same === frames, `it plays the same while it tells of every instruction: ${same} of ${frames} frames, picture and sound`);
  const ranIn = name => heard.ran.map((list, frame) => (Array.from(list).includes(names.indexOf(name)) ? frame : -1)).filter(frame => frame >= 0);
  const [start, count, red, blue, bonus] = names.map(ranIn);
  check(start.length === 1 && start[0] === 0 && count.length === frames, `the start in the first frame alone, and count in each of the ${frames}: ${JSON.stringify(start)}, ${count.length}`);
  check(red.length === PARTS.TURN - 1 && red[0] === 0 && blue.length === frames - red.length && blue[0] === red.at(-1) + 1 && !bonus.length,
    `red in the first ${PARTS.TURN - 1} frames, blue in the rest and bonus in none: red to frame ${red.at(-1)}, blue from frame ${blue[0]}`);
  check(untold.ran.every(list => list.length === 0), 'and with no function asked of it, none');
}

async function main() {
  const before = tracked(), copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
  tidy();
  mkdirSync(WORK, { recursive: true });
  try {
    await told();
    const cartridge = madeUpKitCartridge(), copy = join(WORK, `${GAME}.z64`);
    writeFileSync(copy, cartridge);
    const original = { console: 'n64', name: 'Test Nintendo 64 Kit (World)', title: GAME, code: '', sha1: createHash('sha1').update(cartridge).digest('hex') };
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

    console.log('What new writes in C, on the Nintendo 64\'s kit:');
    run = dp('prove', VERSION, 'still');
    check(run.status !== 0 && report().firstDifference?.frame === 0, `the whole picture filled blue isn't the program's, and differs at once: ${JSON.stringify(report().firstDifference)}`);

    console.log('The program\'s Dreamport in C:');
    writeGame();
    run = dp('prove', VERSION, 'still');
    if (run.status !== 0) console.log(run.out.split('\n').slice(-15).join('\n'));
    check(run.status === 0 && report().frames === FRAMES && !report().firstDifference, `all ${FRAMES} frames the same as the emulator's, pictures and sound: ${run.out.trim().split('\n').at(-1)}`);

    console.log('Without the vector check:');
    writeGame([[`n64_write32(SP_PC, ${hex(VECTOR_AT)});`, 'n64_write32(SP_PC, 0x0);']]);
    run = dp('prove', VERSION, 'still');
    check(run.status !== 0 && report().firstDifference?.frame === 0 && report().firstDifference.box?.[1] > 200, `the first frame differs, at the check's rows: ${JSON.stringify(report().firstDifference)}`);

    console.log('With its square a shade off:');
    writeGame([[`(uint32_t)${hex(KIT.SQUARE)} << 16`, `(uint32_t)${hex(KIT.SQUARE + 0x40)} << 16`]]);
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
  console.log('\nThe Nintendo 64\'s kit draws as the console does, every frame, with the RSP running the program\'s own microcode.');
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
