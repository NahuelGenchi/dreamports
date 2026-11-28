// The entities manager: what the act places on its map, made as the camera comes near it, in C.
#include "stage_init.h"

// A place on the map, as the act's lists keep it, 7 bytes each with nothing between: within its region, in steps of 8
// pixels, then which kind it is and what it needs.
struct MapEntity {
  /* 0x00 */ u8 x;
  /* 0x01 */ u8 y;
  /* 0x02 */ u8 index;
  /* 0x03 */ u8 data[4];
} __attribute__((packed));

// An item box's place, as the act's list of them keeps it, 3 bytes each.
struct MapEntityItemBox {
  /* 0x00 */ u8 x;
  /* 0x01 */ u8 y;
  /* 0x02 */ u8 index;
} __attribute__((packed));

// A list of places, as decompressed into the work memory: a few words, then where each region's places start.
struct MapEntityList {
  /* 0x00 */ u32 unk0;
  /* 0x04 */ u32 unk4;
  /* 0x08 */ u32 unk8;
  /* 0x0C */ u32 offsets[1];
};

// The entities manager's own memory, with each list as it is.
struct EntitiesManagerLists {
  /* 0x00 */ u32 *interactables;
  /* 0x04 */ struct MapEntityList *items;
  /* 0x08 */ struct MapEntityList *enemies;
  /* 0x0C */ s16 prevCamX;
  /* 0x0E */ s16 prevCamY;
  /* 0x10 */ u8 spawnAll;
};

typedef void (*MapEntityInit)(struct MapEntity *me, u16 regionX, u16 regionY, u8 id);

// what makes each kind of place, by its index, in the act, its enemies, and the multiplayer ring game
extern const MapEntityInit gUnknown_080B806C[];
extern const MapEntityInit gUnknown_080B823C[];
extern const MapEntityInit gUnknown_080B82C8[];

void CreateEntity_ItemBox(struct MapEntity *me, u16 regionX, u16 regionY, u8 id);
void Task_EntitiesManager(void);

// how far a number is from 0
#define ABS(n) ((n) >= 0 ? (n) : -(n))
// where a place's own steps of 8 pixels, within its region of 256, are on the map
#define MAP_POS(pos, region) ((pos) * 8 + (region) * 256)
// the start of a region's list of places, by where it is among the regions
#define REGION_START(list, perRow, rx, ry) (*(u32 *)((u8 *)(list) + (perRow) * (ry) * 4 + (rx) * 4))

/** SpawnMapEntities, 0x080088A8: makes everything the act places within 128 pixels around the screen, and hands the
 *  manager's task over to Task_EntitiesManager. */
void SpawnMapEntities(void) {

  if (!(gStageFlags & 2)) {
    u32 i;
    u16 regionX, regionY;
    s16 range[4];
    u32 perRow, rows;
    struct EntitiesManagerLists *em = TASK_DATA(gCurTask);
    u32 *interactables;
    u32 *itemBoxes;
    u32 *enemies;

    interactables = em->interactables;
    if (gGameMode != 6) {
      enemies = em->enemies->offsets;
      itemBoxes = em->items->offsets;
    }

    interactables++;
    perRow = (u16)*interactables++;
    rows = (u16)*interactables++;

    range[0] = gStageCamera.x - 128;
    range[2] = gStageCamera.x + (240 + 128);
    range[1] = gStageCamera.y - 128;
    range[3] = gStageCamera.y + (160 + 128);

    if (range[0] < 0) range[0] = 0;
    if (range[1] < 0) range[1] = 0;
    if (range[2] < 0) range[2] = 0;
    if (range[3] < 0) range[3] = 0;

    // each compared as an unsigned number, as the original does
    if ((u32)range[0] >= MAP_POS(0, perRow)) range[0] = MAP_POS(0, perRow) - 1;
    if ((u32)range[1] >= MAP_POS(0, rows)) range[1] = MAP_POS(0, rows) - 1;
    if ((u32)range[2] >= MAP_POS(0, perRow)) range[2] = MAP_POS(0, perRow) - 1;
    if ((u32)range[3] >= MAP_POS(0, rows)) range[3] = MAP_POS(0, rows) - 1;

    regionY = range[1] >> 8;
    while (MAP_POS(0, regionY) < range[3] && regionY < rows) {
      regionX = range[0] >> 8;
      while (MAP_POS(0, regionX) < range[2] && regionX < perRow) {
        if (gGameMode != 6) {
          i = REGION_START(interactables, perRow, regionX, regionY);
          if (i != 0) {
            struct MapEntity *me = (void *)((u8 *)interactables + (i - 8));
            for (i = 0; (s8)me->x != -1; me++, i++) {
              if ((s8)me->x >= -2) {
                s16 x = MAP_POS(me->x, regionX);
                s16 y = MAP_POS(me->y, regionY);
                if (x >= range[0] && x <= range[2] && y >= range[1] && y <= range[3]) {
                  CALL(gUnknown_080B806C[me->index])(me, regionX, regionY, i);
                }
              }
            }
          }

          i = REGION_START(itemBoxes, perRow, regionX, regionY);
          if (i != 0) {
            struct MapEntityItemBox *me = (void *)((u8 *)itemBoxes + (i - 8));
            for (i = 0; (s8)me->x != -1; me++, i++) {
              if ((s8)me->x >= -2) {
                s16 x = MAP_POS(me->x, regionX);
                s16 y = MAP_POS(me->y, regionY);
                if (x >= range[0] && x <= range[2] && y >= range[1] && y <= range[3]) {
                  CreateEntity_ItemBox((void *)me, regionX, regionY, i);
                }
              }
            }
          }

          i = REGION_START(enemies, perRow, regionX, regionY);
          if (i != 0) {
            struct MapEntity *me = (void *)((u8 *)enemies + (i - 8));
            for (i = 0; (s8)me->x != -1; me++, i++) {
              if ((s8)me->x >= -2) {
                s16 x = MAP_POS(me->x, regionX);
                s16 y = MAP_POS(me->y, regionY);
                if (x >= range[0] && x <= range[2] && y >= range[1] && y <= range[3]) {
                  CALL(gUnknown_080B823C[me->index])(me, regionX, regionY, i);
                }
              }
            }
          }
        } else {
          i = REGION_START(interactables, perRow, regionX, regionY);
          if (i != 0) {
            struct MapEntity *me = (void *)((u8 *)interactables + (i - 8));
            for (i = 0; (s8)me->x != -1; me++, i++) {
              if ((s8)me->x >= -2) {
                s16 x = MAP_POS(me->x, regionX);
                s16 y = MAP_POS(me->y, regionY);
                if (x >= range[0] && x <= range[2] && y >= range[1] && y <= range[3]) {
                  CALL(gUnknown_080B82C8[me->index])(me, regionX, regionY, i);
                }
              }
            }
          }
        }
        regionX++;
      }
      regionY++;
    }

    em->prevCamX = gStageCamera.x;
    em->prevCamY = gStageCamera.y;
    em->spawnAll = 0;
    gCurTask->main = CODE(Task_EntitiesManager);
  }
}

/** Task_EntitiesManager, 0x08008CEC to 0x080095B4: each frame, makes what the act places in the strips the camera has
 *  just come to, across and down, or everything around the screen again when the camera jumped or the manager asks. */
void Task_EntitiesManager(void) {
  if (!(gStageFlags & 2)) {
    u32 i;
    u16 regionX, regionY;
    s16 across[4];
    s16 down[4];
    u32 perRow, rows;
    struct EntitiesManagerLists *em = TASK_DATA(gCurTask);
    u32 width, left, top, height;
    u32 *interactables;
    u32 *itemBoxes;
    u32 *enemies;

    if (em->spawnAll != 0) {
      SpawnMapEntities();
      return;
    }
    if (ABS(gStageCamera.x - em->prevCamX) > 248) {
      SpawnMapEntities();
      return;
    }
    if (ABS(gStageCamera.y - em->prevCamY) > 208) {
      SpawnMapEntities();
      return;
    }

    interactables = em->interactables;
    if (gGameMode != 6) {
      enemies = em->enemies->offsets;
      itemBoxes = em->items->offsets;
    }

    interactables++;
    perRow = (u16)*interactables++;
    rows = (u16)*interactables++;

    // the strip the camera came to across, as tall as the screen and 128 pixels more each way
    if (gStageCamera.x > em->prevCamX) {
      across[0] = em->prevCamX + (240 + 128);
      across[2] = gStageCamera.x + (240 + 128);
    } else {
      across[0] = gStageCamera.x - 128;
      across[2] = em->prevCamX - 128;
    }

    if (em->spawnAll != 0) {
      SpawnMapEntities();
      return;
    }

    across[1] = gStageCamera.y - 128;
    across[3] = gStageCamera.y + (160 + 128);

    // and the strip it came to down, as wide as the screen and 128 pixels more each way
    if (gStageCamera.y > em->prevCamY) {
      down[1] = em->prevCamY + (160 + 128);
      down[3] = gStageCamera.y + (160 + 128);
    } else {
      down[1] = gStageCamera.y - 128;
      down[3] = em->prevCamY - 128;
    }

    down[0] = gStageCamera.x - 128;
    down[2] = gStageCamera.x + (240 + 128);

    if (across[0] < 0) across[0] = 0;
    if (across[1] < 0) across[1] = 0;
    if (across[2] < 0) across[2] = 0;
    if (across[3] < 0) across[3] = 0;

    // the map's width and height, and the strip's left and top, each read once, as the original keeps them
    left = across[0];
    width = MAP_POS(0, perRow);
    if (left >= width) across[0] = width - 1;

    top = across[1];
    height = MAP_POS(0, rows);
    if (top >= height) across[1] = height - 1;

    if ((u32)across[2] >= width) across[2] = width - 1;
    if ((u32)across[3] >= height) across[3] = height - 1;

    if (down[0] < 0) down[0] = 0;
    if (down[1] < 0) down[1] = 0;
    if (down[2] < 0) down[2] = 0;
    if (down[3] < 0) down[3] = 0;

    if ((u32)down[0] >= width) down[0] = width - 1;
    if ((u32)down[1] >= height) down[1] = height - 1;
    if ((u32)down[2] >= width) down[2] = width - 1;
    if ((u32)down[3] >= height) down[3] = height - 1;

    if (gStageCamera.x != em->prevCamX && across[0] != across[2] && across[1] != across[3]) {
      regionY = across[1] >> 8;
      while (MAP_POS(0, regionY) < across[3] && regionY < rows) {
        regionX = across[0] >> 8;
        while (MAP_POS(0, regionX) < across[2] && regionX < perRow) {
          if (gGameMode != 6) {
            i = REGION_START(interactables, perRow, regionX, regionY);
            if (i != 0) {
              struct MapEntity *me = (void *)((u8 *)interactables + (i - 8));
              for (i = 0; (s8)me->x != -1; me++, i++) {
                if ((s8)me->x >= -2) {
                  s16 x = MAP_POS(me->x, regionX);
                  s16 y = MAP_POS(me->y, regionY);
                  if (x >= across[0] && x <= across[2] && y >= across[1] && y <= across[3]) {
                    CALL(gUnknown_080B806C[me->index])(me, regionX, regionY, i);
                  }
                }
              }
            }

            i = REGION_START(itemBoxes, perRow, regionX, regionY);
            if (i != 0) {
              struct MapEntityItemBox *me = (void *)((u8 *)itemBoxes + (i - 8));
              for (i = 0; (s8)me->x != -1; me++, i++) {
                if ((s8)me->x >= -2) {
                  s16 x = MAP_POS(me->x, regionX);
                  s16 y = MAP_POS(me->y, regionY);
                  if (x >= across[0] && x <= across[2] && y >= across[1] && y <= across[3]) {
                    CreateEntity_ItemBox((void *)me, regionX, regionY, i);
                  }
                }
              }
            }

            i = REGION_START(enemies, perRow, regionX, regionY);
            if (i != 0) {
              struct MapEntity *me = (void *)((u8 *)enemies + (i - 8));
              for (i = 0; (s8)me->x != -1; me++, i++) {
                if ((s8)me->x >= -2) {
                  s16 x = MAP_POS(me->x, regionX);
                  s16 y = MAP_POS(me->y, regionY);
                  if (x >= across[0] && x <= across[2] && y >= across[1] && y <= across[3]) {
                    CALL(gUnknown_080B823C[me->index])(me, regionX, regionY, i);
                  }
                }
              }
            }
          } else {
            i = REGION_START(interactables, perRow, regionX, regionY);
            if (i != 0) {
              struct MapEntity *me = (void *)((u8 *)interactables + (i - 8));
              for (i = 0; (s8)me->x != -1; me++, i++) {
                if ((s8)me->x >= -2) {
                  s16 x = MAP_POS(me->x, regionX);
                  s16 y = MAP_POS(me->y, regionY);
                  if (x >= across[0] && x <= across[2] && y >= across[1] && y <= across[3]) {
                    CALL(gUnknown_080B82C8[me->index])(me, regionX, regionY, i);
                  }
                }
              }
            }
          }
          regionX++;
        }
        regionY++;
      }
    }

    if (gStageCamera.y != em->prevCamY && down[1] != down[3] && down[0] != down[2]) {
      regionY = down[1] >> 8;
      // the region's top worked out in a block of its own, as the original's compiler kept it apart
      while (({ MAP_POS(0, regionY); }) < down[3] && regionY < rows) {
        regionX = down[0] >> 8;
        while (MAP_POS(0, regionX) < down[2] && regionX < perRow) {
          if (gGameMode != 6) {
            i = REGION_START(interactables, perRow, regionX, regionY);
            if (i != 0) {
              struct MapEntity *me = (void *)((u8 *)interactables + (i - 8));
              for (i = 0; (s8)me->x != -1; me++, i++) {
                if ((s8)me->x >= -2) {
                  s16 x = MAP_POS(me->x, regionX);
                  s16 y = MAP_POS(me->y, regionY);
                  if (x >= down[0] && x <= down[2] && y >= down[1] && y <= down[3]) {
                    CALL(gUnknown_080B806C[me->index])(me, regionX, regionY, i);
                  }
                }
              }
            }

            i = REGION_START(itemBoxes, perRow, regionX, regionY);
            if (i != 0) {
              struct MapEntityItemBox *me = (void *)((u8 *)itemBoxes + (i - 8));
              for (i = 0; (s8)me->x != -1; me++, i++) {
                if ((s8)me->x >= -2) {
                  s16 x = MAP_POS(me->x, regionX);
                  s16 y = MAP_POS(me->y, regionY);
                  if (x >= down[0] && x <= down[2] && y >= down[1] && y <= down[3]) {
                    CreateEntity_ItemBox((void *)me, regionX, regionY, i);
                  }
                }
              }
            }

            i = REGION_START(enemies, perRow, regionX, regionY);
            if (i != 0) {
              struct MapEntity *me = (void *)((u8 *)enemies + (i - 8));
              for (i = 0; (s8)me->x != -1; me++, i++) {
                if ((s8)me->x >= -2) {
                  s16 x = MAP_POS(me->x, regionX);
                  s16 y = MAP_POS(me->y, regionY);
                  if (x >= down[0] && x <= down[2] && y >= down[1] && y <= down[3]) {
                    CALL(gUnknown_080B823C[me->index])(me, regionX, regionY, i);
                  }
                }
              }
            }
          } else {
            i = REGION_START(interactables, perRow, regionX, regionY);
            if (i != 0) {
              struct MapEntity *me = (void *)((u8 *)interactables + (i - 8));
              for (i = 0; (s8)me->x != -1; me++, i++) {
                if ((s8)me->x >= -2) {
                  s16 x = MAP_POS(me->x, regionX);
                  s16 y = MAP_POS(me->y, regionY);
                  if (x >= down[0] && x <= down[2] && y >= down[1] && y <= down[3]) {
                    CALL(gUnknown_080B82C8[me->index])(me, regionX, regionY, i);
                  }
                }
              }
            }
          }
          regionX++;
        }
        regionY++;
      }
    }

    em->prevCamX = gStageCamera.x;
    em->prevCamY = gStageCamera.y;
  }
}
