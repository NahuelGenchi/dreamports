// Player slope/movement physics, special move dispatch, and wall collision in C.
#include "stage_init.h"

extern const s16 gSineTable[];

s32 PlayerCastWallSensor(u8 angle, struct StagePlayer *p);
void PlayerGroundCollisionWall(struct StagePlayer *p);
void PlayerRollDecel(struct StagePlayer *p);
void PlayerAirGravity(struct StagePlayer *p);
void PlayerAirControl(struct StagePlayer *p);
void PlayerRollSlopeForce(struct StagePlayer *p);
void PlayerSetSpeedFromGround(struct StagePlayer *p);
void PlayerApplyGravity(struct StagePlayer *p);
void PlayerUpdateAirRotation(struct StagePlayer *p);
void PlayerUpdateAirInput(struct StagePlayer *p);
void PlayerUpdateAirTimer(struct StagePlayer *p);
void PlayerSpecialState(struct StagePlayer *p);
void PlayerAirCollision(struct StagePlayer *p);
void PlayerSpecialMove1(struct StagePlayer *p);
void PlayerSpecialMove2(struct StagePlayer *p);
void PlayerAirSpecialAction(struct StagePlayer *p);

/** PlayerApplySlopeForce, 0x08046F78: adds slope gravity to ground speed when standing on an incline. */
void PlayerApplySlopeForce(struct StagePlayer *p) {
  u8 rot = p->unk14;
  if (((rot + 96) & 0xFF) <= 191) {
    s32 force = ((gSineTable[rot * 4] >> 6) * 3) >> 5;
    if (p->speedGroundX != 0) {
      p->speedGroundX += force;
    }
  }
}

/** PlayerUpdatePosition, 0x080470B4: integrates air velocity into player coordinates, inverting Y on gravity flip. */
void PlayerUpdatePosition(struct StagePlayer *p) {
  p->x += p->speedAirX;
  if ((gStageFlags ^ gUnknown_0300502C) & 0x80) {
    p->speedAirY = -p->speedAirY;
  }
  if (gStageFlags & 0x80) {
    p->y -= p->speedAirY;
  } else {
    p->y += p->speedAirY;
  }
}

/** PlayerCheckSlopeFall, 0x080471A0: decrements control lock or detaches the player from steep slopes when too slow. */
void PlayerCheckSlopeFall(struct StagePlayer *p) {
  if (!(p->moveState & 0x800)) {
    if ((s16)p->unk1A != 0) {
      p->unk1A--;
    } else if ((p->unk14 + 32) & 0xC0) {
      s32 spd = p->speedGroundX;
      if (spd < 0) spd = -spd;
      if (spd <= 0x1DF) {
        p->speedGroundX = 0;
        p->moveState |= 2;
        p->unk1A = 30;
      }
    }
  }
}

/** PlayerTrySpindash, 0x080474D4: initiates a ground special attack when the action button is pressed on flat ground. */
void PlayerTrySpindash(struct StagePlayer *p) {
  if (!(p->moveState & 0x400) && (s8)(p->unk14 + 64) > 0 && !(p->moveState & 0x20) && (p->unk3A & gUnknown_030060E0[1])) {
    if (p->moveState & 1) {
      p->speedGroundX = -0x200;
    } else {
      p->speedGroundX = 0x200;
    }
    p->speedAirX = 0;
    p->unk3E++;
    p->unk40 = 45;
    m4aSongNumStart(109);
  }
}

/** PlayerSpecialMoveDispatch, 0x08047634: steps the player's ground attack state machine. */
s32 PlayerSpecialMoveDispatch(struct StagePlayer *p) {
  switch ((s8)p->unk3E) {
    case 0:
      PlayerTrySpindash(p);
      return (s8)p->unk3E;
    case 1:
      PlayerSpecialMove1(p);
      return (s8)p->unk3E;
    case 2:
      PlayerSpecialMove2(p);
      return (s8)p->unk3E;
    case 3: {
      s32 spd = p->speedGroundX;
      if (spd > 0) {
        spd -= 32;
        if (spd < 0) spd = 0;
        p->speedGroundX = spd;
      } else if (spd < 0) {
        spd += 32;
        if (spd > 0) spd = 0;
        p->speedGroundX = spd;
      }
      PlayerSetSpeedFromGround(p);
      if (p->speedGroundX == 0) {
        p->unk40 = 48;
        p->unk3E++;
      }
      PlayerGroundCollisionWall(p);
      return (s8)p->unk3E;
    }
    case 4:
      return (s8)p->unk3E;
    default:
      return 0;
  }
}

/** PlayerUpdateMovementState, 0x08047378: dispatches ground, airborne, rolling, and jumping player physics. */
void PlayerUpdateMovementState(struct StagePlayer *p) {
  switch (p->moveState & 6) {
    case 0:
      if (p->moveState & 0x1000000) {
        PlayerSpecialState(p);
      } else if ((s8)p->unk3E == 0) {
        if (gGameMode != 6 && PlayerSpecialMoveDispatch(p) != 0) break;
        if (PlayerCheckJump(p) != 0) break;
        if (PlayerCheckCrouchOrRoll(p) != 0) break;
        PlayerApplySlopeForce(p);
        PlayerGroundAccel(p);
        goto ground_move;
      } else {
        PlayerApplySlopeForce(p);
        if (gGameMode != 6) {
          PlayerSpecialMoveDispatch(p);
        }
        goto ground_move;
      }
      break;
    case 2:
      PlayerUpdateAirInput(p);
      PlayerUpdateAirTimer(p);
      PlayerAirControl(p);
      PlayerAirGravity(p);
      PlayerClampToStageBounds(p);
      PlayerUpdatePosition(p);
      PlayerApplyGravity(p);
      PlayerUpdateAirRotation(p);
      PlayerAirCollision(p);
      break;
    case 4:
      PlayerUpdateAirInput(p);
      PlayerUpdateAirTimer(p);
      if (PlayerCheckCrouchOrRoll(p) != 0) break;
      PlayerRollSlopeForce(p);
      PlayerRollDecel(p);
    ground_move:
      PlayerClampToStageBounds(p);
      PlayerUpdatePosition(p);
      PlayerFloorCollision(p);
      PlayerCheckSlopeFall(p);
      break;
    case 6:
      PlayerUpdateAirInput(p);
      PlayerUpdateAirTimer(p);
      if (gGameMode != 6) {
        PlayerAirSpecialAction(p);
      }
      PlayerAirControl(p);
      PlayerAirGravity(p);
      PlayerClampToStageBounds(p);
      PlayerUpdatePosition(p);
      PlayerApplyGravity(p);
      PlayerUpdateAirRotation(p);
      PlayerAirCollision(p);
      break;
  }
}

/** PlayerWallCollision, 0x08043C64: casts a forward wall sensor and halts the player against solid surfaces. */
void PlayerWallCollision(struct StagePlayer *p) {
  u8 angle;
  s32 dist;

  if (p->speedGroundX == 0) return;

  {
    u8 offset = 64;
    if (p->speedGroundX >= 0) offset = 192;
    angle = p->unk14;
    angle += offset;
  }
  dist = PlayerCastWallSensor(angle, p) << 8;
  if (dist > 0) return;

  switch ((s32)((angle + 32) & 0xC0) >> 6) {
    case 0:
      p->y += dist;
      p->speedAirY = 0;
      break;
    case 1:
      p->x -= dist;
      goto hit_wall;
    case 2:
      p->y -= dist;
      p->speedAirY = 0;
      p->moveState |= 2;
      break;
    case 3:
      p->x += dist;
    hit_wall:
      p->speedAirX = 0;
      p->moveState = (p->moveState | 0x20) & ~4;
      PlayerSetHeight(p, 14);
      p->unkE = 6;
      p->unkF = 14;
      p->speedGroundX = 0;
      break;
  }

  p->unk3E = 0;
  p->unk3F = 0;
}
