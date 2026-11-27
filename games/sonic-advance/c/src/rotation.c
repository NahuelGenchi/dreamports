// A rotating background's registers, worked out from an angle and a size.
#include "console.h"
#include "core.h"

extern const s16 gSineTable[1280];
s32 Div(s32 num, s32 denom);

#define SIN(angle) (gSineTable[(angle)])
#define COS(angle) (gSineTable[(angle) + 256])
// the table's values, of 14 bits after the point, with 8
#define SIN_24_8(angle) (SIN(angle) >> 6)
#define COS_24_8(angle) (COS(angle) >> 6)

/** 0x08002E58, sa2__sub_8003EE4: a rotating background's registers for a picture turned by `angle`, of 1,024 to the
 *  turn, and `scaleX` and `scaleY` times its size, each of 256 to the whole: the point (`pivotX`, `pivotY`) of the
 *  picture shows at (`screenX`, `screenY`) of the screen. */
void sa2__sub_8003EE4(u16 angle, s16 scaleX, s16 scaleY, s16 pivotX, s16 pivotY, s16 screenX, s16 screenY, struct BgAffineReg *affine) {
  affine->pa = (COS_24_8(angle) * (s16)Div(0x10000, scaleX)) >> 8;
  affine->pb = (SIN_24_8(angle) * (s16)Div(0x10000, scaleX)) >> 8;
  affine->pc = ((-SIN(angle) >> 6) * (s16)Div(0x10000, scaleY)) >> 8;
  affine->pd = (COS_24_8(angle) * (s16)Div(0x10000, scaleY)) >> 8;

  screenX *= -1;
  screenY *= -1;
  {
    s32 across = (s16)affine->pa * screenX;
    s32 down = (s16)affine->pb * screenY;

    affine->x = (across + down) + pivotX * 256;
  }
  {
    s32 across = (s16)affine->pc * screenX;
    s32 down = (s16)affine->pd * screenY;

    affine->y = (across + down) + pivotY * 256;
  }
}
