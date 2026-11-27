// Drawing menu text and tile rows as sprites from gTask_03006240's table of graphics slots.
#ifndef UI_DRAW_H
#define UI_DRAW_H
#include "ui.h"

/** Where a menu text or tile row sits on screen, which slot in gTask_03006240 it uses, and its OAM order and palette. */
struct GameOverB {
  /* 0x00 */ u8 filler0[8];
  /* 0x08 */ u16 unk8;
  /* 0x0A */ s16 qUnkA;
  /* 0x0C */ s16 unkC;
  /* 0x0E */ s16 unkE;
  /* 0x10 */ u16 unk10;
  /* 0x12 */ u16 unk12;
  /* 0x14 */ u16 unk14;
  /* 0x16 */ u8 unk16;
};

void sub_8052F78(const char *text, struct GameOverB *box);
void sub_805321C(const u8 *text, struct GameOverB *box);
void sub_80535C8(const struct Strc0 *src, u8 slot);

#endif
