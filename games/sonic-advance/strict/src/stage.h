// What the game's stages keep, as far as GameInit names it.
#ifndef STAGE_H
#define STAGE_H
#include "console.h"

struct Task;

/** A character in a stage: only its sprite's task so far. */
struct Player {
  /* 0x00 */ u8 filler0[0x60];
  /* 0x60 */ struct Task *spriteTask;
};

/** The camera: only the task that moves it so far. */
struct Camera {
  /* 0x00 */ u8 filler0[0x30];
  /* 0x30 */ struct Task *movementTask;
};

/** Something with a task, as the braking dust and the water are, its task second. */
struct TaskHolder {
  /* 0x00 */ u32 unk0;
  /* 0x04 */ struct Task *t;
};

/** The water, its task at 0x10. */
struct Water {
  /* 0x00 */ u8 filler0[0x10];
  /* 0x10 */ struct Task *t;
};

struct MapHeader;
extern const struct MapHeader *const *gTilemapsRef;
extern const struct MapHeader *const gTilemaps[];
extern const void *gRefSpriteTables;
extern const u8 gSpriteTables[];
extern u16 gStageFlags;
extern u16 gUnknown_0300502C;
extern u8 gTailsEnabled;
extern struct Task *gRingsScatterTask;
extern struct Task *gDummyTask;
extern struct Task *gGameStageTask;
extern struct Player gPlayer;
extern struct Player gPartner;
extern struct Camera gCamera;
extern struct TaskHolder gDustEffectBrakingTask;
extern struct Water gWater;
extern u8 gUnknown_03005018;
extern u8 gGameMode;
extern struct Task *gEntitiesManagerTask;
extern u8 gSmallAirBubbleCount;
extern u8 gDemoPlayCounter;
extern u8 gDestroySpotlights;
extern struct Task *gMultiplayerPlayerTasks[4];
extern struct Task *gTask_03006240;
extern u8 gMultiplayerCharacters[4];
extern u8 gMultiplayerRanks[4];
extern u8 gMultiplayerMissingHeartbeats[4];

void ShowSinglePakResults(void);
void CreateEditLanguageScreen(u8 mode);
void CreateTitleScreen(u8 mode);

#endif
