// What the bosses share. Translated from the JavaScript version's engine/bosses.js (setBossCamBounds, bossPart, nutsAndBolts,
// bossExplosion, bossDebris, eggMobileEscape and bossHit26), engine/screenshake.js and the boss states of sound/music.js; the
// original's bosses_misc.c, bosses_egg_mobile.c, nuts_and_bolts_task.c, screen_shake.c, collision_3.c and music_manager.c.
//
// Positions are whole pixels in the act and speeds 1/256 px a frame, as the original keeps them, in 16 bits where it does.
// The JavaScript's widescreen arena (cam.arena) is left out: this view is the original's 240 px.

#include "bosses.h"

enum {
  CAM_GROW = 320,                                          // a bottom edge further down starts this far below the top
  PART_ORDER = 20, PART_FLAGS = 0x70,                      // in front of the layers, through the rotation hardware, double size
  PART_FRAMES = 0x3C, PART_VX = 0x100, PART_VY = -0x200, PART_GROW = 8, PART_GRAVITY = 40, PART_SCALE_MAX = 0x200,
  BOLTS_MARGIN = 32,
  ANIM_EXPLOSION = 611, VRAM_EXPLOSION = 0x1000, EXPLOSION_ORDER = 20, EXPLOSION_FLIPS = 0xC00,
  DEBRIS_ORDER = 17, DEBRIS_HOLD = 32, DEBRIS_SPEED = 0x600, DEBRIS_KINDS = 8,
  ANIM_EGG_MOBILE = 693, ANIM_EGGMAN = 694, VRAM_EGG_MOBILE = 0x2580, VRAM_EGGMAN = 0x2E40,
  EGG_MOBILE_ORDER = 21, EGGMAN_ORDER = 19,
  EGG_MOBILE_STILL = 0, EGG_MOBILE_TURN = 1, EGGMAN_FLEE = 4, EGGMAN_TURN = 9, EGGMAN_SIT = 0, EGGMAN_SIT_X_ZONE = 8,
  EGG_MOBILE_WAIT = 45, EGG_MOBILE_RISE = 80, EGG_MOBILE_SPEED = 4, EGG_MOBILE_GONE = DISPLAY_WIDTH + 120,
  LEVEL_X_ZONE = 12,
  MATRIX_FIRST = 4,
};

// the debris a beaten boss throws, one picked at random: its animation, variant and tiles (gUnknown_080BB41C, gUnknown_080BB42C,
// gUnknown_080BB434)
static const uint16_t DEBRIS_ANIM[DEBRIS_KINDS] = { 697, 697, 695, 695, 696, 696, 697, 695 };
static const uint8_t DEBRIS_VARIANT[DEBRIS_KINDS] = { 0, 1, 0, 1, 0, 1, 0, 0 };
static const uint8_t DEBRIS_TILES[DEBRIS_KINDS] = { 1, 1, 4, 4, 16, 12, 1, 4 };


static int toward(int v, int to) { return to > v ? v + 1 : to < v ? v - 1 : v; }

ActTask *boss_task(Object *o, ActRun run, ActEnd end, int priority) {
  ActTask *t = object_task(o, run, priority);
  if (t) t->end = end;
  return t;
}

void boss_display(Sprite *s, int sx, int sy) {
  s->x = (int16_t)sx;
  s->y = (int16_t)sy;
  if (objects_drawing()) display_sprite(s);
}

int boss_matrix(void) {
  static int tick = -1, next;
  if (tick != act.tick) { tick = act.tick; next = MATRIX_FIRST; }
  return next++ & 0xFF;
}


// --- the arena's camera (Bosses_SetCamBounds, Task_8017244) --------------------------------------------------------------
// The right edge goes to `maxX` at once; the top, bottom and left start at the screen's and move 1 px a frame to theirs, a
// bottom edge further down than the screen's starting 320 px below its top instead. The camera keeps maxX and maxY as the
// largest place of its top left corner, so the screen's size comes off the arena's right and bottom.
typedef struct { Object o; int minY, maxY, minX, maxX; } CamBounds;

static int cam_bounds_run(ActTask *t) {
  CamBounds *b = (CamBounds *)t->data;
  Camera *c = &act.cam;
  c->minY = toward(c->minY, b->minY);
  c->maxY = toward(c->maxY + DISPLAY_HEIGHT, b->maxY) - DISPLAY_HEIGHT;
  c->minX = toward(c->minX, b->minX);
  return !(c->minY == b->minY && c->maxY + DISPLAY_HEIGHT == b->maxY && c->minX == b->minX && c->maxX + DISPLAY_WIDTH == b->maxX);
}

void boss_cam_bounds(int minY, int maxY, int minX, int maxX) {
  Camera *c = &act.cam;
  int x = cam_x(), y = cam_y();
  c->minY = y; c->maxY = y; c->minX = x; c->maxX = maxX - DISPLAY_WIDTH;
  if (maxY > y + DISPLAY_HEIGHT) c->maxY = y + CAM_GROW - DISPLAY_HEIGHT;
  CamBounds *b = PLAIN_NEW(CamBounds);
  if (!b) return;
  b->minY = minY; b->maxY = maxY; b->minX = minX; b->maxX = maxX;
  object_task(&b->o, cam_bounds_run, PRIORITY_OBJECTS);
}

// --- the screen's shake (screen_shake.c) ----------------------------------------------------------------------------------
typedef struct { Object o; int amplitude, fade, step, frames, flags, angle; } Shake;

static int shake_run(ActTask *t) {
  Shake *sh = (Shake *)t->data;
  if (sh->frames == 0 || sh->amplitude <= 0) return 0;
  // a wave, or a random size from -255 to 256
  int factor = sh->flags & SHAKE_RANDOM ? (int)((uint32_t)(act_random() << 15) >> 23) - 0xFF : SINE[sh->angle] >> 6;
  int r = (sh->amplitude * factor) >> 16;
  if ((sh->flags & 3) == SHAKE_POSITIVE) r = r < 0 ? -r : r;
  else if ((sh->flags & 3) == SHAKE_NEGATIVE) r = r < 0 ? r : -r;
  if (!(sh->flags & SHAKE_EVEN_FRAMES) || !(act.tick & 1)) {
    if (sh->flags & SHAKE_HORIZONTAL) act.cam.shakeX = r;
    if (sh->flags & SHAKE_VERTICAL) act.cam.shakeY = r;
  }
  if (sh->frames > 0) sh->frames--;
  if (sh->amplitude > 0) sh->amplitude -= sh->fade;
  sh->angle = (sh->angle + sh->step) & 0x3FF;
  return 1;
}

static void shake_end(ActTask *t) {
  Shake *sh = (Shake *)t->data;
  if (sh->flags & SHAKE_HORIZONTAL) act.cam.shakeX = 0;
  if (sh->flags & SHAKE_VERTICAL) act.cam.shakeY = 0;
  object_end(t);
}

void boss_shake(int amplitude, int fade, int step, int frames, int flags) {
  Shake *sh = PLAIN_NEW(Shake);
  if (!sh) return;
  sh->amplitude = amplitude; sh->fade = fade; sh->step = step; sh->frames = frames; sh->flags = flags;
  boss_task(&sh->o, shake_run, shake_end, PRIORITY_SHAKE);
}

// --- a part flying off (sub_80168F0, Task_8016A14) --------------------------------------------------------------------------
// It falls 40/256 px a frame faster each frame and turns `spin` steps a frame, one way moving right and the other moving left,
// its horizontal scale moving by `grow` toward twice its size, mirrored, and the vertical following it. Its animation steps
// once, as it is made, and never again.
static int part_run(ActTask *t) {
  BossPart *b = (BossPart *)t->data;
  Sprite *s = &b->o.sprite;
  if (b->frames-- == 0) return 0;
  b->vy = s16(b->vy + PART_GRAVITY);
  b->x = s16(b->x + enemy_i(b->vx));
  b->y = s16(b->y + enemy_i(b->vy));
  b->tf.x = (int16_t)(b->x - cam_x());
  b->tf.y = (int16_t)(b->y - cam_y());
  if (b->vx > 0) {
    b->tf.rotation = (uint16_t)((b->tf.rotation + b->spin) & 0x3FF);
    if (b->tf.qScaleX > -PART_SCALE_MAX) b->tf.qScaleX = (int16_t)(b->tf.qScaleX - b->grow);
  } else {
    b->tf.rotation = (uint16_t)((b->tf.rotation - b->spin) & 0x3FF);
    if (b->tf.qScaleX < PART_SCALE_MAX) b->tf.qScaleX = (int16_t)(b->tf.qScaleX + b->grow);
  }
  b->tf.qScaleY = (int16_t)(b->tf.qScaleX < 0 ? -b->tf.qScaleX : b->tf.qScaleX);
  if (s->frameFlags & SPRITE_ROT_SCALE_ENABLE) {
    s->frameFlags = (s->frameFlags & ~(uint32_t)SPRITE_ROT_SCALE) | (uint32_t)boss_matrix();
    transform_sprite(s, &b->tf);
  } else {
    s->x = b->tf.x;
    s->y = b->tf.y;
  }
  if (objects_drawing()) display_sprite(s);
  return 1;
}

BossPart *boss_part(int x, int y, int tiles, int anim, int variant) {
  BossPart *b = OBJECT_NEW(BossPart);
  if (!b) return NULL;
  object_sprite_at(&b->o.sprite, vram_malloc((uint32_t)tiles), anim, variant, PART_ORDER, 0, 0, 0);
  b->o.sprite.frameFlags = PART_FLAGS;
  b->frames = PART_FRAMES;
  b->x = x; b->y = y;
  b->vx = PART_VX; b->vy = PART_VY; b->grow = PART_GROW;
  b->tf = (Transform){ 0, 0x100, 0x100, (int16_t)x, (int16_t)y };
  update_sprite(&b->o.sprite, 0);
  return object_task(&b->o, part_run, PRIORITY_OBJECTS) ? b : NULL;
}

// --- the debris and explosions (CreateNutsAndBoltsTask, Task_NutsAndBolts) -----------------------------------------------
// A piece moving on its own: its speed gains (ax, ay) each frame. It goes once it is more than 32 px off the screen's sides or
// below it, or once its animation has ended and `hold` frames have passed.
typedef struct { Object o; int qx, qy, vx, vy, ax, ay, hold; } Bolts;

static int bolts_run(ActTask *t) {
  Bolts *b = (Bolts *)t->data;
  Sprite *s = &b->o.sprite;
  b->vx = s16(b->vx + b->ax);
  b->vy = s16(b->vy + b->ay);
  b->qx += b->vx;
  b->qy += b->vy;
  s->x = (int16_t)(enemy_i(b->qx) - cam_x());
  s->y = (int16_t)(enemy_i(b->qy) - cam_y());
  if (b->hold != 0) b->hold--;
  if (s->x < -BOLTS_MARGIN || s->x > DISPLAY_WIDTH + BOLTS_MARGIN || s->y - BOLTS_MARGIN > DISPLAY_HEIGHT) return 0;
  if (!update_sprite(s, 0) && b->hold == 0) return 0;
  if (objects_drawing()) display_sprite(s);
  return 1;
}

static Bolts *bolts_new(uint32_t dest, int anim, int variant) {
  Bolts *b = OBJECT_NEW(Bolts);
  if (!b) return NULL;
  object_sprite_at(&b->o.sprite, dest, anim, variant, 0, 0, 0, 0);
  return object_task(&b->o, bolts_run, PRIORITY_OBJECTS) ? b : NULL;
}

// its tiles sit at a fixed place, shared by every explosion; its animation's script plays the explosion's sound
void boss_explosion(int qx, int qy) {
  Bolts *b = bolts_new(OBJ_VRAM + VRAM_EXPLOSION, ANIM_EXPLOSION, 0);
  if (!b) return;
  b->qx = qx; b->qy = qy;
  b->o.sprite.oamFlags = EXPLOSION_ORDER << 6;
  b->o.sprite.frameFlags = (uint32_t)ENEMY_PRIORITY << 12 | (act_random() & EXPLOSION_FLIPS);
}

// flung up at 6 px a frame at a random angle and kept for at least 32 frames, with an explosion up to 63 px above and 32 px
// either side
void boss_debris(int x, int y, int ay) {
  int i = (int)(act_random() % DEBRIS_KINDS);
  Bolts *b = bolts_new(vram_malloc(DEBRIS_TILES[i]), DEBRIS_ANIM[i], DEBRIS_VARIANT[i]);
  if (b) {
    b->qx = x << 8; b->qy = y << 8;
    b->o.sprite.frameFlags = (uint32_t)ENEMY_PRIORITY << 12;
    b->o.sprite.oamFlags = DEBRIS_ORDER << 6;
    b->ay = ay;
    b->hold = DEBRIS_HOLD;
  }
  // the original draws the angle whether or not the piece was made
  int angle = (int)(act_random() & 0x1FF);
  if (b) {
    b->vy = s16(-(SINE[angle] * DEBRIS_SPEED) >> 14);
    b->vx = s16(-(SINE[angle + 256] * DEBRIS_SPEED) >> 14);
  }
  uint32_t r = act_random();
  boss_explosion((x + (int)(r & 0x3F) - 32) << 8, (y - (int)((r & 0x3F0000) >> 16)) << 8);
}

// --- the Egg Mobile's escape (CreatePostBossEggMobile) -----------------------------------------------------------------------
// Eggman sits in it for 46 frames, rises 1 px a frame to 80 px up, turns round and flies off to the right at 4 px a frame until
// it is 120 px past the screen's right edge. Both sprites' tiles sit at fixed places.
enum { ASCENT, TURN, ESCAPE };
typedef struct { Object o; Sprite s2; int x, y, phase, wait, dx, dy; } EggMobile;

static int egg_mobile_run(ActTask *t) {
  EggMobile *m = (EggMobile *)t->data;
  Sprite *s = &m->o.sprite, *s2 = &m->s2;
  if (m->phase == ESCAPE) {
    m->dx += EGG_MOBILE_SPEED;
    if (m->x + m->dx - cam_x() > EGG_MOBILE_GONE) return 0;
  }
  int sx = m->x + m->dx - cam_x(), sy = m->y + (m->phase == ASCENT ? enemy_i(m->dy) : m->dy) - cam_y();
  s->x = (int16_t)sx; s->y = (int16_t)sy;
  int ended = !update_sprite(s, 0);
  boss_display(s, sx, sy);
  update_sprite(s2, 0);
  boss_display(s2, sx, sy);
  if (m->phase == ASCENT) {
    if (m->wait > EGG_MOBILE_WAIT) {
      m->dy -= 0x100;
      if (m->dy <= -EGG_MOBILE_RISE * 0x100) {
        m->phase = TURN;
        s->variant = EGG_MOBILE_TURN;
        s2->variant = EGGMAN_TURN;
        m->dy = enemy_i(m->dy);
      }
    } else m->wait++;
  } else if (m->phase == TURN && ended) {
    m->phase = ESCAPE;
    s->variant = EGG_MOBILE_STILL;
    s->frameFlags |= SPRITE_X_FLIP;
    s2->variant = act.stage.level == LEVEL_X_ZONE ? EGGMAN_SIT_X_ZONE : EGGMAN_SIT;
    s2->frameFlags |= SPRITE_X_FLIP;
  }
  return 1;
}

static void egg_mobile_end(ActTask *t) {
  EggMobile *m = (EggMobile *)t->data;
  object_sprite_free(&m->s2);
  object_end(t);
}

void boss_egg_mobile(int x, int y) {
  EggMobile *m = OBJECT_NEW(EggMobile);
  if (!m) return;
  m->x = x; m->y = y;
  object_sprite_at(&m->o.sprite, OBJ_VRAM + VRAM_EGG_MOBILE, ANIM_EGG_MOBILE, EGG_MOBILE_STILL, EGG_MOBILE_ORDER, ENEMY_PRIORITY, 0, 0);
  object_sprite_at(&m->s2, OBJ_VRAM + VRAM_EGGMAN, ANIM_EGGMAN, EGGMAN_FLEE, EGGMAN_ORDER, ENEMY_PRIORITY, 0, 0);
  boss_task(&m->o, egg_mobile_run, egg_mobile_end, PRIORITY_OBJECTS);
}

// --- the camera's pan (CreatePreBossCameraPan, Task_PreBossCameraPan) ----------------------------------------------------
// Only the top and bottom edges close in, 1 px a frame, as in Bosses_SetCamBounds.
typedef struct { Object o; int minY, maxY; } CamPan;

static int cam_pan_run(ActTask *t) {
  CamPan *b = (CamPan *)t->data;
  Camera *c = &act.cam;
  c->minY = toward(c->minY, b->minY);
  c->maxY = toward(c->maxY + DISPLAY_HEIGHT, b->maxY) - DISPLAY_HEIGHT;
  return !(c->minY == b->minY && c->maxY + DISPLAY_HEIGHT == b->maxY);
}

void boss_cam_pan(int minY, int maxY) {
  Camera *c = &act.cam;
  int y = cam_y();
  c->minY = y; c->maxY = y;
  if (maxY > y + DISPLAY_HEIGHT) c->maxY = y + CAM_GROW - DISPLAY_HEIGHT;
  CamPan *b = PLAIN_NEW(CamPan);
  if (!b) return;
  b->minY = minY; b->maxY = maxY;
  object_task(&b->o, cam_pan_run, PRIORITY_OBJECTS);
}


// --- Sonic against a boss (Coll_Player_Boss) -------------------------------------------------------------------------------
// His attack box on the boss's box 0 hits it and sends him back the way he came, in the air or not; otherwise his body on it
// hurts him.
int boss_hit(const Sprite *s, int x, int y) {
  Player *p = &act.player;
  const Hitbox *b0 = object_box(s, 0);
  if (!b0 || p->dead) return HIT_NONE;
  const Hitbox *body = object_box(&p->sprite, 0), *attack = object_box(&p->sprite, 1);
  int px = enemy_sonic_x(), py = enemy_sonic_y();
  if (attack && collide_overlap(x, y, b0, px, py, attack)) {
    p->xsp = -p->xsp;
    p->ysp = -p->ysp;
    return HIT_ENEMY;
  }
  if (body && collide_overlap(x, y, b0, px, py, body)) {
    world_damage(p);
    return HIT_PLAYER;
  }
  return HIT_NONE;
}

// sub_800BFEC: the sprite's box 1 on Sonic's body hurts him
int boss_hurt(const Sprite *s, int x, int y) {
  Player *p = &act.player;
  const Hitbox *b1 = object_box(s, 1), *body = object_box(&p->sprite, 0);
  if (!b1 || !body || p->dead || !collide_overlap(x, y, b1, enemy_sonic_x(), enemy_sonic_y(), body)) return HIT_NONE;
  world_damage(p);
  return HIT_PLAYER;
}

// --- Sonic against a boss (Coll_Player_Bosses_2_6) ------------------------------------------------------------------------
// His attack box on the boss's box 0 while in the air hits it and sends him back the way he came; otherwise his body on either
// of its boxes hurts him, whether or not he can be hurt then. There is no CPU partner here.
int boss_hit26(const Sprite *s, int x, int y) {
  Player *p = &act.player;
  if (p->dead) return HIT_NONE;
  const Hitbox *b0 = object_box(s, 0), *b1 = object_box(s, 1);
  const Hitbox *body = object_box(&p->sprite, 0), *attack = object_box(&p->sprite, 1);
  int px = enemy_sonic_x(), py = enemy_sonic_y();
  if (attack && b0 && p->air && collide_overlap(x, y, b0, px, py, attack)) {
    p->xsp = -p->xsp;
    p->ysp = -p->ysp;
    return HIT_ENEMY;
  }
  if (body && ((b0 && collide_overlap(x, y, b0, px, py, body)) || (b1 && collide_overlap(x, y, b1, px, py, body)))) {
    world_damage(p);
    return HIT_PLAYER;
  }
  return HIT_NONE;
}

// the music manager's boss state (gMusicManagerState.unk1), which it acts on after this frame's calls (music.c)
void boss_music(int state) { music_call(MUSIC_STATE, state); }
