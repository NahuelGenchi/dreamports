// npm run test:same-memory: the same-memory build (tools/README.md) with a program of the project's own
// (same-memory/cart.c), so it needs nobody's copy of any game. The program is built twice from the same C: as a
// cartridge, with the Game Boy Advance's own compiler, the tools' assembler and the few lines of a linker here, and as
// a Dreamport, on the kit, with its memory at the console's addresses, the table from an address to its twin, and the
// pass that lets its C wait from inside a function. Then prove plays both, the cartridge in mGBA and the Dreamport in
// a browser, and has to find every frame the same, picture and sound, and every byte of the work memory the same after
// every frame. And it has to find a line written wrong: one that shows on the screen, one that only the work memory
// shows, a wait a frame short, a byte written to video memory as if it were any other memory, and a call to a function
// of the cartridge with no C yet, which stops the Dreamport and names it. A function kept and called as plain C, with
// no CODE or CALL, is kept by its address in the cartridge and called as its twin all the same. A function the program
// copies to the fast work memory and calls there is called as its twin too.
//
// The Dreamport is in a folder of its own, games/test-same-memory/, which is removed after.

import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, REPO, gameFolder, proofFolder, resultFolder } from '../lib/paths.mjs';
import { startingEntry, startingFiles } from '../lib/new-game.mjs';
import { withBuildTools } from '../gba/build.mjs';
import { buildCompilers, isCompilerBuilt } from '../gba/agbcc.mjs';
import { CARTRIDGE, COMPILER, DATA, compile, link } from './same-memory/cartridge.mjs';

const HERE = fileURLToPath(new URL('./same-memory/', import.meta.url));
const GAME = 'test-same-memory', C_GAME = `${GAME}/c`;
const WORK = join(LOCAL, 'test-same-memory');
const COPIES = join(LOCAL, 'copies.json');
const STATUS = join(REPO, 'docs', 'STATUS.md');
const MEDIA = join(REPO, 'public', 'media');
const PROGRESS = join(REPO, '.github', 'readme', 'progress');
// the work memory compared: all of the slow one, and the fast one up to where the console's processor keeps its stack,
// as a Dreamport's C keeps its own elsewhere
const WORK_MEMORY = [{ address: '02000000', bytes: 0x40000 }, { address: '03000000', bytes: 0x7E00 }];

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
const dp = (...args) => {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 26 });
  return { status, out: stdout + stderr };
};
// what prove found, or nothing when it ended before it wrote any
const report = () => {
  const file = join(resultFolder(C_GAME, 'buttons'), 'report.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
};

function tidy() {
  const kept = readdirSync(MEDIA).filter(file => file.startsWith(GAME)).map(file => join(MEDIA, file));
  for (const path of [gameFolder(GAME), WORK, join(LOCAL, 'results', GAME), join(LOCAL, 'captures', GAME), join(LOCAL, 'c', 'twins', GAME),
    join(PROGRESS, `${GAME}.svg`), join(PROGRESS, `${GAME}-c.svg`), ...kept]) rmSync(path, { recursive: true, force: true });
}

// the Dreamport's copy of the program's C, with one line written another way
const source = readFileSync(join(HERE, 'cart.c'), 'utf8'), header = readFileSync(join(HERE, 'cart.h'), 'utf8');
function writeProgram({ from = null, to = null, inHeader = false } = {}) {
  const src = join(gameFolder(C_GAME), 'src');
  if (from !== null && !(inHeader ? header : source).includes(from)) throw new Error(`The program has no line "${from}" for the test to change.`);
  writeFileSync(join(src, 'cart.c'), from === null || inHeader ? source : source.replace(from, to));
  writeFileSync(join(src, 'cart.h'), from === null || !inHeader ? header : header.replace(from, to));
  writeFileSync(join(src, 'main.c'), readFileSync(join(HERE, 'main.c')));
}

async function main() {
  tidy();
  mkdirSync(WORK, { recursive: true });

  console.log('A program of the project\'s own, built as a cartridge with the console\'s compiler');
  if (!isCompilerBuilt(COMPILER.name)) withBuildTools(console.log, tools => buildCompilers([COMPILER.name], console.log, tools));
  const { rom, names } = link([await compile('cart.c', { here: HERE, work: WORK }), await compile('rom.c', { here: HERE, work: WORK })], { title: 'SAME MEMORY', code: 'SMEM' });
  const copy = join(WORK, 'cart.gba');
  writeFileSync(copy, rom);
  check(rom.length > DATA - CARTRIDGE && names.get('gWave') === DATA, `the cartridge is ${rom.length} bytes, each function where its comment says, and its data at 0x0${DATA.toString(16).toUpperCase()}`);
  check(/VRAM_BYTE\(0x20 /.test(source) && /VRAM_BYTE\(0x10020 /.test(source), 'it writes a byte to video memory, among the background\'s tiles and among the sprites\'');
  check(/CALL\(obj->update\)\(obj\)/.test(source), 'it calls a function through a pointer kept in work memory');
  check(/twice = \(s32\(\*\)\(s32\)\)\(\(u32\)gCode \+ 1\);\s*gTwice = CALL\(twice\)/.test(source), 'and a function it copied to the fast work memory, through a pointer to the copy (#1529)');
  check(/static void Flash[^]*?for \(i = 0; i < 16; i\+\+\) \{[^}]*WaitFrame\(\);/.test(source), 'it waits for the screen from inside a function, in a loop');

  const original = { console: 'gba', name: 'Test Same Memory (World)', title: 'SAME MEMORY', code: 'SMEM', sha1: createHash('sha1').update(rom).digest('hex'), keysAfterVBlank: true, workMemory: WORK_MEMORY };
  mkdirSync(join(proofFolder(GAME), 'recordings'), { recursive: true });
  writeFileSync(join(proofFolder(GAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
  // the cartridge's data by name, as a game's proof gives its names (tools/README.md, Matching the original's bytes)
  const addresses = Object.fromEntries([...names].map(([name, address]) => [name, address.toString(16).toUpperCase().padStart(8, '0')]));
  writeFileSync(join(proofFolder(GAME), 'addresses.json'), `${JSON.stringify({ about: 'Where the test\'s linker put the program\'s data.', addresses }, null, 2)}\n`);
  let run = dp('rom', copy);
  check(run.status === 0 && run.out.includes(GAME), `rom knows the cartridge by its header: ${run.out.trim().split('\n')[1]?.trim()}`);
  run = dp('codemap', GAME);
  check(run.status === 0, `codemap finds its functions: ${run.out.trim().split('\n').at(-1)}`);

  const files = { [join(gameFolder(GAME), 'entry.md')]: startingEntry(GAME, original, { issue: 1453, lead: 'nobody', added: '2026-11-17' }) };
  for (const [file, text] of Object.entries(startingFiles(GAME, original, { language: 'c' }))) files[join(gameFolder(C_GAME), file)] = text;
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, text);
  }
  writeProgram();
  // every button the program answers, and Start, whose flash holds everything for sixteen frames
  writeFileSync(join(proofFolder(GAME), 'recordings', 'buttons.json'), `${JSON.stringify({ about: 'Each button the program answers, then none.', frames: 600,
    held: [[0, []], [60, ['RIGHT']], [100, ['DOWN']], [140, ['LEFT', 'UP']], [180, ['A']], [200, []], [220, ['SELECT']], [260, ['B']], [300, []], [340, ['START']], [345, ['B', 'RIGHT']], [400, []], [450, ['A', 'SELECT', 'DOWN']], [520, []]] }, null, 2)}\n`);

  console.log('The same C as a Dreamport, with its memory at the console\'s addresses, next to the cartridge in mGBA');
  const compared = WORK_MEMORY.reduce((sum, { bytes }) => sum + bytes, 0);
  run = dp('prove', C_GAME, 'buttons');
  let found = report();
  check(run.status === 0 && found.matched === 600, `every frame's picture and sound is the same: ${found.matched} of ${found.frames}, ${JSON.stringify(found.firstDifference)}`);
  check(found.memory?.bytes === compared && found.memory.differs.length === 0, `and so are all ${compared.toLocaleString('en-US')} bytes of the work memory after every frame: ${JSON.stringify(found.memory?.firstDifference ?? null)}`);
  check(run.out.includes('bytes of work memory after each'), `prove says so: ${run.out.trim().split('\n').find(line => line.includes('work memory'))?.trim()}`);
  if (run.status) console.log(run.out);
  const module = new WebAssembly.Module(readFileSync(join(gameFolder(C_GAME), 'src', 'game.wasm')));
  check(WebAssembly.Module.imports(module).every(each => each.module === 'dreamports'), 'the pass that lets it wait leaves nothing for the page to give it');
  check(existsSync(join(proofFolder(C_GAME), 'played.json')), 'a version with no proof folder yet gets one');
  const { twinsFolder } = await import('../lib/c.mjs');
  const built = await twinsFolder(gameFolder(C_GAME));
  check(built.addressOf('gUnknown_03000040') === 0x03000040 && built.addressOf('gWave') === DATA && built.addressOf('nothing_named') === null, 'the build places a name that is a label at its own address, as match and the function check do, and one the game names at its address');

  console.log('A line of the Dreamport written wrong');
  const wrong = async (what, change, expects) => {
    writeProgram(change);
    run = dp('prove', C_GAME, 'buttons');
    found = report();
    if (found.frames !== 600) console.log(run.out);
    check(run.status !== 0 && found.frames === 600 && expects(found), `${what}: ${JSON.stringify({ frame: found.firstDifference?.frame, pixels: found.firstDifference?.pixels, memory: found.memory?.firstDifference && { frame: found.memory.firstDifference.frame, bytes: found.memory.firstDifference.bytes, first: found.memory.firstDifference.first?.address } })}`);
  };
  await wrong('a sprite that goes down two at a time is found as Down is first held, at frame 100, on the screen and in the work memory',
    { from: 'if (gKeys & KEY_DOWN) obj->y++;', to: 'if (gKeys & KEY_DOWN) obj->y += 2;' },
    r => r.firstDifference?.frame === 100 && r.firstDifference.pixels > 0 && r.memory.firstDifference?.frame === 100 && r.memory.firstDifference.first.address === '0x0300002E');
  await wrong('a count nothing shows, kept wrong, is found by the work memory alone, a frame after A is first held, at frame 181',
    { from: 'if ((keys & KEY_A) && !(gKeys & KEY_A)) gPresses++;', to: 'if (keys & KEY_A) gPresses++;' },
    r => r.firstDifference?.frame === 181 && r.firstDifference.pixels === 0 && !r.firstPictureDifference && r.memory.firstDifference?.frame === 181 && r.memory.firstDifference.first.address === '0x03000100' && r.memory.firstDifference.bytes === 1);
  await wrong('a flash that waits a frame short is found as it ends, at frame 355',
    { from: 'for (i = 0; i < 16; i++) {\n    COLOURS[0] = i * 0x0842;', to: 'for (i = 0; i < 15; i++) {\n    COLOURS[0] = i * 0x0842;' },
    r => r.firstDifference?.frame === 355);
  await wrong('a byte written to video memory as to any other memory is found on the screen, at the first frame',
    { from: '#define VRAM_BYTE(at, value) gba_vram_write8(at, value)', to: '#define VRAM_BYTE(at, value) (gba_vram[at] = (value))', inHeader: true },
    r => r.firstDifference?.frame === 0 && r.firstDifference.pixels > 0 && r.memory.differs.length === 0);
  await wrong('a call to a function of the cartridge with no C yet stops the Dreamport there and names it, at frame 340',
    { from: '    Flash();', to: '    { void sub_8000800(void); sub_8000800(); }' },
    r => r.firstDifference?.frame === 340 && /sub_8000800/.test(r.stopped?.error ?? '') && /no code in it yet/.test(r.stopped?.error ?? ''));

  console.log('A function kept and called as plain C');
  writeProgram({ from: '#define CODE(function) TWIN_ADDRESS(function)\n#define CALL(pointer) TWIN(pointer)', to: '#define CODE(function) function\n#define CALL(pointer) pointer', inHeader: true });
  run = dp('prove', C_GAME, 'buttons');
  found = report();
  check(run.status === 0 && found.matched === 600 && found.memory?.differs.length === 0, `is kept by its address in the cartridge and called as its twin, as with CODE and CALL, so every frame and its work memory are the same: ${found.matched} of ${found.frames}, ${JSON.stringify(found.memory?.firstDifference ?? null)}`);

  writeProgram();
  run = dp('prove', C_GAME, 'buttons', '--quick');
  check(run.status === 0 && run.out.includes('all 600 frames the same'), 'and the program as it is matches again');
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
