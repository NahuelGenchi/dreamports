// The PlayStation Portable kit's graphics chip (kit/psp/c/ge.c), part of npm run test:psp-kit. A small program of the
// project's own that draws through the chip (made-up-psp-ge.mjs, madeUpPspGe) runs on the console's real emulator,
// PPSSPP, and its Dreamport in C (psp-ge/main.c) on the kit, in a game of its own that the test removes after: every
// frame of 300 has to be the same, pixel for pixel, and then every frame's draw list, every command the chip ran and
// every vertex it read. Then a Dreamport whose see-through rectangle is a shade off, one with a value of its dithering
// the other way, and one that waits for the chip a microsecond late, which the time it shows gives away, are each found by their
// pictures; and one whose list differs from the original's only in a command that draws nothing, which its pictures
// can't show, is found by its draw lists.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder, resultFolder } from '../lib/paths.mjs';
import { startingEntry, startingFiles } from '../lib/new-game.mjs';
import * as PROGRAM from './made-up-psp-ge.mjs';

const GAME = 'test-psp-ge', VERSION = `${GAME}/c`;
const WORK = join(LOCAL, 'test-psp-ge');
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
// the Dreamport in C, with the program's numbers and lists, and `changes`, each [what's there, what goes there instead]
function writeGame(program, changes = []) {
  const [left, right] = PROGRAM.squareEdges();
  const main = PROGRAM.mainList();
  const numbers = {
    ...PROGRAM, MAIN_AT: program.at['main list'], MAIN_END: program.at['main end'], BARS_AT: program.at['bars list'], TINY_AT: program.at['tiny list'],
    SQUARE_LEFT: left, SQUARE_RIGHT: right, ...Object.fromEntries([0, 1, 2, 3].map(index => [`BAR${index}`, PROGRAM.barEdge(index)])),
    ...Object.fromEntries(Object.entries(PROGRAM.CYCLES).map(([name, cycles]) => [`C_${name}`, cycles])),
  };
  const words = { MAIN_WORDS: main.words, BARS_WORDS: PROGRAM.barsList().words, TINY_WORDS: PROGRAM.tinyList().words };
  let code = readFileSync(join(REPO, 'tools', 'test', 'psp-ge', 'main.c'), 'utf8').replace(/@([A-Z_0-9]+)@/g, (_, key) => {
    if (words[key]) return hexWords(words[key]);
    if (typeof numbers[key] !== 'number') throw new Error(`The program has no ${key}.`);
    return `0x${numbers[key].toString(16).toUpperCase()}`;
  });
  for (const [from, to] of changes) {
    if (!code.includes(from)) throw new Error(`The Dreamport has no "${from}" for the test to change.`);
    // everywhere it is: a colour is in each of a rectangle's two corners
    code = code.split(from).join(to);
  }
  writeFileSync(join(gameFolder(VERSION), 'src', 'main.c'), code);
}
const word = value => `0x${(value >>> 0).toString(16).toUpperCase()}u`;

async function main() {
  const before = tracked(), copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
  tidy();
  try {
    mkdirSync(WORK, { recursive: true });
    const program = PROGRAM.madeUpPspGe(), copy = join(WORK, `${GAME}.elf`);
    writeFileSync(copy, program.elf);
    const original = { console: 'psp', name: 'Test PlayStation Portable Graphics (World)', title: GAME, code: '', sha1: createHash('sha1').update(program.elf).digest('hex'), keysAfterVBlank: true };
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

    console.log('The program\'s Dreamport in C, drawing through the graphics chip, by its pictures:');
    writeGame(program);
    run = dp('prove', VERSION, 'still');
    if (run.status !== 0) console.log(run.out.split('\n').slice(-15).join('\n'));
    check(run.status === 0 && report().frames === FRAMES && !report().firstDifference, `all ${FRAMES} frames the same as the emulator's: ${last(run)}`);

    console.log('By its draw lists:');
    writeOriginal({ provenBy: 'draw lists' });
    run = dp('prove', VERSION, 'still');
    if (run.status !== 0) console.log(run.out.split('\n').slice(-15).join('\n'));
    check(run.status === 0 && report().frames === FRAMES && !report().firstDifference, `every frame's draw list the same as the emulator's: ${last(run)}`);

    console.log('With what draws nothing a step off, by its draw lists:');
    // the tiny list's end says 1, where the original's says 0, which nothing on the screen shows
    const tiny = PROGRAM.tinyList().words;
    writeGame(program, [[`static const uint32_t TINY_LIST[] = { ${hexWords(tiny)} };`, `static const uint32_t TINY_LIST[] = { ${word(tiny[0] + 1)}, ${hexWords(tiny.slice(1))} };`]]);
    run = dp('prove', VERSION, 'still');
    check(run.status !== 0 && report().firstDifference?.frame <= 1, `the first frame's draw list differs: ${JSON.stringify(report().firstDifference)}`);
    writeOriginal({});
    run = dp('prove', VERSION, 'still');
    check(run.status === 0 && !report().firstDifference, `and its pictures can't show it: ${last(run)}`);

    console.log('With its see-through rectangle a shade off:');
    writeGame(program, [[word(PROGRAM.GLASS), word(PROGRAM.GLASS - 0x08)]]);
    run = dp('prove', VERSION, 'still');
    check(run.status !== 0 && report().firstDifference?.frame <= 1, `the first frame differs: ${JSON.stringify(report().firstDifference)}`);

    console.log('With a value of its dithering the other way:');
    // -4 where the original has 4, which shows in 15-bit colour, as the tools compare pictures: a step smaller than
    // that is the draw lists' to find
    const dither = PROGRAM.mainList().words.find(value => value >>> 24 === 0xE2);
    writeGame(program, [[word(dither), word(dither ^ 0x8)]]);
    run = dp('prove', VERSION, 'still');
    check(run.status !== 0 && report().firstDifference?.frame <= 1, `the first frame differs: ${JSON.stringify(report().firstDifference)}`);

    console.log('Waiting for the chip a microsecond late:');
    writeGame(program, [['    sceGeDrawSync(0);', '    sceGeDrawSync(0);\n    psp_time_pass(222);']]);
    run = dp('prove', VERSION, 'still');
    const late = report().firstDifference;
    check(run.status !== 0 && late?.frame <= 1 && late.box?.[1] >= PROGRAM.BARS[2] && late.box?.[1] < PROGRAM.BARS[3] + PROGRAM.BAR_HEIGHT, `the first frame differs, at the bar of the time after the wait: ${JSON.stringify(late)}`);
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
