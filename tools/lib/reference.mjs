// What plays the original of a game on any console, with one way of using it: { machine, KEY, ensureOriginal, runOriginal, playOriginal }.

import { consoleOf } from '../consoles.mjs';

export async function referenceOf(id) {
  const machine = consoleOf(id);
  if (!machine.core) return { machine, ...(await import('../gba/original.mjs')) };
  const { libretroReference } = await import('../libretro/reference.mjs');
  return { machine, ...libretroReference(machine) };
}
