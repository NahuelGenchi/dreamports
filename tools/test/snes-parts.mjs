// npm run test:snes-parts: a Super Nintendo game whose tasks are its parts, each made a function at a time, through
// the steps every console's test of it goes through (parts-flow.mjs), with a cartridge of the project's own
// (made-up-snes.mjs, madeUpPartsCartridge) and its Dreamport in C on the console's kit (snes-parts/main.c), so it
// needs nobody's copy of any game. The original plays in Snes9x, built with the tools' change to it, which says which
// functions ran in each frame; each twin is proven by the function check, against Snes9x's own 65816; and every frame
// of the Dreamport is compared with the original's, picture and sound.
//
// The program's V-blank counts the frame and gives the backdrop a red that changes each frame, by one function, for
// its first 59 frames, and a blue by another from then on. So the test knows what each of its two parts runs: the
// first the start, the V-blank's handler, the count and the red, and the second, which starts while the screen is
// still red, the handler, the count, the red and the blue, of which only the blue is its own.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, gameFolder } from '../lib/paths.mjs';
import { hex } from '../lib/proof-files.mjs';
import { madeUpPartsCartridge } from './made-up-snes.mjs';
import { partsFlow } from './parts-flow.mjs';

const NAME = 'test-snes-parts', VERSION = `${NAME}/c`;
const GAME = readFileSync(fileURLToPath(new URL('./snes-parts/main.c', import.meta.url)), 'utf8');
const work = join(LOCAL, 'tmp', 'snes-parts-test');

const { rom, labels } = madeUpPartsCartridge();
// a function's key in the code map, its place in the ROM, and its label in the game's code, the address it runs at
const key = name => hex(labels[name] & 0x7FFF);
const label = name => `sub_${labels[name].toString(16).toUpperCase().padStart(6, '0')}`;
const keys = (...names) => names.map(key).sort();

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const copy = join(work, 'made-up-parts.sfc');
writeFileSync(copy, rom);

const COUNTS = 'WORD(DIRECT(d, 0)) = (uint16_t)(WORD(DIRECT(d, 0)) + 1);';
// the game's C at a stage, with each function's label filled in
function write(stage) {
  let text = GAME.replace(/@([A-Z]+)@/g, (_, name) => label(name.toLowerCase()));
  const change = (from, to) => {
    if (!text.includes(from)) throw new Error(`snes-parts/main.c has no "${from}" for the test to change.`);
    text = text.replace(from, to);
  };
  if (stage === 'twins') change('  nmi(&a, 0);', '  (void)a;');
  if (stage === 'changed') change(COUNTS, 'WORD(DIRECT(d, 0)) = (uint16_t)(1 + WORD(DIRECT(d, 0)));');
  writeFileSync(join(gameFolder(VERSION), 'src', 'main.c'), text);
}

const RED = 'The red screen', BLUE = 'The blue screen';
const failed = await partsFlow({
  name: NAME, title: 'Test Super Nintendo Parts', consoleName: 'Super Nintendo',
  original: { console: 'snes', name: 'Test Super Nintendo Parts (World)', title: 'DREAMPORTS PARTS', code: '', sha1: createHash('sha1').update(rom).digest('hex') },
  copy, frames: 120,
  parts: [{ name: RED, frames: [0, 49] }, { name: BLUE, frames: [50, 119] }],
  ran: { [RED]: keys('start', 'nmi', 'count', 'red'), [BLUE]: keys('nmi', 'count', 'red', 'blue') },
  // the start is in no task, as it never comes back to a caller (lib/proofs.mjs, beyondProof)
  own: { [RED]: ['count', 'nmi', 'red'].map(name => ({ key: key(name), twin: name })), [BLUE]: [{ key: key('blue'), twin: 'blue' }] },
  write,
  proves: (version, twin) => ['twin', version, twin, '--calls', '1000'],
});

rmSync(work, { recursive: true, force: true });
if (failed) {
  console.log(`\n${failed} failed.`);
  process.exit(1);
}
console.log('\nA Super Nintendo game\'s parts are its tasks, each done when its functions are proven and its frames are the original\'s.');
