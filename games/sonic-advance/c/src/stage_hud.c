// The stage's HUD: its task and its pictures, in C.
#include "stage_init.h"
#include "ui.h"

struct StageUiGraphic {
  /* 0x00 */ const u8 *tiles;
  /* 0x04 */ const u16 *palette;
  /* 0x08 */ s32 unk8;
  /* 0x0C */ u32 unkC;
  /* 0x10 */ u32 unk10;
  /* 0x14 */ u32 unk14;
  /* 0x18 */ u32 unk18;
};

extern struct StageUiGraphic gUiGraphics[];

/** The HUD's digits, as its task draws them: the colons of the time among them. */
struct StageHudDigits {
  /* 0x00 */ u8 unk0;
  /* 0x01 */ u8 unk1;
  /* 0x02 */ u8 unk2;
  /* 0x03 */ u8 unk3;
  /* 0x04 */ u8 unk4;
  /* 0x05 */ u8 filler5[3];
};

/** The HUD's task's own memory. */
struct StageHud {
  /* 0x00 */ u8 filler0[0x20];
  /* 0x20 */ struct StageHudDigits digits;
  /* 0x28 */ u8 filler28[0x18];
  /* 0x40 */ u16 unk40;
  /* 0x42 */ u8 filler42[0x0E];
};

void Task_StageHudMain(void);
void CreateStageHud(void);
void LoadStageHudGfx(void);

/** CreateStageHud, 0x08054170: the HUD's task, with the time's two colons, then its pictures. */
void CreateStageHud(void) {
  struct Task *t = NULL;
  struct StageHud *hud;
  struct StageHudDigits *digits = NULL;

  t = TaskCreate(CODE(Task_StageHudMain), sizeof(struct StageHud), 0x2180, 0, NULL);
  hud = TASK_DATA(t);
  hud->unk40 = 0;
  hud = TASK_DATA(t);
  digits = &hud->digits;
  digits->unk1 = 42;
  digits->unk4 = 42;

  UiGfxStackInit();
  LoadStageHudGfx();
}

/** LoadStageHudGfx, 0x08053888: the HUD's pictures go to video memory: two of the rings' and time's digits, the life
 *  counter of the character played, and the rings' picture. */
void LoadStageHudGfx(void) {
  struct Strc_80528AC gfx;

  gfx.uiGfxID = 0;
  gfx.unk2B = 0;
  gfx.tiles = gUiGraphics[0].tiles + 0x1C00;
  gfx.palette = gUiGraphics[0].palette;
  gfx.vramC = (u8 *)0x06010D40;
  gfx.tilesSize = 0x2C0;
  gfx.paletteSize = 32;
  gfx.unk28 = 6;
  gfx.unk2A = 13;
  gfx.unk0.unk4 = gUiGraphics[0].unk8;
  gfx.unk0.unk8 = gUiGraphics[0].unkC;
  gfx.unk0.unk9 = gUiGraphics[0].unk10;
  gfx.unk0.unkA = gUiGraphics[0].unk14;
  gfx.unk0.unkB = gUiGraphics[0].unk18;
  sub_80528AC(&gfx);

  gfx.uiGfxID = 0;
  gfx.unk2B = 0;
  gfx.tiles = gUiGraphics[0].tiles + 0x400;
  gfx.palette = gUiGraphics[0].palette;
  gfx.vramC = (u8 *)0x06010A80;
  gfx.tilesSize = 0x2C0;
  gfx.paletteSize = 32;
  gfx.unk28 = 6;
  gfx.unk2A = 9;
  gfx.unk0.unk4 = gUiGraphics[0].unk8;
  gfx.unk0.unk8 = gUiGraphics[0].unkC;
  gfx.unk0.unk9 = gUiGraphics[0].unk10;
  gfx.unk0.unkA = gUiGraphics[0].unk14;
  gfx.unk0.unkB = gUiGraphics[0].unk18;
  sub_80528AC(&gfx);

  gfx.uiGfxID = gSelectedCharacter + 1;
  gfx.unk2B = 1;
  gfx.tiles = gUiGraphics[gfx.uiGfxID].tiles;
  gfx.palette = gUiGraphics[gfx.uiGfxID].palette;
  gfx.tilesSize = 128;
  gfx.paletteSize = 32;
  gfx.unk28 = gSelectedCharacter;
  gfx.vramC = (u8 *)0x06010800;
  gfx.unk2A = 9;
  gfx.unk0.unk4 = gUiGraphics[gfx.uiGfxID].unk8;
  gfx.unk0.unk8 = gUiGraphics[gfx.uiGfxID].unkC;
  gfx.unk0.unk9 = gUiGraphics[gfx.uiGfxID].unk10;
  gfx.unk0.unkA = gUiGraphics[gfx.uiGfxID].unk14;
  gfx.unk0.unkB = gUiGraphics[gfx.uiGfxID].unk18;
  sub_80528AC(&gfx);

  gfx.uiGfxID = 5;
  gfx.unk2B = 3;
  gfx.tiles = gUiGraphics[5].tiles;
  gfx.palette = gUiGraphics[5].palette;
  gfx.tilesSize = 0x200;
  gfx.paletteSize = 32;
  gfx.unk28 = 6;
  gfx.vramC = (u8 *)0x06010880;
  gfx.unk2A = 9;
  gfx.unk0.unk4 = gUiGraphics[5].unk8;
  gfx.unk0.unk8 = gUiGraphics[5].unkC;
  gfx.unk0.unk9 = gUiGraphics[5].unk10;
  gfx.unk0.unkA = gUiGraphics[5].unk14;
  gfx.unk0.unkB = gUiGraphics[5].unk18;
  sub_80528AC(&gfx);
}
