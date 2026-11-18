// What goes to the screen each V-blank.
#include "screen.h"
#include "core.h"
#include "dma.h"

/** UpdateScreenDma, 0x08000980: in the V-blank, the registers the game keeps go to the console's, with the palettes
 *  that changed, the line callbacks and copy the game asked for, and the sprites' list. Then the V-blank's callbacks,
 *  and as many of the V-blank's steps as the blank lines leave time for, from the one the last V-blank stopped at. */
void UpdateScreenDma(void) {
  u8 i, j = 0;

  REG_WRITE16(REG_DISPCNT, gDispCnt);
  DMA_COPY32(3, gBgCntRegs, 0x04000000 + REG_BG0CNT, sizeof(gBgCntRegs));

  if (gFlags & FLAGS_UPDATE_BACKGROUND_PALETTES) {
    DMA_COPY32(3, gBgPalette, BG_PLTT, 0x200);
    gFlags ^= FLAGS_UPDATE_BACKGROUND_PALETTES;
  }
  if (gFlags & FLAGS_UPDATE_SPRITE_PALETTES) {
    DMA_COPY32(3, gObjPalette, OBJ_PLTT, 0x200);
    gFlags ^= FLAGS_UPDATE_SPRITE_PALETTES;
  }

  DMA_COPY32(3, gWinRegs, 0x04000000 + REG_WIN0H, sizeof(gWinRegs));
  DMA_COPY16(3, &gBldRegs, 0x04000000 + REG_BLDCNT, 6);
  DMA_COPY16(3, gBgScrollRegs, 0x04000000 + REG_BG0HOFS, sizeof(gBgScrollRegs));
  DMA_COPY32(3, &gBgAffineRegs, 0x04000000 + REG_BG2PA, sizeof(gBgAffineRegs));

  if (gFlags & FLAGS_EXECUTE_HBLANK_CALLBACKS) {
    REG_OR16(REG_IE, INTR_FLAG_HBLANK);
    DMA_FILL32(3, 0, gHBlankIntrs, sizeof(gHBlankIntrs));
    if (gNumHBlankCallbacks != 0) DMA_COPY32(3, gHBlankCallbacks, gHBlankIntrs, gNumHBlankCallbacks * sizeof(HBlankIntrFunc));
    gNumHBlankIntrs = gNumHBlankCallbacks;
  } else {
    REG_AND16(REG_IE, ~INTR_FLAG_HBLANK);
    gNumHBlankIntrs = 0;
  }

  if (gFlags & FLAGS_EXECUTE_HBLANK_COPY) DMA_COPY16(3, gBgOffsetsHBlankPrimary, gHBlankCopyTarget, gHBlankCopySize);

  if (sLastCalledVblankFuncId == VBLANK_FUNC_ID_NONE) {
    ProcessOamBuffers();
    DMA_COPY16(3, gOamBuffer + 32 * 0, OAM + 0x100 * 0, OAM_SIZE / 4);
    DMA_COPY16(3, gOamBuffer + 32 * 1, OAM + 0x100 * 1, OAM_SIZE / 4);
    DMA_COPY16(3, gOamBuffer + 32 * 2, OAM + 0x100 * 2, OAM_SIZE / 4);
    DMA_COPY16(3, gOamBuffer + 32 * 3, OAM + 0x100 * 3, OAM_SIZE / 4);
  }

  for (i = 0; i < gNumVBlankIntrs; i++) CALL(gVBlankIntrs[i])();

  if (gFlags & FLAGS_EXECUTE_VBLANK_CALLBACKS) {
    DMA_FILL32(3, 0, gVBlankIntrs, sizeof(gVBlankIntrs));
    if (gNumVBlankCallbacks != 0) DMA_COPY32(3, gVBlankCallbacks, gVBlankIntrs, gNumVBlankCallbacks * sizeof(VBlankFunc));
    gNumVBlankIntrs = gNumVBlankCallbacks;
  } else {
    gNumVBlankIntrs = 0;
  }

  j = sLastCalledVblankFuncId;
  if (j == VBLANK_FUNC_ID_NONE) j = 0;
  sLastCalledVblankFuncId = VBLANK_FUNC_ID_NONE;

  for (; j < 4; j++) {
    if (CALL(sVblankFuncs[j])() == 0) {
      sLastCalledVblankFuncId = j;
      break;
    }
  }
}

/** VBlankIntr, 0x08000F44: the V-blank's interrupt. The sound's frame, the line copy for the next frame started on DMA
 *  channel 0, the VCOUNT interrupt as the game asked, and Start, Select, B and A held together start the game again
 *  from the BIOS. */
void VBlankIntr(void) {
  u16 keys;

  DMA_STOP(0);
  m4aSoundVSync();
  REG_INTR_CHECK |= 1;
  gExecSoundMain = TRUE;

  if (gFlagsPreVBlank & FLAGS_EXECUTE_HBLANK_COPY) {
    REG_OR16(REG_IE, INTR_FLAG_HBLANK);
    DMA_WAIT(0);
    DMA_COPY16(0, gBgOffsetsHBlankPrimary, gHBlankCopyTarget, gHBlankCopySize);
    DMA_SET(0, gBgOffsetsHBlankPrimary + gHBlankCopySize, gHBlankCopyTarget, ((0x8000 | 0x2000 | 0x0200 | 0x0060) << 16) | (gHBlankCopySize >> 1));
  } else if (gHBlankCopyTarget) {
    REG_AND16(REG_IE, ~INTR_FLAG_HBLANK);
    gHBlankCopyTarget = NULL;
  }

  if (gFlagsPreVBlank & FLAGS_40) {
    REG_OR16(REG_DISPSTAT, DISPSTAT_VCOUNT_INTR);
    REG_AND16(REG_DISPSTAT, 0xff);
    REG_OR16(REG_DISPSTAT, gUnknown_03002114 << 8);
    REG_AND16(REG_DISPSTAT, ~DISPSTAT_VCOUNT);
    REG_OR16(REG_DISPSTAT, DISPSTAT_VCOUNT_INTR);
    REG_OR16(REG_IE, INTR_FLAG_VCOUNT);
  } else {
    REG_AND16(REG_DISPSTAT, ~DISPSTAT_VCOUNT);
    REG_AND16(REG_DISPSTAT, ~DISPSTAT_VCOUNT_INTR);
    REG_AND16(REG_IE, ~INTR_FLAG_VCOUNT);
  }

  if (!(gFlagsPreVBlank & FLAGS_8000)) {
    keys = ~REG_READ16(REG_KEYINPUT) & (START_BUTTON | SELECT_BUTTON | B_BUTTON | A_BUTTON);
    if (keys == (START_BUTTON | SELECT_BUTTON | B_BUTTON | A_BUTTON)) {
      gFlags |= FLAGS_8000;
      REG_WRITE16(REG_IE, 0);
      REG_WRITE16(REG_IME, 0);
      REG_WRITE16(REG_DISPSTAT, 0);
      m4aMPlayAllStop();
      m4aSoundVSyncOff();
      gFlags &= ~FLAGS_EXECUTE_HBLANK_COPY;
      DMA_STOP(0);
      DMA_STOP(1);
      DMA_STOP(2);
      DMA_STOP(3);
      gInput = keys;
      SoftReset(0x20);
    }
  }

  gFrameCount++;
  REG_WRITE16(REG_IF, INTR_FLAG_VBLANK);
}

/** ProcessVramGraphicsCopyQueue, 0x0800116C: the tiles waiting go to video memory, 1 KB at a time, while the blank
 *  lines last. Gives back TRUE when none is left waiting. */
bool32 ProcessVramGraphicsCopyQueue(void) {
  u32 offset;
  struct GraphicsData_Hack *graphics;

  while (gVramGraphicsCopyCursor != gVramGraphicsCopyQueueIndex) {
    graphics = (void *)gVramGraphicsCopyQueue[gVramGraphicsCopyCursor];
    if (graphics->size != 0) {
      for (offset = 0; graphics->size > 0; offset += 1024) {
        if (graphics->size > 1024) {
          DMA_COPY16(3, graphics->src + offset, graphics->dest + offset, 1024);
          graphics->size -= 1024;
        } else {
          DMA_COPY16(3, graphics->src + offset, graphics->dest + offset, graphics->size);
          graphics->size = 0;
        }
      }
    }
    gVramGraphicsCopyCursor = (gVramGraphicsCopyCursor + 1) & 31;
    if (!(REG_READ16(REG_DISPSTAT) & DISPSTAT_VBLANK)) return FALSE;
  }
  return TRUE;
}
