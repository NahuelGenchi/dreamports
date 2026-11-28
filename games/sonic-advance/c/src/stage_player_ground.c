// The player on the ground: its height, the floor under it, its speed along the ground, its balance at a ledge, and the
// edges of the level, in C.
#include "stage_init.h"

typedef s32 (*SensorFunc)(s32 pos, s32 other, u32 layer, u8 *outRotation);
s32 PlayerSensorCast(s32 pos, s32 other, s32 layer, s32 step, u8 *outRotation, SensorFunc func);
void PlayerFloorCollisionUp(struct StagePlayer *p);
void PlayerFloorCollisionRight(struct StagePlayer *p);
void PlayerFloorCollisionLeft(struct StagePlayer *p);
void PlayerMoveLeft(struct StagePlayer *p);
void PlayerMoveRight(struct StagePlayer *p);
void PlayerBalanceOnPlatform(struct StagePlayer *p);

extern const s16 gSineTable[];
// by level: where the camera's region wraps, and how far the player and camera move back when it does
extern const s16 gUnknown_084A6E74[][2];
extern const s16 gUnknown_084A6EBC[][2];

/** PlayerClampToStageBounds, 0x08043E8C: where the camera's region wraps, moves the player and the camera back by a
 *  region; below the bottom of the level (or above the top, upside down) the player dies; and it stays within the edges,
 *  stopping where it meets them. */
void PlayerClampToStageBounds(struct StagePlayer *p) {
  struct StageCamera *cam = &gStageCamera;
  s32 x = p->x;
  s32 y = p->y;
  s32 wrapX, wrapY;

  if (p->playerId == 0) {
    wrapX = gUnknown_084A6E74[gCurrentLevel][0];
    if (wrapX >= 0 && x >= wrapX << 8 && cam->shiftX != 0 && !(cam->unk26 & 1)) {
      s32 moveX = gUnknown_084A6EBC[gCurrentLevel][0];
      x += moveX << 8;
      if ((s8)gUnknown_03005088 == 2) {
        gStagePartner.x += moveX << 8;
      }
      cam->x += moveX;
      cam->unk10 += moveX;
    }

    wrapY = gUnknown_084A6E74[gCurrentLevel][1];
    if (wrapY >= 0 && y >= wrapY << 8 && cam->shiftY != 0 && !(cam->unk26 & 2)) {
      s32 moveY = gUnknown_084A6EBC[gCurrentLevel][1];
      s32 regions = moveY * 256;
      y += regions << 8;
      if ((s8)gUnknown_03005088 == 2) {
        gStagePartner.y += regions << 8;
      }
      cam->y += regions;
      cam->unk12 += regions;
    }
  }

  if ((p->moveState & 0x80000080) != 0x80) {
    s32 freeX, freeY;
    struct StageCamera *bounds = &gStageCamera;
    s32 playerY = p->y;

    if (!(p->moveState & 0x80000000)) {
      s32 outOfBounds;

      if (!(gStageFlags & 0x80)) {
        if (playerY >= (bounds->maxY << 8) - 1) {
          outOfBounds = 1;
          goto decided;
        }
      } else if (gStageFlags & 0x80) {
        if (playerY <= bounds->minY << 8) {
          outOfBounds = 1;
          goto decided;
        }
      }
      outOfBounds = 0;
    decided:
      if (outOfBounds) {
        p->moveState |= 0x80;
        if (p->moveState & 0x40) {
          p->speedAirY = -0x2A0;
        } else {
          p->speedAirY = -0x4E0;
        }

        if (!(gStageFlags & 0x80)) {
          y = (cam->maxY << 8) - 1;
        } else {
          y = cam->minY << 8;
        }
      }
    }

    freeX = x;
    freeY = y;

    x = (x < cam->minX << 8) ? cam->minX << 8 : ((x > (cam->maxX << 8) - 1) ? (cam->maxX << 8) - 1 : x);
    y = (y < cam->minY << 8) ? cam->minY << 8 : ((y > (cam->maxY << 8) - 1) ? (cam->maxY << 8) - 1 : y);

    if (x != freeX) {
      p->speedAirX = 0;
      p->speedGroundX = 0;
    }

    if (y != freeY) {
      p->speedAirY = 0;
      p->speedGroundX = 0;
    }

    p->x = x;
    p->y = y;
  }
}

/** PlayerCheckLedgeBalance, 0x08044E14: standing still with nothing under its middle, the player teeters at the ledge,
 *  facing it or with its back to it, as one foot finds the ground and the other doesn't. */
void PlayerCheckLedgeBalance(struct StagePlayer *p) {
  s32 worldX = p->x >> 8;
  s32 worldY = p->y >> 8;
  s32 res;

  res = PlayerSensorCast(worldY + p->unkF, worldX, p->unk27, 8, NULL, CODE(GetTileHeightAndRotation));
  if (res > 8) {
    s32 left;

    if (gStageFlags & 0x80) {
      s32 x, y, x2, y2;
      y = p->unkF;
      y = worldY - y;
      x = worldX - 2;
      left = PlayerSensorCast(y, x - p->unkE, p->unk27, -8, NULL, CODE(GetTileHeightAndRotation));

      y2 = p->unkF;
      y2 = worldY - y2;
      x2 = worldX + 2;
      res = PlayerSensorCast(y2, x2 + p->unkE, p->unk27, -8, NULL, CODE(GetTileHeightAndRotation));
    } else {
      s32 x, y, x2, y2;
      y = worldY + p->unkF;
      x = worldX - 2;
      left = PlayerSensorCast(y, x - p->unkE, p->unk27, 8, NULL, CODE(GetTileHeightAndRotation));

      y2 = worldY + p->unkF;
      x2 = worldX + 2;
      res = PlayerSensorCast(y2, x2 + p->unkE, p->unk27, 8, NULL, CODE(GetTileHeightAndRotation));
    }

    if (left > 8 && res == 0) {
      if (!(p->moveState & 1)) {
        p->unk40 = 13;
      } else {
        p->unk40 = 12;
      }
    } else if (left == 0 && res > 8) {
      if (p->moveState & 1) {
        p->unk40 = 13;
      } else {
        p->unk40 = 12;
      }
    }
  }
}

/** PlayerGroundAccel, 0x08044F48: the player's run along the ground: the pad's left and right, the pose when it stops or
 *  starts, Amy's hammer run, slowing down with nothing held, and its speed along the slope it's on. */
void PlayerGroundAccel(struct StagePlayer *p) {
  s32 speed;
  u8 rot;

  if ((s16)p->unk1A == 0 && (s8)p->unk40 != 64 && (s8)p->unk40 != 27) {
    switch (p->unk38 & 0x30) {
      case 0:
        if (p->speedGroundX != 0) {
          if ((s8)p->unk40 == 8 || (s8)p->unk40 == 9 || (s8)p->unk40 == 0) {
            p->unk40 = 4;
            PlayerSetHeight(p, 14);
            p->unkE = 6;
            p->unkF = 14;
          }
        } else if (!(p->moveState & 0x800000)) {
          if (p->character != 3 || !(p->moveState & 0x200)) {
            if ((s8)p->unk40 == 2) {
              p->unk40 = 3;
            } else if ((s8)p->unk40 == 10) {
              p->unk40 = 11;
            } else if ((s8)p->unk40 != 3 && (s8)p->unk40 != 11) {
              p->unk40 = 0;
            }
            PlayerSetHeight(p, 14);
            p->unkE = 6;
            p->unkF = 14;
          }
        }

        if (p->character == 3) {
          if ((s8)p->unk40 == 2) {
            speed = p->speedGroundX;
            if (speed > 0) {
              speed -= p->unk34;
              if (speed < 0) {
                speed = 0;
              }
            } else {
              speed += p->unk34;
              if (speed > 0) {
                speed = 0;
              }
            }
            p->speedGroundX = speed;
          }
        }
        break;
      case 0x20:
        PlayerMoveLeft(p);
        break;
      case 0x10:
        PlayerMoveRight(p);
        break;
    }

    if (p->character == 3 && (p->moveState & 0x200)) {
      speed = p->speedGroundX;
      if (speed == 0) {
        speed = 0x300;
        if (p->moveState & 1) {
          speed = -speed;
        }
        p->speedGroundX = speed;
      }
    } else if (!((p->unk14 + 32) & 0xC0) && p->speedGroundX == 0) {
      p->moveState &= ~0x20;
      if (!(p->moveState & 0x800000)) {
        if ((s8)p->unk40 != 3 && (s8)p->unk40 != 11) {
          p->unk40 = 0;
        }
        if (p->moveState & 8) {
          PlayerBalanceOnPlatform(p);
        } else {
          PlayerCheckLedgeBalance(p);
        }
      }
    }
  }

  PlayerLookUpDown(p);

  if (!(p->unk38 & 0x30)) {
    speed = p->speedGroundX;
    if (speed > 0) {
      speed -= 8;
      if (speed < 0) {
        speed = 0;
      }
      p->speedGroundX = speed;
    } else if (speed < 0) {
      speed += 8;
      if (speed > 0) {
        speed = 0;
      }
      p->speedGroundX = speed;
    }
  }

  speed = p->speedGroundX;
  p->speedAirX = (speed * (gSineTable[(rot = p->unk14) * 4 + 256] >> 6)) >> 8;
  p->speedAirY = (speed * (gSineTable[rot * 4] >> 6)) >> 8;

  PlayerWallCollision(p);
}

/** PlayerFloorCollisionDown, 0x0804342C: finds the floor under the player's two feet, stands it on the nearer turned as
 *  the floor is there, or lets it fall off when the floor drops away further than it runs in a frame. */
void PlayerFloorCollisionDown(struct StagePlayer *p) {
  s32 x = p->x;
  s32 y = p->y;
  s32 rot = p->unk14;
  u32 layer = p->unk27;
  s32 py = y >> 8;
  s32 left, right, nearest;
  u32 found;

  left = PlayerSensorCast(py + p->unkF, (x >>= 8) - (2 + p->unkE), layer, 8, &p->unk18, CODE(GetTileHeightAndRotation));

  py += p->unkF;
  x += 2;
  x += p->unkE;
  right = PlayerSensorCast(py, x, layer, 8, &p->unk19, CODE(GetTileHeightAndRotation));

  nearest = right;
  if (right > left) {
    nearest = left;
  }

  if (nearest != 0) {
    if (nearest < 0) {
      if (nearest < -11) {
        return;
      }
      y += nearest << 8;
      if (left < right) {
        found = p->unk18;
      } else {
        found = p->unk19;
      }
      rot = found;
    } else {
      s32 speed = p->speedAirX;
      if (speed < 0) {
        speed = -speed;
      }
      speed = (speed >> 8) + 3;
      if (speed > 11) {
        speed = 11;
      }

      if (nearest <= speed) {
        y += nearest << 8;
        if (left < right) {
          found = p->unk18;
        } else {
          found = p->unk19;
        }
        rot = found;
      } else if (p->moveState & 0x800) {
        y += nearest << 8;
      } else {
        p->moveState |= 2;
        p->moveState &= ~0x20;
        return;
      }
    }
  } else {
    if (left < right) {
      found = p->unk18;
    } else {
      found = p->unk19;
    }
    rot = found;
  }

  p->y = y;
  if (!(rot & 1)) {
    p->unk14 = rot;
    if (gStageFlags & 0x80) {
      u32 turned;
      rot = p->unk14;
      turned = (rot + 64) << 24;
      turned = -turned;
      rot = turned >> 24;
      p->unk14 = rot - 64;
    }
  }
}

/** PlayerFloorCollision, 0x0804386C: the floor's check by which way the player is turned, down, up or either side, and
 *  none on an object it stands on. */
void PlayerFloorCollision(struct StagePlayer *p) {
  u8 quadrant;

  if (p->moveState & 8) {
    p->unk19 = 0;
    p->unk18 = 0;
    return;
  }

  if (gStageFlags & 0x80) {
    s8 rot = p->unk14;
    rot += 64;
    rot = -rot;
    rot -= 64;

    if (rot + 32 > 0) {
      if (rot <= 0) {
        quadrant = rot + 32;
      } else {
        quadrant = rot + 31;
      }
    } else {
      if (rot > 0) {
        quadrant = rot + 32;
      } else {
        quadrant = rot + 31;
      }
    }

    switch (quadrant >> 6) {
      case 0:
        PlayerFloorCollisionDown(p);
        break;
      case 2:
        PlayerFloorCollisionUp(p);
        break;
      case 1:
        PlayerFloorCollisionRight(p);
        break;
      case 3:
        PlayerFloorCollisionLeft(p);
        break;
    }
  } else {
    s8 rot = p->unk14;

    if (rot + 32 > 0) {
      if (rot <= 0) {
        quadrant = rot + 32;
      } else {
        quadrant = rot + 31;
      }
    } else {
      if (rot > 0) {
        quadrant = rot + 32;
      } else {
        quadrant = rot + 31;
      }
    }

    switch (quadrant >> 6) {
      case 0:
        PlayerFloorCollisionDown(p);
        break;
      case 2:
        PlayerFloorCollisionUp(p);
        break;
      case 1:
        PlayerFloorCollisionRight(p);
        break;
      case 3:
        PlayerFloorCollisionLeft(p);
        break;
    }
  }
}

/** PlayerSetHeight, 0x08045138: when the player's height changes, as it curls up or stands, moves it by the difference,
 *  along the way it's turned, so that its feet stay where they were. */
void PlayerSetHeight(struct StagePlayer *p, s32 height) {
  u8 rot;

  if (p->unkF == height) {
    return;
  }

  rot = p->unk14;
  if (gStageFlags & 0x80) {
    rot += 64;
    rot = -rot;
    rot -= 64;
  }

  if ((s32)(rot + 32) > 0) {
    if (rot != 0) {
      rot = (rot + 32) - 1;
    } else {
      rot = 32;
    }
  } else {
    if (rot != 0) {
      rot = rot + 32;
    } else {
      rot = 31;
    }
  }

  switch (rot >> 6) {
    case 0:
      p->y -= (height - p->unkF) << 8;
      break;
    case 2:
      p->y += (height - p->unkF) << 8;
      break;
    case 1:
      p->x += (height - p->unkF) << 8;
      break;
    case 3:
      p->x -= (height - p->unkF) << 8;
      break;
  }
}
