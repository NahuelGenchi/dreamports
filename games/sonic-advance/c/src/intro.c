// The story's opening, after the logos: the Chaos Emerald falling through its sparkles, the spotlights, and Sonic,
// Tails, Knuckles and Amy each in turn. A, B or Start goes to the title screen.
#include "console.h"
#include "core.h"
#include "spotlight.h"
#include "sprite.h"
#include "task.h"
#include "ui.h"

#define INTRO_SPOTLIGHT_COUNT 2
#define NUM_CHARACTERS 4
#define EMERALD_START_X 120
#define EMERALD_START_Y -36
#define TILE_SIZE_4BPP 32
#define ANIM_INTRO_EMERALD 774
#define ANIM_SUPER_SONIC_SPARKLE 775
#define ANIM_INTRO_CHARACTERS 769
#define MUS_INTRO 1
#define RGB_GREEN (31 << 5)
#define RGB_BLUE (31 << 10)
#define RGB16(r, g, b) ((r) | ((g) << 5) | ((b) << 10))
#define DISPCNT_OBJ_ON_1D (DISPCNT_OBJ_ON | DISPCNT_OBJ_1D_MAP)

/** Fixed point with 8 bits of fraction, as the game keeps places and speeds. */
#define Q(n) ((s32)((n) * 256))
#define I(n) ((int)((n) >> 8))
#define SIN(angle) (gSineTable[(angle)])

/** One of the opening's sprites, and how it moves. */
struct IntroSprite {
  /* 0x00 */ struct Sprite s;
  /* 0x30 */ u16 unk30;
  /* 0x32 */ u8 unk32;
  /* 0x34 */ s32 unk34;
  /* 0x38 */ s32 qUnk38;
  /* 0x3C */ s32 qUnk3C;
  /* 0x40 */ s32 qUnk40;
};

/** A character's turn: its sprites. */
struct Intro_C8 {
  /* 0x00 */ struct Sprite sprites[3];
  /* 0x90 */ u8 filler90[0x24];
  /* 0xB4 */ u16 unkB4;
  /* 0xB6 */ u8 fillerB6[0x12];
};

/** The opening's own task: its frames, the fade, the emerald and the spotlights, and each character's turn. */
struct Intro_54 {
  /* 0x00 */ struct StrcUi_805423C strc0;
  /* 0x0C */ struct Task *taskC;
  /* 0x10 */ struct Task *beamTasks[INTRO_SPOTLIGHT_COUNT];
  /* 0x18 */ struct Task *tasks18[NUM_CHARACTERS];
  /* 0x28 */ u8 filler28[0x24];
  /* 0x4C */ s16 unk4C;
  /* 0x4E */ u8 unk4E;
  /* 0x50 */ u16 unk50;
  /* 0x52 */ u16 unk52;
};

/** Where a character's words are drawn from. */
struct LocalTileInfo {
  /* 0x00 */ u32 anim;
  /* 0x04 */ u32 variant;
  /* 0x08 */ void *vram;
};

extern const s16 gSineTable[1280];
extern const s16 gUnknown_08684178[2];
extern const s16 gUnknown_0868417C[2];
extern const s16 gUnknown_08684180[2];
extern const s16 gUnknown_08684184[2];
extern const struct LocalTileInfo gUnknown_08684188[6];
extern const struct LocalTileInfo gUnknown_086841D0[6];
extern const struct LocalTileInfo gUnknown_08684218[9];
extern const struct LocalTileInfo gUnknown_08684284[4];
extern const u16 gUnknown_086842B4[2][2];
extern const u16 gUnknown_086842BC[2][2];
extern const u16 gUnknown_086842C4[2][2];
extern const u16 gUnknown_086842CC[2][2];
extern u16 gUnknown_0869EC10[256];
extern u8 gUnknown_0869EE10[0x2E00];
extern u8 gUnknown_086A1D10[1];
extern u8 gUnknown_086A2710[0x2840];
extern u8 gUnknown_086A4F50[0x8C0];
extern u8 gUnknown_086A5A10[0x2840];
extern u8 gUnknown_086A83D0[0x8C0];
extern u8 gUnknown_086A8E90[0x1440];
extern u8 gUnknown_086AA2D0[0x6C0];
extern u16 gUnknown_086AA990[16][16];
extern u8 gUnknown_086AAB90[0x540];
extern u8 gUnknown_086AB0D0[0x800];
extern u16 gUnknown_086AB8D0[256];
extern u8 gUnknown_086ABAD0[0x1E00];
extern u8 gUnknown_086AD8D0[0x800];
extern u16 gUnknown_086AE0D0[256];
extern u8 gUnknown_086AE2D0[0x1B80];
extern u8 gUnknown_086AFE50[0x800];
extern u16 gUnknown_086B0650[256];
extern u8 gUnknown_086B0850[0x1880];
extern u8 gUnknown_086B20D0[0x800];
extern u16 gUnknown_086B28D0[256];
extern u8 gUnknown_086B2AD0[0x1840];
extern u8 gUnknown_086B4310[0x800];

s32 Div(s32 num, s32 denom);
s32 Mod(s32 num, s32 denom);
void Task_IntroChaosEmeraldUpdate(void);
void Task_80640C8(void);
void sub_8064244(void);
void sub_80645E4(void);
void sub_80648D4(void);
void sub_8064BB4(void);
void sub_8064E84(void);
void IntroOpenTitlescreenSilent(void);
void CreateTitleScreen(u32 playMusic);
void m4aSongNumStop(u16 n);
void Task_IntroRenderTails(void);
void Task_IntroRenderKnuckles(void);
void Task_IntroRenderAmy(void);
void sub_80656A4(void);
void sub_806571C(void);
void sub_8065794(void);
void IntroOpenTitlescreenPlayMusic(void);
void Task_8065058(void);
void Task_806515C(void);
void Task_RenderSonic(void);
void Task_806562C(void);
void TaskDestructor_8065810(struct Task *t);

/** 0x080638E4, CreateIntroAnimation: the opening's screen and tasks, the emerald and its eight sparkles, and its
 *  music. */
void CreateIntroAnimation(void) {
  u8 i;
  struct Task *t, *t2;
  struct Sprite *s;
  struct IntroSprite *emerald;
  struct IntroSprite *introSpr;
  struct Intro_54 *strc54;
  s32 qVal;

  TasksDestroyInPriorityRange(0, 0xFFFF);
  gBackgroundsCopyQueueCursor = gBackgroundsCopyQueueIndex;
  gBgSpritesCount = 0;
  gVramGraphicsCopyCursor = gVramGraphicsCopyQueueIndex;
  sub_80535FC();

  UiGfxStackInit();
  gDispCnt = DISPCNT_OBJ_ON_1D;
  gBgCntRegs[0] = 0x9D86;
  gBgCntRegs[1] = 0x1B8B;
  gBgCntRegs[2] = 0x9880;
  gBgScrollRegs[0][0] = 0;
  gBgScrollRegs[0][1] = 0;
  gBgScrollRegs[1][0] = 0;
  gBgScrollRegs[1][1] = 0;
  gBgScrollRegs[2][0] = 0;
  gBgScrollRegs[2][1] = 0;
  t = TaskCreate(CODE(Task_IntroChaosEmeraldUpdate), sizeof(struct IntroSprite), 0x2120U, 0U, NULL);
  emerald = TASK_DATA(t);
  s = &emerald->s;
  emerald->unk30 = 0;
  qVal = -Q(36);
  emerald->unk34 = 0;
  emerald->qUnk38 = qVal;
  emerald->qUnk3C = qVal;
  emerald->qUnk40 = Q(2.25);
  s->graphics.dest = (void *)(OBJ_VRAM0 + 0x20);
  s->graphics.anim = ANIM_INTRO_EMERALD;
  s->variant = 0;
  s->x = EMERALD_START_X;
  s->y = EMERALD_START_Y;
  s->oamFlags = SPRITE_OAM_ORDER(3);
  s->graphics.size = 0;
  s->animCursor = 0;
  s->qAnimDelay = 0;
  s->prevVariant = -1;
  s->animSpeed = SPRITE_ANIM_SPEED_1;
  s->palId = 0;
  s->hitboxes[0].index = -1;
  s->frameFlags = 0x1000;
  UpdateSpriteAnimation(s);

  for (i = 0; i < 8; i++) {
    s32 chunkOffset;
    t2 = TaskCreate(CODE(Task_8065058), sizeof(struct IntroSprite), (i * 2) | 0x6800, 0U, NULL);
    introSpr = TASK_DATA(t2);
    s = &introSpr->s;
    introSpr->unk30 = (0x2F - (i * 6));
    introSpr->unk32 = i;
    introSpr->unk34 = introSpr->unk30;
    introSpr->qUnk38 = qVal;
    introSpr->qUnk3C = qVal;
    introSpr->qUnk40 = Q(2.25);
    chunkOffset = (i * (4 * TILE_SIZE_4BPP));
    s->graphics.dest = (void *)(chunkOffset + OBJ_VRAM0 + (31 * TILE_SIZE_4BPP));
    s->graphics.anim = ANIM_SUPER_SONIC_SPARKLE;
    s->variant = 0;
    s->x = EMERALD_START_X + Div(SIN(i << 6), 650);
    s->y = EMERALD_START_Y;
    s->oamFlags = 0;
    s->graphics.size = 0;
    s->animCursor = 0;
    s->qAnimDelay = 0;
    s->prevVariant = -1;
    s->animSpeed = 0x10;
    s->palId = 0;
    s->hitboxes[0].index = -1;
    s->frameFlags = 0x1000;
    UpdateSpriteAnimation(s);
  }

  t2 = TaskCreate(CODE(Task_80640C8), sizeof(struct Intro_54), 0x2100U, 0U, CODE(TaskDestructor_8065810));
  strc54 = TASK_DATA(t2);
  strc54->unk4C = 0;
  strc54->unk4E = 1;
  strc54->taskC = t;
  strc54->beamTasks[0] = NULL;
  strc54->beamTasks[1] = NULL;
  strc54->tasks18[0] = NULL;
  strc54->tasks18[1] = NULL;
  strc54->tasks18[2] = NULL;
  strc54->tasks18[3] = NULL;
  strc54->unk50 = 0;
  strc54->unk52 = 0;

  strc54->strc0.unk0 = 0;
  strc54->strc0.unk2 = 1;
  strc54->strc0.unk4 = 2;
  strc54->strc0.unk6 = 0;
  strc54->strc0.unk8 = 0x80;
  strc54->strc0.unkA = 1;
  sub_805423C(&strc54->strc0);
  m4aSongNumStart(1U);
}

/** 0x08063B58, sub_8063B8C: the two backgrounds of Sonic's turn, the stripes all four share and his own picture. */
void sub_8063B8C(void) {
  struct Strc_80528AC gfx;

  UiGfxStackInit();

  gfx.uiGfxID = 0x80;
  gfx.unk2B = 0;
  gfx.tiles = &gUnknown_086AAB90[0];
  gfx.tilesSize = sizeof(gUnknown_086AAB90);
  gfx.palette = &gUnknown_086AA990[0][0];
  gfx.paletteSize = sizeof(gUnknown_086AA990);
  gfx.layout = &gUnknown_086AB0D0[0];
  gfx.layoutSize = sizeof(gUnknown_086AB0D0);
  gfx.unk28 = 0;
  gfx.unk29 = 1;
  gfx.unk2A = 0x15;
  sub_80528AC(&gfx);

  gfx.uiGfxID = 0x80;
  gfx.unk2B = 1;
  gfx.tiles = &gUnknown_086ABAD0[0];
  gfx.tilesSize = sizeof(gUnknown_086ABAD0);
  gfx.palette = &gUnknown_086AB8D0[0];
  gfx.paletteSize = sizeof(gUnknown_086AB8D0);
  gfx.layout = &gUnknown_086AD8D0[0];
  gfx.layoutSize = sizeof(gUnknown_086AD8D0);
  gfx.unk28 = 0;
  gfx.unk29 = 0;
  gfx.unk2A = 0x11;
  sub_80528AC(&gfx);
}

/** 0x08063C18, sub_8063C4C: the two backgrounds of Tails' turn, the stripes in his colours and his own picture. */
void sub_8063C4C(void) {
  struct Strc_80528AC gfx;

  UiGfxStackInit();

  gfx.uiGfxID = 0x80;
  gfx.unk2B = 0;
  gfx.tiles = &gUnknown_086AAB90[0];
  gfx.tilesSize = sizeof(gUnknown_086AAB90);
  gfx.palette = &gUnknown_086AA990[1][0];
  gfx.paletteSize = sizeof(gUnknown_086AA990[1]);
  gfx.layout = &gUnknown_086AB0D0[0];
  gfx.layoutSize = sizeof(gUnknown_086AB0D0);
  gfx.unk28 = 0;
  gfx.unk29 = 1;
  gfx.unk2A = 0x14;
  sub_80528AC(&gfx);

  gfx.uiGfxID = 0x80;
  gfx.unk2B = 1;
  gfx.tiles = &gUnknown_086AE2D0[0];
  gfx.tilesSize = sizeof(gUnknown_086AE2D0);
  gfx.palette = &gUnknown_086AE0D0[0];
  gfx.paletteSize = sizeof(gUnknown_086AE0D0);
  gfx.layout = &gUnknown_086AFE50[0];
  gfx.layoutSize = sizeof(gUnknown_086AFE50);
  gfx.unk28 = 0;
  gfx.unk29 = 0;
  gfx.unk2A = 0x11;
  sub_80528AC(&gfx);
}

/** 0x08063CD8, sub_8063D0C: the two backgrounds of Knuckles' turn, the stripes in his colours and his own picture. */
void sub_8063D0C(void) {
  struct Strc_80528AC gfx;

  UiGfxStackInit();

  gfx.uiGfxID = 0x80;
  gfx.unk2B = 0;
  gfx.tiles = &gUnknown_086AAB90[0];
  gfx.tilesSize = sizeof(gUnknown_086AAB90);
  gfx.palette = &gUnknown_086AA990[2][0];
  gfx.paletteSize = sizeof(gUnknown_086AA990[2]);
  gfx.layout = &gUnknown_086AB0D0[0];
  gfx.layoutSize = sizeof(gUnknown_086AB0D0);
  gfx.unk28 = 0;
  gfx.unk29 = 1;
  gfx.unk2A = 0x14;
  sub_80528AC(&gfx);

  gfx.uiGfxID = 0x80;
  gfx.unk2B = 1;
  gfx.tiles = &gUnknown_086B0850[0];
  gfx.tilesSize = sizeof(gUnknown_086B0850);
  gfx.palette = &gUnknown_086B0650[0];
  gfx.paletteSize = sizeof(gUnknown_086B0650);
  gfx.layout = &gUnknown_086B20D0[0];
  gfx.layoutSize = sizeof(gUnknown_086B20D0);
  gfx.unk28 = 0;
  gfx.unk29 = 0;
  gfx.unk2A = 0x11;
  sub_80528AC(&gfx);
}

/** 0x08063D98, sub_8063DCC: the two backgrounds of Amy's turn, the stripes in her colours and her own picture. */
void sub_8063DCC(void) {
  struct Strc_80528AC gfx;

  UiGfxStackInit();

  gfx.uiGfxID = 0x80;
  gfx.unk2B = 0;
  gfx.tiles = &gUnknown_086AAB90[0];
  gfx.tilesSize = sizeof(gUnknown_086AAB90);
  gfx.palette = &gUnknown_086AA990[3][0];
  gfx.paletteSize = sizeof(gUnknown_086AA990[3]);
  gfx.layout = &gUnknown_086AB0D0[0];
  gfx.layoutSize = sizeof(gUnknown_086AB0D0);
  gfx.unk28 = 0;
  gfx.unk29 = 1;
  gfx.unk2A = 0x14;
  sub_80528AC(&gfx);

  gfx.uiGfxID = 0x80;
  gfx.unk2B = 1;
  gfx.tiles = &gUnknown_086B2AD0[0];
  gfx.tilesSize = sizeof(gUnknown_086B2AD0);
  gfx.palette = &gUnknown_086B28D0[0];
  gfx.paletteSize = sizeof(gUnknown_086B28D0);
  gfx.layout = &gUnknown_086B4310[0];
  gfx.layoutSize = sizeof(gUnknown_086B4310);
  gfx.unk28 = 0;
  gfx.unk29 = 0;
  gfx.unk2A = 0x11;
  sub_80528AC(&gfx);
}

/** 0x08063E58, sub_8063E8C: what the opening adds on frame `arg0`: the second ring of sparkles first, then each of
 *  three backgrounds in turn. */
void sub_8063E8C(u16 arg0) {
  struct Strc_80528AC gfx;
  s32 chunkOffset;
  s32 qVal;
  u8 i;
  struct Task *t;
  struct IntroSprite *introSpr;
  struct Sprite *s;

  if (arg0 == 0) {
    for (i = 0; i < 8; i++) {
      t = TaskCreate(CODE(Task_806515C), sizeof(struct IntroSprite), (i * 2) | 0x6801, 0U, NULL);
      introSpr = TASK_DATA(t);
      introSpr->unk30 = (u16)(i * 6);
      introSpr->unk32 = i;
      qVal = -Q(36);
      introSpr->unk34 = (s32)introSpr->unk30;
      introSpr->qUnk38 = qVal;
      introSpr->qUnk3C = qVal;
      introSpr->qUnk40 = Q(2.25);

      s = &introSpr->s;
      chunkOffset = (i * (4 * TILE_SIZE_4BPP));
      s->graphics.dest = (void *)(OBJ_VRAM0 + 0xBE0 + chunkOffset);
      s->graphics.anim = ANIM_SUPER_SONIC_SPARKLE;
      s->variant = 1;
      s->x = (Div(SIN(i << 6), 650) + 120);
      s->y = -36;
      s->oamFlags = 0x180;
      s->graphics.size = 0;
      s->animCursor = 0;
      s->qAnimDelay = 0;
      s->prevVariant = -1;
      s->animSpeed = 0x10;
      s->palId = 0;
      s->hitboxes[0].index = -1;
      s->frameFlags = 0x1000;
      UpdateSpriteAnimation((struct Sprite *)s);
    }
  } else if (arg0 == 1) {
    gDispCnt = 0x1240;
    gfx.uiGfxID = 0x80;
    gfx.unk2B = 0;
    gfx.tiles = &gUnknown_0869EE10[0];
    gfx.tilesSize = 0x2F00;
    gfx.palette = &gUnknown_0869EC10[0];
    gfx.paletteSize = 0x200;
    gfx.layout = &gUnknown_086A1D10[0];
    gfx.layoutSize = 0x800;
    gfx.unk28 = 0;
    gfx.unk29 = 1;
    gfx.unk2A = 0x15;
    sub_80528AC(&gfx);
  } else if (arg0 == 2) {
    gDispCnt = 0x1340;
    gfx.uiGfxID = 0x80;
    gfx.unk2B = 1;
    gfx.tiles = &gUnknown_086A2710[0];
    gfx.tilesSize = sizeof(gUnknown_086A2710);
    gfx.layout = &gUnknown_086A4F50[0];
    gfx.layoutSize = sizeof(gUnknown_086A4F50);
    gfx.unk28 = 0;
    gfx.unk29 = 0;
    gfx.unk2A = 0x11;
    sub_80528AC(&gfx);
  } else if (arg0 == 3) {
    gDispCnt = 0x1740;
    gfx.uiGfxID = 0x80;
    gfx.unk2B = 0;
    gfx.tiles = &gUnknown_086A8E90[0];
    gfx.tilesSize = sizeof(gUnknown_086A8E90);
    gfx.layout = &gUnknown_086AA2D0[0];
    gfx.layoutSize = sizeof(gUnknown_086AA2D0);
    gfx.unk28 = 0;
    gfx.unk29 = 2;
    gfx.unk2A = 0x11;
    sub_80528AC(&gfx);
  } else if (arg0 == 310) {
    gfx.uiGfxID = 0x80;
    gfx.unk2B = 1;
    gfx.tiles = &gUnknown_086A5A10[0];
    gfx.tilesSize = sizeof(gUnknown_086A5A10);
    gfx.layout = &gUnknown_086A83D0[0];
    gfx.layoutSize = sizeof(gUnknown_086A83D0);
    gfx.unk28 = 0;
    gfx.unk29 = 0;
    gfx.unk2A = 0x11;
    sub_80528AC(&gfx);
  }
}

static inline u32 maskColor(u32 c) { return Div(c, 40) & 0x1F; }

static inline u32 maskRedColor(u32 c) {
#ifdef MATCHING
  u32 result;
  asm("mov %0, #0x1F\n"
      "and %0, %1\n"
      : "=r"(result)
      : "r"(c));
  return result;
#else
  return (c % 32u);
#endif
}

/** 0x08064094, Task_80640C8: the opening's first 320 frames: the background fades in, the clouds and the emerald
 *  scroll, and A, B or Start goes to the title screen. */
void Task_80640C8(void) {
  u32 r, g, b;
  u16 colorIndex;
  u32 var_r7;

  struct Intro_54 *strc54 = TASK_DATA(gCurTask);
  struct IntroSprite *introSpr = TASK_DATA(strc54->taskC);

  introSpr->unk30 = (u16)strc54->unk4C;
  if ((A_BUTTON | B_BUTTON | START_BUTTON) & gPressedKeys) {
    gCurTask->main = CODE(IntroOpenTitlescreenPlayMusic);
    return;
  }

  if (strc54->unk4C > 0x97) {
    var_r7 = (u32)((strc54->unk4C - 0x98) << 0xF) >> 0x10;
    if (var_r7 > 40) {
      var_r7 = 40;
    }

    for (colorIndex = 0; colorIndex < 32; colorIndex++) {
      u16 color = gUnknown_0869EC10[colorIndex];
      r = (maskRedColor(color) >> 0);
      g = ((color & RGB_GREEN) >> 5);
      b = ((color & RGB_BLUE) >> 10);

      {
        r = maskColor(r * var_r7);
        g = maskColor(g * var_r7);
        b = maskColor(b * var_r7);
        gBgPalette[colorIndex] = RGB16(r, g, b);
      }
      gFlags |= FLAGS_UPDATE_BACKGROUND_PALETTES;
    }
  }

  if (strc54->unk4C > 0xB5) {
    gBgScrollRegs[0][1] += 2;
    if (gBgScrollRegs[0][1] > 100) {
      gBgScrollRegs[0][1] = 100;
    }
    if (gBgScrollRegs[0][1] > 80) {
      gBgScrollRegs[2][1] = gBgScrollRegs[0][1] - 0x50;
    }
  }
  gBgScrollRegs[1][1] += 0xA;
  sub_8063E8C(strc54->unk4C);
  if (strc54->unk4C > 0x13F) {
    strc54->unk4C = 0;
    gCurTask->main = CODE(sub_8064244);
  } else {
    sub_805423C(&strc54->strc0);
  }
  strc54->unk4C++;
}

/** 0x08064210, sub_8064244: the spotlights sweep for 506 frames, then Sonic's turn starts. */
void sub_8064244(void) {
  struct Sprite *s;
  u32 temp_r4;
  u8 i;
  struct Task *t;

  struct Intro_C8 *temp_r0_7;
  struct Intro_54 *strc54 = TASK_DATA(gCurTask);

  temp_r4 = strc54->unk4C;

  if ((A_BUTTON | B_BUTTON | START_BUTTON) & gPressedKeys) {
    gCurTask->main = CODE(IntroOpenTitlescreenPlayMusic);
    return;
  }

  if (temp_r4 < 0x60) {
    TasksDestroyInPriorityRange(0x6800U, ((temp_r4 >> 2) + 0x6802));
  }
  if (temp_r4 == 0x3C) {
    strc54->strc0.unk0 = 0;
    strc54->strc0.unk2 = 1;
    strc54->strc0.unk4 = 1;
    strc54->strc0.unk6 = 0;
    strc54->strc0.unk8 = 0x40;
    strc54->strc0.unkA = 1;
    sub_80543A4(&strc54->strc0);
  }
  gBgScrollRegs[1][1] += 10;
  if (++strc54->unk4C >= 506) {
    TaskDestroy(strc54->taskC);
    strc54->taskC = NULL;
    gBgScrollRegs[1][0] = 0;
    gBgScrollRegs[1][1] = 0;
    strc54->unk50 = 0x4000;
    strc54->unk52 = 0;
    strc54->unk4C = 0;
    TaskDestroy(strc54->beamTasks[0]);
    strc54->beamTasks[0] = NULL;
    TaskDestroy(strc54->beamTasks[1]);
    strc54->beamTasks[1] = NULL;
    gDispCnt = 0; // as the original writes it, though the next line sets it again
    gBldRegs.bldCnt = 0;
    gBldRegs.bldY = 0;
    gDispCnt = 0x1340;
    gBgCntRegs[0] = 0x1D86;
    gBgCntRegs[1] = 0x1883;
    t = TaskCreate(CODE(Task_RenderSonic), sizeof(struct Intro_C8), 0x2210U, 0U, NULL);
    strc54->tasks18[0] = t;
    temp_r0_7 = TASK_DATA(t);
    temp_r0_7->unkB4 = 0;

    for (i = 0; i < 2; i++) {
      s = &temp_r0_7->sprites[i];
      if (i != 0) {
        s->graphics.dest = (void *)(OBJ_VRAM0 + 0x4000);
      } else {
        s->graphics.dest = (void *)(OBJ_VRAM0 + 0x1440);
      }
      s->graphics.anim = ANIM_INTRO_CHARACTERS;
      s->variant = 0;
      s->x = 0xB4;
      s->y = 0x82;
      s->oamFlags = 0x3C0;
      s->graphics.size = 0;
      s->animCursor = 0;
      s->qAnimDelay = 0;
      s->prevVariant = -1;
      s->animSpeed = 0x10;
      s->palId = 0;
      s->hitboxes[0].index = -1;
      s->frameFlags = 0x80;
      UpdateSpriteAnimation(s);
    }

    for (i = 0; i < 6; i++) {
      struct IntroSprite *introSpr;
      t = TaskCreate(CODE(Task_806562C), sizeof(struct IntroSprite), 0x6820U, 0U, NULL);
      introSpr = TASK_DATA(t);
      s = &introSpr->s;
      introSpr->unk30 = 0;
      introSpr->unk32 = 0;
      introSpr->unk34 = i;
      introSpr->qUnk3C = gUnknown_08684178[0] + 0x118;
      s->graphics.dest = gUnknown_08684188[i].vram;
      s->graphics.anim = gUnknown_08684188[i].anim;
      s->variant = gUnknown_08684188[i].variant;
      s->x = 280;
      s->y = 70;
      s->oamFlags = 0x180;
      s->graphics.size = 0;
      s->animCursor = 0;
      s->qAnimDelay = 0;
      s->prevVariant = 0xFF;
      s->animSpeed = 0x10;
      s->palId = 0;
      s->hitboxes[0].index = -1;
      s->frameFlags = 0x80;
      UpdateSpriteAnimation(s);
    }
    gCurTask->main = CODE(sub_80645E4);
  } else {
    if ((s32)strc54->unk4C > 0xE0) {
      struct SpotlightBeam *beam;

      if (strc54->unk4C == 0xE1) {
        struct Task *tBeam = CreateSpotlightBeamTask();
        strc54->beamTasks[0] = tBeam;
        beam = TASK_DATA(tBeam);
        beam->unk6 = 120;
        beam->unk8 = 250;
        beam->unk0 = 0;
        beam->unk2 = 0;
        beam->unk4 = 0;
        beam->bg = 2;
        beam->unkB = 6;
        tBeam = CreateSpotlightBeamTask();
        strc54->beamTasks[1] = tBeam;
        beam = TASK_DATA(tBeam);
        beam->unk6 = 120;
        beam->unk8 = 250;
        beam->unk0 = 0;
        beam->unk2 = 0;
        beam->unk4 = 0;
        beam->bg = 3;
        beam->unkB = 6;
        gDispCnt |= 0x6000;
        gWinRegs[4] = 0x1F1F;
        gWinRegs[5] = 0x3F;
        gBldRegs.bldCnt = 0x3FDF;
        gBldRegs.bldY = 8;
        return;
      }
      temp_r4 = strc54->unk4C - 0xE1;
      beam = TASK_DATA(strc54->beamTasks[0]);
      beam->unk0 = (s16)((0x18 - Mod(temp_r4, 25)) * 6);
      if (((u32)temp_r4 <= 0x3FU) && (Mod(temp_r4, 6) == 0)) {
        beam->unkB++;
      }
      beam = TASK_DATA(strc54->beamTasks[1]);
      beam->unk0 = (s16)(((0x18 - Mod(temp_r4, 0x19)) * 6) + 0x370);
      if (((u32)temp_r4 <= 0x3FU) && (Mod(temp_r4, 6) == 0)) {
        beam->unkB++;
      }
    } else {
      if (temp_r4 >= 30 && temp_r4 < 120) {
        sub_805423C(&strc54->strc0);
      }
    }
  }
}

/** 0x080645B0, sub_80645E4: Sonic's turn, 414 frames: his background scrolls, the screen fades in and out, and
 *  Tails' turn starts. */
void sub_80645E4(void) {
  struct Sprite *s;
  s16 temp_r4;
  u8 i;
  u32 unk4C;
  struct Task *t;

  struct Intro_C8 *strcC8;
  struct Intro_54 *strc54 = TASK_DATA(gCurTask);

  strcC8 = TASK_DATA(strc54->tasks18[0]);
  temp_r4 = strc54->unk4C;
  strcC8->unkB4 = temp_r4;
  strc54->unk50 -= 0x20;
  strc54->unk52 += 0x20;

  gBgScrollRegs[0][0] = I(strc54->unk50);
  gBgScrollRegs[0][1] = I(strc54->unk52);

  if ((A_BUTTON | B_BUTTON | START_BUTTON) & gPressedKeys) {
    gCurTask->main = CODE(IntroOpenTitlescreenPlayMusic);
    return;
  }

  unk4C = strc54->unk4C;
  if (unk4C < 30) {
    if (unk4C == 1) {
      sub_8063B8C();
    }
    strc54->strc0.unk0 = 0;
    strc54->strc0.unk2 = 1;
    strc54->strc0.unk4 = 2;
    strc54->strc0.unk6 = 0;
    strc54->strc0.unk8 = 0;
    strc54->strc0.unkA = 1;
    sub_80543A4(&strc54->strc0);
  } else if (unk4C >= 0 && unk4C < 42) {
    strc54->strc0.unk0 = 0;
    strc54->strc0.unk2 = 1;
    strc54->strc0.unk4 = 8;
    strc54->strc0.unk6 = 0;
    strc54->strc0.unk8 = 0x100;
    strc54->strc0.unkA = 1;
    sub_80543A4(&strc54->strc0);
  } else if (unk4C >= 0 && unk4C < 102) {
    sub_805423C(&strc54->strc0);
  } else if (unk4C >= 0 && unk4C < 242) {
    sub_805423C(&strc54->strc0);
  } else if (unk4C >= 0 && unk4C < 0x16A) {
    sub_805423C(&strc54->strc0);
  }
  if (++strc54->unk4C >= 414) {
    TasksDestroyInPriorityRange(0x6820, 0x6821);
    TaskDestroy(strc54->tasks18[0]);
    strc54->tasks18[0] = NULL;
    strc54->unk50 = 0xE000;
    strc54->unk52 = 0x6000;
    strc54->unk4C = 0;

    strc54->strc0.unk0 = 0;
    strc54->strc0.unk2 = 1;
    strc54->strc0.unk4 = 2;
    strc54->strc0.unk6 = 0;
    strc54->strc0.unk8 = 0;
    strc54->strc0.unkA = 1;
    sub_80543A4(&strc54->strc0);

    t = TaskCreate(CODE(Task_IntroRenderTails), sizeof(struct Intro_C8), 0x2280U, 0U, NULL);
    strc54->tasks18[1] = t;
    strcC8 = TASK_DATA(t);
    strcC8->unkB4 = 0;

    for (i = 0; i < 3; i++) {
      s = &strcC8->sprites[i];
      if (i == 2) {
        s->graphics.dest = (void *)(OBJ_VRAM0 + 0x3280);
      } else if (i == 1) {
        s->graphics.dest = (void *)(OBJ_VRAM0 + 0x1980);
      } else {
        s->graphics.dest = (void *)(OBJ_VRAM0 + 0x400);
      }
      s->graphics.anim = ANIM_INTRO_CHARACTERS;
      s->variant = 1;
      s->x = 48;
      s->y = 108;
      s->oamFlags = 0x300;
      s->graphics.size = 0;
      s->animCursor = 0;
      s->qAnimDelay = 0;
      s->prevVariant = -1;
      s->animSpeed = 0x10;
      s->palId = 0;
      s->hitboxes[0].index = -1;
      s->frameFlags = 0x80;

      if (i == 0) {
        UpdateSpriteAnimation(s);
        DisplaySprite(s);
      }
    }

    for (i = 0; i < 6; i++) {
      struct IntroSprite *introSpr;
      t = TaskCreate(CODE(sub_80656A4), sizeof(struct IntroSprite), 0x6820U, 0U, NULL);
      introSpr = TASK_DATA(t);
      s = &introSpr->s;
      introSpr->unk30 = 0;
      introSpr->unk32 = 0;
      introSpr->unk34 = i;
      introSpr->qUnk3C = gUnknown_0868417C[0] + 0x118;
      s->graphics.dest = gUnknown_086841D0[i].vram;
      s->graphics.anim = gUnknown_086841D0[i].anim;
      s->variant = gUnknown_086841D0[i].variant;
      s->x = 280;
      s->y = 70;
      s->oamFlags = 0x180;
      s->graphics.size = 0;
      s->animCursor = 0;
      s->qAnimDelay = 0;
      s->prevVariant = 0xFF;
      s->animSpeed = 0x10;
      s->palId = 0;
      s->hitboxes[0].index = -1;
      s->frameFlags = 0x80;
      UpdateSpriteAnimation(s);
      DisplaySprite(s);
    }
    gCurTask->main = CODE(sub_80648D4);
  } else {
    if (strc54->unk4C > 0x160) {
      if (strc54->unk4C == 0x161) {
        strc54->strc0.unk4 = 4;
        strc54->strc0.unk6 = 0;
        strc54->strc0.unk8 = 0x180;
      }
      sub_805423C(&strc54->strc0);
    }
  }
}

/** 0x080648A0, sub_80648D4: Tails' turn, 414 frames, and Knuckles' turn starts. */
void sub_80648D4(void) {
  struct Sprite *s;
  s16 temp_r4;
  u8 i;
  u32 unk4C;
  struct Task *t;

  struct Intro_C8 *strcC8;
  struct Intro_54 *strc54 = TASK_DATA(gCurTask);

  strcC8 = TASK_DATA(strc54->tasks18[1]);
  temp_r4 = strc54->unk4C;
  strcC8->unkB4 = temp_r4;
  strc54->unk50 += 0x20;
  strc54->unk52 -= 0x20;

  gBgScrollRegs[0][0] = I(strc54->unk50);
  gBgScrollRegs[0][1] = I(strc54->unk52);

  if ((A_BUTTON | B_BUTTON | START_BUTTON) & gPressedKeys) {
    gCurTask->main = CODE(IntroOpenTitlescreenPlayMusic);
    return;
  }

  unk4C = strc54->unk4C;
  if (unk4C < 30) {
    if (unk4C == 1) {
      sub_8063C4C();
    }
    sub_80543A4(&strc54->strc0);
  } else if (unk4C >= 0 && unk4C < 42) {
    strc54->strc0.unk0 = 0;
    strc54->strc0.unk2 = 1;
    strc54->strc0.unk4 = 8;
    strc54->strc0.unk6 = 0;
    strc54->strc0.unk8 = 0x100;
    strc54->strc0.unkA = 1;
    sub_80543A4(&strc54->strc0);
  } else if (unk4C >= 0 && unk4C < 102) {
    sub_805423C(&strc54->strc0);
  } else if (unk4C >= 0 && unk4C < 242) {
    sub_805423C(&strc54->strc0);
  } else if (unk4C >= 0 && unk4C < 0x16A) {
    sub_805423C(&strc54->strc0);
  }
  if (++strc54->unk4C >= 414) {
    TasksDestroyInPriorityRange(0x6820, 0x6821);
    strc54->unk50 = 0xE000;
    strc54->unk52 = 0x1000;
    TaskDestroy(strc54->tasks18[1]);
    strc54->tasks18[1] = NULL;
    strc54->unk4C = 0;

    strc54->strc0.unk0 = 0;
    strc54->strc0.unk2 = 1;
    strc54->strc0.unk4 = 2;
    strc54->strc0.unk6 = 0;
    strc54->strc0.unk8 = 0;
    strc54->strc0.unkA = 1;
    sub_80543A4(&strc54->strc0);

    t = TaskCreate(CODE(Task_IntroRenderKnuckles), sizeof(struct Intro_C8), 0x2230U, 0U, NULL);
    strc54->tasks18[2] = t;
    strcC8 = TASK_DATA(t);
    strcC8->unkB4 = 0;

    for (i = 0; i < 3; i++) {
      s = &strcC8->sprites[i];
      if (i == 2) {
        s->graphics.dest = (void *)(OBJ_VRAM0 + 0x3280);
      } else if (i == 1) {
        s->graphics.dest = (void *)(OBJ_VRAM0 + 0x1980);
      } else {
        s->graphics.dest = (void *)(OBJ_VRAM0 + 0x80);
      }
      s->graphics.anim = ANIM_INTRO_CHARACTERS;
      s->variant = 2;
      s->x = 48;
      s->y = 130;
      s->oamFlags = 0x3C0;
      s->graphics.size = 0;
      s->animCursor = 0;
      s->qAnimDelay = 0;
      s->prevVariant = -1;
      s->animSpeed = 0x10;
      s->palId = 0;
      s->hitboxes[0].index = -1;
      s->frameFlags = 0x80;

      if (i == 0) {
        UpdateSpriteAnimation(s);
        DisplaySprite(s);
      }
    }

    for (i = 0; i < 9; i++) {
      struct IntroSprite *introSpr;
      t = TaskCreate(CODE(sub_806571C), sizeof(struct IntroSprite), 0x6820U, 0U, NULL);
      introSpr = TASK_DATA(t);
      s = &introSpr->s;
      introSpr->unk30 = 0;
      introSpr->unk32 = 0;
      introSpr->unk34 = i;
      introSpr->qUnk3C = gUnknown_08684180[0] + 0x118;
      s->graphics.dest = gUnknown_08684218[i].vram;
      s->graphics.anim = gUnknown_08684218[i].anim;
      s->variant = gUnknown_08684218[i].variant;
      s->x = 280;
      s->y = 70;
      s->oamFlags = 0x180;
      s->graphics.size = 0;
      s->animCursor = 0;
      s->qAnimDelay = 0;
      s->prevVariant = 0xFF;
      s->animSpeed = 0x10;
      s->palId = 0;
      s->hitboxes[0].index = -1;
      s->frameFlags = 0x40080;
      UpdateSpriteAnimation(s);
    }
    gCurTask->main = CODE(sub_8064BB4);
  } else {
    if (strc54->unk4C > 0x160) {
      if (strc54->unk4C == 0x161) {
        strc54->strc0.unk4 = 4;
        strc54->strc0.unk6 = 0;
        strc54->strc0.unk8 = 0x180;
      }
      sub_805423C(&strc54->strc0);
    }
  }
}

/** 0x08064B80, sub_8064BB4: Knuckles' turn, 414 frames, and Amy's turn starts. */
void sub_8064BB4(void) {
  struct Sprite *s;
  s16 temp_r4;
  u8 i;
  u32 unk4C;
  struct Task *t;

  struct Intro_C8 *strcC8;
  struct Intro_54 *strc54 = TASK_DATA(gCurTask);

  strcC8 = TASK_DATA(strc54->tasks18[2]);
  temp_r4 = strc54->unk4C;
  strcC8->unkB4 = temp_r4;
  strc54->unk50 += 0x00;
  strc54->unk52 += 0x20;

  gBgScrollRegs[0][0] = I(strc54->unk50);
  gBgScrollRegs[0][1] = I(strc54->unk52);

  if ((A_BUTTON | B_BUTTON | START_BUTTON) & gPressedKeys) {
    gCurTask->main = CODE(IntroOpenTitlescreenPlayMusic);
    return;
  }

  unk4C = strc54->unk4C;
  if (unk4C < 30) {
    if (unk4C == 1) {
      sub_8063D0C();
    }
    sub_80543A4(&strc54->strc0);
  } else if (unk4C >= 0 && unk4C < 42) {
    strc54->strc0.unk0 = 0;
    strc54->strc0.unk2 = 1;
    strc54->strc0.unk4 = 8;
    strc54->strc0.unk6 = 0;
    strc54->strc0.unk8 = 0x100;
    strc54->strc0.unkA = 1;
    sub_80543A4(&strc54->strc0);
  } else if (unk4C >= 0 && unk4C < 102) {
    sub_805423C(&strc54->strc0);
  } else if (unk4C >= 0 && unk4C < 242) {
    sub_805423C(&strc54->strc0);
  } else if (unk4C >= 0 && unk4C < 0x16A) {
    sub_805423C(&strc54->strc0);
  }
  if (++strc54->unk4C >= 414) {
    TasksDestroyInPriorityRange(0x6820, 0x6821);
    strc54->unk50 = 0x3000;
    strc54->unk52 = 0x5000;
    TaskDestroy(strc54->tasks18[2]);
    strc54->tasks18[2] = NULL;
    strc54->unk4C = 0;

    strc54->strc0.unk0 = 0;
    strc54->strc0.unk2 = 1;
    strc54->strc0.unk4 = 2;
    strc54->strc0.unk6 = 0;
    strc54->strc0.unk8 = 0;
    strc54->strc0.unkA = 1;
    sub_80543A4(&strc54->strc0);

    t = TaskCreate(CODE(Task_IntroRenderAmy), sizeof(struct Intro_C8), 0x2230U, 0U, NULL);
    strc54->tasks18[3] = t;
    strcC8 = TASK_DATA(t);
    strcC8->unkB4 = 0;

    for (i = 0; i < 2; i++) {
      s = &strcC8->sprites[i];
      if (i != 0) {
        s->graphics.dest = (void *)(OBJ_VRAM0 + 0x6400);
      } else {
        s->graphics.dest = (void *)(OBJ_VRAM0 + 0x1440);
      }
      s->graphics.anim = ANIM_INTRO_CHARACTERS;
      s->variant = 3;
      s->x = 180;
      s->y = 108;
      s->oamFlags = 0x180;
      s->graphics.size = 0;
      s->animCursor = 0;
      s->qAnimDelay = 0;
      s->prevVariant = -1;
      s->animSpeed = 0x10;
      s->palId = 0;
      s->hitboxes[0].index = -1;
      s->frameFlags = 0x80;
      UpdateSpriteAnimation(s);

      if (i == 0) {
        DisplaySprite(s);
      }
    }

    for (i = 0; i < 4; i++) {
      struct IntroSprite *introSpr;
      t = TaskCreate(CODE(sub_8065794), sizeof(struct IntroSprite), 0x6820U, 0U, NULL);
      introSpr = TASK_DATA(t);
      s = &introSpr->s;
      introSpr->unk30 = 0;
      introSpr->unk32 = 0;
      introSpr->unk34 = i;
      introSpr->qUnk3C = gUnknown_08684184[0] + 0x118;
      s->graphics.dest = gUnknown_08684284[i].vram;
      s->graphics.anim = gUnknown_08684284[i].anim;
      s->variant = gUnknown_08684284[i].variant;
      s->x = 280;
      s->y = 70;
      s->oamFlags = 0x180;
      s->graphics.size = 0;
      s->animCursor = 0;
      s->qAnimDelay = 0;
      s->prevVariant = 0xFF;
      s->animSpeed = 0x10;
      s->palId = 0;
      s->hitboxes[0].index = -1;
      s->frameFlags = 0x40080;
      UpdateSpriteAnimation(s);
    }
    gCurTask->main = CODE(sub_8064E84);
  } else {
    if (strc54->unk4C > 0x160) {
      if (strc54->unk4C == 0x161) {
        strc54->strc0.unk4 = 4;
        strc54->strc0.unk6 = 0;
        strc54->strc0.unk8 = 0x180;
      }
      sub_805423C(&strc54->strc0);
    }
  }
}

/** 0x08064E50, sub_8064E84: Amy's turn, 414 frames, and the title screen opens with no music of its own. */
void sub_8064E84(void) {
  s16 temp_r4;
  u32 unk4C;

  struct Intro_C8 *strcC8;
  struct Intro_54 *strc54 = TASK_DATA(gCurTask);

  strcC8 = TASK_DATA(strc54->tasks18[3]);
  temp_r4 = strc54->unk4C;
  strcC8->unkB4 = temp_r4;
  strc54->unk50 -= 0x20;
  strc54->unk52 -= 0x20;

  gBgScrollRegs[0][0] = I(strc54->unk50);
  gBgScrollRegs[0][1] = I(strc54->unk52);

  if ((A_BUTTON | B_BUTTON | START_BUTTON) & gPressedKeys) {
    gCurTask->main = CODE(IntroOpenTitlescreenPlayMusic);
    return;
  }

  unk4C = strc54->unk4C;
  if (unk4C < 30) {
    if (unk4C == 1) {
      sub_8063DCC();
    }
    sub_80543A4(&strc54->strc0);
  } else if (unk4C >= 0 && unk4C < 42) {
    strc54->strc0.unk0 = 0;
    strc54->strc0.unk2 = 1;
    strc54->strc0.unk4 = 8;
    strc54->strc0.unk6 = 0;
    strc54->strc0.unk8 = 0x100;
    strc54->strc0.unkA = 1;
    sub_80543A4(&strc54->strc0);
  } else if (unk4C >= 0 && unk4C < 102) {
    sub_805423C(&strc54->strc0);
  } else if (unk4C >= 0 && unk4C < 242) {
    sub_805423C(&strc54->strc0);
  } else if (unk4C >= 0 && unk4C < 0x16A) {
    sub_805423C(&strc54->strc0);
  }
  if (++strc54->unk4C >= 414) {
    gCurTask->main = CODE(IntroOpenTitlescreenSilent);
    sub_805423C(&strc54->strc0);
  } else {
    if (strc54->unk4C > 0x160) {
      if (strc54->unk4C == 0x161) {
        strc54->strc0.unk4 = 4;
        strc54->strc0.unk6 = 0;
        strc54->strc0.unk8 = 0x180;
      }
      sub_805423C(&strc54->strc0);
    }
  }
}

/** 0x08064F6C, IntroOpenTitlescreenSilent: the opening ends by itself, and the title screen follows with the
 *  opening's music still playing. */
void IntroOpenTitlescreenSilent(void) {
  TasksDestroyInPriorityRange(0, 0xFFFF);
  gBackgroundsCopyQueueCursor = gBackgroundsCopyQueueIndex;
  gBgSpritesCount = 0;
  gVramGraphicsCopyCursor = gVramGraphicsCopyQueueIndex;

  gBgScrollRegs[0][0] = 0;
  gBgScrollRegs[0][1] = 0;
  gBgScrollRegs[1][0] = 0;
  gBgScrollRegs[1][1] = 0;
  gBgScrollRegs[2][0] = 0;
  gBgScrollRegs[2][1] = 0;
  gBgScrollRegs[3][0] = 0;
  gBgScrollRegs[3][1] = 0;

  CreateTitleScreen(0);
}

/** 0x08064FC4, IntroOpenTitlescreenPlayMusic: A, B or Start ends the opening: its music stops, and the title
 *  screen follows with its own. */
void IntroOpenTitlescreenPlayMusic(void) {
  TasksDestroyInPriorityRange(0, 0xFFFF);
  gBackgroundsCopyQueueCursor = gBackgroundsCopyQueueIndex;
  gBgSpritesCount = 0;
  gVramGraphicsCopyCursor = gVramGraphicsCopyQueueIndex;

  m4aSongNumStop(MUS_INTRO);

  gBgScrollRegs[0][0] = 0;
  gBgScrollRegs[0][1] = 0;
  gBgScrollRegs[1][0] = 0;
  gBgScrollRegs[1][1] = 0;
  gBgScrollRegs[2][0] = 0;
  gBgScrollRegs[2][1] = 0;
  gBgScrollRegs[3][0] = 0;
  gBgScrollRegs[3][1] = 0;

  CreateTitleScreen(1);
}

/** 0x08065024, Task_8065058: one of the first ring of sparkles, falling with the emerald and turning around it. */
void Task_8065058(void) {
  s16 unk30;

  struct IntroSprite *introSpr = TASK_DATA(gCurTask);
  struct Sprite *s = &introSpr->s;

  unk30 = ++introSpr->unk30;
  if (unk30 < 90 || unk30 >= 234) {
    introSpr->qUnk3C += introSpr->qUnk40;
  }
  if (unk30 < 90) {
    introSpr->qUnk40 -= 6;
    if (introSpr->qUnk40 < 0) {
      introSpr->qUnk40 = 0;
    }
  }

  if (unk30 == 0xE9) {
    introSpr->qUnk40 = 0x140;
  }

  if (introSpr->qUnk3C > Q(180)) {
    introSpr->qUnk3C = Q(180);
  }

  if (introSpr->unk34 == 0) {
    s->prevVariant = -1;
    introSpr->unk34 = 0x2F;
    introSpr->qUnk38 = introSpr->qUnk3C;
  }

  introSpr->qUnk38 -= Div(SIN((0x100 - (introSpr->unk34 * 6)) % 256u), 24);
  s->x = Div(SIN(((introSpr->unk34 * 12) + (unk30 << 5)) & 0x3FF), 650) + 120;
  s->y = I(introSpr->qUnk38);

  introSpr->unk34 -= 1;

  if (1 & introSpr->unk32) {
    s->oamFlags = SPRITE_OAM_ORDER(0);
  } else {
    s->oamFlags = SPRITE_OAM_ORDER(6);
  }

  UpdateSpriteAnimation(s);
  DisplaySprite(s);
}

/** 0x08065128, Task_806515C: one of the second ring of sparkles, the first's mirror. */
void Task_806515C(void) {
  s16 unk30;

  struct IntroSprite *introSpr = TASK_DATA(gCurTask);
  struct Sprite *s = &introSpr->s;

  unk30 = ++introSpr->unk30;
  if (unk30 < 90 || unk30 >= 234) {
    introSpr->qUnk3C += introSpr->qUnk40;
  }
  if (unk30 < 90) {
    introSpr->qUnk40 -= 6;
    if (introSpr->qUnk40 < 0) {
      introSpr->qUnk40 = 0;
    }
  }

  if (unk30 == 0xE9) {
    introSpr->qUnk40 = Q(1.25);
  }

  if (introSpr->qUnk3C > Q(212)) {
    introSpr->qUnk3C = Q(212);
  }

  if (introSpr->unk34 == 0) {
    s->prevVariant = -1;
    introSpr->unk34 = 0x2F;
    introSpr->qUnk38 = introSpr->qUnk3C;
  }

  introSpr->qUnk38 -= Div(SIN((introSpr->unk34 * 6)), 24);
  s->x = 120 - Div(SIN(((introSpr->unk34 * 12) + (unk30 << 5)) & 0x3FF), 650);
  s->y = I(introSpr->qUnk38);

  introSpr->unk34 -= 1;

  if (1 & introSpr->unk32) {
    s->oamFlags = SPRITE_OAM_ORDER(0);
  } else {
    s->oamFlags = SPRITE_OAM_ORDER(6);
  }

  UpdateSpriteAnimation(s);
  DisplaySprite(s);
}

/** 0x08065224, Task_RenderSonic: Sonic's picture in his turn: it changes at frames 30 and 190 and goes at 354. */
void Task_RenderSonic(void) {
  struct Intro_C8 *strcC8 = TASK_DATA(gCurTask);
  s16 unkB4 = strcC8->unkB4;
  u8 i;
  u8 count = 1;

  for (i = 0; i < count; i++) {
    struct Sprite *s = &strcC8->sprites[i];

    if (unkB4 == 0x1E) {
      s->prevVariant = -1;
      s->graphics.anim = gUnknown_086842B4[i * 2][0];
      s->variant = gUnknown_086842B4[i * 2][1];
      UpdateSpriteAnimation(s);
    }

    if (unkB4 > 0) {
      if (unkB4 > 0x161) {
        s->frameFlags = 0;
        UpdateSpriteAnimation(s);
      } else if (unkB4 > 0xBD) {
        if (unkB4 == 0xBE) {
          s->prevVariant = 0xFF;
          s->graphics.anim = gUnknown_086842B4[i * 2 + 1][0];
          s->variant = gUnknown_086842B4[i * 2 + 1][1];
        }
        UpdateSpriteAnimation(s);
      }
      DisplaySprite(s);
    }
  }
}

/** 0x080652F4, Task_IntroRenderTails: Tails' picture in his turn. */
void Task_IntroRenderTails(void) {
  struct Intro_C8 *strcC8 = TASK_DATA(gCurTask);
  s16 temp_r0 = strcC8->unkB4;
  u8 var_r6;
  u8 count = 1;
  for (var_r6 = 0; var_r6 < count; var_r6++) {
    struct Sprite *s = &strcC8->sprites[var_r6];
    if (temp_r0 == 0x1E) {
      if (var_r6 == 2) {
        s->graphics.dest = (void *)(OBJ_VRAM0 + 0x3280);
      } else if (var_r6 == 1) {
        s->graphics.dest = (void *)(OBJ_VRAM0 + 0x1980);
      } else {
        s->graphics.dest = (void *)(OBJ_VRAM0 + 0x80);
      }
      s->prevVariant = 0xFF;
      s->graphics.anim = gUnknown_086842BC[var_r6 * 2][0];
      s->variant = gUnknown_086842BC[var_r6 * 2][1];
      UpdateSpriteAnimation(s);
    }
    if (temp_r0 >= 0) {
      if (temp_r0 <= 0x1D) {
        UpdateSpriteAnimation(s);
      }
      if (temp_r0 > 0x161) {
        s->frameFlags = 0;
        UpdateSpriteAnimation(s);
      } else if (temp_r0 > 0xBD) {
        if (temp_r0 == 0xBE) {
          s->prevVariant = -1;
          s->graphics.anim = gUnknown_086842BC[var_r6 * 2 + 1][0];
          s->variant = gUnknown_086842BC[var_r6 * 2 + 1][1];
        }
        UpdateSpriteAnimation(s);
      }
      if ((temp_r0 > 0x1D) || (var_r6 == 0)) {
        DisplaySprite(s);
      }
    }
  }
}

/** 0x08065410, Task_IntroRenderKnuckles: Knuckles' picture in his turn. */
void Task_IntroRenderKnuckles(void) {
  struct Intro_C8 *strcC8 = TASK_DATA(gCurTask);
  s16 temp_r0 = strcC8->unkB4;
  u8 var_r6;
  u8 count = 1;
  for (var_r6 = 0; var_r6 < count; var_r6++) {
    struct Sprite *s = &strcC8->sprites[var_r6];
    if (var_r6 == 2) {
      s->graphics.dest = (void *)(OBJ_VRAM0 + 0x3280);
    } else if (var_r6 == 1) {
      s->graphics.dest = (void *)(OBJ_VRAM0 + 0x1980);
    } else {
      s->graphics.dest = (void *)(OBJ_VRAM0 + 0x80);
    }

    if (temp_r0 == 0x1E) {
      s->prevVariant = -1;
      s->graphics.anim = gUnknown_086842C4[var_r6 * 2][0];
      s->variant = gUnknown_086842C4[var_r6 * 2][1];
    }
    if (temp_r0 >= 0) {
      if (temp_r0 > 0x161) {
        s->frameFlags = 0;
        UpdateSpriteAnimation(s);
      } else if (temp_r0 > 0xEA) {
        if (temp_r0 == 0xEB) {
          s->prevVariant = -1;
          s->graphics.anim = gUnknown_086842C4[var_r6 * 2 + 1][0];
          s->variant = gUnknown_086842C4[var_r6 * 2 + 1][1];
        }
      }
      if ((temp_r0 > 0x1D) || (var_r6 == 0)) {
        UpdateSpriteAnimation(s);
        DisplaySprite(s);
      }
    }
  }
}

/** 0x08065504, Task_IntroRenderAmy: Amy's picture in her turn, gone after frame 410. */
void Task_IntroRenderAmy(void) {
  struct Intro_C8 *strcC8 = TASK_DATA(gCurTask);
  s16 unkB4 = strcC8->unkB4;
  u8 i;
  u8 count = 1;

  if (unkB4 > 410) {
    return;
  }

  for (i = 0; i < count; i++) {
    struct Sprite *s = &strcC8->sprites[i];

    if (strcC8->unkB4 == 0x161) {
      s->frameFlags = 0;
    }
    if (unkB4 == 0x1E) {
      s->prevVariant = -1;
      s->graphics.anim = gUnknown_086842CC[i * 2][0];
      s->variant = gUnknown_086842CC[i * 2][1];
      UpdateSpriteAnimation(s);
    }

    if (unkB4 >= 0) {
      if (unkB4 > 353) {
        s->frameFlags = 0;
        UpdateSpriteAnimation(s);
      } else if (unkB4 > 164) {
        if (unkB4 == 165) {
          s->prevVariant = 0xFF;
          s->graphics.anim = gUnknown_086842CC[i * 2 + 1][0];
          s->variant = gUnknown_086842CC[i * 2 + 1][1];
        }
        UpdateSpriteAnimation(s);
      }
      DisplaySprite(s);
    }
  }
}

/** 0x080655F8, Task_806562C: one of the words of Sonic's turn, sliding in from the right after frame 90. */
void Task_806562C(void) {
  struct IntroSprite *introSpr = TASK_DATA(gCurTask);
  struct Sprite *s = &introSpr->s;
  s16 temp_r0 = ++introSpr->unk30;

  if ((introSpr->unk30) == 0x161) {
    s->frameFlags = 0;
  }

  if (temp_r0 > 90) {
    temp_r0 -= 90;
    if ((introSpr->unk34 * 0xF) < temp_r0) {
      introSpr->qUnk3C -= 0x10;
      if (introSpr->qUnk3C < gUnknown_08684178[0]) {
        introSpr->qUnk3C = gUnknown_08684178[0];
      }
      s->x = introSpr->qUnk3C;
      s->y = gUnknown_08684178[1];
      UpdateSpriteAnimation(s);
      DisplaySprite(s);
    }
  }
}

/** 0x08065670, sub_80656A4: one of the words of Tails' turn. */
void sub_80656A4(void) {
  struct IntroSprite *introSpr = TASK_DATA(gCurTask);
  struct Sprite *s = &introSpr->s;
  s16 temp_r0 = ++introSpr->unk30;

  if ((introSpr->unk30) == 0x161) {
    s->frameFlags = 0;
  }

  if (temp_r0 > 90) {
    temp_r0 -= 90;
    if ((introSpr->unk34 * 0xF) < temp_r0) {
      introSpr->qUnk3C -= 0x10;
      if (introSpr->qUnk3C < gUnknown_0868417C[0]) {
        introSpr->qUnk3C = gUnknown_0868417C[0];
      }
      s->x = introSpr->qUnk3C;
      s->y = gUnknown_0868417C[1];
      UpdateSpriteAnimation(s);
      DisplaySprite(s);
    }
  }
}

/** 0x080656E8, sub_806571C: one of the words of Knuckles' turn. */
void sub_806571C(void) {
  struct IntroSprite *introSpr = TASK_DATA(gCurTask);
  struct Sprite *s = &introSpr->s;
  s16 temp_r0 = ++introSpr->unk30;

  if ((introSpr->unk30) == 0x161) {
    s->frameFlags = 0;
  }

  if (temp_r0 > 90) {
    temp_r0 -= 90;
    if ((introSpr->unk34 * 0xF) < temp_r0) {
      introSpr->qUnk3C -= 0x10;
      if (introSpr->qUnk3C < gUnknown_08684180[0]) {
        introSpr->qUnk3C = gUnknown_08684180[0];
      }
      s->x = introSpr->qUnk3C;
      s->y = gUnknown_08684180[1];
      UpdateSpriteAnimation(s);
      DisplaySprite(s);
    }
  }
}

/** 0x08065760, sub_8065794: one of the words of Amy's turn, gone after frame 410. */
void sub_8065794(void) {
  struct IntroSprite *introSpr = TASK_DATA(gCurTask);
  struct Sprite *s = &introSpr->s;
  s16 temp_r0 = ++introSpr->unk30;

  if (temp_r0 > 410) {
    return;
  }

  if ((introSpr->unk30) == 0x161) {
    s->frameFlags = 0;
  }

  if (temp_r0 > 90) {
    temp_r0 -= 90;
    if ((introSpr->unk34 * 0xF) < temp_r0) {
      introSpr->qUnk3C -= 0x10;
      if (introSpr->qUnk3C < gUnknown_08684184[0]) {
        introSpr->qUnk3C = gUnknown_08684184[0];
      }
      s->x = introSpr->qUnk3C;
      s->y = gUnknown_08684184[1];
      UpdateSpriteAnimation(s);
      DisplaySprite(s);
    }
  }
}

/** 0x080657DC, TaskDestructor_8065810: the opening's own task has nothing to give back. */
void TaskDestructor_8065810(struct Task *t) {}

/** 0x080657E0, Task_IntroChaosEmeraldUpdate: the emerald falls, waits, and falls on. */
void Task_IntroChaosEmeraldUpdate(void) {
  struct IntroSprite *introSpr = TASK_DATA(gCurTask);
  struct Sprite *s = &introSpr->s;
  s16 unk30 = introSpr->unk30;

  if ((unk30 < 90) || (unk30 > 233)) {
    introSpr->qUnk3C += introSpr->qUnk40;
  }

  if (unk30 < 90) {
    introSpr->qUnk40 -= Q(6. / 256.);
    if (introSpr->qUnk40 < Q(0)) {
      introSpr->qUnk40 = Q(0);
    }
  }

  if (unk30 == 233) {
    introSpr->qUnk40 = Q(1.25);
  }

  if (introSpr->qUnk3C > Q(180)) {
    introSpr->qUnk3C = Q(180);
  }

  s->y = I(introSpr->qUnk3C);

  UpdateSpriteAnimation(s);
  DisplaySprite(s);
}
