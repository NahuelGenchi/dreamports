// The Nintendo 64's side of npm run test:part-tasks (../part-tasks.mjs): a program of the project's own
// (../made-up-n64.mjs, madeUpPartsCartridge), played in Parallel N64, which says which functions ran in each frame with
// the tools' change to it (../../libretro/parallel-n64.patch), and its Dreamport in C on the console's kit, its twins in
// n64/game.c and what the kit calls in n64/main.c. Its functions are proven by the same memory, with twin, against
// Parallel N64's own processor.
//
// What the program is known to run, which the test holds the tools to, is written out below from the program's own
// words, not from anything a tool said.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hex } from '../../lib/proof-files.mjs';
import { KIT, PARTS, madeUpPartsCartridge } from '../made-up-n64.mjs';

const HERE = fileURLToPath(new URL('./n64/', import.meta.url));
const read = name => readFileSync(join(HERE, name), 'utf8');
const { cartridge, labels } = madeUpPartsCartridge();
const NAMES = ['count', 'red', 'blue', 'bonus'];
const number = value => `0x${value.toString(16).toUpperCase()}`;
// the program's numbers and each function's address, as the C names them
const FILLED = { COUNT_AT: number(PARTS.COUNT), FRAMEBUFFER: number(KIT.FRAMEBUFFER), PIXELS: String(PARTS.PIXELS), TURN: String(PARTS.TURN), BONUS: String(PARTS.BONUS), ...Object.fromEntries(NAMES.map(name => [name.toUpperCase(), number(labels[name])])) };
const fill = text => text.replace(/@([A-Z_]+)@/g, (whole, name) => FILLED[name] ?? whole);

export default {
  id: 'n64',
  consoleName: 'Nintendo 64',
  proof: 'memory',
  functions: Object.fromEntries(NAMES.map(name => [name, hex(labels[name])])),
  // the function the cartridge's boot code jumps to, where its code loads: it sets up and goes round its loop, and
  // never comes back, so no call of it can be compared and neither proof reaches it (lib/proofs.mjs, beyondProof)
  start: [hex(labels.start)],
  // 120 frames, nothing held
  recording: { about: 'The program from power-on, nothing held.', frames: 120, held: [[0, []]] },
  parts: [
    // The start runs once, as the boot code jumps to it, and its loop takes its first turn before the console shows a
    // frame: count, which makes the count the frame's number and one, and red while it's under 60. So frames 0 to 49,
    // and 50 after them, run count and red.
    { name: 'The red rows', frames: [0, 49], runs: ['count', 'red'] },
    // red until frame 58, when the count is 59, and blue from frame 59 on
    { name: 'The blue rows', frames: [50, 119], runs: ['count', 'red', 'blue'] },
  ],
  // in the code map and run in no part: bonus is called only once the count is 1,000 or more
  never: ['bonus'],
  named: null,
  // a twin written wrong, which its proof has to find, and the game's own step a frame late, which only the frames can
  wrong: { name: 'red', from: '<< 11 | 1);', to: '<< 11 | 3);' },
  lateStep: { from: '  (void)buttons;\n', to: '  static int late;\n  (void)buttons;\n  if (!late++) return;\n' },

  /** Writes the cartridge in `work`: { copy, original, proofFiles }. */
  async build(work) {
    mkdirSync(work, { recursive: true });
    const copy = join(work, 'parts.z64');
    writeFileSync(copy, cartridge);
    const original = { console: 'n64', name: 'Test Part Tasks N64 (World)', title: 'DREAMPORTS PARTS', code: 'NDRE', sha1: createHash('sha1').update(cartridge).digest('hex') };
    return { copy, original, proofFiles: {} };
  },

  /** The version's code, by its path in the version's folder, with the twins of `twins` written, by name, `wrong` for
   *  the one twin written wrong, and `late` for the game's step a frame late. A function with no twin does nothing. */
  source({ twins, wrong = false, late = false }) {
    let program = fill(read('game.c')), glue = fill(read('main.c'));
    const change = (text, { from, to }, where) => {
      if (!text.includes(from)) throw new Error(`${where} has no "${from}" for the test to change.`);
      return text.replace(from, to);
    };
    const missing = NAMES.filter(name => !twins.includes(name));
    for (const name of missing) {
      const block = new RegExp(`/\\*\\* 0x[0-9A-F]{8}: [^\\n]*\\*/\\nvoid ${name}\\(void\\) \\{[^]*?\\n}\\n\\n?`);
      if (!block.test(program)) throw new Error(`n64/game.c has no ${name} for the test to leave out.`);
      program = program.replace(block, '');
    }
    glue = glue.replace('@MISSING@', missing.map(name => `void ${name}(void) {}`).join('\n'));
    if (wrong) program = change(program, this.wrong, 'n64/game.c');
    if (late) glue = change(glue, this.lateStep, 'n64/main.c');
    return { 'src/game.c': program, 'src/main.c': glue };
  },

  /** Proves every twin the version has, as a contributor does: what to give `npm run dp --`. */
  prove: version => ['twin', version, '--calls', '1000'],
};
