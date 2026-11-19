// What the game keeps on the cartridge.
#ifndef SAVE_H
#define SAVE_H
#include "console.h"

// a sector of what's kept, in bytes, with its sum in its last word
#define SAVE_SECTOR_SIZE 0x430
#define NUM_SAVE_SECTORS 10
/** What the first word of a sector that holds a save says. */
#define SECTOR_SECURITY_NUM 0x4F524950
#define MAX_COURSE_TIME 36000
#define NUM_CHARACTERS 4

/** A player's results against one other player, by name. */
struct MultiplayerScore {
  /* 0x00 */ u32 playerId;
  /* 0x04 */ u8 playerName[8];
  /* 0x0C */ u8 wins;
  /* 0x0D */ u8 losses;
  /* 0x0E */ u8 draws;
  /* 0x0F */ u8 slotFilled;
};

/** The save, as a sector of the cartridge's flash holds it. */
struct SaveGame {
  /* 0x000 */ u32 security;
  /* 0x004 */ s32 unk4;
  /* 0x008 */ u16 unlockedLevels[NUM_CHARACTERS];
  /* 0x010 */ u8 playerName[8];
  /* 0x018 */ u8 difficultyLevel;
  /* 0x019 */ u8 uiLanguage;
  /* 0x01A */ u8 language;
  /* 0x01B */ u8 timeLimitDisabled;
  /* 0x01C */ u8 btnConfig;
  /* 0x01D */ u8 chaosEmeralds;
  /* 0x020 */ u32 timeRecords[0xD8];
  /* 0x380 */ struct MultiplayerScore multiplayerScores[10];
  /* 0x420 */ u32 unk420;
  /* 0x424 */ u8 unk424;
  /* 0x425 */ u8 unk425;
  /* 0x426 */ u8 unk426;
  /* 0x427 */ u8 unk427;
  /* 0x428 */ u32 score;
  /* 0x42C */ u32 checksum;
};

extern struct SaveGame gLoadedSaveGame;
/** The sector the save was read from, or -1. */
extern s8 gUsedSaveSectorID;

u32 SaveSectorSum(void *sector);
bool32 SaveGameExists(void);
void CreateEmptySaveGame(void);
u16 ReadFlash(u16 sectorNum, u32 offset, void *dest, u32 size);
u16 WriteSaveGame(void);
void *EwramMalloc(u32 size);
void EwramFree(void *p);
extern u16 (*EraseFlashSector)(u16 sectorNum);
u32 ProgramFlashSectorAndVerifyNBytes(u16 sectorNum, void *src, u32 n);

#endif
