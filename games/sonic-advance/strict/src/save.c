// What the game keeps on the cartridge.
#include "save.h"
#include "core.h"

/** 0x08012F78: the sum of a sector's words, all but the last, which keeps it. */
u32 SaveSectorSum(void *sector) {
  u32 sum = 0;
  u32 i;

  for (i = 0; i < SAVE_SECTOR_SIZE - 4; i += 4) sum += *(u32 *)((u8 *)sector + i);
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

/** WriteSaveGame, 0x08012D4C: (no wording found gives the original's bytes: two registers come out swapped, as in the
 *  decompilation's, which comes to 97.6%, so its proof is the same memory.) Nothing with no flash, or when the sector the save was read from holds it already.
 *  Otherwise the sector after next is erased, so reading stops there, and the next takes the save, marked and summed:
 *  ten sectors in turn. Gives back the flash's error, or 0. */
u16 WriteSaveGame(void) {
  u32 i;
  s8 sectorID;
  u16 result;

  if (gFlags & FLAGS_NO_FLASH_MEMORY) return 0;

  if (gUsedSaveSectorID != -1) {
    u8 *sectorBuffer = EwramMalloc(sizeof(struct SaveGame));
    bool32 sectorIsUpToDate;

    ReadFlash(gUsedSaveSectorID, 0, sectorBuffer, sizeof(struct SaveGame));
    sectorIsUpToDate = TRUE;
    for (i = 0; i < sizeof(struct SaveGame); i++) {
      u8 *dataBuffer = sectorBuffer + i;
      u8 *dataIWRAM = (u8 *)&gLoadedSaveGame + i;

      if (*dataBuffer != *dataIWRAM) {
        sectorIsUpToDate = FALSE;
        break;
      }
    }
    EwramFree(sectorBuffer);
    if (sectorIsUpToDate) return 0;
  }

  sectorID = gUsedSaveSectorID + 1;
  if (sectorID == NUM_SAVE_SECTORS - 1) {
    result = CALL(EraseFlashSector)(0);
  } else {
    if (sectorID >= NUM_SAVE_SECTORS) sectorID = 0;
    result = CALL(EraseFlashSector)(sectorID + 1);
  }

  if (result == 0) {
    gLoadedSaveGame.security = SECTOR_SECURITY_NUM;
    gLoadedSaveGame.checksum = SaveSectorSum(&gLoadedSaveGame);
    gUsedSaveSectorID = sectorID;
    result = ProgramFlashSectorAndVerifyNBytes(gUsedSaveSectorID, &gLoadedSaveGame, sizeof(struct SaveGame));
  }
  return result;
}
