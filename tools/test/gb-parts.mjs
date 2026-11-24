// npm run test:gb-parts: a Game Boy game whose tasks are its parts, each made a function at a time, from its first day
// to a part done, through the tools as they're typed (parts-flow.mjs), with a made-up program of the project's own
// (made-up-gb.mjs, madeUpParts) as the game, so it needs nobody's copy of anything. Its two parts are 40 frames each of
// one recording with nothing held: in the first the screen is dark, and in the second the V-blank interrupt's code
// gives the background's shades from the count of pictures, which a function the first part never runs does. `prove`
// learns what each part runs from Gambatte, with the tools' change to it (../libretro/gambatte.patch), and `twin`
// proves each function by the same memory, in Gambatte's own processor (../gbc/twin.mjs). With --colour the same
// program is a Game Boy Color game.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, gameFolder } from '../lib/paths.mjs';
import { PARTS, madeUpParts } from './made-up-gb.mjs';
import { partsFlow } from './parts-flow.mjs';

const colour = process.argv.includes('--colour');
const HERE = fileURLToPath(new URL('./gb-parts/', import.meta.url));
const name = colour ? 'test-gbc-parts' : 'test-gb-parts', version = `${name}/c`;
const work = join(LOCAL, 'tmp', `${name}-copy`);
const key = address => address.toString(16).toUpperCase().padStart(8, '0');

const program = madeUpParts({ colour });
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const copy = join(work, `program.${colour ? 'gbc' : 'gb'}`);
writeFileSync(copy, program.rom);
// the line that is @NUMBERS@ alone, as a comment can name it too
const filled = file => readFileSync(join(HERE, file), 'utf8').replace(/^@NUMBERS@$/m, program.NUMBERS);

// the game's C at each stage the flow asks for: its twins written and nothing calling them, the whole game, and the
// whole game with one line of the first part's first twin written another way
function write(stage) {
  // only its C, as src/ holds the page's main.js too
  const src = join(gameFolder(version), 'src');
  for (const file of existsSync(src) ? readdirSync(src) : []) if (file.endsWith('.c')) rmSync(join(src, file));
  mkdirSync(src, { recursive: true });
  const twins = filled('twins.c');
  writeFileSync(join(src, 'twins.c'), stage === 'changed' ? twins.replace('RAM(COUNT)++;', 'RAM(COUNT) += 1;') : twins);
  writeFileSync(join(src, 'main.c'), stage === 'twins' ? '#include "gb.h"\n\nvoid game_start(void) {}\n\nvoid game_step(uint32_t buttons) { (void)buttons; }\n' : filled('main.c'));
}

const first = 'The dark screen', second = 'The shades';
const failed = await partsFlow({
  name,
  title: colour ? 'Test Game Boy Color Parts' : 'Test Game Boy Parts',
  consoleName: colour ? 'Game Boy Color' : 'Game Boy',
  original: { console: colour ? 'gbc' : 'gb', name: `${colour ? 'Test GBC Parts' : 'Test GB Parts'} (World)`, title: colour ? 'PARTS GBC' : 'MADEUP PARTS', code: '', sha1: program.sha1, keysAfterVBlank: true },
  copy,
  frames: 80,
  parts: [{ name: first, frames: [0, 39] }, { name: second, frames: [40, 79] }],
  // the start at $0100 runs in the first part, and no proof reaches it, so it's no part's to prove; the interrupt's
  // jump, its code and the count run in both, and the shades only from the FROM'th picture on, well into the second
  ran: {
    [first]: [PARTS.atVblank, PARTS.start, PARTS.vblank, PARTS.tick].map(key).sort(),
    [second]: [PARTS.atVblank, PARTS.vblank, PARTS.tick, PARTS.paint].map(key).sort(),
  },
  own: {
    [first]: [{ key: key(PARTS.tick), twin: 'tick' }, { key: key(PARTS.atVblank), twin: 'at_vblank' }, { key: key(PARTS.vblank), twin: 'vblank' }],
    [second]: [{ key: key(PARTS.paint), twin: 'paint' }],
  },
  write,
  proves: (at, twin) => ['twin', at, twin, '--calls', '1000'],
});
rmSync(work, { recursive: true, force: true });
if (failed) {
  console.log(`\n${failed} failed.`);
  process.exit(1);
}
console.log(`\nA ${colour ? 'Game Boy Color' : 'Game Boy'} game whose tasks are its parts goes from its first day to a part done.`);
