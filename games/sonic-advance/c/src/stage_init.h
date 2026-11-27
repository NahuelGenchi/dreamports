// Stage initialization, camera setup, and stage-wide structures in C.
#ifndef STAGE_INIT_H
#define STAGE_INIT_H
#include "background.h"
#include "console.h"
#include "core.h"
#include "save.h"
#include "stage.h"
#include "task.h"

struct Collision {
  /* 0x00 */ const u8 *heightMap;
  /* 0x04 */ const u8 *tileRotation;
  /* 0x08 */ const u16 *metatiles;
  /* 0x0C */ const u8 *map[2];
  /* 0x14 */ const u16 *flags;
  /* 0x18 */ u16 levelX;
  /* 0x1A */ u16 levelY;
  /* 0x1C */ u16 pxWidth;
  /* 0x1E */ u16 pxHeight;
};

struct StageColCache {
  /* 0x00 */ s32 tile;
  /* 0x04 */ s32 div12;
  /* 0x08 */ s32 mod12;
};

struct StageBrakingDust {
  /* 0x00 */ u8 unk0;
  /* 0x04 */ struct Task *t;
};

struct PlayerSprite2 {
  /* 0x00 */ struct GraphicsData graphics;
  /* 0x0C */ const struct SpriteDimensions *dimensions;
  /* 0x10 */ u32 frameFlags;
  /* 0x14 */ u16 animCursor;
  /* 0x16 */ s16 x;
  /* 0x18 */ s16 y;
  /* 0x1A */ u16 oamFlags;
  /* 0x1C */ s16 qAnimDelay;
  /* 0x1E */ u16 prevAnim;
  /* 0x20 */ u8 variant;
  /* 0x21 */ u8 prevVariant;
  /* 0x22 */ u8 animSpeed;
  /* 0x23 */ u8 oamBaseIndex;
  /* 0x24 */ u8 numSubFrames;
  /* 0x25 */ u8 palId;
  /* 0x28 */ struct Hitbox hitboxes[2];
};

struct PlayerSpriteInfo {
  /* 0x00 */ s16 rotation;
  /* 0x02 */ s16 scaleX;
  /* 0x04 */ s16 scaleY;
  /* 0x06 */ s16 x;
  /* 0x08 */ s16 y;
  /* 0x0C */ struct PlayerSprite2 s;
};

struct StageCamera {
  /* 0x00 */ s16 x;
  /* 0x02 */ s16 y;
  /* 0x04 */ s16 shiftX;
  /* 0x06 */ s16 shiftY;
  /* 0x08 */ s16 unk8;
  /* 0x0A */ s16 unkA;
  /* 0x0C */ s16 unkC;
  /* 0x0E */ s16 unkE;
  /* 0x10 */ s16 unk10;
  /* 0x12 */ s16 unk12;
  /* 0x14 */ s16 minY;
  /* 0x16 */ s16 maxY;
  /* 0x18 */ s16 minX;
  /* 0x1A */ s16 maxX;
  /* 0x1C */ s16 unk1C;
  /* 0x1E */ s16 unk1E;
  /* 0x20 */ s16 unk20;
  /* 0x22 */ s16 unk22;
  /* 0x24 */ u16 unk24;
  /* 0x26 */ s16 unk26;
  /* 0x28 */ s16 unk28;
  /* 0x2A */ s16 unk2A;
  /* 0x2C */ void (*fn2C)(s32, s32);
  /* 0x30 */ struct Task *movementTask;
  /* 0x34 */ s16 unk34;
  /* 0x36 */ s16 unk36;
  /* 0x38 */ s16 unk38;
  /* 0x3A */ u8 unk3A;
};

struct StagePlayer {
  /* 0x00 */ s32 x;
  /* 0x04 */ s32 y;
  /* 0x08 */ s16 speedAirX;
  /* 0x0A */ s16 speedAirY;
  /* 0x0C */ s16 speedGroundX;
  /* 0x0E */ s8 unkE;
  /* 0x0F */ s8 unkF;
  /* 0x10 */ u32 moveState;
  /* 0x14 */ u8 unk14;
  /* 0x15 */ u8 unk15;
  /* 0x16 */ u16 unk16;
  /* 0x18 */ u8 unk18;
  /* 0x19 */ u8 unk19;
  /* 0x1A */ u16 unk1A;
  /* 0x1C */ u16 unk1C;
  /* 0x1E */ u16 unk1E;
  /* 0x20 */ u16 unk20;
  /* 0x22 */ u16 unk22;
  /* 0x24 */ u16 unk24;
  /* 0x26 */ u8 itemEffect;
  /* 0x27 */ u8 unk27;
  /* 0x28 */ u32 unk28;
  /* 0x2C */ s32 unk2C;
  /* 0x30 */ s32 unk30;
  /* 0x34 */ s32 unk34;
  /* 0x38 */ u16 unk38;
  /* 0x3A */ u16 unk3A;
  /* 0x3C */ s8 playerId;
  /* 0x3D */ u8 unk3D;
  /* 0x3E */ u8 unk3E;
  /* 0x3F */ u8 unk3F;
  /* 0x40 */ u8 unk40;
  /* 0x41 */ u8 unk41;
  /* 0x42 */ u16 anim;
  /* 0x44 */ s16 variant;
  /* 0x46 */ u16 unk46;
  /* 0x48 */ s16 spawnX;
  /* 0x4A */ s16 spawnY;
  /* 0x4C */ u32 unk4C;
  /* 0x50 */ u16 unk50;
  /* 0x52 */ u16 unk52;
  /* 0x54 */ u16 unk54;
  /* 0x56 */ u16 unk56;
  /* 0x58 */ u8 unk58;
  /* 0x59 */ s8 character;
  /* 0x5A */ u8 unk5A;
  /* 0x5B */ u8 unk5B;
  /* 0x5C */ u8 unk5C;
  /* 0x5D */ u8 filler5D[3];
  /* 0x60 */ struct Task *spriteTask;
  /* 0x64 */ struct PlayerSpriteInfo *bodySprite;
  /* 0x68 */ struct PlayerSpriteInfo *tailSprite;
  /* 0x6C */ u8 unk6C;
  /* 0x6D */ u8 unk6D[16];
  /* 0x7D */ u8 filler7D[3];
  /* 0x80 */ union {
    struct {
      u8 unk80;
      u16 unk82;
      u16 unk84;
    } sonic;
    struct {
      u8 unk80;
      u8 unk81;
      u32 unk84;
    } tails;
    struct {
      u8 unk80;
      u8 unk81;
      u8 unk82;
    } knuckles;
    struct {
      u8 unk80;
    } amy;
  } charState;
};

struct RingsScatter {
  /* 0x000 */ struct Sprite s;
  /* 0x030 */ u16 rings[0x180];
  /* 0x330 */ s32 unk330;
  /* 0x334 */ u16 unk334;
  /* 0x336 */ u16 unk336;
};

struct RingsManager {
  /* 0x00 */ struct Sprite s;
  /* 0x30 */ void *rings;
};

struct EntitiesManager {
  /* 0x00 */ void *IA;
  /* 0x04 */ void *items;
  /* 0x08 */ void *enemies;
  /* 0x0C */ s16 prevCamX;
  /* 0x0E */ s16 prevCamY;
  /* 0x10 */ u8 unk10;
};

struct StageWater {
  /* 0x00 */ s8 unk0;
  /* 0x01 */ u8 unk1;
  /* 0x02 */ s16 currentWaterLevel;
  /* 0x04 */ s16 targetWaterLevel;
  /* 0x08 */ u32 isActive;
  /* 0x0C */ u32 unkC;
  /* 0x10 */ struct Task *t;
  /* 0x14 */ struct Sprite s;
};

#ifdef MATCHING
#define REG_READ32(at) (*(vu32 *)(0x04000000 + (at)))
#else
#define REG_READ32(at) ((u32)console_read16(at) | ((u32)console_read16((at) + 2) << 16))
#endif

extern s8 gCurrentLevel;
extern s8 gSelectedCharacter;
extern s8 gStageTailsEnabled;
extern u32 gUnknown_03005030;
extern u8 gUnknown_03005024;
extern u8 gUnknown_03005020;
extern u8 gUnknown_03005080;
extern u8 gUnknown_0300501C;
extern u8 gUnknown_03005148;
extern u16 gUnknown_03004FEC;
extern u8 gUnknown_03005088;
extern u32 gUnknown_03005120;
extern u32 gUnknown_03005038;
extern u32 gUnknown_03004FE4;
extern u32 gUnknown_03005034;
extern u8 gUnknown_03005040[5];
extern u16 gUnknown_030060E0[2];
extern u8 gUnknown_03004FFC;
extern u8 gUnknown_03004FE0;
extern u8 gUnknown_03005074;
extern u8 gUnknown_03004FE8[4];
extern u8 gMultiplayerConnections;
extern u32 gUnknown_03004FF0[3];
extern u32 gUnknown_03005010;
extern u16 gUnknown_030060F0[60];
extern u16 gUnknown_03006170[60];
extern struct Background gStageBackgrounds[4];
extern struct StageCamera gStageCamera;
extern struct StagePlayer gStagePlayer;
extern struct StagePlayer gStagePartner;
extern struct StageWater gStageWater;
extern struct StageColCache gStageColCacheX;
extern struct StageColCache gStageColCacheY;
extern struct StageBrakingDust gStageBrakingDust;
extern const struct Collision *gRefCollision;

void RLUnCompWram(const void *src, void *dest);
void sub_803DC98(void);
void InitCamera(u32 level);
void StageSetTimeLimit(u32 param0);
void CreateGameStage(void);
struct Task *sub_800CF04(u16 priority, u16 anim, u8 variant, TaskDestructor dtor);
void Task_800CF90(void);
void Task_803F690(void);
void TaskDestructor_803F628(struct Task *t);
void Task_803F6CC(void);
void sub_803CB18(void);
void Task_StageMusicManager(void);
void StageInit(void);
void Task_GameStageMain(void);
void InitPlayerWrapper(s32 character, s32 level, u32 id, struct StagePlayer *player);
void InitPlayer(s32 character, s32 level, u32 id, struct StagePlayer *player);
void InitWater(s32 height, u32 unkC, u32 flags);
void RecordInputHistory(u16 keys);
void StageInitCounters(void);
u32 GetMetatileId(s32 x, s32 y, u32 layer);
void CreateBrakingDustTask(void);
void Task_BrakingDustDummy(void);
void PlayerCollisionDispatch(void);
void InitPlayerSprite(s32 character, s32 level, struct StagePlayer *player);
void InitPlayerBodySprite(struct StagePlayer *p, struct PlayerSpriteInfo *info);
void InitPlayerTailSprite(struct StagePlayer *p, struct PlayerSpriteInfo *info);
void PlayerResetSpriteBuffers(struct StagePlayer *p);
void CreateRingsScatterTask(void);
void CreateStageRingsManager(void);
void CreateEntitiesManager(void);
void LoadStageIntroGfx(void **vramPtrs);
struct Task *CreateStageUI(void);
void Task_StageIntroMain(void);
void Task_StageIntroBanner(void);
void Task_StageIntroZoneLetters(void);
void Task_StageIntroActNumber(void);
void Task_StageIntroZoneName(void);
void Task_StageIntroCharacterName(void);
void Task_StageIntroRibbon(void);
s32 GetTileHeightAndRotation(s32 y, s32 x, u32 layerAndFlags, u8 *outRotation);
void PlayerApplySlopeForce(struct StagePlayer *p);
void PlayerUpdatePosition(struct StagePlayer *p);
void PlayerCheckSlopeFall(struct StagePlayer *p);
void PlayerTrySpindash(struct StagePlayer *p);
s32 PlayerSpecialMoveDispatch(struct StagePlayer *p);
void PlayerUpdateMovementState(struct StagePlayer *p);
void PlayerFloorCollisionDown(struct StagePlayer *p);
void PlayerFloorCollision(struct StagePlayer *p);
void PlayerWallCollision(struct StagePlayer *p);
void PlayerClampToStageBounds(struct StagePlayer *p);
s32 PlayerCheckJump(struct StagePlayer *p);
s32 PlayerCheckCrouchOrRoll(struct StagePlayer *p);
void PlayerLookUpDown(struct StagePlayer *p);
void PlayerWaterUpdate(struct StagePlayer *p);
void PlayerCheckLedgeBalance(struct StagePlayer *p);
void PlayerGroundAccel(struct StagePlayer *p);
void PlayerSetHeight(struct StagePlayer *p, s32 height);

#endif
