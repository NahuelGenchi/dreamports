// The rings a hit scatters, in normal gravity: their flight, their bounces, catching them again and drawing them, in C.
#include "stage_init.h"

int Div(int num, int denom);
int Mod(int num, int denom);
struct OamData *OamMalloc(u8 order);
extern struct OamData *iwram_end;
void CreateCollectRingEffect(s16 x, s16 y);
s32 sa2__sub_801EC3C(s32 y, s32 x, s32 layer);
s32 sa2__sub_801F100(s32 y, s32 x, s32 layer, s32 step, s32 (*func)(s32, s32, s32));

/** A hitbox's four sides, from the sprite's place, as its `left` begins them. */
struct HitboxSides {
  s8 left, top, right, bottom;
};

/** One of the scattered rings: where it is and how fast it goes, in 1/256 pixels, how long it has left, and its layer. */
struct ScatterRing {
  /* 0x00 */ s32 x;
  /* 0x04 */ s32 y;
  /* 0x08 */ s16 velX;
  /* 0x0A */ s16 velY;
  /* 0x0C */ u16 timer;
  /* 0x0E */ s16 layer;
};

/** The scattered rings' task: the ring sprite they share, the rings, how fast they fall, from when they can be caught
 *  again, and whether they bounce off the ceiling too. */
struct RingsScatterTask {
  /* 0x000 */ struct Sprite s;
  /* 0x030 */ struct ScatterRing rings[48];
  /* 0x330 */ s32 gravity;
  /* 0x334 */ u16 catchable;
  /* 0x336 */ u16 flags;
};

// a hitbox at x, y touching a ring at ringX, ringY, the ring 16 pixels wide and 16 tall from its foot
#define HITBOX_TOUCHES_RING(x, y, ringX, ringY, box)                                                                  \
  ((((ringX) - 8 <= (x) + (box)->left && (ringX) + 8 >= (x) + (box)->left)                                           \
    || ((ringX) - 8 >= (x) + (box)->left && (x) + (box)->left + ((box)->right - (box)->left) >= (ringX) - 8))        \
   && ((((ringY) - 16 <= (y) + (box)->top && (ringY) >= (y) + (box)->top)                                            \
        || ((ringY) - 16 >= (y) + (box)->top && (y) + (box)->top + ((box)->bottom - (box)->top) >= (ringY) - 16))))

/** A ring caught: one more ring, and in the story a life at each hundred, with its jingle. */
#define COLLECT_ONE_RING()                                                                                            \
  {                                                                                                                  \
    u16 before = gUnknown_03004FEC;                                                                                  \
    gUnknown_03004FEC = before + 1;                                                                                  \
    if (gCurrentLevel != 13) {                                                                                       \
      if (Div(gUnknown_03004FEC, 100) != Div(before, 100) && gGameMode == 0) {                                       \
        gUnknown_03005024++;                                                                                         \
        gUnknown_03005040[3] = 16;                                                                                   \
      }                                                                                                              \
    }                                                                                                                \
    if (gGameMode == 6 && gUnknown_03004FEC > 255) {                                                                 \
      gUnknown_03004FEC = 255;                                                                                       \
    }                                                                                                                \
  }

/** A ring a frame further on: where its floor is looked for, where it is and how high, in pixels. */
#define RING_MOVE(ring, floorX, ringX, ringY)                                                                         \
  do {                                                                                                               \
    (ring)->x += (ring)->velX;                                                                                       \
    (ring)->y += (ring)->velY;                                                                                       \
    (floorX) = (ring)->x >> 8;                                                                                       \
    (ringX) = (ring)->x >> 8;                                                                                        \
    (ringY) = (ring)->y >> 8;                                                                                        \
  } while (0)

/** PlayerCollisionHelperB, 0x08041154: the task of the rings a hit scatters, in normal gravity: each flies and falls,
 *  bounces on the floor and, when the task says so, on the ceiling, is caught again by the player or its partner, and is
 *  drawn, the first as the ring sprite and the rest as copies of it, blinking as its time runs out. */
void PlayerCollisionHelperB(void) {
  struct RingsScatterTask *rs = TASK_DATA(gCurTask);
  struct ScatterRing *ring = &rs->rings[0];
  struct Sprite *s = &rs->s;
  s32 gravity = rs->gravity;
  s32 catchable = rs->catchable;
  s32 drawn = 0;
  s32 i;
  struct StageCamera *camera = &gStageCamera;

  UpdateSpriteAnimation(s);

  for (i = 47; i >= 0; ring++, i--) {
    s32 ringX, ringY, floorX, screenX, screenY;
    struct StagePlayer *p;
    struct Hitbox *hb;

    if (ring->timer == 0) {
      continue;
    }

    RING_MOVE(ring, floorX, ringX, ringY);

    // the extra stage scrolls on its own, and its floor is a strip that repeats every 2,688 pixels
    if (gCurrentLevel == 13) {
      s32 along = floorX + gUnknown_03005120 * 8;
      if (along - 72 > 2687) {
        along -= 72;
        along = Mod(along, 2688) + 72;
      }
      floorX = along;
    }

    screenX = ringX - camera->x;
    screenY = ringY - camera->y;

    p = &gStagePlayer;
    hb = &p->bodySprite->s.hitboxes[0];
    if (ring->timer <= catchable && ((s8)p->unk40 != 15 || (s16)p->unk1C == 0) && (s8)p->unk40 != 40
        && !(p->moveState & 0x80)) {
      struct HitboxSides *sides = (struct HitboxSides *)&hb->left;

      if (HITBOX_TOUCHES_RING(p->x >> 8, p->y >> 8, ringX, ringY, sides)) {
        CreateCollectRingEffect(ringX, ringY);
        COLLECT_ONE_RING();
        ring->timer = 0;
        continue;
      }
    }

    if ((s8)gUnknown_03005088 == 2) {
      p = &gStagePartner;
      hb = &p->bodySprite->s.hitboxes[0];
      if (ring->timer <= catchable && ((s8)p->unk40 != 15 || (s16)p->unk1C == 0) && (s8)p->unk40 != 40
          && !(p->moveState & 0x80)) {
        struct HitboxSides *sides = (struct HitboxSides *)&hb->left;

        if (HITBOX_TOUCHES_RING(p->x >> 8, p->y >> 8, ringX, ringY, sides)) {
          CreateCollectRingEffect(ringX, ringY);
          COLLECT_ONE_RING();
          ring->timer = 0;
          continue;
        }
      }
    }

    if (ring->velY > 0) {
      s32 res = sa2__sub_801F100(ringY, floorX, ring->layer, 8, CODE(sa2__sub_801EC3C));
      if (res <= 0) {
        ring->y += res << 8;
        ring->velY = (ring->velY >> 2) - ring->velY;
      }
    }

    if ((rs->flags & 1) && ring->velY < 0) {
      s32 res = sa2__sub_801F100(ringY - 16, floorX, ring->layer, -8, CODE(sa2__sub_801EC3C));
      if (res <= 0) {
        ring->y -= res << 8;
        ring->velY = (ring->velY >> 2) - ring->velY;
      }
    }

    ring->velY += gravity;

    if (screenX + 8 > 0 && screenX + 8 < 256 && screenY > -8 && screenY < 168) {
      if (ring->timer > 31 || !(gUnknown_03005120 & 2)) {
        if (!drawn || s->oamBaseIndex == 0xFF) {
          s->oamBaseIndex = 0xFF;
          s->x = screenX;
          s->y = screenY;
          DisplaySprite(s);
          drawn = 1;
        } else {
          struct OamData *first = &gOamMallocBuffer[s->oamBaseIndex];
          struct OamData *copy = OamMalloc((s->oamFlags & 0x7C0) >> 6);

          if (iwram_end != copy) {
            DMA3_COPY16(first, copy, 6);
            copy->attr0 &= 0xFF00;
            copy->attr0 += (screenY - (u16)s->dimensions->offsetY) & 0xFF;
            copy->attr1 &= 0xFE00;
            copy->attr1 += (screenX - (u16)s->dimensions->offsetX) & 0x1FF;
          }
        }
      }
    }

    ring->timer--;
  }
}

/** sa2__sub_801F100, 0x080401E8: how far a point is from the ground the tile under it has, by its height there as
 *  `func` gives it, looking down (`step` above 0) or up: past a tile with no ground, to the next, and a full one, out. */
s32 sa2__sub_801F100(s32 y, s32 x, s32 layer, s32 step, s32 (*func)(s32, s32, s32)) {
  s32 result;
  s32 height = CALL(func)(y, x, layer);

  if (height == 0) {
    if (step > 0) {
      result = 8 - (y % 8u);
    } else {
      result = (y % 8u) + 1;
    }
  } else if (height == 8) {
    if (step > 0) {
      result = ~(y % 8u);
    } else {
      result = -8 | y;
    }
  } else if (height > 0) {
    height--;
    result = height - (y % 8u);
  } else {
    result = height + (y % 8u);
  }
  return result;
}

/** sa2__sub_801EC3C, 0x0803FD28: how high the ground is in the column of the tile at a place, with the tile flipped as its
 *  metatile says, and the platforms one passes through left out when asked: GetTileHeightAndRotation's height alone. */
s32 sa2__sub_801EC3C(s32 y, s32 x, s32 layer) {
  u32 tile, index;
  s32 column, height;

  x = (x < 0) ? 0 : ((x > gRefCollision->pxWidth - 1) ? gRefCollision->pxWidth - 1 : x);
  y = (y < 0) ? 0 : ((y > gRefCollision->pxHeight - 1) ? gRefCollision->pxHeight - 1 : y);

  tile = GetMetatileId(x, y, layer & 1);
  index = tile & 0x3FF;
  column = x & 7;
  if (tile & 0x400) {
    column = 7 - column;
  }

  // each column's height is the top half of a signed byte
  height = ((const s8 *)gRefCollision->heightMap)[(index << 3) + column];
  if ((height >>= 4) == -8) {
    height = 8;
  }

  if (layer & 0x80) {
    if ((gRefCollision->flags[index >> 3] >> ((index & 7) * 2)) & 1) {
      height = 0;
    }
  }

  // upside down, a column's ground hangs from the tile's top
  if (tile & 0x800) {
    s32 flipped;
    if (height != 8 && height != 0) {
      flipped = height + 8;
      flipped = (height > 0) ? height - 8 : flipped;
    } else {
      flipped = height;
    }
    height = flipped;
  }
  return height;
}

/** The sparkle a caught ring leaves: its sprite, and which side its jingle plays on. */
struct CollectRingEffect {
  /* 0x00 */ struct Sprite s;
  /* 0x30 */ u8 panLeft;
  /* 0x31 */ u8 unk31;
};

struct MP2KPlayerState;
struct MP2KSongHeader;
void MPlayStart(struct MP2KPlayerState *mplayInfo, struct MP2KSongHeader *songHeader);
void m4aMPlayImmInit(struct MP2KPlayerState *mplayInfo);
void m4aMPlayVolumeControl(struct MP2KPlayerState *mplayInfo, u16 trackBits, u16 volume);
void m4aMPlayPanpotControl(struct MP2KPlayerState *mplayInfo, u16 trackBits, s8 pan);
void Task_CollectRingEffect(void);

// how many sparkles are showing, the two sound players for effects, and the ring's jingle
extern u8 gUnknown_03004FFC;
extern struct MP2KPlayerState gUnknown_02002580;
extern struct MP2KPlayerState gUnknown_020025C0;
extern struct MP2KSongHeader gUnknown_087B66AC;

/** CreateCollectRingEffect, 0x0801E43C: a caught ring's sparkle where it was, up to eight at once, and its jingle, on the
 *  left for every other ring and on the right for the rest. */
void CreateCollectRingEffect(s16 x, s16 y) {
  if (gUnknown_03004FFC <= 7) {
    struct Task *t = TaskCreate(CODE(Task_CollectRingEffect), sizeof(struct CollectRingEffect), 0x2000, 0, NULL);
    struct CollectRingEffect *re = TASK_DATA(t);
    struct Sprite *s = &re->s;

    re->unk31 = 0;
    s->x = x;
    s->y = y;
    s->graphics.dest = (void *)0x06011F00;
    s->oamFlags = 0x3C0;
    s->graphics.size = 0;
    s->graphics.anim = 708;
    s->variant = 0;
    s->animCursor = 0;
    s->qAnimDelay = 0;
    s->prevVariant = 0xFF;
    s->animSpeed = 16;
    s->palId = 0;
    s->frameFlags = 0x2000;

    re->panLeft = gUnknown_03004FEC & 1;
    if (re->panLeft) {
      MPlayStart(&gUnknown_020025C0, &gUnknown_087B66AC);
      m4aMPlayImmInit(&gUnknown_020025C0);
      m4aMPlayVolumeControl(&gUnknown_020025C0, 0xFFFF, 128);
      m4aMPlayPanpotControl(&gUnknown_020025C0, 0xFFFF, -64);
    } else {
      MPlayStart(&gUnknown_02002580, &gUnknown_087B66AC);
      m4aMPlayImmInit(&gUnknown_02002580);
      m4aMPlayVolumeControl(&gUnknown_02002580, 0xFFFF, 128);
      m4aMPlayPanpotControl(&gUnknown_02002580, 0xFFFF, 64);
    }
    gUnknown_03004FFC++;
  }
}
