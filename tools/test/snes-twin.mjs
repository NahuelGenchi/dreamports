// npm run test:snes-twin: tries the Super Nintendo's function check (../snes/twin.mjs) with the made-up cartridge of
// the tools' tests (made-up-snes.mjs) and its twins in C, each with its contract (snes-twin/game.c), so it needs
// nobody's copy of any game. The original's side is Snes9x's own 65816, built from its makers' source
// (../snes/call.cpp); the twins are built to WebAssembly on the console's kit in C, with every address folded by its
// 4 KB (../lib/wasm-fold.mjs). Every twin has to leave the same memory, registers and hardware reads and writes as its
// original over every path, but those whose original the check can't follow, which say why. Then one line of the twins
// is changed at a time, and the check has to find each: a difference instead of a sum, a byte too many, a value one
// along, the wrong register of the picture, the work memory's port written twice in the wrong place, a data bank left
// out, a contract that doesn't say the mode its function leaves, a case of a switch, a twin that never comes back, and
// one that calls what nothing built is. Last, the same twins through the tool everyone runs, npm run dp -- twin, and
// match, which says why it has nothing to build them with.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, REPO, gameFolder, proofFolder } from '../lib/paths.mjs';
import { formatCodeMap, parseCodeMap } from '../lib/proof-files.mjs';
import { startingFiles } from '../lib/new-game.mjs';
import { twinsIn } from '../gba/match.mjs';
import { checkVersion } from '../snes/twin.mjs';
import { madeUpCartridge } from './made-up-snes.mjs';

const GAME = fileURLToPath(new URL('./snes-twin/game.c', import.meta.url));
const NAME = 'test-snes-twin', VERSION = `${NAME}/c`, COPIES = join(LOCAL, 'copies.json');
const work = join(LOCAL, 'tmp', 'snes-twin-test');
const CALLS = 500;

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
const tracked = () => spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: REPO, encoding: 'utf8' }).stdout;
const before = tracked();
const dp = (...args) => {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 24 });
  return { status, out: stdout + stderr };
};
const tidy = () => rmSync(gameFolder(NAME), { recursive: true, force: true });
const copies = existsSync(COPIES) ? readFileSync(COPIES) : null;

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
tidy();
const { rom, labels, functions } = madeUpCartridge();
const game = readFileSync(GAME, 'utf8');
const copy = join(work, 'made-up.sfc');
writeFileSync(copy, rom);
// the code map: every function of the cartridge, by its place in the ROM, as codemap writes one
const sha1 = createHash('sha1').update(rom).digest('hex');
const mapText = formatCodeMap({ original: sha1, from: 'The made-up cartridge\'s functions (tools/test/made-up-snes.mjs)', functions: functions.map(f => ({ address: f.address & 0x7FFF, size: f.size })) });
const codeMap = parseCodeMap(JSON.parse(mapText));
const original = { console: 'snes', name: 'Test Super Nintendo Twin (World)', title: 'DREAMPORTS MADE UP', code: '', sha1 };

console.log('The contracts name the cartridge\'s functions:');
{
  const twins = twinsIn(game, [], null, 'snes');
  const wrong = twins.filter(twin => labels[twin.name] !== twin.address);
  check(twins.length === 17 && !wrong.length, `each of the 17 names the address of its function in the made-up cartridge${wrong.length ? `, but ${wrong.map(t => t.name).join(', ')}` : ''}`);
}

// the version, as a game of its own in games/ for as long as this takes, with its twins `changes` made, each [what's
// there, what goes there instead], checked: every result by its twin's name
mkdirSync(proofFolder(NAME), { recursive: true });
writeFileSync(join(proofFolder(NAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
writeFileSync(join(proofFolder(NAME), 'code-map.json'), mapText);
mkdirSync(join(gameFolder(VERSION), 'src'), { recursive: true });
writeFileSync(join(gameFolder(VERSION), 'index.html'), startingFiles(NAME, original, { language: 'c' })['index.html']);
async function tried(changes = [], options = {}) {
  let text = game;
  for (const [from, to] of changes) {
    if (!text.includes(from)) throw new Error(`snes-twin/game.c has no "${from}" for the test to change.`);
    text = text.replace(from, to);
  }
  writeFileSync(join(gameFolder(VERSION), 'src', 'game.c'), text);
  const { functions: found } = await checkVersion({ game: VERSION, codeMap, copyPath: copy, options: { calls: CALLS, seconds: 1, ...options }, log: () => {} });
  const built = found.find(f => f.kind === 'unbuilt');
  if (built) throw new Error(built.line);
  return Object.fromEntries(found.map(f => [f.name, f]));
}

try {
  console.log('The twins as they are:');
  const right = await tried();
  const same = ['sum', 'fill', 'lookup', 'twice', 'leaves8', 'hardware', 'port', 'bank', 'direct', 'move', 'save', 'tick', 'pick', 'shine', 'hidden'];
  check(same.every(name => right[name]?.kind === 'same' && right[name].compared === CALLS), `${same.join(', ')}: the same on all ${CALLS} calls (${same.filter(name => right[name]?.kind !== 'same').map(name => `${name} ${right[name]?.line}`).join('; ')})`);
  check(same.every(name => right[name]?.whole), `each over every instruction and both ways of each branch (${same.filter(name => !right[name]?.whole).map(name => `${name}: ${right[name]?.left?.map(([at, how]) => `${at.toString(16)} ${how}`).join(', ')}`).join('; ')})`);
  check(right.wait?.kind === 'unchecked' && /waited for an interrupt/.test(right.wait.line), `a function whose original waits for an interrupt isn't checked, and says so: ${right.wait?.line}`);
  check(right.jumpout?.kind === 'unchecked' && /where no code can be/.test(right.jumpout.line), `nor one whose original runs where no code can be: ${right.jumpout?.line}`);

  console.log('A line changed, a twin at a time:');
  // the twins that call each, which a change to it changes too
  const callers = { sum: ['twice'] };
  const wrong = async (name, changes, kind, what, pattern = null) => {
    const run = await tried(changes);
    const f = run[name], others = Object.values(run).filter(other => other.name !== name && same.includes(other.name) && !callers[name]?.includes(other.name));
    check(f?.kind === kind && (!pattern || pattern.test(f.line)) && others.every(other => other.kind === 'same'), `${what}: ${f?.kind} ${f?.line}${others.some(other => other.kind !== 'same') ? `, and ${others.filter(other => other.kind !== 'same').map(other => other.name).join(', ')} with it` : ''}`);
  };
  await wrong('sum', [['*a = (uint16_t)(*a + WORD(d));', '*a = (uint16_t)(*a - WORD(d));']], 'differs', 'a difference instead of a sum', /the twin left A \$[0-9A-F]{4} and the original/);
  await wrong('fill', [['while (*y != 0) {', 'while (*y != 0xFFFF) {']], 'differs', 'a byte too many', /at \$7[EF]:[0-9A-F]{4} the twin left \$|the twin left [XY]/);
  await wrong('lookup', [['return WORD(VALUES + *x);', 'return WORD(VALUES + 2 + *x);']], 'differs', 'the value one along', /the twin gave back \$[0-9A-F]{4}, where the contract makes/);
  await wrong('hardware', [['snes_write(0x2100, 0x0F);', 'snes_write(0x2101, 0x0F);']], 'differs', 'the wrong register of the picture', /at the hardware's read or write number 1 the twin wrote \$0F to \$2101 and the original wrote \$0F to \$2100/);
  await wrong('port', [['snes_write(0x2182, 0x01);', 'snes_write(0x2182, 0x02);']], 'differs', 'the work memory\'s port pointed elsewhere', /the twin wrote \$02 to \$2182/);
  await wrong('bank', [['BYTE((uint32_t)db << 16 | 0x1234)', 'BYTE(0x7E1234)']], 'differs', 'a data bank left out', /the twin left A/);
  await wrong('leaves8', [['a16i16>a8i16 leaves8()', 'a16i16 leaves8()']], 'differs', 'a contract that doesn\'t say the mode its function leaves', /came back with a8i16, where its contract says a16i16/);
  await wrong('pick', [['default: return 30;', 'default: return 40;']], 'differs', 'a case of a switch', /the twin gave back \$0028/);
  await wrong('shine', [['  return 1;\n}', '  for (;;) {}\n  return 1;\n}']], 'never', 'a twin that never comes back is stopped after its second', /was still going after 1 second/);
  await wrong('hidden', [['BYTE((uint32_t)db << 16 | 0x0400) = 0x12;', 'extern void nowhere(void);\n  nowhere();']], 'unchecked', 'a twin that calls what nothing built is the twin of', /nowhere, which nothing built is the twin of/);

  console.log('Through npm run dp -- twin:');
  writeFileSync(join(gameFolder(VERSION), 'src', 'game.c'), game);
  let run = dp('rom', copy);
  check(run.status === 0 && run.out.includes(NAME), 'rom knows the cartridge\'s copy');
  run = dp('twin', VERSION, '--calls', '200');
  check(run.status === 0 && /15 of 17 functions left the same memory and registers/.test(run.out) && /15 of those 15 took every path/.test(run.out), `every twin of the version is checked, and it ends with 0: ${run.out.trim().split('\n').slice(-2).join(' ')}`);
  run = dp('twin', '--seed', '9', VERSION, 'sub_008073', '--calls', '200');
  check(run.status === 0 && /1 of 1 function left the same memory/.test(run.out), `one function, by its label, with an option before the version: ${run.out.trim().split('\n').at(-1)}`);
  run = dp('twin', NAME, 'pick', '--calls', '200');
  check(run.status === 0 && /1 of 1 function/.test(run.out), 'the game\'s name alone means its version in C, and a twin is named by its own name');
  writeFileSync(join(gameFolder(VERSION), 'src', 'game.c'), game.replace('*a = (uint16_t)(*a + WORD(d));', '*a = (uint16_t)(*a - WORD(d));'));
  run = dp('twin', VERSION, 'sum', '--calls', '200');
  check(run.status === 3 && /Differs  sub_008060 sum: call \d+, sub_008060 with A=/.test(run.out), `a twin that differs ends it with 3: ${run.out.trim().split('\n').find(line => /Differs/.test(line))}`);
  run = dp('twin', VERSION, '--memories');
  check(run.status === 1 && /--memories isn't there yet on the Super Nintendo/.test(run.out), 'what the Super Nintendo\'s check can\'t do yet is said');
  run = dp('match', VERSION);
  check(run.status === 1 && /a Super Nintendo game was written by hand in its processor's own language/.test(run.out) && /npm run dp -- twin/.test(run.out), 'match says a Super Nintendo game has no compiler to give its bytes back, and what proves its functions');
} finally {
  tidy();
  if (copies) writeFileSync(COPIES, copies);
  else rmSync(COPIES, { force: true });
}
check(!existsSync(gameFolder(NAME)), 'nothing is left behind');

rmSync(work, { recursive: true, force: true });
check(tracked() === before, 'nothing the repository tracks has changed');
if (failures.length) {
  console.log(`\n${failures.length} failed.`);
  process.exit(1);
}
console.log('\nThe Super Nintendo\'s function check does what it says.');
