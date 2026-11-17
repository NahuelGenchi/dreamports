// npm run test:same-memory: the same-memory build (tools/README.md) with a program of the project's own
// (same-memory/cart.c), so it needs nobody's copy of any game. The program is built twice from the same C: as a
// cartridge, with the Game Boy Advance's own compiler, the tools' assembler and the few lines of a linker here, and as
// a Dreamport, on the kit, with its memory at the console's addresses, the table from an address to its twin, and the
// pass that lets its C wait from inside a function. Then prove plays both, the cartridge in mGBA and the Dreamport in
// a browser, and has to find every frame the same, picture and sound, and every byte of the work memory the same after
// every frame. And it has to find a line written wrong: one that shows on the screen, one that only the work memory
// shows, a wait a frame short, and a byte written to video memory as if it were any other memory.
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
import { buildCompilers, compilerPath, isCompilerBuilt } from '../gba/agbcc.mjs';
import { assemble } from '../gba/thumb.mjs';
import { preprocess, twinsIn } from '../gba/match.mjs';

const HERE = fileURLToPath(new URL('./same-memory/', import.meta.url));
const GAME = 'test-same-memory', C_GAME = `${GAME}/c`;
const WORK = join(LOCAL, 'test-same-memory');
const COPIES = join(LOCAL, 'copies.json');
const STATUS = join(REPO, 'docs', 'STATUS.md');
const MEDIA = join(REPO, 'public', 'media');
const PROGRESS = join(REPO, '.github', 'readme', 'progress');
// the flags Game Boy Advance games of the time were built with
const COMPILER = { name: 'agbcc', flags: ['-mthumb-interwork', '-O2', '-fprologue-bugfix'] };
// the cartridge: where it starts, where its first instructions are, after its header, where the compiler's helpers that
// call a function through a register go, and where its data does
const CARTRIDGE = 0x08000000, START = 0xC0, HELPERS = 0x080006C0, DATA = 0x08000700;
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

// One file of the program as the console's compiler builds it: what the tools' assembler makes of what it wrote.
async function compile(name) {
  const file = join(HERE, name), built = join(WORK, name.replace(/\.c$/, ''));
  writeFileSync(`${built}.i`, await preprocess(file, HERE, [HERE]));
  const cc = spawnSync(compilerPath(COMPILER.name), [...COMPILER.flags, '-fhex-asm', '-o', `${built}.s`, `${built}.i`], { encoding: 'utf8' });
  if (cc.status !== 0) throw new Error(`${name} didn't build with ${COMPILER.name}: ${cc.error?.message ?? cc.stderr}`);
  const twins = new Map(twinsIn(readFileSync(file, 'utf8')).map(twin => [twin.name, twin.address]));
  return { name, twins, ...assemble(readFileSync(`${built}.s`, 'utf8')) };
}

// The cartridge, from the files the compiler built: each function where its comment says the cartridge has it, the
// data after them, and every call and address a linker fills in. It answers { rom, names }: the cartridge's bytes, and
// where each piece of data is.
function link(units) {
  const image = Buffer.alloc(0x1000), taken = [];
  const place = (what, address, bytes) => {
    const from = address - CARTRIDGE, to = from + bytes.length;
    const other = taken.find(each => from < each.to && each.from < to);
    if (other) throw new Error(`${what} at 0x${address.toString(16)} reaches into ${other.what}.`);
    taken.push({ what, from, to });
    bytes.copy(image, from);
  };
  // where everything is: each function, each file's data, and the compiler's helpers
  const functions = new Map(), data = new Map();
  let end = DATA;
  for (const unit of units) {
    const text = unit.sections['.text'].bytes;
    unit.functions = [...unit.symbols].filter(([, symbol]) => symbol.section === '.text' && symbol.function).map(([name, symbol]) => ({ name, at: symbol.at })).sort((a, b) => a.at - b.at);
    unit.functions.forEach((f, i) => {
      f.until = unit.functions[i + 1]?.at ?? text.length;
      f.address = unit.twins.get(f.name) ?? null;
      if (f.address === null) throw new Error(`${f.name} in ${unit.name} has no address in the comment above it.`);
      if (functions.has(f.name)) throw new Error(`${f.name} is there twice.`);
      functions.set(f.name, f.address);
    });
    unit.data = end;
    const own = unit.sections['.rodata']?.bytes ?? Buffer.alloc(0);
    for (const [name, symbol] of unit.symbols) if (symbol.section === '.rodata') data.set(name, unit.data + symbol.at);
    end = Math.ceil((end + own.length) / 4) * 4;
  }
  for (let r = 0; r < 8; r++) {
    functions.set(`_call_via_r${r}`, HELPERS + r * 4);
    const helper = Buffer.alloc(4);
    helper.writeUInt16LE(0x4700 | r << 3, 0);   // bx r
    helper.writeUInt16LE(0x46C0, 2);            // nop
    place(`_call_via_r${r}`, HELPERS + r * 4, helper);
  }
  for (const unit of units) {
    const text = Buffer.from(unit.sections['.text'].bytes), own = Buffer.from(unit.sections['.rodata']?.bytes ?? []);
    const around = at => unit.functions.find(f => at >= f.at && at < f.until);
    const moved = at => { const f = around(at); return f.address + at - f.at; };
    for (const { section, at, kind, name, addend } of unit.relocations) {
      const symbol = unit.symbols.get(name), where = section === '.text' ? moved(at) : unit.data + at;
      let target;
      // a Thumb function's address is kept odd
      if (symbol?.section === '.text') target = moved(symbol.at) + addend + (symbol.function ? 1 : 0);
      else if (symbol?.section === '.rodata') target = unit.data + symbol.at + addend;
      else if (functions.has(name)) target = functions.get(name) + addend + 1;
      else if (data.has(name)) target = data.get(name) + addend;
      else throw new Error(`Nothing defines ${name}, which ${unit.name} uses.`);
      const into = section === '.text' ? text : own;
      if (kind === 'word') into.writeUInt32LE(target >>> 0, at);
      else {
        const jump = (target & ~1) - (where + 4);
        into.writeUInt16LE(0xF000 | ((jump >> 12) & 0x7FF), at);
        into.writeUInt16LE(0xF800 | ((jump >> 1) & 0x7FF), at + 2);
      }
    }
    for (const f of unit.functions) place(f.name, f.address, text.subarray(f.at, f.until));
    if (own.length) place(`${unit.name}'s data`, unit.data, own);
  }
  // the cartridge's first instructions, in ARM code: system mode, a stack at the top of the fast work memory, and on to
  // the program, which is Thumb code
  const start = Buffer.alloc(28);
  [0xE3A0001F, 0xE129F000, 0xE59FD004, 0xE59F0004, 0xE12FFF10, 0x03007F00, functions.get('AgbMain') | 1].forEach((word, i) => start.writeUInt32LE(word >>> 0, i * 4));
  place('the start', CARTRIDGE + START, start);
  // the header, as made-up-game.mjs writes it: a jump over it, the title, the code and its check
  const rom = image.subarray(0, Math.max(...taken.map(each => each.to)));
  rom.writeUInt32LE((0xEA000000 | ((START - 8) >> 2)) >>> 0, 0);
  rom.write('SAME MEMORY', 0xA0, 'latin1');
  rom.write('SMEM', 0xAC, 'latin1');
  rom.write('00', 0xB0, 'latin1');
  rom[0xB2] = 0x96;
  let sum = 0;
  for (let i = 0xA0; i <= 0xBC; i++) sum = (sum - rom[i]) & 0xFF;
  rom[0xBD] = (sum - 0x19) & 0xFF;
  return { rom, names: data };
}

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
  const { rom, names } = link([await compile('cart.c'), await compile('rom.c')]);
  const copy = join(WORK, 'cart.gba');
  writeFileSync(copy, rom);
  check(rom.length > DATA - CARTRIDGE && names.get('gWave') === DATA, `the cartridge is ${rom.length} bytes, each function where its comment says, and its data at 0x0${DATA.toString(16).toUpperCase()}`);
  check(/VRAM_BYTE\(0x20 /.test(source) && /VRAM_BYTE\(0x10020 /.test(source), 'it writes a byte to video memory, among the background\'s tiles and among the sprites\'');
  check(/CALL\(obj->update\)\(obj\)/.test(source), 'it calls a function through a pointer kept in work memory');
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
  await wrong('a function kept in memory as the Dreamport\'s own, not by its address in the cartridge, is found in the work memory at the first frame',
    { from: '#define CODE(function) TWIN_ADDRESS(function)\n#define CALL(pointer) TWIN(pointer)', to: '#define CODE(function) function\n#define CALL(pointer) pointer', inHeader: true },
    r => r.memory.firstDifference?.frame === 0 && r.firstDifference?.frame === 0 && r.firstDifference.pixels === 0);

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
