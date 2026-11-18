// The engine's start, its loop and its interrupts.
#include "core.h"
#include "malloc.h"
#include "task.h"

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
    gFlags = FLAGS_200;
    DMA3_COPY16(OBJ_VRAM0, EWRAM_START + 0x3B000, 0x5000);
  }

  if (gInput == (START_BUTTON | SELECT_BUTTON | B_BUTTON | A_BUTTON)) gFlags |= FLAGS_SKIP_INTRO;
  else gFlags &= ~FLAGS_SKIP_INTRO;

  DMA3_FILL32(0, VRAM, VRAM_SIZE);
  DMA3_FILL32(0, OAM, OAM_SIZE);
  DMA3_FILL32(0, PLTT, PLTT_SIZE);

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
  }

  gInputRecorder.mode = 0;
  gPhysicalInput = 0;
  gInputPlaybackData = NULL;
  gFrameCount = 0;

  for (i = 0; i < 15; i++) gIntrTable[i] = gIntrTableTemplate[i];

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

  m4aSoundInit();
  m4aSoundMode(0x93F500);
  gExecSoundMain = TRUE;

  TasksInit();
  EwramInitHeap();
  gVramHeapMaxTileSlots = 0x270;
  gVramHeapStartAddr = (u8 *)(OBJ_VRAM0 + 0x3200);
  VramResetHeapState();

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
    gExecSoundMain = FALSE;
    if (!(gFlags & FLAGS_UPDATE_WITH_CPU_SET)) m4aSoundMain();

    if (sLastCalledVblankFuncId == VBLANK_FUNC_ID_NONE) {
      GetInput();
      if (gMultiSioEnabled) gMultiSioStatusFlags = MultiSioMain(gMultiSioSend, gMultiSioRecv, 0);
      TasksExec();
    }

    gFlagsPreVBlank = gFlags;
    VBlankIntrWait();

    if (gFlags & FLAGS_UPDATE_WITH_CPU_SET) {
      UpdateScreenCpuSet();
      if (!(gFlags & FLAGS_PAUSE_GAME)) ClearOamBufferCpuSet();
    } else {
      UpdateScreenDma();
      if (!(gFlags & FLAGS_PAUSE_GAME)) ClearOamBufferDma();
    }

    if (gFlags & FLAGS_PAUSE_GAME) gFlags |= FLAGS_PAUSED;
    else gFlags &= ~FLAGS_PAUSED;

    // until the blank lines are over
    while (REG_READ16(REG_DISPSTAT) & DISPSTAT_VBLANK) {}
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

  gPressedKeys = (gInput ^ gPrevInput) & gInput;
  gReleasedKeys = (gInput ^ gPrevInput) & gPrevInput;
  gPrevInput = gInput;
  gRepeatedKeys = gPressedKeys;

  for (i = 0; i < 10; i++) {
    if (!((gInput >> i) & 1)) {
      repeatKeyCounters[i] = firstIntervals[i];
    } else if (repeatKeyCounters[i] > 0) {
      repeatKeyCounters[i]--;
    } else {
      gRepeatedKeys |= 1 << i;
      repeatKeyCounters[i] = continuedHoldIntervals[i];
    }
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
    } else {
      gBgOffsetsHBlankPrimary = gBgOffsetsBuffer[0];
      gBgOffsetsHBlankSecondary = gBgOffsetsBuffer[1];
    }
  }
  gFlags &= ~FLAGS_EXECUTE_HBLANK_COPY;
  DMA3_FILL16(0x200, gOamBuffer + 32 * 0, OAM_SIZE / 4);
  DMA3_FILL16(0x200, gOamBuffer + 32 * 1, OAM_SIZE / 4);
  DMA3_FILL16(0x200, gOamBuffer + 32 * 2, OAM_SIZE / 4);
  DMA3_FILL16(0x200, gOamBuffer + 32 * 3, OAM_SIZE / 4);
  gNumVBlankCallbacks = 0;
  gFlags &= ~FLAGS_EXECUTE_VBLANK_CALLBACKS;
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

/** AgbMain, 0x08001494: where the cartridge's start hands over. The engine, then the game, then the loop. */
void AgbMain(void) {
  EngineInit();
  GameInit();
  EngineMainLoop();
}
