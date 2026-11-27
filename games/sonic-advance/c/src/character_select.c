// The character select: its screen and its tasks, made when the main menu's first line is chosen.
#include "console.h"
#include "core.h"
#include "sprite.h"
#include "stage.h"
#include "task.h"
#include "ui.h"

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
/** Where a background's block of tiles is in video memory, as its control register says. */
#define BG_TILES(bg) (VRAM + ((gBgCntRegs[bg] & 0xC) << 12))

/** One of the menus' pictures, as the game keeps the game over screen's too: where it is and which it is. */
struct GameOverB {
  /* 0x00 */ u8 filler0[8];
  /* 0x08 */ u16 unk8;
  /* 0x0A */ s16 qUnkA;
  /* 0x0C */ s16 unkC;
  /* 0x0E */ s16 unkE;
  /* 0x10 */ u16 unk10;
  /* 0x12 */ u16 unk12;
  /* 0x14 */ u16 unk14;
  /* 0x16 */ u8 unk16;
};

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

void m4aSongNumStartOrContinue(u16 n);
s32 UpdateSpriteAnimation_BG(struct Sprite *s);
void DisplaySprite_BG(struct Sprite *s);
/** The character select's own frames, by their addresses: making the screen only names them. */
void Task_8059F9C(void);
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
