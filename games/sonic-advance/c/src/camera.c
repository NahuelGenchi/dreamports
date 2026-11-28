// The stage's camera in C: each frame it follows the player, draws the level's two map layers where it looks, and
// moves the stage's own background.
#include "stage_init.h"

s32 Mod(s32 num, s32 denom);
void UpdateBgAnimationTiles(struct Background *bg);
void UpdateCamera(void);
void RenderMetatileLayers(s32 x, s32 y);
void StageBgUpdate_Zone1Acts12(s32 x, s32 y);

extern u8 gOamMatrixIndex;

/** A player of another console on the link cable, as this one keeps it: where they are, and how far their sprite
 *  sits above their feet. */
struct CameraLinkPlayer {
  /* 0x00 */ u8 filler0[0x50];
  /* 0x50 */ s16 x;
  /* 0x52 */ s16 y;
  /* 0x54 */ u16 unk54;
  /* 0x56 */ u8 unk56;
  /* 0x57 */ u8 unk57;
  /* 0x58 */ s8 unk58[4];
};

#define CAMERA_CLAMP(value, min, max)                       \
  ({                                                        \
    s32 clamped;                                            \
    if ((value) < (min)) {                                  \
      clamped = (min);                                      \
    } else {                                                \
      clamped = (value) > (max) ? (max) : (value);          \
    }                                                       \
    clamped;                                                \
  })

/** Task_803F6CC, 0x0803F6CC: the camera's task, each frame of the stage: the camera's update, and the sprites'
 *  rotations counted from 4 again. */
void Task_803F6CC(void) {
  UpdateCamera();
  gOamMatrixIndex = 4;
}

/** UpdateCamera, 0x0803E3DC: the camera kept within the stage, then, unless it's held for some frames, the place it
 *  heads for: the player's, or on the link cable the player it watches, with the sprite's height eased in 5 pixels a
 *  frame (the other way up when the stage's gravity is). It moves there as fast as each way allows, past a margin
 *  that grows while the player is in the air, unless Knuckles glides, is kept within the stage, shaken, and draws the
 *  level's layers and the stage's background where it now looks. */
void UpdateCamera(void) {
  struct StagePlayer *player = &gStagePlayer;
  struct StageCamera *cam = &gStageCamera;
  s32 newX, newY;

  newX = cam->x;
  newY = cam->y;

  newX = CAMERA_CLAMP(newX, cam->minX, cam->maxX - 241);
  newY = CAMERA_CLAMP(newY, cam->minY, cam->maxY - 161);

  if (cam->unk1C != 0) {
    cam->unk1C--;
  } else {
    s32 unk38, temp;
    if (gGameMode > 1) {
      struct CameraLinkPlayer *mpp = TASK_DATA(gMultiplayerPlayerTasks[cam->unk3A]);

      if (!(cam->unk26 & 1)) {
        cam->unk8 = (mpp->x + cam->unkC) - 120;
      }

      if (!(cam->unk26 & 2)) {
        unk38 = cam->unk38;
        temp = mpp->unk58[0] - 4;
        if (gStageFlags & 0x80) {
          temp = -temp;
        }

        if (unk38 != temp) {
          if (unk38 < temp) {
            unk38 += 5;
            if (unk38 > temp) {
              unk38 = temp;
            }
          } else {
            unk38 -= 5;
            if (unk38 < temp) {
              unk38 = temp;
            }
          }
          cam->unk38 = unk38;
        }

        cam->unkA = (mpp->y + cam->unkE) - 80 + cam->unk22 + unk38;
      }
    } else {
      if (!(cam->unk26 & 1)) {
        cam->unk8 = (player->x >> 8) + cam->unkC - 120;
      }
      if (!(cam->unk26 & 2)) {
        unk38 = cam->unk38;
        temp = player->unkF - 4;
        if (gStageFlags & 0x80) {
          temp = -temp;
        }

        if (unk38 != temp) {
          if (unk38 < temp) {
            unk38 += 5;
            if (unk38 > temp) {
              unk38 = temp;
            }
          } else {
            unk38 -= 5;
            if (unk38 < temp) {
              unk38 = temp;
            }
          }
          cam->unk38 = unk38;
        }

        cam->unkA = (player->y >> 8) + cam->unkE - 80 + cam->unk22 + unk38;
      }
    }
  }

  if ((cam->unk8 - newX) > cam->unk1E) {
    s32 temp = cam->unk8 - newX - cam->unk1E;
    s32 temp2 = cam->shiftX;
    if (temp2 > temp) {
      temp2 = temp;
    }
    newX += temp2;
  } else if ((cam->unk8 - newX) < -cam->unk1E) {
    s32 temp = (cam->unk8 - newX) + cam->unk1E;
    s32 temp2 = -cam->shiftX;
    if (temp2 < temp) {
      temp2 = temp;
    }

    newX += temp2;
  }

  newX = CAMERA_CLAMP(newX, cam->minX, cam->maxX - 240);

  if ((player->moveState & 2) && (player->character != 2 || (s8)player->unk3D != 9)) {
    cam->unk20 += 4;
    cam->unk20 = cam->unk20 < 24 ? cam->unk20 : 24;
  } else {
    cam->unk20 -= 4;
    cam->unk20 = cam->unk20 > 0 ? cam->unk20 : 0;
  }

  if ((cam->unkA - newY) > cam->unk20) {
    newY += (cam->shiftY > ((cam->unkA - newY) - cam->unk20)) ? ((cam->unkA - newY) - cam->unk20) : cam->shiftY;
  } else if ((cam->unkA - newY) < -(cam->unk20)) {
    newY += (-cam->shiftY < (cam->unkA - newY) + cam->unk20) ? (cam->unkA - newY) + cam->unk20 : -cam->shiftY;
  }

  newY = CAMERA_CLAMP(newY, cam->minY, cam->maxY - 160);

  newX = CAMERA_CLAMP(newX, cam->minX, cam->maxX - 240);
  newY = CAMERA_CLAMP(newY, cam->minY, cam->maxY - 160);
  newX = newX + cam->unk34;
  newY = newY + cam->unk36;

  cam->x = newX;
  cam->y = newY;

  RenderMetatileLayers(newX, newY);

  if (cam->fn2C != NULL) {
    CALL(cam->fn2C)(newX, newY);
  }
}

/** RenderMetatileLayers, 0x0803E690: the level's two map layers, backgrounds 1 and 2, scrolled to where the camera
 *  looks and drawn, the first's tiles animated. In the Moon Zone (level 13), its one layer, background 2, scrolled
 *  on by the stage's clock and wrapped within the zone's width, past its first 72 pixels. */
void RenderMetatileLayers(s32 x, s32 y) {
  struct Background *layer;

  if (gCurrentLevel == 13) {
    s32 scrollX = (x + gUnknown_03005120 * 8);
    const s32 scrollMaxX = (28 * 96);

    if (scrollX - 72 >= scrollMaxX) {
      scrollX -= 72;
      scrollX = Mod(scrollX, scrollMaxX) + 72;
    }

    x = scrollX;
    if (gCurrentLevel == 13) {
      layer = &gStageBackgrounds[2];
      gBgScrollRegs[0][0] = x % 8u;
      gBgScrollRegs[0][1] = y % 8u;
      layer->scrollX = x;
      layer->scrollY = y;
      DrawBackground(layer);
      return;
    }
  }

  if (gCurrentLevel != 13) {
    layer = &gStageBackgrounds[1];
    gBgScrollRegs[1][0] = x % 8u;
    gBgScrollRegs[1][1] = y % 8u;
    layer->scrollX = x;
    layer->scrollY = y;
    DrawBackground(layer);
    UpdateBgAnimationTiles(layer);

    layer = &gStageBackgrounds[2];
    gBgScrollRegs[2][0] = x % 8u;
    gBgScrollRegs[2][1] = y % 8u;
    layer->scrollX = x;
    layer->scrollY = y;
    DrawBackground(layer);
  }
}

/** StageBgUpdate_Zone1Acts12, 0x0803E758: Neo Green Hill's background, background 3, drawn unscrolled, and each of
 *  its lines moved by the H-blank's copy: its three bands of clouds by the stage's clock, slower the lower they are,
 *  its big clouds and islands not at all, and its water by the camera, faster the lower the line. */
void StageBgUpdate_Zone1Acts12(s32 x, s32 y) {
  struct StageCamera *cam = &gStageCamera;
  struct Background *bg;
  u16 *offsets;
  s32 i;

  x -= cam->unk10;

  bg = &gStageBackgrounds[3];

  gBgScrollRegs[3][0] = cam->unk28 = 0;
  gBgScrollRegs[3][1] = cam->unk2A = 0;

  bg->scrollX = 0;
  bg->scrollY = 0;
  DrawBackground(bg);

  gFlags |= FLAGS_EXECUTE_HBLANK_COPY;
  gHBlankCopyTarget = (void *)0x0400001C;
  gHBlankCopySize = 4;

  offsets = gBgOffsetsHBlankPrimary;

  for (i = 0; i < 8; i++) {
    *offsets++ = (gUnknown_03005120 >> 4) & 0xFF;
    *offsets++ = 0;
  }

  for (i = 0; i < 16; i++) {
    *offsets++ = (gUnknown_03005120 >> 5) & 0xFF;
    *offsets++ = 0;
  }

  for (i = 24; i < 40; i++) {
    *offsets++ = (gUnknown_03005120 >> 6) & 0xFF;
    *offsets++ = 0;
#ifdef MATCHING
    asm("" ::"r"(i));
#endif
  }

  for (; i < 88; i++) {
    *offsets++ = 0;
    *offsets++ = 0;
  }

  for (; i < 160; i++) {
    *offsets++ = ((i - 86) * x) >> 8;
    *offsets++ = 0;
  }
}
