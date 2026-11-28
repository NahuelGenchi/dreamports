// The player's own task each frame: its buttons, its moves by character, its sprites and its item timers, in C.
#include "stage_init.h"

struct MP2KPlayerState;
extern struct MP2KPlayerState gMPlayInfo_BGM;
void m4aMPlayTempoControl(struct MP2KPlayerState *mplayInfo, u16 tempo);
void m4aSongNumStop(u16 n);

void Task_PlayerDied(void);
void PlayerTailsMove(struct StagePlayer *p);
void PlayerKnucklesMove(struct StagePlayer *p);
void PlayerAmyMove(struct StagePlayer *p);
void PlayerHandleInputs(struct StagePlayer *p);
void sa2__sub_802486C(struct StagePlayer *p, struct PlayerSpriteInfo *psi);
void sa2__sub_8024B10(struct StagePlayer *p, struct PlayerSpriteInfo *psi);
void sa2__sub_8024F74(struct StagePlayer *p, struct PlayerSpriteInfo *psi);

#ifdef MATCHING
struct PlayerSioBits {
  u16 baudRate : 2;
  u16 si : 1;
  u16 sd : 1;
  u16 id : 2;
  u16 error : 1;
  u16 enable : 1;
  u16 unused_11_8 : 4;
  u16 mode : 2;
  u16 ifEnable : 1;
  u16 unused_15 : 1;
  u16 data;
};
#define PLAYER_SIO_ID (((volatile struct PlayerSioBits *)0x04000128)->id)
#else
#define PLAYER_SIO_ID ((u32)((REG_READ16(REG_SIOCNT) >> 4) & 3))
#endif

/** Task_PlayerMain, 0x080454D8: the player's own task each frame: its death, or its buttons, water and moves, then its
 *  sprites and the timers of the items it has. */
void Task_PlayerMain(void) {
  struct StagePlayer *p = &gStagePlayer;

  if (p->moveState & 0x80) {
    struct StageCamera *cam = &gStageCamera;
    gCurTask->main = CODE(Task_PlayerDied);
    p->unk40 = 1;
    p->speedAirX = 0;
    p->unk1C = 2;
    p->itemEffect = 0;
    p->moveState &= ~0x20;
    p->moveState &= ~0x8;
    p->unk28 = 0;
    cam->unk26 |= 3;
    if (gGameMode <= 1) {
      gStageFlags |= 1;
    }

    p->bodySprite->s.frameFlags &= ~0x3000;
    p->bodySprite->s.frameFlags |= 0x1000;
    p->unk54 = 0x100;
    p->unk56 = 0x100;
    m4aSongNumStop(28);
    m4aSongNumStop(27);
    m4aSongNumStop(120);

    if ((s8)p->unk5A < 0) {
      m4aSongNumStart(192);
    } else {
      m4aSongNumStart(119);
    }
  } else {
    PlayerHandleInputs(p);
    PlayerWaterUpdate(p);

    if (!(p->moveState & 0x400000)) {
      switch (p->character) {
        case 0:
          PlayerUpdateMovementState(p);
          break;
        case 1:
          PlayerTailsMove(p);
          break;
        case 2:
          PlayerKnucklesMove(p);
          break;
        case 3:
          PlayerAmyMove(p);
          break;
      }
    }
  }

  sa2__sub_802486C(p, p->bodySprite);
  sa2__sub_8024B10(p, p->bodySprite);
  sa2__sub_8024F74(p, p->tailSprite);

  if ((s8)p->unk40 != 15 && (s16)p->unk1C > 0) {
    p->unk1C--;
  }

  if (p->itemEffect != 0) {
    if ((p->itemEffect & 4) && --p->unk20 == 0) {
      m4aMPlayTempoControl(&gMPlayInfo_BGM, 0x100);
      p->itemEffect &= ~4;
    }

    if ((p->itemEffect & 0x10) && --p->unk20 == 0) {
      m4aMPlayTempoControl(&gMPlayInfo_BGM, 0x100);
      p->itemEffect &= ~0x10;
    }

    if ((p->itemEffect & 2) && --p->unk1E == 0) {
      p->itemEffect &= ~2;
      m4aSongNumStop(28);
    }

    if ((p->itemEffect & 0x20) && --p->unk24 == 0) {
      p->itemEffect &= ~0x20;
      gDispCnt &= ~0x8000;
      gWinRegs[5] = 0x3F;
    }
  }
}

/** PlayerHandleInputs, 0x08045CC8: the buttons the player holds and has just pressed, from the pad, swapped about while
 *  the player is confused in multiplayer, and kept in the history of the buttons. */
void PlayerHandleInputs(struct StagePlayer *p) {
  u8 r0, r1, r2;
  u16 input;

  if (gGameMode > 1 && PLAYER_SIO_ID != gStageCamera.unk3A) {
    p->unk38 = 0;
    input = 0;
    RecordInputHistory(0);
  } else {
    input = p->unk38;

    if (!(p->moveState & 0x200000)) {
      p->unk38 = gInput;

      if (gGameMode > 1 && (p->itemEffect & 0x40)) {
        r2 = (p->unk38 & 0xF0) >> 4;
        r1 = (gUnknown_03005120 + p->unk22) & 3;
        if (r1 == 0) {
          r1 = 1;
        }

        r2 <<= r1;
        r0 = (r2 >> 4) | r2;
        r2 = r0 << 4;

        p->unk38 = (p->unk38 & ~0xF0) | r2;
        if (--p->unk22 == 0) {
          p->itemEffect &= ~0x40;
        }
      }
      RecordInputHistory(p->unk38);
    } else {
      RecordInputHistory(0);
    }
  }

  input ^= p->unk38;
  input &= p->unk38;
  p->unk3A = input;

  if (p->unk38 & 0x30) {
    p->unk38 &= ~0xC0;
  }

  if (p->unk3A & 0x30) {
    p->unk3A &= ~0xC0;
  }
}
