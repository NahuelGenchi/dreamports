// The act's static objects: the entities manager that spawns them (rom/entities.js and engine/objects.js
// createEntities, SAT-R's src/game/shared/stage/entities_manager.c) and each object the Neo Green Hill acts use,
// translated from the JavaScript version's engine/springs.js, spikes.js, platforms.js, boulders.js, boosters.js,
// checkpoints.js, itembox.js, items.js, goal.js, ramps.js, halfpipes.js, grindrails.js and slides.js. The objects
// run before Sonic, so they test where he was at the end of the last frame.

#include "act.h"
#include "actenemies.h"

#define OBJ_REGION 256
#define OBJ_GRID_MAX 0x8000
#define OBJ_REGIONS_MAX 1024
#define OBJ_INTERACTABLES_MAX 512
#define OBJ_ITEMBOXES_MAX 128
#define OBJ_LIVE_MAX 24
#define OBJ_SLOT_COUNT 12        // 12 objects' graphics at once: the act card keeps 196 of the heap's 624 tiles
#define OBJ_SLOT_TILES 32
#define OBJ_DEBRIS_COUNT 4
#define OBJ_DEBRIS_TILES 8
#define OBJ_SCREEN_W 240
#define OBJ_SCREEN_H 160
#define OBJ_Q8 256.0
#define OBJ_HOP_SPEED (-256)     // the item box's hop, in 1/256 px a frame
#define OBJ_HOP_GRAVITY 40
#define OBJ_ITEM_TIME 1200       // invincibility and speed shoes last 20 seconds
#define OBJ_HALF_PIPE_WIDTH 0x2A0
#define OBJ_HALF_PIPE_MIN_SPEED 0x240
#define OBJ_HALF_PIPE_STEP 0x600

// the player's states as act.c numbers them (its enum is private, so the same numbers are named here)
enum {
  OBJ_PS_IDLE, OBJ_PS_WALK, OBJ_PS_TURN, OBJ_PS_BRAKE, OBJ_PS_CROUCH, OBJ_PS_LOOKUP, OBJ_PS_SPIN, OBJ_PS_HURT,
  OBJ_PS_DEAD, OBJ_PS_PUSH, OBJ_PS_CROUCH_END, OBJ_PS_LOOKUP_END, OBJ_PS_BOUNCE, OBJ_PS_INSTA,
  OBJ_PS_SPRING, OBJ_PS_SPRING_RISE, OBJ_PS_SPRING_PEAK, OBJ_PS_SPRING_FALL, OBJ_PS_POLE, OBJ_PS_SPIN_DASH, OBJ_PS_SPIN_DASH_REV, OBJ_PS_ACT_CLEAR_RUN,
  OBJ_PS_HALF_PIPE_LOW, OBJ_PS_HALF_PIPE_MID, OBJ_PS_HALF_PIPE_HIGH,
};
// what a collision test found, as the original's result bits (engine/collide.js)
enum {
  OBJ_HIT_LANDED = 0x8, OBJ_HIT_BELOW = 0x10000, OBJ_HIT_LEFT = 0x20000, OBJ_HIT_RIGHT = 0x40000,
  OBJ_HIT_PUSH = 0x20,
};
enum { OBJ_ENTITY_INTERACTABLE, OBJ_ENTITY_ITEMBOX };

typedef struct { int l, t, r, b; } ObjBox;

/** One row of an act's interactable or item box grid: x and y in pixels, kind and its four data bytes. */
typedef struct {
  int x, y, region;
  uint8_t kind, d0, d1, d2, d3;
  int live;                  // its ObjLive's place, or -1
  uint8_t gone;              // a broken box or boulder, or a goal that never shows
} ObjEntity;

/** A live object, with the sprites it draws itself and the state its kind keeps. */
typedef struct {
  int active, fresh, noDraw, hasSprite, hasIcon;
  int type, index, kind;
  int slot, slot2;
  Sprite sprite, icon;
  int x, y;                  // where its sprite is in the act this frame
  int phase, timer, n, dy, vy;
  int launching, sag, q, held, hopping, wobbling, wobble;
} ObjLive;

/** A boulder's four pieces (Task_DecorationDebrisMain). */
typedef struct {
  int active, n, vy, scale, angle, qy, sx, sy, cx, cy, across, turn, size;
  Sprite sprite;
} ObjDebris;

typedef struct {
  int loaded, level, regionsX, regionsY, width, height;
  int interactableCount, itemBoxCount;
  ObjEntity interactables[OBJ_INTERACTABLES_MAX];
  ObjEntity itemBoxes[OBJ_ITEMBOXES_MAX];
  int intStart[OBJ_REGIONS_MAX], intN[OBJ_REGIONS_MAX];
  int boxStart[OBJ_REGIONS_MAX], boxN[OBJ_REGIONS_MAX];
  ObjLive live[OBJ_LIVE_MAX];
  int slotUsed[OBJ_SLOT_COUNT];
  uint32_t slotBase;
  uint32_t debrisBase;
  int vramAllocated;
  int prevX, prevY, hasPrev; // the camera the last scan saw (the entities manager's strip scan)
  void *standingOn;          // the object Sonic stands on (p.onObject)
  int hurtFrame;
  int shield, invincible, speedUp;
  int halfPipe, halfPipeFeet, grinding, goalReached;
  struct { int last, x, y, courseTime, valid; } checkpoint;
} ObjState;

static ObjState objects;
static ObjDebris debris[OBJ_DEBRIS_COUNT];
static uint8_t objGrid[OBJ_GRID_MAX];

// --- small helpers ------------------------------------------------------------------------------------------------
static int obj_floor(double v) { return (int)__builtin_floor(v); }
static int obj_clamp(int v, int lo, int hi) { return v < lo ? lo : v > hi ? hi : v; }
static int obj_round(double v) { return (int)__builtin_floor(v + 0.5); }

static ObjBox obj_box_of(int l, int t, int r, int b) {
  ObjBox box;
  box.l = l; box.t = t; box.r = r; box.b = b;
  return box;
}

static int obj_overlap(int x0, int y0, ObjBox a, int x1, int y1, ObjBox b) {
  int al = x0 + a.l, ar = x0 + a.r, at = y0 + a.t, ab = y0 + a.b;
  int bl = x1 + b.l, br = x1 + b.r, bt = y1 + b.t, bb = y1 + b.b;
  return al <= br && ar >= bl && at <= bb && ab >= bt;
}

// HB_COLLISION (rect.h): the boxes touch when an edge of either lies within the other. The original's tests use
// this, not a full overlap, and a break can come a frame earlier because of it.
static int obj_hb_touch(int x0, int y0, ObjBox a, int x1, int y1, ObjBox b) {
  int al = x0 + a.l, ar = x0 + a.r, at = y0 + a.t, ab = y0 + a.b;
  int bl = x1 + b.l, br = x1 + b.r, bt = y1 + b.t, bb = y1 + b.b;
  return ((al <= bl && ar >= bl) || (al >= bl && br >= al))
    && ((at <= bt && ab >= bt) || (at >= bt && bb >= at));
}

// Sonic's body and the wider, shorter box that finds the objects beside him (engine/collide.js)
static ObjBox obj_body(const Player *p) { return obj_box_of(-6, -p->offsetY, 6, p->offsetY); }
static ObjBox obj_flank(const Player *p) { return obj_box_of(-11, 1 - p->offsetY, 11, p->offsetY - 1); }

// the player's own shift of his centre when he stands up or curls, keeping his feet in place
static void obj_set_offset(Player *p, int soy) {
  int dlt = soy - p->offsetY;
  if (!dlt) return;
  int mode = (((p->rotation & 0xFF) + 0x20) & 0xC0) >> 6;
  if (mode == 0) p->y -= dlt;
  else if (mode == 1) p->x += dlt;
  else if (mode == 2) p->y += dlt;
  else p->x -= dlt;
  p->offsetY = soy;
}

static void obj_stand_up(Player *p) { p->curled = 0; obj_set_offset(p, 14); }

static void obj_land(Player *p) {
  p->air = 0; p->pushing = 0; p->state = OBJ_PS_WALK;
  if (p->curled) obj_stand_up(p);
  p->offsetY = 14;
  p->airLock = 0; p->chain = 0;
}

// Player_TransitionCancelFlyingAndBoost
static void obj_end_attack(Player *p) { p->midAir = 0; p->jumped = 0; p->spinDashing = 0; }

// thrown into the air by a spring or the incline ramp: no jump moves until he lands
static void obj_throw_up(Player *p) {
  objects.standingOn = NULL;
  p->air = 1;
  obj_end_attack(p);
  p->state = OBJ_PS_SPIN;   // the somersault, the nearest state act.c's player has
  obj_stand_up(p);
  p->airLock = 0;
  p->jumped = 0;
}

// --- the data (rom/entities.js) ------------------------------------------------------------------------------------
static int obj_rl_decompress(uint32_t at) {
  uint32_t header = rom_u32(at);
  if ((header & 0xFF) != 0x30) return 0;
  uint32_t size = header >> 8, n = 0;
  if (size > OBJ_GRID_MAX) size = OBJ_GRID_MAX;
  at += 4;
  while (n < size) {
    uint32_t flag = rom_u8(at++);
    if (flag & 0x80) {
      uint32_t b = rom_u8(at++);
      for (uint32_t k = (flag & 0x7F) + 3; k > 0 && n < size; k--) objGrid[n++] = (uint8_t)b;
    } else {
      for (uint32_t k = (flag & 0x7F) + 1; k > 0 && n < size; k--) objGrid[n++] = (uint8_t)rom_u8(at++);
    }
  }
  return (int)size;
}

static uint32_t obj_u32at(int at) {
  return (uint32_t)objGrid[at] | (uint32_t)objGrid[at + 1] << 8 | (uint32_t)objGrid[at + 2] << 16
    | (uint32_t)objGrid[at + 3] << 24;
}

/**
 * Reads one level's grid, as readEntities does: a 256 × 256 px region grid, each region's records `size` bytes
 * long { x, y, kind, d0..d3 } and ending with 0xFF. Fills `out`, and the region starts and counts for the
 * entities manager's order.
 */
static int obj_read_grid(uint32_t tableAt, int size, ObjEntity *out, int max, int *countOut,
  int *regionsXOut, int *regionsYOut, int *startOut, int *nOut) {
  int bytes = obj_rl_decompress(rom_ptr(tableAt));
  *countOut = 0;
  *regionsXOut = 0; *regionsYOut = 0;
  if (bytes < 12) return 0;
  int regionsX = (int)obj_u32at(4), regionsY = (int)obj_u32at(8);
  if (regionsX <= 0 || regionsY <= 0 || regionsX * regionsY > OBJ_REGIONS_MAX) return 0;
  *regionsXOut = regionsX; *regionsYOut = regionsY;
  memset(startOut, 0, sizeof(int) * OBJ_REGIONS_MAX);
  memset(nOut, 0, sizeof(int) * OBJ_REGIONS_MAX);
  int count = 0;
  for (int r = 0; r < regionsX * regionsY; r++) {
    if (12 + r * 4 + 4 > bytes) break;
    uint32_t offset = obj_u32at(12 + r * 4);
    startOut[r] = count;
    if (offset) {
      int rx = r % regionsX, ry = r / regionsX;
      int at = 4 + (int)offset;
      while (at + size <= bytes && at >= 0 && objGrid[at] != 0xFF && count < max) {
        ObjEntity *record = &out[count];
        memset(record, 0, sizeof *record);
        record->x = objGrid[at] * 8 + rx * OBJ_REGION;
        record->y = objGrid[at + 1] * 8 + ry * OBJ_REGION;
        record->kind = objGrid[at + 2];
        if (size == 7) {
          record->d0 = objGrid[at + 3]; record->d1 = objGrid[at + 4];
          record->d2 = objGrid[at + 5]; record->d3 = objGrid[at + 6];
        }
        record->region = r;
        record->live = -1;
        count++;
        at += size;
      }
    }
    nOut[r] = count - startOut[r];
  }
  *countOut = count;
  return 1;
}

// --- the sprites' VRAM and their animation setup --------------------------------------------------------------------
static int obj_take_slot(void) {
  if (objects.slotBase == HEAP_END) return -1;
  for (int i = 0; i < OBJ_SLOT_COUNT; i++) {
    if (!objects.slotUsed[i]) { objects.slotUsed[i] = 1; return i; }
  }
  return -1;
}

static void obj_give_slot(int slot) {
  if (slot >= 0 && slot < OBJ_SLOT_COUNT) objects.slotUsed[slot] = 0;
}

// the yellow up spring: palette 36 in sprite palette row 8, with palId 1 (spring.c)
static void obj_yellow_spring_palette(void) {
  for (int i = 0; i < 16; i++)
    e.objPalette[8 * 16 + i] = (uint16_t)rom_u16(sprites.palettes + 36u * 32u + (uint32_t)i * 2u);
  e.flags |= FLAGS_UPDATE_OBJ_PALETTES;
}

static void obj_sprite_begin(Sprite *s, int slot, uint32_t base, int tiles, int anim, int variant, int order,
  int prio, int flipX, int flipY, int palId) {
  sprite_init(s);
  if (slot >= 0) s->graphics.dest = base + (uint32_t)slot * (uint32_t)tiles * 32u;
  else s->graphics.dest = OBJ_VRAM;
  s->graphics.anim = (uint16_t)anim;
  s->variant = (uint8_t)variant;
  s->animSpeed = 0x10;
  s->palId = (uint8_t)palId;
  s->oamFlags = (uint16_t)(order << 6);
  s->frameFlags = (uint32_t)(prio << 12) | (flipX ? SPRITE_X_FLIP : 0) | (flipY ? SPRITE_Y_FLIP : 0);
  if (slot < 0) s->frameFlags |= SPRITE_KEEP_TILES | SPRITE_KEEP_PALETTE;
  if (palId) s->frameFlags |= SPRITE_KEEP_PALETTE;
  update_sprite(s, 0);
}

static void obj_restart_sprite(Sprite *s) {
  s->prevVariant = 0xFF;
  s->prevAnim = 0xFFFF;
  s->animCursor = 0;
  s->qAnimDelay = 0;
  s->graphics.size = 0;
  s->frameFlags &= ~SPRITE_ANIM_OVER;
}

// --- the hitboxes the animation scripts carry ----------------------------------------------------------------------
static int obj_sprite_box(Sprite *s, ObjBox *box) {
  if (s->hitboxes[0].index < 0) return 0;
  box->l = s->hitboxes[0].left; box->t = s->hitboxes[0].top;
  box->r = s->hitboxes[0].right; box->b = s->hitboxes[0].bottom;
  return 1;
}

static int obj_fallback_box(int kind, ObjBox *box) {
  switch (kind) {
    case 0: *box = obj_box_of(-16, -32, 16, 0); return 1;       // the goal signpost
    case 1: *box = obj_box_of(-16, -16, 16, 0); return 1;
    case 2: *box = obj_box_of(-16, 0, 16, 16); return 1;
    case 3: *box = obj_box_of(-16, -16, 0, 16); return 1;
    case 4: *box = obj_box_of(0, -16, 16, 16); return 1;
    case 6: *box = obj_box_of(-13, -24, 13, 4); return 1;       // an item box
    case 7: *box = obj_box_of(-7, -44, 8, 5); return 1;
    case 16: *box = obj_box_of(-16, -28, 16, -2); return 1;     // a boulder
    case 21: case 22: *box = obj_box_of(-24, -6, 24, -4); return 1;
    case 23: *box = obj_box_of(-20, -11, 20, 4); return 1;
    case 24: *box = obj_box_of(0, 3, 64, 23); return 1;
    case 25: *box = obj_box_of(-15, -5, 15, 11); return 1;
    case 31: *box = obj_box_of(-15, -6, 7, 0); return 1;
    case 32: case 33: *box = obj_box_of(-15, -9, 6, 2); return 1;
    default: return 0;
  }
}

// a booster's box is fixed, as booster.c gives it; every other object keeps its script's box
static int obj_box(ObjLive *l, ObjBox *box) {
  if (l->kind == 31) { *box = obj_box_of(-15, -6, 7, 0); return 1; }
  if (l->kind == 32 || l->kind == 33) { *box = obj_box_of(-15, -9, 6, 2); return 1; }
  if (l->hasSprite && obj_sprite_box(&l->sprite, box)) return 1;
  if (l->type == OBJ_ENTITY_ITEMBOX) { *box = obj_box_of(-13, -24, 13, 4); return 1; }
  return obj_fallback_box(l->kind, box);
}

// --- Sonic against an object (engine/collide.js) -------------------------------------------------------------------
static int obj_vertical(ObjLive *l, int ox, int oy, ObjBox hb, ObjBox rect, int stoodHere, int *flags) {
  Player *p = &act.player;
  int px = obj_floor(p->x), py = obj_floor(p->y);
  if (!obj_overlap(ox, oy, hb, px, py, rect)) return 0;
  double frac = p->y - py;
  int steep = !p->air && ((p->rotation + 0x20) & 0x40);
  int mid = oy + ((hb.t + hb.b) >> 1);
  if (py > mid) {
    p->y = (double)(oy + hb.b - rect.t) + frac;
    *flags |= OBJ_HIT_BELOW;
    if (p->ysp > 0) return 0;
    p->ysp = 0;
    if (steep) p->gsp = 0;
    return 1;
  }
  p->y = (double)(oy + hb.t - rect.b) + frac;
  if (p->ysp < 0) return 0;
  p->ysp = 0;
  if (steep) p->gsp = 0;
  objects.standingOn = l;
  p->air = 0;
  *flags |= OBJ_HIT_LANDED;
  if (!stoodHere) { obj_land(p); p->gsp = p->xsp; }
  p->rotation = 0;
  return 1;
}

static int obj_sideways(ObjLive *l, int ox, int oy, ObjBox hb, int *flags) {
  Player *p = &act.player;
  if (((p->rotation + 0x20) >> 6) & 1) return 0;   // not while he stands on a wall
  ObjBox rect = obj_flank(p);
  int px = obj_floor(p->x), py = obj_floor(p->y);
  if (!obj_overlap(ox, oy, hb, px, py, rect)) return 0;
  int leftX = ox + hb.l - rect.r;
  int rightX = ox + hb.r - rect.l + 1;
  int fromLeft = px <= ox + ((hb.l + hb.r) >> 1);
  if (fromLeft) {
    p->x = leftX;
    if (p->xsp < 0) return 0;
    *flags |= OBJ_HIT_LEFT;
  } else {
    p->x = rightX;
    if (p->xsp > 0) return 0;
    *flags |= OBJ_HIT_RIGHT;
  }
  if (p->air) { p->xsp = 0; return 1; }
  if (p->xsp == 0) return 1;
  *flags |= OBJ_HIT_PUSH;
  p->pushing = 1;
  p->facing = fromLeft ? 1 : -1;
  obj_stand_up(p);
  p->gsp = 0; p->xsp = 0;
  return 1;
}

// Coll_Player_Platform: solid from the top, from below and from the nearer side
static int obj_platform(ObjLive *l, int ox, int oy, ObjBox hb, int *flags) {
  Player *p = &act.player;
  *flags = 0;
  if (p->dead) return 0;
  int stoodHere = objects.standingOn == l;
  if (stoodHere) objects.standingOn = NULL;
  ObjBox body = obj_body(p);
  int done = 0;
  if (p->air || stoodHere) done = obj_vertical(l, ox, oy, hb, body, stoodHere, flags);
  if (!done) done = obj_sideways(l, ox, oy, hb, flags);
  if (!done) { body = obj_body(p); done = obj_vertical(l, ox, oy, hb, body, stoodHere, flags); }
  if (!done && stoodHere && objects.standingOn == NULL) { p->air = 1; p->pushing = 0; }
  return done;
}

// Coll_Player_PlatformCrumbling: only landing matters; he passes through it from below and the sides
static int obj_platform_top(ObjLive *l, int ox, int oy, ObjBox hb) {
  Player *p = &act.player;
  if (p->dead) return 0;
  int stoodHere = objects.standingOn == l;
  if (stoodHere) objects.standingOn = NULL;
  double lx = p->x - 6, rx = p->x + 6, ty = p->y - p->offsetY, by = p->y + p->offsetY;
  double ol = ox + hb.l, orr = ox + hb.r, ot = oy + hb.t, ob = oy + hb.b;
  if (ol <= rx && orr >= lx && ot <= by && ob >= ty && p->ysp >= 0) {
    int oy0 = p->offsetY;
    double frac = p->y - __builtin_floor(p->y);
    objects.standingOn = l;
    p->air = 0;
    if (!stoodHere) { obj_land(p); p->gsp = p->xsp; }
    p->rotation = 0;
    p->ysp = 0;
    p->y = (double)(oy + hb.t - oy0) + frac;
    return OBJ_HIT_LANDED;
  }
  if (stoodHere) p->air = 1;
  return 0;
}

// Coll_Player_Spring_Sideways: the top is a platform, and each side reports which face it is
static int obj_spring_side(ObjLive *l, ObjBox hb, int *flags) {
  Player *p = &act.player;
  *flags = 0;
  if (p->dead) return 0;
  int inAir = p->air, stoodHere = 0;
  if (objects.standingOn == l) { objects.standingOn = NULL; inAir = 1; stoodHere = 1; }
  ObjBox flank = obj_flank(p), body = obj_body(p);
  int px = obj_floor(p->x), py = obj_floor(p->y);
  if (inAir) {
    if (obj_overlap(l->x, l->y, hb, px, py, body)) {
      if (obj_vertical(l, l->x, l->y, hb, body, stoodHere, flags)) return *flags;
    } else if (obj_overlap(l->x, l->y, hb, px, py, flank)) {
      if (px <= l->x) {
        if (p->xsp >= 0) { p->xsp = 0; p->x = l->x + hb.l - flank.r; *flags |= OBJ_HIT_LEFT; }
      } else if (p->xsp <= 0) {
        p->xsp = 0; p->x = l->x + hb.r - flank.l + 1; *flags |= OBJ_HIT_RIGHT;
      }
    }
  }
  px = obj_floor(p->x); py = obj_floor(p->y);
  if (obj_overlap(l->x, l->y, hb, px, py, flank)) {
    if (px <= l->x) {
      if (p->xsp >= 0) {
        *flags |= OBJ_HIT_LEFT;
        if (p->xsp > 0) { *flags |= OBJ_HIT_PUSH; p->x = l->x + hb.l - flank.r; }
      }
    } else if (p->xsp <= 0) {
      *flags |= OBJ_HIT_RIGHT;
      if (p->xsp < 0) { *flags |= OBJ_HIT_PUSH; p->x = l->x + hb.r - flank.l + 1; }
    }
  }
  return *flags;
}

// sub_800C394: curled up and falling onto it, its side probe touching the box, or his attack box while he isn't
// curled, breaks it
static int obj_breaks(ObjLive *l, int ox, int oy, ObjBox hb) {
  Player *p = &act.player;
  if (p->dead) return 0;
  ObjBox probe = obj_box_of(-11, -(p->offsetY + 1), 11, p->offsetY + 1);
  int px = obj_floor(p->x), py = obj_floor(p->y);
  if (p->curled && p->ysp > 0 && obj_hb_touch(ox, oy, hb, px, py, probe)) {
    p->ysp = -p->ysp;
    return 1;
  }
  int al, at, ar, ab;
  if (!p->curled && act_player_attack_box(&al, &at, &ar, &ab)
    && obj_hb_touch(ox, oy, hb, px, py, obj_box_of(al, at, ar, ab))) {
    if (p->ysp > 0) p->ysp = -p->ysp;
    return 1;
  }
  return 0;
}

// --- getting hurt (Coll_DamagePlayer; engine/game.js's damage, docs/ROM.md "Getting hurt") -------------------------
static void obj_hurt(void) {
  Player *p = &act.player;
  if (p->dead || objects.invincible > 0 || p->invulnerable > 0) return;
  objects.hurtFrame = 1;
  objects.standingOn = NULL;
  int dir = p->gsp > 0 ? -1 : p->gsp < 0 ? 1 : p->facing > 0 ? -1 : 1;
  p->air = 1;
  p->state = OBJ_PS_HURT;
  obj_stand_up(p);
  p->airLock = 0;
  p->pushing = 0;
  p->ysp = -3.0;
  p->xsp = 1.5 * dir;
  if (objects.shield) {
    objects.shield = 0;
    p->invulnerable = 120;
    play_song(171);
    return;
  }
  if (act.ringCount > 0) {
    act.ringCount = 0;
    p->invulnerable = 120;
    play_song(118);
    play_song(171);
    return;
  }
  p->dead = 1;
  p->state = OBJ_PS_DEAD;
  p->invulnerable = 1;
  play_song(119);
  play_song(171);
}

void objects_hurt_player(void) { obj_hurt(); }

// INCREMENT_RINGS: passing a hundred gives a life
static void obj_add_rings(int n) {
  int before = act.ringCount;
  act.ringCount = (act.ringCount + n) & 0xFFFF;
  if (act.ringCount / 100 != before / 100 && act.lives < 255) act.lives++;
}

static int obj_icon_variant(int kind) {
  static const int ICON[8] = { 0, 4, 5, 6, 7, 8, 9, 10 };
  return kind >= 0 && kind < 8 ? ICON[kind] : 0;
}

// the item boxes' prizes (game.js prize())
static void obj_prize(int kind) {
  switch (kind) {
    case 0:
      if (act.lives < 255) act.lives++;
      play_song(307);
      break;
    case 1:
      objects.shield = 1;
      play_song(168);
      break;
    case 2:
      objects.shield = 2;
      play_song(168);
      break;
    case 3:
      objects.invincible = OBJ_ITEM_TIME;
      play_song(28);
      break;
    case 4:
      objects.speedUp = OBJ_ITEM_TIME;
      break;
    case 5: {
      static const int RANDOM_RING_PRIZES[6] = { 1, 5, 10, 20, 30, 40 };
      int pick = (int)(front_random() % 6u);
      obj_add_rings(RANDOM_RING_PRIZES[pick]);
      play_song(117);
      break;
    }
    case 6:
      obj_add_rings(5);
      play_song(117);
      break;
    case 7:
      obj_add_rings(10);
      play_song(117);
      break;
    default:
      break;
  }
}

// --- spawning an object -------------------------------------------------------------------------------------------
static ObjEntity *obj_entity_of(ObjLive *l) {
  if (l->type == OBJ_ENTITY_ITEMBOX) return &objects.itemBoxes[l->index];
  return &objects.interactables[l->index];
}

static int obj_next_live(void) {
  for (int i = 0; i < OBJ_LIVE_MAX; i++) if (!objects.live[i].active) return i;
  return -1;
}

static void obj_spawn_sprite(ObjLive *l, int anim, int variant, int order, int prio, int flipX, int flipY, int palId) {
  l->slot = obj_take_slot();
  l->hasSprite = 1;
  obj_sprite_begin(&l->sprite, l->slot, objects.slotBase, OBJ_SLOT_TILES, anim, variant, order, prio,
    flipX, flipY, palId);
}

static void obj_spawn_icon(ObjLive *l, int anim, int variant, int order, int prio, int flipX, int flipY) {
  l->slot2 = obj_take_slot();
  l->hasIcon = 1;
  obj_sprite_begin(&l->icon, l->slot2, objects.slotBase, OBJ_SLOT_TILES, anim, variant, order, prio,
    flipX, flipY, 0);
}

/** The spring's idle and launch variants (engine/springs.js LOOKS). */
static int obj_spring_idle_variant(int kind) {
  if (kind == 8 || kind == 9) return 0;
  if (kind == 10 || kind == 11) return 2;
  if (kind == 12 || kind == 13) return 4;
  return 6;
}

static int obj_spring_launch_variant(int kind) { return obj_spring_idle_variant(kind) + 1; }

/** d0 picks one of four speeds; above 3 the speed is d1 × 16 in 1/256 px (springs.js launchSpeed). */
static double obj_spring_speed(const ObjEntity *ent) {
  static const double SPEEDS[4] = { 7.5, 9.0, 10.5, 12.0 };
  int d0 = (int8_t)ent->d0;
  return d0 > 3 ? (double)((int)ent->d1 * 16) / OBJ_Q8 : SPEEDS[d0 & 3];
}

/**
 * Makes the live object for one entity, as the entities manager's spawn does, and sets up its idle animation. The
 * range check already passed. A goal that doesn't spawn, a defeated boulder and a broken box stay `gone`.
 */
static int obj_spawn(int type, int index, int x0, int x1, int y0, int y1) {
  ObjEntity *ent = type == OBJ_ENTITY_ITEMBOX ? &objects.itemBoxes[index] : &objects.interactables[index];
  if (ent->live >= 0 || ent->gone) return 0;
  if (ent->x < x0 || ent->x > x1 || ent->y < y0 || ent->y > y1) return 0;
  int k = obj_next_live();
  if (k < 0) return 0;
  ObjLive *l = &objects.live[k];
  memset(l, 0, sizeof *l);
  l->active = 1; l->fresh = 1; l->noDraw = 1;
  l->type = type; l->index = index; l->slot = -1; l->slot2 = -1;
  l->kind = type == OBJ_ENTITY_ITEMBOX ? -1 : ent->kind;
  l->x = ent->x; l->y = ent->y;
  ent->live = k;

  if (type == OBJ_ENTITY_ITEMBOX) {
    obj_spawn_sprite(l, 705, 0, 18, 2, 0, 0, 0);
    obj_spawn_icon(l, 706, obj_icon_variant(ent->kind), 19, 2, 0, 0);
    return 1;
  }

  switch (ent->kind) {
    case 0:   // Stage goal (goal.js createGoal): only those with d1 set spawn; d0 0 is one of the hidden column
      if (ent->d1 == 0) { ent->gone = 1; ent->live = -1; l->active = 0; return 0; }
      if (ent->d0 != 0) obj_spawn_sprite(l, 453, 0, 18, 2, 0, 0, 0);
      break;
    case 1:   // spikes up
    case 2:   // spikes down (the up spikes flipped)
      obj_spawn_sprite(l, 454, 2, 17, 2, 0, ent->kind == 2, 0);
      break;
    case 3:   // spikes left
    case 4:   // spikes right
      obj_spawn_sprite(l, 454, 3, 17, 2, ent->kind == 3, 0, 0);
      break;
    case 7: { // checkpoint (checkpoints.js createCheckpoint)
      int index_ = (int8_t)ent->d0;
      l->phase = index_ <= objects.checkpoint.last ? 2 : 0;
      obj_spawn_sprite(l, 452, l->phase == 2 ? 2 : 0, 18, 2, 0, 0, 0);
      break;
    }
    case 8: case 9: case 10: case 11: case 12: case 13: case 14: case 15: {   // springs
      int flipX = ent->kind == 10 || ent->kind == 12 || ent->kind == 14;
      int flipY = ent->kind == 9;
      int yellow = ent->kind == 8 && !(ent->d0 & 2);
      if (yellow) obj_yellow_spring_palette();
      obj_spawn_sprite(l, 455, obj_spring_idle_variant(ent->kind), 18, 2, flipX, flipY, yellow ? 1 : 0);
      break;
    }
    case 16:  // boulder
      obj_spawn_sprite(l, 458, 0, 18, 2, 0, 0, 0);
      break;
    case 21:  // thin platform
    case 22:  // falling platform (both use animation 463)
      obj_spawn_sprite(l, 463, 0, 18, 2, 0, 0, 0);
      break;
    case 23:  // trampoline
      obj_spawn_sprite(l, 461, 0, 18, 2, 0, 0, 0);
      break;
    case 24:  // crumbling platform
      obj_spawn_sprite(l, 904, 0, 18, 2, ent->d0 != 0, 0, 0);
      break;
    case 25:  // bounce block
      obj_spawn_sprite(l, 462, 0, 18, 2, 0, 0, 0);
      break;
    case 44: case 45:   // wall poles: animation 468, flipped when the bar points left
      obj_spawn_sprite(l, 468, 0, 18, 2, ent->kind == 45, 0, 0);
      l->phase = 0;
      break;
    case 27:  // waterfall: its splash follows Sonic while he is in its area
      obj_spawn_sprite(l, 464, 0, 5, 2, 0, 0, 0);
      l->noDraw = 1;
      break;
    case 26:  // incline ramp: no sprite
    case 17: case 18:   // layer toggles: no sprite
    case 19: case 20:   // grind rails: no sprite
    case 28: case 29:   // half-pipe: no sprite
      break;
    case 31:  // booster, flat
      obj_spawn_sprite(l, 471, 0, 18, 2, ent->d1 != 0, 0, 0);
      break;
    case 32:  // booster, slight slope up to the left
      obj_spawn_sprite(l, 471, 2, 18, 2, ent->d1 != 0, 0, 0);
      break;
    case 33:  // booster, slight slope up to the right
      obj_spawn_sprite(l, 471, 1, 18, 2, ent->d1 != 0, 0, 0);
      break;
    case 46:  // forced slide: its splash only shows while it holds Sonic
      obj_spawn_icon(l, 474, 0, 3, 2, ent->d0 != 0, 0);
      break;
    default:  // a kind this port doesn't build yet: a stand-in that leaves when its point does
      break;
  }
  return 1;
}

// --- springs (springs.js) -----------------------------------------------------------------------------------------
static int obj_update_spring(ObjLive *l, ObjEntity *ent) {
  Player *p = &act.player;
  ObjBox hb;
  int has = obj_box(l, &hb);
  double speed = obj_spring_speed(ent);
  int kind = ent->kind;
  int hit = 0;

  if (has && kind == 8) {
    // up (Task_Spring_Normal_Up): landing on it launches him straight up, keeping his X speed
    int flags;
    obj_platform(l, ent->x, ent->y, hb, &flags);
    if (flags & OBJ_HIT_LANDED) {
      obj_land(p);
      p->ysp = -speed;
      obj_throw_up(p);
      p->state = ent->d0 & 1 ? OBJ_PS_SPRING_RISE : OBJ_PS_SPRING;
      hit = 1;
    }
  } else if (has && kind == 9) {
    // down (Task_Spring_Normal_Down): bumping it from below throws him down as he is
    int flags;
    obj_platform(l, ent->x, ent->y, hb, &flags);
    if (flags & OBJ_HIT_BELOW) {
      p->air = 1; p->jumped = 0; p->midAir = 0;
      p->ysp = speed;
      hit = 1;
    } else if (flags & (OBJ_HIT_LANDED | OBJ_HIT_PUSH)) {
      obj_land(p);
    }
  } else if (has && (kind == 10 || kind == 11)) {
    // left and right (Task_Spring_Left / _Right): its face sends him running, its back is a wall
    int flags, face;
    obj_spring_side(l, hb, &flags);
    face = flags & OBJ_HIT_LEFT ? -1 : flags & OBJ_HIT_RIGHT ? 1 : 0;
    int dir = kind == 10 ? -1 : 1;
    if (face == dir) {
      p->xsp = p->gsp = speed * dir;
      obj_end_attack(p);
      p->state = p->curled ? OBJ_PS_SPIN : OBJ_PS_WALK;
      p->rotation = 0; p->facing = dir;
      hit = 1;
    } else if (face) {
      obj_land(p);
      if (flags & OBJ_HIT_PUSH) { p->pushing = 1; p->xsp = p->gsp = 0; obj_stand_up(p); }
    }
  } else if (has) {
    // diagonal (Task_Spring_Diagonal): its second hitbox is the trigger, once his centre is more than 20 px out
    // on the side it points to; otherwise it is solid
    int upLeft = kind == 12 || kind == 14;
    int px = obj_floor(p->x);
    ObjBox probe = obj_box_of(-12, -(p->offsetY + 1), 12, p->offsetY + 1);
    ObjBox triggerBox;
    int touched = 0;
    if (l->hasSprite && l->sprite.hitboxes[1].index >= 0) {
      triggerBox = obj_box_of(l->sprite.hitboxes[1].left, l->sprite.hitboxes[1].top,
        l->sprite.hitboxes[1].right, l->sprite.hitboxes[1].bottom);
      touched = obj_overlap(ent->x, ent->y, triggerBox, px, obj_floor(p->y), probe);
    }
    int trigger = touched && (upLeft ? px < ent->x - 20 : px > ent->x + 20);
    if (!trigger) {
      int flags;
      obj_platform(l, ent->x, ent->y, hb, &flags);
    } else {
      p->curled = 0; p->airLock = 0;
      int dir = upLeft ? -1 : 1;
      p->ysp = -speed;
      p->xsp = speed * dir;
      obj_throw_up(p);
      p->state = ent->d0 & 1 ? OBJ_PS_SPRING_RISE : OBJ_PS_SPRING;
      hit = 1;
    }
  }

  if (hit) play_song(170);
  if (l->launching) {
    if (hit && kind <= 11) obj_restart_sprite(&l->sprite);
    if (!update_sprite(&l->sprite, 0)) {
      l->launching = 0;
      l->sprite.variant = (uint8_t)obj_spring_idle_variant(kind);
      update_sprite(&l->sprite, 0);
    }
  } else if (hit) {
    l->launching = 1;
    l->sprite.variant = (uint8_t)obj_spring_launch_variant(kind);
  } else {
    update_sprite(&l->sprite, 0);
  }
  return 1;
}

// --- spikes (spikes.js) -------------------------------------------------------------------------------------------
static int obj_update_spikes(ObjLive *l, ObjEntity *ent) {
  Player *p = &act.player;
  ObjBox hb;
  if (obj_box(l, &hb)) {
    int flags;
    obj_platform(l, ent->x, ent->y, hb, &flags);
    if (ent->kind == 1) {
      if (flags & OBJ_HIT_LANDED) obj_hurt();
    } else if (ent->kind == 2) {
      if (flags & OBJ_HIT_BELOW) obj_hurt();
    } else if (!(flags & (OBJ_HIT_LANDED | OBJ_HIT_BELOW))) {
      if (flags & OBJ_HIT_LEFT) {
        if (ent->kind == 3) obj_hurt();
        else p->x = ent->x + hb.r + 12;   // its back puts him out past the other face
      } else if (flags & OBJ_HIT_RIGHT) {
        if (ent->kind == 4) obj_hurt();
        else p->x = ent->x + hb.l - 12;
      }
    }
  }
  update_sprite(&l->sprite, 0);
  return 1;
}

// --- the boulder and its pieces (boulders.js) ---------------------------------------------------------------------
static void obj_spawn_debris(ObjLive *l, ObjEntity *ent, int camX, int camY) {
  (void)l;
  static const int ACROSS[4] = { -2, 1, 2, -1 };
  static const int Y[4] = { 0, -16, 0, -16 };
  static const int TURN[4] = { -42, 42, 14, -14 };
  static const int SIZE[4] = { 8, 8, 16, 16 };
  for (int i = 0; i < OBJ_DEBRIS_COUNT; i++) {
    ObjDebris *d = &debris[i];
    memset(d, 0, sizeof *d);
    d->active = 1;
    d->vy = -512;
    d->scale = 256;
    d->sx = ent->x - camX;
    d->sy = ent->y - camY;
    d->cx = camX;
    d->cy = camY - 16;
    d->qy = d->cy + Y[i];
    d->across = ACROSS[i];
    d->turn = TURN[i];
    d->size = SIZE[i];
    sprite_init(&d->sprite);
    d->sprite.graphics.dest = objects.debrisBase == HEAP_END ? OBJ_VRAM
      : objects.debrisBase + (uint32_t)i * OBJ_DEBRIS_TILES * 32u;
    d->sprite.graphics.anim = (uint16_t)(i < 2 ? 459 : 460);
    d->sprite.variant = 0;
    d->sprite.animSpeed = 0x10;
    d->sprite.oamFlags = 8 << 6;
    d->sprite.frameFlags = SPRITE_ROT_SCALE_ENABLE | SPRITE_DOUBLE_SIZE | (uint32_t)(4 + i);   // matrices 4–7, as the original
    if (objects.debrisBase == HEAP_END) d->sprite.frameFlags |= SPRITE_KEEP_TILES | SPRITE_KEEP_PALETTE;
    update_sprite(&d->sprite, 0);
  }
}

static int obj_update_boulder(ObjLive *l, ObjEntity *ent, int camX, int camY) {
  Player *p = &act.player;
  ObjBox hb;
  if (obj_box(l, &hb)) {
    if (obj_breaks(l, ent->x, ent->y, hb)) {
      if (objects.standingOn == l) { objects.standingOn = NULL; p->air = 1; }
      play_song(167);
      en_add_dust(ent->x, ent->y, 0);
      obj_spawn_debris(l, ent, camX, camY);
      ent->gone = 1;
      return 0;
    }
    int flags;
    obj_platform(l, ent->x, ent->y, hb, &flags);
  }
  update_sprite(&l->sprite, 0);
  return 1;
}

// --- checkpoints (checkpoints.js) ---------------------------------------------------------------------------------
static int obj_update_checkpoint(ObjLive *l, ObjEntity *ent) {
  Player *p = &act.player;
  if (l->phase == 0) {
    ObjBox hb;
    if (obj_box(l, &hb)) {
      int x = obj_floor(p->x), y = obj_floor(p->y);
      if (x >= ent->x + hb.l && x <= ent->x + hb.r && y >= ent->y + hb.t && y <= ent->y + hb.b) {
        objects.checkpoint.last = (int8_t)ent->d0;
        objects.checkpoint.x = ent->x;
        objects.checkpoint.y = ent->y - p->offsetY;
        objects.checkpoint.courseTime = act.courseTime;
        objects.checkpoint.valid = 1;
        l->phase = 1;
        l->sprite.variant = 1;
        update_sprite(&l->sprite, 0);   // the spin's first frame shows on this one
        return 1;
      }
    }
    update_sprite(&l->sprite, 0);
    return 1;
  }
  if (l->phase == 1) {
    if (!update_sprite(&l->sprite, 0)) {
      l->phase = 2;
      l->sprite.variant = 2;
      update_sprite(&l->sprite, 0);
    }
    return 1;
  }
  update_sprite(&l->sprite, 0);
  return 1;
}

// --- the speed boosters (boosters.js) -----------------------------------------------------------------------------
static int obj_update_booster(ObjLive *l, ObjEntity *ent) {
  Player *p = &act.player;
  int dir = ent->d1 ? -1 : 1;
  ObjBox hb = ent->kind == 31 ? obj_box_of(-15, -6, 7, 0) : obj_box_of(-15, -9, 6, 2);
  ObjBox probe = obj_flank(p);
  int px = obj_floor(p->x), py = obj_floor(p->y);
  if (!p->dead && !p->air && obj_overlap(ent->x, ent->y, hb, px, py, probe)) {
    obj_end_attack(p);
    p->pushing = 0;
    play_song(172);
    if (p->state != OBJ_PS_SPIN) p->state = OBJ_PS_WALK;
    p->facing = dir;
    if (p->gsp * dir < 9.0) p->gsp = p->xsp = 12.0 * dir;
  }
  update_sprite(&l->sprite, 0);
  return 1;
}

// --- platforms (platforms.js) -------------------------------------------------------------------------------------
static void obj_sag_update(ObjLive *l) {
  if (objects.standingOn == l) l->sag = l->sag + 0x10 > 0x100 ? 0x100 : l->sag + 0x10;
  else l->sag = l->sag < 0x10 ? 0 : l->sag - 0x10;
}

static int obj_update_thin(ObjLive *l, ObjEntity *ent) {
  int across = ent->d2 > ent->d3;
  int reach = (across ? ent->d2 : ent->d3) << 11;
  int phase = (int8_t)(across ? ent->d0 : ent->d1) < 0 ? 0x80 : 0;
  int32_t product = (int32_t)((uint32_t)reach * (uint32_t)SINE[(4 * ((act.tick + phase) & 0xFF)) & 0x3FF]);
  int next = product >> 14;
  int moved = next - l->q;
  l->q = next;
  int x = ent->x + (across ? (l->q >> 8) : 0);
  int y = ent->y + (across ? 0 : (l->q >> 8));
  l->x = x; l->y = y;
  if (objects.standingOn == l) {
    if (across) act.player.x += moved / OBJ_Q8;
    act.player.y += 1.0 + (across ? 0.0 : moved / OBJ_Q8);
  }
  ObjBox hb;
  if (obj_box(l, &hb)) obj_platform_top(l, x, y, hb);
  obj_sag_update(l);
  update_sprite(&l->sprite, 0);
  return 1;
}

static int obj_update_falling(ObjLive *l, ObjEntity *ent) {
  Player *p = &act.player;
  ObjBox hb;
  int has = obj_box(l, &hb);
  if (l->phase == 0) {
    int landed = has ? obj_platform_top(l, ent->x, ent->y, hb) : 0;
    if (landed & OBJ_HIT_LANDED) { l->phase = 1; l->timer = 30; }
    l->x = ent->x; l->y = ent->y;
    obj_sag_update(l);
    update_sprite(&l->sprite, 0);
    return 1;
  }
  if (l->phase == 1) {
    if (--l->timer == 0) { l->phase = 2; l->n = 0; l->vy = 0; l->q = 0; }
    else if (has) obj_platform_top(l, ent->x, ent->y, hb);
    l->x = ent->x; l->y = ent->y;
    obj_sag_update(l);
    update_sprite(&l->sprite, 0);
    return 1;
  }
  l->vy += 42;
  l->q += l->vy;
  l->n++;
  int y = ent->y + (l->q >> 8);
  l->x = ent->x; l->y = y;
  if (objects.standingOn == l) {
    if (l->n > 32) {
      objects.standingOn = NULL;
      p->air = 1;
      p->ysp = (double)l->vy / OBJ_Q8;
    } else {
      p->y += (double)(l->vy + 256) / OBJ_Q8;
    }
  }
  if (l->n < 32 && has) obj_platform_top(l, ent->x, y, hb);
  obj_sag_update(l);
  update_sprite(&l->sprite, 0);
  return 1;
}

static int obj_update_crumbling(ObjLive *l, ObjEntity *ent) {
  Player *p = &act.player;
  ObjBox hb;
  int has = obj_box(l, &hb);
  if (l->phase == 0) {
    int landed = has ? obj_platform_top(l, ent->x, ent->y, hb) : 0;
    if (landed & OBJ_HIT_LANDED) { l->phase = 1; l->n = 0; }
    l->x = ent->x; l->y = ent->y;
    update_sprite(&l->sprite, 0);
    return 1;
  }
  if (l->phase == 1) {
    if (l->n++ > 30) { l->phase = 2; l->n = 0; play_song(173); }
    else if (has) obj_platform_top(l, ent->x, ent->y, hb);
    l->x = ent->x; l->y = ent->y;
    update_sprite(&l->sprite, 0);
    return 1;
  }
  if (l->phase == 2) {
    if (l->n < 32 && has) obj_platform_top(l, ent->x, ent->y, hb);
    l->n++;
    if (l->n >= 32) {
      if (objects.standingOn == l) { objects.standingOn = NULL; p->air = 1; }
      l->phase = 3;   // the tiles are falling; the whole platform is not drawn any more
    }
    l->x = ent->x; l->y = ent->y;
    update_sprite(&l->sprite, 0);
    return 1;
  }
  l->x = ent->x; l->y = ent->y;
  update_sprite(&l->sprite, 0);
  return 1;
}

static int obj_update_trampoline(ObjLive *l, ObjEntity *ent) {
  Player *p = &act.player;
  ObjBox hb;
  int hit = 0;
  if (obj_box(l, &hb)) {
    int flags;
    obj_platform(l, ent->x, ent->y, hb, &flags);
    if (flags & OBJ_HIT_LANDED) {
      int v = obj_round(p->ysp * OBJ_Q8);
      obj_end_attack(p);
      objects.standingOn = NULL;
      p->air = 1; p->curled = 0; obj_set_offset(p, 14);
      if (v == 0) p->y -= 8;
      double speed = (double)((v >> 5) - (v + (v >> 2))) / OBJ_Q8;
      if (speed < -2814.0 / OBJ_Q8) speed = -2814.0 / OBJ_Q8;
      if (speed > -960.0 / OBJ_Q8) speed = -960.0 / OBJ_Q8;
      p->ysp = speed;
      p->state = OBJ_PS_IDLE;   // rising uncurled; act.c has no spring-rise state of its own
      hit = 1;
    }
  }
  if (hit) { l->timer = 14; l->sprite.variant = 1; play_song(176); }
  else if (l->timer > 0) {
    if (--l->timer == 0) l->sprite.variant = 0;
  }
  l->x = ent->x; l->y = ent->y;
  update_sprite(&l->sprite, 0);
  return 1;
}

static int obj_update_bounce_block(ObjLive *l, ObjEntity *ent) {
  Player *p = &act.player;
  // the frame it is hit doesn't move or animate it: its first wobble frame shows on the next one
  int wasWobbling = l->wobbling;
  l->dy = wasWobbling ? SINE[l->wobble & 0x3FF] / 1024 : 0;
  ObjBox hb;
  int hit = 0;
  if (obj_box(l, &hb)) {
    int flags;
    obj_platform(l, ent->x, ent->y, hb, &flags);   // the wobble moves only the sprite
    if (!p->dead && (flags & OBJ_HIT_LANDED)) {
      obj_end_attack(p);
      objects.standingOn = NULL;
      p->air = 1; p->curled = 0;
      if (e.input & KEY_LEFT) p->facing = -1;
      else if (e.input & KEY_RIGHT) p->facing = 1;
      p->ysp = -5;
      p->state = OBJ_PS_BOUNCE;
      p->rotation = 0;
      obj_stand_up(p);
      hit = 1;
    }
  }
  if (hit) { l->wobbling = 1; l->wobble = 0; l->timer = 30; play_song(170); }
  if (wasWobbling) {
    l->wobble = (l->wobble + 90) & 0x3FF;
    if (--l->timer == 0) l->wobbling = 0;
    update_sprite(&l->sprite, 0);
  }
  l->x = ent->x; l->y = ent->y + l->dy;
  return 1;
}

// --- the item boxes (itembox.js) ----------------------------------------------------------------------------------
static void obj_break_box(ObjLive *l, ObjEntity *ent) {
  Player *p = &act.player;
  play_song(167);
  en_add_dust(ent->x, ent->y + l->dy, 0);
  if (objects.standingOn == l) { objects.standingOn = NULL; p->air = 1; p->pushing = 0; }
  if (p->air && p->ysp > 0) p->ysp = -p->ysp;
  l->phase = 1;
  l->n = 0;
  l->dy = 0;
  l->noDraw = 1;   // a broken box draws nothing on the frame it breaks
  ent->gone = 1;
}

static int obj_update_itembox(ObjLive *l, ObjEntity *ent) {
  Player *p = &act.player;
  if (l->phase == 1) {
    l->dy--;
    if (++l->n >= 60) { obj_prize(ent->kind); l->phase = 2; l->n = 0; }
    l->x = ent->x; l->y = ent->y + l->dy;
    update_sprite(&l->sprite, 0);
    update_sprite(&l->icon, 0);
    return 1;
  }
  if (l->phase == 2) {
    if (++l->n > 30) return 0;
    l->x = ent->x; l->y = ent->y + l->dy;
    update_sprite(&l->sprite, 0);
    update_sprite(&l->icon, 0);
    return 1;
  }
  if (l->hopping) {
    l->dy += l->vy >> 8;
    l->vy += OBJ_HOP_GRAVITY;
    if (l->vy > 0 && l->dy >= 0) { l->dy = 0; l->vy = 0; l->hopping = 0; }
  }
  l->x = ent->x; l->y = ent->y + l->dy;
  ObjBox hb;
  if (obj_box(l, &hb)) {
    int px = obj_floor(p->x), py = obj_floor(p->y);
    ObjBox body = obj_body(p);
    int mid = ent->y + l->dy + ((hb.t + hb.b) >> 1);
    // the ROM reads his attack box (slot 1) here; the decompiled C's body box breaks too much
    int al, at, ar, ab, attack = 0;
    if (act_player_attack_box(&al, &at, &ar, &ab)) {
      ObjBox abox = obj_box_of(al, at, ar, ab);
      attack = obj_overlap(ent->x, ent->y + l->dy, hb, px, py, abox);
    }
    int falling = attack && p->air && p->ysp > 0 && obj_overlap(ent->x, ent->y + l->dy, hb, px, py, body) && py <= mid;
    if (attack || falling) obj_break_box(l, ent);
    else {
      int flags;
      obj_platform(l, ent->x, ent->y + l->dy, hb, &flags);
      if (flags & OBJ_HIT_BELOW) { l->vy = OBJ_HOP_SPEED; l->hopping = 1; }
    }
  }
  update_sprite(&l->sprite, 0);
  update_sprite(&l->icon, 0);
  return 1;
}

// --- the goal signpost (goal.js) ----------------------------------------------------------------------------------
static int obj_update_goal(ObjLive *l, ObjEntity *ent) {
  Player *p = &act.player;
  if (l->phase == 0 && obj_floor(p->x) > ent->x) {
    if (!objects.goalReached) {
      objects.goalReached = 1;
      act.clockStopped = 1;
      play_song(135);
      l->phase = 1; l->timer = 0; l->q = 0;
    } else {
      l->phase = 2;
    }
    if (l->hasSprite) l->sprite.variant = 1;
  }
  if (l->phase == 1) {
    p->ignoreInput = 1;
    if (act.cam.shiftY > -56) act.cam.shiftY--;
    if (p->gsp > 4.5) p->gsp = 4.5;
    // Task_ShowResults waits for him to be on the ground at 2.25 px a frame or more
    if (l->timer > 30 && !l->q) l->q = 1;
    if (l->q == 1 && !p->air && p->gsp >= 2.25) { act_start_clear(); l->q = 2; }
    if (l->timer > 120 && p->state == OBJ_PS_ACT_CLEAR_RUN) { act_stage_results(); l->phase = 2; }
    l->timer++;
  }
  if (l->hasSprite) update_sprite(&l->sprite, 0);
  return 1;
}

// --- the layer toggles (toggle_player_layer.c) --------------------------------------------------------------------
static int obj_update_toggle(ObjLive *l, ObjEntity *ent) {
  (void)l;
  Player *p = &act.player;
  int w = ent->d2 * 8, h = ent->d3 * 8;
  int x = obj_floor(p->x), y = obj_floor(p->y);
  if (x >= ent->x && x <= ent->x + w && y >= ent->y && y <= ent->y + h)
    p->layer = ent->kind == 17 ? 0 : 1;
  return 1;
}

// --- the incline ramp (ramps.js) ----------------------------------------------------------------------------------
static int obj_update_ramp(ObjLive *l, ObjEntity *ent) {
  (void)l;
  Player *p = &act.player;
  int dir = ent->d0 ? 1 : -1;
  int w = ent->d2 * 8, h = ent->d3 * 8;
  int x = obj_floor(p->x), y = obj_floor(p->y);
  if (!p->dead && x >= ent->x && x <= ent->x + w && y >= ent->y && y <= ent->y + h && p->xsp * dir > 4.0) {
    objects.standingOn = NULL;
    p->air = 1;
    p->jumped = 0;
    obj_stand_up(p);
    p->ysp = -8.0;
    double fast = p->xsp * dir + 4.0;
    if (fast > 17.0) fast = 17.0;
    p->xsp = dir * fast;
    obj_end_attack(p);
    p->pushing = 0;
    p->airLock = 0;
    p->state = OBJ_PS_SPIN;
    play_song(170);
  }
  return 1;
}

// --- the half-pipe (halfpipes.js) ---------------------------------------------------------------------------------
static int obj_half_pipe_height(const Player *p, int along) {
  if ((unsigned)along > OBJ_HALF_PIPE_WIDTH - 1u) return 0;
  int v = (int16_t)obj_round(p->xsp * OBJ_Q8);
  if (v < 0) v = -v;
  v = (v - OBJ_HALF_PIPE_MIN_SPEED) / 4;   // ((speed - 2.25) << 14) >> 16, kept from overflowing
  if (v < 0) v = 0;
  if (v > 256) v = 256;
  int fast = SINE[v] >> 6;
  if (fast > 256) fast = 256;
  int k = along < OBJ_HALF_PIPE_WIDTH / 2 ? along : along - OBJ_HALF_PIPE_WIDTH;
  int turn = (int)(((uint32_t)(k * 32768 / 0x150) << 16) >> 22) + 256;
  return (((-SINE[turn] * 3) >> 2) + 0x3000) * fast >> 8;   // the table runs 1.25 turns, so 1024 to 1279 is past one
}

static int dbgAlong, dbgH, dbgFeet, dbgOff, dbgY, dbgD, dbgXsp;
static void obj_half_pipe_lift(Player *p, int along, int feet) {
  int h = obj_half_pipe_height(p, along);
  // his walk becomes one of three half-pipe states by the height (halfpipes.js lift)
  if (!p->curled && (p->state == OBJ_PS_WALK || p->state == OBJ_PS_HALF_PIPE_LOW || p->state == OBJ_PS_HALF_PIPE_MID || p->state == OBJ_PS_HALF_PIPE_HIGH)) {
    p->state = h < 0x800 ? OBJ_PS_WALK : h < 0x1800 ? OBJ_PS_HALF_PIPE_LOW : h < 0x3000 ? OBJ_PS_HALF_PIPE_MID : OBJ_PS_HALF_PIPE_HIGH;
  }
  p->halfPipe = 1;
  p->air = 0;
  p->ysp = 0;
  int y = obj_round(p->y * OBJ_Q8);
  int d = feet - h - (p->offsetY << 8) - y;
  dbgAlong = along; dbgH = h; dbgFeet = feet; dbgOff = p->offsetY; dbgY = y; dbgD = d; dbgXsp = obj_round(p->xsp * OBJ_Q8);
  if (d < -OBJ_HALF_PIPE_STEP) d = -OBJ_HALF_PIPE_STEP;
  if (d > OBJ_HALF_PIPE_STEP) d = OBJ_HALF_PIPE_STEP;
  p->y = (double)(y + d) / OBJ_Q8;
}

static int obj_update_half_pipe(ObjLive *l, ObjEntity *ent) {
  (void)l;
  Player *p = &act.player;
  int start = ent->kind == 28;
  int left = ent->x + (int8_t)ent->d0 * 8;
  int top = ent->y + (int8_t)ent->d1 * 8;
  int right = left + ent->d2 * 8, bottom = top + ent->d3 * 8;
  int x = obj_floor(p->x), y = obj_floor(p->y);
  if (x >= left && x < right && y >= top && y < bottom) {
    int faster = obj_round(p->xsp * OBJ_Q8) * (start ? 1 : -1) > OBJ_HALF_PIPE_MIN_SPEED;
    objects.halfPipe = faster && !p->air;
    p->halfPipe = objects.halfPipe;
    if (objects.halfPipe) objects.halfPipeFeet = obj_round(p->y * OBJ_Q8) + (p->offsetY << 8);
  } else if (objects.halfPipe && (start ? x >= right : x < left)) {
    if (!p->dead) {
      int v = obj_round(p->xsp * OBJ_Q8) + OBJ_HALF_PIPE_MIN_SPEED - 1;
      if ((v >= 0 && v < 2 * OBJ_HALF_PIPE_MIN_SPEED - 1) || (e.pressed & KEY_A)) {
        objects.halfPipe = 0;
        p->halfPipe = 0;
        if (p->state == OBJ_PS_HALF_PIPE_LOW || p->state == OBJ_PS_HALF_PIPE_MID || p->state == OBJ_PS_HALF_PIPE_HIGH) p->state = OBJ_PS_WALK;
      } else if (obj_round(p->xsp * OBJ_Q8) * (start ? 1 : -1) >= OBJ_HALF_PIPE_MIN_SPEED) {
        int along = start ? x - right : x - left + OBJ_HALF_PIPE_WIDTH;
        obj_half_pipe_lift(p, along, objects.halfPipeFeet);
      }
    }
  }
  return 1;
}

// --- the grind rails (grindrails.js) ------------------------------------------------------------------------------
static int obj_update_grind(ObjLive *l, ObjEntity *ent) {
  (void)l;
  Player *p = &act.player;
  int w = ent->d2 * 8, h = ent->d3 * 8;
  int x = obj_floor(p->x), y = obj_floor(p->y);
  int inside = x >= ent->x && x <= ent->x + w && y >= ent->y && y <= ent->y + h;
  if (ent->kind == 19) {
    // Task_GrindRailStart
    if (!p->dead && inside && !objects.grinding && p->ysp >= 0 && p->xsp > 0) {
      if (p->xsp < 0.5) p->xsp = 0.5;
      objects.grinding = 1;
      p->layer ^= 1;
      play_song(114);
    }
  } else if (!p->dead && inside && objects.grinding) {
    // Task_GrindRailEnd
    int far = x > ent->x + (w >> 1);
    if (far || (e.input & KEY_A)) {
      p->ysp = far ? -4.875 : -7.0;
      stop_song(114);
      play_song(116);
      obj_end_attack(p);
      p->state = far ? OBJ_PS_SPIN : OBJ_PS_HURT;
      p->air = 1;
      objects.standingOn = NULL;
      objects.grinding = 0;
      p->layer ^= 1;
    }
  }
  return 1;
}

// --- the waterfalls (waterfall.c): 16/256 more fall speed inside, and a splash under Sonic -----------------------
static int obj_update_waterfall(ObjLive *l, ObjEntity *ent) {
  Player *p = &act.player;
  int x = obj_floor(p->x), y = obj_floor(p->y);
  int top = ent->y + (int8_t)ent->d1 * 8, bottom = top + ent->d3 * 8;
  int inside = x >= ent->x && x <= ent->x + ent->d2 * 8 && y >= top && y <= bottom;
  if (inside && !p->dead) {
    p->ysp += 16.0 / 256;
    l->x = x;
    l->y = y + 10;
    l->noDraw = 0;
    // the splash's animator starts on the first frame it is drawn (waterfalls.js makes it without stepping it)
    if (l->phase == 0) { obj_restart_sprite(&l->sprite); l->phase = 1; }
    update_sprite(&l->sprite, 0);
  } else {
    l->noDraw = 1;
  }
  return 1;
}

// --- the wall poles (red_flag_and_pole.c): catches Sonic, bobs down and swings him up -------------------------------
static const int POLE_SWING[14] = { 1, 1, 1, 1, 1, 1, 1, 1, 16, 7, 7, 7, 7, 7 };
static int obj_update_pole(ObjLive *l, ObjEntity *ent) {
  Player *p = &act.player;
  int dir = ent->kind == 45 ? -1 : 1;   // the way the bar points, away from its wall
  int started = 0;
  if (l->phase == 0) {
    // the waiting pole tests the box its last frame set before stepping its animation
    ObjBox hb;
    int caught = 0;
    if (!p->dead && !p->carried && obj_box(l, &hb))
      caught = obj_overlap(ent->x, ent->y, hb, obj_floor(p->x), obj_floor(p->y), obj_body(p));
    if (caught) {
      obj_end_attack(p); p->pushing = 0;
      p->carried = 1;
      p->x = ent->x + 8 * dir; p->y = ent->y + 16;
      p->facing = -dir;
      p->state = OBJ_PS_POLE;
      play_song(175);
      obj_restart_sprite(&l->sprite);
      l->sprite.variant = 1;
      l->phase = 1; l->timer = 0;
      started = 1;
    }
  } else if (l->phase == 1) {
    if (p->dead) { p->carried = 0; l->phase = 2; }
    else {
      p->y += l->timer > 6 ? -POLE_SWING[l->timer] : POLE_SWING[l->timer];
      if (++l->timer > 13) {
        p->air = 1;
        obj_stand_up(p);
        p->airLock = 0;
        p->state = OBJ_PS_SPRING_RISE;
        p->ysp = -7.5;
        p->carried = 0;
        l->phase = 2;
      }
    }
  }
  int more = update_sprite(&l->sprite, 0);
  if (started) {
    // the swing's first frame also shows on the catch frame
  } else if (l->phase == 2 && !more) {
    obj_restart_sprite(&l->sprite);
    l->sprite.variant = 0;
    l->phase = 0;
    update_sprite(&l->sprite, 0);
  }
  l->x = ent->x; l->y = ent->y;
  return 1;
}

// --- the forced slide (slides.js) --------------------------------------------------------------------------------
static int obj_update_slide(ObjLive *l, ObjEntity *ent) {
  Player *p = &act.player;
  int dir = ent->d0 ? -1 : 1;
  int w = ent->d2 * 8, h = ent->d3 * 8;
  int x = obj_floor(p->x), y = obj_floor(p->y);
  int inside = x >= ent->x && x <= ent->x + w && y >= ent->y && y <= ent->y + h;
  if (p->dead) { l->held = 0; return 1; }
  if (inside && !p->air && objects.standingOn == NULL) {
    l->held = 1;
    obj_end_attack(p);
    p->pushing = 0;
    p->airLock = 0;
    p->facing = dir;
    p->gsp = p->xsp = 4.0 * dir;
    p->ysp = 0;
    p->state = OBJ_PS_HURT;
    obj_stand_up(p);
    l->x = x; l->y = y;
    update_sprite(&l->icon, 0);
  } else if (l->held && (!inside || p->air)) {
    l->held = 0;
  }
  return 1;
}

// --- running one object -------------------------------------------------------------------------------------------
static int obj_update_live(int k, int camX, int camY) {
  ObjLive *l = &objects.live[k];
  ObjEntity *ent = obj_entity_of(l);
  if (l->type == OBJ_ENTITY_ITEMBOX) return obj_update_itembox(l, ent);
  switch (ent->kind) {
    case 0: return obj_update_goal(l, ent);
    case 1: case 2: case 3: case 4: return obj_update_spikes(l, ent);
    case 7: return obj_update_checkpoint(l, ent);
    case 8: case 9: case 10: case 11: case 12: case 13: case 14: case 15: return obj_update_spring(l, ent);
    case 16: return obj_update_boulder(l, ent, camX, camY);
    case 17: case 18: return obj_update_toggle(l, ent);
    case 19: case 20: return obj_update_grind(l, ent);
    case 21: return obj_update_thin(l, ent);
    case 22: return obj_update_falling(l, ent);
    case 23: return obj_update_trampoline(l, ent);
    case 24: return obj_update_crumbling(l, ent);
    case 25: return obj_update_bounce_block(l, ent);
    case 26: return obj_update_ramp(l, ent);
    case 27: return obj_update_waterfall(l, ent);
    case 44: case 45: return obj_update_pole(l, ent);
    case 28: case 29: return obj_update_half_pipe(l, ent);
    case 31: case 32: case 33: return obj_update_booster(l, ent);
    case 46: return obj_update_slide(l, ent);
    default: return 1;   // a kind this port doesn't build yet: a stand-in
  }
}

// IS_OUT_OF_CAM_RANGE: 128 px around the screen
static int obj_off_cam(int x, int y, int camX, int camY) {
  return x < camX - 128 || x > camX + 368 || y < camY - 128 || y > camY + 288;
}

static int obj_should_leave(int k, int camX, int camY) {
  ObjLive *l = &objects.live[k];
  ObjEntity *ent = obj_entity_of(l);
  switch (l->kind) {
    case 0:    // once the goal has ended the act it stays until the results take over
      return l->phase == 0 ? obj_off_cam(ent->x, ent->y, camX, camY) : 0;
    case 21:   // thin: its spawn point off the screen and its current place out of range
      return obj_off_cam(l->x, l->y, camX, camY) && obj_off_cam(ent->x, ent->y, camX, camY);
    case 22:   // falling: its current place once it falls
      return l->phase == 2 ? obj_off_cam(l->x, l->y, camX, camY) : obj_off_cam(ent->x, ent->y, camX, camY);
    case 24:   // crumbling: once it crumbles, only sideways
      if (l->phase >= 2) return ent->x < camX - 128 || ent->x > camX + 368;
      return obj_off_cam(ent->x, ent->y, camX, camY);
    case 28: { // Task_HalfPipeStart looks 800 px back
      int out = ent->x > camX + 368 || ent->x < camX - 800 || ent->y > camY + 288 || ent->y < camY - 128;
      if (out) objects.halfPipe = 0;
      return out;
    }
    case 29: { // Task_HalfPipeEnd looks 800 px ahead
      int out = ent->x > camX + 1040 || ent->x < camX - 128 || ent->y > camY + 288 || ent->y < camY - 128;
      if (out) objects.halfPipe = 0;
      return out;
    }
    default:
      return obj_off_cam(ent->x, ent->y, camX, camY);
  }
}

static void obj_despawn(int k) {
  ObjLive *l = &objects.live[k];
  if (!l->active) return;
  if (objects.standingOn == l) objects.standingOn = NULL;
  ObjEntity *ent = obj_entity_of(l);
  if (ent->live == k) ent->live = -1;
  obj_give_slot(l->slot);
  obj_give_slot(l->slot2);
  l->slot = -1; l->slot2 = -1;
  l->active = 0;
}

// --- the boulder's pieces -----------------------------------------------------------------------------------------
static void obj_update_debris(void) {
  for (int i = 0; i < OBJ_DEBRIS_COUNT; i++) {
    ObjDebris *d = &debris[i];
    if (!d->active) continue;
    if (d->n > 60) { d->active = 0; continue; }
    d->vy += 40;
    d->scale += 8;
    if (d->scale > 512) d->scale = 512;
    d->qy += d->vy >> 8;
    d->angle = (d->angle + d->turn) & 0x3FF;
    d->n++;
  }
}

// --- the frame's objects ------------------------------------------------------------------------------------------
// SpawnMapEntities' scan: the entities in the rectangle, region by region, each region's interactables then its
// item boxes
static void obj_scan(int x0, int x1, int y0, int y1) {
  if (objects.width <= 0 || objects.height <= 0) return;
  x0 = obj_clamp(x0, 0, objects.width - 1); x1 = obj_clamp(x1, 0, objects.width - 1);
  y0 = obj_clamp(y0, 0, objects.height - 1); y1 = obj_clamp(y1, 0, objects.height - 1);
  for (int r = 0; r < objects.regionsX * objects.regionsY; r++) {
    for (int i = objects.intStart[r]; i < objects.intStart[r] + objects.intN[r]; i++)
      obj_spawn(OBJ_ENTITY_INTERACTABLE, i, x0, x1, y0, y1);
    for (int i = objects.boxStart[r]; i < objects.boxStart[r] + objects.boxN[r]; i++)
      obj_spawn(OBJ_ENTITY_ITEMBOX, i, x0, x1, y0, y1);
  }
}

void objects_update(int camX, int camY) {
  objects.hurtFrame = 0;
  if (!objects.loaded) return;
  if (objects.invincible > 0) objects.invincible--;
  if (objects.speedUp > 0) objects.speedUp--;
  Player *p = &act.player;
  if (p->invulnerable > 0) p->invulnerable--;
  p->hidden = p->invulnerable > 0 && (act.tick & 3) < 2;

  // SpawnMapEntities: everything whose spawn point is in range around the camera, in the list's order, with each
  // region's interactables and then its item boxes; after the first frame, only the strips the camera uncovers
  if (!objects.hasPrev || (camX - objects.prevX > 248 || objects.prevX - camX > 248) || (camY - objects.prevY > 208 || objects.prevY - camY > 208)) {
    obj_scan(camX - 128, camX + 368, camY - 128, camY + 288);
    objects.prevX = camX; objects.prevY = camY; objects.hasPrev = 1;
  } else {
    int ax0 = camX > objects.prevX ? objects.prevX + 368 : camX - 128;
    int ax1 = camX > objects.prevX ? camX + 368 : objects.prevX - 128;
    int by0 = camY > objects.prevY ? objects.prevY + 288 : camY - 128;
    int by1 = camY > objects.prevY ? camY + 288 : objects.prevY - 128;
    if (camX != objects.prevX && ax0 != ax1) obj_scan(ax0, ax1, camY - 128, camY + 288);
    if (camY != objects.prevY && by0 != by1) obj_scan(camX - 128, camX + 368, by0, by1);
    objects.prevX = camX; objects.prevY = camY;
  }
  // the objects' tasks: the thin platform runs at 0x2010, after the other objects
  for (int pass = 0; pass < 2; pass++) {
    for (int k = 0; k < OBJ_LIVE_MAX; k++) {
      ObjLive *l = &objects.live[k];
      if (!l->active) continue;
      if (pass == 0 && (l->kind == 21 || l->kind == 29)) continue;
      if (pass == 1 && l->kind != 21 && l->kind != 29) continue;
      if (l->fresh) { l->fresh = 0; continue; }
      if (!obj_update_live(k, camX, camY)) { obj_despawn(k); continue; }
      if (obj_should_leave(k, camX, camY)) obj_despawn(k);
    }
  }
  obj_update_debris();
}

// --- drawing ------------------------------------------------------------------------------------------------------
static void obj_draw_debris(int camX, int camY) {
  for (int i = 0; i < OBJ_DEBRIS_COUNT; i++) {
    ObjDebris *d = &debris[i];
    if (!d->active) continue;
    int dx = (d->cx - camX) + d->across * d->n;
    int dy = d->qy - camY;
    int half = (d->scale * 128) >> 8;
    int x = d->sx + ((dx * half) >> 8);
    int y = d->sy + ((dy * half) >> 8);
    if (x + d->size < 0 || x - d->size > OBJ_SCREEN_W || y + d->size < 0 || y - d->size > OBJ_SCREEN_H) continue;
    Transform tf;
    tf.rotation = (uint16_t)(d->angle & 0x3FF);
    tf.qScaleX = (int16_t)d->scale;
    tf.qScaleY = (int16_t)d->scale;
    tf.x = (int16_t)x; tf.y = (int16_t)y;
    d->sprite.frameFlags = (d->sprite.frameFlags & ~(SPRITE_X_FLIP | SPRITE_Y_FLIP))
      | (uint32_t)(4 + i) | SPRITE_ROT_SCALE_ENABLE | SPRITE_DOUBLE_SIZE;
    transform_sprite(&d->sprite, &tf);
    display_sprite(&d->sprite);
  }
}

void objects_draw(int camX, int camY) {
  if (!objects.loaded) return;
  for (int k = 0; k < OBJ_LIVE_MAX; k++) {
    ObjLive *l = &objects.live[k];
    if (!l->active) continue;
    if (l->noDraw) { l->noDraw = 0; continue; }
    ObjEntity *ent = obj_entity_of(l);

    if (l->type == OBJ_ENTITY_ITEMBOX) {
      if (l->phase == 0 && l->slot >= 0) {
        l->sprite.x = (int16_t)(l->x - camX);
        l->sprite.y = (int16_t)(l->y - camY);
        display_sprite(&l->sprite);
      }
      if (l->slot2 >= 0 && l->phase <= 2) {
        l->icon.x = (int16_t)(l->x - camX);
        l->icon.y = (int16_t)(l->y - camY);
        display_sprite(&l->icon);
      }
      continue;
    }

    if (ent->kind == 46) {   // the forced slide's splash follows Sonic
      if (l->held && l->slot2 >= 0) {
        l->icon.x = (int16_t)(act.player.x - camX);
        l->icon.y = (int16_t)(act.player.y - camY);
        display_sprite(&l->icon);
      }
      continue;
    }
    if (!l->hasSprite || l->slot < 0) continue;
    if (ent->kind == 0 && ent->d0 == 0) continue;               // a hidden goal draws nothing
    if (ent->kind == 24 && l->phase >= 2) continue;             // only the falling tiles would show
    int y = l->y - camY;
    if (ent->kind == 21 || ent->kind == 22) y += SINE[l->sag] >> 12;   // the sag is the sprite's only
    l->sprite.x = (int16_t)(l->x - camX);
    l->sprite.y = (int16_t)y;
    display_sprite(&l->sprite);
  }
  obj_draw_debris(camX, camY);
}

// --- starting and restarting --------------------------------------------------------------------------------------
void objects_reset(void) {
  for (int k = 0; k < OBJ_LIVE_MAX; k++) if (objects.live[k].active) obj_despawn(k);
  for (int k = 0; k < OBJ_LIVE_MAX; k++) memset(&objects.live[k], 0, sizeof objects.live[k]);
  for (int i = 0; i < objects.interactableCount; i++) { objects.interactables[i].live = -1; objects.interactables[i].gone = 0; }
  for (int i = 0; i < objects.itemBoxCount; i++) { objects.itemBoxes[i].live = -1; objects.itemBoxes[i].gone = 0; }
  for (int i = 0; i < OBJ_SLOT_COUNT; i++) objects.slotUsed[i] = 0;
  for (int i = 0; i < OBJ_DEBRIS_COUNT; i++) debris[i].active = 0;
  objects.standingOn = NULL;
  objects.hurtFrame = 0;
  objects.hasPrev = 0;
  objects.shield = 0; objects.invincible = 0; objects.speedUp = 0;
  objects.halfPipe = 0; objects.halfPipeFeet = 0; objects.grinding = 0; objects.goalReached = 0;
  act.player.invulnerable = 0;
  act.player.hidden = 0;
}

void objects_init(int level) {
  int sameLevel = objects.loaded && objects.level == level;
  if (!sameLevel) {
    // the checkpoint passed carries through a death, but not into another act
    objects.checkpoint.last = 0;
    objects.checkpoint.x = act.stage.spawnX;
    objects.checkpoint.y = act.stage.spawnY;
    objects.checkpoint.courseTime = 0;
    objects.checkpoint.valid = 0;
  }
  objects_reset();
  objects.level = level;
  objects.loaded = 0;
  objects.interactableCount = 0;
  objects.itemBoxCount = 0;
  objects.regionsX = 0; objects.regionsY = 0;
  objects.width = 0; objects.height = 0;
  memset(objects.intStart, 0, sizeof objects.intStart);
  memset(objects.intN, 0, sizeof objects.intN);
  memset(objects.boxStart, 0, sizeof objects.boxStart);
  memset(objects.boxN, 0, sizeof objects.boxN);

  int regionsX = 0, regionsY = 0;
  if (!obj_read_grid(OFFSET_INTERACTABLES + (uint32_t)level * 4u, 7, objects.interactables,
      OBJ_INTERACTABLES_MAX, &objects.interactableCount, &regionsX, &regionsY,
      objects.intStart, objects.intN)) return;
  objects.regionsX = regionsX;
  objects.regionsY = regionsY;
  objects.width = regionsX * OBJ_REGION;
  objects.height = regionsY * OBJ_REGION;

  int boxRegionsX = 0, boxRegionsY = 0;
  if (!obj_read_grid(OFFSET_ITEM_BOXES + (uint32_t)level * 4u, 3, objects.itemBoxes,
      OBJ_ITEMBOXES_MAX, &objects.itemBoxCount, &boxRegionsX, &boxRegionsY,
      objects.boxStart, objects.boxN)) {
    objects.itemBoxCount = 0;
  }

  objects.loaded = 1;
}

/** The objects' graphics, taken once the title card has given its tiles back, as the original's first spawn does. */
void objects_alloc_vram(void) {
  if (objects.vramAllocated) return;
  objects.slotBase = vram_malloc(OBJ_SLOT_COUNT * OBJ_SLOT_TILES);
  objects.debrisBase = vram_malloc(OBJ_DEBRIS_COUNT * OBJ_DEBRIS_TILES);
  objects.vramAllocated = 1;
}

int objects_player_hit(void) { return objects.hurtFrame; }
int objects_player_invincible(void) { return objects.invincible > 0; }

void objects_player_state(int *shield, int *invincible, int *speedUp) {
  if (shield) *shield = objects.shield;
  if (invincible) *invincible = objects.invincible;
  if (speedUp) *speedUp = objects.speedUp;
}
