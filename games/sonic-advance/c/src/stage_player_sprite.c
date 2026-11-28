// The player's sprites each frame: the animation its state picks, where it's drawn, its turn and flips, what's sent to
// the other players, and Tails's tails, in C.
#include "stage_init.h"

void m4aSongNumStop(u16 n);

#define ABS(value) ((value) < 0 ? -(value) : (value))
// an angle wrapped to one turn of 1024, kept in 16 bits as the original keeps it
#define WRAP_ANGLE(value) ({ s16 wrapped = (value) & 0x3FF; wrapped; })

/** What a player's sprite sends to the others each frame in multiplayer, and what comes back from each of them. */
struct PlayerSpriteSio {
  /* 0x00 */ u16 unk0;
  /* 0x02 */ s16 x;
  /* 0x04 */ s16 y;
  /* 0x06 */ u16 unk6;
  /* 0x08 */ u16 unk8;
  /* 0x0A */ u8 unkA;
  /* 0x0B */ u8 unkB;
  /* 0x0C */ u8 unkC;
  /* 0x0D */ u8 unkD;
};

/** Another player in multiplayer, as its task keeps it. */
struct PlayerSpriteOther {
  /* 0x00 */ struct Sprite s;
  /* 0x30 */ u8 filler30[0x2C];
  /* 0x5C */ u32 unk5C;
  /* 0x60 */ u8 filler60[4];
  /* 0x64 */ u8 unk64;
};

#ifdef MATCHING
struct PlayerSpriteSioBits {
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
#define SPRITE_SIO_ID (((volatile struct PlayerSpriteSioBits *)0x04000128)->id)
#else
#define SPRITE_SIO_ID ((u32)((REG_READ16(REG_SIOCNT) >> 4) & 3))
#endif

extern const u16 sCharStateAnimInfo[][2];
extern const u16 gPlayerCharacterIdleAnims[];
extern u8 gOamMatrixIndex;
void CreateBrakingDustEffect(s32 x, s32 y);
void TransformSprite(struct Sprite *s, struct PlayerSpriteInfo *transform);
u16 ArcTan2(s32 x, s32 y);
void CreateAmyAttackHeartEffect(void);
void sa2__sub_8021BE0(struct StagePlayer *p);
void sa2__sub_802486C(struct StagePlayer *p, struct PlayerSpriteInfo *psi);

/** sa2__sub_802486C, 0x08045FD4: the animation and variant the player's state and character pick, how fast it plays,
 *  and its flips. */
void sa2__sub_802486C(struct StagePlayer *p, struct PlayerSpriteInfo *psi) {
  s32 speed;
  struct PlayerSprite2 *s = &psi->s;

  if (p->moveState & 0x20) {
    p->unk3E = 0;
    p->unk3F = 0;
    p->unk40 = 14;
  }

  p->anim = sCharStateAnimInfo[(s8)p->unk40][0];
  if ((s8)p->unk40 < 43) {
    p->anim += gPlayerCharacterIdleAnims[p->character];
  }
  p->variant = sCharStateAnimInfo[(s8)p->unk40][1];
  psi->s.animSpeed = 16;

  if (p->speedGroundX != 0 || (p->unk38 & 0xF3)) {
    p->unk46 = 360;
  }

  switch ((s8)p->unk40) {
    case 0:
      if ((s16)p->unk46 != 0) {
        p->unk46--;
      } else {
        p->anim = gPlayerCharacterIdleAnims[p->character] + 1;
        p->variant = 0;
      }
      break;

    case 4:
      speed = p->speedGroundX;
      if (ABS(speed) >= 0x480) {
        p->anim = gPlayerCharacterIdleAnims[p->character] + 5;
        p->variant = 0;
        s->animSpeed = 16;
        break;
      }
      // falls through
    case 24:
    case 25:
    case 26:
      speed = p->speedGroundX;
      speed = ABS(speed) >> 4;
      if (speed >= 8) {
        if (speed > 16) {
          speed = 16;
        }
      } else {
        speed = 8;
      }
      s->animSpeed = speed;
      break;

    case 21:
    case 85:
      if (p->speedAirY >= -0x180) {
        p->unk40 = 18;
      }
      break;

    case 9:
      speed = p->speedGroundX;
      if (ABS(speed) < 0x180) {
        p->anim = gPlayerCharacterIdleAnims[p->character] + 7;
        p->variant = 0;
      }

      if ((gUnknown_03005120 & 3) == 0) {
        s32 offsetY = p->unkF;
        if (gStageFlags & 0x80) {
          offsetY = -offsetY;
        }
        CreateBrakingDustEffect(p->x >> 8, (p->y >> 8) + offsetY);
      }
      break;

    case 16:
      if (((p->unk14 + 32) & 0xC0) != 0) {
        p->anim = gPlayerCharacterIdleAnims[p->character] + 44;
        p->variant = 1;
        p->moveState &= ~1;
      }
      break;
  }

  if (p->moveState & 0x40) {
    s->animSpeed -= s->animSpeed >> 1;
  }

  if (!(p->moveState & 1)) {
    s->frameFlags |= 0x400;
  } else {
    s->frameFlags &= ~0x400;
  }

  if (gStageFlags & 0x80) {
    s->frameFlags |= 0x800;
  } else {
    s->frameFlags &= ~0x800;
  }

  if (gGameMode > 1) {
    p->unk6C = 0;
  }

  if (s->graphics.anim != p->anim || s->variant != (u16)p->variant) {
    s->graphics.anim = p->anim;
    s->variant = p->variant;
    s->prevVariant = 0xFF;
    s->hitboxes[0].index = -1;
    s->hitboxes[1].index = -1;

    if (gGameMode > 1) {
      p->unk6C = 1;
    }
  }

  p->unk41 = p->unk40;
}

/** sa2__sub_8024B10, 0x080462C8: the player's body sprite on the screen: where it is, its turn and size or its flips, the
 *  state its animation's end leads to, and in multiplayer what's sent to the others. */
void sa2__sub_8024B10(struct StagePlayer *p, struct PlayerSpriteInfo *inPsi) {
  struct PlayerSpriteSio *send;
  struct PlayerSpriteOther *mpp;
  struct PlayerSprite2 *s = &inPsi->s;
  struct PlayerSpriteInfo *psi = inPsi;
  struct StageCamera *cam = &gStageCamera;
  s16 camX = cam->x;
  s16 camY = cam->y;
  // the frame's animation lost: the original compares the halfword prevAnim with 0xFF, not 0xFFFF
  bool32 lost = ({
    bool32 either = s->prevVariant == 0xFF || s->prevAnim == 0xFF;
    either;
  });

top:
  s->x = (p->x >> 8) - camX;
  s->y = (p->y >> 8) - camY;
  psi->x = (p->x >> 8) - camX;
  psi->y = (p->y >> 8) - camY;

  if ((s8)p->unk40 == 4 || (s8)p->unk40 == 23 || (s8)p->unk40 == 32 || (s8)p->unk40 == 40) {
    s32 x, y;

    if ((s8)p->unk40 != 32) {
      psi->rotation = p->unk14 << 2;
    }
    s->frameFlags &= ~0xC00;
    s->frameFlags &= ~0x1F;
    s->frameFlags |= p->playerId | 0x20;

    if (!(p->moveState & 1)) {
      psi->scaleX = -0x100;
    } else {
      psi->scaleX = 0x100;
    }
    if (gStageFlags & 0x80) {
      psi->scaleX = -psi->scaleX;
    }

    if (psi->scaleX < 0) {
      psi->x--;
    }

    if (gStageFlags & 0x80) {
      psi->scaleY = 0x100;
      psi->rotation = WRAP_ANGLE(WRAP_ANGLE(-0x100 - ((u16)psi->rotation + psi->scaleY)));
    } else {
      psi->scaleY = 0x100;
    }

    x = (psi->scaleX * (s16)p->unk54) >> 8;
    y = (psi->scaleY * (s16)p->unk56) >> 8;
    psi->scaleX = x;
    psi->scaleY = y;
    UpdateSpriteAnimation((struct Sprite *)s);

    if (gGameMode <= 1) {
      TransformSprite((struct Sprite *)s, psi);
    }
  } else {
    psi->rotation = 0;
    s->frameFlags &= ~0x3F;

    if (!(p->moveState & 1)) {
      s->frameFlags |= 0x400;
    } else {
      s->frameFlags &= ~0x400;
      s->x++;
    }

    if (gStageFlags & 0x80) {
      s->frameFlags |= 0x800;
    } else {
      s->frameFlags &= ~0x800;
    }

    if (UpdateSpriteAnimation((struct Sprite *)s) == 0) {
      s8 old = p->unk40;

      if ((s8)p->unk40 == 7) {
        p->unk40 = 6;
      } else if ((s8)p->unk40 == 3) {
        if (p->speedGroundX != 0) {
          p->unk40 = 4;
        } else {
          p->unk40 = 0;
        }
      } else if ((s8)p->unk40 == 11) {
        p->unk40 = 0;
      } else if ((s8)p->unk40 == 22) {
        p->unk40 = 4;
      } else if ((s8)p->unk40 == 17) {
        p->unk40 = 19;
      } else if ((s8)p->unk40 == 18) {
        p->unk40 = 19;
      } else if ((s8)p->unk40 == 27) {
        p->unk40 = 4;
      } else if ((s8)p->unk40 == 74) {
        if (p->moveState & 1) {
          p->x -= (p->unkE + 3) << 8;
        } else {
          p->x += (p->unkE + 3) << 8;
        }
        p->unkE = 6;
        p->unkF = 14;

        if (gStageFlags & 0x80) {
          p->y += p->unkF << 8;
        } else {
          p->y -= 14 << 8;
        }

        p->unk40 = 75;
        p->unk3E++;
      } else if ((s8)p->unk40 == 75) {
        p->unk14 = 0;
        sa2__sub_8021BE0(p);
      } else if ((s8)p->unk40 == 45 || (s8)p->unk40 == 48) {
        p->moveState &= ~0x20;
        p->moveState &= ~0x100;
        p->moveState &= ~0x400;
        p->unk3D = 0;
        p->unk3E = 0;
        p->unk3F = 0;
        p->moveState &= ~0x8000;

        if (p->character == 1) {
          m4aSongNumStop(120);
        }
        if (p->character == 3) {
          p->moveState &= ~0x6000000;
        }

        if (p->speedGroundX != 0) {
          p->unk40 = 4;
        } else {
          p->unk40 = 0;
        }
      } else if ((s8)p->unk40 == 46) {
        if ((s8)p->unk3F == 1) {
          if (p->moveState & 1) {
            p->speedGroundX = -0x400;
          } else {
            p->speedGroundX = 0x400;
          }
          p->unk3E++;
          p->unk3F = 0;
          p->unk40 = 47;
          m4aSongNumStart(111);
        } else if ((s8)p->unk3F == 2) {
          p->moveState &= ~0x20;
          p->moveState &= ~0x100;
          p->moveState &= ~0x400;
          p->unk3D = 0;
          p->unk3E = 0;
          p->unk3F = 0;
          p->moveState &= ~0x8000;

          if (p->character == 1) {
            m4aSongNumStop(120);
          }
          if (p->character == 3) {
            p->moveState &= ~0x6000000;
          }

          p->speedAirX = -p->speedAirX;
          p->speedAirY = -0x4E0;
          if (p->moveState & 0x40) {
            p->speedAirY = -0x2A0;
          }

          p->moveState |= 2;
          p->moveState |= 4;
          PlayerSetHeight(p, 9);
          p->unkE = 6;
          p->unkF = 9;
          p->unk40 = 49;
          m4aSongNumStart(116);
        } else {
          p->unk3E = 0;
          p->unk3F = 0;
          p->unk40 = 0;
          p->unk58 = 0;
          p->speedGroundX = 0;
        }
      } else if ((s8)p->unk40 == 54) {
        p->unk40 = 53;
      } else if ((s8)p->unk40 == 58) {
        p->unk40 = 57;
      } else if ((s8)p->unk40 == 60) {
        p->unk3E = 0;
        p->unk3F = 0;

        if (p->speedGroundX == 0) {
          p->unk40 = 0;
        } else {
          p->unk40 = 4;
        }
        p->unk58 = 0;
      } else if ((s8)p->unk40 == 64) {
        sa2__sub_8021BE0(p);
      } else if ((s8)p->unk40 == 70) {
        p->unk40 = 71;
      } else if ((s8)p->unk40 == 76 || (s8)p->unk40 == 77) {
        if ((s8)p->unk3F != 0) {
          s32 speedUp;

          p->unk3E++;
          p->unk3F = 0;

          if ((s8)p->unk40 == 77) {
            m4aSongNumStart(127);
          } else {
            m4aSongNumStart(126);
          }

          p->unk40++;

          speedUp = 0x300;
          if (p->moveState & 1) {
            speedUp = -speedUp;
          }
          p->speedGroundX += speedUp;
        } else {
          p->unk3E = 0;
          p->unk3F = 0;
          p->unk40 = 0;
          p->unk58 = 0;
          p->speedGroundX = 0;
        }
      } else if ((s8)p->unk40 == 87) {
        s32 speedUp;

        if ((s8)p->unk3F == 0) {
          p->unk3E = 0;

          if (p->speedGroundX != 0) {
            p->unk40 = 4;
          } else {
            p->unk40 = 0;
          }
        } else {
          p->unk3F = 0;
          p->unk3E++;
          p->unk40 = 88;

          speedUp = 0x300;
          if (p->moveState & 1) {
            speedUp = -speedUp;
          }
          p->speedGroundX += speedUp;

          CreateAmyAttackHeartEffect();
        }
      } else if ((s8)p->unk40 == 88) {
        p->unk3E = 0;

        if (p->speedGroundX != 0) {
          p->unk40 = 4;
        } else {
          p->unk40 = 0;
        }
      } else if ((s8)p->unk40 == 93) {
        p->unk3E = 0;
        p->unk3F = 0;
        p->unk40 = 0;
        p->unk58 = 0;
      }

      if ((s8)p->unk40 != old) {
        sa2__sub_802486C(p, inPsi);
        goto top;
      }
    }
  }

  if (gGameMode <= 1) {
    if ((p->moveState & 0x80) || (!(p->moveState & 0x100000) && ((s16)p->unk1C == 0 || (gUnknown_03005120 & 2) == 0))) {
      DisplaySprite((struct Sprite *)s);
    }

    if (gGameMode <= 1) {
      return;
    }
  }

  send = (struct PlayerSpriteSio *)gMultiSioSend;
  mpp = TASK_DATA(gMultiplayerPlayerTasks[SPRITE_SIO_ID]);
  send->unk0 = 0x1000;
  send->x = (p->x >> 8) + p->unk50;
  send->y = p->y >> 8;
  send->unk6 = s->graphics.anim;
  send->unkA = p->itemEffect;

  if (gGameMode == 6) {
    send->unk6 |= gUnknown_03004FEC << 8;
  } else if (gGameMode == 4 || gGameMode == 5) {
    send->unk6 |= (mpp->unk5C & 0x70000) >> 4;
  }

  send->unkB = s->variant | (p->unkF << 3);
  send->unkC = s->animSpeed;
  send->unkD = psi->rotation >> 2;

  if (s->frameFlags & 0x20) {
    send->unk8 |= 1;
  } else {
    send->unk8 &= ~1;
  }

  if (!(p->moveState & 1)) {
    send->unk8 |= 2;
  } else {
    send->unk8 &= ~2;
  }

  if (gStageFlags & 0x80) {
    send->unk8 |= 8;
  } else {
    send->unk8 &= ~8;
  }

  if ((p->moveState & 0x80) || (mpp->unk5C & 1) || (s16)p->unk1C != 0) {
    send->unk8 |= 4;
  } else {
    send->unk8 &= ~4;
  }

  if (mpp->unk5C & 1) {
    send->unk8 |= 0x100;
  } else {
    send->unk8 &= ~0x100;
  }

  if (p->moveState & 0x100000) {
    send->unk8 |= 0x40;
  } else {
    send->unk8 &= ~0x40;
  }

  send->unk8 &= ~0x30;
  send->unk8 |= (gStagePlayer.bodySprite->s.frameFlags & 0x3000) >> 8;
  if (p->unk27 != 0) {
    send->unk8 |= 0x80;
  } else {
    send->unk8 &= ~0x80;
  }

  if (lost) {
    send->unk8 |= 0x800;
  } else {
    send->unk8 &= ~0x800;
  }

  mpp->unk64 = SPRITE_SIO_ID;
  if (gStagePlayer.moveState & 8) {
    u8 i;
    for (i = 0; i < 4; i++) {
      s32 id = SPRITE_SIO_ID;
      if (id != i) {
        struct PlayerSpriteOther *other;
        if (gMultiplayerPlayerTasks[i] == NULL) {
          break;
        }

        other = TASK_DATA(gMultiplayerPlayerTasks[i]);
        if (gStagePlayer.unk28 == (u32)&other->s) {
          mpp->unk64 = i;
        }
      }
    }
  }

  send->unk8 &= ~0x600;
  send->unk8 |= mpp->unk64 << 9;
}

/** sa2__sub_8024F74, 0x08046AC0: Tails's tails: where they're drawn, how fast they turn, and while he spins, which way
 *  they point. */
void sa2__sub_8024F74(struct StagePlayer *p, struct PlayerSpriteInfo *inPsi) {
  struct PlayerSpriteSio *recv;
  struct PlayerSprite2 *s = &inPsi->s;
  struct PlayerSpriteInfo *psi = inPsi;
  struct StageCamera *cam = &gStageCamera;
  s16 camX = cam->x;
  s16 camY = cam->y;

  if (gGameMode > 1) {
    s32 id = SPRITE_SIO_ID;
    recv = (struct PlayerSpriteSio *)&gMultiSioRecv[id * 5];
    psi->x = recv->x - camX;
    psi->y = recv->y - camY;
  } else {
    psi->x = (p->x >> 8) - camX;
    psi->y = (p->y >> 8) - camY;
  }

  s->animSpeed = 16;
  if (p->moveState & 0x40) {
    s->animSpeed = 8;
  }

  switch (p->character) {
    case 3:
    case 2:
    case 0:
      break;

    case 1: {
      s32 asx = p->speedAirX;
      s32 asy = p->speedAirY;
      u8 shift;

      if (asx != 0 || asy != 0) {
        shift = (ArcTan2(asx, asy) >> 8) + 64;
      } else {
        shift = (p->moveState & 1) ? 0xC0 : 0x40;
      }
      p->charState.tails.unk81 = shift;

      if ((s8)p->unk40 == 5) {
        s32 x, y;

        psi->rotation = shift << 2;
        s->frameFlags &= ~0x1F;
        s->frameFlags |= gOamMatrixIndex++ | 0x20;

        if (!(p->moveState & 1)) {
          psi->scaleX = -0x100;
        } else {
          psi->scaleX = 0x100;
        }
        if (gStageFlags & 0x80) {
          psi->scaleX = -psi->scaleX;
        }

        if (psi->scaleX < 0) {
          psi->x--;
        }

        if (gStageFlags & 0x80) {
          psi->scaleY = 0x100;
          psi->rotation = WRAP_ANGLE(WRAP_ANGLE(-0x100 - ((u16)psi->rotation + psi->scaleY)));
        } else {
          psi->scaleY = 0x100;
        }

        x = (psi->scaleX * (s16)p->unk54) >> 8;
        y = (psi->scaleY * (s16)p->unk56) >> 8;
        psi->scaleX = x;
        psi->scaleY = y;
        UpdateSpriteAnimation((struct Sprite *)s);
        TransformSprite((struct Sprite *)s, psi);

        if ((p->moveState & 0x80) || (!(p->moveState & 0x100000) && ((s16)p->unk1C == 0 || (gUnknown_03005120 & 2) == 0))) {
          DisplaySprite((struct Sprite *)s);
        }
      }
      break;
    }
  }
}
