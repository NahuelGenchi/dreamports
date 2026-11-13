// What the character meets in a special stage, translated from special/objects.js (SAT-R's
// src/game/sa1/special_stage/main.c, from Task_802B3E4 on): the layout's rings, drawn by one task, and its other
// objects, a task each, made as the character comes within 768 lines of them; the checkpoint and the goal; the
// messages; the rings a bomb knocks out of the character; and the character falling away when they haven't enough rings.
//
// An object's state is the original's struct (SpStage74), with its fields named:
//   x, y, depth (unk3C, unk40, unk44)   where it is, in 1/256 px and 1/256 lines
//   offX, offY (unk48, unk4A)           how far from the middle it shows, scaled by its depth
//   screenX, screenY (unk4C, unk4E)     where it shows
//   ahead (unk50)                       how far ahead of the character it is, in lines (negative ahead)
//   vx, vy, vdepth (unk52, unk54, unk56) and ax, ay, adepth (unk58, unk5A, unk5C)   its speeds and what is added
//   kind (unk60)                        what it is (the KIND below)
//   anim, variant (anim62, variant64), matrix (unk66), touched (unk67)
//   entry (unk68)                       its layout entry
//   ring, rings (unk6A, unk6B)          a dropped ring's place among those dropped, and how many
//   blink (unk6C), timer (unk6D), fall (unk6E), wait (unk70)

#include "special.h"

enum { KIND_RING = 0, KIND_SPARKLE = 1, KIND_BUMPER = 2, KIND_BUMPER_RING = 3, KIND_BACK_PAD = 4, KIND_FORWARD_PAD = 5,
       /* 6 to 9: the diagonal pads */ KIND_TOKEN = 10, KIND_BOMB = 11, KIND_EXPLOSION = 12, KIND_SPARK = 13, KIND_FALL = 14 };
enum { ANIM_RINGS = 0x31B, ANIM_MESSAGES = 812, ANIM_SPEECH = 813, ANIM_FALL = 34 };
#define AHEAD 0x300
#define BEHIND 0xC0
#define GONE 576
#define ORDER(n) ((n) << 6)

typedef struct SpObject {
  int used;
  uint32_t serial;           // which object a slot holds, as a bumper's rings know their bumper by it
  Sprite s;
  SpTransform tf;
  int32_t x, y, depth;
  int16_t offX, offY, screenX, screenY, ahead, vx, vy, vdepth, ax, ay, adepth;
  int kind, anim, variant, matrix, touched, entry, ring, rings, blink, timer, wait;
  int16_t fall;
  struct SpObject *parent;
  uint32_t parentSerial;
} SpObject;

#define OBJECTS 128
static SpObject objects[OBJECTS];
static uint32_t serials;

/** No object yet, as a stage starts with every task gone. */
void sp_objects_reset(void) { memset(objects, 0, sizeof objects); }

// a new object with nothing set, its sprite at its defaults (objects.js object)
static SpObject *object_new(void) {
  for (int i = 0; i < OBJECTS; i++) {
    SpObject *o = &objects[i];
    if (o->used) continue;
    memset(o, 0, sizeof *o);
    o->used = 1;
    o->serial = ++serials;
    sprite_init(&o->s);
    return o;
  }
  return NULL;
}
static void object_free(Task *t) { ((SpObject *)t->data)->used = 0; }
// the object's task, at `priority`; the object goes with it, or at once when there is no room for a task
static Task *object_task(TaskMain main, SpObject *o, uint16_t priority) {
  Task *t = create_task(main, o, priority, 0, object_free);
  if (!t) o->used = 0;
  return t;
}

// sub_802D6FC: the sprite showing the object's animation from its kind's tiles
static void sp_set_graphics(SpObject *o) {
  Sprite *s = &o->s;
  s->graphics.dest = OBJ_VRAM + ((uint32_t)spTables.objectTiles[o->kind] << 5);
  s->graphics.size = 0;
  s->graphics.anim = (uint16_t)o->anim;
  s->variant = (uint8_t)o->variant;
  s->prevVariant = 0xFF;
  s->qAnimDelay = 0;
  s->animSpeed = 0x10;
}
static void sp_set_kind(SpObject *o, int kind) {
  o->kind = kind;
  o->anim = spTables.objectAnims[kind][0]; o->variant = spTables.objectAnims[kind][1];
}
static void show(SpObject *o) {
  sp_share_graphics(&o->s);
  update_sprite(&o->s, 0);
  sp_transform(&o->s, &o->tf);
  display_sprite(&o->s);
}

static void spawn(Task *t);
static struct { int next, depth, done; } spawner;

/** sub_802D1D8: the task making the layout's objects (Task_802B3E4). */
void sp_spawner_create(void) {
  spawner.next = 0; spawner.depth = 0; spawner.done = 0;
  create_task(spawn, &spawner, 0x1400, 0, NULL);
}

static void marker(Task *t);
static void appear(Task *t);

// Task_802B3E4: everything up to 768 lines ahead, once; the goal stops it, and nothing comes out while the character
// is at the goal
static void spawn(Task *t) {
  (void)t;
  if (spawner.done || sp.checkpoint.kind == SP_GOAL) return;
  for (;;) {
    SpEntry entry = sp_entry(spawner.next);
    if (!(entry.depth < I8(sp.player->depth) + AHEAD)) break;
    if (entry.type == SP_END || entry.type == SP_CHECKPOINT_ENTRY) {
      SpObject *o = object_new();
      if (o) {
        o->kind = entry.type == SP_END ? SP_GOAL : SP_CHECKPOINT;
        o->depth = entry.depth << 8;
        object_task(marker, o, 0x1F00);
      }
      spawner.depth = entry.depth;
      spawner.next++;
      if (entry.type == SP_END) { spawner.done = 1; break; }
    } else if (entry.type == 0) spawner.next++;
    else {
      SpObject *o = object_new();
      if (o) {
        o->kind = (int)entry.type; o->x = entry.x << 8; o->y = entry.y << 8; o->depth = entry.depth << 8;
        o->entry = spawner.next; o->timer = 0xB;
        object_task(appear, o, 0x1500);
      }
      spawner.depth = entry.depth;
      spawner.next++;
    }
  }
}

// sub_802D33C: the checkpoint or the goal, reached
static void marker(Task *t) {
  SpObject *o = t->data;
  if (sp.player->depth >= o->depth) {
    sp.checkpoint.kind = o->kind;
    destroy_task(t);
  }
}

static void object_step(Task *t);
// Task_802BEDC: an object's first frame, shrunk to a quarter
static void appear(Task *t) {
  SpObject *o = t->data;
  Sprite *s = &o->s;
  o->ahead = 0; o->vx = 0; o->vy = 0; o->vdepth = 0; o->ax = 0; o->ay = 0; o->adepth = 0;
  sp_set_kind(o, o->kind);
  o->touched = 0;
  sp_set_graphics(o);
  o->matrix = sp_depth_matrix(s16(I8(sp.player->depth) - I8(o->depth)));
  s->x = s16(120 + I8(o->x)); s->y = s16(80 - I8(o->y));
  s->oamFlags = 0x7C0; s->palId = 0;
  s->frameFlags = (uint32_t)o->matrix | SP_AFFINE;
  o->tf = (SpTransform){ s->x, s->y, 0x40, 0x40 };
  t->main = object_step;
  sp_share_graphics(s);
  update_sprite(s, 0);
  sp_transform(s, &o->tf);
}

static void follow_bumper(Task *t);
static void advance(SpObject *o);
static int place(Task *t);
static void touch(Task *t);

// Task_802D37C: an object's frames
static void object_step(Task *t) {
  SpObject *o = t->data;
  follow_bumper(t);
  advance(o);
  if (!place(t)) return;
  if (o->wait != 0) o->wait = s16(o->wait - 1);
  else touch(t);
  show(o);
}

// sub_802BBF0
static void advance(SpObject *o) {
  o->vx = s16(o->vx + o->ax); o->vy = s16(o->vy + o->ay); o->vdepth = s16(o->vdepth + o->adepth);
  o->x += o->vx; o->y += o->vy; o->depth += o->vdepth;
}

// the depth's curve: (lines from 768 ahead / 8)^4 / 408
static int perspective(int ahead) {
  int k = (ahead + AHEAD) >> 3;
  if (k == 0) k = 1;
  return sp_div(k * k * k * k, 408);
}

/**
 * sub_802BC6C: where the object shows and how big, by how far ahead it is: from a quarter of its size 768 lines ahead,
 * nearer the middle, to twice its size 192 lines behind. Further behind it is gone (but the bumper's rings stay);
 * further ahead, or behind, it isn't shown. Returns whether it is shown.
 */
static int place(Task *t) {
  SpObject *o = t->data;
  Sprite *s = &o->s;
  o->ahead = s16((sp.player->depth - o->depth) >> 8);
  if (o->kind != KIND_BUMPER_RING && o->ahead > GONE) {
    destroy_task(t);
    return 0;
  }
  if (o->ahead > BEHIND || o->ahead < -AHEAD) return 0;
  o->matrix = sp_depth_matrix(o->ahead);
  int k = perspective(o->ahead), f = sp_div(k, 512) + 0x38;
  o->offX = s16(sp_div(o->x * f, 640) >> 8);
  o->offY = s16(sp_div(o->y * f, 640) >> 8);
  o->screenX = s16(s16(o->offX + 120) + sp.bg.x);
  o->screenY = s16(s16(80 - o->offY) - sp.bg.y);
  s->x = o->screenX; s->y = o->screenY;
  o->tf.x = s->x; o->tf.y = s->y;
  o->tf.scaleX = o->tf.scaleY = s16(sp_div(k, 1024) + 0x40);
  s->frameFlags = (uint32_t)o->matrix | SP_AFFINE;
  if (o->tf.scaleX > 0x100) s->frameFlags |= SP_DOUBLE_SIZE;
  s->oamFlags = (uint16_t)ORDER(-sp_div(o->ahead - BEHIND, 32));
  return 1;
}

// sub_802B66C: whether the character touches the object, within 64 lines in front of it; dash pads and bombs by a box
// of their own around the character, smaller while they are fast
static int touching(const SpObject *o) {
  const SpPlayer *p = sp.player;
  const Hitbox *box = &o->s.hitboxes[0];
  if (box->index == -1) return 0;
  if (p->depth < o->depth - 0x4000 || p->depth > o->depth) return 0;
  int kind = o->kind;
  if (kind >= 4 && (kind < 10 || kind == KIND_BOMB))
    return sp_touches(o->offX, o->offY, sp_box(box), I8(p->x), I8(p->y), p->flags & SP_FLAG_FAST ? spTables.boostHit : spTables.wideHit);
  return sp_touches(o->offX, o->offY, sp_box(box), I8(p->x), I8(p->y), sp_box(&p->s.hitboxes[0]));
}

// gSpecialStageCollectedRings + 1, with the ring's sound, left and right by turns (SpStage_PlayRingSoundeffect)
static void collect(void) {
  sp.collected = (sp.collected + 1) & 0xFFFF;
  int odd = sp.collected & 1, player = odd ? 2 : 1;
  gba_sound_start_on(player, SONG_RING);
  gba_sound_imm_init(player);
  gba_sound_volume(player, 0xFFFF, 0x80);
  gba_sound_pan(player, 0xFFFF, odd ? -0x40 : 0x40);
}

static void sparkle_following(Task *t);
static void flash(Task *t);
static void bumper_message(Task *t);
static void create_sparks(Task *t);
static void create_bumper_rings(Task *t);

// sub_802B884: what touching it does
static void touch(Task *t) {
  SpObject *o = t->data;
  SpPlayer *p = sp.player;
  if (o->touched & 1 || p->flags & SP_FLAG_STILL || p->state == SP_STATE_HIT || !touching(o)) return;
  switch (o->kind) {
    case KIND_RING:
    case KIND_BUMPER_RING: {
      int bumperRing = o->kind == KIND_BUMPER_RING;
      sp_set_kind(o, KIND_SPARKLE);
      o->touched |= 1;
      o->vx = 0; o->vy = 0; o->ax = 0; o->ay = 0;
      if (!bumperRing) { o->vdepth = 0; o->adepth = 0; }
      sp_set_graphics(o);
      collect();
      t->main = bumperRing ? sparkle_following : flash;
      break;
    }
    case KIND_BUMPER:
      o->touched |= 1;
      sp_se(SONG_SPECIAL_BUMPER);
      create_sparks(t);
      create_bumper_rings(t);
      t->main = bumper_message;
      p->window = 0xA;
      o->timer = 0xB;
      break;
    case 4: case 5: case 6: case 7: case 8: case 9:
      p->flags |= SP_FLAG_ON_PAD;
      p->pad = o->entry & 0xFFFF;
      p->padKind = o->kind;
      break;
    case KIND_TOKEN:
      destroy_task(t);
      sp_se(SONG_SPECIAL_TOKEN);
      sp.extra = (sp.extra + 1) & 0xFF;
      break;
    case KIND_BOMB:
      sp_set_kind(o, KIND_EXPLOSION);
      o->touched |= 1;
      o->vx = 0; o->vy = 0; o->vdepth = 0; o->ax = 0; o->ay = 0; o->adepth = 0;
      sp_set_graphics(o);
      p->flags |= SP_FLAG_HIT;
      sp_se(SONG_EXPLOSION);
      t->main = flash;
      break;
  }
}

// sub_802D450, sub_802D66C
static void destroy(Task *t) { destroy_task(t); }

// sub_802D3E4: an animation through once (a sparkle, an explosion, a spark), moving as it was set to
static void flash(Task *t) {
  SpObject *o = t->data;
  advance(o);
  if (!place(t)) return;
  if (o->s.frameFlags & SPRITE_ANIM_OVER) { t->main = destroy; return; }
  sp_share_graphics(&o->s);
  if (update_sprite(&o->s, 0) == 0) t->main = destroy;
  sp_transform(&o->s, &o->tf);
  display_sprite(&o->s);
}

// the depth a bumper's ring or its sparkle keeps up with the character by: up to 14 lines a frame, and back level with
// them when more than a line past
static void keep_up(SpObject *o) {
  const SpPlayer *p = sp.player;
  o->adepth = s16((p->depth - o->depth) >> 8);
  int v = s16(o->vdepth + o->adepth);
  o->vdepth = (int16_t)(v > 14 * 256 ? 14 * 256 : v < -14 * 256 ? -14 * 256 : v);
  o->depth += o->vdepth;
  if (p->depth + 0x100 < o->depth) o->depth = p->depth;
}

// sub_802C224: a bumper's ring, taken: its sparkle keeps up with the character
static void sparkle_following(Task *t) {
  SpObject *o = t->data;
  if (o->s.frameFlags & SPRITE_ANIM_OVER) { t->main = destroy; return; }
  keep_up(o);
  if (place(t)) show(o);
}

// sub_802C2DC: the 8 sparks flying out of a bumper and slowing down
static void create_sparks(Task *t) {
  const SpObject *b = t->data;
  for (int i = 0; i < 8; i++) {
    int dx = spTables.sparks[i][0], dy = spTables.sparks[i][1];
    SpObject *o = object_new();
    if (!o) continue;
    o->x = b->x + (dx << 8); o->y = b->y + (dy << 8); o->depth = b->depth; o->matrix = b->matrix; o->touched = 1;
    sp_set_kind(o, KIND_SPARK);
    o->vx = s16(dx * 8); o->vy = s16(dy * 8);
    o->ax = s16(-sp_div(o->vx, 32)); o->ay = s16(-sp_div(o->vy, 32));
    sp_set_graphics(o);
    o->s.palId = 0;
    o->s.frameFlags = (uint32_t)o->matrix | SP_AFFINE;
    o->s.oamFlags = ORDER(31);
    object_task(flash, o, 0x1510);
  }
}

// sub_802C04C: the 12 rings around a bumper, which can't be taken for their first 15 frames
static void create_bumper_rings(Task *t) {
  SpObject *b = t->data;
  for (int i = 0; i < 12; i++) {
    int dx = spTables.bumperRings[i][0], dy = spTables.bumperRings[i][1];
    SpObject *o = object_new();
    if (!o) continue;
    o->kind = KIND_BUMPER_RING; o->x = b->x + (dx << 6); o->y = b->y + (dy << 6); o->depth = b->depth;
    o->entry = b->entry; o->wait = 0xF; o->parent = b; o->parentSerial = b->serial;
    object_task(appear, o, 0x1510);
  }
}

static void pulled(Task *t);
// sub_802D464: a bumper's ring flies to the character if they do the bumper trick while the bumper's message is still
// to come or showing, and is an ordinary ring once it has gone (its bumper, gone, left its count at 0)
static void follow_bumper(Task *t) {
  SpObject *o = t->data;
  if (o->kind != KIND_BUMPER_RING) return;
  const SpObject *b = o->parent;
  int timer = b && b->used && b->serial == o->parentSerial ? b->timer : 0;
  if (timer != 0) {
    if (sp.player->state == SP_STATE_BUMPER_TRICK) {
      t->main = pulled;
      o->vx = -0x300;
    }
  } else o->kind = KIND_RING;
}

// sub_802C0CC: a bumper's ring flying to the character, faster each frame, keeping up with them
static void pulled(Task *t) {
  SpObject *o = t->data;
  const SpPlayer *p = sp.player;
  // (0, 0) gives -1, and the original reads the entry before the table for its sine, which the JavaScript reads as 0
  int a = quick_angle(s16(p->screenY - o->screenY), s16(p->screenX - o->screenX));
  o->vx = s16(o->vx + 0x15);
  o->x += (o->vx * SINE[a + 256]) >> 14;
  o->y -= (o->vx * (a < 0 ? 0 : SINE[a])) >> 14;
  keep_up(o);
  if (!place(t)) return;
  if (o->wait != 0) o->wait = s16(o->wait - 1);
  else touch(t);
  show(o);
}

static void message(Task *t);
// sub_802C488: 11 frames after it is touched, the bumper becomes its message for a second, of the bumper trick done or
// not
static void bumper_message(Task *t) {
  SpObject *o = t->data;
  Sprite *s = &o->s;
  o->timer = (o->timer - 1) & 0xFF;
  if (o->timer != 0) return;
  o->timer = 60;
  o->anim = ANIM_MESSAGES;
  o->variant = sp.player->state == SP_STATE_BUMPER_TRICK ? 1 : 2;
  sp_set_graphics(o);
  s->x = 120; s->y = 40;
  s->oamFlags = ORDER(1);
  s->frameFlags = 0x2000;
  t->main = message;
}

/** CreateCheckpointMessage: COOL!, AAARGH! or NOT ENOUGH RINGS. */
void sp_message_create(int msg) {
  SpObject *o = object_new();
  if (!o) return;
  Sprite *s = &o->s;
  if (msg == SP_MESSAGE_NOT_ENOUGH_RINGS) {
    s->y = 136; o->anim = ANIM_MESSAGES; o->variant = 0; o->kind = msg; o->timer = 0x78;
  } else {
    s->y = 40; o->anim = ANIM_SPEECH; o->variant = msg; o->kind = 5; o->timer = 0xB4;
  }
  sp_set_graphics(o);
  s->x = 120; s->oamFlags = 0x40; s->frameFlags = 0x2000; s->palId = 0; s->animCursor = 0;
  s->hitboxes[0].index = -1;
  object_task(message, o, 0x1500);
}

// sub_802D4C4
static void message(Task *t) {
  SpObject *o = t->data;
  update_sprite(&o->s, 0);
  display_sprite(&o->s);
  o->timer = (o->timer - 1) & 0xFF;
  if (o->timer == 0) t->main = destroy;
}

static void lost_ring(Task *t);
/** sub_802AAF0: up to 10 of the character's rings, knocked out of them. */
void sp_lost_rings_create(void) {
  const SpPlayer *p = sp.player;
  int n;
  if (sp.collected > 9) { n = 10; sp.collected -= 10; } else { n = sp.collected; sp.collected = 0; }
  for (int rings = n; n != 0; n--) {
    SpObject *o = object_new();
    if (!o) continue;
    o->ring = n - 1; o->rings = rings; o->x = p->x; o->y = p->y; o->depth = p->depth; o->kind = KIND_RING; o->entry = -1;
    object_task(lost_ring, o, 0x1500);
  }
}

static void lost_ring_step(Task *t);
// sub_802C6C4: a dropped ring's first frame: thrown out its way and on ahead, slowing down
static void lost_ring(Task *t) {
  SpObject *o = t->data;
  Sprite *s = &o->s;
  o->ahead = 0;
  o->vx = spTables.lostRings[o->ring][0]; o->vy = spTables.lostRings[o->ring][1];
  o->vdepth = 0x800;
  o->ax = s16(-sp_div(o->vx, 32)); o->ay = s16(-sp_div(o->vy, 32)); o->adepth = s16(-sp_div(o->vdepth, 64));
  o->anim = spTables.objectAnims[KIND_RING][0]; o->variant = spTables.objectAnims[KIND_RING][1];
  o->touched = 0;
  o->matrix = sp_depth_matrix(s16(I8(sp.player->depth) - I8(o->depth)));
  sp_set_graphics(o);
  s->x = s16(120 + I8(o->x)); s->y = s16(80 - I8(o->y));
  s->oamFlags = 0x180; s->palId = 0;
  s->frameFlags = (uint32_t)o->matrix | SP_AFFINE;
  o->tf = (SpTransform){ s->x, s->y, 0x100, 0x100 };
  t->main = lost_ring_step;
  sp_share_graphics(s);
  update_sprite(s, 0);
  sp_transform(s, &o->tf);
}

// sub_802C89C: shown every other frame
static void lost_ring_step(Task *t) {
  SpObject *o = t->data;
  o->ax = s16(-sp_div(o->vx, 32)); o->ay = s16(-sp_div(o->vy, 32));
  advance(o);
  if (!place(t)) return;
  sp_share_graphics(&o->s);
  update_sprite(&o->s, 0);
  sp_transform(&o->s, &o->tf);
  int blink = o->blink;
  o->blink = (o->blink + 1) & 0xFF;
  if (blink & 1) display_sprite(&o->s);
}

static void fall_step(Task *t);
/** sub_802B214: the character's fall at the checkpoint or the goal, without the rings for it. */
void sp_fall_effect_create(void) {
  const SpPlayer *p = sp.player;
  SpObject *o = object_new();
  if (!o) return;
  o->x = p->x; o->y = p->y; o->depth = p->depth - 0x100; o->ahead = s16(p->lift); o->kind = KIND_FALL;
  uint32_t r = sp_random();
  o->ax = (int16_t)(r & 0xF); o->ay = (int16_t)-((r & 0x70) >> 4); o->adepth = -0x10;
  if (r & 0x80) o->ax = (int16_t)-o->ax;
  o->anim = (spTables.characterAnims[p->character & 3] + ANIM_FALL) & 0xFFFF; o->variant = 1;
  Sprite *s = &o->s;
  s->graphics.dest = OBJ_VRAM + 0x1400; s->graphics.size = 0; s->graphics.anim = (uint16_t)o->anim;
  s->variant = 1; s->prevVariant = 0xFF; s->qAnimDelay = 0; s->animSpeed = 0x10;
  o->matrix = sp_depth_matrix(s16(I8(p->depth) - I8(o->depth)));
  s->x = s16(I8(o->x) + 120); s->y = s16(80 - I8(o->y));
  s->oamFlags = ORDER(4); s->palId = 0;
  s->frameFlags = (uint32_t)o->matrix | SP_AFFINE;
  o->tf = (SpTransform){ s->x, s->y, 0x40, 0x40 };
  object_task(fall_step, o, 0x10FF);
}

// Task_802D508: for 160 frames
static void fall_step(Task *t) {
  SpObject *o = t->data;
  if (o->fall <= -160) return;
  o->fall = s16(o->fall - 1);
  advance(o);
  if (!place(t)) return;
  o->s.oamFlags = ORDER(5);
  update_sprite(&o->s, 0);
  sp_transform(&o->s, &o->tf);
  display_sprite(&o->s);
}

// --- the layout's rings (sub_802C934, UpdateObjectsAndRender) ------------------------------------------------------
// One sprite for them all: it shows the first that is on screen, then copies its OAM entry for the others. It runs
// before the objects, and starts the frame's matrices over.
static struct {
  Sprite s;
  SpTransform tf;
  uint8_t taken[256];   // a bit for each layout entry, set once its ring is taken
} rings;
static void draw_rings(Task *t);

void sp_rings_create(void) {
  int at = 0;
  for (int i = 0; i < 16; i++) {
    for (;;) {
      SpEntry entry = sp_entry(at);
      if (!(i << 12 > entry.depth + AHEAD && entry.type != SP_END)) break;
      at++;
    }
    sp.chunks[i] = (uint16_t)at;
  }
  Sprite *s = &rings.s;
  sprite_init(s);
  s->oamFlags = 0x500; s->frameFlags = 0x2030;
  s->graphics.dest = OBJ_VRAM + 0x800; s->graphics.anim = ANIM_RINGS;
  memset(rings.taken, 0, sizeof rings.taken);
  create_task(draw_rings, &rings, 0x1300, 0, NULL);
}

// the first ring's OAM entry again, at the sprite's place and with its matrix; false once OAM is full
static int copy_oam(Sprite *s) {
  int at = (s->oamFlags & 0x7C0) >> 6, k = alloc_oam((uint32_t)at);
  if (k < 0) return 0;
  int from = s->oamBaseIndex * 4;
  uint16_t a = (uint16_t)((e.oamMalloc[from] & 0xFD00) | (s->y & 0xFF) | ((s->frameFlags & SP_DOUBLE_SIZE) << 3));
  uint16_t b = (uint16_t)((e.oamMalloc[from + 1] & 0xC000) | (s->x & 0x1FF) | ((s->frameFlags & 0x1F) << 9));
  e.oamMalloc[k * 4] = a; e.oamMalloc[k * 4 + 1] = b; e.oamMalloc[k * 4 + 2] = e.oamMalloc[from + 2];
  return 1;
}

// whether entry i's ring is taken; the JavaScript's bits run out past the layout's end, where nothing is taken
static int taken(int i) { return i >> 3 < (int)sizeof rings.taken && (rings.taken[i >> 3] >> (i & 7)) & 1; }

static void draw_rings(Task *t) {
  (void)t;
  const SpPlayer *p = sp.player;
  Sprite *s = &rings.s;
  SpTransform *tf = &rings.tf;
  for (int i = 0; i < 16; i++) sp.depths[i] = SP_NO_DEPTH;
  memset(sp.matrices, 0, 16);
  update_sprite(s, 0);
  uint32_t dims = s->dimensions;
  int here = I8(p->depth), ahead = here + AHEAD, behind = here - BEHIND;
  int shown = 0;
  for (int i = sp.chunks[(ahead >> 12) & 0xFF];; i = (i + 1) & 0xFFFF) {
    SpEntry entry = sp_entry(i);
    if (!(entry.depth < ahead)) break;
    if (entry.type == SP_END) return;
    if (entry.type != 0 || entry.depth < behind || taken(i)) continue;
    int32_t x = entry.x << 8, y = entry.y << 8, depth = entry.depth << 8;
    int away = s16(here - entry.depth);
    int k = perspective(away), f = sp_div(k, 512) + 0x38;
    int offX = s16(sp_div(x * f, 640) >> 8), offY = s16(sp_div(y * f, 640) >> 8);
    if (!(p->flags & SP_FLAG_STILL) && p->state != SP_STATE_HIT && here >= entry.depth - 32 && here <= entry.depth
        && sp_touches(offX, offY, sp_box(&s->hitboxes[0]), I8(p->x), I8(p->y), sp_box(&p->s.hitboxes[0]))) {
      // taken: a sparkle in its place
      SpObject *o = object_new();
      if (o) {
        o->kind = KIND_SPARKLE; o->x = x; o->y = y; o->depth = depth;
        sp_set_kind(o, KIND_SPARKLE);
        o->matrix = sp_depth_matrix(away);
        o->touched = 1;
        sp_set_graphics(o);
        o->s.palId = 0;
        o->s.frameFlags = (uint32_t)o->matrix | SP_AFFINE;
        o->s.oamFlags = 0x7C0;
        object_task(flash, o, 0x1500);
      }
      collect();
      if (i >> 3 < (int)sizeof rings.taken) rings.taken[i >> 3] |= (uint8_t)(1 << (i & 7));
      continue;
    }
    int matrix = sp_depth_matrix(away);
    tf->x = s16(offX + sp.bg.x + 0x78);
    tf->y = s16(0x50 - sp.bg.y - offY);
    tf->scaleX = tf->scaleY = s16(sp_div(k, 1024) + 0x40);
    s->frameFlags = SP_AFFINE | (uint32_t)matrix;
    if (tf->scaleX > 0x100) s->frameFlags |= SP_DOUBLE_SIZE;
    int halfW = (int)rom_u16(dims + 4) >> 1, halfH = (int)rom_u16(dims + 6) >> 1;
    s->x = s16(tf->x - ((tf->scaleX * (rom_s16(dims + 8) - halfW) + (halfW << 8)) >> 8));
    s->y = s16(tf->y - ((tf->scaleY * (rom_s16(dims + 10) - halfH) + (halfH << 8)) >> 8));
    if (shown == 0 || s->oamBaseIndex == 0xFF) {
      s->oamBaseIndex = 0xFF;
      sp_set_matrix(s->frameFlags & 0x1F, tf->scaleX, tf->scaleY);
      display_sprite(s);
    } else {
      if (s->frameFlags & SP_DOUBLE_SIZE) { s->x = s16(s->x - halfW); s->y = s16(s->y - halfH); }
      sp_set_matrix(s->frameFlags & 0x1F, tf->scaleX, tf->scaleY);
      if (!copy_oam(s)) return;
    }
    shown = (shown + 1) & 0xFF;
  }
}
