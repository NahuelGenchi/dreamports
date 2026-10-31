// Where the game keeps the player's ROMs in this browser (the kit's rom/store.js): the Sonic Advance ROM, and under
// their own keys the Sonic Rush ROM the optional Rush boost reads and the Sonic Advance 2 ROM the optional Boost
// Mode and tricks read.

import { createRomStore } from '../../../../kit/gba/rom/store.js';

export const roms = createRomStore('onsoku-advance');
export const SA1_ROM = 'current', RUSH_ROM = 'rush', SA2_ROM = 'sa2';
