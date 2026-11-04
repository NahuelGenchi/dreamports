// Sonic Advance 2's sound: where its engine's tables are, and how it sets the engine up (the kit's sound/tables.js and
// sound/m4a.js). 0x0809532C, m4aSongNumStart, reads gMPlayTable at 0x08AD4F1C and gSongTable at 0x08AD4F4C, so there are
// four players between them.

import { soundLayout as layoutAt } from '../../../kit/gba/sound/tables.js';

const MPLAY_TABLE = 0xAD4F1C;
const PLAYERS = 4;
// DEFAULT_SOUND_MODE: five DirectSound channels, master volume 15, 10,512 Hz (m4a.js's soundMode)
const MODE = { channels: 5, volume: 15, rate: 10512 };

/** The layout the engine needs: both tables, how many songs there are, and the sound mode. */
export const soundLayout = rom => layoutAt(rom, MPLAY_TABLE, { players: PLAYERS, mode: MODE });
