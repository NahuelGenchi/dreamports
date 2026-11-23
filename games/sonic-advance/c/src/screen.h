// What goes to the screen each V-blank: the registers the game keeps, the sprites' list, and the tiles waiting.
#ifndef SA_SCREEN_H
#define SA_SCREEN_H
#include "console.h"

#define FLAGS_UPDATE_SPRITE_PALETTES 0x2
#define FLAGS_40 0x40
#define INTR_FLAG_VCOUNT 0x0004
#define DISPSTAT_VCOUNT 0x0004
#define DISPSTAT_VCOUNT_INTR 0x0020
#define BG_PLTT 0x05000000
#define OBJ_PLTT 0x05000200

#ifdef MATCHING
// the kit names these registers already, at the same offsets (kit/gba/c/gba.h)
enum { REG_DISPCNT = 0x000, REG_BG0CNT = 0x008, REG_BG0HOFS = 0x010, REG_BG2PA = 0x020, REG_WIN0H = 0x040, REG_BLDCNT = 0x050 };
#endif

/** Tiles to copy, as the queue's code reads them: its addresses as numbers. */
struct GraphicsData_Hack {
  u32 src;
  u32 dest;
  u16 size;
};

/** The V-blank's steps, in turn: each that isn't done by the V-blank's end takes up from there in the next. */
extern bool32 (*const sVblankFuncs[4])(void);
/** The line the VCOUNT interrupt comes at, when the game asks for one. */
extern u8 gUnknown_03002114;

void UpdateScreenDma(void);
void VBlankIntr(void);
bool32 ProcessVramGraphicsCopyQueue(void);
void ProcessOamBuffers(void);
void m4aSoundVSync(void);
void m4aMPlayAllStop(void);
void m4aSoundVSyncOff(void);
void SoftReset(u32 resetFlags);

#endif
