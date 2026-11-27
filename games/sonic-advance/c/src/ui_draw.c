// Drawing menu text and tile strips as OAM sprites, from the table kept in gTask_03006240.
#include "ui_draw.h"

extern void *iwram_end;
struct OamData *OamMalloc(u8 order);

/** 0x08052F44, sub_8052F78: draws a row or grid of UI tiles as semi-transparent OAM sprites, stepping horizontally by
 *  the slot's tile width and vertically by its height. */
void sub_8052F78(const char *text, struct GameOverB *box) {
  struct Strc0 *slot;
  struct OamData base;
  struct OamData *oamBuf;
  struct OamData *oam;
  s32 stepX;
  s32 stepY;
  s32 a;
  s32 col;
  s32 row;

  slot = &*(struct Strc0 *)((u8 *)TASK_DATA(gTask_03006240) + 0);
  slot = &slot[box->unk10];
  stepX = slot->unkA * 8;
  stepY = slot->unkB * 8;

  oamBuf = &base;
  a = (slot->unk9 << 14) + (u8)box->unkC + 0x400;
  oamBuf->attr0 = a;
  base.attr1 = (slot->unk8 << 14) + (box->qUnkA & 0x1FF);
  base.attr2 = (box->unk12 << 12) | (slot->unk0 & 0x3FF);

  if (box->unk16 != 0) {
    for (col = 0; col < box->unkE; col++) {
      oam = OamMalloc(box->unk8 >> 3);
      if (iwram_end == oam) break;

      oam->attr0 = base.attr0;
      oam->attr1 = base.attr1;
      base.attr1 += stepX;
      oam->attr2 = ((u8)text[col] - 0x20) * slot->unk4 + base.attr2;
    }
  } else {
    for (row = 0; row < box->unk14; row++) {
      base.attr1 = (slot->unk8 << 14) + (box->qUnkA & 0x1FF);
      for (col = ((-box->qUnkA) & 0x1FF) >> 7; col < box->unkE; col++) {
        oam = OamMalloc(box->unk8 >> 3);
        if (iwram_end == oam) break;

        oam->attr0 = base.attr0;
        oam->attr1 = base.attr1;
        base.attr1 += stepX;
        oam->attr2 = ((u8)text[col] - 0x20) * slot->unk4 + base.attr2;
      }
      base.attr0 += stepY;
    }
  }
}

/** 0x080531E8, sub_805321C: draws a row or grid of UI tiles as opaque OAM sprites, advancing the OAM order by column. */
void sub_805321C(const u8 *text, struct GameOverB *box) {
  struct Strc0 *slot;
  struct OamData base;
  struct OamData *oamBuf;
  struct OamData *oam;
  s32 stepX;
  s32 stepY;
  s32 a;
  s32 col;
  s32 row;

  slot = &*(struct Strc0 *)((u8 *)TASK_DATA(gTask_03006240) + 0);
  slot = &slot[box->unk10];
  stepX = slot->unkA * 8;
  stepY = slot->unkB * 8;

  oamBuf = &base;
  a = (slot->unk9 << 14) + (u8)box->unkC;
  oamBuf->attr0 = a;
  base.attr1 = (slot->unk8 << 14) + (box->qUnkA & 0x1FF);
  base.attr2 = (box->unk12 << 12) | (slot->unk0 & 0x3FF);

  if (box->unk16 != 0) {
    for (col = 0; col < box->unkE; col++) {
      oam = OamMalloc((box->unk8 + col) >> 3);
      if (iwram_end == oam) break;

      oam->attr0 = base.attr0;
      oam->attr1 = base.attr1;
      base.attr1 += stepX;
      oam->attr2 = (text[col] - 0x20) * slot->unk4 + base.attr2;
    }
  } else {
    for (row = 0; row < box->unk14; row++) {
      base.attr1 = (slot->unk8 << 14) + (box->qUnkA & 0x1FF);
      for (col = ((-box->qUnkA) & 0x1FF) >> 7; col < box->unkE; col++) {
        oam = OamMalloc((box->unk8 + col) >> 3);
        if (iwram_end == oam) break;

        oam->attr0 = base.attr0;
        oam->attr1 = base.attr1;
        base.attr1 += stepX;
        oam->attr2 = (text[col] - 0x20) * slot->unk4 + base.attr2;
      }
      base.attr0 += stepY;
    }
  }
}

/** 0x08053594, sub_80535C8: updates the tile stride and sprite shape of one graphics slot in gTask_03006240. */
void sub_80535C8(const struct Strc0 *src, u8 slot) {
  struct Task_3006240 *taskData = TASK_DATA(gTask_03006240);
  struct Strc0 *dst = &taskData->unk0[slot];

  dst->unk4 = src->unk4;
  dst->unk8 = src->unk8;
  dst->unk9 = src->unk9;
  dst->unkA = src->unkA;
  dst->unkB = src->unkB;
}
