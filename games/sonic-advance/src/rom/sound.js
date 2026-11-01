// Where the sound engine's tables are, and how Sonic Advance sets the engine up (the kit's sound/tables.js and
// sound/m4a.js).

import { findMusicPlayers as findPlayers, soundLayout as layoutAt } from '../../../../kit/gba/sound/tables.js';

const PLAYERS = 4;   // SA1 builds the engine with four music players: BGM and three for sound effects
// SA1's sound mode (DEFAULT_SOUND_MODE), which SA2 shares: 5 DirectSound channels, master volume 15, no reverb,
// 10512 Hz
const MODE = { channels: 5, volume: 15, rate: 10512 };

/** The music player table's file offset, or null. */
export const findMusicPlayers = rom => findPlayers(rom, PLAYERS);

/** The layout the engine needs: both tables, how many songs there are, and the sound mode. */
export const soundLayout = (rom, playerTable) => layoutAt(rom, playerTable, { players: PLAYERS, mode: MODE });
