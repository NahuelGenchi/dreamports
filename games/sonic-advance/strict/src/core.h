// The engine every screen of Sonic Advance runs on: the start, the loop that runs once a frame, and what the
// console's interrupts do.
#ifndef CORE_H
#define CORE_H
#include "console.h"

// gFlags
#define FLAGS_UPDATE_BACKGROUND_PALETTES 0x1
#define FLAGS_EXECUTE_HBLANK_COPY 0x4
#define FLAGS_EXECUTE_HBLANK_CALLBACKS 0x8
#define FLAGS_EXECUTE_VBLANK_CALLBACKS 0x10
#define FLAGS_20 0x20
#define FLAGS_NO_FLASH_MEMORY 0x100
#define FLAGS_200 0x200
#define FLAGS_PAUSE_GAME 0x400
#define FLAGS_PAUSED 0x800
#define FLAGS_SKIP_INTRO 0x1000
#define FLAGS_UPDATE_WITH_CPU_SET 0x4000
#define FLAGS_8000 0x8000

#define VBLANK_FUNC_ID_NONE 0xFF

// gDispCnt, as the console's own register of the name
#define DISPCNT_OBJ_1D_MAP 0x0040
#define DISPCNT_BG0_ON 0x0100
#define DISPCNT_OBJ_ON 0x1000
#define DISPCNT_FORCED_BLANK 0x0080
#define DISPCNT_BG2_ON 0x0400

// the buttons
#define A_BUTTON 0x0001
#define B_BUTTON 0x0002
#define SELECT_BUTTON 0x0004
#define START_BUTTON 0x0008


/** What the game last asked of the console's three blending registers, which go to them once a frame. */
struct BlendRegs {
  /* 0x00 */ u16 bldCnt;
  /* 0x02 */ u16 bldAlpha;
  /* 0x04 */ u16 bldY;
};

typedef void (*HBlankIntrFunc)(u8 vcount);
typedef void (*IntrFunc)(void);
typedef void (*VBlankFunc)(void);

/** A rotating background's registers, as the game keeps them to give the console once a frame. */
struct BgAffineReg {
  /* 0x00 */ s16 pa, pb, pc, pd;
  /* 0x08 */ s32 x, y;
};

/** Where every sprite is moved by, on the whole screen. */
struct SpriteOffset {
  /* 0x00 */ s16 x, y;
};

/** The input recorder, for the game's demos: whether it records, plays back or neither. */
struct InputRecorder {
  /* 0x00 */ u8 filler0[8];
  /* 0x08 */ u8 mode;
};

extern u32 gFlags;
extern u32 gFlagsPreVBlank;
extern u8 gExecSoundMain;
extern u8 sLastCalledVblankFuncId;
extern u8 gMultiSioEnabled;
extern u32 gMultiSioStatusFlags;
extern u32 gMultiSioSend[5];
extern u32 gMultiSioRecv[20];
extern u16 gDispCnt;
extern u16 gBgCntRegs[4];
extern s16 gBgScrollRegs[4][2];
extern struct BlendRegs gBldRegs;
extern u8 gBgSprites_Unknown1[16];
extern u8 gBgSprites_Unknown2[4][4];
extern u16 gPressedKeys;
extern u8 gNumHBlankIntrs;
extern HBlankIntrFunc gHBlankIntrs[4];
extern u16 gInput;
extern u16 gPrevInput;
extern u16 gReleasedKeys;
extern u16 gRepeatedKeys;
extern u8 gRepeatedKeysTestCounter[10];
#define RECORDER_RECORD 1
#define RECORDER_PLAYBACK 2
#define KEYS_MASK 0x3FF
enum { REG_KEYINPUT = 0x130 };
extern u8 gBackgroundsCopyQueueCursor;
extern u8 gBackgroundsCopyQueueIndex;
extern u8 gBgSpritesCount;
extern u8 gVramGraphicsCopyCursor;
extern u8 gVramGraphicsCopyQueueIndex;
extern struct SpriteOffset gSpriteOffset;
extern void *gVramGraphicsCopyQueue[32];
extern u8 gOamFreeIndex;
extern u8 gOamFirstPausedIndex;
/** A sprite of the console's list: three attributes, and a byte the engine links its own list with. */
struct OamData {
  /* 0x00 */ u16 attr0;
  /* 0x02 */ u16 attr1;
  /* 0x04 */ u16 attr2;
  /* 0x06 */ u8 fractional;
  /* 0x07 */ u8 integer;
};
extern struct OamData gOamBuffer[128];
extern struct OamData gOamMallocBuffer[128];
extern s8 gOamMallocOrders_StartIndex[32];
extern s8 gOamMallocOrders_EndIndex[32];
extern u16 gObjPalette[0x100];
extern u16 gBgPalette[0x100];
extern struct BgAffineReg gBgAffineRegs[2];
extern u16 gUnknown_03001204, gUnknown_030010B0, gUnknown_03004C34, gUnknown_0300232C;
extern u16 gUnknown_030045F4, gUnknown_0300120C, gUnknown_030020C0, gUnknown_03004C38;
extern u16 gWinRegs[6];
extern u32 gPseudoRandom;
extern u8 gKeysFirstRepeatIntervals[10];
extern u8 gKeysContinuedRepeatIntervals[10];
extern struct InputRecorder gInputRecorder;
extern u16 gPhysicalInput;
extern u32 *gInputPlaybackData;
extern u32 gFrameCount;
extern IntrFunc gIntrTable[16];
extern const IntrFunc gIntrTableTemplate[16];
extern u16 gBgOffsetsBuffer[2][0x140];
extern void *gBgOffsetsHBlankPrimary;
extern void *gBgOffsetsHBlankSecondary;
extern void *gHBlankCopyTarget;
extern u8 gHBlankCopySize;
extern u8 gNumHBlankCallbacks;
extern HBlankIntrFunc gHBlankCallbacks[4];
extern u8 gNumVBlankCallbacks;
extern u8 gNumVBlankIntrs;
extern VBlankFunc gVBlankCallbacks[4];
extern VBlankFunc gVBlankIntrs[4];
extern u16 gVramHeapMaxTileSlots;
/** The console's interrupt handler, ARM code, which EngineInit copies to the fast work memory to run there. */
extern const u32 IntrMain[0x80];
extern u32 gIntrMainBuf[0x80];

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
void InputRecorderWrite(u16 input);
u16 InputRecorderRead(void);
u32 MultiSioMain(void *send, void *recv, u32 loadRequest);
void sub_8007858(u8 bg, u8 from, u8 to, u16 x, u16 y);
void sub_80078D4(u8 bg, u8 from, u8 to, u16 x, u16 y);
void sub_8007958(u8 bg, u8 from, u8 to, s16 width, s8 unk, u16 x, u16 y);
void CreateIntroAnimation(void);
void m4aSongNumStart(u16 song);
void m4aSoundMain(void);
void m4aSoundInit(void);
void m4aSoundMode(u32 mode);
u16 IdentifyFlash(void);
u16 SetFlashTimerIntr(u8 timer, IntrFunc *intrFunc);
void MultiSioInit(u32 connectedFlags);
void VBlankIntrWait(void);

#endif
