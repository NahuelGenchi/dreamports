// npm run test:real-snes: the proof tools on the Super Nintendo's real emulator, Snes9x, built as it's built on a
// contributor's computer, at the commit tools/consoles.mjs fixes, with the tools' change to it
// (../libretro/snes9x.patch), which tells them of every instruction it runs, with the processor's mode. It plays the
// made-up cartridge of the function check's test (made-up-snes.mjs), so no game's copy is needed, in a game folder of
// its own that it removes after: `rom` knows the copy, `codemap` follows its code from its vectors, and then from
// where play sent the processor, which finds the function only a pointer made as it runs leads to, in the mode it ran
// in, and `read` prints it. And the emulator plays the same, picture and sound, whether it tells of its instructions
// or not. A second made-up cartridge gives the sound processor a program, as games do, and `read --spc` prints it
// from the sound processor's memory, as Snes9x says it holds it.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { LOCAL, REPO, gameFolder, proofFolder, resultFolder } from '../lib/paths.mjs';
import { readCodeMap } from '../lib/proof-files.mjs';
import { consoleOf } from '../consoles.mjs';
import { libretroReference } from '../libretro/reference.mjs';
import { modeFromBits } from '../snes/65816.mjs';
import { madeUpCartridge, madeUpSoundCartridge, SOUND_AT, SOUND_PROGRAM } from './made-up-snes.mjs';

const GAME = 'test-real-snes';
const WORK = join(LOCAL, 'test-real-snes');
const COPIES = join(LOCAL, 'copies.json');

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
const dp = (...args) => {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 26 });
  return { status, out: stdout + stderr };
};
const lastLine = ({ out }) => out.trim().split('\n').at(-1);
const untouched = () => spawnSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' }).stdout;
const tidy = () => {
  for (const path of [gameFolder(GAME), WORK, join(LOCAL, 'results', GAME), join(LOCAL, 'read', GAME)]) rmSync(path, { recursive: true, force: true });
};

const dirtyBefore = untouched();
const keptCopies = existsSync(COPIES) ? readFileSync(COPIES) : null;
tidy();
mkdirSync(WORK, { recursive: true });
const { rom, labels } = madeUpCartridge();
const at = name => labels[name] & 0x7FFF;
const copy = join(WORK, 'made-up.sfc');
writeFileSync(copy, rom);
const sha1 = createHash('sha1').update(rom).digest('hex');

try {
  console.log('The made-up cartridge in Snes9x');
  const reference = libretroReference(consoleOf('snes'));
  reference.ensureOriginal(console.log);
  const frames = 30, buttons = new Array(frames).fill(0);
  const untold = await reference.runOriginal({ copy, frames, buttons, sound: true });
  const told = await reference.runOriginal({ copy, frames, buttons, sound: true, functions: [], played: true, entries: true });
  const same = buttons.filter((_, frame) => untold.hashes[frame] === told.hashes[frame] && Buffer.from(untold.sound.read(frame)).equals(Buffer.from(told.sound.read(frame)))).length;
  untold.sound.close();
  told.sound.close();
  check(same === frames, `the emulator plays the same while it tells of every instruction: ${same} of ${frames} frames, picture and sound`);
  const sent = new Map(told.entries.map(({ address, way, mode }) => [`${address} ${way}`, modeFromBits(mode)]));
  check(sent.get(`${at('main')} called`) === 'a16i16' && sent.get(`${at('hidden')} called`) === 'a8i8' && sent.get(`${at('pick_2')} jumped`) === 'a16i16' && sent.get(`${at('main') + 69} returned`) === 'a8i8',
    'it says where play sent the processor, in which mode: main called with A, X and Y of 16 bits, hidden called with 8, a switch\'s case jumped to, and main returned to after hidden');
  check(told.entries.every(e => e.frame === 0) && !sent.has(`${at('nmi')} called`), 'all in the first frame, and the interrupt at each frame\'s end is no call');

  console.log('Its code map');
  const original = { console: 'snes', name: 'Test Real SNES (World)', title: 'DREAMPORTS MADE UP', code: '', sha1 };
  mkdirSync(join(proofFolder(GAME), 'recordings'), { recursive: true });
  writeFileSync(join(proofFolder(GAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
  let run = dp('rom', copy);
  check(run.status === 0 && run.out.includes(GAME), `rom knows the copy by its header: ${run.out.trim().split('\n')[1]?.trim()}`);
  run = dp('codemap', GAME);
  const mapped = () => new Map((readCodeMap(GAME)?.functions ?? []).map(f => [f.address, f]));
  check(run.status === 0 && mapped().get(at('start'))?.mode === 'e' && mapped().get(at('fill'))?.mode === 'a8i16' && !mapped().has(at('hidden')),
    `codemap follows the code from the console's vectors, with each function's mode, and not where a pointer made as it runs leads: ${lastLine(run)}`);
  writeFileSync(join(proofFolder(GAME), 'recordings', 'still.json'), `${JSON.stringify({ about: 'Nothing pressed.', frames, held: [[0, []]] }, null, 2)}\n`);
  run = dp('codemap', GAME, '--fill');
  const hidden = mapped().get(at('hidden'));
  check(run.status === 0 && hidden?.mode === 'a8i8' && hidden.size === 6 && /Found by playing: 1 function/.test(run.out),
    `with a recording, it follows the code from where play went, and finds hidden, with A, X and Y of 8 bits: ${run.out.split('\n').find(line => line.startsWith('Found by playing'))}`);
  check(readFileSync(join(proofFolder(GAME), 'code-map.json'), 'utf8').includes(`"${at('hidden').toString(16).toUpperCase().padStart(8, '0')}": "a8i8"`), 'the code map keeps the mode hidden starts in');

  console.log('What read prints');
  run = dp('read', GAME, 'sub_00810E');
  check(run.status === 0 && run.out.includes('$00:810E  A9 12       LDA #$12') && run.out.includes('as the code map says'), 'read prints hidden\'s instructions at the lengths its mode, from play, gives them');
  const sound = madeUpSoundCartridge(), soundCopy = join(WORK, 'sound.sfc');
  writeFileSync(soundCopy, sound.rom);
  writeFileSync(join(proofFolder(GAME), 'original.json'), `${JSON.stringify({ ...original, title: 'DREAMPORTS SOUND', sha1: createHash('sha1').update(sound.rom).digest('hex') }, null, 2)}\n`);
  dp('rom', soundCopy);
  run = dp('codemap', GAME);
  run = dp('read', GAME, SOUND_AT.toString(16).padStart(4, '0'), '--spc', '--frame', '30', '--bytes', String(SOUND_PROGRAM.length));
  const spc = ['MOV A,#$12', 'MOV $F4,A', 'MOV X,#$34', 'CALL $040B', 'BRA $0409', 'INC A', 'RET'];
  check(run.status === 0 && spc.every(line => run.out.includes(line)) && run.out.includes('$0400  E8 12     MOV A,#$12'),
    `read --spc prints the program the second cartridge gave the sound processor, through the console's start-up protocol, where it runs: ${lastLine(run).slice(0, 80)}`);
} finally {
  tidy();
  if (keptCopies) writeFileSync(COPIES, keptCopies);
  else rmSync(COPIES, { force: true });
  rmSync(resultFolder(GAME, 'still'), { recursive: true, force: true });
}
check(untouched() === dirtyBefore, 'nothing is left behind');

if (failures.length) {
  console.log(`\n${failures.length} failed.`);
  process.exit(1);
}
console.log('\nAll passed.');
process.exit(0);
