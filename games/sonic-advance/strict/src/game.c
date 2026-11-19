// The game's own start, after the engine's: what every screen of it shares, the save, and the first screen.
#include "core.h"
#include "logos.h"
#include "save.h"
#include "stage.h"

/** GameInit, 0x0803CB90: everything the game's screens share emptied, and the save read, or an empty one made. Then the
 *  first screen: the language screen at a first start, the title screen when Start, Select, B and A were held at
 *  power-on, and SEGA's logo otherwise. With no flash every level is open; a single-cartridge link shows its results. */
void GameInit(void) {
  u32 i;
  bool32 hasProfile = FALSE;

  gTilemapsRef = gTilemaps;
  gRefSpriteTables = &gSpriteTables;
  gStageFlags = gUnknown_0300502C = 0;
  gTailsEnabled = FALSE;
  gRingsScatterTask = NULL;
  gDummyTask = NULL;
  gGameStageTask = NULL;
  gPlayer.spriteTask = NULL;
  gPartner.spriteTask = NULL;
  gCamera.movementTask = NULL;
  gDustEffectBrakingTask.t = NULL;
  gWater.t = NULL;
  gUnknown_03005018 = 0;
  gGameMode = 0;
  gEntitiesManagerTask = NULL;
  gSmallAirBubbleCount = 0;
  gDemoPlayCounter = 0;
  gDestroySpotlights = FALSE;

  for (i = 0; i < 4; i++) gMultiplayerPlayerTasks[i] = NULL;
  gTask_03006240 = NULL;

  for (i = 0; i < 4; i++) {
    gMultiplayerCharacters[i] = 0;
    gMultiplayerRanks[i] = 0;
    gMultiplayerMissingHeartbeats[i] = 0;
  }

  if (SaveGameExists() != TRUE) {
    CreateEmptySaveGame();
    hasProfile = TRUE;
  }

  if (gFlags & FLAGS_200) {
    ShowSinglePakResults();
    return;
  }

  if (gFlags & FLAGS_NO_FLASH_MEMORY) {
    CreateSegaLogo();
    for (i = 0; i < NUM_CHARACTERS; i++) gLoadedSaveGame.unlockedLevels[i] = 0xF;
    return;
  }

  if (hasProfile) {
    CreateEditLanguageScreen(1);
    return;
  }

  if (gFlags & FLAGS_SKIP_INTRO) {
    CreateTitleScreen(1);
    gFlags &= ~FLAGS_SKIP_INTRO;
    return;
  }

  CreateSegaLogo();
}

/** CreateEmptySaveGame, 0x0803CD04: the save of a first start: normal difficulty, no level open, no results, every
 *  time at its most, and the menus in English. */
void CreateEmptySaveGame(void) {
  u32 i;

  DMA3_FILL32(0, &gLoadedSaveGame, sizeof(gLoadedSaveGame));
  gLoadedSaveGame.unk4 = 0;
  gLoadedSaveGame.unk420 = 50000;
  gLoadedSaveGame.difficultyLevel = 0;

  for (i = 0; i < NUM_CHARACTERS; i++) gLoadedSaveGame.unlockedLevels[i] = 0;

  for (i = 0; i < 10; i++) {
    u32 charIndex;

    gLoadedSaveGame.multiplayerScores[i].wins |= 0xFF;
    for (charIndex = 0; charIndex < (s32)8; charIndex++) gLoadedSaveGame.multiplayerScores[i].playerName[charIndex] = ' ';
  }

  DMA3_FILL32(MAX_COURSE_TIME, gLoadedSaveGame.timeRecords, sizeof(gLoadedSaveGame.timeRecords));

  gLoadedSaveGame.uiLanguage = 1;
  gLoadedSaveGame.language = 0;
  gLoadedSaveGame.timeLimitDisabled = 0;
  gLoadedSaveGame.score = 0;
}
