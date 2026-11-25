// The Game Boy's side of npm run test:part-tasks (../part-tasks.mjs): a program of the project's own, written an
// instruction at a time (../made-up-gb.mjs, madeUpParts), as the cartridge, and the same program in C on the kit
// (gb/main.c, gb/twins.c). The Game Boy's games were written by hand in the processor's own language, so no compiler
// gives their bytes back: each function is proven by the same memory, with twin, in Gambatte's own processor
// (../../gbc/twin.mjs). The Game Boy Color's side (gbc.mjs) is the same program as a Game Boy Color game.
//
// What the program is known to run, which the test holds the tools to, is written out below from the program's own
// lines, not from anything a tool said.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PARTS, madeUpParts } from '../made-up-gb.mjs';

const HERE = fileURLToPath(new URL('./gb/', import.meta.url));
const hex8 = address => address.toString(16).toUpperCase().padStart(8, '0');

/** The console's side of the test, on a Game Boy or, with `colour`, a Game Boy Color. */
export function gameBoy({ colour = false } = {}) {
  const program = madeUpParts({ colour });
  // the line that is @NUMBERS@ alone, as a comment can name it too
  const read = name => readFileSync(join(HERE, name), 'utf8').replace(/^@NUMBERS@$/m, program.NUMBERS);
  return {
    id: colour ? 'gbc' : 'gb',
    // as the New Dreamport form names the console
    consoleName: colour ? 'Game Boy Color' : 'Game Boy',
    // how its functions are proven, as a line of proofs.json says it
    proof: 'memory',
    // each function's name in gb/twins.c, to its key in the game's code map: where it is in the cartridge
    functions: { at_vblank: hex8(PARTS.atVblank), vblank: hex8(PARTS.vblank), tick: hex8(PARTS.tick), paint: hex8(PARTS.paint), secret: hex8(PARTS.secret) },
    // The cartridge's start at $0100, which jumps to the program's power-on and runs once as the console starts it, in
    // the first part's first frame. A code map has it, and no proof reaches it (lib/proofs.mjs, beyondProof), so it's in
    // the first part's list and in no task.
    start: [hex8(PARTS.start)],
    // 80 frames with nothing held, as the program reads no buttons
    recording: { about: 'Nothing held: the stripes scroll, and from the 50th picture the shades change with them.', frames: 80, held: [[0, []]] },
    parts: [
      // At each V-blank the console sends the processor to $0040, which jumps to the interrupt's code, which calls
      // tick, which counts the picture and scrolls the stripes. The count is under 50, so paint never runs, and isn't 0
      // again, so secret doesn't.
      { name: 'The stripes', frames: [0, 39], runs: ['at_vblank', 'vblank', 'tick'] },
      // the same, and from the 50th picture, in the part's frames, paint, which gives the shades from the count
      { name: 'The shades', frames: [40, 79], runs: ['at_vblank', 'vblank', 'tick', 'paint'] },
    ],
    // in the code map and run in no part: secret runs once the count comes round to 0, after 256 pictures
    never: ['secret'],
    // The Game Boy's code map finds a function by a call or a jump to it, not by an address its code only keeps
    // (../../gbc/functions.mjs), so the program has none of those.
    named: null,
    // A twin written wrong, which its proof has to find. It's the one no other twin calls, as a twin is proven by the
    // same memory, and one that calls a twin written wrong leaves a different memory too. And the game's own step a
    // frame late, which only the frames can find: the stripes scroll a picture behind.
    wrong: { name: 'at_vblank', from: '  vblank();\n}', to: '  tick();\n  vblank();\n}' },
    lateStep: { from: '  (void)buttons;\n  run();\n', to: '  static int late;\n  (void)buttons;\n  if (!late++) return;\n  run();\n' },

    /** Builds the program as a cartridge in `work`: { copy, original, proofFiles }, the copy's path, the game's
     *  proof/original.json, and the other files of its proof folder, by name: none. */
    async build(work) {
      mkdirSync(work, { recursive: true });
      const copy = join(work, `program.${colour ? 'gbc' : 'gb'}`);
      writeFileSync(copy, program.rom);
      const original = { console: colour ? 'gbc' : 'gb', name: `Test Part Tasks ${colour ? 'GBC' : 'GB'} (World)`, title: colour ? 'PARTS GBC' : 'MADEUP PARTS', code: '', sha1: program.sha1, keysAfterVBlank: true };
      return { copy, original, proofFiles: {} };
    },

    /** The version's code, by its path in the version's folder, with the twins of `twins` written, by name, `wrong` for
     *  the one twin written wrong, and `late` for the game's step a frame late. A function that isn't a twin yet is
     *  there as C with no contract, as the Game Boy's kit runs only the game's C, and twin proves only a function with
     *  one. */
    source({ twins, wrong = false, late = false }) {
      // its first day: the game the tools start it with, which runs nothing of the program
      if (!twins.length) return {};
      let code = read('twins.c'), game = read('main.c');
      for (const name of Object.keys(this.functions).filter(each => !twins.includes(each))) {
        const contract = new RegExp(`^// dp:twin \\w+ ${name}\\(\\)\\n`, 'm');
        if (!contract.test(code)) throw new Error(`gb/twins.c has no contract for ${name} for the test to leave out.`);
        code = code.replace(contract, '');
      }
      const change = (text, { from, to }, where) => {
        if (!text.includes(from)) throw new Error(`${where} has no "${from}" for the test to change.`);
        return text.replace(from, to);
      };
      if (wrong) code = change(code, this.wrong, 'gb/twins.c');
      if (late) game = change(game, this.lateStep, 'gb/main.c');
      return { 'src/twins.c': code, 'src/main.c': game };
    },

    /** Proves every twin the version has, as a contributor does: what to give `npm run dp --`. */
    prove: version => ['twin', version],
  };
}

export default gameBoy();
