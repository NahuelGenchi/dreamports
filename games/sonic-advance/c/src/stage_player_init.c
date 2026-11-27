// Stage collision cache, braking dust stub, and player sprite initialization in C.
#include "stage_init.h"

int Div(int num, int denom);
void TaskDestructor_BrakingDust(struct Task *t);
void PlayerCollisionHelperA(void);
void PlayerCollisionHelperB(void);
void Task_PlayerMoonZone(void);
void Task_PlayerMain(void);
void Task_PartnerMain(void);
void TaskDestructor_Player(struct Task *t);
void PlayerResetSpriteBuffers(struct StagePlayer *player);
void CreateRingsScatterTask(void);
void InputRecorderReset(void);
void InitMoonZonePlayer(struct StagePlayer *player);

struct PlayerSpriteTaskData {
  /* 0x00 */ u8 id;
  /* 0x04 */ u32 unk4;
};

/** StageInitCounters, 0x0804012C: clears the X and Y metatile division caches. */
void StageInitCounters(void) {
  DMA3_FILL32(0, &gStageColCacheX, sizeof(struct StageColCache));
  DMA3_FILL32(0, &gStageColCacheY, sizeof(struct StageColCache));
}

/** CreateBrakingDustTask, 0x080405B0: spawns the braking-dust placeholder task if not already present. */
void CreateBrakingDustTask(void) {
  if (gStageBrakingDust.t == NULL) {
    gStageBrakingDust.t = TaskCreate(CODE(Task_BrakingDustDummy), 0, 0x4000, 0, CODE(TaskDestructor_BrakingDust));
    gStageBrakingDust.unk0 = 20;
  }
}

/** Task_BrakingDustDummy, 0x08040610: idle task body for braking dust. */
void Task_BrakingDustDummy(void) {}

/** PlayerCollisionDispatch, 0x08041FAC: dispatches stage player collision update based on stage flag bit 7. */
void PlayerCollisionDispatch(void) {
  if (gStageFlags & 0x80) {
    PlayerCollisionHelperA();
  } else {
    PlayerCollisionHelperB();
  }
}

/** InitPlayerSprite, 0x08041FF8: creates the player or partner task and initializes its body and tail sprites. */
void InitPlayerSprite(s32 character, s32 level, struct StagePlayer *player) {
  s32 id = player->playerId;
  struct PlayerSpriteTaskData *data;

  if (id == 0) {
    if (level == 13) {
      player->spriteTask = TaskCreate(CODE(Task_PlayerMoonZone), 140, 0x3000, 0, CODE(TaskDestructor_Player));
    } else {
      player->spriteTask = TaskCreate(CODE(Task_PlayerMain), 8, 0x3000, 0, CODE(TaskDestructor_Player));
    }
    data = TASK_DATA(player->spriteTask);
    data->id = id;
    data->unk4 = 0;

    PlayerResetSpriteBuffers(player);
    CreateBrakingDustTask();
    CreateRingsScatterTask();

    {
      s32 mode = gInputRecorder.mode;
      if (mode == 1) {
        goto reset_recorder;
      }
      if (mode == 2) {
      reset_recorder:
        InputRecorderReset();
        gInputRecorder.mode = mode;
      }
    }
  } else {
    struct Task *t = TaskCreate(CODE(Task_PartnerMain), 8, 0x3001, 0, CODE(TaskDestructor_Player));
    player->spriteTask = t;
    data = TASK_DATA(t);
    data->id = id;
    data->unk4 = 0;
    PlayerResetSpriteBuffers(player);
  }

  InitPlayerBodySprite(player, player->bodySprite);
  InitPlayerTailSprite(player, player->tailSprite);
  if (level == 13) {
    InitMoonZonePlayer(player);
  }
}

/** InitPlayerBodySprite, 0x080420D0: initializes a player's main sprite and transform fields. */
void InitPlayerBodySprite(struct StagePlayer *p, struct PlayerSpriteInfo *info) {
  s32 id = p->playerId;
  struct PlayerSprite2 *s = &info->s;

  if (id == 0) {
    s->graphics.dest = (void *)OBJ_VRAM0;
  } else {
    s->graphics.dest = VramMalloc(64);
  }

  s->graphics.size = 0;
  s->graphics.anim = p->anim;
  s->variant = p->variant;
  s->prevVariant = 0xFF;
  s->x = p->x >> 8;
  s->y = p->y >> 8;
  s->oamFlags = 0x400;
  s->qAnimDelay = 0;
  s->animSpeed = 0x10;
  s->palId = 0;
  s->frameFlags = 0x2000;
  if (gGameMode > 1) {
    s->frameFlags |= 0xC0000;
  }
  s->frameFlags |= 0x20;
  s->frameFlags |= id;
  s->hitboxes[0].index = -1;
  s->hitboxes[1].index = -1;

  info->rotation = 0;
  info->scaleX = 0x100;
  info->scaleY = 0x100;
  info->x = 0;
  info->y = 0;
}

/** InitPlayerTailSprite, 0x08042178: initializes Tails' secondary tail sprite and transform fields. */
void InitPlayerTailSprite(struct StagePlayer *p, struct PlayerSpriteInfo *info) {
  struct PlayerSprite2 *s = &info->s;
  s32 character = p->character;

  if (character == 1) {
    s->graphics.dest = VramMalloc(16);
    s->graphics.size = 0;
    s->graphics.anim = 107;
    s->variant = character;
    s->prevVariant = 0xFF;
    s->x = p->x >> 8;
    s->y = p->y >> 8;
    s->oamFlags = 0x440;
    s->qAnimDelay = 0;
    s->animSpeed = 0x10;
    s->palId = 0;
    s->frameFlags = 0x2024;

    info->rotation = 0;
    info->scaleX = 0x100;
    info->scaleY = 0x100;
    info->x = 0;
    info->y = 0;
  }
}
