// What goes to the screen each V-blank.
#include "screen.h"
#include "time.h"
#include "core.h"
#include "dma.h"

/** UpdateScreenDma, 0x08000980: in the V-blank, the registers the game keeps go to the console's, with the palettes
 *  that changed, the line callbacks and copy the game asked for, and the sprites' list. Then the V-blank's callbacks,
 *  and as many of the V-blank's steps as the blank lines leave time for, from the one the last V-blank stopped at. */
void UpdateScreenDma(void) {
  u8 i, j = 0;
#ifndef MATCHING
  // (timed on the path the screens before the title take: the sprites' palette to go up and the background's not, no
  // H-blank work, and the V-blank's steps from the first, each one done)
  u32 flags = gFlags;
  int timed = !(flags & FLAGS_UPDATE_BACKGROUND_PALETTES) && (flags & FLAGS_UPDATE_SPRITE_PALETTES)
              && !(flags & (FLAGS_EXECUTE_HBLANK_CALLBACKS | FLAGS_EXECUTE_HBLANK_COPY | FLAGS_EXECUTE_VBLANK_CALLBACKS))
              && sLastCalledVblankFuncId == VBLANK_FUNC_ID_NONE && gNumVBlankIntrs == 0;
#endif

  REG_WRITE16(REG_DISPCNT, gDispCnt);
  DMA_COPY32(3, gBgCntRegs, 0x04000000 + REG_BG0CNT, sizeof(gBgCntRegs));
#ifndef MATCHING
  if (timed) TIME(0x08000980, 0x080009AE, 0x080009C5, IW, 0x04000000, DMA3, IW);
#endif

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
#ifndef MATCHING
  if (timed) TIME(0x080009C4, 0x08000A22, 0x08000AD1, IW, DMA3, IW, IW, DMA3, DMA3, DMA3, DMA3, IW);
#endif

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
#ifndef MATCHING
  if (timed) {
    TIME(0x08000AD0, 0x08000AE6, 0x08000B07, 0x04000200, 0x04000200, IW, IW);
    TIME(0x08000B06, 0x08000B10, 0x08004895, IW);
  }
#endif

  if (sLastCalledVblankFuncId == VBLANK_FUNC_ID_NONE) {
    ProcessOamBuffers();
    DMA_COPY16(3, gOamBuffer + 32 * 0, OAM + 0x100 * 0, OAM_SIZE / 4);
    DMA_COPY16(3, gOamBuffer + 32 * 1, OAM + 0x100 * 1, OAM_SIZE / 4);
    DMA_COPY16(3, gOamBuffer + 32 * 2, OAM + 0x100 * 2, OAM_SIZE / 4);
    DMA_COPY16(3, gOamBuffer + 32 * 3, OAM + 0x100 * 3, OAM_SIZE / 4);
  }
#ifndef MATCHING
  if (timed) {
    TIME(0x08000B12, 0x08000B5C, 0x08000B79, DMA3, DMA3, DMA3, DMA3, IW);
    TIME(0x08000B78, 0x08000B82, 0x08000C09, IW);
  }
#endif

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

#ifdef MATCHING
  for (; j < 4; j++) {
    if (CALL(sVblankFuncs[j])() == 0) {
      sLastCalledVblankFuncId = j;
      break;
    }
  }
#else
  // each step is called through the compiler's `bx r0`; one that isn't done ends the timing, its way out not written
  if (timed) TIME(0x08000C08, 0x08000C1C, 0x08000C33, IW, IW, IW);
  for (; j < 4; j++) {
    if (timed) {
      TIME(0x08000C32, 0x08000C3E, 0x08099845, ROM);
      TIME(0x08099844, 0x08099844, (u32)sVblankFuncs[j]);
    }
    if (CALL(sVblankFuncs[j])() == 0) {
      if (timed) TIME(0x08000C40, 0x08000C42, 0x08000C45);
      timed = 0;
      sLastCalledVblankFuncId = j;
      break;
    }
    if (timed) {
      TIME(0x08000C40, 0x08000C42, 0x08000C2D);
      TIME(0x08000C2C, 0x08000C30, 0x08000C33);
    }
  }
  if (timed) {
    TIME(0x08000C32, 0x08000C34, 0x08000C49);
    TIME(0x08000C48, 0x08000C4E, BACK);
  }
#endif
}

/** VBlankIntr, 0x08000F44: the V-blank's interrupt. The sound's frame, the line copy for the next frame started on DMA
 *  channel 0, the VCOUNT interrupt as the game asked, and Start, Select, B and A held together start the game again
 *  from the BIOS. */
void VBlankIntr(void) {
  u16 keys;

  DMA_STOP(0);
  TIME(0x08000F44, 0x08000F5C, 0x08097105, 0x040000BA, 0x040000BA, 0x040000BA, 0x040000BA, 0x040000BA);
  m4aSoundVSync();
  REG_INTR_CHECK |= 1;
  gExecSoundMain = TRUE;

  // (timed where no line copy is asked for and the VCOUNT interrupt isn't, as on the screens before the title)
  if (gFlagsPreVBlank & FLAGS_EXECUTE_HBLANK_COPY) {
    REG_OR16(REG_IE, INTR_FLAG_HBLANK);
    DMA_WAIT(0);
    DMA_COPY16(0, gBgOffsetsHBlankPrimary, gHBlankCopyTarget, gHBlankCopySize);
    DMA_SET(0, gBgOffsetsHBlankPrimary + gHBlankCopySize, gHBlankCopyTarget, ((0x8000 | 0x2000 | 0x0200 | 0x0060) << 16) | (gHBlankCopySize >> 1));
  } else if (gHBlankCopyTarget) {
    TIME(0x08000F5E, 0x08000F76, 0x08000FFD, IW, IW, IW, IW);
    TIME(0x08000FFC, 0x08001004, 0x08001007, IW);
    REG_AND16(REG_IE, ~INTR_FLAG_HBLANK);
    gHBlankCopyTarget = NULL;
    TIME(0x08001006, 0x08001010, 0x08001013, 0x04000200, 0x04000200, IW);
  } else {
    TIME(0x08000F5E, 0x08000F76, 0x08000FFD, IW, IW, IW, IW);
    TIME(0x08000FFC, 0x08001004, 0x08001013, IW);
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
    TIME(0x08001012, 0x0800101A, 0x0800106D, IW);
    TIME(0x0800106C, 0x08001086, 0x08001089, 0x04000004, 0x04000004, 0x04000004, 0x04000004, 0x04000200, 0x04000200);
  }

  if (!(gFlagsPreVBlank & FLAGS_8000)) {
    keys = ~REG_READ16(REG_KEYINPUT) & (START_BUTTON | SELECT_BUTTON | B_BUTTON | A_BUTTON);
    if (keys != (START_BUTTON | SELECT_BUTTON | B_BUTTON | A_BUTTON)) TIME(0x08001088, 0x080010A0, 0x08001123, IW, 0x04000130);
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
  } else {
    TIME(0x08001088, 0x08001092, 0x08001123, IW);
  }

  gFrameCount++;
  REG_WRITE16(REG_IF, INTR_FLAG_VBLANK);
  // back to the BIOS, which called the game's interrupt code
  TIME(0x08001122, 0x08001134, 0x00000194, IW, IW, 0x04000202);
}

/** ProcessVramGraphicsCopyQueue, 0x0800116C: the tiles waiting go to video memory, 1 KB at a time, while the blank
 *  lines last. Gives back TRUE when none is left waiting. */
bool32 ProcessVramGraphicsCopyQueue(void) {
  u32 offset;
  struct GraphicsData_Hack *graphics;

#ifndef MATCHING
  // (timed for tiles of 1 KB or less, one copy each, as the screens before the title queue them; the display's status
  // is looked at at its load's time)
  int first = 1, timed;
#endif

  while (gVramGraphicsCopyCursor != gVramGraphicsCopyQueueIndex) {
    graphics = (void *)gVramGraphicsCopyQueue[gVramGraphicsCopyCursor];
#ifndef MATCHING
    timed = graphics->size != 0 && graphics->size <= 1024;
    if (timed && first) TIME(0x0800116C, 0x0800119A, 0x080011D1, IW, IW, IW, IW, IW);
    else if (timed) TIME(0x08001182, 0x0800119A, 0x080011D1, IW, IW, IW);
    first = 0;
#endif
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
#ifdef MATCHING
    if (!(REG_READ16(REG_DISPSTAT) & DISPSTAT_VBLANK)) return FALSE;
#else
    if (timed) TIME(0x080011D0, 0x08001200, 0x08001203, IW, 0x040000D4, IW, 0x040000D8, IW, 0x040000DC, 0x040000DC, IW, IW, IW, IW);
    if (!(REG_READ16(REG_DISPSTAT) & DISPSTAT_VBLANK)) {
      if (timed) {
        TIME(0x08001202, 0x0800120A, 0x0800120D, 0x04000004);
        TIME(0x0800120C, 0x0800120E, 0x0800121D);
        TIME(0x0800121C, 0x08001220, BACK);
      }
      return FALSE;
    }
    if (timed) {
      TIME(0x08001202, 0x0800120A, 0x08001215, 0x04000004);
      if (gVramGraphicsCopyCursor != gVramGraphicsCopyQueueIndex) TIME(0x08001214, 0x08001218, 0x08001183, IW);
      else TIME(0x08001214, 0x08001220, BACK, IW);
    }
#endif
  }
  return TRUE;
}
