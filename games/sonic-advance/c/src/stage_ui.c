// Stage intro title card creation, graphics loading, animation tasks, and transition into gameplay in C.
#include "stage_init.h"
#include "ui.h"
#include "ui_draw.h"

#ifdef MATCHING
void *memcpy(void *, const void *, unsigned int);
void *memset(void *, int, unsigned int);
#else
void *memcpy(void *dest, const void *src, unsigned long n);
void *memset(void *dest, int c, unsigned long n);
#endif

int Div(int num, int denom);
int Mod(int num, int denom);
struct OamData *OamMalloc(u8 order);
extern struct OamData *iwram_end;

void UiDrawTextFade(const char *text, struct GameOverB *box);
void TaskDestructor_StageIntroPart(struct Task *t);
void TaskDestructor_StageIntroMain(struct Task *t);
void StageSetupMultiplayerRings(void);
void StageWaterPaletteInit(void);
void StageWaterPaletteUpdate(void);
void CreateStageHud(void);
void StageMoonZoneIntro(s32 x, s32 y);

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
extern const u8 gUnknown_08681274[];
extern const u8 gUnknown_08681282[];
extern const char gUnknown_08681290[];
extern const u8 gUnknown_08681294[];
extern const char gUnknown_086812A8[];
extern const char gUnknown_086812AC[];
extern const char gUnknown_086812B4[];
extern const char gUnknown_086812C0[];
extern const char gUnknown_086812C8[];

struct StageIntroPart {
  /* 0x00 */ struct GameOverB box;
  /* 0x18 */ u16 timer;
  /* 0x1A */ u16 unk1A;
  /* 0x1C */ void *vram;
  /* 0x20 */ u8 unk20;
  /* 0x21 */ u8 unk21;
};

struct StageIntroMain {
  /* 0x00 */ struct StrcUi_805423C fade;
  /* 0x0C */ struct Task *tasks[6];
  /* 0x24 */ u16 timer;
  /* 0x26 */ u8 unk26;
  /* 0x27 */ u8 unk27;
};

struct StageMultiPlayerData {
  /* 0x00 */ u8 filler0[0x5C];
  /* 0x5C */ u32 flags;
};

/** LoadStageIntroGfx, 0x08054A4C: loads title-card sprite tiles and palettes into the UI graphics stack. */
void LoadStageIntroGfx(void **vramPtrs) {
  struct Strc_80528AC gfx;
  u32 act = gCurrentLevel & 1;

  gfx.uiGfxID = gSelectedCharacter + 6;
  gfx.unk2B = 6;
  gfx.tiles = gUiGraphics[gfx.uiGfxID].tiles;
  gfx.palette = gUiGraphics[gfx.uiGfxID].palette;
  gfx.tilesSize = 0x400;
  gfx.paletteSize = 32;
  gfx.unk28 = 15;
  gfx.vramC = vramPtrs[1];
  gfx.unk2A = 13;
  gfx.unk0.unk4 = gUiGraphics[gfx.uiGfxID].unk8;
  gfx.unk0.unk8 = gUiGraphics[gfx.uiGfxID].unkC;
  gfx.unk0.unk9 = gUiGraphics[gfx.uiGfxID].unk10;
  gfx.unk0.unkA = gUiGraphics[gfx.uiGfxID].unk14;
  gfx.unk0.unkB = gUiGraphics[gfx.uiGfxID].unk18;
  sub_80528AC(&gfx);

  gfx.uiGfxID = 10;
  gfx.unk2B = 7;
  gfx.tiles = gUiGraphics[10].tiles + (gSelectedCharacter << 11);
  gfx.palette = gUiGraphics[10].palette;
  gfx.tilesSize = 0x800;
  gfx.paletteSize = 32;
  gfx.unk28 = 15;
  gfx.vramC = (u8 *)0x06010800;
  gfx.unk2A = 13;
  gfx.unk0.unk4 = gUiGraphics[10].unk8;
  gfx.unk0.unk8 = gUiGraphics[10].unkC;
  gfx.unk0.unk9 = gUiGraphics[10].unk10;
  gfx.unk0.unkA = gUiGraphics[10].unk14;
  gfx.unk0.unkB = gUiGraphics[10].unk18;
  sub_80528AC(&gfx);

  gfx.uiGfxID = 16;
  gfx.unk2B = 8;
  gfx.tiles = gUiGraphics[16].tiles;
  gfx.palette = gUiGraphics[16].palette;
  gfx.tilesSize = 0x200;
  gfx.paletteSize = 32;
  gfx.unk28 = 6;
  gfx.vramC = vramPtrs[0];
  gfx.unk2A = 13;
  gfx.unk0.unk4 = gUiGraphics[16].unk8;
  gfx.unk0.unk8 = gUiGraphics[16].unkC;
  gfx.unk0.unk9 = gUiGraphics[16].unk10;
  gfx.unk0.unkA = gUiGraphics[16].unk14;
  gfx.unk0.unkB = gUiGraphics[16].unk18;
  sub_80528AC(&gfx);

  if (gCurrentLevel <= 13) {
    gfx.uiGfxID = 17;
    gfx.unk2B = 9;
    gfx.tiles = gUiGraphics[17].tiles + 0x920;
    gfx.palette = gUiGraphics[17].palette;
    gfx.tilesSize = (12 - gUnknown_08681274[gCurrentLevel]) << 5;
    gfx.paletteSize = 32;
    gfx.unk28 = 6;
    gfx.vramC = vramPtrs[2];
    gfx.unk2A = 13;
    gfx.unk0.unk4 = gUiGraphics[17].unk8;
    gfx.unk0.unk8 = gUiGraphics[17].unkC;
    gfx.unk0.unk9 = gUiGraphics[17].unk10;
    gfx.unk0.unkA = gUiGraphics[17].unk14;
    gfx.unk0.unkB = gUiGraphics[17].unk18;
    sub_80528AC(&gfx);

    gfx.uiGfxID = 17;
    gfx.unk2B = 9;
    gfx.tiles = gUiGraphics[17].tiles + 0x100;
    gfx.palette = gUiGraphics[17].palette;
    gfx.tilesSize = 0x80;
    gfx.paletteSize = 32;
    gfx.unk28 = 6;
    gfx.vramC = (u8 *)vramPtrs[2] + 0x180;
    gfx.unk2A = 13;
    gfx.unk0.unk4 = gUiGraphics[17].unk8;
    gfx.unk0.unk8 = gUiGraphics[17].unkC;
    gfx.unk0.unk9 = gUiGraphics[17].unk10;
    gfx.unk0.unkA = gUiGraphics[17].unk14;
    gfx.unk0.unkB = gUiGraphics[17].unk18;
    sub_80528AC(&gfx);

    gfx.uiGfxID = 17;
    gfx.unk2B = 9;
    gfx.tiles = gUiGraphics[17].tiles + (gUnknown_08681282[gCurrentLevel] << 5);
    gfx.palette = gUiGraphics[17].palette;
    gfx.tilesSize = gUnknown_08681274[gCurrentLevel] << 5;
    gfx.paletteSize = 32;
    gfx.unk28 = 6;
    gfx.vramC = (u8 *)vramPtrs[2] + ((12 - gUnknown_08681274[gCurrentLevel]) << 5);
    gfx.unk2A = 13;
    gfx.unk0.unk4 = gUiGraphics[17].unk8;
    gfx.unk0.unk8 = gUiGraphics[17].unkC;
    gfx.unk0.unk9 = gUiGraphics[17].unk10;
    gfx.unk0.unkA = gUiGraphics[17].unk14;
    gfx.unk0.unkB = gUiGraphics[17].unk18;
    sub_80528AC(&gfx);

    gfx.uiGfxID = 17;
    gfx.unk2B = 9;
    gfx.tiles = gUiGraphics[17].tiles + 0x100;
    gfx.palette = gUiGraphics[17].palette;
    gfx.tilesSize = 32;
    gfx.paletteSize = 32;
    gfx.unk28 = 6;
    gfx.vramC = vramPtrs[2];
    gfx.unk2A = 13;
    gfx.unk0.unk4 = gUiGraphics[17].unk8;
    gfx.unk0.unk8 = gUiGraphics[17].unkC;
    gfx.unk0.unk9 = gUiGraphics[17].unk10;
    gfx.unk0.unkA = gUiGraphics[17].unk14;
    gfx.unk0.unkB = gUiGraphics[17].unk18;
    sub_80528AC(&gfx);

    gfx.unk0.unk4 = 4;
    gfx.unk0.unk8 = 1;
    gfx.unk0.unk9 = 1;
    gfx.unk0.unkA = 4;
    gfx.unk0.unkB = 1;
    sub_80535C8(&gfx.unk0, 9);
  } else {
    gfx.uiGfxID = 18;
    gfx.unk2B = 9;
    gfx.tiles = gUiGraphics[gfx.uiGfxID].tiles + ((gCurrentLevel - 14) << 9);
    gfx.palette = gUiGraphics[gfx.uiGfxID].palette;
    gfx.tilesSize = 0x200;
    gfx.paletteSize = 32;
    gfx.unk28 = 6;
    gfx.vramC = vramPtrs[2];
    gfx.unk2A = 13;
    gfx.unk0.unk4 = gUiGraphics[gfx.uiGfxID].unk8;
    gfx.unk0.unk8 = gUiGraphics[gfx.uiGfxID].unkC;
    gfx.unk0.unk9 = gUiGraphics[gfx.uiGfxID].unk10;
    gfx.unk0.unkA = gUiGraphics[gfx.uiGfxID].unk14;
    gfx.unk0.unkB = gUiGraphics[gfx.uiGfxID].unk18;
    sub_80528AC(&gfx);
  }

  gfx.uiGfxID = 15;
  gfx.unk2B = 10;
  gfx.tiles = gUiGraphics[15].tiles + 0x100;
  gfx.tiles += act << 7;
  gfx.tilesSize = 0x80;
  gfx.vramC = (u8 *)vramPtrs[4] + 0x100;
  gfx.unk2A = 9;
  gfx.unk0.unk4 = gUiGraphics[15].unk8;
  gfx.unk0.unk8 = gUiGraphics[15].unkC;
  gfx.unk0.unk9 = gUiGraphics[15].unk10;
  gfx.unk0.unkA = gUiGraphics[15].unk14;
  gfx.unk0.unkB = gUiGraphics[15].unk18;
  sub_80528AC(&gfx);

  gfx.uiGfxID = 15;
  gfx.unk2B = 10;
  gfx.tiles = gUiGraphics[15].tiles;
  gfx.palette = gUiGraphics[15].palette;
  gfx.tilesSize = 0x100;
  gfx.vramC = vramPtrs[4];
  gfx.paletteSize = 32;
  gfx.unk28 = 6;
  gfx.unk2A = 13;
  gfx.unk0.unk4 = gUiGraphics[15].unk8;
  gfx.unk0.unk8 = gUiGraphics[15].unkC;
  gfx.unk0.unk9 = gUiGraphics[15].unk10;
  gfx.unk0.unkA = gUiGraphics[15].unk14;
  gfx.unk0.unkB = gUiGraphics[15].unk18;
  sub_80528AC(&gfx);

  gfx.uiGfxID = gUnknown_08681294[gCurrentLevel] + 19;
  gfx.unk2B = 2;
  gfx.tiles = gUiGraphics[gfx.uiGfxID].tiles;
  gfx.palette = gUiGraphics[19].palette;
  gfx.tilesSize = 0x700;
  gfx.paletteSize = 32;
  gfx.unk28 = 6;
  gfx.vramC = vramPtrs[3];
  gfx.unk2A = 13;
  gfx.unk0.unk4 = gUiGraphics[gfx.uiGfxID].unk8;
  gfx.unk0.unk8 = gUiGraphics[gfx.uiGfxID].unkC;
  gfx.unk0.unk9 = gUiGraphics[gfx.uiGfxID].unk10;
  gfx.unk0.unkA = gUiGraphics[gfx.uiGfxID].unk14;
  gfx.unk0.unkB = gUiGraphics[gfx.uiGfxID].unk18;
  sub_80528AC(&gfx);

  gfx.unk0.unk4 = 8;
  gfx.unk0.unk8 = 2;
  gfx.unk0.unk9 = 1;
  gfx.unk0.unkA = 4;
  gfx.unk0.unkB = 2;
  sub_80535C8(&gfx.unk0, 2);
}

/** CreateStageUI, 0x080550C4: spawns the stage intro title card tasks, allocates their VRAM, and loads graphics. */
struct Task *CreateStageUI(void) {
  void *vramPtrs[5];
  struct Task *task4;
  struct Task *task2;
  struct Task *task0;
  struct Task *task1;
  struct Task *task3;
  struct Task *task5;
  struct Task *mainTask;
  struct StageIntroPart *part;
  struct StageIntroMain *ui;

  if (gCurrentLevel <= 12 && (gCurrentLevel & 1) && gUnknown_03005020 != gCurrentLevel && gCurrentLevel != 13) {
    u8 i;
    for (i = 0; i <= 7; i++) {
      struct OamData *oam = OamMalloc(1);
      if (iwram_end == oam) break;
      oam->attr0 = 0x42A;
      oam->attr1 = (i << 5) + (s16)0x8000;
      oam->attr2 = 0x6080;
    }
  }

  sub_80535FC();
  UiGfxStackInit();

  task0 = TaskCreate(CODE(Task_StageIntroBanner), sizeof(struct StageIntroPart), 0x2120, 0, CODE(TaskDestructor_StageIntroPart));
  part = TASK_DATA(task0);
  part->timer = 0;
  part->unk20 = 1;
  part->unk1A = 0;
  part->box.qUnkA = -80;
  part->box.unkC = 0;
  part->box.unkE = 3;
  part->box.unk8 = 24;
  part->box.unk10 = 6;
  part->box.unk16 = 0;
  part->box.unk12 = 15;
  part->box.unk14 = 5;
  part->vram = VramMalloc(32);
  vramPtrs[1] = part->vram;
  part->unk21 = 0;

  task1 = TaskCreate(CODE(Task_StageIntroZoneLetters), sizeof(struct StageIntroPart), 0x2120, 0, NULL);
  part = TASK_DATA(task1);
  part->timer = 0;
  part->unk20 = 0;
  part->unk1A = 1;
  part->box.qUnkA = 20;
  part->box.unkE = 1;
  part->box.unk10 = 7;
  part->box.unk12 = 15;
  part->box.unk16 = 1;
  part->box.unk8 = 16;
  part->unk21 = 0;

  task4 = TaskCreate(CODE(Task_StageIntroActNumber), sizeof(struct StageIntroPart), 0x2120, 0, CODE(TaskDestructor_StageIntroPart));
  part = TASK_DATA(task4);
  part->timer = 0;
  part->unk20 = 1;
  part->unk1A = 0;
  part->box.qUnkA = 180;
  part->box.unkC = 160;
  part->box.unkE = 6;
  part->box.unk10 = 10;
  part->box.unk12 = 6;
  part->box.unk16 = 1;
  part->box.unk8 = 0;
  part->vram = VramMalloc(12);
  vramPtrs[4] = part->vram;
  part->unk21 = 0;

  task2 = TaskCreate(CODE(Task_StageIntroZoneName), sizeof(struct StageIntroPart), 0x2120, 0, CODE(TaskDestructor_StageIntroPart));
  part = TASK_DATA(task2);
  part->timer = 0;
  part->unk20 = 1;
  part->unk1A = 0;
  if ((gCurrentLevel & 1) && gUnknown_03005020 != gCurrentLevel && gCurrentLevel != 13) {
    part->box.qUnkA = -16;
    part->box.unkC = 42;
  } else {
    part->box.qUnkA = 240;
    part->box.unkC = 126;
  }
  part->box.unkE = 8;
  part->box.unk10 = 8;
  part->box.unk12 = 6;
  part->box.unk16 = 1;
  part->box.unk8 = 8;
  part->vram = VramMalloc(16);
  vramPtrs[0] = part->vram;
  part->unk21 = 0;

  task3 = TaskCreate(CODE(Task_StageIntroCharacterName), sizeof(struct StageIntroPart), 0x2120, 0, CODE(TaskDestructor_StageIntroPart));
  part = TASK_DATA(task3);
  part->timer = 0;
  part->unk20 = 1;
  part->unk1A = 0;
  part->box.qUnkA = 360;
  part->box.unkC = 114;
  part->box.unkE = 4;
  part->box.unk10 = 9;
  part->box.unk12 = 6;
  part->box.unk16 = 1;
  part->box.unk8 = 0;
  part->vram = VramMalloc(16);
  vramPtrs[2] = part->vram;
  part->unk21 = 0;

  task5 = TaskCreate(CODE(Task_StageIntroRibbon), sizeof(struct StageIntroPart), 0x2120, 0, CODE(TaskDestructor_StageIntroPart));
  part = TASK_DATA(task5);
  part->timer = 0;
  part->unk20 = 1;
  part->unk1A = 0;
  part->box.qUnkA = 256;
  part->box.unkC = 128;
  part->box.unkE = 9;
  part->box.unk10 = 2;
  part->box.unk12 = 6;
  part->box.unk16 = 1;
  part->box.unk8 = 0;
  part->vram = VramMalloc(56);
  vramPtrs[3] = part->vram;
  part->unk21 = 0;

  mainTask = TaskCreate(CODE(Task_StageIntroMain), sizeof(struct StageIntroMain), 0x2100, 0, CODE(TaskDestructor_StageIntroMain));
  ui = TASK_DATA(mainTask);
  ui->timer = 0;
  ui->unk26 = 1;
  ui->tasks[0] = task0;
  ui->tasks[1] = task1;
  ui->tasks[2] = task2;
  ui->tasks[3] = task3;
  ui->tasks[4] = task4;
  ui->tasks[5] = task5;

  ui->fade.unk0 = 0;
  ui->fade.unk2 = 0;
  ui->fade.unk4 = 2;
  ui->fade.unk6 = 0;
  ui->fade.unk8 = 96;
  ui->fade.unkA = 1;
  ui->unk27 = 0;

  LoadStageIntroGfx(vramPtrs);
  sub_805423C(&ui->fade);
  return mainTask;
}

/** Task_StageIntroBanner, 0x080556FC: slides and draws the character-colored title-card banner. */
void Task_StageIntroBanner(void) {
  struct StageIntroPart *p = TASK_DATA(gCurTask);

  if ((s16)p->timer > 215) {
    p->box.qUnkA -= 8;
  } else if ((s16)p->timer > 10) {
    p->box.qUnkA = 0;
  } else if ((s16)p->timer > 0) {
    p->box.qUnkA += 8;
  }

  if (p->timer <= 105 || p->unk20 == 0 || p->unk21 != 0) {
    sub_8052F78(gUnknown_086812A8, &p->box);
  } else {
    UiDrawTextFade(gUnknown_086812A8, &p->box);
  }
}

/** Task_StageIntroActNumber, 0x080558D0: slides and draws the stage act number on the title card. */
void Task_StageIntroActNumber(void) {
  struct StageIntroPart *p = TASK_DATA(gCurTask);

  if ((s16)p->timer > 215) {
    if (p->box.unkC <= 159) {
      p->box.unkC += 2;
    }
  } else if ((s16)p->timer > 35) {
    p->box.qUnkA = 180;
    p->box.unkC = 144;
    p->box.unkE = 6;
  } else if ((s16)p->timer > 30) {
    if (p->box.unkC > 144) {
      p->box.unkC -= 3;
    }
  }

  if (gCurrentLevel <= 11) {
    if (p->timer <= 105 || p->unk20 == 0 || p->unk21 != 0) {
      sub_8052F78(gUnknown_086812AC, &p->box);
    } else {
      UiDrawTextFade(gUnknown_086812AC, &p->box);
    }
  }
}

/** Task_StageIntroZoneName, 0x08055964: slides and draws the zone name label on the title card. */
void Task_StageIntroZoneName(void) {
  struct StageIntroPart *p = TASK_DATA(gCurTask);

  if ((s16)p->timer > 215) {
    if (p->box.qUnkA < -32) {
      p->box.qUnkA += 32;
      if (p->box.unkE != 0) {
        p->box.unkE--;
      }
    }
    p->box.qUnkA -= 26;
  } else if ((s16)p->timer > 25) {
    p->box.qUnkA = -16;
  } else if ((s16)p->timer > 15) {
    if (gCurrentLevel == 13) {
      p->box.unkC = 126;
      p->box.qUnkA -= 26;
      if (p->box.qUnkA < -16) {
        p->box.qUnkA = -16;
      }
    } else if (gCurrentLevel <= 12 && (gCurrentLevel & 1) && gUnknown_03005020 != gCurrentLevel) {
      p->box.qUnkA = -16;
      p->box.unkC += 9;
      if (p->box.unkC > 126) {
        p->box.unkC = 126;
      }
    } else {
      p->box.unkC = 126;
      p->box.qUnkA -= 26;
      if (p->box.qUnkA < -16) {
        p->box.qUnkA = -16;
      }
    }
  }

  if (p->timer <= 105 || p->unk20 == 0 || p->unk21 != 0) {
    sub_8052F78(gUnknown_086812B4, &p->box);
  } else {
    UiDrawTextFade(gUnknown_086812B4, &p->box);
  }
}

/** Task_StageIntroCharacterName, 0x08055A6C: slides and draws the zone subtitle strip on the title card. */
void Task_StageIntroCharacterName(void) {
  struct StageIntroPart *p = TASK_DATA(gCurTask);

  if ((s16)p->timer > 215) {
    p->box.qUnkA -= 26;
  } else if ((s16)p->timer > 25) {
    p->box.qUnkA = 112;
  } else if (p->timer > 15) {
    p->box.qUnkA -= 26;
    if (p->box.qUnkA <= 111) {
      p->box.qUnkA = 112;
    }
  }

  if (p->timer <= 105 || p->unk20 == 0 || p->unk21 != 0) {
    sub_8052F78(gUnknown_086812C0, &p->box);
  } else {
    UiDrawTextFade(gUnknown_086812C0, &p->box);
  }
}

/** Task_StageIntroRibbon, 0x08055AE4: scrolls and draws the repeating zone-name ribbon on the title card. */
void Task_StageIntroRibbon(void) {
  char text[27];
  struct StageIntroPart *p;

  memcpy(text, gUnknown_086812C8, 22);
  memset(text + 22, 0, 5);

  p = TASK_DATA(gCurTask);
  if ((s16)p->timer > 215) {
    p->box.qUnkA -= 28;
    if (p->box.qUnkA < -31) {
      p->box.unkE--;
      p->box.qUnkA += 32;
      p->unk1A = Mod(p->unk1A + 1, 7);
    }
    if (p->timer <= 105 || p->unk20 == 0 || p->unk21 != 0) {
      sub_8052F78(&text[p->unk1A], &p->box);
    } else {
      UiDrawTextFade(&text[p->unk1A], &p->box);
    }
  } else if ((s16)p->timer > 25) {
    p->box.qUnkA -= 2;
    p->box.unkE = 9;
    if (p->box.qUnkA < -31) {
      p->box.qUnkA += 32;
      p->unk1A = Mod(p->unk1A + 1, 7);
    }
    if (p->timer <= 105 || p->unk20 == 0 || p->unk21 != 0) {
      sub_8052F78(&text[p->unk1A], &p->box);
    } else {
      UiDrawTextFade(&text[p->unk1A], &p->box);
    }
  } else if ((s16)p->timer > 15) {
    p->box.unkC = 128;
    p->box.qUnkA -= 28;
    if (p->box.qUnkA <= 239) {
      p->box.unkE = 9 - (p->box.qUnkA >> 5);
      if (p->box.qUnkA < -31) {
        p->box.qUnkA += 32;
        p->unk1A = Mod(p->unk1A + 1, 7);
      }
      if (p->timer <= 105 || p->unk20 == 0 || p->unk21 != 0) {
        sub_8052F78(&text[p->unk1A], &p->box);
      } else {
        UiDrawTextFade(&text[p->unk1A], &p->box);
      }
    }
  }
}
