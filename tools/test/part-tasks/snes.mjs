// The Super Nintendo's side of npm run test:part-tasks (../part-tasks.mjs): a cartridge of the project's own
// (../made-up-snes.mjs, madeUpPartsCartridge), played in Snes9x, which says which functions ran in each frame with the
// tools' change to it, and its Dreamport in C on the console's kit, its twins in snes/game.c and what the kit calls in
// snes/main.c. Its functions are proven by the same memory, with twin, against Snes9x's own 65816.
//
// What the program is known to run, which the test holds the tools to, is written out below from the program's own
// bytes, not from anything a tool said.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hex } from '../../lib/proof-files.mjs';
import { madeUpPartsCartridge } from '../made-up-snes.mjs';

const HERE = fileURLToPath(new URL('./snes/', import.meta.url));
const read = name => readFileSync(join(HERE, name), 'utf8');
const { rom, labels } = madeUpPartsCartridge();
const NAMES = ['nmi', 'count', 'red', 'blue', 'bonus'];
// a function's key in the code map, its place in the ROM, and its label in a game's code, the address it runs at
const keyOf = name => hex(labels[name] & 0x7FFF);
const labelOf = name => `sub_${labels[name].toString(16).toUpperCase().padStart(6, '0')}`;
// what each function is given, for one that does nothing while it has no twin
const GIVEN = { nmi: 'uint16_t d', count: 'uint16_t d', red: 'uint16_t *a, uint16_t d', blue: 'uint16_t *a, uint16_t d', bonus: 'uint16_t *a, uint16_t d' };

export default {
  id: 'snes',
  consoleName: 'Super Nintendo',
  proof: 'memory',
  functions: Object.fromEntries(NAMES.map(name => [name, keyOf(name)])),
  // the function the console starts the cartridge at, its reset vector's: it sets up and goes round the main loop, and
  // never comes back, so no call of it can be compared and neither proof reaches it (lib/proofs.mjs, beyondProof)
  start: [keyOf('start')],
  // 120 frames, nothing held
  recording: { about: 'The program from power-on, nothing held.', frames: 120, held: [[0, []]] },
  parts: [
    // The start runs once, as the console starts the program, and its loop waits; from the first V-blank on, nmi moves
    // the flag on, and the loop calls count, which makes the count the frame's number and one, and red while it's
    // under 60. So frames 0 to 49, and 50 after them, run nmi, count and red.
    { name: 'The red screen', frames: [0, 49], runs: ['nmi', 'count', 'red'] },
    // red until frame 58, when the count is 59, and blue from frame 59 on
    { name: 'The blue screen', frames: [50, 119], runs: ['nmi', 'count', 'red', 'blue'] },
  ],
  // in the code map and run in no part: bonus is called only once the count is 1,000 or more
  never: ['bonus'],
  named: null,
  // a twin written wrong, which its proof has to find, and the game's own step a frame late, which only the frames can
  wrong: { name: 'red', from: 'snes_write(0x2122, level);', to: 'snes_write(0x2122, (uint8_t)(level ^ 1));' },
  lateStep: { from: '  (void)buttons;\n', to: '  static int late;\n  (void)buttons;\n  if (!late++) return;\n' },

  /** Writes the cartridge in `work`: { copy, original, proofFiles }. */
  async build(work) {
    mkdirSync(work, { recursive: true });
    const copy = join(work, 'parts.sfc');
    writeFileSync(copy, rom);
    const original = { console: 'snes', name: 'Test Part Tasks SNES (World)', title: 'DREAMPORTS PARTS', code: '', sha1: createHash('sha1').update(rom).digest('hex') };
    return { copy, original, proofFiles: {} };
  },

  /** The version's code, by its path in the version's folder, with the twins of `twins` written, by name, `wrong` for
   *  the one twin written wrong, and `late` for the game's step a frame late. A function with no twin does nothing. */
  source({ twins, wrong = false, late = false }) {
    let program = read('game.c').replace(/@([A-Z]+)@/g, (_, name) => labelOf(name.toLowerCase()));
    let glue = read('main.c');
    const change = (text, { from, to }, where) => {
      if (!text.includes(from)) throw new Error(`${where} has no "${from}" for the test to change.`);
      return text.replace(from, to);
    };
    const missing = NAMES.filter(name => !twins.includes(name));
    for (const name of missing) {
      const block = new RegExp(`// dp:twin \\S+ \\S+ ${name}\\([^]*?\\n}\\n\\n?`);
      if (!block.test(program)) throw new Error(`snes/game.c has no ${name} for the test to leave out.`);
      program = program.replace(block, '');
    }
    glue = glue.replace('@MISSING@', missing.map(name => `void ${name}(${GIVEN[name]}) { ${GIVEN[name].split(', ').map(each => `(void)${each.split(/[ *]+/).at(-1)};`).join(' ')} }`).join('\n'));
    if (wrong) program = change(program, this.wrong, 'snes/game.c');
    if (late) glue = change(glue, this.lateStep, 'snes/main.c');
    return { 'src/game.c': program, 'src/main.c': glue };
  },

  /** Proves every twin the version has, as a contributor does: what to give `npm run dp --`. */
  prove: version => ['twin', version, '--calls', '1000'],
};
