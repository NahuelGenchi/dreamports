// Sonic Battle's sound: where its engine's tables are, and how it sets the engine up (the kit's
// sound/tables.js and sound/m4a.js). The decompilation's src/m4a.c is the guide: m4aSoundInit (0x08048FB8)
// clears the mixer with eight DirectSound channels and master volume 15, sets the engine's fourth rate at
// start-up, then m4aSoundMode(0x9300E800) keeps the eight channels and sets the master volume to 14, with no
// reverb. That fourth rate is 10,512 Hz here, 176 samples a frame, as the proof measures: the decompilation's
// own table makes it 13,379, which played every sound about a quarter too fast.
//
// gMPlayTable (0x08BF71FC) holds six music players, and gSongTable (0x08BF7244) the game's 833 songs: six
// records of twelve bytes between the two tables, as the decompilation's tools/m4a_map.py reads them from the
// USA copy. The table's entries point into IWRAM (0x03000000), where the engine keeps its players' state, so
// the kit's findMusicPlayers, which looks for EWRAM pointers, can't find it here: the offset is known.

import { soundLayout as layoutAt } from '../../../kit/gba/sound/tables.js';

// the music player table's file offset in the USA copy, and the players it holds
const MPLAY_TABLE = 0xBF71FC;
const PLAYERS = 6;

// eight DirectSound channels, master volume 14, 10,512 Hz (m4a.js's soundMode)
const MODE = { channels: 8, volume: 14, rate: 10512 };

/** The layout the engine needs: both tables, how many songs there are, and the sound mode. CgbSound reads SOUNDCNT_X
 *  at 0x08049DFE, as the Sonic Advance games' and Crash's don't. */
export const soundLayout = rom => layoutAt(rom, MPLAY_TABLE, { players: PLAYERS, mode: MODE, voicesEndOnChip: true, soundMainAt: 84800 });
