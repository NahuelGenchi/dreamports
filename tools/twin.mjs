// npm run dp -- twin <version> [<function>] [--calls <n>] [--seed <n>] [--seconds <n>] and each console's own options:
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
//   --calls     how many calls of each function are compared: 2,000 unless said, and on the NES 5,000 of each kind
//   --seed      what the calls are made up from, 1 unless said
//   --seconds   how long a twin may take over one call before it's stopped: 2 unless said, and on the NES a fifth of one
//   --memories  takes real memories from the game's recordings, or those named, for the calls to start from, kept
//               in .dreamports/twin/ on this computer only: on the Game Boy Advance, the PlayStation and the
//               PlayStation 2 the console's memory as it was each time a function started in play, with what it was
//               given, and on the NES the work memory every so many frames
// and on the Game Boy Advance (gba/twin.mjs):
//   --frames    how long the original plays from power-on before the first call, 600 frames unless said
//   --addresses another file of names and addresses, shaped as the game's proof/addresses.json (match.mjs)
//   --replay    with a function: makes one call again and no other, the call a run found its twin different at, stopped
//               at or never back from, which the run kept in .dreamports/twin/ on this computer with the memory it
//               started from (lib/twin-calls.mjs). It says of that call what a run does, and proves nothing
// and on the PlayStation (ps1/twin.mjs) and the PlayStation 2 (ps2/twin.mjs) a call starts from the program as the
// console loads it, with no --frames, or with --memories from each function's memories as it starts in play, in the
// console's emulator, and --addresses is as on the Game Boy Advance; on the PlayStation 2 a function can also be named
// by its code map's key, as 120@SOUND.IRX, when it's in another program of the disc; on the Game Boy and the Game Boy
// Color each twin has a contract beside it too, with the processor's own registers, and several functions can be
// named (gbc/twin.mjs); on the Nintendo DS (nds/twin.mjs) a call starts from the programs as the console loads them,
// with no --frames and no --memories yet, and a function of the ARM7's program or of an overlay is named by its key,
// as 02380120@ARM7; and on the NES, where
// each twin has a contract beside it and several functions can be named (nes/twin.mjs):
//   --from      another folder of the game's C than its src/
//   --without   bytes of the work memory left out of what's compared
//
// The console is the game's. Each has its own way of calling one function of its original, in its folder here, which
// exports `twin(game, options)` and prints what it finds. `options` are the ones above, by their names, with the
// function as `function` and as the one name in `functions`. It answers how the check ends, 0, or 3 when a twin
// differed, stopped or never came back, or { same, tried }, how many twins were the same of those tried. A console
// with options of its own, as the NES has, exports `run(args)` too, which is given the command's words as they were
// typed, reads them itself and answers the same way. Either way the tool ends with 0, or with 3 when a twin isn't
// the same.

import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gameFolder } from './lib/paths.mjs';
import { readOriginal } from './lib/proof-files.mjs';
import { CONSOLES } from './consoles.mjs';

const SHARED = 'npm run dp -- twin <version> [<function>] [--calls <n>] [--seed <n>] [--seconds <n>]';
const USAGE = `Usage: ${SHARED}, and each console's own options (npm run dp -- help twin).`;
// the options of the consoles whose check takes them from here, which today is the Game Boy Advance's
const USAGE_HERE = `Usage: ${SHARED} [--frames <n>] [--addresses <file>] [--memories [<recording>...]], or npm run dp -- twin <version> <function> --replay`;
// the consoles the check knows, and where each one's is
const CHECKS = { gba: './gba/twin.mjs', nes: './nes/twin.mjs', gb: './gbc/twin.mjs', gbc: './gbc/twin.mjs', snes: './snes/twin.mjs', ps1: './ps1/twin.mjs', n64: './n64/twin.mjs', ps2: './ps2/twin.mjs', psp: './psp/twin.mjs', nds: './nds/twin.mjs', gamecube: './gamecube/twin.mjs' };
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
      if (!Number.isInteger(value) || value < (flag === '--calls' || flag === '--seconds' ? 1 : 0)) throw new Error(`${flag} needs a whole number. ${USAGE_HERE}`);
      options[NUMBERS[flag]] = value;
    } else if (flag === '--addresses') {
      if (!args[++i]) throw new Error(`--addresses needs a file. ${USAGE_HERE}`);
      options.addresses = resolvePath(args[i]);
    } else if (flag === '--memories') {
      // the recordings to take them from, every word up to the next option, or all of the game's
      options.memories = [];
      while (i + 1 < args.length && !args[i + 1].startsWith('--')) options.memories.push(args[++i]);
    } else if (flag === '--replay') {
      if (!check.REPLAYS) throw new Error(`twin makes one call again on the ${CONSOLES.gba.name} only, so far.`);
      options.replay = true;
    } else if (flag.startsWith('--')) throw new Error(`twin has no ${flag}. ${USAGE_HERE}`);
    else rest.push(flag);
  }
  const [game, what] = rest;
  if (!game || rest.length > 2) throw new Error(USAGE_HERE);
  // one call again is the call the run kept: how many calls, from which seed and memories were the run's to say
  const runs = ['calls', 'seed', 'frames', 'memories'].filter(name => options[name] !== undefined);
  if (options.replay && !what) throw new Error(`--replay makes one function's call again, so it needs the function: npm run dp -- twin ${game} <function> --replay.`);
  if (options.replay && runs.length) throw new Error(`--replay makes one call again, the one a run kept, so it takes no --${runs[0]}: npm run dp -- twin ${game} ${what} --replay.`);
  return ended(await check.twin(game, { ...options, function: what, functions: what ? [what] : [] }));
}
