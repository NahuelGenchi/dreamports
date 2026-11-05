// What plays the original of a console other than the Game Boy Advance: its libretro core, driven by host.c.

import { linkSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { LOCAL } from '../lib/paths.mjs';
import { playReference, runReference } from '../lib/run-reference.mjs';
import { checkSizes } from '../lib/screens.mjs';
import { HOST, buildReference, coreFile } from './build.mjs';

const FROM = join(LOCAL, 'tmp');

// The copy under a name that says nothing, in the folder the core runs from, as a core can read things into a name, and two
// people with the same copy would see different games: FCEUmm takes "(E)" or "(a)" anywhere in the path for a European copy.
// A disc's .cue keeps its own, as it names its tracks from where it is. { path, done }, `done` being what removes it.
function plainlyNamed(copy) {
  const extension = extname(copy).toLowerCase(), link = join(FROM, `copy-${process.pid}${extension}`);
  if (extension !== '.cue') {
    mkdirSync(FROM, { recursive: true });
    rmSync(link, { force: true });
    // on Windows only some can make a link of the first kind
    for (const make of [symlinkSync, linkSync]) {
      try {
        make(resolve(copy), link);
        return { path: basename(link), done: () => rmSync(link, { force: true }) };
      } catch {
        // the other kind, or at worst the name it has
      }
    }
  }
  return { path: copy, done() {} };
}

export function libretroReference(machine) {
  const { core, screen: [width, height] } = machine;
  const options = Object.entries(core.options ?? {}).map(([key, value]) => `${key}=${value}`);
  // the console's own files a person keeps here, such as a BIOS from their own console, and a folder for what the core
  // saves, empty each time, as a recording starts from power-on with nothing saved. Where a game chooses its sound's rate,
  // the one the tools hear it at
  const hostEnv = () => {
    const system = join(LOCAL, 'libretro', 'system', machine.id), saves = join(LOCAL, 'libretro', 'saves', machine.id);
    rmSync(saves, { recursive: true, force: true });
    mkdirSync(saves, { recursive: true });
    mkdirSync(system, { recursive: true });
    return { DP_SYSTEM: system, DP_SAVES: saves, ...(core.gameChoosesRate && { DP_SOUND_RATE: String(machine.sound) }) };
  };
  return {
    KEY: machine.keys,
    ensureOriginal: log => buildReference(machine, log),
    async runOriginal({ copy, ...rest }) {
      const named = plainlyNamed(copy);
      let result;
      try {
        result = await runReference({
          ...rest, program: HOST, env: hostEnv(), width, height, buttonBytes: 4,
          args: names => [coreFile(core), named.path, String(rest.frames), names.buttons, '-', names.pictures, names.sound, names.sets, '-', String(width), String(height), ...options],
        });
      } finally {
        named.done();
      }
      if (result.outside.rate !== machine.sound) throw new Error(`${machine.name}'s emulator mixes ${result.outside.rate} samples a second, and kit/consoles.js says ${machine.sound}.`);
      // a copy made for another region's consoles runs at another speed, and a frame's length is all prove knows of that
      const speed = machine.frame[1] / machine.frame[0];
      if (Math.abs(result.outside.fps / speed - 1) > 0.005) throw new Error(`${machine.name}'s emulator runs this copy at ${result.outside.fps} frames a second, and kit/consoles.js says ${speed.toFixed(2)}: a copy made for another region's consoles, or a wrong number there.`);
      return result;
    },
    playOriginal(copy) {
      const named = plainlyNamed(copy);
      const live = playReference({ program: HOST, cwd: FROM, env: hostEnv(), width, height, buttonBytes: 4, sized: true, args: [coreFile(core), named.path, 'live', String(width), String(height), ...options] });
      let frame = 0;
      return {
        ...live,
        // said at once, before anyone plays for nothing: a picture larger than the game says would lose its edges. One that
        // fits is cut to its own size for the card (capture.mjs). Like prove, this looks past a console's first frame
        async frame(buttons) {
          const shown = await live.frame(buttons);
          if (frame && (shown.size[0] > width || shown.size[1] > height)) checkSizes([[frame, ...shown.size]], machine, [frame]);
          frame++;
          return shown;
        },
        end() { live.end(); named.done(); },
      };
    },
  };
}
