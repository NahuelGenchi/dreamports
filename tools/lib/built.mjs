// A game as players get it: a copy of its folder and its kit, with its scripts bundled as the site's build bundles them
// (src/lib/bundle.mjs), in .dreamports/built/, which a server puts over the repository's files (server.mjs). prove and
// test:game play this, so they play what players get, and play and capture the files as they are.

import { cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { bundleGame } from '../../src/lib/bundle.mjs';
import { kitOf } from '../../src/lib/notes.mjs';
import { LOCAL, REPO, gameFolder } from './paths.mjs';

/** Makes a game's built copy and resolves to its folder, laid out like the repository. */
export async function buildGame(game) {
  const built = join(LOCAL, 'built', game), kit = kitOf(REPO, game);
  rmSync(built, { recursive: true, force: true });
  cpSync(gameFolder(game), join(built, 'games', game), { recursive: true });
  if (kit) cpSync(join(REPO, 'kit', kit), join(built, 'kit', kit), { recursive: true });
  await bundleGame(join(built, 'games', game), built, kit);
  return built;
}
