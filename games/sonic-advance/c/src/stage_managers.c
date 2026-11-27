// Player spawning, player state reset, rings scatter, rings manager, and entities manager setup in C.
#include "malloc.h"
#include "stage_init.h"

extern const s16 gUnknown_084A6DEC[][2];
extern const s16 gUnknown_084A6E34[][4][2];
extern struct PlayerSpriteInfo gUnknown_03005BE0;
extern struct PlayerSpriteInfo gUnknown_03005B90;
extern struct PlayerSpriteInfo gUnknown_03005C30;
extern struct PlayerSpriteInfo gUnknown_03005B40;
extern const u32 *const gUnknown_080B7F4C[];
extern const u32 *const gUnknown_080B7F94[];
extern const u32 *const gUnknown_080B7FDC[];
extern const u32 *const gUnknown_080B8024[];
extern const void *gUnknown_02033008;
extern const u32 *gUnknown_0203300C;

void Task_RingsScatterMulti(void);
void TaskDestructor_RingsScatter(struct Task *t);
void Task_RingsManager(void);
void TaskDestructor_RingsManager(struct Task *t);
void Task_EntitiesManager(void);
void TaskDestructor_EntitiesManager(struct Task *t);

#define SIO_ID ((REG_READ32(REG_SIOCNT) << 26) >> 30)

/** InitPlayer, 0x080421E8: assigns character, player ID, spawn coordinates, and sprite info buffers. */
void InitPlayer(s32 character, s32 level, u32 id, struct StagePlayer *player) {
  player->playerId = id;
  player->character = character;

  if (gGameMode <= 3) {
    player->spawnX = gUnknown_084A6DEC[level][0];
    player->spawnY = gUnknown_084A6DEC[level][1];
  } else if (gGameMode == 4) {
    u32 sioId = SIO_ID;
    player->spawnX = gUnknown_084A6E34[level - 14][sioId][0];
    player->spawnY = gUnknown_084A6E34[level - 14][sioId][1];
  } else if (gGameMode == 5) {
    u32 sioId = SIO_ID;
    if (level == 16) {
      player->spawnX = gUnknown_084A6E34[level - 14][SIO_ID][0];
      player->spawnY = gUnknown_084A6E34[level - 14][SIO_ID][1];
    } else {
      s32 team = (s32)(gMultiplayerConnections & (0x10 << sioId)) >> (sioId + 4);
      s32 count = 0;
      u32 i;
      for (i = 0; i < sioId; i++) {
        if (((s32)(gMultiplayerConnections & (0x10 << i)) >> (i + 4)) == team) {
          count++;
        }
      }
      if (team == 0) {
        count = -count;
      }
      player->spawnX = gUnknown_084A6E34[level - 14][team][0] + count * 24;
      player->spawnY = gUnknown_084A6E34[level - 14][team][1];
    }
  } else {
    switch ((s32)SIO_ID) {
      case 0:
        player->spawnX = 232;
        player->spawnY = 0x33D;
        break;
      case 1:
        player->spawnX = 0x631;
        player->spawnY = 0x39E;
        break;
      case 2:
        player->spawnX = 232;
        player->spawnY = 348;
        break;
      case 3:
        player->spawnX = 0x631;
        player->spawnY = 0x117;
        break;
    }
  }

  player->unk6C = 0;
  player->unk4C = 0;
  if (id == 0) {
    player->bodySprite = &gUnknown_03005BE0;
    player->tailSprite = &gUnknown_03005B90;
  } else {
    player->bodySprite = &gUnknown_03005C30;
    player->tailSprite = &gUnknown_03005B40;
  }
}

/** PlayerResetSpriteBuffers, 0x080423F4: resets a player's physics, timers, animation state, and character union. */
void PlayerResetSpriteBuffers(struct StagePlayer *p) {
  u16 keys;
  s32 i;
  u32 *ptr;

  p->x = p->spawnX << 8;
  p->y = p->spawnY << 8;
  keys = gUnknown_030060E0[0];
  keys |= gUnknown_030060E0[1];
  p->unk38 = keys;
  p->unk3A = keys;
  p->speedAirX = 0;
  p->speedAirY = 0;
  p->speedGroundX = 0;
  p->moveState = 0x200000;
  p->unk14 = 0;
  p->unkE = 6;
  p->unkF = 14;
  p->unk15 = 120;
  p->unk16 = 0;
  p->unk19 = 0;
  p->unk18 = 0;
  p->unk27 = 1;
  p->unk2C = 0x480;
  p->unk30 = 8;
  p->unk34 = 96;
  p->unk40 = 0;
  p->unk41 = 0;
  p->anim = 0xFFFF;
  p->variant = -1;
  p->unk1C = 0;
  p->unk1E = 0;
  p->unk20 = 0;
  p->unk22 = 0;
  p->unk28 = 0;
  p->itemEffect = 0;
  p->unk1A = 0;
  p->unk46 = 360;
  p->unk52 = 0;
  p->unk50 = 0;
  p->unk56 = 0x100;
  p->unk54 = 0x100;
  p->unk58 = 0;
  p->unk3D = 0;
  p->unk3E = 0;
  p->unk3F = 0;
  p->unk5A = 30;
  p->unk5B = 60;
  p->unk5C = 10;

  ptr = (u32 *)p->unk6D;
  i = 3;
  do {
    *ptr++ = 0;
  } while (i-- != 0);

  p->unk6D[0] = 127;

  if (p->playerId == 0 && gGameMode <= 1) {
    if (gUnknown_03005034 > 0x8C9F) {
      gUnknown_03004FE4 = 0;
      gUnknown_03005034 = 0;
      p->unk4C = 0;
    } else {
      gUnknown_03004FE4 = p->unk4C;
      gUnknown_03005034 = p->unk4C;
    }
  }

  switch (p->character) {
    case 0:
      p->charState.sonic.unk80 = 0;
      p->charState.sonic.unk82 = 0;
      p->charState.sonic.unk84 = 0;
      break;
    case 1:
      p->charState.tails.unk80 = 0;
      p->charState.tails.unk84 = 0;
      p->charState.tails.unk81 = 0;
      break;
    case 2:
      p->charState.knuckles.unk80 = 0;
      p->charState.knuckles.unk81 = 0;
      p->charState.knuckles.unk82 = 0;
      break;
    case 3:
      p->charState.amy.unk80 = 0;
      break;
  }
}

/** CreateRingsScatterTask, 0x080409C4: spawns the scattered-rings task and initializes its sprite and ring pool. */
void CreateRingsScatterTask(void) {
  struct Task *t;
  struct RingsScatter *rs;
  u16 *rings;

  if (gGameMode > 1) {
    gRingsScatterTask = t = TaskCreate(CODE(Task_RingsScatterMulti), sizeof(struct RingsScatter), 0x2001, 0, CODE(TaskDestructor_RingsScatter));
  } else {
    gRingsScatterTask = t = TaskCreate(CODE(PlayerCollisionDispatch), sizeof(struct RingsScatter), 0x2001, 0, CODE(TaskDestructor_RingsScatter));
  }

  rs = TASK_DATA(t);
  rs->s.x = 0;
  rs->s.y = 0;
  rs->s.graphics.dest = (void *)0x06011D00;
  rs->s.oamFlags = 0x500;
  rs->s.graphics.size = 0;
  rs->s.graphics.anim = 0x2C3;
  rs->s.variant = 0;
  rs->s.animCursor = 0;
  rs->s.qAnimDelay = 0;
  rs->s.prevVariant = 0xFF;
  rs->s.animSpeed = 0x20;
  rs->s.palId = 0;
  rs->s.frameFlags = 0x2000;
  rs->unk336 = 0;

  if (gCurrentLevel != 13) {
    rs->unk334 = 0xE0;
    rs->unk330 = 18;
  } else {
    rs->unk334 = 0xE0;
    rs->unk330 = 7;
  }

  rings = rs->rings;
  DMA3_FILL16(0, rings, sizeof(rs->rings));
}

/** CreateStageRingsManager, 0x08007D30: spawns the stage rings manager task and decompresses the level's rings layout. */
void CreateStageRingsManager(void) {
  struct Task *t;
  void *buf;
  struct Sprite *s;

  if (gGameMode != 6) {
    t = TaskCreate(CODE(Task_RingsManager), sizeof(struct RingsManager), 0x2000, 0, CODE(TaskDestructor_RingsManager));
    buf = EwramMalloc((*gUnknown_080B7F4C[gCurrentLevel]) >> 8);
    RLUnCompWram(gUnknown_080B7F4C[gCurrentLevel], buf);
  } else {
    t = TaskCreate(CODE(Task_RingsManager), sizeof(struct RingsManager), 0x2000, 0, NULL);
    buf = (void *)(0x0203F000 + ((((*gUnknown_0203300C >> 8) + 3) >> 2) << 4));
    RLUnCompWram(gUnknown_02033008, buf);
  }

  *(void **)((u8 *)TASK_DATA(t) + 0x30) = buf;
  s = TASK_DATA(t);
  s->x = 0;
  s->y = 0;
  s->graphics.dest = (void *)0x06011D00;
  s->oamFlags = 0x500;
  s->graphics.size = 0;
  s->graphics.anim = 0x2C3;
  s->variant = 0;
  s->animCursor = 0;
  s->qAnimDelay = 0;
  s->prevVariant = 0xFF;
  s->animSpeed = 0x10;
  s->palId = 0;
  s->frameFlags = 0x2000;
}

/** CreateEntitiesManager, 0x08008784: spawns the stage entities manager task and decompresses interactables, items, and enemies. */
void CreateEntitiesManager(void) {
  struct Task *t;
  struct EntitiesManager *em;
  void *buf;

  if (gGameMode != 6) {
    t = TaskCreate(CODE(Task_EntitiesManager), sizeof(struct EntitiesManager), 0x2000, 0, CODE(TaskDestructor_EntitiesManager));
  } else {
    t = TaskCreate(CODE(Task_EntitiesManager), sizeof(struct EntitiesManager), 0x2000, 0, NULL);
  }

  em = TASK_DATA(t);

  if (gGameMode != 6) {
    buf = EwramMalloc((*gUnknown_080B7F94[gCurrentLevel]) >> 8);
    RLUnCompWram(gUnknown_080B7F94[gCurrentLevel], buf);
    em->IA = buf;

    buf = EwramMalloc((*gUnknown_080B7FDC[gCurrentLevel]) >> 8);
    RLUnCompWram(gUnknown_080B7FDC[gCurrentLevel], buf);
    em->items = buf;

    buf = EwramMalloc((*gUnknown_080B8024[gCurrentLevel]) >> 8);
    RLUnCompWram(gUnknown_080B8024[gCurrentLevel], buf);
    em->enemies = buf;
  } else {
    buf = (void *)0x0203F000;
    RLUnCompWram(gUnknown_0203300C, buf);
    em->IA = buf;
  }

  em->prevCamX = gStageCamera.x;
  em->prevCamY = gStageCamera.y;
  em->unk10 = 1;
  gEntitiesManagerTask = t;
}
