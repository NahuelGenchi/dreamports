// npm run test:ps1-memories: the PlayStation's function check from memories of play (../ps1/twin.mjs, --memories), on
// a made-up program of the project's own (made-up-ps1.mjs, madeUpPlayExe) and its twins (ps1-memories/game.c), in a
// game of its own that the test removes after, so no game's copy is needed. The program sets a level and makes a count
// in memory only play has, then calls Level() and Add(count, 5) every frame. Its recording is played in PCSX ReARMed,
// built with the tools' change to it (../libretro/pcsx.patch), which tells of each function's start: each function has
// to keep its memories, the first with the registers and memory play gave it, and both twins have to be the same from
// them. Then a twin that's wrong only for the level play set: the program as the console loads it can't find that,
// and its memories of play have to.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, REPO, gameFolder, proofFolder } from '../lib/paths.mjs';
import { startingFiles } from '../lib/new-game.mjs';
import { openMemories } from '../ps1/twin-memories.mjs';
import { inImage, REGISTERS } from '../ps1/original.mjs';
import { madeUpPlayExe, PLAY } from './made-up-ps1.mjs';

const NAME = 'test-ps1-memories', VERSION = `${NAME}/c`;
const WORK = join(LOCAL, 'tmp', 'ps1-memories-test');
const COPIES = join(LOCAL, 'copies.json');
const GAME = fileURLToPath(new URL('./ps1-memories/game.c', import.meta.url));
const FRAMES = 60;

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
const tidy = () => {
  for (const path of [gameFolder(NAME), join(LOCAL, 'twin', NAME), join(LOCAL, 'results', NAME), WORK]) rmSync(path, { recursive: true, force: true });
};
const word = (image, address) => new DataView(image.buffer, image.byteOffset).getUint32(inImage(address), true);

async function main() {
  const before = tracked(), copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
  tidy();
  mkdirSync(WORK, { recursive: true });
  const game = readFileSync(GAME, 'utf8');
  try {
    const exe = await madeUpPlayExe(), copy = join(WORK, `${NAME}.exe`);
    writeFileSync(copy, exe);
    const original = { console: 'ps1', name: 'Test PlayStation Memories (World)', title: NAME, code: '', sha1: createHash('sha1').update(exe).digest('hex') };
    mkdirSync(join(proofFolder(NAME), 'recordings'), { recursive: true });
    writeFileSync(join(proofFolder(NAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
    writeFileSync(join(proofFolder(NAME), 'recordings', 'play.json'), `${JSON.stringify({ about: 'Nothing held.', frames: FRAMES, held: [[0, []]] }, null, 2)}\n`);
    // a version is known by its page, which is written as `new` writes one
    mkdirSync(join(gameFolder(VERSION), 'src'), { recursive: true });
    writeFileSync(join(gameFolder(VERSION), 'index.html'), startingFiles(NAME, original, { language: 'c' })['index.html']);
    writeFileSync(join(gameFolder(VERSION), 'src', 'game.c'), game);
    let run = dp('rom', copy);
    check(run.status === 0 && run.out.includes(NAME), 'rom knows the program\'s copy');
    run = dp('codemap', NAME);
    check(run.status === 0, `its code map is made from the copy: ${run.out.trim().split('\n').at(-1)}`);

    console.log('Memories of play:');
    run = dp('twin', VERSION, '--memories', '--calls', '300');
    if (run.status !== 0) console.log(run.out);
    check(run.status === 0 && /memories of 2 of the 2 functions kept/.test(run.out), `each function keeps its memories as it starts in play: ${run.out.split('\n').find(line => /memories of/.test(line))}`);
    check(/2 of 2 functions left the same memory/.test(run.out) && /from \d+ memories of play/.test(run.out), `both twins are the same from them: ${run.out.trim().split('\n').at(-1)}`);
    const memories = openMemories(join(LOCAL, 'twin', VERSION, 'ps1'));
    const [add] = memories.of(PLAY.ADD_FN), [level] = memories.of(PLAY.LEVEL_FN);
    const a = name => add?.registers[REGISTERS.indexOf(name)] >>> 0;
    check(add && a('a0') === PLAY.COUNT_AT && a('a1') === PLAY.BY, `Add's memory has what play gave it, its count's address and ${PLAY.BY}, set in the call's delay slot: a0 0x${a('a0')?.toString(16)}, a1 ${a('a1')}`);
    check(add && word(add.image, PLAY.COUNT_AT) >= PLAY.START && (word(add.image, PLAY.COUNT_AT) - PLAY.START) % PLAY.BY === 0 && word(add.image, PLAY.LEVEL_AT) === PLAY.LEVEL,
      `and the memory play had then: the count at ${add ? word(add.image, PLAY.COUNT_AT) : '?'}, the level at 0x${add ? word(add.image, PLAY.LEVEL_AT).toString(16) : '?'}`);
    check(level && (level.registers[REGISTERS.indexOf('sp')] >>> 0) === 0x801FFF00 && memories.count <= 8, `Level's starts on play's stack, and each function keeps at most four: ${memories.count} in all`);
    run = dp('twin', VERSION, '--memories', '--calls', '300');
    check(run.status === 0 && /are from these recordings and this copy already/.test(run.out), 'they\'re taken once, and kept for the next run');

    console.log('A twin wrong only for the level play set:');
    writeFileSync(join(gameFolder(VERSION), 'src', 'game.c'), game.replace('return D_80030000 + 1;', `return D_80030000 == 0x${PLAY.LEVEL.toString(16)} ? 0 : D_80030000 + 1;`));
    check(game.includes('return D_80030000 + 1;'), 'the twins have the line the test changes');
    run = dp('twin', VERSION, 'Level', '--calls', '300');
    check(run.status === 0 && /The same memory {2}0x80010100 Level/.test(run.out), 'from the program as the console loads it, nothing finds it');
    run = dp('twin', VERSION, 'Level', '--memories', '--calls', '300');
    const differs = run.out.split('\n').find(line => /Differs/.test(line)) ?? '';
    check(run.status === 3 && /call 1, Level\(\), as play made it/.test(differs), `from its memories of play, the call play made finds it: ${differs.trim()}`);
  } finally {
    tidy();
    if (copies) writeFileSync(COPIES, copies);
    else rmSync(COPIES, { force: true });
  }
  check(!existsSync(gameFolder(NAME)), 'nothing is left behind');
  check(tracked() === before, 'nothing the repository tracks has changed');
  if (failures.length) {
    console.log(`\n${failures.length} failed.`);
    process.exit(1);
  }
  console.log('\nThe PlayStation\'s function check starts from what play gave each function.');
}

main().catch(error => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
