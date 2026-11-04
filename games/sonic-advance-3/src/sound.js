// Sonic Advance 3's sound: where its engine's tables are, and how it sets the engine up (the kit's sound/tables.js and
// sound/m4a.js). 0x080BA1F4, m4aSongNumStart, reads gMPlayTable at 0x080EB3F0 and gSongTable at 0x080EB420, so there are
// four players between them.

import { soundLayout as layoutAt } from '../../../kit/gba/sound/tables.js';

const MPLAY_TABLE = 0xEB3F0;
const PLAYERS = 4;
// DEFAULT_SOUND_MODE: six DirectSound channels, master volume 10, 10,512 Hz (m4a.js's soundMode)
const MODE = { channels: 6, volume: 10, rate: 10512 };

/** The layout the engine needs: both tables, how many songs there are, and the sound mode. */
export const soundLayout = rom => layoutAt(rom, MPLAY_TABLE, { players: PLAYERS, mode: MODE });
