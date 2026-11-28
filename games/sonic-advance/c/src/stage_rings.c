// The rings manager's task each frame: the rings the players touch, and every ring on the screen drawn, in C.
#include "stage_init.h"

int Div(int num, int denom);
struct OamData *OamMalloc(u8 order);
extern struct OamData *iwram_end;
void CreateCollectRingEffect(s16 x, s16 y);
void CreateMagneticRing(s16 x, s16 y);
extern const u16 gPlayerCharacterIdleAnims[];

/** Where a ring sits in its region of the map, in tiles of 8 pixels from the region's corner. An x of 0xFF ends a
 *  region's list, and 0xFE is a ring already collected. */
struct RingPlace {
  /* 0x00 */ u8 x;
  /* 0x01 */ u8 y;
} __attribute__((packed));

#define RING_LIST_END 0xFF
#define RING_COLLECTED 0xFE

/** The box a player touches rings with, around its place. */
struct RingBox {
  /* 0x00 */ s8 left;
  /* 0x01 */ s8 top;
  /* 0x02 */ s8 right;
  /* 0x03 */ s8 bottom;
};

/** What the rings manager reads of another player's task in multiplayer. */
struct RingsOtherPlayer {
  /* 0x00 */ struct Sprite s;
  /* 0x30 */ u8 filler30[0x20];
  /* 0x50 */ s16 x;
  /* 0x52 */ s16 y;
  /* 0x54 */ u16 flags;
  /* 0x56 */ u8 id;
};

#ifdef MATCHING
struct RingsSioBits {
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
#define RINGS_SIO_ID (((volatile struct RingsSioBits *)0x04000128)->id)
// the player or its partner, as the original picks it
#define RINGS_PLAYER(who) (&(((who) != 0) ? gStagePartner : gStagePlayer))
#else
#define RINGS_SIO_ID ((u32)((REG_READ16(REG_SIOCNT) >> 4) & 3))
#define RINGS_PLAYER(who) (((who) != 0) ? &gStagePartner : &gStagePlayer)
#endif

// the region of 256 pixels a box's edge is in, the edge `edge` pixels from `pos` and moved by `offset`
#define REGION_OF(pos, edge, offset)                                                                                  \
  ({                                                                                                                 \
    s32 place = (pos);                                                                                               \
    s32 toEdge = (edge);                                                                                             \
    (place + toEdge + (offset)) >> 8;                                                                                \
  })
// the first word of a region's list of rings, in the table of regions that follows the map's two counts
#define RING_LIST(rings, across, regionX, regionY) (*(u32 *)((u8 *)(rings) + ((across) * (regionY)) * 4 + (regionX) * 4))
// a box at x, y touching a ring at ringX, ringY, the ring 16 pixels wide and 16 tall from its foot
#define BOX_TOUCHES_RING(x, y, ringX, ringY, box)                                                                     \
  ((((ringX) - 8 <= (x) + (box)->left && (ringX) + 8 >= (x) + (box)->left)                                           \
    || ((ringX) - 8 >= (x) + (box)->left && (x) + (box)->left + ((box)->right - (box)->left) >= (ringX) - 8))        \
   && ((((ringY) - 16 <= (y) + (box)->top && (ringY) >= (y) + (box)->top)                                            \
        || ((ringY) - 16 >= (y) + (box)->top && (y) + (box)->top + ((box)->bottom - (box)->top) >= (ringY) - 16))))

/** Task_RingsManager, 0x08007E3C to 0x08008744: the rings the player and its partner touch are collected, and those
 *  other players touch in multiplayer, then every ring on the screen is drawn, the first as the ring sprite and the
 *  rest as copies of its entry in the sprites' list, or pulled in by the magnetic shield. */
void Task_RingsManager(void) {
  struct RingsManager *mgr;
  u16 regionX, regionY;
  u32 across, down;
  u32 *rings;
  struct Sprite *s;
  u8 drawn = 0;
  s16 ringX, ringY;
  const struct SpriteDimensions *dims;
  struct RingPlace *ring;
  s8 box[4] = { -gStagePlayer.unkE, -gStagePlayer.unkF, gStagePlayer.unkE, gStagePlayer.unkF };
  s32 who = 0;

  if (gStageFlags & 2) return;

  {
    struct StagePlayer *p;

    rings = *(u32 **)((u8 *)TASK_DATA(gCurTask) + 0x30);
    mgr = TASK_DATA(gCurTask);
    s = &mgr->s;
    UpdateSpriteAnimation(s);

    dims = s->dimensions;
    rings++;
    across = (u16)*rings++;
    down = (u16)*rings++;

    do {
      p = RINGS_PLAYER(who);

      for (regionY = REGION_OF(p->y >> 8, box[1], 0); regionY <= REGION_OF(p->y >> 8, box[3], -16) && regionY < down;
           regionY++) {
        for (regionX = REGION_OF(p->x >> 8, box[0], -8);
             regionX <= REGION_OF(p->x >> 8, box[2], -8) && regionX < across; regionX++) {
          u32 offset = RING_LIST(rings, across, regionX, regionY);
          if (offset) {
            ring = (struct RingPlace *)((u8 *)rings - 8 + offset);

            while (ring->x != RING_LIST_END) {
              bool32 there = ring->x != RING_COLLECTED;
              if (there) {
                ringX = ring->x * 8 + regionX * 256;
                ringY = ring->y * 8 + regionY * 256;

                if (!(p->moveState & 0x80) && ((s8)p->unk40 != 15 || (s16)p->unk1C == 0)) {
                  if (BOX_TOUCHES_RING(p->x >> 8, p->y >> 8, ringX, ringY, (struct RingBox *)box)) {
                    u16 before = gUnknown_03004FEC;
                    gUnknown_03004FEC = before + 1;
                    // a hundred rings is a life, but on the Moon
                    if (gCurrentLevel != 13) {
                      s32 hundreds = Div(gUnknown_03004FEC, 100);
                      s32 hundredsBefore = Div(before, 100);
                      if (hundreds != hundredsBefore && gGameMode == 0) {
                        u16 lives = gUnknown_03005024 + 1;
                        gUnknown_03005024 = lives;
                        // the music manager plays the extra life's tune
                        gUnknown_03005040[3] = 0x10;
                      }
                    }

                    if (gGameMode == 6 && gUnknown_03004FEC > 255) {
                      gUnknown_03004FEC = 255;
                    }

                    CreateCollectRingEffect(ringX, ringY);
                    ring->x = RING_COLLECTED;
                  }
                }
              }
              ring++;
            }
          }
        }
      }
    } while (++who < (s8)gUnknown_03005088);

    if (gGameMode > 1) {
      u8 i;
      for (i = 0; i < 4; i++) {
        s32 id = RINGS_SIO_ID;
        if (i != id && gMultiplayerPlayerTasks[i] != NULL) {
          struct RingsOtherPlayer *other = TASK_DATA(gMultiplayerPlayerTasks[i]);

          for (regionY = REGION_OF(other->y, other->s.hitboxes[0].top, 0);
               regionY <= REGION_OF(other->y, other->s.hitboxes[0].bottom, -16) && regionY < down; regionY++) {
            for (regionX = REGION_OF(other->x, other->s.hitboxes[0].left, -8);
                 regionX <= REGION_OF(other->x, other->s.hitboxes[0].right, -8) && regionX < across; regionX++) {
              u32 offset = RING_LIST(rings, across, regionX, regionY);
              if (offset != 0) {
                ring = (struct RingPlace *)((u8 *)rings - 8 + offset);

                while (ring->x != RING_LIST_END) {
                  if (ring->x == RING_COLLECTED) {
                    ring++;
                    continue;
                  }

                  ringX = ring->x * 8 + regionX * 256;
                  ringY = ring->y * 8 + regionY * 256;
                  if (BOX_TOUCHES_RING(other->x, other->y, ringX, ringY,
                                       (struct RingBox *)&other->s.hitboxes[0].left)) {
                    u8 anim = other->s.graphics.anim;
                    u8 idle = gPlayerCharacterIdleAnims[(s8)gMultiplayerCharacters[other->id]];
                    u8 move = anim - idle;
                    // one hit or dying, and not able to collect, doesn't take it
                    if (!(move == 19 || move == 21) || !(other->flags & 4)) {
                      CreateCollectRingEffect(ringX, ringY);
                      ring->x = RING_COLLECTED;
                    }
                  }
                  ring++;
                }
              }
            }
          }
        }
      }
    }

    regionY = gStageCamera.y >> 8;
    if ((gStagePlayer.itemEffect & 8) && gGameMode != 6) {
      for (; regionY * 256 < gStageCamera.y + 160 && regionY < down; regionY++) {
        // an empty loop, which keeps the compiler from holding the camera's place for the whole loop, as the
        // original's code reads it again each time
        while (0)
          ;
        for (regionX = gStageCamera.x >> 8; regionX * 256 < gStageCamera.x + 240; regionX++) {
          u32 offset = RING_LIST(rings, across, regionX, regionY);

          if (regionX >= across) {
            break;
          }

          if (offset != 0) {
            ring = (struct RingPlace *)((u8 *)rings - 8 + offset);
            while (ring->x != RING_LIST_END) {
              if (ring->x == RING_COLLECTED) {
                ring++;
                continue;
              }

              ringX = ring->x * 8 + regionX * 256;
              ringY = ring->y * 8 + regionY * 256;
              if (ringX - gStageCamera.x < -8 || (ringX - gStageCamera.x) + 8 > 256 || ringY - gStageCamera.y < 0
                  || (ringY - gStageCamera.y) - 16 > 160) {
                ring++;
                continue;
              }

              // near enough to the player, the shield pulls it in
              if (ringX - 64 <= (gStagePlayer.x >> 8) && ringX + 64 >= (gStagePlayer.x >> 8)
                  && ringY - 72 <= (gStagePlayer.y >> 8) && ringY + 56 >= (gStagePlayer.y >> 8)) {
                CreateMagneticRing(ringX, ringY);
                ring->x = RING_COLLECTED;
                ring++;
              } else {
                ring++;

                if (drawn == 0 || s->oamBaseIndex == 0xFF) {
                  s->oamBaseIndex = 0xFF;
                  s->x = ringX - gStageCamera.x;
                  s->y = ringY - gStageCamera.y;
                  DisplaySprite(s);
                } else {
                  struct OamData *first = &gOamMallocBuffer[s->oamBaseIndex];
                  struct OamData *copy = OamMalloc((s->oamFlags & 0x7C0) >> 6);

                  if (iwram_end == copy) return;

                  DMA3_COPY16(first, copy, 6);
                  copy->attr1 &= 0xFE00;
                  copy->attr0 &= 0xFF00;
                  copy->attr0 += ((ringY - gStageCamera.y) - dims->offsetY) & 0xFF;
                  copy->attr1 += ((ringX - gStageCamera.x) - dims->offsetX) & 0x1FF;
                }

                drawn++;
              }
            }
          }
        }
      }
    } else {
      for (; regionY * 256 < gStageCamera.y + 160 && regionY < down; regionY++) {
        while (0)
          ;
        for (regionX = gStageCamera.x >> 8; regionX * 256 < gStageCamera.x + 240 && regionX < across; regionX++) {
          u32 offset = RING_LIST(rings, across, regionX, regionY);
          if (offset != 0) {
            ring = (struct RingPlace *)((u8 *)rings - 8 + offset);
            while (ring->x != RING_LIST_END) {
              if (ring->x == RING_COLLECTED) {
                ring++;
                continue;
              }

              ringX = ring->x * 8 + regionX * 256;
              ringY = ring->y * 8 + regionY * 256;

              if (ringX - gStageCamera.x < -8 || (ringX - gStageCamera.x) + 8 > 256 || ringY - gStageCamera.y < 0
                  || (ringY - gStageCamera.y) - 16 > 160) {
                ring++;
              } else {
                ring++;

                if (drawn == 0 || s->oamBaseIndex == 0xFF) {
                  s->oamBaseIndex = 0xFF;
                  s->x = ringX - gStageCamera.x;
                  s->y = ringY - gStageCamera.y;
                  DisplaySprite(s);
                } else {
                  struct OamData *first = &gOamMallocBuffer[s->oamBaseIndex];
                  struct OamData *copy = OamMalloc((s->oamFlags & 0x7C0) >> 6);

                  if (iwram_end == copy) return;

                  DMA3_COPY16(first, copy, 6);
                  copy->attr1 &= 0xFE00;
                  copy->attr0 &= 0xFF00;
                  copy->attr0 += ((ringY - gStageCamera.y) - dims->offsetY) & 0xFF;
                  copy->attr1 += ((ringX - gStageCamera.x) - dims->offsetX) & 0x1FF;
                }

                drawn++;
              }
            }
          }
        }
      }
    }
  }
}
