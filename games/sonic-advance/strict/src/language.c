// The language screen, at a first start.
#include "core.h"
#include "language.h"
#include "time.h"
#include "save.h"
#include "malloc.h"
#include "sprite.h"
#include "task.h"
#include "ui.h"
#include "dma.h"
#include "screen.h"

#define TM_LANGUAGE_SCREEN 89
#define SA1_ANIM_MENU_CURSOR 0x359

/** What the language screen keeps: the language names and the words around them, the cursor, its fade, why it opened
 *  (at a first start, or from the options) and the language chosen. */
struct EditLanguageScreen {
  /* 0x000 */ struct Sprite sprites[6];
  /* 0x120 */ struct Sprite spr120;
  /* 0x150 */ u8 filler150[0x30];
  /* 0x180 */ struct StrcUi_805423C unk180;
  /* 0x18C */ u8 unk18C;
  /* 0x18D */ u8 unk18D;
};

// for each sprite of the two sets, the first six for a first start and the rest for the options: its tiles, its
// animation and variant in each language, and where it is
extern const u8 gUnknown_08684618[12];
extern const u16 gUnknown_086845D0[12][2];
extern const u8 gUnknown_08684600[12][2];
extern const u8 gUnknown_08684624[12][2];
// where the cursor is beside each language
extern const u8 gUnknown_08684644[2][2];
// the screen's background picture
extern const u8 gUnknown_086C7DD0[0x1140];
extern const u8 gUnknown_086C8710[0x500];
extern const u16 gUnknown_086C7BD0[0x100];

void sub_80535FC(void);
u16 UiGfxStackInit(void);
void DisplaySprite(struct Sprite *s);

#define DPAD_UP 0x40
#define DPAD_DOWN 0x80
#define SE_RETURN 107
#define SE_SELECT 106
#define SE_MENU_CURSOR_MOVE 108

/** CreateEditLanguageScreen, 0x0806A700: the language screen, at a first start (`mode` 0) or from the options (1):
 *  the names of the languages and the words around them in the language the save has, the cursor, the background,
 *  and its fade in. */
void CreateEditLanguageScreen(u8 mode) {
  struct Task *t;
  struct EditLanguageScreen *screen;
  struct StrcUi_805423C *unk180;
  struct Sprite *s;
  u8 i, j, end;

  for (i = 0; i < 10; i++) {
    gKeysFirstRepeatIntervals[i] = 20;
    gKeysContinuedRepeatIntervals[i] = 8;
  }

  sub_80535FC();
  gDispCnt = DISPCNT_OBJ_ON | DISPCNT_BG0_ON | DISPCNT_OBJ_1D_MAP;
  gBgCntRegs[0] = 0x1E83;
  UiGfxStackInit();
  gBgScrollRegs[0][0] = 0;
  gBgScrollRegs[0][1] = 0;

  t = TaskCreate(CODE(Task_EditLanguageScreenInit), sizeof(struct EditLanguageScreen), 0x2000, 0, CODE(TaskDestructor_EditLanguageScreen));
  screen = TASK_DATA(t);
  unk180 = &screen->unk180;
  screen->unk18C = mode;
  screen->unk18D = gLoadedSaveGame.uiLanguage;

  i = 0;
  if (mode == 0) end = 6;
  else {
    i = 6;
    end = 12;
  }

  for (j = 0; i < end; j++, i++) {
    s = &screen->sprites[j];
    s->graphics.dest = VramMalloc(gUnknown_08684618[i]);
    s->graphics.anim = gUnknown_086845D0[i][screen->unk18D];
    s->variant = gUnknown_08684600[i][screen->unk18D];
    s->x = gUnknown_08684624[i][0];
    s->y = gUnknown_08684624[i][1];
    s->graphics.size = 0;
    s->animCursor = 0;
    s->qAnimDelay = 0;
    s->prevVariant = -1;
    s->animSpeed = SPRITE_ANIM_SPEED_1;
    s->palId = 0;
    s->hitboxes[0].index = -1;
    s->oamFlags = SPRITE_OAM_ORDER(18);
    s->frameFlags = SPRITE_PRIORITY(2);
    UpdateSpriteAnimation(s);
  }

  s = &screen->spr120;
  s->graphics.dest = VramMalloc(4);
  s->graphics.anim = SA1_ANIM_MENU_CURSOR;
  s->variant = 0;
  s->x = 33;
  s->y = 25;
  s->graphics.size = 0;
  s->animCursor = 0;
  s->qAnimDelay = 0;
  s->prevVariant = -1;
  s->animSpeed = SPRITE_ANIM_SPEED_1;
  s->palId = 0;
  s->hitboxes[0].index = -1;
  s->oamFlags = SPRITE_OAM_ORDER(18);
  s->frameFlags = SPRITE_PRIORITY(2);
  UpdateSpriteAnimation(s);

  unk180->unk0 = 0;
  unk180->unk2 = 1;
  unk180->unk4 = 2;
  unk180->unk6 = 0;
  unk180->unk8 = 0x100;
  unk180->unkA = 0x10;
  sub_805423C(unk180);
  sub_806A6A8();
}

/** 0x0806A6A8, sub_806A6A8: the language screen's background picture, on the first background. */
void sub_806A6A8(void) {
  struct Strc_80528AC gfx;

  gfx.uiGfxID = 128;
  gfx.unk2B = 0;
  gfx.tiles = gUnknown_086C7DD0;
  gfx.tilesSize = sizeof(gUnknown_086C7DD0);
  gfx.layout = gUnknown_086C8710;
  gfx.layoutSize = sizeof(gUnknown_086C8710);
  gfx.palette = gUnknown_086C7BD0;
  gfx.paletteSize = sizeof(gUnknown_086C7BD0);
  gfx.unk28 = 0;
  gfx.unk29 = 0;
  gfx.unk2A = 21;
  sub_80528AC(&gfx);
}

/** TaskDestructor_EditLanguageScreen, 0x0806AC6C: the screen's sprites give their tiles back. */
void TaskDestructor_EditLanguageScreen(struct Task *t) {
  struct EditLanguageScreen *screen = TASK_DATA(t);
  u8 i;

#ifdef MATCHING
  for (i = 0; i < 6; i++) VramFree(screen->sprites[i].graphics.dest);
  VramFree(screen->spr120.graphics.dest);
#else
  for (i = 0; i < 6; i++) {
    if (i == 0) TIME(0x0806AC6C, 0x0806AC88, 0x08006C35, IW, IW);
    else TIME(0x0806AC7C, 0x0806AC88, 0x08006C35, IW);
    VramFree(screen->sprites[i].graphics.dest);
    if (i < 5) TIME(0x0806AC8A, 0x0806AC92, 0x0806AC7D);
  }
  TIME(0x0806AC8A, 0x0806AC9E, 0x08006C35, IW);
  VramFree(screen->spr120.graphics.dest);
  TIME(0x0806ACA0, 0x0806ACA4, BACK);
#endif
}

/** What the screen goes back to: the title screen's menus at a first start, the options otherwise. */
extern void (*const sLangScreenReturnProcs[2])(void);
void m4aSoundVSyncOn(void);

/** 0x0806AA00, Task_806ABD4: once faded out, the screen goes, and from the options the save is written, with the
 *  sound and the interrupts held meanwhile; then the screen it came from. */
void Task_806ABD4(void) {
  struct EditLanguageScreen *screen = TASK_DATA(gCurTask);

  TIME(0x0806AA00, 0x0806AA18, 0x08054209, IW, IW);
  if (sub_805423C(&screen->unk180)) {
    gDispCnt &= ~0xE000;
    gBldRegs.bldCnt = 0;
    gBldRegs.bldY = 0;
    TIME(0x0806AA1A, 0x0806AA1E, 0x0806AA23);
    TIME(0x0806AA22, 0x0806AA38, 0x08001621, IW, IW, IW, IW, IW);
    TaskDestroy(gCurTask);

    if (screen->unk18C == 1) {
      u16 irqEnable, irqMasterEnable, dispStat;

      TIME(0x0806AA3A, 0x0806AA46, 0x08097919, IW);
      m4aMPlayAllStop();
      TIME(0x0806AA48, 0x0806AA4A, 0x08097DE9);
      m4aSoundVSyncOff();
      gFlags |= FLAGS_8000;
      irqEnable = REG_READ16(REG_IE);
      irqMasterEnable = REG_READ16(REG_IME);
      dispStat = REG_READ16(REG_DISPSTAT);
      REG_WRITE16(REG_IE, 0);
      REG_READ16(REG_IE);
      REG_WRITE16(REG_IME, 0);
      REG_READ16(REG_IME);
      REG_WRITE16(REG_DISPSTAT, 0);
      REG_READ16(REG_DISPSTAT);
      {
        gFlags &= ~FLAGS_EXECUTE_HBLANK_COPY;
        DMA_SLOW_STOP(0);
        DMA_SLOW_STOP(1);
        DMA_SLOW_STOP(2);
        DMA_SLOW_STOP(3);
        TIME(0x0806AA4C, 0x0806AAE2, 0x08012D4D, IW, 0x04000200, 0x04000208, 0x04000004, 0x04000200, 0x04000200, 0x04000208,
             0x04000208, 0x04000004, 0x04000004, IW, 0x040000BA, 0x040000BA, 0x040000BA, 0x040000BA, 0x040000BA, 0x040000BA,
             0x040000BA, 0x040000C6, 0x040000C6, 0x040000C6, 0x040000C6, 0x040000C6, 0x040000C6, 0x040000C6, 0x040000D2,
             0x040000D2, 0x040000D2, 0x040000D2, 0x040000D2, 0x040000D2, 0x040000D2, 0x040000DE, 0x040000DE, 0x040000DE,
             0x040000DE, 0x040000DE, 0x040000DE, 0x040000DE);
        WriteSaveGame();
      }
      REG_WRITE16(REG_IE, irqEnable);
      REG_READ16(REG_IE);
      REG_WRITE16(REG_IME, irqMasterEnable);
      REG_READ16(REG_IME);
      REG_WRITE16(REG_DISPSTAT, dispStat);
      REG_READ16(REG_DISPSTAT);
      m4aSoundVSyncOn();
      gFlags &= ~FLAGS_8000;
    }
    CALL(sLangScreenReturnProcs[screen->unk18C])();
    return;
  }
  sub_806AD44();
}

/** Task_EditLanguageScreenInit, 0x0806A920: once faded in, up and down move between the two languages. A, or Start
 *  from the options, keeps the one chosen in the save and fades out; B goes back from the options. */
void Task_EditLanguageScreenInit(void) {
  struct EditLanguageScreen *screen = TASK_DATA(gCurTask);
  struct StrcUi_805423C *unk180 = &screen->unk180;
  u8 language = screen->unk18D;
  u32 inputMask;

  if (sub_805423C(unk180)) {
    if (gRepeatedKeys & DPAD_DOWN) {
      m4aSongNumStart(SE_MENU_CURSOR_MOVE);
      if (language != 0) language = 0;
      else language = 1;
    } else if (gRepeatedKeys & DPAD_UP) {
      m4aSongNumStart(SE_MENU_CURSOR_MOVE);
      if (language != 0) language--;
      else language = 1;
    }
  }
  screen->unk18D = language;

  inputMask = (screen->unk18C != 0) ? (A_BUTTON | START_BUTTON) : A_BUTTON;
  if (gPressedKeys & inputMask) {
    m4aSongNumStart(SE_SELECT);
    gLoadedSaveGame.uiLanguage = screen->unk18D;
    unk180->unk4 = 1;
    unk180->unk6 = 0;
    gCurTask->main = CODE(Task_806ABD4);
  } else if ((gPressedKeys & B_BUTTON) && screen->unk18C == 0) {
    m4aSongNumStart(SE_RETURN);
    unk180->unk4 = 1;
    unk180->unk6 = 0;
    gCurTask->main = CODE(Task_806ABD4);
  }
  sub_806AD44();
}

/** 0x0806AB70, sub_806AD44: the language names and the words around them in the language chosen, and the cursor beside
 *  it, drawn. */
void sub_806AD44(void) {
  struct EditLanguageScreen *screen = TASK_DATA(gCurTask);
  u8 language = screen->unk18D;
  struct Sprite *s;
  u8 i, j, end;

  if (screen->unk18C == 0) {
    i = 0;
    end = 6;
  } else {
    i = 6;
    end = 11;
  }

  for (j = 0; i < end; j++, i++) {
    s = &screen->sprites[j];
    s->graphics.anim = gUnknown_086845D0[i][screen->unk18D];
    s->variant = gUnknown_08684600[i][screen->unk18D];
    s->x = gUnknown_08684624[i][0];
    s->y = gUnknown_08684624[i][1];
    s->prevVariant = -1;
    UpdateSpriteAnimation(s);
    DisplaySprite(s);
  }

  s = &screen->spr120;
  s->x = gUnknown_08684644[language][0];
  s->y = gUnknown_08684644[language][1];
  DisplaySprite(s);
}
