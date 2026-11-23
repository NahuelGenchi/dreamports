// The two logos the game opens with: SEGA's, which opens and closes like a blind, then Sonic Team's, which fades to
// white, or goes at once when A or Start is pressed.
#include "logos.h"
#include "background.h"
#include "core.h"
#include "task.h"

#define TM_PRESENTED_BY_SEGA 86
#define TM_CREATED_BY_SONIC_TEAM 87
#define SE_RING 102
#define LOGO_PRIORITY 0x2000

/** What SEGA's logo keeps: a count of frames, and its background. */
struct SegaLogo {
  /* 0x00 */ u16 frames;
  /* 0x04 */ struct Background bg;
};

/** What Sonic Team's logo keeps: the same, and how far it has faded, in 256ths. */
struct SonicTeamLogo {
  /* 0x00 */ u16 frames;
  /* 0x04 */ struct Background bg;
  /* 0x44 */ s16 qFade;
};

/** CreateSegaLogo, 0x0800CFB8: the screen and the task of SEGA's logo. */
void CreateSegaLogo(void) {
  struct Task *t;
  struct SegaLogo *logo;
  struct Background *bg;

  gBldRegs.bldCnt = 0;
  gBldRegs.bldY = 0;
  gFlags |= FLAGS_8000;
  gDispCnt = DISPCNT_OBJ_1D_MAP;
  gBgCntRegs[2] = 0x5E01;
  gBgScrollRegs[2][0] = 0;
  gBgScrollRegs[2][1] = 0;
  DMA3_FILL32(0, VRAM, 64);
  gBgSprites_Unknown1[2] = 0;
  gBgSprites_Unknown2[2][0] = 0;
  gBgSprites_Unknown2[2][1] = 0;
  gBgSprites_Unknown2[2][2] = 0xFF;
  gBgSprites_Unknown2[2][3] = 0x40;

  t = TaskCreate(CODE(Task_SetSegaLogoTask), sizeof(struct SegaLogo), LOGO_PRIORITY, 0, NULL);
  logo = TASK_DATA(t);
  logo->frames = 0;
  bg = &logo->bg;
  bg->graphics.dest = (void *)VRAM;
  bg->graphics.anim = 0;
  bg->layoutVram = (u16 *)(VRAM + 0xF000);
  bg->unk18 = 0;
  bg->unk1A = 0;
  bg->tilemapId = TM_PRESENTED_BY_SEGA;
  bg->unk1E = 0;
  bg->unk20 = 0;
  bg->unk22 = 5;
  bg->unk24 = 5;
  bg->targetTilesX = 20;
  bg->targetTilesY = 10;
  bg->paletteOffset = 0;
  bg->flags = 2;
  DrawBackground(bg);
}

/** Task_SegaLogoInit, 0x0800D098: the logo opens from the bottom, a line more each frame, for 160 frames. */
void Task_SegaLogoInit(void) {
  struct SegaLogo *logo = TASK_DATA(gCurTask);

  gDispCnt |= DISPCNT_BG2_ON;
  logo->frames++;
  sub_8007858(2, 0, 160 - logo->frames, gBgScrollRegs[2][0], gBgScrollRegs[2][1] + 160 - logo->frames);
  sub_80078D4(2, 160 - logo->frames, 160, gBgScrollRegs[2][0], gBgScrollRegs[2][1]);
  if (logo->frames == 160) {
    gCurTask->main = CODE(sub_800D3E0);
    logo->frames = 0;
  }
}

/** Task_800D11C, 0x0800D11C: the logo closes from the bottom, for 160 frames, and Sonic Team's follows. */
void Task_800D11C(void) {
  struct SegaLogo *logo = TASK_DATA(gCurTask);

  logo->frames++;
  sub_80078D4(2, 0, 160 - logo->frames, gBgScrollRegs[2][0], gBgScrollRegs[2][1]);
  sub_8007858(2, 160 - logo->frames, 160, gBgScrollRegs[2][0], gBgScrollRegs[2][1] + 160 - logo->frames);
  if (logo->frames == 160) {
    gFlags &= ~FLAGS_8000;
    SwitchToSonicTeamLogo();
  }
}

/** CreateSonicTeamLogo, 0x0800D198: the screen and the task of Sonic Team's logo. */
void CreateSonicTeamLogo(void) {
  struct Task *t;
  struct SonicTeamLogo *logo;
  struct Background *bg;

  gBldRegs.bldCnt = 0;
  gBldRegs.bldY = 0;
  gDispCnt = DISPCNT_OBJ_1D_MAP;
  gBgCntRegs[2] = 0x5E01;
  gBgScrollRegs[2][0] = 0;
  gBgScrollRegs[2][1] = 0;
  DMA3_FILL32(0, VRAM, 64);
  gBgSprites_Unknown1[2] = 0;
  gBgSprites_Unknown2[2][0] = 0;
  gBgSprites_Unknown2[2][1] = 0;
  gBgSprites_Unknown2[2][2] = 0xFF;
  gBgSprites_Unknown2[2][3] = 0x40;

  t = TaskCreate(CODE(Task_SonicTeamLogoInit), sizeof(struct SonicTeamLogo), LOGO_PRIORITY, 0, NULL);
  logo = TASK_DATA(t);
  logo->frames = 0;
  bg = &logo->bg;
  bg->graphics.dest = (void *)VRAM;
  bg->graphics.anim = 0;
  bg->layoutVram = (u16 *)(VRAM + 0xF000);
  bg->unk18 = 0;
  bg->unk1A = 0;
  bg->tilemapId = TM_CREATED_BY_SONIC_TEAM;
  bg->unk1E = 0;
  bg->unk20 = 0;
  bg->unk22 = 5;
  bg->unk24 = 5;
  bg->targetTilesX = 20;
  bg->targetTilesY = 10;
  bg->paletteOffset = 0;
  bg->flags = 2;
  DrawBackground(bg);
}

/** Task_800D268, 0x0800D268: the logo comes in through a shape that narrows, two steps a frame, and rings when whole. */
void Task_800D268(void) {
  struct SonicTeamLogo *logo = TASK_DATA(gCurTask);

  gDispCnt |= DISPCNT_BG2_ON;
  logo->frames += 2;
  if (logo->frames < 280) {
    sub_80078D4(2, 0, 40, gBgScrollRegs[2][0], gBgScrollRegs[2][1]);
    sub_80078D4(2, 120, 160, gBgScrollRegs[2][0], gBgScrollRegs[2][1]);
    if (logo->frames < 200) {
      sub_8007958(2, 40, 120, 280 - logo->frames, -1, gBgScrollRegs[2][0], gBgScrollRegs[2][1]);
    } else {
      sub_8007958(2, 40, 64 - logo->frames, 280 - logo->frames, -1, gBgScrollRegs[2][0], gBgScrollRegs[2][1]);
      sub_80078D4(2, 64 - logo->frames, 120, gBgScrollRegs[2][0], gBgScrollRegs[2][1]);
    }
  } else {
    m4aSongNumStart(SE_RING);
    gFlags &= ~FLAGS_EXECUTE_HBLANK_COPY;
    gCurTask->main = CODE(Task_800D450);
    logo->frames = 0;
  }
}

/** sub_800D364, 0x0800D364: the logo fades to white, half a step a frame, and the story's opening follows. A or
 *  Start goes to the title screen at once. */
void sub_800D364(void) {
  struct SonicTeamLogo *logo = TASK_DATA(gCurTask);

  if (gPressedKeys & (A_BUTTON | START_BUTTON)) {
    gCurTask->main = CODE(Task_800D4B0);
    return;
  }
  logo->qFade += 0x80;
  if (logo->qFade > 0x1000) {
    gBldRegs.bldY = 0x1000;
    sub_800D498();
    return;
  }
  gBldRegs.bldY = logo->qFade >> 8;
}

/** Task_SetSegaLogoTask, 0x0800D3C4: SEGA's logo starts opening in the frame its task first runs. */
void Task_SetSegaLogoTask(void) {
  gCurTask->main = CODE(Task_SegaLogoInit);
  CALL(gCurTask->main)();
}

/** sub_800D3E0, 0x0800D3E0: SEGA's logo stays for 120 frames. */
void sub_800D3E0(void) {
  struct SegaLogo *logo = TASK_DATA(gCurTask);

  if (++logo->frames == 120) {
    gCurTask->main = CODE(Task_800D11C);
    logo->frames = 0;
  }
}

/** SwitchToSonicTeamLogo, 0x0800D40C: from SEGA's logo to Sonic Team's. */
void SwitchToSonicTeamLogo(void) {
  gFlags &= ~FLAGS_EXECUTE_HBLANK_COPY;
  TaskDestroy(gCurTask);
  CreateSonicTeamLogo();
}

/** Task_SonicTeamLogoInit, 0x0800D434: Sonic Team's logo starts coming in in the frame its task first runs. */
void Task_SonicTeamLogoInit(void) {
  gCurTask->main = CODE(Task_800D268);
  CALL(gCurTask->main)();
}

/** Task_800D450, 0x0800D450: Sonic Team's logo stays for 121 frames, then starts to fade. */
void Task_800D450(void) {
  struct SonicTeamLogo *logo = TASK_DATA(gCurTask);

  if (logo->frames++ > 120) {
    logo->qFade = 0;
    gCurTask->main = CODE(sub_800D364);
    gBldRegs.bldCnt = 0xFF;
    gBldRegs.bldY = 0;
  }
}

/** sub_800D498, 0x0800D498: from Sonic Team's logo to the story's opening. */
void sub_800D498(void) {
  TaskDestroy(gCurTask);
  CreateIntroAnimation();
}
