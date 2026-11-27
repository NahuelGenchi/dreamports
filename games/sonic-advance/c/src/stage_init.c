// Stage startup, camera setup, and BIOS RLE helper in C.
#include "stage_init.h"
#ifdef MATCHING
void *memcpy(void *, const void *, unsigned int);
void RLUnCompWram(const void *src, void *dest) __attribute__((naked));
#else
#include "stack.h"
void *memcpy(void *dest, const void *src, unsigned long n);
#endif

typedef void (*VoidFunc)(void);
extern const s8 gUnknown_084A6BF0[][4];
extern const struct Background gUnknown_084A6A60[3];
extern const struct Collision *const gUnknown_084A6DA4[];
extern void (*const gUnknown_084A6BA8[])(s32, s32);
extern const VoidFunc gUnknown_084A6B60[];

/** RLUnCompWram, 0x080997FC: BIOS run-length decompression to work memory (SWI 0x14). */
void RLUnCompWram(const void *src, void *dest) {
#ifdef MATCHING
  asm("swi 20\n\tbx lr");
#else
  const u8 *in = (const u8 *)src;
  u8 *out = (u8 *)dest;
  u32 remaining = ((u32)in[1]) | ((u32)in[2] << 8) | ((u32)in[3] << 16);
  gba_stack_swi(20, GBA_STACK_NONE);
  in += 4;
  while (remaining > 0) {
    u8 flag = *in++;
    if (flag & 0x80) {
      u32 len = (flag & 0x7F) + 3;
      u8 value = *in++;
      while (len-- && remaining > 0) {
        *out++ = value;
        remaining--;
      }
    } else {
      u32 len = (flag & 0x7F) + 1;
      while (len-- && remaining > 0) {
        *out++ = *in++;
        remaining--;
      }
    }
  }
#endif
}

/** sub_803DC98, 0x0803DC98: starts the stage clear / intro sprites and plays song 12. */
void sub_803DC98(void) {
  sub_800CF04(0x2000, 0x32E, 0, NULL);
  sub_800CF04(0x2000, 0x32F, 0, NULL);
  m4aSongNumStart(12);
}

/** StageSetTimeLimit, 0x0804CFF8: sets time-limit / demo mode configuration registers at 0x030060E0. */
void StageSetTimeLimit(u32 param0) {
  u16 *ptr = gUnknown_030060E0;

  if (param0 == 0 || (gStageFlags & 0x40)) {
    ptr[0] = 1;
    ptr[1] = 2;
  } else if (param0 == 1) {
    ptr[0] = 2;
    ptr[1] = 1;
  }
}

/** CreateGameStage, 0x0803CE20: initializes stage player slots, stage timers, and launches the stage setup. */
void CreateGameStage(void) {
  gUnknown_0300501C = 0;
  gUnknown_03005148 = 0;
  gUnknown_03004FEC = 0;
  gUnknown_03005088 = 1;

  if (gGameMode > 1) {
    InitPlayerWrapper(gSelectedCharacter, gCurrentLevel, 0, &gStagePlayer);
  } else if (gCurrentLevel == 13) {
    InitPlayerWrapper(gSelectedCharacter, gCurrentLevel, 0, &gStagePlayer);
  } else {
    InitPlayerWrapper(gSelectedCharacter, gCurrentLevel, 0, &gStagePlayer);
    if (gStageTailsEnabled != 0 && gSelectedCharacter == 0) {
      gUnknown_03005088 = 2;
      InitPlayerWrapper(1, gCurrentLevel, 1, &gStagePartner);
    }
  }

  gUnknown_03005120 = 0;
  gStageFlags &= ~0x80;
  if (gGameMode > 1) {
    gUnknown_03005038 = gFrameCount;
  }
  gUnknown_03004FE4 = 0;

  if (gGameMode == 6 || gGameMode == 4) {
    gUnknown_03005034 = 0x2A30;
  } else if (gGameMode == 5) {
    gUnknown_03005034 = 0x4650;
  } else {
    gUnknown_03005034 = 0;
  }

  StageInit();
}

/** sub_800CF04, 0x0800CF04: creates a one-shot background sprite animation task. */
struct Task *sub_800CF04(u16 priority, u16 anim, u8 variant, TaskDestructor dtor) {
  struct Task *t = TaskCreate(CODE(Task_800CF90), sizeof(struct Sprite), priority, 0, dtor);
  struct Sprite *s = TASK_DATA(t);

  s->x = 0;
  s->y = 0;
  s->graphics.dest = NULL;
  s->oamFlags = 0;
  s->graphics.size = 0;
  s->graphics.anim = anim;
  s->variant = variant;
  s->animCursor = 0;
  s->qAnimDelay = 0;
  s->prevVariant = -1;
  s->animSpeed = 0x10;
  s->palId = 0;
  s->hitboxes[0].index = -1;
  s->frameFlags = 0;
  return t;
}

s32 UpdateSpriteAnimation_BG(struct Sprite *s);

/** Task_800CF90, 0x0800CF90: advances a background sprite animation and destroys its task when it ends. */
void Task_800CF90(void) {
  struct Sprite *s = TASK_DATA(gCurTask);

  if (UpdateSpriteAnimation_BG(s) == 0) {
    TaskDestroy(gCurTask);
  }
}

/** Task_803F690, 0x0803F690: enables the stage display layers on the first camera frame and advances to the camera update task. */
void Task_803F690(void) {
  gDispCnt |= 0x1E00;
  if (gGameMode == 6) {
    gDispCnt &= ~0x2000;
  }
  gCurTask->main = CODE(Task_803F6CC);
}

/** sub_803CB18, 0x0803CB18: creates the stage palette/fade control task and clears its 5 state bytes. */
void sub_803CB18(void) {
  TaskCreate(CODE(Task_StageMusicManager), 0, 0x4000, 0, NULL);
  gUnknown_03005040[0] = 0;
  gUnknown_03005040[1] = 0;
  gUnknown_03005040[2] = 0;
  gUnknown_03005040[3] = 0;
  gUnknown_03005040[4] = 0;
}

/** InitCamera, 0x0803E0B0: sets up stage backgrounds, collision pointer, camera bounds, and stage background task. */
void InitCamera(u32 level) {
  struct StageCamera *cam = &gStageCamera;
  const s8 *dims = gUnknown_084A6BF0[level];

  gDispCnt = 0x3E40;
  if (level == 13) {
    gDispCnt = 0x3741;
  }

  gBgCntRegs[1] = 0x1E01;
  gBgCntRegs[2] = 0x1F02;

  {
    s32 size = (((dims[0] + 31) >> 6) | (((dims[1] + 31) >> 6) << 1)) << 14;
    s32 sb = (dims[3] << 8) | 3;
    gBgCntRegs[3] = size | sb | (dims[2] << 2);
  }

  if (level == 13) {
    s32 size, sb;
    gBgCntRegs[0] = 0x1F02;
    size = (((dims[0] + 31) >> 6) | (((dims[1] + 31) >> 6) << 1)) << 14;
    sb = (dims[3] << 8) | 3;
    gBgCntRegs[1] = size | sb | (dims[2] << 2);
  }

  {
    struct Background *bgs = gStageBackgrounds;

    memcpy(&bgs[1], &gUnknown_084A6A60[0], sizeof(struct Background));
    gStageBackgrounds[1].tilemapId = level * 3;

    memcpy(&bgs[2], &gUnknown_084A6A60[1], sizeof(struct Background));
    gStageBackgrounds[2].tilemapId = level * 3 + 1;
    if (level == 13) {
      gStageBackgrounds[2].flags &= ~3;
    }

    memcpy(&bgs[3], &gUnknown_084A6A60[2], sizeof(struct Background));
    gStageBackgrounds[3].tilemapId = level * 3 + 2;
    gStageBackgrounds[3].graphics.dest = (void *)(VRAM + (dims[2] << 14));
    gStageBackgrounds[3].layoutVram = (u16 *)(VRAM + (dims[3] << 11));
    gStageBackgrounds[3].targetTilesX = dims[0];
    gStageBackgrounds[3].targetTilesY = dims[1];
    if (level == 13) {
      gStageBackgrounds[3].flags = (gStageBackgrounds[3].flags & ~3) | 1;
    }

    gBgSprites_Unknown1[1] = 0;
    gBgSprites_Unknown2[1][0] = 0;
    gBgSprites_Unknown2[1][1] = 0;
    gBgSprites_Unknown2[1][2] = 0xFF;
    gBgSprites_Unknown2[1][3] = 0x20;

    gBgSprites_Unknown1[2] = 0;
    gBgSprites_Unknown2[2][0] = 0;
    gBgSprites_Unknown2[2][1] = 0;
    gBgSprites_Unknown2[2][2] = -1;
    gBgSprites_Unknown2[2][3] = 0x20;

    if (level == 10) {
      DrawBackground(&gStageBackgrounds[3]);
      DMA3_COPY16(gStageBackgrounds[3].layout, gStageBackgrounds[3].layoutVram, 0x1000);
      gBgCntRegs[3] &= ~0x1F00;
      gBgCntRegs[3] |= (dims[3] + 2) << 8;
      gStageBackgrounds[3].layoutVram = (u16 *)(VRAM + ((dims[3] + 2) << 11));
      gStageBackgrounds[3].unk20 = 0x40;
    }

    if (gGameMode == 6) {
      gStageBackgrounds[1].flags |= 0x208;
      gStageBackgrounds[2].flags |= 0x208;
    }

    if (level == 13) {
      DrawBackground(&gStageBackgrounds[2]);
      DrawBackground(&gStageBackgrounds[3]);
    } else {
      DrawBackground(&gStageBackgrounds[1]);
      DrawBackground(&gStageBackgrounds[2]);
      DrawBackground(&gStageBackgrounds[3]);
    }
  }

  if (gGameMode != 6) {
    gRefCollision = gUnknown_084A6DA4[level];
  } else {
    gRefCollision = *(const struct Collision **)0x02033004;
  }

  cam->minY = 0;
  cam->maxY = gRefCollision->pxHeight;
  cam->minX = 0;
  cam->maxX = gRefCollision->pxWidth;

  cam->x = cam->unk8 = (gStagePlayer.x >> 8) - 120;
  cam->y = cam->unkA = (gStagePlayer.y >> 8) + cam->unk22 - 84;

  cam->shiftX = 16;
  cam->shiftY = 12;
  cam->unkC = 0;
  cam->unkE = 0;
  cam->unk10 = 0;
  cam->unk12 = 0;
  cam->unk1C = 0;
  cam->unk1E = 8;
  cam->unk20 = 0;
  cam->unk22 = 0;
  cam->unk26 = 0;
  cam->unk28 = 0;
  cam->unk2A = 0;
  cam->unk34 = 0;
  cam->unk36 = 0;
  cam->unk38 = gStagePlayer.unkF - 4;

  cam->movementTask = TaskCreate(CODE(Task_803F690), 0, 0xF00, 0, CODE(TaskDestructor_803F628));
  cam->fn2C = gUnknown_084A6BA8[level];
  if (gUnknown_084A6B60[level] != NULL) {
    CALL(gUnknown_084A6B60[level])();
  }
}
