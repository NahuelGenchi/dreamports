// The line-window functions: a window's edges, line by line, along straight lines.
#ifndef SA_BG_TRIANGLES_H
#define SA_BG_TRIANGLES_H
#include "console.h"

// a triangle's three corners, x and y, as the line-window function takes them
typedef struct {
  u8 unk0;
  u8 unk1;
  u8 unk2;
  u8 unk3;
  u8 unk4;
  u8 unk5;
  u8 unk6;
  u8 unk7;
} TriParam1;

void sub_8006228(u8 bg, u8 param1, u8 param2, u8 param3, u8 param4, u8 param5);
void sub_80064A8(u8 bg, u8 param1, u8 param2, u8 param3, u8 param4, u8 param5);
void sub_800724C(u8 bg, TriParam1 *arg1);

#endif
