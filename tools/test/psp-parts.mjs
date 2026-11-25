// npm run test:psp-parts: a PlayStation Portable game whose tasks are its parts, each made a function at a time,
// through the steps every console's test of it goes through (parts-flow.mjs), with a program of the project's own
// (made-up-psp-twin.mjs, madeUpPspParts) and its Dreamport in C on the console's kit (psp-parts/main.c), so it needs
// nobody's copy of any game. The original plays in PPSSPP, built with the tools' change to it, which says which
// functions ran in each frame; each twin is proven by the function check, against PPSSPP's own interpreter; and every
// frame of the Dreamport is compared with the original's, picture and sound.
//
// Each frame the program counts the frame and paints the screen a red that changes each frame, by one function, for
// its first 59 frames, and a blue by another from then on. So the test knows what each of its two parts runs: the
// first the count, the red and the paint, and the second, which starts while the screen is still red, those and the
// blue, of which only the blue is its own. The program's start, which the first part runs too, goes round that loop and
// never comes back, so it's in no task (lib/proofs.mjs, beyondProof).

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, gameFolder } from '../lib/paths.mjs';
import { hex } from '../lib/proof-files.mjs';
import { madeUpPspParts } from './made-up-psp-twin.mjs';
import { partsFlow } from './parts-flow.mjs';

const NAME = 'test-psp-parts', VERSION = `${NAME}/c`;
const GAME = readFileSync(fileURLToPath(new URL('./psp-parts/main.c', import.meta.url)), 'utf8');
const work = join(LOCAL, 'tmp', 'psp-parts-test');

const { elf, at } = madeUpPspParts();
const key = name => hex(at[name]);
const keys = (...names) => names.map(key).sort();

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const copy = join(work, 'made-up-parts.prx');
writeFileSync(copy, elf);

const COUNTS = '*frames = *frames + 1;';
// the game's C at a stage, with each function's address filled in
function write(stage) {
  let text = GAME.replace(/@([A-Z]+)@/g, (_, name) => `0x${key(name.toLowerCase())}`);
  const change = (from, to) => {
    if (!text.includes(from)) throw new Error(`psp-parts/main.c has no "${from}" for the test to change.`);
    text = text.replace(from, to);
  };
  if (stage === 'twins') change('    uint32_t frame = count();\n    paint((uint32_t *)PSP_VRAM, 512 * 272, frame < 60 ? red(frame) : blue(frame));\n', '');
  if (stage === 'changed') change(COUNTS, '*frames = 1 + *frames;');
  writeFileSync(join(gameFolder(VERSION), 'src', 'main.c'), text);
}

const RED = 'The red screen', BLUE = 'The blue screen';
const failed = await partsFlow({
  name: NAME, title: 'Test PlayStation Portable Parts', consoleName: 'PlayStation Portable',
  original: { console: 'psp', name: 'Test PlayStation Portable Parts (World)', title: 'parts', code: '', sha1: createHash('sha1').update(elf).digest('hex'), keysAfterVBlank: true },
  copy, frames: 120,
  parts: [{ name: RED, frames: [0, 49] }, { name: BLUE, frames: [50, 119] }],
  ran: { [RED]: keys('start', 'count', 'red', 'paint'), [BLUE]: keys('count', 'red', 'blue', 'paint') },
  own: { [RED]: ['count', 'paint', 'red'].sort((a, b) => key(a).localeCompare(key(b))).map(name => ({ key: key(name), twin: name })), [BLUE]: [{ key: key('blue'), twin: 'blue' }] },
  write,
  proves: (version, twin) => ['twin', version, twin, '--calls', '1000'],
});

rmSync(work, { recursive: true, force: true });
if (failed) {
  console.log(`\n${failed} failed.`);
  process.exit(1);
}
console.log('\nA PlayStation Portable game\'s parts are its tasks, each done when its functions are proven and its frames are the original\'s.');
