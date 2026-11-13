// Ice Mountain's blocks of ice (interactable kind 95). Translated from the original's ice_block.c a function at a time, with the
// JavaScript version's engine/iceblocks.js as the guide; every comment names the function it rewrites.
//
// A block is solid. It breaks when Sonic falls onto it curled up, when his attack box touches it while he isn't curled up
// (sub_800C394), when that box touches it while he is curled up or charging a spin dash (sub_8091E88), or when he lands on it
// curled up, which stands him on it first, so the landing doesn't bounce him. It leaves a dust cloud and four pieces that spin
// out and fall, and never comes back until the act starts over.

#include "bosses.h"

enum {
  ICE_BLOCK = 95,
  ANIM_ICE_BLOCK = 555, ANIM_SHARDS_LARGE = 556, ANIM_SHARDS_SMALL = 557,
  ORDER_ICE_BLOCK = 8, ORDER_SHARDS = 8, PRIORITY_SHARDS = 0,
  SE_ITEM_BOX = 138, SE_ICE_BLOCK = 193,
  PROBE_EXTRA = 5,             // the box curled-up Sonic falls with: his sprite's half width and height, and this and 1 more
  // the pieces
  PIECES = 4,
  SHARDS_ABOVE = -16,          // the first two start this far above the block, the others 16 px higher again
  SHARDS_SPEED = -0x200, SHARDS_FALL = 40,   // Q(2) up, and 40/256 px a frame per frame
  SHARDS_SCALE_MAX = 0x200,
  SHARDS_MATRIX = SPRITE_ROT_SCALE_ENABLE | SPRITE_DOUBLE_SIZE,
};

typedef struct { Object o; } IceBlock;

// --- the pieces (CreateIceBlockShards, Task_IceBlockShards, and the skating stone's CreateSkatingStoneDebris) -------------------
typedef struct {
  Object o;                 // the small piece, drawn as the first two (the original copies it into the second)
  Sprite large;             // and the large one, drawn as the others
  Transform tf[PIECES];
  const DebrisLook *look;
  int n, vy, cx, cy;        // the frames gone, the fall, and the place on screen as it broke (gUnknown_0300194C, _03002820)
} Shards;

// how far across each piece goes a frame, how much higher it starts, and how far it turns a frame
static const struct { int across, above, turn; } PIECE[PIECES] = {
  { -2, 0, -42 }, { 1, SHARDS_ABOVE, 42 }, { 2, 0, 14 }, { -1, SHARDS_ABOVE, -14 },
};

/** Task_IceBlockShards and Task_SkatingStoneDebris: the pieces fall, grow and turn. sub_8004E14 places each one around the
 *  broken thing's place on screen, at half the distance its own point is from there, grown with the pieces' scale. */
static int shards_run(ActTask *t) {
  Shards *d = (Shards *)t->data;
  if (d->n++ > d->look->frames) return 0;
  d->vy = s16(d->vy + SHARDS_FALL);
  int scale = d->tf[0].qScaleX + d->look->grow;
  if (scale > SHARDS_SCALE_MAX) scale = SHARDS_SCALE_MAX;
  int half = (scale * 128) >> 8;
  for (int i = 0; i < PIECES; i++) {
    Sprite *s = i < 2 ? &d->o.sprite : &d->large;
    Transform *tf = &d->tf[i];
    tf->y = s16(tf->y + enemy_i(d->vy));
    int dx = s16(tf->x - cam_x() + PIECE[i].across * d->n), dy = s16(tf->y - cam_y());
    tf->qScaleX = tf->qScaleY = (int16_t)scale;
    tf->rotation = (uint16_t)(tf->rotation + PIECE[i].turn);
    s->frameFlags = SHARDS_MATRIX | (uint32_t)boss_matrix();
    Transform at = { tf->rotation, tf->qScaleX, tf->qScaleY, (int16_t)(d->cx + ((dx * half) >> 8)), (int16_t)(d->cy + ((dy * half) >> 8)) };
    transform_sprite(s, &at);
    display_sprite(s);
  }
  return 1;
}

static void shards_end(ActTask *t) {
  object_sprite_free(&((Shards *)t->data)->large);
  object_end(t);
}

/** CreateIceBlockShards and CreateSkatingStoneDebris, from the point they break from in the world and the place on screen it
 *  is measured from; each sprite takes room for its animation's whole size (ALLOC_TILES) */
void shards_new(const DebrisLook *look, int x, int y, int sx, int sy) {
  Shards *d = OBJECT_NEW(Shards);
  if (!d) return;
  d->look = look;
  d->vy = SHARDS_SPEED;
  d->cx = sx; d->cy = sy;
  object_sprite_at(&d->o.sprite, vram_malloc((uint32_t)look->smallTiles), look->small, 0, ORDER_SHARDS, PRIORITY_SHARDS, 0, 0);
  sprite_step(&d->o.sprite);
  object_sprite_at(&d->large, vram_malloc((uint32_t)look->largeTiles), look->large, 0, ORDER_SHARDS, PRIORITY_SHARDS, 0, 0);
  sprite_step(&d->large);
  for (int i = 0; i < PIECES; i++) {
    // the point less the place on screen: where the camera was, in the world
    d->tf[i] = (Transform){ 0, (int16_t)look->scale, (int16_t)look->scale, (int16_t)(x - sx), (int16_t)(y - sy + PIECE[i].above) };
  }
  ActTask *t = object_task(&d->o, shards_run, PRIORITY_OBJECTS);
  if (!t) object_sprite_free(&d->large);
  else t->end = shards_end;
}

// CreateIceBlockShards: the pieces start full size, grow 1/256 a frame and go after 80 frames
static const DebrisLook SHARDS = {
  ANIM_SHARDS_SMALL, 16 / 8 * (16 / 8), ANIM_SHARDS_LARGE, 64 / 8 * (64 / 8), 0x100, 1, 80,
};

// --- the block ----------------------------------------------------------------------------------------------------------------------
/** sub_800C394: Sonic falling onto the box curled up, or his attack box on it while he isn't curled up, breaks it and turns
 *  his fall into a rise */
static int breaks(int x, int y, const Hitbox *hb, Player *p) {
  Hitbox probe = { 0, (int8_t)-(collide_body(p).right + PROBE_EXTRA), (int8_t)-(p->offsetY + 1),
                   (int8_t)(collide_body(p).right + PROBE_EXTRA), (int8_t)(p->offsetY + 1) };
  const Hitbox *attack = object_box(&p->sprite, 1);
  int px = enemy_sonic_x(), py = enemy_sonic_y();
  if ((p->curled && p->ysp > 0 && collide_overlap(x, y, hb, px, py, &probe))
      || (attack && collide_overlap(x, y, hb, px, py, attack) && !p->curled)) {
    if (p->ysp > 0) p->ysp = -p->ysp;
    return 1;
  }
  return 0;
}

/** sub_8091E88: his attack box on it while he is curled up or charging a spin dash, and Tails flying or Knuckles gliding,
 *  dropping from it, landing or sliding after it */
static int attacking(const Player *p) {
  int s = p->state;
  if (s == PS_SPIN || s == PS_SPIN_DASH || s == PS_SPIN_DASH_REV) return 1;
  if (p->character == CHARACTER_TAILS) return s == PS_FLY || s == PS_FLY_TURN;
  if (p->character == CHARACTER_KNUCKLES) return s == PS_GLIDE || s == PS_GLIDE_DROP || s == PS_DROP_LAND || s == PS_GLIDE_SLIDE
    || (s >= PS_GLIDE_TURN0 && s <= PS_GLIDE_TURN3);
  return 0;
}
static int curled_attack(int x, int y, const Hitbox *hb, Player *p) {
  const Hitbox *attack = object_box(&p->sprite, 1);
  return attacking(p) && attack && collide_overlap(x, y, hb, enemy_sonic_x(), enemy_sonic_y(), attack);
}

/** Task_IceBlock */
static int ice_block_run(ActTask *t) {
  IceBlock *b = (IceBlock *)t->data;
  Sprite *s = &b->o.sprite;
  Slot *slot = b->o.slot;
  int x = slot->e.x, y = slot->e.y;
  const Hitbox *hb = object_box(s, 0);
  Player *p = &act.player;
  if (!p->dead && hb) {
    // landing on it curled up stands him on it first (sub_80096B0's LANDED)
    int landed = p->state == PS_SPIN && (collide_platform(&b->o, x, y, hb, p) & COLLIDE_LANDED);
    if (breaks(x, y, hb, p) || curled_attack(x, y, hb, p) || landed) {
      if (p->onObject == &b->o) { p->onObject = NULL; p->air = 1; }
      dust_cloud(x, y);
      play_song(SE_ITEM_BOX);
      shards_new(&SHARDS, x, y + SHARDS_ABOVE, s16(x - cam_x()), s16(y - cam_y()));
      play_song(SE_ICE_BLOCK);
      slot->gone = 1;
      return 0;
    }
  }
  if (hb) collide_platform(&b->o, x, y, hb, p);
  if (off_cam(x, y)) return 0;
  object_draw(s, x, y);
  return 1;
}

/** CreateEntity_IceBlock */
ActTask *ice_block_spawn(Slot *slot) {
  IceBlock *b = OBJECT_NEW(IceBlock);
  if (!b) return NULL;
  b->o.slot = slot;
  b->o.x = slot->e.x;
  object_sprite(&b->o.sprite, ANIM_ICE_BLOCK, 0, 0, ORDER_ICE_BLOCK, ENEMY_PRIORITY, 0, 0);
  sprite_step(&b->o.sprite);
  return object_task(&b->o, ice_block_run, PRIORITY_OBJECTS);
}
