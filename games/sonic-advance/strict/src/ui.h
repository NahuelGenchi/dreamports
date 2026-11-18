// The screens of menus' graphics: a stack of tiles to copy, kept in a task of its own, and a list of what to draw.
#ifndef UI_H
#define UI_H
#include "console.h"
#include "sprite.h"
#include "task.h"

/** One of the stack's entries: the next, and tiles to copy. */
struct GfxSubstruct {
  /* 0x00 */ struct GfxSubstruct *next;
  /* 0x04 */ struct GraphicsData graphics;
};

/** Where a picture of the menus is, as sub_80528AC keeps it. */
struct Strc0 {
  /* 0x00 */ s32 unk0;
  /* 0x04 */ s32 unk4;
  /* 0x08 */ u8 unk8;
  /* 0x09 */ u8 unk9;
  /* 0x0A */ u8 unkA;
  /* 0x0B */ u8 unkB;
};

/** A screen's fade in and out, as sub_805423C steps it. */
struct StrcUi_805423C {
  /* 0x00 */ s16 unk0;
  /* 0x02 */ s16 unk2;
  /* 0x04 */ u16 unk4;
  /* 0x06 */ s16 unk6;
  /* 0x08 */ s16 unk8;
  /* 0x0A */ u8 unkA;
};

/** A picture for a screen of menus, as sub_80528AC loads it. */
struct Strc_80528AC {
  /* 0x00 */ struct Strc0 unk0;
  /* 0x0C */ u8 *vramC;
  /* 0x10 */ const u8 *layout;
  /* 0x14 */ const u8 *tiles;
  /* 0x18 */ s32 tilesSize;
  /* 0x1C */ s32 layoutSize;
  /* 0x20 */ const u16 *palette;
  /* 0x24 */ u32 paletteSize;
  /* 0x28 */ u8 unk28;
  /* 0x29 */ u8 unk29;
  /* 0x2A */ u8 unk2A;
  /* 0x2B */ u8 unk2B;
  /* 0x2C */ u8 uiGfxID;
};

/** The stack's task's own memory. */
struct Task_3006240 {
  /* 0x000 */ struct Strc0 unk0[10];
  /* 0x078 */ u8 filler78[0xF0];
  /* 0x168 */ struct GfxSubstruct *first;
  /* 0x16C */ struct GfxSubstruct gfxList[16];
  /* 0x26C */ u8 filler26C[0xE0];
};

/** One of the free list's entries. */
struct Strc_3006250 {
  /* 0x00 */ struct Strc_3006250 *next;
  /* 0x04 */ u8 unk4[0x20];
};

extern struct Task *gTask_03006240;
extern struct Strc_3006250 gUnknown_03006250[10];
extern struct Strc_3006250 *gUnknown_030063F0;
extern void *gUnknown_030063C0;

void sub_80535FC(void);
u16 UiGfxStackInit(void);
struct GraphicsData *UiGfxStackPop(void);
void Task_80536D4(void);
void TaskDestructor_80536D8(struct Task *t);
u8 sub_805423C(struct StrcUi_805423C *fade);
void sub_80528AC(struct Strc_80528AC *gfx);
void sub_80543A4(struct StrcUi_805423C *fade);

#endif
