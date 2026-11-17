// npm run dp -- twin <version> [<function>] [--calls <n>] [--seed <n>] [--frames <n>] [--seconds <n>] [--addresses <file>]:
// the function check. It runs one function of the original in the reference emulator and its twin, built as a
// Dreamport, from the same memory, thousands of times, with what the function reads changed between calls, and
// compares what each leaves in the console's memory, its work memory and its video memory, and what each gave back.
// It's the proof a twin has when no compiler gives the original's bytes back (docs/STANDARD.md): `match` is the
// other. <version> is a game's version in C, such as sonic-advance/c. With a function, an address or a name, it
// checks that one's twin, and with none every twin the version has, a file at a time.
//
// It says of each function `The same memory`, or what kept it from that: for one that differs, the call, with what it
// was given and what was changed for it, the first address that differs and what each side left there. The same
// seed makes the same calls again, so a difference can be had again after a fix.
//
//   --calls     how many calls of each function are compared, 2,000 unless said
//   --seed      what the calls are made up from, 1 unless said
//   --frames    how long the original plays from power-on before the first call, 600 frames unless said
//   --seconds   how long a twin may take over one call before it's stopped, 2 unless said
//   --addresses another file of names and addresses, shaped as the game's proof/addresses.json (match.mjs)
//
// Each console has its own way of calling one function of its original, in its folder here, which exports
// `twin(game, options)` and prints what it finds. `options` are the ones above, by their names, with the function as
// `function` and as the one name in `functions`. It answers how the check ends, 0, or 3 when a twin differed, stopped
// or never came back, or { same, tried }, how many twins were the same of those tried. A console with options of its
// own exports `run(args)` too, and is given the command's words as they were typed.

import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gameFolder } from './lib/paths.mjs';
import { readOriginal } from './lib/proof-files.mjs';
import { CONSOLES } from './consoles.mjs';

const USAGE = 'Usage: npm run dp -- twin <version> [<function>] [--calls <n>] [--seed <n>] [--frames <n>] [--seconds <n>] [--addresses <file>]';
// the consoles the check knows, and where each one's is
const CHECKS = { gba: './gba/twin.mjs', nes: './nes/twin.mjs' };
const NUMBERS = { '--calls': 'calls', '--seed': 'seed', '--frames': 'frames', '--seconds': 'seconds' };

// how a console's check ended, as a number: its own, or 3 when not every twin tried was the same
const ended = answer => (typeof answer === 'number' ? answer : answer && answer.same !== answer.tried ? 3 : 0);

export async function run(args) {
  // the console is the game's, and the game is the first word that names one: an option's value can come before it
  const words = args.filter(arg => !arg.startsWith('--'));
  const first = words.find(word => existsSync(gameFolder(word.split('/')[0]))) ?? words[0];
  if (!first) throw new Error(USAGE);
  const known = Object.keys(CHECKS).filter(id => existsSync(fileURLToPath(new URL(CHECKS[id], import.meta.url))));
  const { console: id } = readOriginal(first);
  if (!known.includes(id)) {
    throw new Error(`twin calls the functions of ${known.map(each => `the ${CONSOLES[each].name}`).join(' and ')}, and no other console's yet (docs/CONSOLES.md).`);
  }
  const check = await import(CHECKS[id]);
  if (check.run) return ended(await check.run(args));
  const rest = [], options = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (NUMBERS[flag]) {
      const value = Number(args[++i]);
      if (!Number.isInteger(value) || value < (flag === '--calls' || flag === '--seconds' ? 1 : 0)) throw new Error(`${flag} needs a whole number. ${USAGE}`);
      options[NUMBERS[flag]] = value;
    } else if (flag === '--addresses') {
      if (!args[++i]) throw new Error(`--addresses needs a file. ${USAGE}`);
      options.addresses = resolvePath(args[i]);
    } else if (flag.startsWith('--')) throw new Error(`twin has no ${flag}. ${USAGE}`);
    else rest.push(flag);
  }
  const [game, what] = rest;
  if (!game || rest.length > 2) throw new Error(USAGE);
  return ended(await check.twin(game, { ...options, function: what, functions: what ? [what] : [] }));
}
