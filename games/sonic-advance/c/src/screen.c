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

  // (each of the original's runs is timed after the work it does, on whichever path the game's flags take. The V-blank's
  // callbacks are timed as far as their calls, and their own work as far as their twins time it)
  REG_WRITE16(REG_DISPCNT, gDispCnt);
  DMA_COPY32(3, gBgCntRegs, 0x04000000 + REG_BG0CNT, sizeof(gBgCntRegs));
  TIME(0x08000980, 0x080009AE, (gFlags & FLAGS_UPDATE_BACKGROUND_PALETTES) ? 0x080009B1 : 0x080009C5, IW, 0x04000000, DMA3, IW);

  if (gFlags & FLAGS_UPDATE_BACKGROUND_PALETTES) {
    DMA_COPY32(3, gBgPalette, BG_PLTT, 0x200);
    gFlags ^= FLAGS_UPDATE_BACKGROUND_PALETTES;
    TIME(0x080009B0, 0x080009C2, 0x080009C5, DMA3, IW);
  }
  TIME(0x080009C4, 0x080009CC, (gFlags & FLAGS_UPDATE_SPRITE_PALETTES) ? 0x080009CF : 0x080009E3, IW);
  if (gFlags & FLAGS_UPDATE_SPRITE_PALETTES) {
    DMA_COPY32(3, gObjPalette, OBJ_PLTT, 0x200);
    gFlags ^= FLAGS_UPDATE_SPRITE_PALETTES;
    TIME(0x080009CE, 0x080009E0, 0x080009E3, DMA3, IW, IW);
  }

  DMA_COPY32(3, gWinRegs, 0x04000000 + REG_WIN0H, sizeof(gWinRegs));
  DMA_COPY16(3, &gBldRegs, 0x04000000 + REG_BLDCNT, 6);
  DMA_COPY16(3, gBgScrollRegs, 0x04000000 + REG_BG0HOFS, sizeof(gBgScrollRegs));
  DMA_COPY32(3, &gBgAffineRegs, 0x04000000 + REG_BG2PA, sizeof(gBgAffineRegs));
  TIME(0x080009E2, 0x08000A22, (gFlags & FLAGS_EXECUTE_HBLANK_CALLBACKS) ? 0x08000A25 : 0x08000AD1, DMA3, DMA3, DMA3, DMA3, IW);

  if (gFlags & FLAGS_EXECUTE_HBLANK_CALLBACKS) {
    REG_OR16(REG_IE, INTR_FLAG_HBLANK);
    // the fill's zero is on the stack, as the original's is
    DMA_FILL32(3, 0, gHBlankIntrs, sizeof(gHBlankIntrs));
    TIME(0x08000A24, 0x08000A44, gNumHBlankCallbacks != 0 ? 0x08000A47 : 0x08000A59, 0x04000200, 0x04000200, DMA3, IW);
    if (gNumHBlankCallbacks != 0) {
      DMA_COPY32(3, gHBlankCallbacks, gHBlankIntrs, gNumHBlankCallbacks * sizeof(HBlankIntrFunc));
      TIME(0x08000A46, 0x08000A56, 0x08000A59, 0x040000D4, 0x040000D8, IW, 0x040000DC, 0x040000DC);
    }
    gNumHBlankIntrs = gNumHBlankCallbacks;
    TIME(0x08000A58, 0x08000A5E, 0x08000ADF, IW, IW);
  } else {
    REG_AND16(REG_IE, ~INTR_FLAG_HBLANK);
    gNumHBlankIntrs = 0;
    TIME(0x08000AD0, 0x08000ADC, 0x08000ADF, 0x04000200, 0x04000200, IW);
  }

  TIME(0x08000ADE, 0x08000AE6, (gFlags & FLAGS_EXECUTE_HBLANK_COPY) ? 0x08000AE9 : 0x08000B07, IW);
  if (gFlags & FLAGS_EXECUTE_HBLANK_COPY) {
    DMA_COPY16(3, gBgOffsetsHBlankPrimary, gHBlankCopyTarget, gHBlankCopySize);
    TIME(0x08000AE8, 0x08000B04, 0x08000B07, IW, 0x040000D4, IW, 0x040000D8, IW, 0x040000DC, 0x040000DC);
  }

  if (sLastCalledVblankFuncId == VBLANK_FUNC_ID_NONE) {
    TIME(0x08000B06, 0x08000B10, 0x08004895, IW);
    ProcessOamBuffers();
    DMA_COPY16(3, gOamBuffer + 32 * 0, OAM + 0x100 * 0, OAM_SIZE / 4);
    DMA_COPY16(3, gOamBuffer + 32 * 1, OAM + 0x100 * 1, OAM_SIZE / 4);
    DMA_COPY16(3, gOamBuffer + 32 * 2, OAM + 0x100 * 2, OAM_SIZE / 4);
    DMA_COPY16(3, gOamBuffer + 32 * 3, OAM + 0x100 * 3, OAM_SIZE / 4);
    TIME(0x08000B12, 0x08000B52, 0x08000B55, DMA3, DMA3, DMA3, DMA3);
  } else {
    TIME(0x08000B06, 0x08000B0C, 0x08000B55, IW);
  }

  TIME(0x08000B54, 0x08000B5C, gNumVBlankIntrs != 0 ? 0x08000B5F : 0x08000B79, IW);
  for (i = 0; i < gNumVBlankIntrs; i++) {
    // each through the compiler's `bx r0`
    TIME(i == 0 ? 0x08000B5E : 0x08000B62, 0x08000B6A, 0x08099845, IW);
    TIME(0x08099844, 0x08099844, (u32)gVBlankIntrs[i]);
    CALL(gVBlankIntrs[i])();
    TIME(0x08000B6C, 0x08000B76, i + 1 < gNumVBlankIntrs ? 0x08000B63 : 0x08000B79, IW);
  }

  TIME(0x08000B78, 0x08000B82, (gFlags & FLAGS_EXECUTE_VBLANK_CALLBACKS) ? 0x08000B85 : 0x08000C09, IW);
  if (gFlags & FLAGS_EXECUTE_VBLANK_CALLBACKS) {
    DMA_FILL32(3, 0, gVBlankIntrs, sizeof(gVBlankIntrs));
    TIME(0x08000B84, 0x08000B9E, gNumVBlankCallbacks != 0 ? 0x08000BA1 : 0x08000BB3, DMA3, IW);
    if (gNumVBlankCallbacks != 0) {
      DMA_COPY32(3, gVBlankCallbacks, gVBlankIntrs, gNumVBlankCallbacks * sizeof(VBlankFunc));
      TIME(0x08000BA0, 0x08000BB0, 0x08000BB3, 0x040000D4, 0x040000D8, IW, 0x040000DC, 0x040000DC);
    }
    gNumVBlankIntrs = gNumVBlankCallbacks;
    TIME(0x08000BB2, 0x08000BB8, 0x08000C0D, IW, IW);
  } else {
    gNumVBlankIntrs = 0;
    TIME(0x08000C08, 0x08000C0A, 0x08000C0D, IW);
  }

  j = sLastCalledVblankFuncId;
  if (j == VBLANK_FUNC_ID_NONE) {
    j = 0;
    TIME(0x08000C0C, 0x08000C1C, 0x08000C33, IW, IW);
  } else {
    TIME(0x08000C0C, 0x08000C12, 0x08000C17, IW);
    TIME(0x08000C16, 0x08000C1C, 0x08000C33, IW);
  }
  sLastCalledVblankFuncId = VBLANK_FUNC_ID_NONE;

#ifdef MATCHING
  for (; j < 4; j++) {
    if (CALL(sVblankFuncs[j])() == 0) {
      sLastCalledVblankFuncId = j;
      break;
    }
  }
#else
  // each step is called through the compiler's `bx r0`
  for (; j < 4; j++) {
    TIME(0x08000C32, 0x08000C3E, 0x08099845, ROM);
    TIME(0x08099844, 0x08099844, (u32)sVblankFuncs[j]);
    if (CALL(sVblankFuncs[j])() == 0) {
      sLastCalledVblankFuncId = j;
      TIME(0x08000C40, 0x08000C46, 0x08000C49, IW);
      TIME(0x08000C48, 0x08000C4E, BACK);
      return;
    }
    TIME(0x08000C40, 0x08000C42, 0x08000C2D);
    TIME(0x08000C2C, 0x08000C30, 0x08000C33);
  }
  TIME(0x08000C32, 0x08000C34, 0x08000C49);
  TIME(0x08000C48, 0x08000C4E, BACK);
#endif
}

/** UpdateScreenCpuSet, 0x08000D34: UpdateScreenDma's work through the BIOS's copiers, for the screens that ask for
 *  it: the palettes, the callbacks and the sprites' list by its fast one, the registers by the other. (Not timed: no
 *  recording asks for the copiers yet.) */
void UpdateScreenCpuSet(void) {
  u8 i, j = 0;

  REG_WRITE16(REG_DISPCNT, gDispCnt);
  CpuCopy32(gBgCntRegs, (void *)(0x04000000 + REG_BG0CNT), sizeof(gBgCntRegs));

  if (gFlags & FLAGS_UPDATE_BACKGROUND_PALETTES) {
    CpuFastSet(gBgPalette, (void *)BG_PLTT, 0x200 / 4);
    gFlags ^= FLAGS_UPDATE_BACKGROUND_PALETTES;
  }
  if (gFlags & FLAGS_UPDATE_SPRITE_PALETTES) {
    CpuFastSet(gObjPalette, (void *)OBJ_PLTT, 0x200 / 4);
    gFlags ^= FLAGS_UPDATE_SPRITE_PALETTES;
  }

  CpuCopy32(gWinRegs, (void *)(0x04000000 + REG_WIN0H), sizeof(gWinRegs));
  CpuSet(&gBldRegs, (void *)(0x04000000 + REG_BLDCNT), 6 / 2);
  CpuSet(gBgScrollRegs, (void *)(0x04000000 + REG_BG0HOFS), sizeof(gBgScrollRegs) / 2);
  CpuCopy32(&gBgAffineRegs, (void *)(0x04000000 + REG_BG2PA), sizeof(gBgAffineRegs));

  if (gFlags & FLAGS_EXECUTE_HBLANK_CALLBACKS) {
    REG_OR16(REG_IE, INTR_FLAG_HBLANK);
    {
      u32 zero = j;
      CpuFastSet(&zero, gHBlankIntrs, CPU_SET_SRC_FIXED | sizeof(gHBlankIntrs) / 4);
    }
    if (gNumHBlankCallbacks != 0) CpuFastSet(gHBlankCallbacks, gHBlankIntrs, gNumHBlankCallbacks);
    gNumHBlankIntrs = gNumHBlankCallbacks;
  } else {
    REG_AND16(REG_IE, ~INTR_FLAG_HBLANK);
    gNumHBlankIntrs = j;
  }

  if (sLastCalledVblankFuncId == VBLANK_FUNC_ID_NONE) {
    ProcessOamBuffers();
    CpuFastSet(gOamBuffer, (void *)OAM, OAM_SIZE / 4);
  }

  for (i = 0; i < gNumVBlankIntrs; i++) CALL(gVBlankIntrs[i])();

  if (gFlags & FLAGS_EXECUTE_VBLANK_CALLBACKS) {
    {
      u32 zero = 0;
      CpuFastSet(&zero, gVBlankIntrs, CPU_SET_SRC_FIXED | sizeof(gVBlankIntrs) / 4);
    }
    if (gNumVBlankCallbacks != 0) CpuFastSet(gVBlankCallbacks, gVBlankIntrs, gNumVBlankCallbacks);
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
  TIME(0x08000F44, 0x08000F5C, 0x08097105, 0x040000BA, 0x040000BA, 0x040000BA, 0x040000BA, 0x040000BA);
  m4aSoundVSync();
  REG_INTR_CHECK |= 1;
  gExecSoundMain = TRUE;

  // (timed where no line copy is asked for and the VCOUNT interrupt isn't, as on the screens before the title)
  if (gFlagsPreVBlank & FLAGS_EXECUTE_HBLANK_COPY) {
    TIME(0x08000F5E, 0x08000F76, 0x08000F79, IW, IW, IW, IW);
    REG_OR16(REG_IE, INTR_FLAG_HBLANK);
    // (the channel was stopped above, so the wait for it ends at its first look)
    DMA_WAIT(0);
    TIME(0x08000F78, 0x08000F94, 0x08000F9F, 0x04000200, 0x04000200, 0x040000B8);
    DMA_COPY16(0, gBgOffsetsHBlankPrimary, gHBlankCopyTarget, gHBlankCopySize);
    DMA_SET(0, gBgOffsetsHBlankPrimary + gHBlankCopySize, gHBlankCopyTarget, ((0x8000 | 0x2000 | 0x0200 | 0x0060) << 16) | (gHBlankCopySize >> 1));
    TIME(0x08000F9E, 0x08000FCE, 0x08001013, IW, 0x040000B0, IW, 0x040000B4, IW, 0x040000B8, 0x040000B8, IW, IW, 0x040000B0,
         IW, 0x040000B4, IW, 0x040000B8, 0x040000B8);
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
  TIME(0x08001122, 0x08001134, BIOS_BACK, IW, IW, 0x04000202);
}

/** ProcessVramGraphicsCopyQueue, 0x0800116C: the tiles waiting go to video memory, 1 KB at a time, while the blank
 *  lines last. Gives back TRUE when none is left waiting. */
bool32 ProcessVramGraphicsCopyQueue(void) {
  u32 offset;
  struct GraphicsData_Hack *graphics;

#ifndef MATCHING
  // (each run timed after its work: the graphics' size, source and destination are read where the game keeps them,
  // and the display's status is looked at at its load's time)
  int first = 1;
  u32 at;

  if (gVramGraphicsCopyCursor == gVramGraphicsCopyQueueIndex) {
    TIME(0x0800116C, 0x0800117A, 0x0800121B, IW, IW);
    TIME(0x0800121A, 0x08001220, BACK);
  }
#endif

  while (gVramGraphicsCopyCursor != gVramGraphicsCopyQueueIndex) {
    graphics = (void *)gVramGraphicsCopyQueue[gVramGraphicsCopyCursor];
#ifndef MATCHING
    at = (u32)graphics;
    if (first) TIME(0x0800116C, graphics->size != 0 ? 0x0800119A : 0x0800118E, graphics->size == 0 ? 0x080011F7 : graphics->size > 1024 ? 0x0800119D : 0x080011D1, IW, IW, IW, IW, at + 8);
    else TIME(0x08001182, graphics->size != 0 ? 0x0800119A : 0x0800118E, graphics->size == 0 ? 0x080011F7 : graphics->size > 1024 ? 0x0800119D : 0x080011D1, IW, IW, at + 8);
    first = 0;
#endif
    if (graphics->size != 0) {
      for (offset = 0; graphics->size > 0; offset += 1024) {
        if (graphics->size > 1024) {
          DMA_COPY16(3, graphics->src + offset, graphics->dest + offset, 1024);
          graphics->size -= 1024;
#ifndef MATCHING
          TIME(0x0800119C, 0x080011B6, 0x080011ED, at, 0x040000D4, at + 4, 0x040000D8, 0x040000DC, 0x040000DC, at + 8);
          TIME(0x080011EC, 0x080011F4, 0x08001199, at + 8, at + 8);
          TIME(0x08001198, 0x0800119A, graphics->size > 1024 ? 0x0800119D : 0x080011D1);
#endif
        } else {
          DMA_COPY16(3, graphics->src + offset, graphics->dest + offset, graphics->size);
          graphics->size = 0;
#ifndef MATCHING
          TIME(0x080011D0, 0x080011F4, 0x080011F7, at, 0x040000D4, at + 4, 0x040000D8, at + 8, 0x040000DC, 0x040000DC, at + 8, at + 8);
#endif
        }
      }
    }
    gVramGraphicsCopyCursor = (gVramGraphicsCopyCursor + 1) & 31;
#ifdef MATCHING
    if (!(REG_READ16(REG_DISPSTAT) & DISPSTAT_VBLANK)) return FALSE;
#else
    TIME(0x080011F6, 0x08001200, 0x08001203, IW, IW);
    if (!(REG_READ16(REG_DISPSTAT) & DISPSTAT_VBLANK)) {
      TIME(0x08001202, 0x0800120A, 0x0800120D, 0x04000004);
      TIME(0x0800120C, 0x0800120E, 0x0800121D);
      TIME(0x0800121C, 0x08001220, BACK);
      return FALSE;
    }
    TIME(0x08001202, 0x0800120A, 0x08001215, 0x04000004);
    if (gVramGraphicsCopyCursor != gVramGraphicsCopyQueueIndex) TIME(0x08001214, 0x08001218, 0x08001183, IW);
    else TIME(0x08001214, 0x08001220, BACK, IW);
#endif
  }
  return TRUE;
}
