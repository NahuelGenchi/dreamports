// npm run test:gamecube-parts: a GameCube game whose tasks are its parts, each made a function at a time, through the
// steps every console's test of it goes through (parts-flow.mjs), with a program of the project's own on a disc of its
// own (made-up-gamecube.mjs, madeUpGameCubeParts) and its Dreamport in C on the console's kit (gamecube-parts/main.c),
// so it needs nobody's copy of any game. The original plays in Dolphin, built with the tools' change to it
// (../libretro/dolphin.patch), which says where its processor is before each instruction, and so which functions ran
// in each frame; each twin is proven by the function check, against Dolphin's own interpreter; and every frame of the
// Dreamport is compared with the original's, picture and sound.
//
// First it plays the program with the emulator telling of every instruction and without: every frame's picture and
// sound has to be the same, as the change only looks. Then the steps. The program counts the field and fills the
// picture's first rows red, by one function, while the count is under 60, and blue by another from then on. So the
// test knows what each of its two parts runs: the first the start, the step, the count and the red, and the second,
// which starts while the rows are still red, the step, the count, the red and the blue, of which only the blue is its
// own.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, gameFolder } from '../lib/paths.mjs';
import { hex } from '../lib/proof-files.mjs';
import { consoleOf } from '../consoles.mjs';
import { libretroReference } from '../libretro/reference.mjs';
import { BACKGROUND, FRAMEBUFFER, HEIGHT, PARTS, UNCACHED, VIDEO, WIDTH, madeUpGameCubeDisc, madeUpGameCubeParts } from './made-up-gamecube.mjs';
import { partsFlow } from './parts-flow.mjs';

const NAME = 'test-gamecube-parts', VERSION = `${NAME}/c`;
const GAME = readFileSync(fileURLToPath(new URL('./gamecube-parts/main.c', import.meta.url)), 'utf8');
const work = join(LOCAL, 'tmp', 'gamecube-parts-test');
const NAMES = ['start', 'step', 'count', 'red', 'blue'];

const program = madeUpGameCubeParts(), disc = madeUpGameCubeDisc({ code: 'GDRE00', title: 'Dreamports parts', program }).image;
const { functions } = program;
const key = name => hex(functions[name].address);
const keys = (...names) => names.map(key).sort();
const number = value => `0x${(value >>> 0).toString(16).toUpperCase()}`;

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const copy = join(work, 'made-up-parts.iso');
writeFileSync(copy, disc);

let failed = 0;
{
  console.log('The made-up program in Dolphin:');
  const reference = libretroReference(consoleOf('gamecube'));
  reference.ensureOriginal(console.log);
  const frames = 90, buttons = new Array(frames).fill(0);
  const watched = NAMES.map((name, index) => ({ address: functions[name].address, size: 4, index }));
  const untold = await reference.runOriginal({ copy, frames, buttons, sound: true });
  const told = await reference.runOriginal({ copy, frames, buttons, sound: true, functions: watched });
  const same = buttons.filter((_, frame) => untold.hashes[frame] === told.hashes[frame] && Buffer.from(untold.sound.read(frame)).equals(Buffer.from(told.sound.read(frame)))).length;
  untold.sound.close();
  told.sound.close();
  const check = (ok, what) => {
    console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
    if (!ok) failed++;
  };
  check(same === frames, `the emulator plays the same while it tells of every instruction: ${same} of ${frames} frames, picture and sound`);
  const ranIn = name => told.ran.map((list, frame) => (Array.from(list).includes(NAMES.indexOf(name)) ? frame : -1)).filter(frame => frame >= 0);
  const [start, step, count, red, blue] = NAMES.map(ranIn);
  check(start.length === 1 && start[0] === 0, `it says the start ran in the first frame alone: ${JSON.stringify(start)}`);
  check(step.length === frames && JSON.stringify(step) === JSON.stringify(count), `the step and the count in every frame: ${step.length} of ${frames}`);
  check(red.length === PARTS.TURN - 1 && blue.length === step.length - red.length && blue[0] === red.at(-1) + 1 && red.every(frame => !blue.includes(frame)),
    `and the red in the first ${PARTS.TURN - 1} of those and the blue in the rest: red to frame ${red.at(-1)}, blue from frame ${blue[0]}`);
  check(untold.ran.every(list => list.length === 0), 'and with no function asked of it, none');
}

// the game's C at a stage, with the program's numbers and each function's address filled in
const filled = {
  COUNT_AT: number(PARTS.COUNT), FRAMEBUFFER: number(FRAMEBUFFER), UNCACHED: number(UNCACHED), PIXELS: String(PARTS.PIXELS), TURN: String(PARTS.TURN),
  WIDTH: String(WIDTH), HEIGHT: String(HEIGHT), BACKGROUND: `${number(BACKGROUND)}u`, VIDEO: VIDEO.map(([at, value]) => `{ ${number(at)}, ${number(value)} }`).join(', '),
  ...Object.fromEntries(['count', 'red', 'blue', 'step'].map(name => [name.toUpperCase(), number(functions[name].address)])),
};
function write(stage) {
  let text = GAME.replace(/@([A-Z_]+)@/g, (_, name) => {
    if (filled[name] === undefined) throw new Error(`gamecube-parts/main.c names ${name}, which the test has no number for.`);
    return filled[name];
  });
  const change = (from, to) => {
    if (!text.includes(from)) throw new Error(`gamecube-parts/main.c has no "${from}" for the test to change.`);
    text = text.replace(from, to);
  };
  if (stage === 'twins') change('  step();\n}', '}');
  if (stage === 'changed') change('gc_write32(COUNT, gc_read32(COUNT) + 1);', 'gc_write32(COUNT, 1 + gc_read32(COUNT));');
  writeFileSync(join(gameFolder(VERSION), 'src', 'main.c'), text);
}

const RED = 'The red rows', BLUE = 'The blue rows';
failed += await partsFlow({
  name: NAME, title: 'Test GameCube Parts', consoleName: 'Nintendo GameCube',
  original: { console: 'gamecube', name: 'Test GameCube Parts (World)', title: 'Dreamports parts', code: 'GDRE00', sha1: createHash('sha1').update(disc).digest('hex') },
  copy, frames: 120,
  parts: [{ name: RED, frames: [0, 49] }, { name: BLUE, frames: [50, 119] }],
  ran: { [RED]: keys('start', 'step', 'count', 'red'), [BLUE]: keys('step', 'count', 'red', 'blue') },
  // the start is in no task, as it never comes back to a caller (lib/proofs.mjs, beyondProof)
  own: { [RED]: ['count', 'step', 'red'].map(name => ({ key: key(name), twin: name })), [BLUE]: [{ key: key('blue'), twin: 'blue' }] },
  write,
  proves: (version, twin) => ['twin', version, twin, '--calls', '1000'],
});

rmSync(work, { recursive: true, force: true });
if (failed) {
  console.log(`\n${failed} failed.`);
  process.exit(1);
}
console.log('\nA GameCube game\'s parts are its tasks, each done when its functions are proven and its frames are the original\'s.');
