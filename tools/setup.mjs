// npm run dp -- setup: builds the reference emulator, mGBA, on this computer. prove builds it by itself the first
// time it needs it, so this only gets it ready beforehand.

import { build, isBuilt, MGBA_VERSION } from './gba/build.mjs';

export async function run() {
  if (isBuilt()) {
    console.log(`The reference emulator, mGBA ${MGBA_VERSION}, is already built.`);
    return;
  }
  build();
  console.log(`Ready: the original runs in mGBA ${MGBA_VERSION}, on this computer only.`);
}
