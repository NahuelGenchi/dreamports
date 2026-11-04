// What plays the original of a console other than the Game Boy Advance: its libretro core, driven by host.c.

import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL } from '../lib/paths.mjs';
import { playReference, runReference } from '../lib/run-reference.mjs';
import { HOST, buildReference, coreFile } from './build.mjs';

export function libretroReference(machine) {
  const { core, screen: [width, height] } = machine;
  const options = Object.entries(core.options ?? {}).map(([key, value]) => `${key}=${value}`);
  // the console's own files a person keeps here, such as a BIOS from their own console, and a folder for what the core
  // saves, empty each time, as a recording starts from power-on with nothing saved
  const folders = () => {
    const system = join(LOCAL, 'libretro', 'system', machine.id), saves = join(LOCAL, 'libretro', 'saves', machine.id);
    rmSync(saves, { recursive: true, force: true });
    mkdirSync(saves, { recursive: true });
    mkdirSync(system, { recursive: true });
    return { DP_SYSTEM: system, DP_SAVES: saves };
  };
  return {
    KEY: machine.keys,
    ensureOriginal: log => buildReference(machine, log),
    async runOriginal({ copy, ...rest }) {
      const result = await runReference({
        ...rest, program: HOST, env: folders(), width, height, buttonBytes: 4,
        args: names => [coreFile(core), copy, String(rest.frames), names.buttons, '-', names.pictures, names.sound, names.sets, '-', String(width), String(height), ...options],
      });
      if (result.outside.rate !== machine.sound) throw new Error(`${machine.name}'s emulator mixes ${result.outside.rate} samples a second, and kit/consoles.js says ${machine.sound}.`);
      return result;
    },
    playOriginal: copy => playReference({ program: HOST, env: folders(), width, height, buttonBytes: 4, args: [coreFile(core), copy, 'live', String(width), String(height), ...options] }),
  };
}
