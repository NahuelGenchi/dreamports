// What the screen shows of a background line by line: each line's scroll, copied to the background's registers at the
// end of the line before it (gHBlankCopyTarget), which is how the logos open and close as through a blind.
#include "core.h"
#include "bg_triangles.h"

// the windows' horizontal registers, which a line's window edges go to: only ever named by where the console has them,
// as the H-blank's copy reaches them there (gHBlankCopyTarget), in the Dreamport too
#define REG_WIN0H (*(vu16 *)0x04000040)
#define REG_WIN1H (*(vu16 *)0x04000042)
typedef u8 int_vcount;
#define DISPLAY_WIDTH 240
#define MIN(a, b) (((a) < (b)) ? (a) : (b))
#define MAX(a, b) (((a) > (b)) ? (a) : (b))
typedef u16 winreg_t;
#define ABS(aValue) ((aValue) >= 0 ? (aValue) : -(aValue))
#define IncCursor(cur, offset) (int_vcount *)(((u8 *)(cur)) + (offset))
#ifdef MATCHING
typedef unsigned int uintptr_t;
void *memcpy(void *, const void *, unsigned int);
void *memset(void *, int, unsigned int);
extern const s16 sTriangleStep[2];
#define MATCH_BREAK asm("")
#else
#define MATCH_BREAK
#endif

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

/** 0x08005170, sub_8006228: one edge of a window, line by line, along a straight line from (param1, param2) to (param3, param4), the other edge at param5. As SAT-R's decompilation writes it. */
void sub_8006228(u8 bg, u8 param1, u8 param2, u8 param3, u8 param4, u8 param5)
{
    int_vcount *cursor;
    s16 r1, r2, r4, r5, r7, r8;

    gFlags |= FLAGS_EXECUTE_HBLANK_COPY;

    if (bg >= 2) {
        gHBlankCopySize = sizeof(REG_WIN0H) * 2;

        if (bg & 1) {
            cursor = (int_vcount *)gBgOffsetsHBlankPrimary + sizeof(REG_WIN0H);
            gHBlankCopyTarget = (void *)&REG_WIN0H;
        } else {
            cursor = (int_vcount *)gBgOffsetsHBlankPrimary;
            gHBlankCopyTarget = (void *)&REG_WIN0H;
        }
    } else {
        volatile winreg_t *reg;
        gHBlankCopySize = sizeof(REG_WIN0H);
        cursor = (int_vcount *)gBgOffsetsHBlankPrimary;

        // Required for match
        reg = &REG_WIN1H;
        if (bg & 1) {
            gHBlankCopyTarget = (void *)reg;
        } else {
            gHBlankCopyTarget = (void *)&REG_WIN0H;
        }
    }

    r1 = (param3 - param1);
    r4 = (param4 - param2);
    r5 = (param4 - param2);

    r2 = r1;
    r8 = ABS(r2) * 2;
    r7 = ABS(r4) * 2;

    cursor = IncCursor(cursor, param2 * gHBlankCopySize);

    if (ABS(r2) > ABS(r4)) {
        r4 = -r2;

        if (r2 > 0) {
            cursor[1] = param5;

            for (r2 = 0; r2 < ABS(r1); r2++) {
                param1++;
                r4 += r7;

                if (r4 >= 0) {
                    r4 = ((r4 << 16) >> 16) - r8;
                    cursor[0] = param1;
                    cursor = IncCursor(cursor, gHBlankCopySize);
                    cursor[1] = param5;
                }
            }
            cursor[0] = param1;
        } else {
            cursor[0] = param1;
            cursor++;

            for (r2 = 0; r2 < ABS(r1); r2++) {
                param1--;
                r4 += r7;

                if (r4 >= 0) {
                    r4 -= r8;
                    *cursor = param5;
                    cursor = ({
                        uintptr_t r0 = (gHBlankCopySize);
                        r0 += (uintptr_t)cursor;
                        (void *)(r0 - 1);
                    });
                    *cursor = param1;
#ifdef MATCHING
                    asm("" : "=r"(cursor));
#endif
                    cursor++;
                }
            }
            *cursor = param5;
        }

    } else {
        r4 = -r4;
        if (r2 > 0) {
            for (r2 = 0; r2 < ABS(r5); r2++) {
                *cursor = param1 + 1;
                cursor++;
                *cursor = param5;
                cursor = ({
                    uintptr_t r0 = (gHBlankCopySize);
                    r0 += (uintptr_t)cursor;
                    (void *)(r0 - 1);
                });

                r4 += r8;

                if (r4 >= 0) {
                    param1++;
                    r4 -= r7;
                }
            }
        } else {
            for (r2 = 0; r2 < ABS(r5); r2++) {
                *cursor = param1 + 1;
                cursor++;
                *cursor = param5;

                cursor = ({
                    uintptr_t r0 = (gHBlankCopySize);
                    r0 += (uintptr_t)cursor;
                    (void *)(r0 - 1);
                });

                r4 += r8;

                if (r4 >= 0) {
                    param1--;
                    r4 -= r7;
                }
            }
        }
    }
}


/** 0x080053F0, sub_80064A8: the same, with the line drawn the other way. As SAT-R's decompilation writes it. */
void sub_80064A8(u8 bg, u8 param1, u8 param2, u8 param3, u8 param4, u8 param5)
{
    int_vcount *cursor;
    s16 r1, r2, r4, r5, r7, r8;

    gFlags |= FLAGS_EXECUTE_HBLANK_COPY;

    if (bg >= 2) {
        gHBlankCopySize = sizeof(REG_WIN0H) * 2;

        if (bg & 1) {
            cursor = (int_vcount *)gBgOffsetsHBlankPrimary + sizeof(winreg_t);
            gHBlankCopyTarget = (void *)&REG_WIN0H;
        } else {
            cursor = (int_vcount *)gBgOffsetsHBlankPrimary;
            gHBlankCopyTarget = (void *)&REG_WIN0H;
        }
    } else {
        volatile winreg_t *reg;
        gHBlankCopySize = sizeof(REG_WIN0H);
        cursor = (int_vcount *)gBgOffsetsHBlankPrimary;

        // Required for match
        reg = &REG_WIN1H;
        if (bg & 1) {
            gHBlankCopyTarget = (void *)reg;
        } else {
            gHBlankCopyTarget = (void *)&REG_WIN0H;
        }
    }

    r1 = (param3 - param1);
    r4 = (param4 - param2);
    r5 = (param4 - param2);

    r2 = r1;
    r8 = ABS(r2) * 2;
    r7 = ABS(r4) * 2;

    cursor = IncCursor(cursor, param2 * gHBlankCopySize);

    if (ABS(r2) > ABS(r4)) {
        r4 = -r2;

        if (r2 > 0) {
            cursor[1] = param1;

            for (r2 = 0; r2 < ABS(r1); r2++) {
                param1++;
                r4 += r7;

                if (r4 >= 0) {
                    r4 -= r8;
                    cursor[0] = param5;
                    cursor = IncCursor(cursor, gHBlankCopySize);
                    cursor[1] = param1;
                }
            }
            cursor[0] = param5;
        } else {
            cursor[0] = param5;
            cursor++;

            for (r2 = 0; r2 < ABS(r1); r2++) {
                param1--;
                r4 += r7;

                if (r4 >= 0) {
                    r4 -= r8;
                    *cursor = param1;
                    cursor = ({
                        uintptr_t r0 = (gHBlankCopySize);
                        r0 += (uintptr_t)cursor;
                        (void *)(r0 - 1);
                    });
                    *cursor = param5;
#ifdef MATCHING
                    asm("" : "=r"(cursor));
#endif
                    cursor++;
                }
            }
            *cursor = param1;
        }

    } else {
        r4 = -r4;
        if (r2 > 0) {
            for (r2 = 0; r2 < ABS(r5); r2++) {
                *cursor = param5;
                cursor++;
                *cursor = param1;
                cursor = ({
                    uintptr_t r0 = (gHBlankCopySize);
                    r0 += (uintptr_t)cursor;
                    (void *)(r0 - 1);
                });

                r4 += r8;

                if (r4 >= 0) {
                    param1++;
                    r4 -= r7;
                }
            }
        } else {
            for (r2 = 0; r2 < ABS(r5); r2++) {
                *cursor = param5;
                cursor++;
                *cursor = param1;

                cursor = ({
                    uintptr_t r0 = (gHBlankCopySize);
                    r0 += (uintptr_t)cursor;
                    (void *)(r0 - 1);
                });

                r4 += r8;

                if (r4 >= 0) {
                    param1--;
                    r4 -= r7;
                }
            }
        }
    }
}

/** 0x08006194, sub_800724C: both edges of a window, line by line, along the sides of a triangle whose corners `arg1` holds. As SAT-R's decompilation writes it. */
void sub_800724C(u8 bg, TriParam1 *arg1)
{
    s16 sp0[2];
#ifdef MATCHING
    // agbcc copies sp4's start from a constant of the cartridge's, which match places only by a name, so the
    // matching build writes the copies the compiler makes
    s16 sp4[2];
    s16 sp8[2];
    s16 spC[2];
    s16 sp10[2];
#else
    s16 sp4[2] = { 1, 1 };
    s16 sp8[2];
    s16 spC[2] = { 0 };
    s16 sp10[2] = { 0 };
#endif
    int_vcount sp14[2];
    int_vcount *cursor;
    int_vcount minVal;
    int_vcount maxVal;

#ifdef MATCHING
    memcpy(sp4, sTriangleStep, sizeof(sp4));
    memset(spC, 0, sizeof(spC));
    memset(sp10, 0, sizeof(sp10));
#endif
    gFlags |= FLAGS_EXECUTE_HBLANK_COPY;

    if (bg >= 2) {
        gHBlankCopySize = sizeof(REG_WIN0H) * 2;

        if (bg & 1) {
            cursor = &((int_vcount *)gBgOffsetsHBlankPrimary)[2];
            gHBlankCopyTarget = (void *)&REG_WIN0H;
        } else {
            cursor = &((int_vcount *)gBgOffsetsHBlankPrimary)[0];
            gHBlankCopyTarget = (void *)&REG_WIN0H;
        }
    } else {
        gHBlankCopySize = sizeof(REG_WIN0H);
        cursor = &((int_vcount *)gBgOffsetsHBlankPrimary)[0];

        if (bg & 1) {
            gHBlankCopyTarget = (void *)&REG_WIN1H;
        } else {
            gHBlankCopyTarget = (void *)&REG_WIN0H;
        }
    }

    minVal = MIN(arg1->unk1, arg1->unk5);
    maxVal = MAX(arg1->unk1, arg1->unk5);

    cursor = IncCursor(cursor, minVal * gHBlankCopySize);
    sp0[0] = (arg1->unk2 - arg1->unk0);
    sp4[0] = (arg1->unk3 - arg1->unk1);
    spC[0] = (ABS(sp0[0]) * 2);
    sp10[0] = (ABS(sp4[0]) * 2);
    sp0[1] = (arg1->unk6 - arg1->unk4);
    sp4[1] = (arg1->unk7 - arg1->unk5);

    spC[1] = (ABS(sp0[1]) * 2);
    sp10[1] = (ABS(sp4[1]) * 2);
    sp14[0] = arg1->unk0;
    sp14[1] = arg1->unk4;
    sp8[0] = -sp4[0];
    sp8[1] = -sp4[1];

    if ((minVal != maxVal) && (arg1->unk1 < arg1->unk5)) {
        while (minVal < maxVal) {
            cursor[0] = DISPLAY_WIDTH;
            cursor[1] = sp14[0];
            sp8[0] += spC[0];

            while (sp8[0] >= 0) {
                if (sp0[0] > 0) {
                    sp14[0]++;
                    sp8[0] -= sp10[0];
                } else {
                    sp14[0]--;

                    sp8[0] -= sp10[0];
                    if (sp8[0] >= 0) {
                        cursor[1] = sp14[0];
                    }
                }
                MATCH_BREAK;
            }

            cursor = IncCursor(cursor, gHBlankCopySize);
            minVal++;
        }
    } else {
        while (minVal < maxVal) {
            cursor[0] = sp14[1];
            cursor[1] = 0;
            sp8[1] += spC[1];
            if (sp8[1] >= 0) {
                while (sp8[1] >= 0) {
                    if (sp0[1] > 0) {
                        sp14[1]++;

                        sp8[1] -= sp10[1];
                        if (sp8[1] >= 0) {
                            cursor[0] = (sp14[1] + 1);
                        }
                    } else {
                        sp14[1]--;
                        sp8[1] -= sp10[1];
                    }

                    MATCH_BREAK;
                }
            }

            cursor = IncCursor(cursor, gHBlankCopySize);
            minVal++;
        }
    }

    maxVal = MIN(arg1->unk3, arg1->unk7);

    while (minVal < maxVal) {
        cursor[0] = sp14[1];
        cursor[1] = sp14[0];
        sp8[0] += spC[0];
        sp8[1] += spC[1];

        while (sp8[0] >= 0) {
            if (sp0[0] > 0) {
                sp14[0]++;
                sp8[0] -= sp10[0];
            } else {
                sp14[0]--;

                sp8[0] -= sp10[0];
                if (sp8[0] >= 0) {
                    cursor[1] = sp14[0];
                }
            }
            MATCH_BREAK;
        }

        while (sp8[1] >= 0) {
            if (sp0[1] > 0) {
                sp14[1]++;

                sp8[1] -= sp10[1];
                if (sp8[1] >= 0) {
                    cursor[0] = (sp14[1] + 1);
                }
            } else {
                sp14[1]--;
                sp8[1] -= sp10[1];
            }
            MATCH_BREAK;
        }

        cursor = IncCursor(cursor, gHBlankCopySize);
        minVal++;
    }
}
