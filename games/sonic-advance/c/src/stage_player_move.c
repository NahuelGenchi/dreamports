// Player jump initiation, look-up/crouch handling, and underwater physics in C.
#include "stage_init.h"

void m4aSongNumStop(u16 n);

extern const s16 gSineTable[];

s32 PlayerCastCeilingSensor(u8 angle, struct StagePlayer *p);
void PlayerLookUp(struct StagePlayer *p);
void PlayerCrouchOrRoll(struct StagePlayer *p);
void CreateWaterSplash(s32 x, s32 y);
void CreateDrowningCountdown(struct StagePlayer *p, s32 num);
void CreateAirBubble(s32 x, s32 y, s32 a, s32 b);
void PlayerDrown(struct StagePlayer *p);

/** PlayerCheckCrouchOrRoll, 0x0804421C: checks ceiling clearance and launches a ground jump or Amy hammer jump. */
s32 PlayerCheckCrouchOrRoll(struct StagePlayer *p) {
  u8 rot = p->unk14;
  s32 jumpForce = 0;

  if (!(p->unk3A & gUnknown_030060E0[0])) return 0;

  if (gStageFlags & 0x80) {
    rot += 64;
    rot = -rot;
    rot -= 64;
  }

  if (PlayerCastCeilingSensor((u8)(rot + 128), p) <= 3) return 0;

  p->moveState |= 2;
  p->moveState &= ~0x1000020;
  p->moveState |= 0x100;
  p->moveState &= ~0x800;

  switch (p->character) {
    case 0:
    case 1:
    case 2:
      p->unk40 = 5;
      jumpForce = (p->moveState & 0x40) ? 0x2A0 : 0x4E0;
      break;
    case 3:
      if (!(p->unk38 & 0x80)) {
        p->unk40 = 85;
        jumpForce = (p->moveState & 0x40) ? 0x2A0 : 0x4E0;
      } else {
        s32 horiz;
        p->unk40 = 91;
        p->moveState &= ~0x2000000;
        p->moveState |= 0x4000000;
        p->moveState &= ~0x100;
        p->charState.amy.unk80 = 2;
        if (p->moveState & 0x40) {
          horiz = 0x280;
          jumpForce = 0xC0;
        } else {
          horiz = 0x400;
          jumpForce = 0x140;
        }
        if (p->moveState & 1) {
          p->speedAirX = (-((gSineTable[p->unk14 * 4 + 256] >> 6) * horiz)) >> 8;
          p->speedAirY = (-((gSineTable[p->unk14 * 4] >> 6) * horiz)) >> 8;
        } else {
          p->speedAirX = ((gSineTable[p->unk14 * 4 + 256] >> 6) * horiz) >> 8;
          p->speedAirY = ((gSineTable[p->unk14 * 4] >> 6) * horiz) >> 8;
        }
      }
      break;
  }

  rot = p->unk14 - 64;
  p->speedAirX += ((gSineTable[rot * 4 + 256] >> 6) * jumpForce) >> 8;
  p->speedAirY += ((gSineTable[rot * 4] >> 6) * jumpForce) >> 8;

  m4aSongNumStart(116);

  if (p->character != 3) {
    if (!(p->moveState & 4)) {
      p->moveState |= 4;
      PlayerSetHeight(p, 9);
      p->unkE = 6;
      p->unkF = 9;
    } else {
      p->moveState |= 0x10;
    }
  }

  return 1;
}

/** PlayerLookUpDown, 0x0804489C: handles standing look-up, crouching, and vertical camera shift return. */
void PlayerLookUpDown(struct StagePlayer *p) {
  if ((u8)(p->unk40 - 12) <= 1) {
    if (p->playerId == 0) {
      p->unk15 = 120;
      if (p->playerId == 0) {
        if (gStageCamera.unk22 > 0) {
          gStageCamera.unk22 -= 2;
        } else if (gStageCamera.unk22 < 0) {
          gStageCamera.unk22 += 2;
        }
      }
    }
    return;
  }

  switch (p->unk38 & 0xC0) {
    case 0:
      if (p->playerId == 0) {
        p->unk15 = 120;
        if (p->playerId == 0) {
          if (gStageCamera.unk22 > 0) {
            gStageCamera.unk22 -= 2;
          } else if (gStageCamera.unk22 < 0) {
            gStageCamera.unk22 += 2;
          }
        }
      }
      if ((s8)p->unk40 == 2) {
        p->unk40 = 3;
      } else if ((s8)p->unk40 == 10) {
        p->unk40 = 11;
      }
      break;
    case 0x40:
      if (p->speedGroundX == 0) {
        p->unk40 = 10;
        PlayerLookUp(p);
      } else if (p->playerId == 0) {
        p->unk15 = 120;
        if (p->playerId == 0) {
          if (gStageCamera.unk22 > 0) {
            gStageCamera.unk22 -= 2;
          } else if (gStageCamera.unk22 < 0) {
            gStageCamera.unk22 += 2;
          }
        }
      }
      break;
    case 0x80:
      PlayerCrouchOrRoll(p);
      break;
  }
}

/** PlayerWaterUpdate, 0x08044A38: updates player underwater state, physics constants, drowning countdown, and bubbles. */
void PlayerWaterUpdate(struct StagePlayer *p) {
  p->moveState &= ~0x1000;

  if (gStageWater.currentWaterLevel >= 0 && (p->y >> 8) - 4 >= gStageWater.currentWaterLevel) {
    if (!(p->moveState & 0x40)) {
      p->moveState |= 0x40;
      p->moveState |= 0x1000;
      p->speedAirX >>= 1;
      p->speedAirY >>= 2;
      if ((p->character != 2 || (s8)p->unk3D != 9) && (s8)p->unk5C <= 0) {
        p->unk5C = 10;
        CreateWaterSplash(p->x >> 8, gStageWater.currentWaterLevel);
        m4aSongNumStart(190);
      }
    }

    if (!(p->moveState & 0x2000)) {
      p->unk2C = 0x240;
      p->unk30 = 4;
      p->unk34 = 48;
    } else {
      p->unk2C = 0x3C0;
      p->unk30 = 18;
      p->unk34 = 96;
    }

    p->unk5B--;
    if ((s8)p->unk5B <= 0) {
      u8 air = p->unk5A;
      p->unk5A = air - 1;
      switch ((s8)(air - 2)) {
        case 9:
          if (p->playerId == 0) {
            gUnknown_03005040[4] = 16;
          }
          break;
        case 10:
          CreateDrowningCountdown(p, 5);
          break;
        case 8:
          CreateDrowningCountdown(p, 4);
          break;
        case 6:
          CreateDrowningCountdown(p, 3);
          break;
        case 4:
          CreateDrowningCountdown(p, 2);
          break;
        case 2:
          CreateDrowningCountdown(p, 1);
          break;
        case 0:
          CreateDrowningCountdown(p, 0);
          break;
      }

      if ((s8)p->unk5A < 0) {
        p->moveState |= 0x80;
        p->speedAirY = 0;
        CreateAirBubble(p->x, p->y - 0xC00, 0, 1);
        PlayerDrown(p);
      }
      p->unk5B = 60;
    }

    if ((gUnknown_03005120 & 0xF) == 0) {
      gPseudoRandom = gPseudoRandom * 0x196225 + 0x3C6EF35F;
      if ((gPseudoRandom & 0x300) == 0) {
        s32 bx = (p->moveState & 1) ? -0x400 : 0x400;
        CreateAirBubble(p->x + bx, p->y - 0x400, 0, 0);
      }
    }
  } else {
    if (p->moveState & 0x40) {
      p->moveState &= ~0x40;
      p->moveState |= 0x1000;
      p->speedAirY <<= 1;
      if ((p->character != 2 || (s8)p->unk3D != 9) && (s8)p->unk5C <= 0) {
        p->unk5C = 10;
        CreateWaterSplash(p->x >> 8, gStageWater.currentWaterLevel);
        m4aSongNumStart(190);
      }
    }

    if (!(p->moveState & 0x2000)) {
      p->unk2C = 0x480;
      p->unk30 = 8;
      p->unk34 = 96;
    } else {
      p->unk2C = 0x780;
      p->unk30 = 36;
      p->unk34 = 192;
    }

    p->unk5B = 60;
    p->unk5A = 30;
    if (p->playerId == 0) {
      m4aSongNumStop(27);
    }
  }

  if (p->itemEffect & 4) {
    p->unk2C <<= 1;
    p->unk30 <<= 1;
    p->unk34 <<= 1;
  } else if (p->itemEffect & 0x10) {
    p->unk2C >>= 2;
    p->unk30 >>= 2;
    p->unk34 >>= 2;
  }

  if ((s8)p->unk5C != 0) {
    p->unk5C--;
  }
}
