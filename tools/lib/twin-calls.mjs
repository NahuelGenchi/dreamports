// The call of the function check kept on this computer to be made again by itself (#2069). A run of
// `npm run dp -- twin` can find a twin different at one call out of tens of thousands, half an hour in, and looking at
// that call again used to mean the whole run again. So when a function's twin differs, stops or never comes back, the
// run keeps what that one call started from: the console's memory as the call began, what it was given, what was
// changed for it, the stack it started on and the registers it started with. `twin <version> <function> --replay`
// then makes that call alone, in the original and in the twin as it's written now.
//
// It's kept in .dreamports/twin/<version>/calls/, never in the repository: the memory is the game's own, from the
// contributor's copy. One call is kept for each function, the last a run found, as <address>.json and <address>.bin.
// A replay is one call, so it proves nothing and writes no proof (proofs.mjs) and no run (twin-runs.mjs).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL } from './paths.mjs';

/** Where a version's calls are kept. */
export const callsFolder = version => join(LOCAL, 'twin', ...version.split('/'), 'calls');

/** Keeps a function's call in `folder`: `key` names the function, as its address in the code map, and `call` is what
 *  the call started from, with the memory it began with as `start`, a Buffer, and anything else that JSON keeps. */
export function keepCall(folder, key, { start, ...call }) {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, `${key}.bin`), start);
  writeFileSync(join(folder, `${key}.json`), `${JSON.stringify(call)}\n`);
}

/** The call kept of a function in `folder`, as keepCall was given it, or null when there's none that can be read. */
export function readCall(folder, key) {
  const file = join(folder, `${key}.json`), image = join(folder, `${key}.bin`);
  if (!existsSync(file) || !existsSync(image)) return null;
  try {
    const call = JSON.parse(readFileSync(file, 'utf8'));
    return call && typeof call === 'object' && Array.isArray(call.args) && Array.isArray(call.changed) ? { ...call, start: readFileSync(image) } : null;
  } catch {
    return null;
  }
}
