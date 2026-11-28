// The course select: the list of the zones' acts a character has reached, made when the character select is left with
// one chosen, its tasks and how it leaves for the act picked.
#include "console.h"
#include "core.h"
#include "save.h"
#include "sprite.h"
#include "stage.h"
#include "task.h"
#include "ui.h"

/** The course select's own task: its fade, the three tasks it keeps, the "please wait" sprite of a link game, the
 *  frames it has run, where the list is and is going, and the act picked. */
struct CourseSelectState {
  /* 0x00 */ struct StrcUi_805423C strc0;
  /* 0x0C */ u8 fillerC[4];
  /* 0x10 */ struct Task *task10;
  /* 0x14 */ struct Task *task14;
  /* 0x18 */ struct Task *task18;
  /* 0x1C */ struct Sprite s;
  /* 0x4C */ u32 unk4C;
  /* 0x50 */ u16 unk50;
  /* 0x52 */ s16 unk52;
  /* 0x54 */ u8 unk54;
  /* 0x55 */ u8 level;
  /* 0x56 */ u8 unk56;
  /* 0x57 */ u8 unk57;
  /* 0x58 */ u8 unk58;
  /* 0x59 */ u8 unk59;
};

/** The task of the arrows above and below the list. */
struct CourseSelect_54 {
  /* 0x00 */ struct Sprite s;
  /* 0x30 */ u8 filler30[0x18];
  /* 0x48 */ u32 unk48;
  /* 0x4C */ u16 unk4C;
  /* 0x4E */ u8 unk4E;
  /* 0x4F */ u8 unk4F;
  /* 0x50 */ u8 unk50;
  /* 0x51 */ u8 unk51;
};

/** The task of the acts' names, or of the zones' pictures beside them. */
struct CourseSelect_2DC {
  /* 0x000 */ struct Sprite sprites[15];
  /* 0x2D0 */ u32 unk2D0;
  /* 0x2D4 */ u16 unk2D4;
  /* 0x2D6 */ u8 unk2D6;
  /* 0x2D7 */ u8 unk2D7;
  /* 0x2D8 */ u8 unk2D8;
  /* 0x2D9 */ u8 unk2D9;
  /* 0x2DA */ u8 unk2DA;
  /* 0x2DB */ u8 unk2DB;
};

// where the list's top is, by how many lines it has, below which the arrow at the bottom shows
extern const u16 gUnknown_0868411C[16];
// the options screen's tiles, layout and colours, which the course select's background is
extern const u8 gUnknown_0869A6D0[];
extern const u8 gUnknown_0869B410[];
extern const u16 gUnknown_0869B910[];
extern const u8 gUnknown_0869BB10[];
extern const u8 gUnknown_0869CC90[];

/** One link packet's slot in gMultiSioSend / gMultiSioRecv. */
struct CourseSelectSioSlot {
  /* 0x00 */ u16 unk0;
  /* 0x02 */ u8 unk2;
  /* 0x03 */ u8 unk3;
  /* 0x04 */ u8 pad[16];
};

/** A picture's tiles: where they go in video memory, and its animation and variant. */
struct StaticTileInfo {
  /* 0x00 */ void *vram;
  /* 0x04 */ u32 anim;
  /* 0x08 */ u32 variant;
};

/** One of the menus' sets of tiles: the tiles, their colours, and where a picture made of them is. */
struct UiGraphics {
  /* 0x00 */ const u8 *tiles;
  /* 0x04 */ const u16 *palette;
  /* 0x08 */ s32 unk8;
  /* 0x0C */ s32 unkC;
  /* 0x10 */ s32 unk10;
  /* 0x14 */ s32 unk14;
  /* 0x18 */ s32 unk18;
};

// the first scroll register, which the H-blank's copy writes line by line
#define REG_ADDR_BG0HOFS 0x04000010

// the acts' names, and the zones' pictures
extern const struct StaticTileInfo gUnknown_08684008[15];
extern const struct StaticTileInfo gUnknown_086840BC[8];

extern const struct UiGraphics gUiGraphics[];
extern s8 gSelectedCharacter;
extern s8 gCurrentLevel;
extern s8 gMultiplayerCurrentLevel;
extern u8 gMultiplayerConnections;
extern u8 gMultiplayerMissingHeartbeats[4];
// how many courses a link game has open
extern u8 gUnknown_03005140;

#define MUS_COURSE_SELECTION 4
#define SE_MENU_CURSOR_MOVE 108
#define SE_SELECT 106
#define SE_RETURN 107
#define ANIM_ARROW_UP 745
#define ANIM_VS_MENU_WAIT 903
#define GAME_MODE_SINGLE_PLAYER 0
#define GAME_MODE_TIME_ATTACK 1
#define IS_SINGLE_PLAYER (gGameMode <= 1)
#define IS_MULTI_PLAYER (gGameMode > 1)
#define MULTI_SIO_PARENT 0x80
#define DPAD_DOWN 0x0080
#define DPAD_UP 0x0040
#define ALL_ZONE_CHAOS_EMERALDS 0x7F
// the chaos emeralds the save has: the USA copy reads them at 0x1C, the byte save.h names after the decompilation's
// European save, where they are a byte later
#define SAVE_CHAOS_EMERALDS (gLoadedSaveGame.btnConfig)

s32 Div(s32 num, s32 denom);
void m4aSongNumStop(u16 n);
void LinkCommunicationError(void);
void ApplyGameStageSettingsAndStart(void);
void CreateTimeAttackRecords(void);
void CreateTimeAttackRecord(u8 level);
void CreateTimeAttackMenu(void);
void CreateCharacterSelectionScreen(u8 selectedCharacter);
// the link game's waits for every player to pick, which no recording plays
void Task_80628A4(void);

void Task_CourseSelectInit(void);
void Task_8062140(void);
void Task_8062540(void);
void Task_8062A80(void);
void Task_8062B38(void);
void Task_8062C28(void);
void Task_8062CB4(void);
void Task_8062E18(void);
void TaskDestructor_CourseSelect(struct Task *t);

/** sub_8061894, 0x08061860: the course select's background, the options screen's two layers. */
void sub_8061894(void) {
  struct Strc_80528AC gfx;

  UiGfxStackInit();

  gfx.uiGfxID = 128;
  gfx.unk2B = 1;
  gfx.tiles = gUnknown_0869A6D0;
  gfx.tilesSize = 0xE00;
  gfx.layout = gUnknown_0869B410;
  gfx.layoutSize = 0x500;
  gfx.unk29 = 1;
  gfx.unk2A = 0x11;
  gfx.unk0.unk4 = 0;
  gfx.unk0.unk8 = 0;
  gfx.unk0.unk9 = 0;
  gfx.unk0.unkA = 0;
  gfx.unk0.unkB = 0;
  sub_80528AC(&gfx);

  gfx.uiGfxID = 128;
  gfx.unk2B = 0;
  gfx.tiles = gUnknown_0869BB10;
  gfx.tilesSize = 0x1180;
  gfx.palette = gUnknown_0869B910;
  gfx.paletteSize = 0x200;
  gfx.layout = gUnknown_0869CC90;
  gfx.layoutSize = 0x1000;
  gfx.unk28 = 0;
  gfx.unk29 = 0;
  gfx.unk2A = 0x15;
  sub_80528AC(&gfx);
}

/** CreateCourseSelect, 0x08061914: the course select's screen, with as many lines as the acts the character has
 *  reached, or every zone's from the Time Attack records (`records` 1), its own task and the three it keeps, the
 *  arrows, the acts' names and the zones' pictures, its song, and the first step of its fade. */
void CreateCourseSelect(u8 records) {
  struct Strc_80528AC gfx;
  s32 fromRecords;
  struct Task *t;
  struct Task *t1;
  u8 count;
  struct CourseSelect_54 *arrows;
  struct CourseSelectState *state;
  struct CourseSelect_2DC *names;
  struct CourseSelect_2DC *zones;
  struct Task *t2;
  struct Sprite *s;
  u8 i;

  fromRecords = records;
  gMultiplayerMissingHeartbeats[3] = 0;
  gMultiplayerMissingHeartbeats[2] = 0;
  gMultiplayerMissingHeartbeats[1] = 0;
  gMultiplayerMissingHeartbeats[0] = 0;
  m4aSongNumStart(MUS_COURSE_SELECTION);
  sub_80535FC();
  UiGfxStackInit();

  if (records == 1) {
    count = 13;
  } else {
    if (IS_MULTI_PLAYER) {
      count = gUnknown_03005140 + 2;
    } else {
      count = gLoadedSaveGame.unlockedLevels[gSelectedCharacter] + 2;
    }

    if (gSelectedCharacter == 0) {
      if (count == 0) {
        count = 1;
      }
      if (count > 15) {
        count = 15;
      } else if (gLoadedSaveGame.unlockedLevels[0] == 0xD) {
        count = 14;
      }
    } else {
      if (count == 0) {
        count = 1;
      }
      if (count > 14) {
        count = 14;
      }
    }
    if ((gGameMode != 0) && (count > 0xDU)) {
      count = 13;
    }
  }

  gDispCnt = 0x1340;
  gBgCntRegs[0] = 0x1D83;
  gBgCntRegs[1] = 0x1886;
  gBgScrollRegs[0][0] = 0;
  gBgScrollRegs[0][1] = 0;
  gBgScrollRegs[1][0] = 0;
  gBgScrollRegs[1][1] = 0;
  sub_8061894();

  t = TaskCreate(CODE(Task_CourseSelectInit), sizeof(struct CourseSelectState), 0x2000U, 0U, CODE(TaskDestructor_CourseSelect));
  state = TASK_DATA(t);
  state->unk4C = 0;
  state->unk57 = 0;
  state->unk50 = 0x14;
  state->unk52 = 0x14;
  state->unk54 = 0;
  state->level = 1;
  state->unk58 = count;
  state->unk59 = fromRecords;
  state->strc0.unk0 = 0;
  state->strc0.unk2 = 1;
  state->strc0.unk4 = 2;
  state->strc0.unk6 = 0;
  state->strc0.unk8 = 0x200;
  state->strc0.unkA = 1;

  t1 = TaskCreate(CODE(Task_8062E18), sizeof(struct CourseSelect_54), 0x2030U, 0U, NULL);
  arrows = TASK_DATA(t1);
  arrows->unk48 = 0;
  arrows->unk4C = 0;
  arrows->unk4E = 0;
  arrows->unk4F = 0;
  arrows->unk51 = count;
  s = &arrows->s;
  s->graphics.dest = (void *)(OBJ_VRAM0 + 0x6400);
  s->graphics.anim = ANIM_ARROW_UP;
  s->variant = 0;
  s->oamFlags = 0;
  s->graphics.size = 0;
  s->animCursor = 0;
  s->qAnimDelay = 0;
  s->prevVariant = -1;
  s->animSpeed = 0x10;
  s->palId = 0;
  s->hitboxes[0].index = -1;
  s->frameFlags = 0;
  UpdateSpriteAnimation(s);

  state->task18 = t1;
  s = &state->s;
  s->x = 120;
  s->y = 80;
  s->graphics.dest = (u8 *)arrows->s.graphics.dest + 0xC0;
  s->oamFlags = 0x80;
  s->graphics.size = 0;
  s->graphics.anim = ANIM_VS_MENU_WAIT;
  s->variant = 0;
  s->animCursor = 0;
  s->qAnimDelay = 0;
  s->prevVariant = -1;
  s->animSpeed = 0x10;
  s->palId = 0;
  s->frameFlags = 0x2000;
  UpdateSpriteAnimation(s);

  t2 = TaskCreate(CODE(Task_8062A80), sizeof(struct CourseSelect_2DC), 0x2030U, 0U, NULL);
  names = TASK_DATA(t2);
  names->unk2D0 = 0;
  names->unk2D4 = 0;
  names->unk2D6 = 0;
  names->unk2D7 = 0;
  names->unk2DA = count;
  names->unk2D9 = 0;
  names->unk2DB = fromRecords;

  for (i = 0; i < state->unk58; i++) {
    s = &names->sprites[i];
    s->graphics.dest = gUnknown_08684008[i].vram;
    s->graphics.anim = gUnknown_08684008[i].anim;
    s->variant = gUnknown_08684008[i].variant;
    s->oamFlags = 0x480;
    s->graphics.size = 0;
    s->animCursor = 0;
    s->qAnimDelay = 0;
    s->prevVariant = -1;
    s->animSpeed = 0x10;
    s->palId = 0;
    s->hitboxes[0].index = -1;
    s->frameFlags = 0x2000;
    UpdateSpriteAnimation(s);
  }
  for (; i < 15; i++) {
    s = &names->sprites[i];
    s->graphics.dest = NULL;
  }
  state->task10 = t2;

  t2 = TaskCreate(CODE(Task_8062C28), sizeof(struct CourseSelect_2DC), 0x2030U, 0U, NULL);
  zones = TASK_DATA(t2);
  zones->unk2D0 = 0;
  zones->unk2D4 = 0;
  zones->unk2D6 = 0;
  zones->unk2D7 = 0;
  zones->unk2DA = count;

  for (i = 0; i < 8; i++) {
    s = &zones->sprites[i];
    s->graphics.dest = gUnknown_086840BC[i].vram;
    s->graphics.anim = gUnknown_086840BC[i].anim;
    s->variant = gUnknown_086840BC[i].variant;
    s->oamFlags = 0x480;
    s->graphics.size = 0;
    s->animCursor = 0;
    s->qAnimDelay = 0;
    s->prevVariant = -1;
    s->animSpeed = 0x10;
    s->palId = 0;
    s->hitboxes[0].index = -1;
    s->frameFlags = 0x2000;
    UpdateSpriteAnimation(s);
  }
  for (; i < 15; i++) {
    s = &zones->sprites[i];
    s->graphics.dest = NULL;
  }
  state->task14 = t2;

  if (fromRecords == 1) {
    gBgScrollRegs[0][1] = 0x14;
    gBgCntRegs[0] = 0x9D83;
    state->unk4C = 0x3F;
    names->unk2D0 = 0x3F;
    zones->unk2D0 = 0x3F;
    t->main = CODE(Task_8062140);
    state->task10->main = CODE(Task_8062B38);
    state->task14->main = CODE(Task_8062CB4);

    gfx.uiGfxID = 62;
    gfx.unk2B = 0;
    gfx.tiles = gUiGraphics[62].tiles;
    gfx.palette = gUiGraphics[62].palette;
    gfx.tilesSize = 0x20;
    gfx.paletteSize = 0x20;
    gfx.unk28 = 3;
    gfx.vramC = (u8 *)OBJ_VRAM0 + 0x20;
    gfx.unk2A = 0xC;
    gfx.unk0.unk4 = gUiGraphics[62].unk8;
    gfx.unk0.unk8 = gUiGraphics[62].unkC;
    gfx.unk0.unk9 = gUiGraphics[62].unk10;
    gfx.unk0.unkA = gUiGraphics[62].unk14;
    gfx.unk0.unkB = gUiGraphics[62].unk18;
    sub_80528AC(&gfx);
  }
  sub_805423C(&state->strc0);
}

/** Task_CourseSelectInit, 0x08061E50: the list sliding in for 63 frames, or until A, the cursor's colours copied in
 *  over its first ten, and the lines of the list put apart by the H-blank's scroll, each act's line later than the
 *  one above it. */
void Task_CourseSelectInit(void) {
  struct Strc_80528AC gfx;
  u32 frame;
  u8 n;
  u8 m;
  u8 k;
  u16 *offsets;
  u8 line = 0;
  struct CourseSelectState *state = TASK_DATA(gCurTask);
  struct CourseSelect_2DC *names = TASK_DATA(state->task10);
  struct CourseSelect_2DC *zones = TASK_DATA(state->task14);
  struct CourseSelect_54 *arrows = TASK_DATA(state->task18);
  u8 count;

  frame = state->unk4C;
  count = state->unk58;
  frame++;
  if ((frame == 0x3F) && (count == 1)) {
    state->unk52 = 0;
  } else {
    state->unk52 = 0x14;
  }

  state->unk50 = 0x14;
  if (frame < 11) {
    gfx.uiGfxID = 62;
    gfx.unk2B = 0;
    gfx.tiles = gUiGraphics[62].tiles;
    gfx.palette = gUiGraphics[62].palette;
    gfx.tilesSize = 0x20;
    gfx.paletteSize = 0x20;
    gfx.unk28 = 3;
    gfx.vramC = (u8 *)OBJ_VRAM0 + 0x20;
    gfx.unk2A = 0xC;
    gfx.unk0.unk4 = gUiGraphics[62].unk8;
    gfx.unk0.unk8 = gUiGraphics[62].unkC;
    gfx.unk0.unk9 = gUiGraphics[62].unk10;
    gfx.unk0.unkA = gUiGraphics[62].unk14;
    gfx.unk0.unkB = gUiGraphics[62].unk18;
    sub_80528AC(&gfx);
  }
  state->unk4C = frame;
  names->unk2D0 = frame;
  zones->unk2D0 = frame;
  arrows->unk48 = frame;
  names->unk2D7 = state->level;
  zones->unk2D7 = state->level;
  arrows->unk4F = state->level;
  state->unk50 += Div(((s16)state->unk52 - state->unk50) * 2, 10);
  names->unk2D4 = state->unk50;
  zones->unk2D4 = (u16)state->unk50;
  arrows->unk4C = (u16)state->unk50;
  names->unk2D9 = (u8)state->unk57;
  sub_805423C(&state->strc0);

  gFlags |= 4;
  gHBlankCopyTarget = (void *)REG_ADDR_BG0HOFS;
  gHBlankCopySize = 4;
  offsets = gBgOffsetsHBlankPrimary;

  for (n = 0; n < 12; n++, line++) {
    *offsets++ = 0;
    *offsets++ = 0x14;
  }

  // below the title's twelve lines, each act's line comes after a gap that closes as the slide goes on
  for (n = 0; line < DISPLAY_HEIGHT; n++) {
    m = 0;
    for (; m < (0x40 - frame) && (line < DISPLAY_HEIGHT); line++, m++) {
      *offsets++ = 0;
      *offsets++ = (0 - line) & 0x1FF;
    }

    m = (n * 24) - line + 0x20;
    for (k = 0; (k < 0x18) && (line < DISPLAY_HEIGHT); line++, k++) {
      *offsets++ = 0;
      *offsets++ = m;
    }
  }

  if ((frame == 0x3F) || (A_BUTTON & gPressedKeys)) {
    gBgScrollRegs[0][1] = 0x14;
    state->unk4C = 0x3F;
    names->unk2D0 = 0x3F;
    zones->unk2D0 = 0x3F;
    gBgCntRegs[0] = 0x9D83;
    gFlags &= ~4;
    gCurTask->main = CODE(Task_8062140);
  }
}

/** Task_8062140, 0x0806210C: the course select as it waits, the cursor moved by Up and Down, the list scrolled so the
 *  act picked shows, and A to pick it or B to go back, once the fade is over; in a link game the first player picks
 *  for everyone. */
void Task_8062140(void) {
  s32 top;
  s32 y;
  u32 frame;
  u8 count;
  struct CourseSelectSioSlot *packet;
  u32 i;
  struct CourseSelectState *state = TASK_DATA(gCurTask);
  struct CourseSelect_2DC *names = TASK_DATA(state->task10);
  struct CourseSelect_2DC *zones = TASK_DATA(state->task14);
  struct CourseSelect_54 *arrows = TASK_DATA(state->task18);

  if (IS_MULTI_PLAYER) {
    for (i = 0; (i < 4) && ((gMultiplayerConnections >> i) & 1); i++) {
      if (!(gMultiSioStatusFlags & (1 << i))) {
        if (gMultiplayerMissingHeartbeats[i]++ > 0xB4U) {
          TasksDestroyInPriorityRange(0U, 0xFFFFU);
          gBackgroundsCopyQueueCursor = gBackgroundsCopyQueueIndex;
          gBgSpritesCount = 0;
          gVramGraphicsCopyCursor = gVramGraphicsCopyQueueIndex;
          LinkCommunicationError();
          return;
        }
      } else {
        gMultiplayerMissingHeartbeats[i] = 0;
      }
    }

    if (IS_MULTI_PLAYER) {
      packet = (struct CourseSelectSioSlot *)gMultiSioRecv;

      if ((gMultiSioStatusFlags & MULTI_SIO_PARENT) == 0) {
        if (packet->unk0 > 0x4FU) {
          state->level = packet->unk2;
        }
        UpdateSpriteAnimation(&state->s);
        DisplaySprite(&state->s);
      }
    }
  }

  frame = state->unk4C;
  count = state->unk58;
  frame++;
  if (((gMultiSioStatusFlags & MULTI_SIO_PARENT) == MULTI_SIO_PARENT) || IS_SINGLE_PLAYER) {
    if (state->unk58 > 1U) {
      if (DPAD_DOWN & gRepeatedKeys) {
        if (state->level < (count - 1)) {
          m4aSongNumStart(SE_MENU_CURSOR_MOVE);
          state->level++;
        }
      } else if (DPAD_UP & gRepeatedKeys) {
        if (state->level > 1U) {
          m4aSongNumStart(SE_MENU_CURSOR_MOVE);
          state->level--;
        }
      }
    }
  }

  if (state->level > (Div(state->unk52, 24) + 5)) {
    if (((gSelectedCharacter != 0) || (gCurrentLevel < 12) || (SAVE_CHAOS_EMERALDS != ALL_ZONE_CHAOS_EMERALDS)
         || (gLoadedSaveGame.unlockedLevels[0] <= 12) || (gLoadedSaveGame.unlockedLevels[1] <= 12)
         || (gLoadedSaveGame.unlockedLevels[2] <= 12) || (gLoadedSaveGame.unlockedLevels[3] <= 12)
         || ((gLoadedSaveGame.unlockedLevels[0] == 0xF) && (gMultiplayerCurrentLevel == 12)))
        && (count > 0xDU) && (state->level == 0xD)) {
      top = state->level;
      top -= 5;
      state->unk52 = (top * 0x18) - 8;
    } else {
      state->unk52 = (((((state->level - 5) & 0x1E) + 1) * 24) - 8);
    }
  } else {
    if (state->level <= Div(state->unk52, 0x18)) {
      top = state->level;
      y = (top * 0x18) - 8;
      if (y > 0x10) {
        top = (u32)top >> 1;
        top <<= 1;
        y = state->unk52 = ((top - 1) * 0x18) - 8;
      } else {
        state->unk52 = (top * 0x18) - 8;
      }
    }
  }
  state->unk4C = frame;
  names->unk2D0 = frame;
  zones->unk2D0 = frame;
  arrows->unk48 = frame;
  names->unk2D7 = state->level;
  zones->unk2D7 = state->level;
  arrows->unk4F = state->level;
  state->unk50 += Div((state->unk52 - state->unk50) * 2, 10);
  names->unk2D4 = state->unk50;
  zones->unk2D4 = state->unk50;
  arrows->unk4C = state->unk50;
  names->unk2D9 = state->unk57;
  sub_805423C(&state->strc0);

  if (IS_MULTI_PLAYER) {
    packet = (struct CourseSelectSioSlot *)gMultiSioSend;
    packet->unk0 = 0x50;
    packet->unk2 = state->level;
  }

  if (state->strc0.unk6 > 0x1800) {
    if ((s16)state->strc0.unk4 == 2) {
      if (IS_SINGLE_PLAYER) {
        if (A_BUTTON & gPressedKeys) {
          if (gGameMode != GAME_MODE_TIME_ATTACK) {
            m4aSongNumStop(MUS_COURSE_SELECTION);
          }
          if (frame > 64) {
            state->unk57 = 1;
            gCurTask->main = CODE(Task_8062540);
            m4aSongNumStart(SE_SELECT);
            state->strc0.unk4 = 1;
            state->strc0.unk6 = 0x2000 - state->strc0.unk6;
          }
        } else if ((B_BUTTON & gPressedKeys) != 0) {
          m4aSongNumStop(MUS_COURSE_SELECTION);
          state->unk57 = 2;
          gCurTask->main = CODE(Task_8062540);
          m4aSongNumStart(SE_RETURN);
          state->strc0.unk4 = 1;
          state->strc0.unk6 = 0x2000 - state->strc0.unk6;
        }
      } else {
        if (((gMultiSioStatusFlags & MULTI_SIO_PARENT) == MULTI_SIO_PARENT) && (A_BUTTON & gPressedKeys)) {
          packet = (struct CourseSelectSioSlot *)gMultiSioSend;
          packet->unk0 = 0x51;
        }

        packet = (struct CourseSelectSioSlot *)gMultiSioRecv;
        if (packet->unk0 == 0x51) {
          state->unk57 = 1;
          gCurTask->main = CODE(Task_8062540);
          m4aSongNumStart(SE_SELECT);
          m4aSongNumStop(MUS_COURSE_SELECTION);
          state->strc0.unk4 = 1;
          state->strc0.unk6 = 0x2000 - state->strc0.unk6;
        }
      }
    }
  }

  gBgScrollRegs[0][1] = state->unk50;
}

/** Task_8062540, 0x0806250C: the fade out once an act is picked or B pressed, then the act, its Time Attack records,
 *  or the screen before. */
void Task_8062540(void) {
  u8 level;
  s32 frame;
  u8 *count;
  u32 i;
  struct CourseSelectSioSlot *packet;
  struct CourseSelectState *state = TASK_DATA(gCurTask);
  struct CourseSelect_2DC *names = TASK_DATA(state->task10);
  struct CourseSelect_2DC *zones = TASK_DATA(state->task14);
  struct CourseSelect_54 *arrows = TASK_DATA(state->task18);

  if (IS_MULTI_PLAYER) {
    for (i = 0; (i < 4) && ((gMultiplayerConnections >> i) & 1); i++) {
      if (!(gMultiSioStatusFlags & (1 << i))) {
        if (gMultiplayerMissingHeartbeats[i]++ > 0xB4U) {
          TasksDestroyInPriorityRange(0U, 0xFFFFU);
          gBackgroundsCopyQueueCursor = gBackgroundsCopyQueueIndex;
          gBgSpritesCount = 0;
          gVramGraphicsCopyCursor = gVramGraphicsCopyQueueIndex;
          LinkCommunicationError();
          return;
        }
      } else {
        gMultiplayerMissingHeartbeats[i] = 0;
      }
    }

    if (IS_MULTI_PLAYER) {
      packet = (struct CourseSelectSioSlot *)gMultiSioRecv;

      if ((gMultiSioStatusFlags & MULTI_SIO_PARENT) == 0) {
        if (packet->unk0 > 0x4FU) {
          state->level = packet->unk2;
        }
      }
    }
  }

  frame = state->unk4C;
  count = &state->unk58;
  frame++;

  if (*count == 1) {
    state->unk52 = 0;
  }
  state->unk4C = frame;
  names->unk2D0 = frame;
  zones->unk2D0 = frame;
  arrows->unk48 = frame;
  names->unk2D7 = (u8)state->level;
  zones->unk2D7 = state->level;
  arrows->unk4F = (u8)state->level;
  state->unk50 += Div((state->unk52 - state->unk50) * 2, 10);
  names->unk2D4 = state->unk50;
  zones->unk2D4 = state->unk50;
  arrows->unk4C = state->unk50;
  names->unk2D9 = state->unk57;
  sub_805423C(&state->strc0);

  if ((state->strc0.unk6 > 0x1800) && ((s16)state->strc0.unk4 == 1)) {
    if (IS_SINGLE_PLAYER) {
      gDispCnt &= 0x1FFF;
      gBldRegs.bldCnt = 0;
      gBldRegs.bldY = 0;
      gBgCntRegs[0] = 0x9D03;
      gBgCntRegs[1] = 0x1806;
      if (state->unk57 == 1) {
        if (gGameMode == GAME_MODE_TIME_ATTACK) {
          level = state->level;
          if (level == 0) {
            gCurrentLevel = 0;
            gMultiplayerCurrentLevel = 0;
          } else if (level < 0x13) {
            gCurrentLevel = level - 1;
            gMultiplayerCurrentLevel = gCurrentLevel;
          }
          CreateTimeAttackRecords();

          TaskDestroy(state->task18);
          TaskDestroy(state->task14);
          TaskDestroy(state->task10);
          TaskDestroy(gCurTask);
        } else if (state->unk59 == 1) {
          CreateTimeAttackRecord((u8)(state->level - 1));

          TaskDestroy(state->task18);
          TaskDestroy(state->task14);
          TaskDestroy(state->task10);
          TaskDestroy(gCurTask);
        } else {
          gBgSprites_Unknown1[0] = 0;
          gBgSprites_Unknown2[0][0] = 0;
          gBgSprites_Unknown2[0][1] = 0;
          gBgSprites_Unknown2[0][2] = -1;
          gBgSprites_Unknown2[0][3] = 0x20;
          gBgSprites_Unknown1[1] = 0;
          gBgSprites_Unknown2[1][0] = 0;
          gBgSprites_Unknown2[1][1] = 0;
          gBgSprites_Unknown2[1][2] = -1;
          gBgSprites_Unknown2[1][3] = 0x20;
          gBgSprites_Unknown1[2] = 0;
          gBgSprites_Unknown2[2][0] = 0;
          gBgSprites_Unknown2[2][1] = 0;
          gBgSprites_Unknown2[2][2] = -1;
          gBgSprites_Unknown2[2][3] = 0x20;
          gBgSprites_Unknown1[3] = 0;
          gBgSprites_Unknown2[3][0] = 0;
          gBgSprites_Unknown2[3][1] = 0;
          gBgSprites_Unknown2[3][2] = -1;
          gBgSprites_Unknown2[3][3] = 0x20;

          level = state->level;
          if (level == 0) {
            gCurrentLevel = 0;
            gMultiplayerCurrentLevel = 0;
            ApplyGameStageSettingsAndStart();
          } else if ((u32)level < 19) {
            gCurrentLevel = level - 1;
            gMultiplayerCurrentLevel = gCurrentLevel;
            ApplyGameStageSettingsAndStart();
          }

          TaskDestroy(state->task18);
          TaskDestroy(state->task14);
          TaskDestroy(state->task10);
          TaskDestroy(gCurTask);
        }
      } else {
        u32 fromRecords = state->unk59;
        TaskDestroy(state->task18);
        TaskDestroy(state->task14);
        TaskDestroy(state->task10);
        TaskDestroy(gCurTask);

        if (fromRecords == 1) {
          CreateTimeAttackMenu();
        } else {
          CreateCharacterSelectionScreen(0);
        }
      }
    } else {
      gCurTask->main = CODE(Task_80628A4);
      goto link;
    }
  } else {
    gBgScrollRegs[0][1] = (s16)state->unk50;

  link:
    if (IS_MULTI_PLAYER) {
      if ((gMultiSioStatusFlags & MULTI_SIO_PARENT) == MULTI_SIO_PARENT) {
        packet = (struct CourseSelectSioSlot *)gMultiSioSend;
        packet->unk0 = 0x51;
        packet->unk2 = state->level;
      }
    }
  }
}

/** Task_8062A80, 0x08062A4C: the acts' names sliding in from below, the one picked a little to the right and in its
 *  other colours, until the slide's 63rd frame. */
void Task_8062A80(void) {
  struct Sprite *s;
  s16 x;
  u8 i;
  struct CourseSelect_2DC *list = TASK_DATA(gCurTask);

  for (i = 1; i < list->unk2DA; i++) {
    s = &list->sprites[i];
    if (i == list->unk2D7) {
      s->palId = 1;
      x = 0x4C;
    } else {
      s->palId = 0;
      x = 0x48;
    }
    s->x = x;
    s->y = ((i - 1) * 24) + (i * (64 - list->unk2D0)) + 16;
    s->frameFlags |= 0x40000;
    UpdateSpriteAnimation(s);
    DisplaySprite(s);
  }

  if (list->unk2D0 == 0x3F) {
    gCurTask->main = CODE(Task_8062B38);
  }
}

/** Task_8062B38, 0x08062B04: the eight acts' names the screen shows of the list, from where it has scrolled to, the
 *  one picked to the right and in its other colours, blinking once it's chosen. */
void Task_8062B38(void) {
  struct Sprite *s;
  u8 picked;
  u8 blink;
  u8 records;
  u8 index;
  u32 first;
  u8 n;
  struct CourseSelect_2DC *list = TASK_DATA(gCurTask);

  records = list->unk2DB;
  first = Div(list->unk2D4, 24) - 1;
  first <<= 24;
  n = 0;
  index = first >>= 24;
  for (; n < 8; n++, index++) {
    if ((index != 0) && (index <= (s32)(list->unk2DA - 1))) {
      s = &list->sprites[index];
      if (records == 1) {
        s->frameFlags |= 0x40000;
      }
      if (index == list->unk2D7) {
        picked = list->unk2D9;
        if (picked == 1) {
          blink = list->unk2D0 & picked;
          if (blink != 0) {
            s->palId = 1;
          } else {
            s->palId = 0;
          }
        } else {
          s->palId = 1;
        }
        s->x = 0x4C;
      } else {
        s->x = 0x48;
        s->palId = 0;
      }
      s->y = (index * 0x18) - (list->unk2D4 - 0xC);
      UpdateSpriteAnimation(s);
      DisplaySprite(s);
    }
  }
}

/** Task_8062C28, 0x08062BF4: the zones' pictures sliding in from below on the right, one for each two acts the list
 *  has, until the slide's 63rd frame. */
void Task_8062C28(void) {
  struct Sprite *s;
  u8 i;
  struct CourseSelect_2DC *zones = TASK_DATA(gCurTask);

  for (i = 1; i < 6; i++) {
    s = &zones->sprites[i - 1];
    s->palId = 0;
    s->x = 212;
    s->y = ((i - 1) * 48) + (i * ((64 - zones->unk2D0) << 1)) + 0x21;

    if (zones->unk2DA > (((i - 1) * 2) + 1)) {
      UpdateSpriteAnimation(s);
      DisplaySprite(s);
    }
  }

  if (zones->unk2D0 == 0x3F) {
    gCurTask->main = CODE(Task_8062CB4);
  }
}

/** Task_8062CB4, 0x08062C80: the zones' pictures as the list scrolls, six of them once it's moved down a zone, five
 *  before; the Moon Zone's and the X Zone's a little higher, and the X Zone's for Sonic once he has all of them. */
void Task_8062CB4(void) {
  struct Sprite *s;
  s32 y;
  u8 i;
  u8 n;
  struct CourseSelect_2DC *zones = TASK_DATA(gCurTask);

  if (zones->unk2D4 > 0x2FU) {
    u32 first = Div(zones->unk2D4, 0x30) - 1;
    first <<= 24;
    n = 1;
    i = first >>= 24;
    for (; n < 7; n++, i++) {
      if (i < 8) {
        s = &zones->sprites[i];
        s->x = 212;
        s->palId = 0;
        y = (zones->unk2D4 - 0x37);
        y = (i * 0x30) - y;
        s->y = y;
        if (i == 6) {
          s->y = y - 0xC;
        }
        if (i == 7) {
          s->y = (u16)s->y - 0x24;
        }

        if (zones->unk2DA > ((i * 2) + 1)) {
          UpdateSpriteAnimation(s);
          DisplaySprite(s);
        } else if ((i == 7) && ((s8)gSelectedCharacter == 0) && (zones->unk2DA == 0xF)) {
          UpdateSpriteAnimation(s);
          DisplaySprite(s);
        }
      }
    }
  } else {
    u32 first = Div(zones->unk2D4, 48);
    first <<= 24;
    n = 1;
    i = first >>= 24;
    for (; n < 6; n++, i++) {
      if (i < 8) {
        s = &zones->sprites[i];
        s->x = 212;
        s->palId = 0;
        y = (zones->unk2D4 - 0x37);
        y = (i * 0x30) - y;
        s->y = y;
        if (i == 6) {
          s->y = y - 0xC;
        }
        if (i == 7) {
          s->y = (u16)s->y - 36;
          if ((gSelectedCharacter == 0) && (zones->unk2DA < 16)) {
            UpdateSpriteAnimation(s);
            DisplaySprite(s);
          }
        } else if (zones->unk2DA > ((i * 2) + 1)) {
          UpdateSpriteAnimation(s);
          DisplaySprite(s);
        }
      }
    }
  }
}

/** Task_8062E18, 0x08062DE4: the arrows, the one above when the list has moved down, and the one below, flipped,
 *  while the list has more lines below than the screen shows. */
void Task_8062E18(void) {
  struct CourseSelect_54 *arrows = TASK_DATA(gCurTask);
  struct Sprite *s = &arrows->s;

  if (arrows->unk4C != 0x14) {
    s->frameFlags &= 0xFFFFF7FF;
    s->x = 48;
    s->y = 24;
    UpdateSpriteAnimation(s);
    DisplaySprite(s);
    if (((u32)arrows->unk51 > 6U) && ((u32)arrows->unk4C < gUnknown_0868411C[arrows->unk51 - 1])) {
      s->frameFlags |= 0x800;
      s->x = 48;
      s->y = 136;
      DisplaySprite(s);
    }
  } else {
    if (((u32)arrows->unk51 > 7U) && (arrows->unk4C < gUnknown_0868411C[arrows->unk51 - 1])) {
      s->frameFlags |= 0x800;
      s->x = 48;
      s->y = 136;
      UpdateSpriteAnimation(s);
      DisplaySprite(s);
    }
  }
}

/** TaskDestructor_CourseSelect, 0x08062EA4: nothing to free. */
void TaskDestructor_CourseSelect(struct Task *t) {
}
