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
// Recordings played at the same time run in one process, so each run's link has its own number after the process's.
function plainlyNamed(copy, run) {
  const extension = extname(copy).toLowerCase(), link = join(FROM, `copy-${process.pid}-${run}${extension}`);
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

let runs = 0;

export function libretroReference(machine) {
  const { core, screen: [width, height] } = machine;
  const options = Object.entries(core.options ?? {}).map(([key, value]) => `${key}=${value}`);
  // the console's own files a person keeps here, such as a BIOS from their own console, and a folder for what the core
  // saves, empty each time, as a recording starts from power-on with nothing saved, and its own for each run, as emptying
  // one shared folder pulled it from under a core another recording was loading. Where a game chooses its sound's rate,
  // the one the tools hear it at. { env, path, done }: the copy's link and the saves go when `done` is called
  const forRun = copy => {
    const run = ++runs, named = plainlyNamed(copy, run);
    const system = join(LOCAL, 'libretro', 'system', machine.id), saves = join(LOCAL, 'libretro', 'saves', machine.id, `${process.pid}-${run}`);
    rmSync(saves, { recursive: true, force: true });
    mkdirSync(saves, { recursive: true });
    mkdirSync(system, { recursive: true });
    const env = { DP_SYSTEM: system, DP_SAVES: saves, ...(core.gameChoosesRate && { DP_SOUND_RATE: String(machine.sound) }) };
    return { env, path: named.path, done: () => { named.done(); rmSync(saves, { recursive: true, force: true }); } };
  };
  return {
    KEY: machine.keys,
    ensureOriginal: log => buildReference(machine, log),
    async runOriginal({ copy, ...rest }) {
      const named = forRun(copy);
      let result;
      try {
        result = await runReference({
          ...rest, program: HOST, env: named.env, width, height, buttonBytes: 4,
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
    // what runs the route finder's search on a copy, in the folder `spec` is in (lib/explore.h), with `done` to call once it has ended
    searchOriginal({ copy, spec }) {
      const named = forRun(copy);
      return { program: HOST, args: [coreFile(core), named.path === copy ? copy : join(FROM, named.path), 'route', spec, ...options], env: named.env, buttonBytes: 4, done: named.done };
    },
    playOriginal(copy) {
      const named = forRun(copy);
      const live = playReference({ program: HOST, cwd: FROM, env: named.env, width, height, buttonBytes: 4, sized: true, args: [coreFile(core), named.path, 'live', String(width), String(height), ...options] });
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
