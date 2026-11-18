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
