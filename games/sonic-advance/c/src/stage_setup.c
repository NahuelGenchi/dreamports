// Stage setup, main stage loop, music manager, water init, and input history in C.
#include "stage_init.h"

void m4aSongNumStop(u16 n);

// External functions called by stage setup / loop (addresses in addresses.json)
void TaskDestructor_GameStage(struct Task *t);
void StageInitCounters(void);
struct Task *CreateStageUI(void);
void StageSetupMultiplayerRings(void);
void CreateStageRingsManager(void);
void CreateEntitiesManager(void);
u32 CheckEmeraldFlag(void);
void StageInitCollectRings(void);
void StageInitMultiplayerA(void);
void StageInitMultiplayerB(void);
void StageCreateMultiplayerPlayer(u8 id);
void StageCreateMultiplayerIndicator(u8 id);
u32 StageCreateMultiplayerItem(u8 unk0, u8 index);
void CreatePauseMenu(void);
void StageCreateDrowningOverlay(u16 a, u8 b, u8 c, s8 d, u16 e);
void StageMultiplayerTimeOver(void);
void StageMusicResume(void);
void Task_WaterUpdate(void);
void TaskDestructor_Water(struct Task *t);

typedef void (*VoidFunc)(void);
extern const VoidFunc gUnknown_084A6A18[];
extern const u16 gUnknown_084A6A08[];
extern const u16 gUnknown_084A69E4[];

struct StageMPlayInfo {
  /* 0x00 */ const void *songHeader;
  /* 0x04 */ union {
    u32 status;
    vu16 statusLo;
  } u;
};

struct StageMPlayEntry {
  /* 0x00 */ struct StageMPlayInfo *info;
  /* 0x04 */ void *track;
  /* 0x08 */ u8 unk8;
  /* 0x0A */ u16 unkA;
};

struct StageSongEntry {
  /* 0x00 */ const void *header;
  /* 0x04 */ u16 ms;
  /* 0x06 */ u16 me;
};

extern const struct StageMPlayEntry gStageMPlayTable[];
extern const struct StageSongEntry gStageSongTable[];
extern struct StageMPlayInfo gStageMPlayInfo_BGM;

/** InitPlayerWrapper, 0x08046C84: forwards player initialization to InitPlayer. */
void InitPlayerWrapper(s32 character, s32 level, u32 id, struct StagePlayer *player) {
  InitPlayer(character, level, id, player);
}

/** RecordInputHistory, 0x0804D108: shifts the 60-frame input and pressed-key history rings and inserts the latest keys. */
void RecordInputHistory(u16 keys) {
  u16 *heldDst = &gUnknown_030060F0[59];
  u16 *pressedDst = &gUnknown_03006170[59];
  s32 i = 58;
  u16 *heldSrc;
  u16 *pressedSrc;

  do {
    heldSrc = heldDst - 1;
    *heldDst = *heldSrc;
    heldDst = heldSrc;

    pressedSrc = pressedDst - 1;
    *pressedDst = *pressedSrc;
    pressedDst = pressedSrc;

    i--;
  } while (i >= 0);

  *heldSrc = keys;
  *pressedSrc = keys & ~heldSrc[1];
}

/** InitWater, 0x0804C5A4: initializes stage water state and spawns the water surface task when height is non-negative. */
void InitWater(s32 height, u32 unkC, u32 flags) {
  struct StageWater *water = &gStageWater;

  water->currentWaterLevel = height;
  water->targetWaterLevel = height;
  water->unk1 = 0xFF;
  water->unk0 = -1;
  water->isActive = flags & 0x100;
  water->unkC = unkC;

  if (height >= 0) {
    struct Sprite *s = &water->s;

    s->graphics.dest = (void *)0x06012660;
    s->graphics.size = 0;
    s->graphics.anim = 0x233;
    s->variant = 0;
    s->prevVariant |= -1;
    s->oamFlags = 0;
    s->qAnimDelay = 0;
    s->animSpeed = 0x10;
    s->palId = 0;
    s->frameFlags = 0;
    UpdateSpriteAnimation(s);

    water->t = TaskCreate(CODE(Task_WaterUpdate), 0, 0xFFFE, 0, CODE(TaskDestructor_Water));
  }
}

/** Task_StageMusicManager, 0x0803C944: arbitrates stage BGM, drowning, invincibility, boss, and extra-life jingles. */
void Task_StageMusicManager(void) {
  const void *header = gStageMPlayTable[0].info->songHeader;

  if (gUnknown_03005040[0] != 0) return;
  if (gStagePlayer.moveState & 0x80) return;

  if (header == gStageSongTable[27].header) {
    u32 status = gStageMPlayInfo_BGM.u.status;
    if (gStageMPlayInfo_BGM.u.statusLo != 0 && !(status & 0x80000000)) {
      gUnknown_03005040[2] = 0;
      gUnknown_03005040[3] = 0;
      return;
    }
  }

  if (gUnknown_03005040[4] != 0) {
    gUnknown_03005040[4] = 0;
    m4aSongNumStart(27);
    return;
  }

  if (header == gStageSongTable[28].header) {
    s32 status = gStageMPlayInfo_BGM.u.status;
    if (gStageMPlayInfo_BGM.u.statusLo != 0 && status >= 0) {
      if (!(gStagePlayer.itemEffect & 2)) {
        m4aSongNumStop(28);
        return;
      }
    }
  }

  if (header != gStageSongTable[0x133].header && header != gStageSongTable[28].header && (gStagePlayer.itemEffect & 2)) {
    if (gUnknown_03005040[2] == 0) {
      gUnknown_03005040[2] = 0;
      m4aSongNumStart(28);
      StageMusicResume();
      return;
    }
    goto play28;
  }

  if (gUnknown_03005040[2] != 0) {
  play28:
    gUnknown_03005040[2] = 0;
    m4aSongNumStart(28);
    return;
  }

  if (gUnknown_03005040[3] != 0) {
    gUnknown_03005040[3] = 0;
    m4aSongNumStart(0x133);
    return;
  }

  if ((gUnknown_03005040[1] & 0xF0) == 0x10) {
    gUnknown_03005040[1] &= 0x0F;
    m4aSongNumStart(gUnknown_084A6A08[gUnknown_03005040[1]]);
    gUnknown_03005040[1] |= 0x20;
    return;
  }

  if ((gUnknown_03005040[1] & 0xF0) == 0x30) {
    gUnknown_03005040[1] &= 0x0F;
    m4aSongNumStop(gUnknown_084A6A08[gUnknown_03005040[1]]);
    m4aSongNumStart(gUnknown_084A69E4[gCurrentLevel]);
    StageMusicResume();
    if ((u8)(gUnknown_03005040[1] - 4) > 1) {
      gUnknown_03005040[0] = 0xFF;
    }
    gUnknown_03005040[1] = 0;
    return;
  }

  {
    s32 status = gStageMPlayInfo_BGM.u.status;
    if (gStageMPlayInfo_BGM.u.statusLo == 0 || status < 0) {
      if ((gUnknown_03005040[1] & 0xF0) == 0x20) {
        m4aSongNumStart(gUnknown_084A6A08[gUnknown_03005040[1] & 0x0F]);
        StageMusicResume();
      } else {
        m4aSongNumStart(gUnknown_084A69E4[gCurrentLevel]);
        StageMusicResume();
      }
    }
  }
}

#ifdef MATCHING
struct StageSioBits {
  u32 baudRate : 2;
  u32 si : 1;
  u32 sd : 1;
  u32 id : 2;
  u32 error : 1;
  u32 enable : 1;
  u32 unused : 6;
  u32 intrEnable : 1;
};
#define STAGE_SIO_ID (((volatile struct StageSioBits *)0x04000128)->id)
#else
#define STAGE_SIO_ID ((u32)((REG_READ16(REG_SIOCNT) >> 4) & 3))
#endif

/** Task_GameStageMain, 0x0803D25C: the stage's own task each frame: the pause menu, the clocks, the multiplayer random
 *  numbers and spectator camera, and the end of the time. */
void Task_GameStageMain(void) {
  u16 sioId = STAGE_SIO_ID;
  u32 timeStep;

  if (gGameMode <= 1) {
    if (!(gStageFlags & 0x20) && (gPressedKeys & 8) && !(gStageFlags & 0x40)) {
      CreatePauseMenu();
    }
    gUnknown_03005120++;
    timeStep = 1;
  } else {
    u32 frames = gFrameCount - gUnknown_03005038;
    timeStep = frames - gUnknown_03005120;
    gUnknown_03005120 = frames;

    if (gGameMode > 3) {
      if ((frames & ~0x1FF) != ((frames - timeStep) & ~0x1FF)) {
        u32 mask, rand;
        gUnknown_03005010 = gUnknown_03005010 * 0x196225 + 0x3C6EF35F;
        if ((frames & ~0xFFF) != ((frames - timeStep) & ~0xFFF)) {
          u32 value = (gUnknown_03005074 >> 4) + 1;
          gUnknown_03005074 = (gUnknown_03005074 & 0xF) | (value * 16);
        }
        rand = gUnknown_03005010;
        mask = 7;
        gUnknown_03005074 = (gUnknown_03005074 & 0xF8) | (rand & mask);
      }
    } else if ((frames & ~0x3F) != ((frames - timeStep) & ~0x3F)) {
      gUnknown_03005010 = gUnknown_03005010 * 0x196225 + 0x3C6EF35F;
    }

    if (gStageCamera.unk26 & 4) {
      if ((gInput & 0x300) == 0x300) {
        if (sioId != 3) {
          gStageCamera.unk3A = 3;
        } else {
          gStageCamera.unk3A = 2;
        }
      } else if (gInput & 0x200) {
        if (sioId == 0) {
          gStageCamera.unk3A = 1;
        } else {
          gStageCamera.unk3A = 0;
        }
      } else if (gInput & 0x100) {
        if (sioId < 2) {
          gStageCamera.unk3A = 2;
        } else {
          gStageCamera.unk3A = 1;
        }
      } else {
        gStageCamera.unk3A = sioId;
      }
    } else {
      gStageCamera.unk3A = sioId;
    }

    if (!((gMultiplayerConnections >> gStageCamera.unk3A) & 1)) {
      gStageCamera.unk3A = sioId;
    }

    if (gUnknown_03004FE0 != 0) {
      gUnknown_03004FE0--;
    }
  }

  gUnknown_0300502C = gStageFlags;

  if (gStageFlags & 1) return;

  gUnknown_03004FE4 += timeStep;

  if (gStageFlags & 4) {
    gUnknown_03005034 -= timeStep;
    if ((s32)gUnknown_03005034 > 0) return;

    if (gGameMode <= 1) {
      gStageFlags |= 1;
      // the save's byte at 0x1A, which turns the time limit off
      if (gLoadedSaveGame.language) return;

      gStagePlayer.itemEffect = 0;
      if (gStagePlayer.moveState & 0x40) {
        gStagePlayer.speedAirY = -0x2A0;
      } else {
        gStagePlayer.speedAirY = -0x4E0;
      }
      if (gCurrentLevel == 10) {
        StageCreateDrowningOverlay(0x800, 8, 16, -1, 0xD0);
      }
      gStagePlayer.moveState |= 0x80;
      m4aSongNumStart(166);
    } else {
      gStageFlags |= 1;
      StageMultiplayerTimeOver();
    }
  } else {
    gUnknown_03005034 += timeStep;
    if (gUnknown_03005034 <= 0x8CA0) return;

    if (gGameMode <= 1) {
      gStageFlags |= 1;
      if (gLoadedSaveGame.language && (gGameMode == 0 || gGameMode > 1)) return;

      gStagePlayer.itemEffect = 0;
      if (gStagePlayer.moveState & 0x40) {
        gStagePlayer.speedAirY = -0x2A0;
      } else {
        gStagePlayer.speedAirY = -0x4E0;
      }
      gStagePlayer.moveState |= 0x80;
      m4aSongNumStart(166);
    } else {
      gStageFlags |= 1;
      StageMultiplayerTimeOver();
    }
  }
}

/** StageInit, 0x0803CF68: creates stage tasks, initializes players, camera, entities, rings, water, and multiplayer slots. */
void StageInit(void) {
  struct Task *uiTask;
  u8 i;

  gGameStageTask = TaskCreate(CODE(Task_GameStageMain), 0, 0xFF00, 0, CODE(TaskDestructor_GameStage));
  gUnknown_03004FFC = 0;
  gStageFlags |= 0x21;
  gStageFlags &= ~0x80;

  StageInitCounters();
  sub_803CB18();

  if (gGameMode != 6) {
    uiTask = CreateStageUI();
  }

  gUnknown_03004FE0 = 0;
  if (gGameMode == 6) {
    StageSetupMultiplayerRings();
  }

  if (gGameMode > 1) {
    InitPlayerSprite(gSelectedCharacter, gCurrentLevel, &gStagePlayer);
  } else if (gCurrentLevel == 13) {
    InitPlayerSprite(gSelectedCharacter, gCurrentLevel, &gStagePlayer);
  } else {
    InitPlayerSprite(gSelectedCharacter, gCurrentLevel, &gStagePlayer);
    if ((s8)gUnknown_03005088 == 2) {
      InitPlayerSprite(1, gCurrentLevel, &gStagePartner);
    }
  }

  if (gGameMode != 6) {
    InitCamera(gCurrentLevel);
  } else {
    InitCamera(0);
  }

  gStageFlags &= ~2;
  gStageFlags &= ~4;
  if (gGameMode > 3) {
    gStageFlags |= 4;
  }

  CreateStageRingsManager();
  CreateEntitiesManager();

  if ((gCurrentLevel >> 1) != 3) {
    InitWater(-1, 0, 0);
  }

  if (gGameMode != 6) {
    CALL(gUnknown_084A6A18[gCurrentLevel])();
    if (gCurrentLevel == 2 && CheckEmeraldFlag() != 0) {
      ((u8 *)TASK_DATA(uiTask))[0x27] = 1;
    }
  } else {
    StageInitCollectRings();
  }

  gUnknown_03001204 = 0;
  gUnknown_030010B0 = 0x100;
  gUnknown_03004C34 = 0x100;
  gUnknown_0300232C = 120;
  gUnknown_030045F4 = 80;
  gUnknown_0300120C = 120;
  gUnknown_030020C0 = 80;
  gUnknown_03004C38 = 0x80;

  if (gGameMode > 1) {
    StageInitMultiplayerA();
    StageInitMultiplayerB();
    gUnknown_03005074 = 0;

    for (i = 0; i < 4; i++) {
      gUnknown_03004FE8[i] = 0;
      if ((gMultiplayerConnections >> i) & 1) {
        StageCreateMultiplayerPlayer(i);
        if (i != ((REG_READ32(REG_SIOCNT) << 26) >> 30)) {
          StageCreateMultiplayerIndicator(i);
        }
      }
      gMultiplayerRanks[i] = 0xFF;
      if (gGameMode == 6) {
        gMultiplayerCharacters[i] = i;
      }
    }

    if ((u8)(gGameMode - 4) <= 1) {
      u32 idx = 0;
      u32 *slot = gUnknown_03004FF0;
      while (idx <= 2) {
        *slot = StageCreateMultiplayerItem(*(u8 *)slot, (u8)idx);
        if (gGameMode == 4) break;
        slot++;
        idx++;
      }
    }

    if (gGameMode != 6) {
      gStagePlayer.itemEffect |= 0x80;
    }
  } else {
    for (i = 0; i < 4; i++) {
      gMultiplayerRanks[i] |= 0xFF;
    }
  }
}

/** ApplyGameStageSettingsAndStart, 0x0803DBA0: a new score and lives, the difficulty kept aside in the modes that play at
 *  normal, the time limit, and then the stage. */
void ApplyGameStageSettingsAndStart(void) {
  gUnknown_03005030 = 0;
  gUnknown_03005024 = 3;
  gUnknown_03005020 = gCurrentLevel;

  if (gGameMode > 1) {
    gUnknown_03005024 = 1;
  }

  if ((u8)(gGameMode - 1) <= 2 || (gStageFlags & 0x40)) {
    gUnknown_03005080 = gLoadedSaveGame.difficultyLevel;
    gLoadedSaveGame.difficultyLevel = 0;
  }

  StageSetTimeLimit(gLoadedSaveGame.timeLimitDisabled);
  CreateGameStage();
}
