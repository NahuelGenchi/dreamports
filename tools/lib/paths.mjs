// Where the tools find things: the repository, a game's folder and its proof files, and the folder the tools keep
// on the contributor's computer, which never goes in a commit.

import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { versionOf } from '../../src/lib/languages.mjs';

/** The repository's folder. */
export const REPO = fileURLToPath(new URL('../../', import.meta.url));

/** What the tools keep on this computer only (.gitignore leaves it out): where the copies are, the reference
 *  emulator, the browsers' profiles and every result with pictures in it. */
export const LOCAL = join(REPO, '.dreamports');

/** A game's folder, games/<game>/, or a version's in another language, such as games/sonic-battle/c/ for 'sonic-battle/c'. */
export const gameFolder = game => join(REPO, 'games', game);

/** A game's or a version's own proof files, its progress and its port map, in its folder's proof/ (src/lib/languages.mjs). */
export const proofFolder = game => join(REPO, 'games', game, 'proof');

/** The proof files every version of a game shares: which copy of the original they use, its code map, its parts and
 *  the recordings, in the game's own proof/. */
export const sharedProofFolder = game => join(REPO, 'games', versionOf(game).game, 'proof');

/** Where prove leaves one recording's results: its report, pictures and clip. */
export const resultFolder = (game, recording) => join(LOCAL, 'results', game, recording);
