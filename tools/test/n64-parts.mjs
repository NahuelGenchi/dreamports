// npm run test:n64-parts: a Nintendo 64 game whose tasks are its parts, each made a function at a time, through the
// steps every console's test of it goes through (parts-flow.mjs), with a program of the project's own
// (made-up-n64.mjs, madeUpPartsCartridge) and its Dreamport in C on the console's kit (n64-parts/main.c), so it needs
// nobody's copy of any game. The original plays in Parallel N64, built with the tools' change to it
// (../libretro/parallel-n64.patch), which says where its processor is before each instruction, and so which functions
// ran in each frame; each twin is proven by the function check, against Parallel N64's own processor; and every frame
// of the Dreamport is compared with the original's, picture and sound.
//
// First it plays the program with the emulator telling of every instruction and without: every frame's picture and
// sound has to be the same, as the change only looks. Then the steps. The program counts the frame and fills the
// picture's first rows red, by one function, while the count is under 60, and blue by another from then on. So the
// test knows what each of its two parts runs: the first the start, the frame's step, the count and the red, and the
// second, which starts while the rows are still red, the step, the count, the red and the blue, of which only the
// blue is its own.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, gameFolder } from '../lib/paths.mjs';
import { hex } from '../lib/proof-files.mjs';
import { consoleOf } from '../consoles.mjs';
import { libretroReference } from '../libretro/reference.mjs';
import { KIT, PARTS, madeUpPartsCartridge } from './made-up-n64.mjs';
import { partsFlow } from './parts-flow.mjs';

const NAME = 'test-n64-parts', VERSION = `${NAME}/c`;
const GAME = readFileSync(fileURLToPath(new URL('./n64-parts/main.c', import.meta.url)), 'utf8');
const work = join(LOCAL, 'tmp', 'n64-parts-test');

const { cartridge, labels } = madeUpPartsCartridge();
const key = name => hex(labels[name]);
const keys = (...names) => names.map(key).sort();
const number = value => `0x${value.toString(16).toUpperCase()}`;

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const copy = join(work, 'made-up-parts.z64');
writeFileSync(copy, cartridge);

let failed = 0;
{
  console.log('The made-up program in Parallel N64:');
  const reference = libretroReference(consoleOf('n64'));
  reference.ensureOriginal(console.log);
  const frames = 90, buttons = new Array(frames).fill(0);
  const functions = ['start', 'step', 'count', 'red', 'blue'].map((name, index) => ({ address: labels[name], size: 4, index }));
  const untold = await reference.runOriginal({ copy, frames, buttons, sound: true });
  const told = await reference.runOriginal({ copy, frames, buttons, sound: true, functions });
  const same = buttons.filter((_, frame) => untold.hashes[frame] === told.hashes[frame] && Buffer.from(untold.sound.read(frame)).equals(Buffer.from(told.sound.read(frame)))).length;
  untold.sound.close();
  told.sound.close();
  const check = (ok, what) => {
    console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
    if (!ok) failed++;
  };
  check(same === frames, `the emulator plays the same while it tells of every instruction: ${same} of ${frames} frames, picture and sound`);
  const ranIn = name => told.ran.map((list, frame) => (Array.from(list).includes(['start', 'step', 'count', 'red', 'blue'].indexOf(name)) ? frame : -1)).filter(frame => frame >= 0);
  const [start, step, count, red, blue] = ['start', 'step', 'count', 'red', 'blue'].map(ranIn);
  check(start.length === 1 && start[0] === 0, `it says the start ran in the first frame alone: ${JSON.stringify(start)}`);
  check(step.length > 80 && JSON.stringify(step) === JSON.stringify(count), `the step and the count in each frame from the first interrupt on: ${step.length} of ${frames}, from frame ${step[0]}`);
  check(red.length === PARTS.TURN - 1 && blue.length === step.length - red.length && blue[0] === red.at(-1) + 1 && red.every(frame => !blue.includes(frame)),
    `and the red in the first ${PARTS.TURN - 1} of those and the blue in the rest: red to frame ${red.at(-1)}, blue from frame ${blue[0]}`);
  check(untold.ran.every(list => list.length === 0), 'and with no function asked of it, none');
}

// the game's C at a stage, with the program's numbers and each function's address filled in
const filled = { COUNT_AT: number(PARTS.COUNT), FRAMEBUFFER: number(KIT.FRAMEBUFFER), PIXELS: String(PARTS.PIXELS), TURN: String(PARTS.TURN), ...Object.fromEntries(['count', 'red', 'blue', 'step'].map(name => [name.toUpperCase(), number(labels[name])])) };
function write(stage) {
  let text = GAME.replace(/@([A-Z_]+)@/g, (_, name) => filled[name]);
  const change = (from, to) => {
    if (!text.includes(from)) throw new Error(`n64-parts/main.c has no "${from}" for the test to change.`);
    text = text.replace(from, to);
  };
  if (stage === 'twins') change('  step();\n}', '}');
  if (stage === 'changed') change('n64_write32(COUNT, n64_read32(COUNT) + 1);', 'n64_write32(COUNT, 1 + n64_read32(COUNT));');
  writeFileSync(join(gameFolder(VERSION), 'src', 'main.c'), text);
}

const RED = 'The red rows', BLUE = 'The blue rows';
failed += await partsFlow({
  name: NAME, title: 'Test Nintendo 64 Parts', consoleName: 'Nintendo 64',
  original: { console: 'n64', name: 'Test Nintendo 64 Parts (World)', title: 'DREAMPORTS PARTS', code: 'NDRE', sha1: createHash('sha1').update(cartridge).digest('hex') },
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
console.log('\nA Nintendo 64 game\'s parts are its tasks, each done when its functions are proven and its frames are the original\'s.');
