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

/** The stack's task's own memory. */
struct Task_3006240 {
  /* 0x000 */ u8 unk0[0x168];
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

#endif
