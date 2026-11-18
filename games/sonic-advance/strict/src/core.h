// The engine every screen of Sonic Advance runs on: the start, the loop that runs once a frame, and what the
// console's interrupts do.
#ifndef CORE_H
#define CORE_H
#include "console.h"

// gFlags
#define FLAGS_EXECUTE_HBLANK_COPY 0x4
#define FLAGS_PAUSE_GAME 0x400
#define FLAGS_PAUSED 0x800
#define FLAGS_UPDATE_WITH_CPU_SET 0x4000
#define FLAGS_8000 0x8000

#define VBLANK_FUNC_ID_NONE 0xFF

// gDispCnt, as the console's own register of the name
#define DISPCNT_OBJ_1D_MAP 0x0040
#define DISPCNT_BG2_ON 0x0400

// the buttons
#define A_BUTTON 0x0001
#define START_BUTTON 0x0008

// video memory, where the console has it
#define VRAM 0x06000000

/** What the game last asked of the console's three blending registers, which go to them once a frame. */
struct BlendRegs {
  /* 0x00 */ u16 bldCnt;
  /* 0x02 */ u16 bldAlpha;
  /* 0x04 */ u16 bldY;
};

typedef void (*HBlankIntrFunc)(u8 vcount);

extern u32 gFlags;
extern u32 gFlagsPreVBlank;
extern u8 gExecSoundMain;
extern u8 sLastCalledVblankFuncId;
extern u8 gMultiSioEnabled;
extern u32 gMultiSioStatusFlags;
extern u8 gMultiSioSend[];
extern u8 gMultiSioRecv[];
extern u16 gDispCnt;
extern u16 gBgCntRegs[4];
extern s16 gBgScrollRegs[4][2];
extern struct BlendRegs gBldRegs;
extern u8 gBgSprites_Unknown1[16];
extern u8 gBgSprites_Unknown2[4][4];
extern u16 gPressedKeys;
extern u8 gNumHBlankIntrs;
extern HBlankIntrFunc gHBlankIntrs[4];

void AgbMain(void);
void EngineInit(void);
void GameInit(void);
void EngineMainLoop(void);
void GetInput(void);
void UpdateScreenDma(void);
void ClearOamBufferDma(void);
void UpdateScreenCpuSet(void);
void ClearOamBufferCpuSet(void);
void HBlankIntr(void);
u32 MultiSioMain(void *send, void *recv, u32 loadRequest);
void sub_8007858(u8 bg, u8 from, u8 to, u16 x, u16 y);
void sub_80078D4(u8 bg, u8 from, u8 to, u16 x, u16 y);
void sub_8007958(u8 bg, u8 from, u8 to, s16 width, s8 unk, u16 x, u16 y);
void CreateIntroAnimation(void);
void m4aSongNumStart(u16 song);
void m4aSoundMain(void);
void VBlankIntrWait(void);

#endif
