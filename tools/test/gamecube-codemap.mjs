// npm run test:gamecube-codemap: a GameCube game's code map, from the tools as they're typed, on a disc of the
// project's own (made-up-gamecube.mjs) with a module beside its program (made-up-gamecube-rel.mjs), in a game of its own
// that the test removes after, so no game's copy is needed. `rom` knows the disc, `codemap` maps the program it boots
// and the module, `portmap` reads the names a version's code gives the functions, and `read` prints a function of each
// as the console's processor's instructions. It needs no emulator.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder } from '../lib/paths.mjs';
import { startingEntry, startingFiles } from '../lib/new-game.mjs';
import { DISC_FILES, madeUpGameCube, madeUpGameCubeDisc } from './made-up-gamecube.mjs';
import { madeUpRel } from './made-up-gamecube-rel.mjs';

const GAME = 'test-gamecube-codemap', VERSION = `${GAME}/c`, MODULE = 'stage/first.rel';
const WORK = join(LOCAL, 'test-gamecube-codemap'), COPIES = join(LOCAL, 'copies.json');

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
const hex = value => (value >>> 0).toString(16).toUpperCase().padStart(8, '0');
const tidy = () => { for (const path of [gameFolder(GAME), join(LOCAL, 'read', GAME), join(REPO, '.github', 'readme', 'progress', `${GAME}.svg`), join(REPO, '.github', 'readme', 'progress', `${GAME}-c.svg`), WORK]) rmSync(path, { recursive: true, force: true }); };

const before = tracked(), copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
tidy();
mkdirSync(WORK, { recursive: true });
try {
  const program = madeUpGameCube(), rel = madeUpRel();
  const disc = madeUpGameCubeDisc({ program, files: [...DISC_FILES, { name: MODULE, bytes: rel.bytes }] }).image, copy = join(WORK, `${GAME}.iso`);
  writeFileSync(copy, disc);
  const original = { console: 'gamecube', name: 'Test GameCube Code Map (World)', title: 'Made-up program', code: 'GMUE00', sha1: createHash('sha1').update(disc).digest('hex') };
  mkdirSync(proofFolder(GAME), { recursive: true });
  writeFileSync(join(proofFolder(GAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);

  console.log('A made-up GameCube disc, with a module beside its program:');
  let run = dp('rom', copy);
  check(run.status === 0 && run.out.includes(GAME), `rom knows the disc: ${run.out.trim().split('\n').at(-1)}`);
  run = dp('codemap', GAME);
  const map = existsSync(join(proofFolder(GAME), 'code-map.json')) ? JSON.parse(readFileSync(join(proofFolder(GAME), 'code-map.json'), 'utf8')) : { functions: [] };
  const wanted = [
    ...Object.values(program.functions).map(f => [hex(f.address), f.size]),
    ...Object.values(rel.functions).sort((a, b) => a.address - b.address).map(f => [`${hex(f.address)}@${MODULE}`, f.size]),
  ];
  check(run.status === 0 && JSON.stringify(map.functions) === JSON.stringify(wanted), `codemap maps the program's ${Object.keys(program.functions).length} functions and the module's ${Object.keys(rel.functions).length}, each with its size: ${run.out.trim().split('\n').at(-1)}`);
  check(/in 1 other programs and modules on the disc\.$/m.test(run.out) && !/vector unit/.test(run.out), 'and says how much of it is in the module');

  const files = { ...startingFiles(GAME, original), 'entry.md': startingEntry(GAME, original, { issue: 1, lead: 'nobody', added: '2026-01-01' }) };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(gameFolder(GAME), file, '..'), { recursive: true });
    writeFileSync(join(gameFolder(GAME), file), text);
  }
  for (const [file, text] of Object.entries(startingFiles(GAME, original, { language: 'c' }))) {
    mkdirSync(join(gameFolder(VERSION), file, '..'), { recursive: true });
    writeFileSync(join(gameFolder(VERSION), file), text);
  }
  const source = join(gameFolder(VERSION), 'src', 'main.c');
  writeFileSync(source, `${readFileSync(source, 'utf8')}\n// fn_${hex(program.functions.fill.address)}: writes words in a loop\n// 0x${hex(program.functions.wait.address)} waits for a line of the field\n`);
  run = dp('portmap', VERSION);
  const ported = existsSync(join(proofFolder(VERSION), 'port-map.json')) ? readFileSync(join(proofFolder(VERSION), 'port-map.json'), 'utf8') : '';
  check(run.status === 0 && ported.includes(hex(program.functions.fill.address)) && ported.includes(hex(program.functions.wait.address)) && !ported.includes(hex(program.functions.square.address)), `portmap reads the two functions the code names, as a label and as a number: ${run.out.trim().split('\n').at(-1)}`);

  console.log('read, on the console\'s processor:');
  run = dp('read', GAME, `0x${hex(program.functions.setup.address)}`);
  check(run.status === 0 && run.out.includes(`the whole function, ${program.functions.setup.size} bytes`) && /mflr r0/.test(run.out) && /stwu r1, -0x10\(r1\)/.test(run.out) && /blr/.test(run.out), 'a function of the program, whole, as its instructions');
  check(new RegExp(`bl 0x${hex(program.functions.fill.address)}  ; fn_${hex(program.functions.fill.address)}`).test(run.out), 'with the code map\'s name of where a call goes');
  check(/ori r6, r6, 0x2000  ; 0xCC002000/.test(run.out), 'and the address a lis and an ori make, the video interface\'s');
  run = dp('read', GAME, `fn_${hex(program.functions.fill.address + 4)}`);
  check(run.status === 0 && new RegExp(`0x${hex(program.functions.fill.address + 4)} is inside it`).test(run.out), 'a label inside a function reads the function it\'s in');
  run = dp('read', GAME, `0x${hex(rel.functions.prolog.address)}@${MODULE}`);
  check(run.status === 0 && /of stage\/first\.rel/.test(run.out) && /a call the console writes the target of/.test(run.out) && /mflr r0/.test(run.out), 'a function of the module, by where it is in the module\'s file');
  run = dp('read', GAME, '0x80004000');
  check(run.status !== 0 && /isn't in the code/.test(run.out), `an address in the program's values isn't code, and read says so: ${run.out.trim().split('\n').at(-1)}`);
  run = dp('read', GAME, '0x10@stage/none.rel');
  check(run.status !== 0 && /has no module called stage\/none\.rel/.test(run.out), 'nor is a module the disc doesn\'t have');
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
console.log('\nA GameCube game\'s code map is made, named and read from its disc.');
