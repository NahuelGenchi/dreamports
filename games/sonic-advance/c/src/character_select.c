// The character select: its screen and its tasks, made when the main menu's first line is chosen.
#include "console.h"
#include "core.h"
#include "save.h"
#include "sprite.h"
#include "stage.h"
#include "task.h"
#include "ui.h"
#include "ui_draw.h"
#ifdef MATCHING
void *memcpy(void *, const void *, unsigned int);
void m4aSongNumStop(u16 n);
#else
void *memcpy(void *dest, const void *src, unsigned long n);
void m4aSongNumStop(u16 n);
#endif

// the four character sprites, by where each is
#define CIDX_LEFT 0
#define CIDX_MIDDLE 1
#define CIDX_RIGHT 2
#define CIDX_BLOCK 3   // shown over a character someone else has taken
#define CIDX_COUNT 4

#define ANIM_CHAR_SELECT_CHARACTERS 722
#define ANIM_CHAR_SELECT_BACKGROUND 723
#define ANIM_CHAR_SELECT_BLOCK 730
#define MUS_CHARACTER_SELECTION 3
#define SE_SHIFT 103
#define SE_SELECT 106
#define SE_RETURN 107
#define SE_RING_COPY 117
#define DPAD_RIGHT 0x0010
#define DPAD_LEFT 0x0020
#define DPAD_UP 0x0040
#define DISPLAY_WIDTH 240
#define GAME_MODE_SINGLE_PLAYER 0
#define GAME_MODE_TIME_ATTACK 1
#define IS_SINGLE_PLAYER (gGameMode <= 1)
#define IS_MULTI_PLAYER (gGameMode > 1)
#define WIN_RANGE(a, b) (((a) << 8) | (b))
enum { WINREG_WIN0H, WINREG_WIN1H, WINREG_WIN0V, WINREG_WIN1V, WINREG_WININ, WINREG_WINOUT };

/** Where a background's block of tiles is in video memory, as its control register says. */
#define BG_TILES(bg) (VRAM + ((gBgCntRegs[bg] & 0xC) << 12))

/** One multiplayer packet slot in gMultiSioSend / gMultiSioRecv. */
struct MultiSioSlot {
  /* 0x00 */ u16 unk0;
  /* 0x02 */ u8 unk2;
  /* 0x03 */ u8 unk3;
  /* 0x04 */ u8 pad[16];
};

#ifdef MATCHING
struct SioMultiCntBits {
  u32 baudRate : 2;
  u32 si : 1;
  u32 sd : 1;
  u32 id : 2;
  u32 error : 1;
  u32 enable : 1;
  u32 unused : 6;
  u32 intrEnable : 1;
};
#define SIO_MULTI_ID (((volatile struct SioMultiCntBits *)0x04000128)->id)
#else
#define SIO_MULTI_ID ((u32)((REG_READ16(REG_SIOCNT) >> 4) & 3))
#endif

/** A task of one picture. */
struct CharSelect_20 {
  /* 0x00 */ struct GameOverB overB;
  /* 0x18 */ s32 unk18;
  /* 0x1C */ u16 unk1C;
  /* 0x1E */ s16 unk1E;
};

/** The task of the sprite drawn into the screen's background. */
struct CharSelect_34 {
  /* 0x00 */ struct Sprite s;
  /* 0x30 */ u16 unk30;
  /* 0x32 */ u16 unk32;
};

/** The character select's own task: its fade, its other tasks, and which character the wheel is on. */
struct CharSelect_3C {
  /* 0x00 */ struct StrcUi_805423C strc0;
  /* 0x0C */ struct Task *taskC;    // the four character sprites
  /* 0x10 */ struct Task *task10;
  /* 0x14 */ struct Task *task14;   // the two pictures
  /* 0x18 */ struct Task *task18;
  /* 0x1C */ struct Task *task1C;
  /* 0x20 */ struct Task *task20;   // the background's sprite
  /* 0x24 */ u32 unk24;
  /* 0x28 */ s16 unk28;
  /* 0x2A */ s8 unk2A;
  /* 0x2B */ s8 unk2B;
  /* 0x2C */ u8 unk2C;
  /* 0x2D */ u8 unk2D;
  /* 0x2E */ u8 unk2E;
  /* 0x2F */ u8 unk2F;
  /* 0x30 */ u8 filler30[9];
  /* 0x39 */ u8 unk39;
};

/** A task of two pictures. */
struct CharSelect_44 {
  /* 0x00 */ struct GameOverB overB;
  /* 0x18 */ struct GameOverB overB2;
  /* 0x30 */ u32 unk30;
  /* 0x34 */ u32 unk34;
  /* 0x38 */ u32 unk38;
  /* 0x3C */ s32 unk3C;
  /* 0x40 */ s16 unk40;
};

/** The task of the four character sprites. */
struct CharSelect_Chars {
  /* 0x00 */ struct Sprite sprites[CIDX_COUNT];
  /* 0xC0 */ u32 unkC0;
  /* 0xC4 */ s16 unkC4;
  /* 0xC6 */ u8 unkC6;
  /* 0xC7 */ u8 unkC7;
  /* 0xC8 */ u8 unkC8;
  /* 0xC9 */ u8 unkC9;
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

extern const struct UiGraphics gUiGraphics[];
extern const s16 gSineTable[1280];
extern s8 gSelectedCharacter;
extern u8 gCurrentLevel;
extern u8 gMultiplayerCurrentLevel;
extern u8 gMultiplayerConnections;

// read-only tables and tile strips in the cartridge
extern const u16 gUnknown_0868146C[4];
extern const u8 gUnknown_08681474[4];
extern const u8 gUnknown_08681478[4];
extern const char gUnknown_0868147C[25];
extern const char gUnknown_08681498[9];
extern const u8 gUnknown_086814A4[25];
extern const char gUnknown_086814C0[9];
extern const u16 gUnknown_086814CA[16];
extern const u8 gUnknown_086814EA[14];
extern const char gUnknown_086814F8[2];
extern const char gUnknown_086814FC[2];
extern const u8 gUnknown_086814FE[2][3];
extern const u8 gUnknown_08681504[2][8];
extern const u16 gUnknown_08681514[10];

s32 Div(s32 num, s32 denom);
s32 Mod(s32 num, s32 denom);
void m4aSongNumStartOrContinue(u16 n);
s32 UpdateSpriteAnimation_BG(struct Sprite *s);
void DisplaySprite_BG(struct Sprite *s);
void CreateMainMenu(u32 param0);
// functions outside the character select, reached only on exits that aren't ported yet
void LinkCommunicationError(void);
void Task_805A54C(void);
void sub_801C9D8(void);
void ApplyGameStageSettingsAndStart(void);
void CreateCourseSelect(u8 param0);
void CreateTimeAttackMenu(void);

// the character select's own task and helper twins
void Task_8059F9C(void);
void Task_805A060(void);
void sub_805A9A4(void);
void Task_805AAF8(void);
void Task_805AC00(void);
void Task_805ACD8(void);
void sub_805ADF0(void);
void Task_805AE84(void);
void Task_805AF24(void);
void sub_805AFC4(void);
void Task_805B11C(void);
void Task_805B1E0(void);
void sub_805B324(void);
void Task_805B52C(void);
void sub_805B694(void);
void CheckCPUPartnerUnlock(void);
void sub_805B858(void);
void Task_805B880(void);
void Task_805B8C0(void);
void Task_805B930(void);
void Task_nullsub_805B980(void);
void Task_805B984(void);

/** CreateCharacterSelectionScreen, 0x080597A8: the character select's screen, its own task and the six it keeps, the
 *  sprite of its background, the five sets of tiles of its pictures, with the colours and the name of the character
 *  it starts on, the four character sprites, its music and the first step of its fade. */
void CreateCharacterSelectionScreen(u8 selectedCharacter) {
  struct Strc_80528AC gfx;
  struct Task *t;
  struct Task *t2;
  struct CharSelect_3C *select;
  struct CharSelect_20 *line;
  struct CharSelect_20 *line2;
  struct CharSelect_20 *line3;
  struct CharSelect_44 *pair;
  struct CharSelect_34 *back;
  struct CharSelect_Chars *chars;
  struct Sprite *s;
  s8 wheel;

  gTailsEnabled = FALSE;
  gMultiplayerMissingHeartbeats[3] = 0;
  gMultiplayerMissingHeartbeats[2] = 0;
  gMultiplayerMissingHeartbeats[1] = 0;
  gMultiplayerMissingHeartbeats[0] = 0;
  sub_80535FC();
  UiGfxStackInit();
  gDispCnt = 0x1240;
  gBgCntRegs[1] = 0x1907;
  gBgScrollRegs[1][0] = 0;
  gBgScrollRegs[1][1] = 0;
  gBgScrollRegs[2][0] = 0;
  gBgScrollRegs[2][1] = 0;

  select = TASK_DATA(TaskCreate(CODE(Task_8059F9C), sizeof(struct CharSelect_3C), 0x2000U, 0U, NULL));
  select->unk28 = 0x2000 + ((selectedCharacter & 3) << 8);
  wheel = (selectedCharacter & 3) + 0x20;
  select->unk2A = wheel;
  select->unk2B = wheel;
  select->unk2C = 0;
  select->unk2D = 0;
  select->unk2E = 0;
  select->unk24 = 0;
  select->unk39 = 0xFF;
  select->unk2F = 0;
  select->strc0.unk0 = 0;
  select->strc0.unk2 = 0;
  select->strc0.unk4 = 2;
  select->strc0.unk6 = 0;
  select->strc0.unk8 = 0x200;
  select->strc0.unkA = 1;

  t = TaskCreate(CODE(Task_nullsub_805B980), sizeof(struct CharSelect_20), 0x2030U, 0U, NULL);
  line = TASK_DATA(t);
  line->overB.qUnkA = 0x100;
  line->overB.unkC = 0x40;
  line->overB.unkE = 8;
  line->overB.unk10 = 0;
  line->overB.unk12 = 0xF;
  line->overB.unk16 = 1;
  line->overB.unk8 = 0x5A;
  line->unk18 = 0;
  line->unk1C = select->unk28;
  line->unk1E = select->unk28;
  select->task10 = t;

  t = TaskCreate(CODE(Task_nullsub_805B980), sizeof(struct CharSelect_20), 0x2040U, 0U, NULL);
  line2 = TASK_DATA(t);
  line2->overB.qUnkA = 0x100;
  line2->overB.unkC = 0x28;
  line2->overB.unkE = 1;
  line2->overB.unk10 = 1;
  line2->overB.unk12 = 0;
  line2->overB.unk16 = 1;
  line2->overB.unk8 = 0;
  line2->unk18 = 0;
  line2->unk1C = 0;
  select->task1C = t;

  t = TaskCreate(CODE(Task_nullsub_805B980), sizeof(struct CharSelect_20), 0x2030U, 0U, NULL);
  line3 = TASK_DATA(t);
  line3->overB.qUnkA = 0;
  line3->overB.unkC = 0x54;
  line3->overB.unkE = 6;
  line3->overB.unk10 = 2;
  line3->overB.unk12 = 0;
  line3->overB.unk16 = 1;
  line3->overB.unk8 = 0x14;
  line3->unk18 = 0;
  line3->unk1C = 0;
  line3->unk1E = 0;
  select->task18 = t;

  t = TaskCreate(CODE(Task_nullsub_805B980), sizeof(struct CharSelect_44), 0x2030U, 0U, NULL);
  pair = TASK_DATA(t);
  pair->overB.unk16 = 1;
  pair->overB.unk10 = 3;
  pair->overB.qUnkA = 0;
  pair->overB.unkC = 0x38;
  pair->overB.unkE = 8;
  pair->overB.unk12 = 0;
  pair->overB.unk8 = 0x78;
  pair->overB2.qUnkA = 0x118;
  pair->overB2.unkC = 0x3A;
  pair->overB2.unkE = 9;
  pair->overB2.unk10 = 4;
  pair->overB2.unk12 = 0;
  pair->overB2.unk16 = 1;
  pair->overB2.unk8 = 0x64;
  pair->unk38 = 0;
  pair->unk30 = 0;
  pair->unk34 = 0x4600;
  pair->unk3C = 0x4600;
  pair->unk40 = 0;
  select->task14 = t;

  t = TaskCreate(CODE(Task_805B984), sizeof(struct CharSelect_34), 0x2020U, 0U, NULL);
  back = TASK_DATA(t);
  s = &back->s;
  back->unk30 = 0;
  back->unk32 = 0;
  s->graphics.dest = (void *)(BG_TILES(1) + 0x40);
  s->graphics.size = 0;
  s->frameFlags = 0x8000;
  s->x = 0;
  s->y = 0;
  s->oamFlags = 0;
  s->qAnimDelay = 0;
  s->prevVariant = -1;
  s->animSpeed = 0x10;
  s->palId = 0;
  s->graphics.anim = ANIM_CHAR_SELECT_BACKGROUND;
  s->variant = 0;
  select->task20 = t;
  UpdateSpriteAnimation_BG(s);
  DisplaySprite_BG(s);

  // the frame, in the colours of the character it starts on
  gfx.uiGfxID = 0x27;
  gfx.unk2B = 0;
  gfx.tiles = gUiGraphics[gfx.uiGfxID].tiles;
  gfx.palette = gUiGraphics[gfx.uiGfxID].palette + (selectedCharacter * 3);
  gfx.tilesSize = 0x400;
  gfx.paletteSize = 8;
  gfx.unk28 = 0xF;
  gfx.vramC = (u8 *)OBJ_VRAM0 + 0x0020;
  gfx.unk2A = 0xD;
  gfx.unk0.unk4 = gUiGraphics[gfx.uiGfxID].unk8;
  gfx.unk0.unk8 = gUiGraphics[gfx.uiGfxID].unkC;
  gfx.unk0.unk9 = gUiGraphics[gfx.uiGfxID].unk10;
  gfx.unk0.unkA = gUiGraphics[gfx.uiGfxID].unk14;
  gfx.unk0.unkB = gUiGraphics[gfx.uiGfxID].unk18;
  sub_80528AC(&gfx);

  gfx.uiGfxID = 0x28;
  gfx.unk2B = 1;
  gfx.tiles = gUiGraphics[gfx.uiGfxID].tiles;
  gfx.palette = gUiGraphics[gfx.uiGfxID].palette;
  gfx.tilesSize = 0x400;
  gfx.paletteSize = 0x20;
  gfx.unk28 = 0;
  gfx.vramC = (u8 *)OBJ_VRAM0 + 0x0420;
  gfx.unk2A = 0xD;
  gfx.unk0.unk4 = gUiGraphics[gfx.uiGfxID].unk8;
  gfx.unk0.unk8 = gUiGraphics[gfx.uiGfxID].unkC;
  gfx.unk0.unk9 = gUiGraphics[gfx.uiGfxID].unk10;
  gfx.unk0.unkA = gUiGraphics[gfx.uiGfxID].unk14;
  gfx.unk0.unkB = gUiGraphics[gfx.uiGfxID].unk18;
  sub_80528AC(&gfx);

  // the name of the character it starts on
  gfx.uiGfxID = 0x29;
  gfx.unk2B = 2;
  gfx.tiles = gUiGraphics[gfx.uiGfxID].tiles + (selectedCharacter * 0xC00);
  gfx.palette = gUiGraphics[gfx.uiGfxID].palette;
  gfx.tilesSize = 0xC00;
  gfx.vramC = (u8 *)OBJ_VRAM0 + 0x1120;
  gfx.paletteSize = 0x20;
  gfx.unk28 = 0;
  gfx.unk2A = 9;
  gfx.unk0.unk4 = gUiGraphics[gfx.uiGfxID].unk8;
  gfx.unk0.unk8 = gUiGraphics[gfx.uiGfxID].unkC;
  gfx.unk0.unk9 = gUiGraphics[gfx.uiGfxID].unk10;
  gfx.unk0.unkA = gUiGraphics[gfx.uiGfxID].unk14;
  gfx.unk0.unkB = gUiGraphics[gfx.uiGfxID].unk18;
  sub_80528AC(&gfx);

  // the last two keep the colours given before them
  gfx.uiGfxID = 0x2B;
  gfx.unk2B = 3;
  gfx.tiles = gUiGraphics[gfx.uiGfxID].tiles;
  gfx.tilesSize = 0x100;
  gfx.vramC = (u8 *)OBJ_VRAM0 + 0x820;
  gfx.paletteSize = 0x20;
  gfx.unk28 = 0;
  gfx.unk2A = 9;
  gfx.unk0.unk4 = gUiGraphics[gfx.uiGfxID].unk8;
  gfx.unk0.unk8 = gUiGraphics[gfx.uiGfxID].unkC;
  gfx.unk0.unk9 = gUiGraphics[gfx.uiGfxID].unk10;
  gfx.unk0.unkA = gUiGraphics[gfx.uiGfxID].unk14;
  gfx.unk0.unkB = gUiGraphics[gfx.uiGfxID].unk18;
  sub_80528AC(&gfx);

  gfx.uiGfxID = 0x2A;
  gfx.unk2B = 4;
  gfx.tiles = gUiGraphics[gfx.uiGfxID].tiles;
  gfx.tilesSize = 0x800;
  gfx.vramC = (u8 *)OBJ_VRAM0 + 0x920;
  gfx.paletteSize = 0x20;
  gfx.unk28 = 0;
  gfx.unk2A = 9;
  gfx.unk0.unk4 = gUiGraphics[gfx.uiGfxID].unk8;
  gfx.unk0.unk8 = gUiGraphics[gfx.uiGfxID].unkC;
  gfx.unk0.unk9 = gUiGraphics[gfx.uiGfxID].unk10;
  gfx.unk0.unkA = gUiGraphics[gfx.uiGfxID].unk14;
  gfx.unk0.unkB = gUiGraphics[gfx.uiGfxID].unk18;
  sub_80528AC(&gfx);

  t2 = TaskCreate(CODE(Task_nullsub_805B980), sizeof(struct CharSelect_Chars), 0x2010U, 0U, NULL);
  chars = TASK_DATA(t2);
  chars->unkC0 = 0;
  chars->unkC4 = 0;
  chars->unkC6 = 0;
  chars->unkC8 = 0;
  select->taskC = t2;

  {
    struct Sprite *s = &chars->sprites[CIDX_MIDDLE];
    s->graphics.dest = (void *)(OBJ_VRAM0 + 0x2520);
    s->graphics.size = 0;
    s->frameFlags = 0;
    s->x = 280;
    s->y = 110;
    s->oamFlags = 0x7C0;
    s->qAnimDelay = 0;
    s->prevVariant = -1;
    s->animSpeed = 0x10;
    s->palId = 0;
    s->graphics.anim = ANIM_CHAR_SELECT_CHARACTERS;
    s->variant = 0;
  }

  {
    struct Sprite *s = &chars->sprites[CIDX_LEFT];
    s->graphics.dest = (void *)(OBJ_VRAM0 + 0x3920);
    s->graphics.size = 0;
    s->frameFlags = 0;
    s->x = -50;
    s->y = 110;
    s->oamFlags = 0x7C0;
    s->qAnimDelay = 0;
    s->prevVariant = -1;
    s->animSpeed = 0x10;
    s->palId = 0;
    s->graphics.anim = ANIM_CHAR_SELECT_CHARACTERS;
    s->variant = 6;
  }

  {
    struct Sprite *s = &chars->sprites[CIDX_RIGHT];
    s->graphics.dest = (void *)(OBJ_VRAM0 + 0x4D20);
    s->graphics.size = 0;
    s->frameFlags = 0;
    s->x = 290;
    s->y = 110;
    s->oamFlags = 0x7C0;
    s->qAnimDelay = 0;
    s->prevVariant = -1;
    s->animSpeed = 0x10;
    s->palId = 0;
    s->graphics.anim = ANIM_CHAR_SELECT_CHARACTERS;
    s->variant = 2;
  }

  {
    struct Sprite *s = &chars->sprites[CIDX_BLOCK];
    s->graphics.dest = (void *)(OBJ_VRAM0 + 0x6120);
    s->graphics.size = 0;
    s->frameFlags = 0;
    s->x = 290;
    s->y = 110;
    s->oamFlags = 0x700;
    s->qAnimDelay = 0;
    s->prevVariant = -1;
    s->animSpeed = 0x10;
    s->palId = 0;
    s->graphics.anim = ANIM_CHAR_SELECT_BLOCK;
    s->variant = 0;
    UpdateSpriteAnimation(s);
  }

  gBgSprites_Unknown1[1] = 0;
  gBgSprites_Unknown2[1][0] = 0;
  gBgSprites_Unknown2[1][1] = 0;
  gBgSprites_Unknown2[1][2] = -1;
  gBgSprites_Unknown2[1][3] = 0x20;
  m4aSongNumStartOrContinue(MUS_CHARACTER_SELECTION);
  sub_805423C(&select->strc0);
}

/** Task_8059F9C, 0x08059F68: steps the fade-in from white; once done, sets up the side darkening windows and starts
 *  the five child display tasks and the wheel input task. */
void Task_8059F9C(void) {
  struct CharSelect_3C *select = TASK_DATA(gCurTask);

  if (sub_805423C(&select->strc0)) {
    select->strc0.unk0 = 0;
    select->strc0.unk2 = 1;
    select->strc0.unk4 = 1;
    select->strc0.unk6 = 0;
    select->strc0.unk8 = 0x200;
    select->strc0.unkA = 1;
    gDispCnt |= 0x6000;

    gWinRegs[WINREG_WIN0H] = WIN_RANGE(0, 40);
    gWinRegs[WINREG_WIN0V] = WIN_RANGE(0, 240);
    gWinRegs[WINREG_WIN1H] = WIN_RANGE(DISPLAY_WIDTH - 40, DISPLAY_WIDTH);
    gWinRegs[WINREG_WIN1V] = WIN_RANGE(0, 240);
    gWinRegs[WINREG_WININ] = 0x3F3F;
    gWinRegs[WINREG_WINOUT] = 0x1F;
    gBldRegs.bldCnt = 0x1290;
    gBldRegs.bldAlpha = 0x10;
    gBldRegs.bldY = 8;

    select->taskC->main = CODE(Task_805B1E0);
    select->task10->main = CODE(Task_805B52C);
    select->task1C->main = CODE(Task_805B11C);
    select->task18->main = CODE(Task_805AF24);
    select->task14->main = CODE(Task_805ACD8);

    gCurTask->main = CODE(Task_805A060);
  }
}

/** Task_805A060, 0x0805A02C: main character wheel input and multiplayer heartbeat monitor. Handles Left/Right
 *  rotation, A to confirm, B to return in single player, wheel wraparound, and syncing state to the child tasks. */
void Task_805A060(void) {
  struct CharSelect_20 *frame;
  struct CharSelect_44 *banner;
  struct CharSelect_20 *name;
  struct CharSelect_34 *back;
  struct CharSelect_3C *select;
  struct CharSelect_Chars *chars;
  s16 target;
  u32 i;
  u8 *pUnk2F;

  select = TASK_DATA(gCurTask);
  name = TASK_DATA(select->task18);
  frame = TASK_DATA(select->task10);
  chars = TASK_DATA(select->taskC);
  banner = TASK_DATA(select->task14);
  back = TASK_DATA(select->task20);

  if (IS_MULTI_PLAYER) {
    for (i = 0; i < 4 && ((gMultiplayerConnections >> i) & 1); i++) {
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
      select->unk2F = 0;
      for (i = 0; i < 4; i++) {
        if (i != SIO_MULTI_ID) {
          if ((gMultiplayerConnections >> i) & 1) {
#ifdef MATCHING
            register struct MultiSioSlot *data asm("r2") = &((struct MultiSioSlot *)gMultiSioRecv)[i];
#else
            struct MultiSioSlot *data = &((struct MultiSioSlot *)gMultiSioRecv)[i];
#endif
            if (data->unk0 > 0x20U) {
              select->unk2F |= (1 << data->unk2);
            }
          }
        }
      }
    }
  }

  target = select->unk2B;
  CheckCPUPartnerUnlock();
  if ((B_BUTTON & gRepeatedKeys) && (select->unk24 > 0x21U) && (target == select->unk2A) && IS_SINGLE_PLAYER) {
    m4aSongNumStart(SE_RETURN);
    sub_805B858();
    pUnk2F = &select->unk2F;
  } else {
#ifdef MATCHING
    if (A_BUTTON & gRepeatedKeys) {
      pUnk2F = &select->unk2F;
    } else {
      pUnk2F = &select->unk2F;
    }
#else
    pUnk2F = &select->unk2F;
#endif
    if ((A_BUTTON & gRepeatedKeys) && (target == select->unk2A) && (select->unk24 > 0x21U) &&
        !((*pUnk2F >> (target & 3)) & 1)) {
      m4aSongNumStart(SE_SELECT);
      if (IS_SINGLE_PLAYER) {
        sub_805A9A4();
      } else {
        select->task1C->flags |= TASK_INACTIVE;
        gCurTask->main = CODE(Task_805A54C);
      }
    } else if ((DPAD_LEFT & gRepeatedKeys) && (select->unk24 > 0x21U)) {
      target--;
      if (select->unk2C == 0) {
        select->unk2C = 2;
        select->unk2E = 0x10;
        m4aSongNumStart(SE_SHIFT);
      }
    } else if ((DPAD_RIGHT & gRepeatedKeys) && (select->unk24 > 0x21U)) {
      target++;
      if (select->unk2C == 0) {
        select->unk2C = 1;
        select->unk2E = 0x10;
        m4aSongNumStart(SE_SHIFT);
      }
    } else {
      if (target > select->unk2A) {
        if (select->unk2C == 0) {
          select->unk2C = 1;
          select->unk2E = 0x10;
          m4aSongNumStart(SE_SHIFT);
        }
      } else if (target < select->unk2A) {
        if (select->unk2C == 0) {
          select->unk2C = 2;
          select->unk2E = 0x10;
          m4aSongNumStart(SE_SHIFT);
        }
      } else if (((*pUnk2F >> (target & 3)) & 1) && (select->unk24 > 0x21U)) {
        if (select->unk2D != 0) {
          if (select->unk2D & 1) target++;
          else target--;
        } else {
          select->unk2C = 1;
          select->unk2E = 0x10;
          m4aSongNumStart(SE_SHIFT);
        }
      }
    }
  }

  select->unk2D = select->unk2C;
  if (select->unk2C != 0) {
    if (select->unk2C & 1) {
      if (select->unk2E != 0) {
        select->unk28 += 0x10;
        if (--select->unk2E == 0) select->unk2C = 0;
      }
    } else {
      if (select->unk2E != 0) {
        select->unk28 -= 0x10;
        if (--select->unk2E == 0) select->unk2C = 0;
      }
    }
  }

  select->unk28 = (u16)(select->unk28 & 0x3FFF);
  select->unk2B = (s8)(target & 0x3F);
  if (select->unk2A <= select->unk2B) {
    select->unk2A = (u16)select->unk28 >> 8;
  } else {
    s32 high = ((s32)((u16)select->unk28) << 16) >> 24;
    select->unk2A = high;
    if (select->unk28 & 0xFF) select->unk2A = (s8)(high + 1);
  }
  select->unk2A &= 0x3F;

  if (select->unk2A > 0x24 && select->unk2B > 0x24 && select->unk28 > 0x2400) {
    while (select->unk2A > 0x24) select->unk2A -= 4;
    while (select->unk2B > 0x24) select->unk2B -= 4;
    while (select->unk28 > 0x2400) select->unk28 -= 0x400;
  } else if (select->unk2A < 0x1C && select->unk2B < 0x1C && select->unk28 < 0x1C00) {
    while (select->unk2A < 0x1C) select->unk2A += 4;
    while (select->unk2B < 0x1C) select->unk2B += 4;
    while (select->unk28 < 0x1C00) select->unk28 += 0x400;
  }

  name->unk1C = select->unk28 & 0x3FF;
  frame->unk1C = select->unk28 & 0x3FF;
  chars->unkC4 = select->unk28 & 0x3FF;
  chars->unkC6 = select->unk2C;
  back->unk32 = select->unk28 & 0x3FF;
  chars->unkC8 = *pUnk2F;
  banner->unk38 = ++select->unk24;
  if (IS_MULTI_PLAYER) {
    ((struct MultiSioSlot *)gMultiSioSend)->unk0 = 0x20;
    ((struct MultiSioSlot *)gMultiSioSend)->unk2 = (u8)((u32)(0x300 & name->unk1C) >> 8);
  }
}

/** sub_805A9A4, 0x0805A970: locks in the selected character, plays their victory pose, swaps the child tasks to their
 *  confirmed animations, removes the arrows and background sprite, loads the confirmed banner tiles, and switches to
 *  the exit countdown task. */
void sub_805A9A4(void) {
  struct Strc_80528AC gfx;
  struct CharSelect_3C *select = TASK_DATA(gCurTask);
  struct CharSelect_Chars *chars = TASK_DATA(select->taskC);
  struct CharSelect_44 *banner = TASK_DATA(select->task14);

  gSelectedCharacter = (s8)((u32)(0x300 & (u16)select->unk28) >> 8);
  chars->sprites[CIDX_MIDDLE].variant = (s8)(((u32)(0x300 & (u16)select->unk28) >> 7) + 1);
  select->task14->main = CODE(Task_805AE84);
  select->taskC->main = CODE(Task_805B8C0);
  select->task18->main = CODE(Task_805B880);
  select->task10->main = CODE(Task_805B930);
  TaskDestroy(select->task1C);
  TaskDestroy(select->task20);
  select->unk24 = 0;
  banner->unk40 = 0xB4;
  gBldRegs.bldY = 0;
  banner->unk40 = 0xB4;

  gfx.uiGfxID = 0x2C;
  gfx.unk2B = 4;
  gfx.tiles = gUiGraphics[gfx.uiGfxID].tiles;
  gfx.tilesSize = 0x200;
  gfx.vramC = (u8 *)OBJ_VRAM0 + 0x920;
  gfx.paletteSize = 0x20;
  gfx.unk28 = 0;
  gfx.unk2A = 9;
  gfx.unk0.unk4 = gUiGraphics[gfx.uiGfxID].unk8;
  gfx.unk0.unk8 = gUiGraphics[gfx.uiGfxID].unkC;
  gfx.unk0.unk9 = gUiGraphics[gfx.uiGfxID].unk10;
  gfx.unk0.unkA = gUiGraphics[gfx.uiGfxID].unk14;
  gfx.unk0.unkB = gUiGraphics[gfx.uiGfxID].unk18;
  sub_80528AC(&gfx);

  gCurTask->main = CODE(Task_805AAF8);
}

/** Task_805AAF8, 0x0805AAC4: counts through the confirmed pose and fade to white, then tears down the screen and
 *  launches the stage, course select, or multiplayer setup. */
void Task_805AAF8(void) {
  u8 fadeStart[4];
  struct CharSelect_3C *select;
  struct Task *nameTask;

  memcpy(fadeStart, gUnknown_08681478, sizeof(fadeStart));
  select = TASK_DATA(gCurTask);
  nameTask = select->task18;

  if (++select->unk24 > 0x38U) {
    u8 unlockState = select->unk39;

    TaskDestroy(nameTask);
    TaskDestroy(select->task10);
    TaskDestroy(select->taskC);
    TaskDestroy(select->task14);
    TaskDestroy(gCurTask);

    gDispCnt &= 0xFFF;
    gBldRegs.bldCnt = 0;
    gBldRegs.bldY = 0;

    if (IS_MULTI_PLAYER) {
      sub_801C9D8();
    } else {
      if (gGameMode == GAME_MODE_SINGLE_PLAYER) {
        if (unlockState == 8) {
          m4aSongNumStart(SE_RING_COPY);
          gTailsEnabled = 1;
        }
        if ((gGameMode == GAME_MODE_SINGLE_PLAYER) && (gLoadedSaveGame.unlockedLevels[gSelectedCharacter] == 0)) {
          gCurrentLevel = 0;
          gMultiplayerCurrentLevel = 0;
          ApplyGameStageSettingsAndStart();
          return;
        }
      }
      CreateCourseSelect(0);
    }
  } else if (select->unk24 > fadeStart[gSelectedCharacter]) {
    sub_805423C(&select->strc0);
  }
}

/** Task_805AC00, 0x0805ABCC: fades out when B cancels the character select, destroying all child tasks halfway
 *  through and returning to the main menu or time attack menu. */
void Task_805AC00(void) {
  struct CharSelect_3C *select = TASK_DATA(gCurTask);

  select->unk24 += 1;
  select->strc0.unk8 = 0x180;
  select->strc0.unkA = 0x10;

  if (sub_805423C(&select->strc0)) {
    m4aSongNumStop(MUS_CHARACTER_SELECTION);
    gDispCnt &= 0xFFF;
    gBldRegs.bldCnt = 0;
    gBldRegs.bldY = 0;
    TaskDestroy(gCurTask);

    if (gGameMode == GAME_MODE_TIME_ATTACK) {
      CreateTimeAttackMenu();
    } else {
      CreateMainMenu(1U);
    }
    return;
  } else if (select->unk24 == 0x10) {
    TaskDestroy(select->task18);
    TaskDestroy(select->task10);
    TaskDestroy(select->taskC);
    TaskDestroy(select->task14);
    TaskDestroy(select->task1C);
    TaskDestroy(select->task20);

    gBgSprites_Unknown1[0] = 0;
    gBgSprites_Unknown2[0][0] = 0;
    gBgSprites_Unknown2[0][1] = 0;
    gBgSprites_Unknown2[0][2] = -1;
    gBgSprites_Unknown2[0][3] = 0x14;

    gBgSprites_Unknown1[1] = 0;
    gBgSprites_Unknown2[1][0] = 0;
    gBgSprites_Unknown2[1][1] = 0;
    gBgSprites_Unknown2[1][2] = -1;
    gBgSprites_Unknown2[1][3] = 0x14;

    gBgSprites_Unknown1[2] = 0;
    gBgSprites_Unknown2[2][0] = 0;
    gBgSprites_Unknown2[2][1] = 0;
    gBgSprites_Unknown2[2][2] = -1;
    gBgSprites_Unknown2[2][3] = 0x14;
  }
}

/** Task_805ACD8, 0x0805ACA4: animates the top banner bar sliding in and rising into place while scrolling its text. */
void Task_805ACD8(void) {
  char strip[25];
  struct CharSelect_44 *banner;
  s16 step;
  s16 phase;

  memcpy(strip, gUnknown_0868147C, sizeof(strip));
  banner = TASK_DATA(gCurTask);

  step = banner->unk38;
  if (step > 0x20) {
    banner->overB.unkC = 6;
    banner->unk38 = 0;
    banner->unk3C = banner->unk3C - 0xB4;
    gCurTask->main = CODE(sub_805ADF0);
  } else if (step > 0xC) {
    phase = step - 0xD;
    banner->overB.unkC = (u16)(0x38 - ((s32)((u16)gSineTable[phase * (Div(phase, 10) + 0x11)] << 16) >> 24));
    banner->unk3C = banner->unk3C - 0xB4;
  } else if (step > 9) {
    banner->overB.qUnkA = 0;
    banner->unk3C = banner->unk3C - 0xB4;
  } else {
    banner->overB.qUnkA = 0x100 - Div(step << 8, 10);
    banner->unk3C = banner->unk3C - 0x640;
  }

  sub_8052F78(gUnknown_08681498, &banner->overB);
  if (banner->unk3C > 0) {
    banner->overB2.unkE = (u16)(9 - Div(banner->unk3C >> 6, 32));
  } else {
    banner->overB2.unkE = 9;
  }
  if (banner->unk3C > 0x3C00) {
    banner->overB2.unkE = 0;
  }

  if (banner->unk3C < -1984) {
    banner->unk3C = banner->unk3C + 0x800;
    banner->unk30 = (banner->unk30 + 1) & 7;
  }
  banner->overB2.qUnkA = banner->unk3C >> 6;
  banner->overB2.unkC = banner->overB.unkC;
  sub_8052F78(&strip[banner->unk30], &banner->overB2);
}

/** sub_805ADF0, 0x0805ADBC: continuously scrolls the top banner text at a steady speed during selection. */
void sub_805ADF0(void) {
  char strip[25];
  struct CharSelect_44 *banner;

  memcpy(strip, gUnknown_0868147C, sizeof(strip));
  banner = TASK_DATA(gCurTask);
  banner->overB.qUnkA = 0;

  sub_8052F78(gUnknown_08681498, &banner->overB);

  banner->unk34++;
  banner->overB2.unkC = 6;
  banner->unk3C -= 0xB4;

  if (banner->unk3C > 0) {
    banner->overB2.unkE = (u16)(9 - Div(banner->unk3C >> 6, 32));
  } else {
    banner->overB2.unkE = 9;
  }

  if (banner->unk3C < -1984) {
    banner->unk3C = banner->unk3C + 0x800;
    banner->unk30 = (banner->unk30 + 1) & 7;
  }
  banner->overB2.qUnkA = banner->unk3C >> 6;
  sub_8052F78(&strip[banner->unk30], &banner->overB2);
}

/** Task_805AE84, 0x0805AE50: decelerates the top banner text to a stop after a character is confirmed. */
void Task_805AE84(void) {
  u8 strip[25];
  struct CharSelect_44 *banner;
  s32 i;

  memcpy(strip, gUnknown_086814A4, sizeof(strip));
  banner = TASK_DATA(gCurTask);

  banner->unk34++;
  banner->overB.qUnkA = 0;
  sub_805321C((const u8 *)gUnknown_08681498, &banner->overB);
  banner->overB2.unkC = 6;
  banner->unk3C -= banner->unk40;

  for (i = 0; i < 3; i++) {
    if (banner->unk40 != 0) banner->unk40--;
  }

  if (banner->unk3C < -1984) {
    banner->unk3C += 0x800;
    banner->unk30 = (banner->unk30 + 1) & 7;
  }
  banner->overB2.qUnkA = banner->unk3C >> 6;
  sub_805321C(&strip[banner->unk30], &banner->overB2);
}

/** Task_805AF24, 0x0805AEF0: slides the character's name in from the right and drops it into its lower position. */
void Task_805AF24(void) {
  struct CharSelect_20 *name = TASK_DATA(gCurTask);
  s16 step = ++name->unk18;

  if (step > 0x21) {
    name->overB.unkC = 0x84;
    name->unk18 = 0;
    gCurTask->main = CODE(sub_805AFC4);
  } else if (step > 13) {
    name->overB.unkC = (gSineTable[(Div(step * 103, 110) - 10) * 17] >> 8) + 0x54;
  } else if (step > 0xA) {
    name->overB.qUnkA = gUnknown_0868146C[0];
  } else {
    name->overB.qUnkA = 0x100 - Div(step << 8, 10);
    name->overB.qUnkA += gUnknown_0868146C[0];
  }
  sub_8052F78(gUnknown_086814C0, &name->overB);
}

/** sub_805AFC4, 0x0805AF90: updates the character name strip while the wheel spins, shaking it horizontally and
 *  swapping its tiles halfway between characters. */
void sub_805AFC4(void) {
  struct Strc_80528AC gfx;
  u16 shake[16];
  struct CharSelect_20 *name;
  s16 frac;
  s16 dist;
  u32 charIdx;

  memcpy(shake, gUnknown_086814CA, sizeof(shake));
  name = TASK_DATA(gCurTask);

  frac = name->unk1C % 256U;
  if (frac != 0) {
    u32 masked = 0x300;
    s16 dist0;
    masked &= name->unk1C;
    charIdx = masked >> 8;

    if (frac - 0x7F < 0) dist0 = (0x7F - frac) >> 1;
    else dist0 = (frac - 0x7F) >> 1;
    dist = dist0;

    if (name->unk1E == 0) {
      charIdx = (u32)(0x300 & name->unk1C) >> 8;
      if ((s16)(0xFF & name->unk1C) > 128) charIdx += 1;
      charIdx &= 3;

      UiGfxStackInit();

      gfx.uiGfxID = 0x29;
      gfx.unk2B = 2;
      gfx.tiles = gUiGraphics[gfx.uiGfxID].tiles + (charIdx * 0xC00);
      gfx.tilesSize = 0xC00;
      gfx.vramC = (u8 *)OBJ_VRAM0 + 0x1120;
      gfx.unk2A = 9;
      gfx.unk0.unk4 = gUiGraphics[gfx.uiGfxID].unk8;
      gfx.unk0.unk8 = gUiGraphics[gfx.uiGfxID].unkC;
      gfx.unk0.unk9 = gUiGraphics[gfx.uiGfxID].unk10;
      gfx.unk0.unkA = gUiGraphics[gfx.uiGfxID].unk14;
      gfx.unk0.unkB = gUiGraphics[gfx.uiGfxID].unk18;
      sub_80528AC(&gfx);
    }
    name->unk1E = dist;
    name->overB.qUnkA = gUnknown_0868146C[charIdx] + shake[(name->unk1C % 256U) >> 4];
  } else {
    const u16 *xTable = gUnknown_0868146C;
    s32 masked = 0x300;
    masked &= name->unk1C;
    name->overB.qUnkA = xTable[masked >> 8];
  }
  sub_8052F78(gUnknown_086814C0, &name->overB);
}

/** Task_805B11C, 0x0805B0E8: slides the left and right arrows in from the screen edges, then bounces them periodically. */
void Task_805B11C(void) {
  u8 offsets[14];
  struct CharSelect_20 *arrows;
  s32 prev;
  s32 next;
  s16 step;
  s16 phase;

  memcpy(offsets, gUnknown_086814EA, sizeof(offsets));
  arrows = TASK_DATA(gCurTask);
  prev = arrows->unk18;
  next = prev + 1;
  arrows->unk18 = next;
  step = (s16)next;

  if (step > 0x26) {
    s32 idx;
    u8 *rightOffsets;

    if (step > 0x62) arrows->unk18 = prev - 0x3B;
    phase = (s16)Mod(step, 0x3C);
    arrows->overB.qUnkA = offsets[Div(phase, 10)];
    sub_8052F78(gUnknown_086814F8, &arrows->overB);
    idx = Div(phase, 10);
    rightOffsets = &offsets[7];
    arrows->overB.qUnkA = rightOffsets[idx];
    sub_8052F78(gUnknown_086814FC, &arrows->overB);
    return;
  }

  if ((u32)next > 30) {
    arrows->overB.qUnkA = (s16)(((prev - 0x1D) * 6) - 0x24);
    sub_8052F78(gUnknown_086814F8, &arrows->overB);
    arrows->overB.qUnkA = (s16)(0xF0 - ((arrows->unk18 - 0x1E) * 6));
    sub_8052F78(gUnknown_086814FC, &arrows->overB);
  }
}

/** Task_805B1E0, 0x0805B1AC: slides the three character portraits into place, opens the right darkening window, and
 *  hands off to the steady wheel-drawing task. */
void Task_805B1E0(void) {
  struct CharSelect_Chars *chars = TASK_DATA(gCurTask);
  u32 selected = (u32)(0x300 & (u16)chars->unkC4) >> 8;
  u32 prevCount = chars->unkC0;
  u32 nextCount = prevCount + 1;
  u32 mask;

  chars->unkC0 = nextCount;
  if (nextCount > 0x11U) {
    s32 step = prevCount - 0x10;
    chars->sprites[CIDX_MIDDLE].x = 256 - Div(step << 7, 11);
    chars->sprites[CIDX_RIGHT].x = 284 - Div(step << 5, 11);
    chars->sprites[CIDX_LEFT].x = Div(step << 5, 11) - 32;
    chars->sprites[CIDX_MIDDLE].y = 110;
    if (step <= 4) {
      gWinRegs[WINREG_WIN1H] = WIN_RANGE(DISPLAY_WIDTH, DISPLAY_WIDTH);
    } else {
      gWinRegs[WINREG_WIN1H] = (((DISPLAY_WIDTH - ((prevCount - 0x15) * 5)) << 8) + DISPLAY_WIDTH);
    }
  }

  if (chars->unkC0 > 28) {
    chars->unkC0 = 0;
    gWinRegs[WINREG_WIN1H] = WIN_RANGE(DISPLAY_WIDTH - 40, DISPLAY_WIDTH);
    gCurTask->main = CODE(sub_805B324);
  }

  mask = 3;
  chars->sprites[CIDX_MIDDLE].variant = selected * 2;
  chars->sprites[CIDX_RIGHT].variant = ((selected + 1) & mask) * 2;
  chars->sprites[CIDX_LEFT].variant = ((selected + 3) & mask) * 2;
  UpdateSpriteAnimation(&chars->sprites[CIDX_LEFT]);
  DisplaySprite(&chars->sprites[CIDX_LEFT]);
  UpdateSpriteAnimation(&chars->sprites[CIDX_MIDDLE]);
  DisplaySprite(&chars->sprites[CIDX_MIDDLE]);
  UpdateSpriteAnimation(&chars->sprites[CIDX_RIGHT]);
  DisplaySprite(&chars->sprites[CIDX_RIGHT]);
}

/** sub_805B324, 0x0805B2F0: positions and draws the three character portraits (and multiplayer block overlays) as the
 *  wheel rests or turns left and right. */
void sub_805B324(void) {
  u8 variants[2][3];
  struct CharSelect_Chars *chars;
  s16 step;
  u32 selected;
  s32 dirIdx;
  s32 dir;
  s32 blockOff;

  memcpy(variants, gUnknown_086814FE, sizeof(variants));
  chars = TASK_DATA(gCurTask);
  step = ((u8)chars->unkC4 % 256U) >> 4;
  selected = (u32)(0x300 & (u16)chars->unkC4) >> 8;

  if (chars->unkC6 == 0) {
    chars->sprites[CIDX_LEFT].x = -8;
    chars->sprites[CIDX_MIDDLE].x = 120;
    chars->sprites[CIDX_RIGHT].x = 248;
    dir = 0;
  } else {
    if (chars->unkC6 & 1) {
      dirIdx = 1;
      dir = -1;
    } else {
      dirIdx = 0;
      dir = 1;
      step = 0x10 - step;
    }

    if (step == 4) {
      s32 jump = dir * 128;
      chars->sprites[CIDX_MIDDLE].variant = ((variants[dirIdx][0] + selected) & 3) * 2;
      chars->sprites[CIDX_RIGHT].variant = ((variants[dirIdx][1] + selected) & 3) * 2;
      chars->sprites[CIDX_LEFT].variant = ((variants[dirIdx][2] + selected) & 3) * 2;
      chars->sprites[CIDX_LEFT].x -= jump;
      chars->sprites[CIDX_MIDDLE].x -= jump;
      chars->sprites[CIDX_RIGHT].x -= jump;
    }
    if (step <= 8) {
      s32 delta = dir * 16;
      chars->sprites[CIDX_LEFT].x += delta;
      chars->sprites[CIDX_MIDDLE].x += delta;
      chars->sprites[CIDX_RIGHT].x += delta;
    }
  }

  if (dir == 1) {
    if (step <= 3) blockOff = 1;
    else blockOff = 0;
  } else if (dir == -1 && step > 3) {
    blockOff = 1;
  } else {
    blockOff = 0;
  }

  if ((chars->unkC8 >> (((blockOff - 1) + selected) & 3)) & 1) {
    chars->sprites[CIDX_BLOCK].x = chars->sprites[CIDX_LEFT].x;
    chars->sprites[CIDX_BLOCK].y = chars->sprites[CIDX_LEFT].y;
    DisplaySprite(&chars->sprites[CIDX_BLOCK]);
  }
  UpdateSpriteAnimation(&chars->sprites[CIDX_LEFT]);
  DisplaySprite(&chars->sprites[CIDX_LEFT]);

  if ((chars->unkC8 >> ((selected + blockOff) & 3)) & 1) {
    chars->sprites[CIDX_BLOCK].x = chars->sprites[CIDX_MIDDLE].x;
    chars->sprites[CIDX_BLOCK].y = chars->sprites[CIDX_MIDDLE].y;
    DisplaySprite(&chars->sprites[CIDX_BLOCK]);
  }
  UpdateSpriteAnimation(&chars->sprites[CIDX_MIDDLE]);
  DisplaySprite(&chars->sprites[CIDX_MIDDLE]);

  if ((chars->unkC8 >> ((blockOff + 1 + selected) & 3)) & 1) {
    chars->sprites[CIDX_BLOCK].x = chars->sprites[CIDX_RIGHT].x;
    chars->sprites[CIDX_BLOCK].y = chars->sprites[CIDX_RIGHT].y;
    DisplaySprite(&chars->sprites[CIDX_BLOCK]);
  }
  UpdateSpriteAnimation(&chars->sprites[CIDX_RIGHT]);
  DisplaySprite(&chars->sprites[CIDX_RIGHT]);
}

/** Task_805B52C, 0x0805B4F8: slides the two-row colour bar in, loads the starting character's bar palette on frame 1,
 *  and hands off to the steady colour bar task. */
void Task_805B52C(void) {
  u8 rows[2][8];
  struct CharSelect_20 *bar;
  struct Strc_80528AC gfx;
  s16 step;

  memcpy(rows, gUnknown_08681504, sizeof(rows));
  bar = TASK_DATA(gCurTask);
  step = ++bar->unk18;

  if (step > 0x21) {
    bar->unk18 = 0;
    bar->overB.unkC = 0x70;
    gCurTask->main = CODE(sub_805B694);
  } else if (step > 0xD) {
    bar->overB.unkC = (gSineTable[(Div(step * 0x67, 0x6E) - 0xA) * 0x11] >> 8) + 0x40;
  } else if (step > 0xA) {
    bar->overB.qUnkA = 0;
  } else {
    bar->overB.qUnkA = (u16)(0x100 - Div(step << 8, 0xA));
    if (step == 1) {
      u16 charIdx = bar->unk1C & 0x300;
      charIdx >>= 8;
      gfx.uiGfxID = 0x27;
      gfx.unk2B = 0;
      gfx.palette = gUiGraphics[gfx.uiGfxID].palette + (charIdx * 3);
      gfx.vramC = (u8 *)OBJ_VRAM0 + 0x20;
      gfx.paletteSize = 8;
      gfx.unk28 = 0xF;
      gfx.unk2A = 0xC;
      gfx.unk0.unk4 = gUiGraphics[gfx.uiGfxID].unk8;
      gfx.unk0.unk8 = gUiGraphics[gfx.uiGfxID].unkC;
      gfx.unk0.unk9 = gUiGraphics[gfx.uiGfxID].unk10;
      gfx.unk0.unkA = gUiGraphics[gfx.uiGfxID].unk14;
      gfx.unk0.unkB = gUiGraphics[gfx.uiGfxID].unk18;
      sub_80528AC(&gfx);
    }
  }

  sub_8052F78((const char *)rows[0], &bar->overB);
  bar->overB.unkC += 0x20;
  sub_8052F78((const char *)rows[1], &bar->overB);
  bar->overB.unkC -= 0x20;
}

/** sub_805B694, 0x0805B660: dips the two-row colour bar during wheel rotation and updates its palette at the midpoint. */
void sub_805B694(void) {
  struct Strc_80528AC gfx;
  u8 rows[2][8];
  struct CharSelect_20 *bar;
  u8 frac;

  memcpy(rows, gUnknown_08681504, sizeof(rows));
  bar = TASK_DATA(gCurTask);
  bar->overB.qUnkA = 0;
  frac = bar->unk1C;

  if (frac != 0) {
    s16 dist0;
    s32 dist;
#ifdef MATCHING
    register s32 baseY asm("r0");
    register s32 signedDist asm("r1");
#else
    s32 baseY;
    s32 signedDist;
#endif

    if (frac - 0x7F < 0) dist0 = (0x7F - frac) >> 1;
    else dist0 = (frac - 0x7F) >> 1;
    dist = (u16)dist0;
    baseY = 168;
    signedDist = (s32)((u32)dist << 16) >> 16;
    bar->overB.unkC = baseY - signedDist;

    if (bar->unk1E == 0) {
      u32 charIdx = (u32)(0x300 & bar->unk1C) >> 8;
      if ((s16)(0xFF & bar->unk1C) > 0x80) charIdx += 1;
      charIdx &= 3;

      gfx.uiGfxID = 0x27;
      gfx.unk2B = 0;
      gfx.palette = gUiGraphics[gfx.uiGfxID].palette + (charIdx * 3);
      gfx.vramC = (u8 *)OBJ_VRAM0 + 0x20;
      gfx.paletteSize = 8;
      gfx.unk28 = 0xF;
      gfx.unk2A = 0xC;
      gfx.unk0.unk4 = gUiGraphics[gfx.uiGfxID].unk8;
      gfx.unk0.unk8 = gUiGraphics[gfx.uiGfxID].unkC;
      gfx.unk0.unk9 = gUiGraphics[gfx.uiGfxID].unk10;
      gfx.unk0.unkA = gUiGraphics[gfx.uiGfxID].unk14;
      gfx.unk0.unkB = gUiGraphics[gfx.uiGfxID].unk18;
      sub_80528AC(&gfx);
    }
    bar->unk1E = (u16)dist;
  } else {
    bar->overB.unkC = 0x70;
  }

  if (bar->overB.unkC < 0x70) bar->overB.unkC = 0x70;

  sub_8052F78((const char *)rows[0], &bar->overB);
  bar->overB.unkC += 0x20;
  sub_8052F78((const char *)rows[1], &bar->overB);
  bar->overB.unkC -= 0x20;
}

/** CheckCPUPartnerUnlock, 0x0805B7B0: advances or resets the secret button sequence that enables CPU Tails alongside Sonic. */
void CheckCPUPartnerUnlock(void) {
  struct CharSelect_3C *select = TASK_DATA(gCurTask);
  s32 charIdx = (0x300 & select->unk28) >> 8;

  if (gPressedKeys != 0) {
    if ((DPAD_UP & gPressedKeys) && (charIdx == 0)) {
      select->unk39 = 0;
      return;
    } else if (select->unk39 != 0xFF) {
      if (gPressedKeys & gUnknown_08681514[select->unk39]) select->unk39++;
      else select->unk39 = 0xFF;
    }
  }
}

/** sub_805B858, 0x0805B824: begins fading out of the character select after B is pressed. */
void sub_805B858(void) {
  struct CharSelect_3C *select = TASK_DATA(gCurTask);

  select->unk24 = 0;
  gBldRegs.bldY = 0;
  gCurTask->main = CODE(Task_805AC00);
}

/** Task_805B880, 0x0805B84C: draws the confirmed character's name as opaque sprites. */
void Task_805B880(void) {
  struct CharSelect_20 *name = TASK_DATA(gCurTask);

  name->unk18++;
  sub_805321C((const u8 *)gUnknown_086814C0, &name->overB);
  name->overB.qUnkA = gUnknown_0868146C[(name->unk1C & 0x300) >> 8];
}

/** Task_805B8C0, 0x0805B88C: slides the unselected side portraits off screen while playing the chosen character's pose. */
void Task_805B8C0(void) {
  struct CharSelect_Chars *chars = TASK_DATA(gCurTask);

  if (chars->unkC0 < 5) {
    chars->sprites[CIDX_LEFT].x -= 0x14;
    chars->sprites[CIDX_RIGHT].x += 0x14;
  }
  chars->unkC0++;

  UpdateSpriteAnimation(&chars->sprites[CIDX_LEFT]);
  DisplaySprite(&chars->sprites[CIDX_LEFT]);
  UpdateSpriteAnimation(&chars->sprites[CIDX_MIDDLE]);
  DisplaySprite(&chars->sprites[CIDX_MIDDLE]);
  UpdateSpriteAnimation(&chars->sprites[CIDX_RIGHT]);
  DisplaySprite(&chars->sprites[CIDX_RIGHT]);
}

/** Task_805B930, 0x0805B8FC: draws the confirmed two-row colour bar as opaque sprites. */
void Task_805B930(void) {
  u8 rows[2][8];
  struct CharSelect_20 *bar;

  memcpy(rows, gUnknown_08681504, sizeof(rows));
  bar = TASK_DATA(gCurTask);

  bar->unk18++;
  bar->overB.qUnkA = 0;

  sub_805321C(rows[0], &bar->overB);
  bar->overB.unkC += 0x20;
  sub_805321C(rows[1], &bar->overB);
  bar->overB.unkC -= 0x20;
}

/** Task_nullsub_805B980, 0x0805B94C: placeholder task while the screen fades in. */
void Task_nullsub_805B980(void) {}

/** Task_805B984, 0x0805B950: updates and draws the background animation sprite according to wheel rotation. */
void Task_805B984(void) {
  u8 variants[4];
  struct CharSelect_34 *back;
  struct Sprite *s;
  u32 index;

  memcpy(variants, gUnknown_08681474, sizeof(variants));
  back = TASK_DATA(gCurTask);
  s = &back->s;

  index = (back->unk32 & 0xFF) >> 6;
  s->prevVariant = -1;
  s->graphics.anim = ANIM_CHAR_SELECT_BACKGROUND;
  s->variant = variants[index];
  UpdateSpriteAnimation_BG(s);
  DisplaySprite_BG(s);
}
