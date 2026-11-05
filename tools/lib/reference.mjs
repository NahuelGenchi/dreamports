// What plays the original of a game on any console, with one way of using it: { machine, KEY, ensureOriginal, runOriginal, playOriginal }.

import { consoleOf } from '../consoles.mjs';
import { forGame } from './screens.mjs';

/** What plays the original a game's proof/original.json names, with `machine` as that game has its console. */
export async function referenceOf(original) {
  const machine = forGame(consoleOf(original.console), original);
  if (!machine.core) return { machine, ...(await import('../gba/original.mjs')) };
  const { libretroReference } = await import('../libretro/reference.mjs');
  return { machine, ...libretroReference(machine) };
}
