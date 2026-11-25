// The Game Boy Advance's side of npm run test:part-tasks (../part-tasks.mjs): a program of the project's own
// (gba/cart.c), built as a cartridge with the console's own compiler and, from the same C, as the game's version in C
// on the kit, as npm run test:same-memory builds its own. Its functions are proven by the same bytes, with match.
//
// What the program is known to run, which the test holds the tools to, is written out below from the program's own
// lines, not from anything a tool said.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withBuildTools } from '../../gba/build.mjs';
import { buildCompilers, isCompilerBuilt } from '../../gba/agbcc.mjs';
import { COMPILER, DATA, compile, link } from '../same-memory/cartridge.mjs';

const HERE = fileURLToPath(new URL('./gba/', import.meta.url));
const read = name => readFileSync(join(HERE, name), 'utf8');
const hex8 = address => address.toString(16).toUpperCase().padStart(8, '0');

// where each function is, as the comment above it in gba/cart.c says: a function's key in the game's code map
const FUNCTIONS = Object.fromEntries([...read('cart.c').matchAll(/^\/\*\* (\w+), 0x([0-9A-F]{8}):/gm)].map(([, name, address]) => [name, address]));
// the work memory compared after every frame: all of the slow one, and the fast one up to where the console's
// processor keeps its stack, as a Dreamport's C keeps its own elsewhere
const WORK_MEMORY = [{ address: '02000000', bytes: 0x40000 }, { address: '03000000', bytes: 0x7E00 }];

export default {
  id: 'gba',
  // as the New Dreamport form names the console
  consoleName: 'Game Boy Advance',
  // how its functions are proven, as a line of proofs.json says it
  proof: 'bytes',
  functions: FUNCTIONS,
  // The cartridge's start: the jump at its first address and the instructions after its header, which run once as
  // the console starts it, in the first part's first frame. A code map has them, and neither proof reaches them yet
  // (lib/proofs.mjs, beyondProof), so they're in the first part's list and in no task.
  start: ['08000000', '080000C0'],
  // 600 frames: nothing held on the title, then Start, which the title answers with its flash, and the arrows
  recording: { about: 'The title with nothing held, then Start, the flash, and the block moved with the arrows.', frames: 600, held: [[0, []], [330, ['START']], [336, []], [380, ['RIGHT']], [420, ['DOWN', 'LEFT']], [470, ['UP']], [520, []]] },
  parts: [
    // AgbMain starts once, as the console starts the program, waits for the screen and sets up; then every frame is
    // Frame, which with gMode 0 calls Title, then Draw, and WaitFrame. Start isn't held, so Flash never starts, and
    // L and R aren't, so Secret doesn't.
    { name: 'The title', frames: [0, 299], runs: ['AgbMain', 'WaitFrame', 'Init', 'Frame', 'Title', 'Draw'] },
    // Frame, Draw and WaitFrame go on. Title runs until it sees Start, at frame 330, and calls Flash, which holds the
    // program for sixteen frames; then gMode is 1, and Frame calls Play, which calls Move. AgbMain and Init never
    // start again, as the program never leaves AgbMain's loop.
    { name: 'The play', frames: [300, 599], runs: ['WaitFrame', 'Frame', 'Title', 'Flash', 'Play', 'Move', 'Draw'] },
  ],
  // in the code map and run in no part: Secret is called only with L and R held, which the recording never holds, and
  // Bonus is called by nothing at all
  never: ['Secret', 'Bonus'],
  // a function a part's code only names: Title keeps Bonus's address and never calls it
  named: { name: 'Bonus', by: 'Title' },
  // a twin written wrong, which its proof has to find, and the game's own step a frame late, which only the frames can
  wrong: { name: 'Draw', from: 'OAM[2] = 1;', to: 'OAM[2] = 2;' },
  lateStep: { from: '  (void)keys;\n', to: '  static int late;\n  (void)keys;\n  if (!late++) return;\n' },

  /** Builds the program as a cartridge in `work`: { copy, original, proofFiles }, the copy's path, the game's
   *  proof/original.json, and the other files of its proof folder, by name. */
  async build(work) {
    mkdirSync(work, { recursive: true });
    if (!isCompilerBuilt(COMPILER.name)) withBuildTools(console.log, tools => buildCompilers([COMPILER.name], console.log, tools));
    const { rom, names } = link([await compile('cart.c', { here: HERE, work })], { title: 'PART TASKS', code: 'PTSK', helpers: null });
    const copy = join(work, 'cart.gba');
    writeFileSync(copy, rom);
    if (names.get('gWave') !== DATA) throw new Error('The cartridge\'s data isn\'t where the test\'s linker puts it.');
    const original = { console: 'gba', name: 'Test Part Tasks (World)', title: 'PART TASKS', code: 'PTSK', sha1: createHash('sha1').update(rom).digest('hex'), compiler: COMPILER, keysAfterVBlank: true, workMemory: WORK_MEMORY };
    // the cartridge's data and its functions by name, as a game's proof gives its names: a twin names a function that
    // has no C yet by its address here, which is kept odd, as the console keeps the address of Thumb code
    const addresses = { ...Object.fromEntries([...names].map(([name, address]) => [name, hex8(address)])), ...Object.fromEntries(Object.entries(FUNCTIONS).map(([name, address]) => [name, hex8(parseInt(address, 16) | 1)])) };
    return { copy, original, proofFiles: { 'addresses.json': `${JSON.stringify({ about: 'Where the test\'s linker put the program\'s functions and data.', addresses }, null, 2)}\n` } };
  },

  /** The version's code, by its path in the version's folder, with the twins of `twins` written, by name, `wrong`
   *  for the one twin written wrong, and `late` for the game's step a frame late. */
  source({ twins, wrong = false, late = false }) {
    let program = read('cart.c'), glue = read('main.c');
    // its first day: the console's memory where the console keeps it, and nothing of the program yet
    if (!twins.length) return { 'src/cart.h': read('cart.h'), 'src/main.c': glue.replaceAll('  kit_run(AgbMain);\n', '') };
    for (const name of Object.keys(FUNCTIONS).filter(each => !twins.includes(each))) {
      const block = new RegExp(`/\\*\\* ${name}, 0x[^]*?\\n}\\n\\n?`);
      if (!block.test(program)) throw new Error(`gba/cart.c has no ${name} for the test to leave out.`);
      program = program.replace(block, '');
    }
    const change = (text, { from, to }, where) => {
      if (!text.includes(from)) throw new Error(`${where} has no "${from}" for the test to change.`);
      return text.replace(from, to);
    };
    if (wrong) program = change(program, this.wrong, 'gba/cart.c');
    if (late) glue = change(glue, this.lateStep, 'gba/main.c');
    return { 'src/cart.c': program, 'src/cart.h': read('cart.h'), 'src/main.c': glue };
  },

  /** Proves every twin the version has, as a contributor does: what to give `npm run dp --`. */
  prove: version => ['match', version],
};
