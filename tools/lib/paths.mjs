// Where the tools find things: the repository, a game's folder and its proof files, and the folder the tools keep
// on the contributor's computer, which never goes in a commit.

import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** The repository's folder. */
export const REPO = fileURLToPath(new URL('../../', import.meta.url));

/** What the tools keep on this computer only (.gitignore leaves it out): where the copies are, the reference
 *  emulator, the browsers' profiles and every result with pictures in it. */
export const LOCAL = join(REPO, '.dreamports');

/** A game's folder, games/<game>/. */
export const gameFolder = game => join(REPO, 'games', game);

/** A game's proof files: which copy of the original they use, its code map, the recordings and the progress. */
export const proofFolder = game => join(REPO, 'games', game, 'proof');

/** Where prove leaves one recording's results: its report, pictures and clip. */
export const resultFolder = (game, recording) => join(LOCAL, 'results', game, recording);
