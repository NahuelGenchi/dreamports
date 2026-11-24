// The engine's start, its loop and its interrupts.
#include "core.h"
#include "malloc.h"
#include "screen.h"
#include "task.h"
#include "time.h"

/** EngineInit, 0x080003EC: the engine from power-on. The console's wait states, the screen and every list the engine
 *  keeps emptied, the interrupt handler copied to the fast work memory, the sound, the task list, the heaps, the save
 *  memory, the interrupts and the link cable. Start, Select, B and A held at power-on skip the story's opening. */
void EngineInit(void) {
  s16 i;
  u16 errorIdentifying;

  REG_WRITE16(REG_WAITCNT, 0x4014);
  gFlags = 0;
  gFlagsPreVBlank = 0;

  if ((REG_READ16(REG_RCNT) & 0xC000) != 0x8000) {
    TIME(0x080003EC, 0x0800041A, 0x0800041D, 0x04000204, IW, IW, 0x04000134);
    gFlags = FLAGS_200;
    DMA3_COPY16(OBJ_VRAM0, EWRAM_START + 0x3B000, 0x5000);
    TIME(0x0800041C, 0x08000430, 0x08000433, IW, DMA3);
  } else TIME(0x080003EC, 0x0800041A, 0x08000433, 0x04000204, IW, IW, 0x04000134);

  if (gInput == (START_BUTTON | SELECT_BUTTON | B_BUTTON | A_BUTTON)) {
    gFlags |= FLAGS_SKIP_INTRO;
    TIME(0x08000432, 0x08000438, 0x0800043B, IW);
    TIME(0x0800043A, 0x08000442, 0x08000473, IW);
    TIME(0x08000472, 0x08000472, 0x08000475, IW);
  } else {
    gFlags &= ~FLAGS_SKIP_INTRO;
    TIME(0x08000432, 0x08000438, 0x0800046D, IW);
    TIME(0x0800046C, 0x08000472, 0x08000475, IW, IW);
  }

  DMA3_FILL32(0, VRAM, VRAM_SIZE);
  DMA3_FILL32(0, OAM, OAM_SIZE);  DMA3_FILL32(0, PLTT, PLTT_SIZE);

  sLastCalledVblankFuncId = VBLANK_FUNC_ID_NONE;
  gBackgroundsCopyQueueCursor = 0;
  gBackgroundsCopyQueueIndex = 0;
  gBgSpritesCount = 0;
  gVramGraphicsCopyCursor = 0;
  gVramGraphicsCopyQueueIndex = 0;
  DMA3_FILL32(0, gBgSprites_Unknown2, sizeof(gBgSprites_Unknown2));
  *(u32 *)gBgSprites_Unknown1 = 0;
  DMA3_FILL32(0, gBgScrollRegs, sizeof(gBgScrollRegs));

  gSpriteOffset.x = 0;
  gSpriteOffset.y = 0;
  gDispCnt = DISPCNT_FORCED_BLANK;
  DMA3_FILL32(0, gVramGraphicsCopyQueue, sizeof(gVramGraphicsCopyQueue));
  gOamFreeIndex = 0;
  gOamFirstPausedIndex = 0;
  DMA3_FILL16(0x200, gOamBuffer, sizeof(gOamBuffer));
  DMA3_FILL16(0x200, gOamMallocBuffer, sizeof(gOamMallocBuffer));
  DMA3_FILL32(~0, gOamMallocOrders_StartIndex, sizeof(gOamMallocOrders_StartIndex));
  DMA3_FILL32(~0, gOamMallocOrders_EndIndex, sizeof(gOamMallocOrders_EndIndex));
  DMA3_FILL32(0, gObjPalette, sizeof(gObjPalette));
  DMA3_FILL32(0, gBgPalette, sizeof(gBgPalette));

  gBgAffineRegs[0].pa = 0x100;
  gBgAffineRegs[0].pb = 0;
  gBgAffineRegs[0].pc = 0;
  gBgAffineRegs[0].pd = 0x100;
  gBgAffineRegs[0].x = 0;
  gBgAffineRegs[0].y = 0;
  gBgAffineRegs[1].pa = 0x100;
  gBgAffineRegs[1].pb = 0;
  gBgAffineRegs[1].pc = 0;
  gBgAffineRegs[1].pd = 0x100;
  gBgAffineRegs[1].x = 0;
  gBgAffineRegs[1].y = 0;

  gUnknown_03001204 = 0;
  gUnknown_030010B0 = 0x100;
  gUnknown_03004C34 = 0x100;
  gUnknown_0300232C = 0;
  gUnknown_030045F4 = 0;
  gUnknown_0300120C = 0;
  gUnknown_030020C0 = 0;
  gUnknown_03004C38 = 0x100;

  gWinRegs[0] = 0;
  gWinRegs[1] = 0;
  gWinRegs[2] = 0;
  gWinRegs[3] = 0;
  gWinRegs[4] = 0;
  gWinRegs[5] = 0;

  gBldRegs.bldCnt = 0;
  gBldRegs.bldAlpha = 0;
  gBldRegs.bldY = 0;

  gPseudoRandom = 0;

  for (i = 0; i < 10; i++) {
    gKeysFirstRepeatIntervals[i] = 20;
    gKeysContinuedRepeatIntervals[i] = 8;
    // in the console's time, the first pass ends the run from the skip-intro flag, through the fills and the values
    // above, and the last goes on below
    if (i == 0)
      TIME(0x08000474, 0x080005F6, 0x080005E1, DMA3, DMA3, DMA3, IW, IW, IW, IW, IW, IW, DMA3, IW, DMA3, IW, IW, IW, DMA3,
           IW, IW, IW, DMA3, IW, DMA3, DMA3, DMA3, DMA3, DMA3, IW, IW, IW, IW, IW, IW, IW, IW, IW, IW, IW, IW, IW, IW, IW, IW,
           IW, IW, IW, IW, IW, IW, IW, IW, IW, IW, IW, IW, IW, IW, IW, IW);
    else if (i < 9) TIME(0x080005E0, 0x080005F6, 0x080005E1, IW, IW);
  }

  gInputRecorder.mode = 0;
  gPhysicalInput = 0;
  gInputPlaybackData = NULL;
  gFrameCount = 0;

  for (i = 0; i < 15; i++) {
    gIntrTable[i] = gIntrTableTemplate[i];
    if (i == 0) TIME(0x080005E0, 0x08000628, 0x08000611, IW, IW, IW, IW, IW, IW, ROM, IW);
    else if (i < 14) TIME(0x08000610, 0x08000628, 0x08000611, ROM, IW);
  }

  DMA3_FILL32(0, gBgOffsetsBuffer, sizeof(gBgOffsetsBuffer));
  gBgOffsetsHBlankPrimary = gBgOffsetsBuffer[0];
  gBgOffsetsHBlankSecondary = gBgOffsetsBuffer[1];
  gHBlankCopyTarget = NULL;
  gHBlankCopySize = 0;
  gNumHBlankCallbacks = 0;
  gNumHBlankIntrs = 0;
  DMA3_FILL32(0, gHBlankCallbacks, sizeof(gHBlankCallbacks));
  DMA3_FILL32(0, gHBlankIntrs, sizeof(gHBlankCallbacks));

  gNumVBlankCallbacks = 0;
  gNumVBlankIntrs = 0;
  DMA3_FILL32(0, gVBlankCallbacks, sizeof(gVBlankCallbacks));
  DMA3_FILL32(0, gVBlankIntrs, sizeof(gVBlankIntrs));

  TIME(0x08000610, 0x0800069E, 0x08097761, ROM, IW, DMA3, IW, IW, IW, IW, IW, IW, DMA3, DMA3, IW, IW, DMA3, DMA3);
  m4aSoundInit();
  TIME(0x080006A0, 0x080006A4, 0x08097CFD);
  m4aSoundMode(0x93F500);
  gExecSoundMain = TRUE;
  TIME(0x080006A6, 0x080006AE, 0x080014A9, IW);

  TasksInit();
  TIME(0x080006B0, 0x080006B2, 0x08006A75);
  EwramInitHeap();
  gVramHeapMaxTileSlots = 0x270;
  gVramHeapStartAddr = (u8 *)(OBJ_VRAM0 + 0x3200);
  TIME(0x080006B4, 0x080006C6, 0x08006C0D, IW, IW);
  VramResetHeapState();

  TIME(0x080006C8, 0x080006CA, 0x08098CED);
  errorIdentifying = IdentifyFlash();
  if (errorIdentifying) gFlags |= FLAGS_NO_FLASH_MEMORY;
  else SetFlashTimerIntr(1, &gIntrTable[5]);

  DMA3_COPY32(IntrMain, gIntrMainBuf, sizeof(gIntrMainBuf));
  INTR_VECTOR = gIntrMainBuf;

  REG_WRITE16(REG_IME, INTR_FLAG_VBLANK);
  REG_WRITE16(REG_IE, INTR_FLAG_VBLANK);
  REG_WRITE16(REG_DISPSTAT, DISPSTAT_HBLANK_INTR | DISPSTAT_VBLANK_INTR);

  DMA3_FILL32(0, gMultiSioSend, sizeof(gMultiSioSend));
  DMA3_FILL32(0, gMultiSioRecv, sizeof(gMultiSioRecv));
  gMultiSioStatusFlags = 0;
  gMultiSioEnabled = FALSE;
  MultiSioInit(0);
}

/** EngineMainLoop, 0x0800089C: a frame of the game, for ever. The sound, the buttons, the link cable and every task,
 *  then the wait for the screen's blank lines, in which what the tasks drew goes to the screen. */
void EngineMainLoop(void) {
  while (TRUE) {
    // (the frame's work is timed where the recording goes: the sound each frame, no link cable)
    gExecSoundMain = FALSE;
#ifndef MATCHING
    if (!(gFlags & FLAGS_UPDATE_WITH_CPU_SET)) TIME(0x080008A4, 0x080008B8, 0x080977D9, IW, IW);
#endif
    // the call on the same line for both compilers, so the console's stack pairs the Dreamport's with the console's
    if (!(gFlags & FLAGS_UPDATE_WITH_CPU_SET)) m4aSoundMain();

    if (sLastCalledVblankFuncId == VBLANK_FUNC_ID_NONE) {
      TIME(0x080008BA, 0x080008C4, 0x08001225, IW);
      GetInput();
      if (gMultiSioEnabled) gMultiSioStatusFlags = MultiSioMain(gMultiSioSend, gMultiSioRecv, 0);
#ifndef MATCHING
      else TIME(0x080008C6, 0x080008CC, 0x080008DD, IW);
#endif
      TIME(0x080008DC, 0x080008DE, 0x080016AD);
      TasksExec();
    }

    gFlagsPreVBlank = gFlags;
    VBlankIntrWait();
    // (from the wait's way back, the blank lines' work is timed where the screen goes up by DMA)
    TIME(0x08099820, 0x08099820, 0x080008ED);

    if (gFlags & FLAGS_UPDATE_WITH_CPU_SET) {
      UpdateScreenCpuSet();
      if (!(gFlags & FLAGS_PAUSE_GAME)) ClearOamBufferCpuSet();
    } else {
      TIME(0x080008EC, 0x080008F6, 0x0800092D, IW);
      TIME(0x0800092C, 0x0800092E, 0x08000981);
      UpdateScreenDma();
      if (!(gFlags & FLAGS_PAUSE_GAME)) {
        TIME(0x08000930, 0x0800093A, 0x08000C55, IW);
        ClearOamBufferDma();
        TIME(0x0800093C, 0x08000946, 0x08000959, IW);
      }
#ifndef MATCHING
      else TIME(0x08000930, 0x08000936, 0x08000949, IW);
#endif
    }

    if (gFlags & FLAGS_PAUSE_GAME) {
      gFlags |= FLAGS_PAUSED;
      TIME(0x08000948, 0x08000952, 0x0800095F, IW, IW);
    } else {
      gFlags &= ~FLAGS_PAUSED;
      TIME(0x08000958, 0x0800095C, 0x0800095F, IW);
    }

    // until the blank lines are over: each look at the display's status at its load's time
#ifdef MATCHING
    while (REG_READ16(REG_DISPSTAT) & DISPSTAT_VBLANK) {}
#else
    TIME(0x0800095E, 0x0800095E, 0x08000961);
    if (REG_READ16(REG_DISPSTAT) & DISPSTAT_VBLANK) {
      TIME(0x08000960, 0x0800096A, 0x0800096D, 0x04000004);
      while (REG_READ16(REG_DISPSTAT) & DISPSTAT_VBLANK) TIME(0x0800096C, 0x08000974, 0x0800096D, 0x04000004);
      TIME(0x0800096C, 0x08000976, 0x080008A5, 0x04000004);
    } else {
      TIME(0x08000960, 0x08000968, 0x080008A5, 0x04000004);
    }
#endif
  }
}

/** GetInput, 0x08001224: the buttons held, and those pressed and let go since the last frame, or those of a demo
 *  played back. A button held long enough is pressed again, after its first wait and then every few frames. */
void GetInput(void) {
  s8 i;
  u8 *repeatKeyCounters = gRepeatedKeysTestCounter, *firstIntervals = gKeysFirstRepeatIntervals, *continuedHoldIntervals = gKeysContinuedRepeatIntervals;

  gInput = ~REG_READ16(REG_KEYINPUT) & KEYS_MASK;
  gPhysicalInput = gInput;

  if (gInputRecorder.mode == RECORDER_RECORD) InputRecorderWrite(gInput);
  else if (gInputRecorder.mode == RECORDER_PLAYBACK) gInput = InputRecorderRead();
#ifndef MATCHING
  // (timed with the recorder off, and each button as one not held)
  else {
    TIME(0x08001224, 0x0800124E, 0x08001279, 0x04000130, IW, IW, IW);
    TIME(0x08001278, 0x0800127A, 0x08001283);
  }
#endif

  gPressedKeys = (gInput ^ gPrevInput) & gInput;
  gReleasedKeys = (gInput ^ gPrevInput) & gPrevInput;
  gPrevInput = gInput;
  gRepeatedKeys = gPressedKeys;

  for (i = 0; i < 10; i++) {
    if (!((gInput >> i) & 1)) {
      repeatKeyCounters[i] = firstIntervals[i];
#ifndef MATCHING
      if (i == 0) TIME(0x08001282, 0x080012C6, 0x080012FB, IW, IW, IW, IW, IW, IW, IW, IW, IW);
      else TIME(0x080012AA, 0x080012C6, 0x080012FB, IW, IW, IW);
#endif
    } else if (repeatKeyCounters[i] > 0) {
      repeatKeyCounters[i]--;
    } else {
      gRepeatedKeys |= 1 << i;
      repeatKeyCounters[i] = continuedHoldIntervals[i];
    }
#ifndef MATCHING
    if (i < 9) TIME(0x080012FA, 0x08001306, 0x080012AB);
    else TIME(0x080012FA, 0x08001312, BACK);
#endif
  }
}

/** ClearOamBufferDma, 0x08000C54: after a frame's V-blank, no line callbacks, the two buffers of lines' scroll swapped
 *  unless the game holds them, and every sprite of the next frame's list hidden. */
void ClearOamBufferDma(void) {
  gNumHBlankCallbacks = 0;
  gFlags &= ~FLAGS_EXECUTE_HBLANK_CALLBACKS;
  if (!(gFlags & FLAGS_20)) {
    if (gBgOffsetsHBlankPrimary == gBgOffsetsBuffer[0]) {
      gBgOffsetsHBlankPrimary = gBgOffsetsBuffer[1];
      gBgOffsetsHBlankSecondary = gBgOffsetsBuffer[0];
      TIME(0x08000C54, 0x08000C8A, 0x08000CAD, IW, IW, IW, IW, IW, IW);
    } else {
      gBgOffsetsHBlankPrimary = gBgOffsetsBuffer[0];
      gBgOffsetsHBlankSecondary = gBgOffsetsBuffer[1];
      TIME(0x08000C54, 0x08000C7C, 0x08000CA1, IW, IW, IW, IW);
      TIME(0x08000CA0, 0x08000CAA, 0x08000CAD, IW, IW);
    }
  }
#ifndef MATCHING
  else TIME(0x08000C54, 0x08000C72, 0x08000CAD, IW, IW, IW);
#endif
  gFlags &= ~FLAGS_EXECUTE_HBLANK_COPY;
  DMA3_FILL16(0x200, gOamBuffer + 32 * 0, OAM_SIZE / 4);
  DMA3_FILL16(0x200, gOamBuffer + 32 * 1, OAM_SIZE / 4);
  DMA3_FILL16(0x200, gOamBuffer + 32 * 2, OAM_SIZE / 4);
  DMA3_FILL16(0x200, gOamBuffer + 32 * 3, OAM_SIZE / 4);
  gNumVBlankCallbacks = 0;
  gFlags &= ~FLAGS_EXECUTE_VBLANK_CALLBACKS;
  TIME(0x08000CAC, 0x08000D1E, BACK, IW, IW, IW, DMA3, IW, DMA3, IW, DMA3, IW, DMA3, IW, IW, IW);
}

/** HBlankIntr, 0x08001314: at the end of each line of the picture, what the game asked to run there. */
void HBlankIntr(void) {
  u8 i;
  u8 vcount = REG_READ8(REG_VCOUNT);

  if (vcount < DISPLAY_HEIGHT) {
    for (i = 0; i < gNumHBlankIntrs; i++) CALL(gHBlankIntrs[i])(vcount);
  }
  REG_WRITE16(REG_IF, INTR_FLAG_HBLANK);
}

// The interrupts the game has nothing to do at, in its table from power-on: each only says it was seen to.

/** VCountIntr, 0x08001364: the line count's interrupt seen to. */
void VCountIntr(void) { REG_WRITE16(REG_IF, 0x0004); }

/** Dma0Intr, 0x08001370: DMA channel 0's interrupt seen to. */
void Dma0Intr(void) { REG_WRITE16(REG_IF, 0x0100); }

/** Dma1Intr, 0x08001380: DMA channel 1's interrupt seen to. */
void Dma1Intr(void) { REG_WRITE16(REG_IF, 0x0200); }

/** Dma2Intr, 0x08001390: DMA channel 2's interrupt seen to. */
void Dma2Intr(void) { REG_WRITE16(REG_IF, 0x0400); }

/** Dma3Intr, 0x080013A0: DMA channel 3's interrupt seen to. */
void Dma3Intr(void) { REG_WRITE16(REG_IF, 0x0800); }

/** Timer0Intr, 0x080013B0: timer 0's interrupt seen to. */
void Timer0Intr(void) { REG_WRITE16(REG_IF, 0x0008); }

/** Timer2Intr, 0x080013C8: timer 2's interrupt seen to. */
void Timer2Intr(void) { REG_WRITE16(REG_IF, 0x0020); }

/** KeypadIntr, 0x080013D4: the buttons' interrupt seen to. */
void KeypadIntr(void) { REG_WRITE16(REG_IF, 0x1000); }

/** GamepakIntr, 0x080013E4: the cartridge's interrupt seen to. */
void GamepakIntr(void) { REG_WRITE16(REG_IF, 0x2000); }

/** DummyFunc, 0x080013F4: nothing, for an interrupt nobody sees to. */
void DummyFunc(void) {}

/** ClearOamBufferCpuSet, 0x080013F8: ClearOamBufferDma's work through the BIOS's fast copier, for the screens that ask
 *  for it: no line callbacks, the two buffers of lines' scroll swapped unless the game holds them, and every sprite of
 *  the next frame's list hidden. (Not timed: no recording asks for the copiers yet.) */
void ClearOamBufferCpuSet(void) {
  gNumHBlankCallbacks = 0;
  gFlags &= ~FLAGS_EXECUTE_HBLANK_CALLBACKS;
  if (!(gFlags & FLAGS_20)) {
    if (gBgOffsetsHBlankPrimary == gBgOffsetsBuffer[0]) {
      gBgOffsetsHBlankPrimary = gBgOffsetsBuffer[1];
      gBgOffsetsHBlankSecondary = gBgOffsetsBuffer[0];
    } else {
      gBgOffsetsHBlankPrimary = gBgOffsetsBuffer[0];
      gBgOffsetsHBlankSecondary = gBgOffsetsBuffer[1];
    }
  }
  gFlags &= ~FLAGS_EXECUTE_HBLANK_COPY;
  CpuFastFill(0x200, gOamBuffer, sizeof(gOamBuffer));
  gNumVBlankCallbacks = 0;
  gFlags &= ~FLAGS_EXECUTE_VBLANK_CALLBACKS;
}

/** AgbMain, 0x08001494: where the cartridge's start hands over. The engine, then the game, then the loop. */
void AgbMain(void) {
  TIME(0x08001494, 0x08001498, 0x080003ED);
  EngineInit();
  GameInit();
  EngineMainLoop();
}
