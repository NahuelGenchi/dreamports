// The screens of menus: their pictures, and their fade in and out through a window.
#include "ui.h"
#include "core.h"

#define DISPCNT_WIN0_ON 0x2000
#define DISPCNT_WIN1_ON 0x4000
enum { WINREG_WIN0H, WINREG_WIN1H, WINREG_WIN0V, WINREG_WIN1V, WINREG_WININ, WINREG_WINOUT };

/** 0x08052878, sub_80528AC: a picture of the menus: its place kept, its tiles, and for a background its map, on the
 *  list to copy to video memory, and its colours into the palette, each as its flags ask. */
void sub_80528AC(struct Strc_80528AC *param0) {
  struct Strc0 *strc0;
  struct GraphicsData *gfx;

  strc0 = &*(struct Strc0 *)((u8 *)TASK_DATA(gTask_03006240) + 0);
  strc0 = &strc0[param0->unk2B];

  strc0->unk4 = param0->unk0.unk4;
  strc0->unk8 = param0->unk0.unk8;
  strc0->unk9 = param0->unk0.unk9;
  strc0->unkA = param0->unk0.unkA;
  strc0->unkB = param0->unk0.unkB;

  if (param0->unk2A & 0x8) {
    if (param0->unk2A & 0x1) {
      gfx = UiGfxStackPop();
      if (gfx != NULL) {
        gfx->src = param0->tiles;
        gfx->dest = param0->vramC;
        gfx->size = param0->tilesSize;
        gVramGraphicsCopyQueue[gVramGraphicsCopyQueueIndex] = gfx;
        gVramGraphicsCopyQueueIndex = (gVramGraphicsCopyQueueIndex + 1) & 31;
      }
    }
    if (param0->unk2A & 0x4) {
      DMA3_COPY16(param0->palette, &gObjPalette[param0->unk28 * 16], param0->paletteSize);
      gFlags |= 0x2;
    }
    strc0->unk0 = ((u32)param0->vramC - 0x06010000) / 32;
  } else {
    void *vram = (param0->uiGfxID & 0x80) ? (u8 *)VRAM + ((gBgCntRegs[param0->unk29] & 0xC) << 12) + 0
                                          : (u8 *)VRAM + ((gBgCntRegs[param0->unk29] & 0xC) << 12) + 32;
    void *layout = ((u8 *)VRAM + ((gBgCntRegs[param0->unk29] & 0x1F00) << 3));

    if (param0->unk2A & 0x1) {
      gfx = UiGfxStackPop();
      if (gfx != NULL) {
        gfx->src = param0->tiles;
        gfx->dest = vram;
        gfx->size = param0->tilesSize;
        gVramGraphicsCopyQueue[gVramGraphicsCopyQueueIndex] = gfx;
        gVramGraphicsCopyQueueIndex = (gVramGraphicsCopyQueueIndex + 1) & 31;
      }
    }
    if (param0->unk2A & 0x10) {
      gfx = UiGfxStackPop();
      if (gfx != NULL) {
        gfx->src = param0->layout;
        gfx->dest = layout;
        gfx->size = param0->layoutSize;
        gVramGraphicsCopyQueue[gVramGraphicsCopyQueueIndex] = gfx;
        gVramGraphicsCopyQueueIndex = (gVramGraphicsCopyQueueIndex + 1) & 31;
      }
    }
    if (param0->unk2A & 0x4) {
      DMA3_COPY16(param0->palette, &gBgPalette[param0->unk28 * 16], param0->paletteSize);
      gFlags |= FLAGS_UPDATE_BACKGROUND_PALETTES;
    }
  }
}

/** 0x08054208, sub_805423C: a screen of menus a step further in its fade, through a window over the whole screen and
 *  the blend's brightness. Waits `unk0` frames first. Gives back TRUE once the fade is done. */
u8 sub_805423C(struct StrcUi_805423C *param0) {
  u16 r2;

  if (param0->unk2 != 0) gDispCnt |= DISPCNT_WIN1_ON;
  else gDispCnt |= DISPCNT_WIN0_ON;

  if (param0->unkA & 0x1) {
    gBldRegs.bldCnt = 0x3F3F;
    gBldRegs.bldAlpha = 16;
  } else if (param0->unkA & 0x10) {
    gBldRegs.bldCnt = 0x203F;
    gBldRegs.bldAlpha = 0;
  } else if ((u8)param0->unkA == 0) {
    gBldRegs.bldCnt = 0xF;
    gBldRegs.bldAlpha = 0;
  } else if (param0->unkA & 0x8) {
    gBldRegs.bldCnt = 0x3F3F;
  }

  if (param0->unk2 != 0) {
    gWinRegs[WINREG_WIN1H] = 240;
    gWinRegs[WINREG_WIN1V] = 160;
    gWinRegs[WINREG_WININ] |= 0x3F00;
    gWinRegs[WINREG_WINOUT] |= 0x1F;
  } else {
    gWinRegs[WINREG_WIN0H] = 240;
    gWinRegs[WINREG_WIN0V] = 160;
    gWinRegs[WINREG_WININ] |= 0x3F;
    gWinRegs[WINREG_WINOUT] |= 0x1F;
  }

  if (param0->unk4 & 0xC) gBldRegs.bldCnt |= 0x80;
  else gBldRegs.bldCnt |= 0xC0;

  if (param0->unk4 & 5) gBldRegs.bldY = param0->unk6 >> 8;
  else gBldRegs.bldY = 32 - (param0->unk6 >> 8);

  r2 = param0->unk6;
  if (gBldRegs.bldY >= 32) gBldRegs.bldY = 32;
  gBldRegs.bldY >>= 1;

  if (param0->unk0 != 0) {
    r2 = param0->unk8;
    if (param0->unk0 >= param0->unk8) param0->unk0 -= r2;
    else param0->unk0 = 0;
    return FALSE;
  } else {
    param0->unk6 = r2 + param0->unk8;
    if (param0->unk6 >= 0x2000) {
      param0->unk6 = 0x2000;
      return TRUE;
    }
    return FALSE;
  }
}

/** 0x08054370, sub_80543A4: a screen of menus' window and blend as sub_805423C sets them, with no step of the fade. */
void sub_80543A4(struct StrcUi_805423C *param0) {
  if (param0->unk2 != 0) gDispCnt |= DISPCNT_WIN1_ON;
  else gDispCnt |= DISPCNT_WIN0_ON;

  if (param0->unkA & 0x1) {
    gBldRegs.bldCnt = 0x3F3F;
    gBldRegs.bldAlpha = 16;
  } else if ((u8)param0->unkA == 0) {
    gBldRegs.bldCnt = 0xF;
    gBldRegs.bldAlpha = 0;
  }

  if (param0->unk2 != 0) {
    gWinRegs[WINREG_WIN1H] = 240;
    gWinRegs[WINREG_WIN1V] = 160;
    gWinRegs[WINREG_WININ] |= 0x3F00;
    gWinRegs[WINREG_WINOUT] |= 0x1F;
  } else {
    gWinRegs[WINREG_WIN0H] = 240;
    gWinRegs[WINREG_WIN0V] = 160;
    gWinRegs[WINREG_WININ] |= 0x3F;
    gWinRegs[WINREG_WINOUT] |= 0x1F;
  }

  if (param0->unk4 & 0xC) gBldRegs.bldCnt |= 0x80;
  else gBldRegs.bldCnt |= 0xC0;

  if (param0->unk4 & 5) gBldRegs.bldY = param0->unk6 >> 8;
  else gBldRegs.bldY = 32 - (param0->unk6 >> 8);

  if (gBldRegs.bldY >= 32) gBldRegs.bldY = 32;
  gBldRegs.bldY >>= 1;
}
