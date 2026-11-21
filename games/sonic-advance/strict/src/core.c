// The engine's start, its loop and its interrupts.
#include "core.h"
#include "task.h"

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
