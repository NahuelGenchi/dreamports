// What the screen shows of a background line by line: each line's scroll, copied to the background's registers at the
// end of the line before it (gHBlankCopyTarget), which is how the logos open and close as through a blind.
#include "core.h"

// the first background's scroll registers, which each line's two values go to, one background further on for each
#define REG_BG0HOFS_BYTES ((u8 *)0x04000010)

/** 0x080067A0, sub_8007858: the lines from `minY` to `maxY` show the background from x and a y that goes back a line
 *  each line, so they all show its line y. */
void sub_8007858(u8 bg, u8 minY, u8 maxY, u16 x, u16 y) {
  u16 *cursor;

  gFlags |= FLAGS_EXECUTE_HBLANK_COPY;
  gHBlankCopyTarget = (void *)&REG_BG0HOFS_BYTES[bg * 4];
  gHBlankCopySize = 4;
  cursor = &((u16 *)gBgOffsetsHBlankPrimary)[minY * 2];
  y = (y - minY) & 0x1FF;
  x &= 0x1FF;
  while (minY < maxY) {
    *cursor = x;
    cursor++;
    *cursor = y--;
    cursor++;
    minY++;
  }
}

/** 0x0800681C, sub_80078D4: the lines from `minY` to `maxY` all scrolled by the same x and y. */
void sub_80078D4(u8 bg, u8 minY, u8 maxY, u16 x, u16 y) {
  s32 fillVal;

  gFlags |= FLAGS_EXECUTE_HBLANK_COPY;
  gHBlankCopyTarget = (void *)&REG_BG0HOFS_BYTES[bg * 4];
  gHBlankCopySize = 4;
  if (minY < maxY) {
    fillVal = (x %= 512u) | ((y % 512u) << 16);
    DMA3_FILL32(fillVal, &((u16 *)gBgOffsetsHBlankPrimary)[minY * 2], (maxY - minY) * 4);
  }
}

/** 0x080068A0, sub_8007958: the lines from `minY` to `maxY` pushed left and right in turn, by `width` and then
 *  `-(width + step)`, and so on, with `step` turning each line too. */
void sub_8007958(u8 bg, u8 minY, u8 maxY, s16 width, s8 step, u16 x, u16 y) {
  u16 *cursor;

  gFlags |= FLAGS_EXECUTE_HBLANK_COPY;
  gHBlankCopyTarget = (void *)&REG_BG0HOFS_BYTES[bg * 4];
  gHBlankCopySize = 4;
  cursor = &((u16 *)gBgOffsetsHBlankPrimary)[minY * 2];
  while (minY < maxY) {
    *cursor = (width + x) & 0x1FF;
    cursor++;
    *cursor = y;
    cursor++;
    width = -(width + step);
    step = -step;
    minY++;
  }
}
