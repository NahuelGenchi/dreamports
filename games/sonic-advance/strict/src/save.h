// What the game keeps on the cartridge.
#ifndef SAVE_H
#define SAVE_H
#include "console.h"

// a sector of what's kept, in bytes, with its sum in its last word
#define SAVE_SECTOR_SIZE 0x430

u32 SaveSectorSum(void *sector);

#endif
