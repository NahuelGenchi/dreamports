// Recognizes a Sonic Advance ROM from its cartridge header and checksum, with the kit's checks
// (kit/gba/rom/identify.js) and the versions this game knows (versions.js).

import { identify as identifyGame, namesGame } from '../../../../kit/gba/rom/identify.js';
import { KNOWN_VERSIONS, GAME_TITLE, GAME_CODES } from './versions.js';

export { RomError, readHeader, sha1Hex } from '../../../../kit/gba/rom/identify.js';

/** Whether the header of `buffer` names Sonic Advance, before the full check: which game a file is. */
export const isSonicAdvance = buffer => namesGame(buffer, GAME_TITLE);

/**
 * Checks that this is a Sonic Advance ROM and matches it against the known versions.
 * Throws RomError with a message meant for the player when it is not.
 */
export const identify = rom => identifyGame(rom, { name: 'Sonic Advance', title: GAME_TITLE, codes: GAME_CODES, versions: KNOWN_VERSIONS });
