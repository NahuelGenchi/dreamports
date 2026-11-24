// The title screen, as far as its first frames: its background, the PRESS START and copyright sprites, and the game's
// logo loaded while the screen comes out of white.
#include "console.h"
#include "background.h"
#include "core.h"
#include "logos.h"
#include "malloc.h"
#include "save.h"
#include "sprite.h"
#include "task.h"
#ifdef MATCHING
void *memcpy(void *, const void *, unsigned int);
#else
#include "m4a_internal.h"
void *memcpy(void *dest, const void *src, unsigned long n);
#endif

#define Q(n) ((s32)((n) * 256))
#define I(n) ((int)((n) >> 8))
#define ANIM_TITLE_COPYRIGHT 780
#define TM_TITLE_BG 75
#define TM_TITLE_LOGO_JP 73
#define MUS_TITLE_FANFARE 2

/** What the title screen keeps: its two sprites, its two backgrounds, and how far it has come out of white. */
struct TitleScreen {
  /* 0x00 */ struct Sprite s;
  /* 0x30 */ struct Sprite s2;
  /* 0x60 */ struct Background bg;
  /* 0xA0 */ struct Background bg2;
  /* 0xE0 */ s16 qBlend;
  /* 0xE2 */ u16 unkE2;
  /* 0xE4 */ s16 unkE4;
  /* 0xE6 */ u16 unkE6;
  /* 0xE8 */ u8 playMusic;
};

/** The PRESS START sprite's animation in each language. */
extern const u16 gUnknown_080B8344[2];

void m4aSongNumStart(u16 n);
void CreateTitleScreen(u32 playMusic);
void Task_LoadGameLogo(void);
void Task_800D7EC(void);
void TaskDestructor_TitleScreen(struct Task *t);

/** Task_800D4B0, 0x0800D4B0: from Sonic Team's logo to the title screen, with its music, when A or Start skips the
 *  story's opening. */
void Task_800D4B0(void) {
  gFlags &= ~FLAGS_8000;
  gFlags &= ~FLAGS_EXECUTE_HBLANK_COPY;
  TaskDestroy(gCurTask);
  CreateTitleScreen(1);
}

/** CreateTitleScreen, 0x0800D4E0: the title's screen and task, its two sprites and its background, and its music
 *  when asked for. */
void CreateTitleScreen(u32 playMusic) {
  struct Task *t;
  struct TitleScreen *title;
  struct Sprite *s;
  struct Background *bg;
  u16 animsPressStart[2];

  memcpy(animsPressStart, gUnknown_080B8344, sizeof(animsPressStart));

  gDispCnt = 0x41;
  gBgCntRegs[2] = 0x568D;
  gBgCntRegs[0] = 0x1482;
  gBgScrollRegs[0][0] = 0;
  gBgScrollRegs[0][1] = 0;
  gBgScrollRegs[1][0] = 0;
  gBgScrollRegs[1][1] = 0;
  gBgScrollRegs[2][0] = 0;
  gBgScrollRegs[2][1] = 0;
  gBgSprites_Unknown1[0] = 0;
  gBgSprites_Unknown2[0][0] = 0;
  gBgSprites_Unknown2[0][1] = 0;
  gBgSprites_Unknown2[0][2] = 0xFF;
  gBgSprites_Unknown2[0][3] = 0x20;
  gBgSprites_Unknown1[2] = 0xFF;
  gBgSprites_Unknown2[2][0] = 0;
  gBgSprites_Unknown2[2][1] = 0;
  gBgSprites_Unknown2[2][2] = -1;
  gBgSprites_Unknown2[2][3] = 0x20;

  DMA3_FILL32(0, VRAM, 64);
  DMA3_FILL32(0, VRAM + 0xFFC0, 0x80); // as the original does it, 64 bytes past the backgrounds' memory

  t = TaskCreate(CODE(Task_LoadGameLogo), sizeof(struct TitleScreen), 0x2000U, 0U, CODE(TaskDestructor_TitleScreen));
  title = TASK_DATA(t);
  s = &title->s;
  title->unkE2 = 0;
  title->qBlend = Q(16);
  title->playMusic = playMusic;
  gBldRegs.bldCnt = 0x20A5;
  gBldRegs.bldY = I(title->qBlend);
  s->x = 120;
  s->y = 113;
  s->graphics.dest = VramMalloc(46);
  s->graphics.size = 0;
  s->graphics.anim = animsPressStart[gLoadedSaveGame.uiLanguage];
  s->variant = 0;
  s->animCursor = 0;
  s->prevVariant = -1;
  s->qAnimDelay = 0;
  s->animSpeed = 0x10;
  s->palId = 0;
  s->oamFlags = 0x400;
  s->frameFlags = 0x1000;
  UpdateSpriteAnimation(s);
  s = &title->s2;
  s->x = 0;
  s->y = 134;
  s->graphics.dest = VramMalloc(90);
  s->graphics.size = 0;
  s->graphics.anim = ANIM_TITLE_COPYRIGHT;
  s->variant = 1;
  s->animCursor = 0;
  s->prevVariant = -1;
  s->qAnimDelay = 0;
  s->animSpeed = 0x10;
  s->palId = 0;
  s->oamFlags = 0x400;
  s->frameFlags = 0x1000;
  UpdateSpriteAnimation(s);
  bg = &title->bg;
  bg->graphics.dest = (void *)VRAM;
  bg->graphics.anim = 0;
  bg->layoutVram = (u16 *)(VRAM + 0xA000);
  bg->unk18 = 0;
  bg->unk1A = 0;
  bg->tilemapId = TM_TITLE_BG;
  bg->unk1E = 0;
  bg->unk20 = 0;
  bg->unk22 = 0;
  bg->unk24 = 0;
  bg->targetTilesX = 30;
  bg->targetTilesY = 20;
  bg->paletteOffset = 0;
  bg->flags = 4;
  DrawBackground(bg);

  if (title->playMusic) {
    m4aSongNumStart(MUS_TITLE_FANFARE);
  }
}

/** Task_LoadGameLogo, 0x0800D71C: the game's logo is loaded in the title's first frame, and the screen comes out of
 *  white, a third of a step a frame. */
void Task_LoadGameLogo(void) {
  struct TitleScreen *title;
  struct Background *bg;

  gDispCnt |= DISPCNT_BG0_ON | DISPCNT_OBJ_ON;
  title = TASK_DATA(gCurTask);

  if (title->qBlend == Q(16)) {
    bg = &title->bg2;
    bg->graphics.dest = (void *)(VRAM + 0xC000);
    bg->graphics.anim = 0;
    bg->layoutVram = (u16 *)(VRAM + 0xB000);
    bg->unk18 = 0;
    bg->unk1A = 0;
    bg->tilemapId = (TM_TITLE_LOGO_JP + gLoadedSaveGame.uiLanguage);
    bg->unk1E = 0;
    bg->unk20 = 0;
    bg->unk22 = 0;
    bg->unk24 = 0;
    bg->targetTilesX = 24;
    bg->targetTilesY = 10;
    title->bg2.paletteOffset = 0;
    bg->flags = 6;
    DrawBackground(bg);
  }
  title->qBlend -= 0x55;

  gBldRegs.bldY = I(title->qBlend);

  if (title->qBlend <= 0) {
    title->unkE4 = 0x400;
    title->unkE6 = 0xFFF0;
    gBldRegs.bldY = 0;
    gCurTask->main = CODE(Task_800D7EC);
  }
}

/** TaskDestructor_TitleScreen, 0x0800E020: gives back the tiles of the title's two sprites. */
void TaskDestructor_TitleScreen(struct Task *t) {
  struct TitleScreen *title = TASK_DATA(gCurTask);

  VramFree(title->s.graphics.dest);
  VramFree(title->s2.graphics.dest);
}
