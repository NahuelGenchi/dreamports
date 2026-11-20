// npm run test:ps2-memories: the memories of play the PlayStation 2's function check starts its calls from, taken in
// the console's real emulator, Play!, with the made-up program of the function check's test (ps2-twin/program.mjs), so
// it needs nobody's copy of any game. The emulator, with the tools' change to it, tells of each function's start as the
// program's own play reaches it, with the EE's registers and the memory then (../libretro/starts.h). Those have to be
// what the check's own processor holds at the same starts (../ps2/call.cpp), which is the two run side by side on the
// same code. Then the program as a game of its own, with a recording, through the tool everyone runs: npm run dp --
// twin <version> --memories plays the recording and starts each function's calls from its own memories.
//
// It isn't run on every pull request, as the emulator takes minutes to build, and it runs on Linux and macOS alone, as
// that's where the tools give the emulator a graphics context (docs/CONSOLES.md).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, REPO, gameFolder, proofFolder } from '../lib/paths.mjs';
import { startingFiles } from '../lib/new-game.mjs';
import { consoleOf } from '../consoles.mjs';
import { libretroReference } from '../libretro/reference.mjs';
import { buildCaller, EE_REGISTERS, Original, PAGE } from '../ps2/original.mjs';
import { imageOf } from '../ps2/twin.mjs';
import { startsIn } from '../ps2/twin-memories.mjs';
import { madeUpElf } from './ps2-twin/program.mjs';

const GAME = fileURLToPath(new URL('./ps2-twin/game.c', import.meta.url));
const work = join(LOCAL, 'tmp', 'ps2-memories-test');
const FRAMES = 20;

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
const tracked = () => spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: REPO, encoding: 'utf8' }).stdout;
const before = tracked();

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const { elf, labels, functions } = madeUpElf();
const copy = join(work, 'made-up.elf');
writeFileSync(copy, elf);
const nameOf = address => functions.find(f => f.address === address)?.name ?? address.toString(16);
const reference = libretroReference(consoleOf('ps2'));
reference.ensureOriginal(message => console.log(message));

console.log('Each function\'s start, as the emulator plays the program:');
const watched = join(work, 'starts.bin');
writeFileSync(watched, new Uint8Array(Uint32Array.from(functions.map(f => f.address)).buffer));
await reference.runOriginal({ copy, frames: FRAMES, buttons: new Array(FRAMES).fill(0), env: { DP_STARTS: watched } });
const played = [...startsIn(`${watched}.out`)];
const order = 'main 1,sum 1,fill 1,twice 1,lookup 1,wide 1,likely 1,pick 1,shine 1';
check(played.map(start => `${nameOf(start.address)} ${start.number}`).join() === order, `it tells of each, in the order the program calls them: ${played.map(start => `${nameOf(start.address)} ${start.number}`).join(', ')}`);
check(played[0].pages.some(({ page }) => page === labels.start >>> 12) && played.slice(1).every(start => start.pages.length <= 2), `the first with every page that holds anything (${played[0].pages.length}), and the rest only those written since (${played.slice(1).map(start => start.pages.length).join(', ')})`);

console.log('The same starts, in the check\'s own processor:');
{
  const original = new Original(await buildCaller(), 'ee');
  try {
    await original.image(imageOf(elf));
    const ours = (await original.call({ address: labels.start, span: 8, limit: 5000, registers: new Array(EE_REGISTERS.words).fill(0), watch: functions.map(f => f.address) })).starts.filter(start => start.address !== labels.start);
    check(ours.map(start => `${nameOf(start.address)} ${start.number}`).join() === order, 'it reaches the same starts in the same order');
    // what the program itself sets before each call: the arguments it gives, the stack and where to come back to
    const given = start => [4, 5, 6, 29, 31].map(n => start.registers[n * 4].toString(16)).join(' ');
    const apart = played.filter((start, n) => n > 0 && given(start) !== given(ours[n]));
    check(!apart.length, `with the same arguments, stack and return address at each (${apart.map(start => nameOf(start.address)).join(', ')})`);
    // the program's own page, as each side has it when fill has written its buffer: twice starts after it
    const pageAt = (starts, name) => {
      let page = null;
      for (const start of starts) {
        page = start.pages.find(each => each.page === labels.start >>> 12)?.bytes ?? page;
        if (nameOf(start.address) === name) return page;
      }
      return null;
    };
    const theirs = pageAt(played, 'twice'), mine = pageAt([{ address: labels.start, pages: [{ page: labels.start >>> 12, bytes: imageOf(elf).subarray(labels.start & ~(PAGE - 1), (labels.start & ~(PAGE - 1)) + PAGE) }] }, ...ours], 'twice');
    check(theirs && mine && Buffer.compare(theirs, mine) === 0 && theirs[labels.buffer & (PAGE - 1)] === 0x5A, 'and the program\'s own page the same, with what fill wrote in it');
  } finally {
    original.close();
  }
}

// The tool as it's typed: the program as a game in games/, with a recording, for as long as this takes.
{
  console.log('Through npm run dp -- twin --memories:');
  const NAME = 'test-ps2-memories', VERSION = `${NAME}/c`, COPIES = join(LOCAL, 'copies.json');
  const dp = (...args) => {
    const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 24 });
    return { status, out: stdout + stderr };
  };
  const tidy = () => {
    rmSync(gameFolder(NAME), { recursive: true, force: true });
    rmSync(join(LOCAL, 'twin', NAME), { recursive: true, force: true });
  };
  const copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
  tidy();
  try {
    mkdirSync(join(proofFolder(NAME), 'recordings'), { recursive: true });
    const original = { console: 'ps2', name: 'Test PlayStation 2 Memories (World)', title: 'memories', code: '', sha1: createHash('sha1').update(elf).digest('hex') };
    writeFileSync(join(proofFolder(NAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
    writeFileSync(join(proofFolder(NAME), 'addresses.json'), `${JSON.stringify({ addresses: Object.fromEntries(['values', 'buffer', 'functions', 'mode'].map(name => [name, labels[name].toString(16).toUpperCase().padStart(8, '0')])) }, null, 2)}\n`);
    writeFileSync(join(proofFolder(NAME), 'recordings', 'power-on.json'), `${JSON.stringify({ about: 'Power-on, and the program runs by itself.', frames: FRAMES, held: [[0, []]] }, null, 2)}\n`);
    mkdirSync(join(gameFolder(VERSION), 'src'), { recursive: true });
    writeFileSync(join(gameFolder(VERSION), 'index.html'), startingFiles(NAME, original, { language: 'c' })['index.html']);
    writeFileSync(join(gameFolder(VERSION), 'src', 'game.c'), readFileSync(GAME, 'utf8'));
    let run = dp('rom', copy);
    check(run.status === 0 && run.out.includes(NAME), 'rom knows the program\'s copy');
    run = dp('codemap', NAME);
    check(run.status === 0, `its code map is made from the copy: ${run.out.trim().split('\n').at(-1)}`);
    run = dp('twin', VERSION, '--memories', '--calls', '200');
    check(run.status === 0 && /9 memories of 9 of the 19 functions kept in \.dreamports\/twin\/test-ps2-memories\/c\/ps2\//.test(run.out), `the recording is played and a memory kept of each function it reaches: ${run.out.split('\n').find(line => /memories of/.test(line))}`);
    check(/16 of 19 functions left the same memory.*from 9 memories of play, which 9 of the version's functions have their own of/.test(run.out), `and every twin is the same from them: ${run.out.trim().split('\n').slice(-2)[0]}`);
    run = dp('twin', VERSION, 'sum', '--memories', '--calls', '200');
    check(run.status === 0 && /are from these recordings and this copy already/.test(run.out), 'kept memories are used again, with nothing played');
    writeFileSync(join(gameFolder(VERSION), 'src', 'game.c'), readFileSync(GAME, 'utf8').replace('return a + b;', 'return a - b;'));
    run = dp('twin', VERSION, 'sum', '--memories', '--calls', '200');
    check(run.status === 3 && /sum\(0x00000002, 0x00000003\), as play made it, from the memory of power-on at its start 1/.test(run.out), `a twin that differs on the call play made says so: ${run.out.trim().split('\n').find(line => /Differs/.test(line))}`);
  } finally {
    tidy();
    if (copies) writeFileSync(COPIES, copies);
    else rmSync(COPIES, { force: true });
  }
  check(!existsSync(gameFolder(NAME)), 'nothing is left behind');
}

rmSync(work, { recursive: true, force: true });
check(tracked() === before, 'nothing the repository tracks has changed');
if (failures.length) {
  console.log(`\n${failures.length} failed.`);
  process.exit(1);
}
console.log('\nThe PlayStation 2\'s function check starts from what play gave each function.');
