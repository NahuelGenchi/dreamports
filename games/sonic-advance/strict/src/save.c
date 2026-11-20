// What the game keeps on the cartridge.
#include "save.h"
#include "core.h"
#include "time.h"

/** 0x08012F78: the sum of a sector's words, all but the last, which keeps it. */
u32 SaveSectorSum(void *sector) {
  u32 sum = 0;
  u32 i;

#ifdef MATCHING
  for (i = 0; i < SAVE_SECTOR_SIZE - 4; i += 4) sum += *(u32 *)((u8 *)sector + i);
#else
  for (i = 0; i < SAVE_SECTOR_SIZE - 4; i += 4) {
    sum += *(u32 *)((u8 *)sector + i);
    if (i == 0) TIME(0x08012F78, 0x08012F8C, 0x08012F83, IW);
    else if (i + 4 < SAVE_SECTOR_SIZE - 4) TIME(0x08012F82, 0x08012F8C, 0x08012F83, IW);
    else TIME(0x08012F82, 0x08012F94, BACK, IW);
  }
#endif
  return sum;
}

/** SaveGameExists, 0x08012C5C: reads the save from the last of the flash's sectors that holds one with the right sum,
 *  counting from the first and stopping at one never written (from the second, when the first was never written).
 *  None with no flash. */
bool32 SaveGameExists(void) {
  s8 sectorID = 0;
  bool32 res;

  gUsedSaveSectorID = -1;
  if (gFlags & FLAGS_NO_FLASH_MEMORY) return 0;

  {
    ReadFlash(sectorID, 0, &gLoadedSaveGame, sizeof(struct SaveGame));
    if (gLoadedSaveGame.security == SECTOR_SECURITY_NUM) {
      if (gLoadedSaveGame.checksum == SaveSectorSum(&gLoadedSaveGame)) gUsedSaveSectorID = sectorID;
    } else {
      sectorID = 1;
    }
  }

  for (; sectorID < NUM_SAVE_SECTORS; sectorID++) {
    ReadFlash(sectorID, 0, &gLoadedSaveGame, sizeof(struct SaveGame));
    if (gLoadedSaveGame.security == SECTOR_SECURITY_NUM) {
      if (gLoadedSaveGame.checksum == SaveSectorSum(&gLoadedSaveGame)) gUsedSaveSectorID = sectorID;
    } else {
      break;
    }
  }

  if ((u8)gUsedSaveSectorID == 0xFF) {
    gUsedSaveSectorID = -1;
    res = FALSE;
  } else {
    ReadFlash(gUsedSaveSectorID, 0, &gLoadedSaveGame, sizeof(struct SaveGame));
    res = TRUE;
  }
  return res;
}

/** WriteSaveGame, 0x08012D4C: nothing with no flash, or when the sector the save was read from holds it already.
 *  Otherwise the sector after next is erased, so reading stops there, and the next takes the save, marked and summed:
 *  ten sectors in turn. Gives back the flash's error, or 0. */
u16 WriteSaveGame(void) {
  s32 i;
  s8 sectorID;
  u16 result;

  if (gFlags & FLAGS_NO_FLASH_MEMORY) return 0;

  if (gUsedSaveSectorID != -1) {
    u8 *sectorBuffer = EwramMalloc(sizeof(struct SaveGame));
    bool32 sectorIsUpToDate;

    ReadFlash(gUsedSaveSectorID, 0, sectorBuffer, sizeof(struct SaveGame));
    sectorIsUpToDate = TRUE;
    for (i = 0; i < sizeof(struct SaveGame); i++) {
      bool32 neq = sectorBuffer[i] != ((u8 *)&gLoadedSaveGame)[i];
      if (neq) {
        sectorIsUpToDate = FALSE;
        break;
      }
    }
    EwramFree(sectorBuffer);
    if (sectorIsUpToDate) return 0;
  } else {
    // (timed from here where no save was read, and the sector after next isn't the list's last)
    TIME(0x08012D4C, 0x08012D68, 0x08012DD1, IW, IW);
  }

  sectorID = gUsedSaveSectorID + 1;
  if (sectorID == NUM_SAVE_SECTORS - 1) {
    result = CALL(EraseFlashSector)(0);
  } else {
    TIME(0x08012DD0, 0x08012DDE, 0x08012DF1, IW);
    if (sectorID >= NUM_SAVE_SECTORS) {
      sectorID = 0;
      TIME(0x08012DF0, 0x08012DF4, 0x08012DF7);
    } else {
      TIME(0x08012DF0, 0x08012DF2, 0x08012DF7);
    }
    TIME(0x08012DF6, 0x08012E08, 0x08099849, IW);
    TIME(0x08099848, 0x08099848, (u32)EraseFlashSector);
    result = CALL(EraseFlashSector)(sectorID + 1);
  }

  if (result == 0) {
    gLoadedSaveGame.security = SECTOR_SECURITY_NUM;
    TIME(0x08012E0A, 0x08012E1C, 0x08012F79, IW);
    gLoadedSaveGame.checksum = SaveSectorSum(&gLoadedSaveGame);
    gUsedSaveSectorID = sectorID;
    TIME(0x08012E1E, 0x08012E38, 0x0809918D, IW, IW, IW);
    result = ProgramFlashSectorAndVerifyNBytes(gUsedSaveSectorID, &gLoadedSaveGame, sizeof(struct SaveGame));
    TIME(0x08012E3A, 0x08012E42, BACK);
  }
  return result;
}
