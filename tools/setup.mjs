// npm run dp -- setup: builds on this computer what the tools build for themselves: the reference emulator, mGBA, and
// the Game Boy Advance's compiler, agbcc, which match builds a game's C with (gba/agbcc.mjs). prove and match each
// build what they need by themselves the first time they need it, so this only gets it ready beforehand.

import { buildWith, isBuilt, MGBA_VERSION, withBuildTools } from './gba/build.mjs';
import { AGBCC_COMMIT, buildCompilers, COMPILERS, isCompilerBuilt } from './gba/agbcc.mjs';

export async function run() {
  const compilers = Object.keys(COMPILERS).filter(name => !isCompilerBuilt(name));
  const emulator = isBuilt();
  if (emulator) console.log(`The reference emulator, mGBA ${MGBA_VERSION}, is already built.`);
  if (!compilers.length) console.log(`The Game Boy Advance's compiler, agbcc at ${AGBCC_COMMIT.slice(0, 7)}, is already built.`);
  if (emulator && !compilers.length) return;
  withBuildTools(console.log, tools => {
    if (!emulator) buildWith(console.log, tools);
    buildCompilers(compilers, console.log, tools);
  });
  if (!emulator) console.log(`Ready: the original runs in mGBA ${MGBA_VERSION}, on this computer only.`);
  if (compilers.length) console.log(`Ready: match builds a game's C with agbcc at ${AGBCC_COMMIT.slice(0, 7)}, on this computer only.`);
}
