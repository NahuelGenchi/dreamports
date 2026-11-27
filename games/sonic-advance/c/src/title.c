// The title screen: its background, the PRESS START and copyright sprites, and the game's logo, loaded while the
// screen comes out of white and then brought down to its size. Start opens the main menu, which is here too: its
// screen, its cursor and five lines, and the fade to white that leaves it for what was chosen.
#include "console.h"
#include "background.h"
#include "core.h"
#include "logos.h"
#include "malloc.h"
#include "save.h"
#include "sprite.h"
#include "task.h"
#include "ui.h"
#ifdef MATCHING
void *memcpy(void *, const void *, unsigned int);
struct MP2KPlayerState;
void m4aSongNumStop(u16 n);
void m4aMPlayImmInit(struct MP2KPlayerState *player);
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
#define SE_SELECT 106
#define SE_MENU_CURSOR_MOVE 108
#define MUS_BOSS_FIGHT 29
#define GAME_MODE_SINGLE_PLAYER 0
#define DPAD_UP 0x0040
#define DPAD_DOWN 0x0080
#define DISPCNT_WIN0_ON 0x2000
#define DISPCNT_WIN1_ON 0x4000
#define ANIM_CHAO_HOVER_SIDE 699
#define NUM_MAIN_MENU_ITEMS 5
#define MENU_ITEMS_TOP_Y 93
#define MENU_ITEMS_SPACE 14
/** Where a background's block of tiles is in video memory, as its control register says. */
#define BG_TILES(bg) (VRAM + ((gBgCntRegs[bg] & 0xC) << 12))

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

/** What the main menu keeps: its cursor, its five lines, the title's two backgrounds, and its fade. */
struct MainMenu {
  /* 0x000 */ struct Sprite s;
  /* 0x030 */ struct Sprite items[NUM_MAIN_MENU_ITEMS];
  /* 0x120 */ struct Background bg120;
  /* 0x160 */ struct Background bg160;
  /* 0x1A0 */ struct StrcUi_805423C unk1A0;
  /* 0x1AC */ u16 unk1AC;
  /* 0x1AE */ u8 selectedItem;
  /* 0x1AF */ u8 unk1AF;
  /* 0x1B0 */ s16 unk1B0;
};

/** Which of the game's modes is played, and a value of the stages' the main menu zeroes (stage.h has them). */
extern u8 gGameMode;
extern u8 gUnknown_03005018;

/** The PRESS START sprite's animation in each language. */
extern const u16 gUnknown_080B8344[2];
/** The main menu's lines' animation in each language, and each line's picture of it in each language. */
extern const u16 gUnknown_080B8318[2];
extern const u8 gUnknown_080B831C[NUM_MAIN_MENU_ITEMS * 2];
/** How many tiles each of the main menu's lines takes. */
extern const u8 sTitlescreenFrameTileSizes[NUM_MAIN_MENU_ITEMS];

void m4aSongNumStart(u16 n);
void CreateTitleScreen(u32 playMusic);
void Task_LoadGameLogo(void);
void Task_800D7EC(void);
void sub_800D878(void);
void CreateMainMenu(u32 param0);
void Task_MainMenuInit(void);
void Task_SwitchToMainMenu(void);
void TaskDestructor_TitleScreen(struct Task *t);
void Task_SwitchTo_Task_MainMenu_Select(void);
void Task_MainMenu_Select(void);
void Task_800DE44(void);
void Task_800DEE4(void);
/** The demo that plays when the title screen is left alone, by its address: the title screen only names it. */
void Task_SwitchToDemoInit(void);
/** What each of the main menu's lines after the first opens: VS, Time Attack, Options and Tiny Chao Garden. */
extern void (*const sMainMenuSecondaryItems[NUM_MAIN_MENU_ITEMS - 1])(void);
/** The music's player, which the sound engine keeps. */
extern struct MP2KPlayerState gMPlayInfo_BGM;
/** The character select's screen and tasks, with the character it starts on (character_select.c). */
void CreateCharacterSelectionScreen(u8 selectedCharacter);
/** A rotating background's registers from an angle, a size each way and where it turns about (rotation.c). */
void sa2__sub_8003EE4(u16 angle, s16 scaleX, s16 scaleY, s16 pivotX, s16 pivotY, s16 screenX, s16 screenY, struct BgAffineReg *affine);

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

/** Task_800D7EC, 0x0800D7EC: the game's logo comes down to its size, four times as large at first, slower and
 *  slower, and stops at its own size. */
void Task_800D7EC(void) {
  struct TitleScreen *title = TASK_DATA(gCurTask);

  gDispCnt |= DISPCNT_BG2_ON;

  title->unkE4 += title->unkE6;
  title->unkE6 -= 8;
  if (title->unkE4 < 0x100) {
    title->unkE4 = 0x100;
    title->unkE2 = 0;
    gCurTask->main = CODE(sub_800D878);
  }

  sa2__sub_8003EE4(0, title->unkE4, title->unkE4, 0x8D, 0x1A, 0xC0, 30, gBgAffineRegs);
}

/** sub_800D878, 0x0800D878: the title screen waits. After a second PRESS START blinks, and Start opens the main menu.
 *  After fifteen seconds with no Start, one of the game's demos plays. */
void sub_800D878(void) {
  struct TitleScreen *title = TASK_DATA(gCurTask);

  if (++title->unkE2 > 60) {
    if (gPressedKeys & START_BUTTON) {
      m4aSongNumStart(SE_SELECT);
      gCurTask->main = CODE(Task_SwitchToMainMenu);
      return;
    }

    if (!((title->unkE2 - 60) & 0x20)) {
      DisplaySprite(&title->s);
    }
  }

  DisplaySprite(&title->s2);

  if (title->unkE2 > 900) {
    gCurTask->main = CODE(Task_SwitchToDemoInit);
    return;
  }
}

/** CreateMainMenu, 0x0800D8FC: the main menu's screen and task, over the title's background and logo, which it draws
 *  again, with a fade, only when it isn't the title screen that opens it. */
void CreateMainMenu(u32 param0) {
  struct StrcUi_805423C *fade;
  struct Task *t;
  struct MainMenu *menu;
  struct Sprite *s;
  struct Background *bg;

  gGameMode = 0;
  gUnknown_03005018 = 0;
  gDispCnt = 0x1541;
  gBgCntRegs[2] = 0x568D;
  gBgCntRegs[0] = 0x1482;
  gBgScrollRegs[0][0] = 0;
  gBgScrollRegs[0][1] = 0;
  gBgScrollRegs[1][0] = 0;
  gBgScrollRegs[1][1] = 0;
  gBgScrollRegs[2][0] = 0;
  gBgScrollRegs[2][1] = 0;

  t = TaskCreate(CODE(Task_MainMenuInit), sizeof(struct MainMenu), 0x2000, 0, NULL);
  menu = TASK_DATA(t);
  s = &menu->s;
  menu->unk1AC = 0;
  menu->unk1AF = param0;

  s->x = 120;
  s->y = 80;
  s->graphics.dest = (void *)(VRAM + 0x40);
  s->graphics.size = 0;
  s->graphics.anim = 1;
  s->variant = 0;
  s->animCursor = 0;
  s->prevVariant = 0xFF;
  s->qAnimDelay = 0;
  s->animSpeed = 0x10;
  s->palId = 0;
  s->frameFlags = 0x10000;

  if (menu->unk1AF != 0) {
    gBgSprites_Unknown1[0] = 0;
    gBgSprites_Unknown2[0][0] = 0;
    gBgSprites_Unknown2[0][1] = 0;
    gBgSprites_Unknown2[0][2] |= ~0;
    gBgSprites_Unknown2[0][3] = 0x20;
    gBgSprites_Unknown1[2] |= ~0;
    gBgSprites_Unknown2[2][0] = 0;
    gBgSprites_Unknown2[2][1] = 0;
    gBgSprites_Unknown2[2][2] |= ~0;
    gBgSprites_Unknown2[2][3] = 0x20;

    DMA3_FILL32(0, BG_TILES(0), 0x40);
    DMA3_FILL32(0, BG_TILES(2) + 0x3FC0, 0x80); // as the original does it, 64 bytes past the block of tiles
  }

  menu->selectedItem = 0;
  bg = &menu->bg120;
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

  if (menu->unk1AF != 0) {
    DrawBackground(bg);
  }

  bg = &menu->bg160;
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
  bg->paletteOffset = 0;
  bg->flags = 6;

  if (menu->unk1AF != 0) {
    DrawBackground(bg);
  }

  sa2__sub_8003EE4(0, 0x100, 0x100, 0x8D, 0x1A, 0xC0, 30, gBgAffineRegs);
  fade = &menu->unk1A0;
  fade->unk0 = 0;
  fade->unk2 = 1;
  fade->unk4 = 2;
  fade->unk6 = 0;
  fade->unk8 = 0x200;
  fade->unkA = 1;

  if (menu->unk1AF != 0) {
    sub_805423C(fade);
  }
}

/** Task_MainMenuInit, 0x0800DB6C: once the menu's fade is done, or at once from the title screen: the menu's five
 *  lines, each with its tiles and its picture in the save's language, the cursor's sprite, and how fast a held
 *  button repeats. */
void Task_MainMenuInit(void) {
  bool32 faded;
  u8 i;

  struct MainMenu *menu = TASK_DATA(gCurTask);
  struct Sprite *s = &menu->s;
  struct StrcUi_805423C *fade = &menu->unk1A0;

  faded = TRUE;
  if (menu->unk1AF != 0) {
    faded = sub_805423C(fade) ? TRUE : FALSE;
  }

  if (faded) {
    if (s->graphics.size == 0) {
      s->x = 0;
      s->y = 0;
      s->graphics.dest = (void *)OBJ_VRAM0;
      s->oamFlags = 0x3C0;
      s->graphics.size = 0;
      s->graphics.anim = ANIM_CHAO_HOVER_SIDE;
      s->variant = 0;
      s->animCursor = 0;
      s->qAnimDelay = 0;
      s->prevVariant = 0xFF;
      s->animSpeed = 0x10;
      s->palId = 0;
      s->frameFlags = 0x400;

      gCurTask->main = CODE(Task_SwitchTo_Task_MainMenu_Select);
    }

    for (i = 0; i < NUM_MAIN_MENU_ITEMS; i++) {
      s = &menu->items[i];
      s->x = 120;
      s->y = (i * MENU_ITEMS_SPACE) + MENU_ITEMS_TOP_Y;
      s->graphics.dest = VramMalloc((u32)sTitlescreenFrameTileSizes[i]);
      s->graphics.size = 0;
      s->graphics.anim = gUnknown_080B8318[gLoadedSaveGame.uiLanguage];
      s->variant = gUnknown_080B831C[gLoadedSaveGame.uiLanguage + (i * 2)];
      s->oamFlags = 0x3C0;
      s->graphics.size = 0;
      s->animCursor = 0;
      s->qAnimDelay = 0;
      s->prevVariant = 0xFF;
      s->animSpeed = 0x10;
      s->palId = 0;
      s->frameFlags = 0;
      UpdateSpriteAnimation(s);
    }

    for (i = 0; i < 10; i++) {
      gKeysFirstRepeatIntervals[i] = 20;
      gKeysContinuedRepeatIntervals[i] = 8;
    }

    gDispCnt &= 0x9FFF;
    gBldRegs.bldCnt = 0;
    gBldRegs.bldY = 0;
  }
}

/** Task_MainMenu_Select, 0x0800DCFC: the main menu waits for a choice. Up and Down move the cursor, round from one
 *  end to the other, the line chosen is drawn in its bright colours, and A starts the fade to white that leaves the
 *  menu. */
void Task_MainMenu_Select(void) {
  s32 result;
  u8 i;

  struct MainMenu *menu = TASK_DATA(gCurTask);
  struct Sprite *s = &menu->s;

  if (gRepeatedKeys & DPAD_UP) {
    m4aSongNumStart(SE_MENU_CURSOR_MOVE);

    if (--menu->selectedItem > NUM_MAIN_MENU_ITEMS - 1) {
      menu->selectedItem = NUM_MAIN_MENU_ITEMS - 1;
    }
  } else if (gRepeatedKeys & DPAD_DOWN) {
    m4aSongNumStart(SE_MENU_CURSOR_MOVE);

    if (++menu->selectedItem > NUM_MAIN_MENU_ITEMS - 1) {
      menu->selectedItem = 0;
    }
  }

  s->x = 72;
  s->y = (menu->selectedItem * MENU_ITEMS_SPACE) + 107;

  // the cursor's animation, on through any command that gives it another
  while ((result = UpdateSpriteAnimation(s)) != 1) {
    if (result == 0) {
      break;
    }
  }

  for (i = 0; i < NUM_MAIN_MENU_ITEMS; i++) {
    s = &menu->items[i];

    // the first line has colours of its own
    if (i == menu->selectedItem) {
      if (i != 0) {
        s->palId = 1;
      } else {
        s->palId = i;
      }
    } else {
      if (i != 0) {
        s->palId = 0;
      } else {
        s->palId = 255;
      }
    }

    UpdateSpriteAnimation(s);
    DisplaySprite(s);
  }

  if (A_BUTTON & gPressedKeys) {
    m4aSongNumStart(SE_SELECT);
    gCurTask->main = CODE(Task_800DE44);
    menu->unk1B0 = 0;

    // Tiny Chao Garden, the last line, leaves the sprites out of the fade
    if (menu->selectedItem == 4) {
      gBldRegs.bldCnt = 0xBF;
    } else {
      gBldRegs.bldCnt = 0xFF;
    }

    gBldRegs.bldY = 0;
  }
}

/** Task_800DE44, 0x0800DE44: the menu fades to white, a third of a step a frame. Once it is white, the two
 *  backgrounds are set to be cleared, and the next frame leaves the menu. */
void Task_800DE44(void) {
  u8 i;

  struct MainMenu *menu = TASK_DATA(gCurTask);

  menu->unk1B0 += 0x55;

  if (menu->unk1B0 >= Q(16)) {
    menu->unk1B0 = Q(16);

    gCurTask->main = CODE(Task_800DEE4);

    gBgSprites_Unknown1[0] = 0;
    gBgSprites_Unknown2[0][0] = 0;
    gBgSprites_Unknown2[0][1] = 0;
    gBgSprites_Unknown2[0][2] = 0xFF;
    gBgSprites_Unknown2[0][3] = 0x20;
    gBgSprites_Unknown1[2] = 0;
    gBgSprites_Unknown2[2][0] = 0;
    gBgSprites_Unknown2[2][1] = 0;
    gBgSprites_Unknown2[2][2] = 0xFF;
    gBgSprites_Unknown2[2][3] = 0x20;

    gFlags &= ~FLAGS_EXECUTE_HBLANK_COPY;
  }

  gBldRegs.bldY = I(menu->unk1B0);

  for (i = 0; i < NUM_MAIN_MENU_ITEMS; i++) {
    DisplaySprite(&menu->items[i]);
  }
}

/** Task_800DEE4, 0x0800DEE4: the menu is left for what was chosen. Its lines give their tiles back, its task ends,
 *  and the music player is started on a song and stopped at once, which silences the title's. The first line opens
 *  the character select, in the one player game. Each of the others has its own function, called with the fade off. */
void Task_800DEE4(void) {
  u8 selectedItem;
  u8 i;

  struct MainMenu *menu = TASK_DATA(gCurTask);

  selectedItem = menu->selectedItem;

  for (i = 0; i < NUM_MAIN_MENU_ITEMS; i++) {
    VramFree(menu->items[i].graphics.dest);
  }

  TaskDestroy(gCurTask);
  m4aSongNumStart(MUS_BOSS_FIGHT);
  m4aMPlayImmInit(&gMPlayInfo_BGM);
  m4aSongNumStop(MUS_BOSS_FIGHT);

  if (selectedItem == 0) {
    gGameMode = GAME_MODE_SINGLE_PLAYER;
    CreateCharacterSelectionScreen(0);
    return;
  }

  gDispCnt &= ~(DISPCNT_WIN0_ON | DISPCNT_WIN1_ON);
  gBldRegs.bldCnt = 0;
  gBldRegs.bldY = 0;
  CALL(sMainMenuSecondaryItems[selectedItem - 1])();
}

/** Task_SwitchToMainMenu, 0x0800E008: from the title screen to the main menu, with no fade. */
void Task_SwitchToMainMenu(void) {
  TaskDestroy(gCurTask);
  CreateMainMenu(0);
}

/** TaskDestructor_TitleScreen, 0x0800E020: gives back the tiles of the title's two sprites. */
void TaskDestructor_TitleScreen(struct Task *t) {
  struct TitleScreen *title = TASK_DATA(gCurTask);

  VramFree(title->s.graphics.dest);
  VramFree(title->s2.graphics.dest);
}

/** Task_SwitchTo_Task_MainMenu_Select, 0x0800E044: the main menu's task becomes the one that waits for a choice, and
 *  runs it this same frame. */
void Task_SwitchTo_Task_MainMenu_Select(void) {
  gCurTask->main = CODE(Task_MainMenu_Select);
  CALL(gCurTask->main)();
}
