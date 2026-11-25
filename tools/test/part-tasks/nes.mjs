// The NES's side of npm run test:part-tasks (../part-tasks.mjs): a program of the project's own, written out an
// instruction at a time (../made-up-nes.mjs, madeUpParts), and its Dreamport in C on the NES kit (nes/game.c). The NES
// has no compiler that gives a game's bytes back, so its functions are proven by the same memory, with twin.
//
// What the program is known to run, which the test holds the tools to, is written out below from the program's own
// instructions, not from anything a tool said.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALETTE_AT, PARTS, RAM, START, TIMER, madeUpParts } from '../made-up-nes.mjs';

const HERE = fileURLToPath(new URL('./nes/', import.meta.url));
const hex8 = address => address.toString(16).toUpperCase().padStart(8, '0');
const program = madeUpParts();
// where each function is in the program, which is its key in the game's code map, and the name the game's code gives
// it: sub_ and its address on the console, where the program's one block of code is at $C000
const NAMES = { move: 'move', title: 'title', play: 'play', secret: 'secret' };
const FUNCTIONS = { reset: hex8(program.at.reset), vblank: hex8(program.at.nmi), ...Object.fromEntries(Object.keys(NAMES).map(name => [name, hex8(program.at[name])])) };
const label = name => `sub_${(0xC000 + program.at[name]).toString(16).toUpperCase()}`;
const NUMBERS = {
  SCROLL: RAM.scroll, BUTTONS: RAM.buttons, X: RAM.x, Y: RAM.y, BACKDROP: RAM.backdrop, MODE: PARTS.mode, SECRETS: PARTS.secrets,
  START_X: START.x, START_Y: START.y, START_BACKDROP: START.backdrop, PRESSED_BACKDROP: START.pressedBackdrop, SPRITE: START.sprite, TIMER, PALETTE_AT,
  MOVE: label('move'), TITLE: label('title'), PLAY: label('play'), SECRET: label('secret'),
};
const game = readFileSync(join(HERE, 'game.c'), 'utf8').replace(/@([A-Z_]+)@/g, (_, name) => NUMBERS[name]);

export default {
  id: 'nes',
  // as the New Dreamport form names the console
  consoleName: 'NES',
  // how its functions are proven, as a line of proofs.json says it
  proof: 'memory',
  functions: FUNCTIONS,
  // nothing of it is the kit's alone, as a Game Boy Advance cartridge's start is
  start: [],
  // The routines the processor's own vectors lead to: the reset routine, which runs once as the console starts and
  // never returns, and the V-blank's, which the console starts each frame and which ends with RTI. The function check
  // calls a function as JSR does and waits for its RTS, so it can call neither, and what they do is in what the kit
  // calls, game_start and game_step, which is no twin.
  unreached: {
    names: ['reset', 'vblank'],
    why: 'the reset routine and the routine of the V-blank are in its list, as the original runs them, and the function check can give neither a proof, as it calls a function as JSR does and waits for its RTS, where the first never returns and the second ends with RTI. Nothing says such a function is one no proof reaches (lib/proofs.mjs, beyondProof), so the task of the part waits on them.',
  },
  // 600 frames: the arrows on the title, then Start, and the arrows again
  recording: { about: 'The title with the arrows held, then Start, and the arrows in the play.', frames: 600, held: [[0, []], [100, ['RIGHT']], [140, ['DOWN']], [180, []], [330, ['START']], [336, []], [380, ['LEFT']], [420, ['UP', 'RIGHT']], [470, []]] },
  parts: [
    // The reset routine starts once, as the console starts the program. From the frame it lets the V-blank interrupt
    // it, the V-blank's routine starts every frame: it calls move, and title while the byte at $15 is 0, which it is
    // until Start. A and B are never held together, so secret is never called.
    { name: 'The title', frames: [0, 299], runs: ['reset', 'vblank', 'move', 'title'] },
    // move goes on, title is called until it sees Start, at frame 330, and from the next frame play is.
    { name: 'The play', frames: [300, 599], runs: ['vblank', 'move', 'title', 'play'] },
  ],
  // in the code map and run in no part
  never: ['secret'],
  // the program keeps no function's address without calling it
  named: null,
  // a twin written wrong, which its proof has to find, and the game's own step a frame late, which only the frames can
  wrong: { name: 'move', from: 'if (held & 0x04) RAM[Y_AT]++;', to: 'if (held & 0x04) RAM[Y_AT] += 2;' },
  lateStep: { from: '  if (frame >= PLAYS_FROM) {', to: '  if (frame > PLAYS_FROM) {' },

  /** Builds the program as a copy in `work`: { copy, original, proofFiles }. */
  async build(work) {
    mkdirSync(work, { recursive: true });
    const copy = join(work, 'made-up.nes');
    writeFileSync(copy, program.rom);
    return { copy, original: { console: 'nes', name: 'Test Part Tasks (World)', title: 'parts', code: '', sha1: program.sha1 }, proofFiles: {} };
  },

  /** The version's code, by its path in the version's folder, with the twins of `twins` written, by name, `wrong`
   *  for the one twin written wrong, and `late` for the game's step a frame late. A function with no twin yet is
   *  left out and marked as a stop, as an NES game's C marks a path it hasn't ported. */
  source({ twins, wrong = false, late = false }) {
    let text = game;
    const change = ({ from, to }) => {
      if (!text.includes(from)) throw new Error(`nes/game.c has no "${from}" for the test to change.`);
      text = text.replace(from, to);
    };
    for (const name of Object.keys(NAMES).filter(each => !twins.includes(each))) {
      const block = new RegExp(`/\\*\\* ${label(name)}: [^]*?\\n}\\n`);
      if (!block.test(text)) throw new Error(`nes/game.c has no ${name} for the test to leave out.`);
      // dp:stop names the function of the original that has no C yet (docs/STANDARD.md#stops)
      text = text.replace(block, `// ${name}, at ${label(name)}, isn't ported yet. dp:stop ${label(name)}\nstatic void ${name}(void) {}\n`);
    }
    if (wrong) change(this.wrong);
    if (late) change(this.lateStep);
    return { 'src/main.c': text };
  },

  /** Proves every twin the version has, as a contributor does: what to give `npm run dp --`. */
  prove: version => ['twin', version, '--calls', '1000'],
};
