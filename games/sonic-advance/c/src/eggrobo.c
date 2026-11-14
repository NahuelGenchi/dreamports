// The Super Egg Robo, the Moon Zone's boss (SAT-R decompilation, src/game/sa1/stage/enemies/boss_xtra_super_egg_robot.c,
// and its attacks in src/game/sa1/stage/player_super_sonic.c, checked in the USA ROM). Translated from the JavaScript
// version's engine/eggrobo.js.

#include "extra.h"
#include "bosses.h"
#include "terrain.h"

static inline int sin10(int a) { return SINE[a & 0x3FF] >> 6; }
static inline int cos10(int a) { return SINE[(a & 0x3FF) + 256] >> 6; }

enum {
  PRIORITY_BOSS = 0x2000, PRIORITY_PARTS = 0x2001,
  FALLING = 0x2, DEFEATED = 0x80, WAITING = 0x400000,
  DISPCNT_WIN0 = 0x2000, DISPCNT_OBJWIN = 0x8000,
  ANIM_HEAD = 665, ANIM_BODY = 666, ANIM_THIGH = 667, ANIM_SHIN = 668, ANIM_KNEE = 669,
  ANIM_CAPSULE = 670, ANIM_CAPSULE_HALF = 671, ANIM_GROUND_FIRE = 672, ANIM_HAND = 673, ANIM_JOINT = 674,
  ANIM_ROCK_BIG = 676, ANIM_ROCK_MID = 677, ANIM_ROCK_SMALL = 678, ANIM_ROBO_BLAST = 611,
  HEAD_TILES = 64, CAPSULE_TILES = 8, LASER_TILES = 24,
  VRAM_CAPSULE = OBJ_VRAM + 0x2580,
  VRAM_ARM = OBJ_VRAM + 0x2600,
  VRAM_BEARING = OBJ_VRAM + 0x2E00,
  VRAM_ROCK0 = OBJ_VRAM + 0x2E80,
  VRAM_ROCK1 = OBJ_VRAM + 0x3080,
  VRAM_ROCK2 = OBJ_VRAM + 0x3100,
  SE_ITEM_BOX = 138, SE_ROCK_BREAK = 126, SE_LASER = 155,
};

enum {
  PK_BODY, PK_HEAD, PK_BEARING, PK_JOINT, PK_ELBOW, PK_HAND, PK_THIGH, PK_KNEE, PK_SHIN, PK_FOOT,
};

typedef struct Part Part;
typedef struct {
  int qx, qy, vx, vy, ax, ay;
  int timer, rounds, flags, done;
  int offsetX, baseY, hits, flash, capsule;
  int state, next;
  Part *parts[18];
  int partCount;
} SuperEggRobo;

struct Part {
  Object o;
  Transform tf;
  int kind, index;
  Part *parent;
  int ox, oy, dx, dy, qx, qy;
  uint16_t angle, rel;
  int count, scale;
  SuperEggRobo *boss;
};

static SuperEggRobo *g_robo;

static const uint8_t NEAR[20] = { 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0 };

static int ease(Part *part, uint16_t target, int speed) {
  uint16_t v = part->rel;
  if (target == v) return 1;
  if (u16(target - v) < 0x8000u) {
    int v2 = v + speed;
    part->rel = u16(v2);
    if (u16(target - v2) >= 0x8000u) { part->rel = target; return 1; }
  } else {
    int v2 = v - speed;
    part->rel = u16(v2);
    if (u16(target - v2) < 0x8000u) { part->rel = target; return 1; }
  }
  return 0;
}

static int box_overlap(int x1, int y1, const Hitbox *a, int x2, int y2, const Hitbox *b) {
  return x1 + a->right >= x2 + b->left && x2 + b->right >= x1 + a->left
      && y1 + a->bottom >= y2 + b->top && y2 + b->bottom >= y1 + a->top;
}

static int hurts(const Sprite *s, int x, int y) {
  Player *p = &act.player;
  const Hitbox *a = &s->hitboxes[1], *b = &p->sprite.hitboxes[0];
  if (a->index < 0 || b->index < 0 || p->dead) return 0;
  if (!box_overlap(x, y, a, (int)p->x, (int)p->y, b)) return 0;
  hurt_super_sonic(p);
  return 1;
}

static int struck(const Sprite *s, int x, int y) {
  const Player *p = &act.player;
  const Hitbox *a = &s->hitboxes[0], *b = &p->sprite.hitboxes[1];
  if (a->index < 0 || b->index < 0 || p->dead) return 0;
  return box_overlap(x, y, a, (int)p->x, (int)p->y, b);
}

static int can_hurt(const SuperEggRobo *boss) {
  return act.player.invulnerable == 0 && !(boss->flags & DEFEATED);
}

int moon_boss_down(void) { return g_robo && (g_robo->flags & DEFEATED) != 0; }
void moon_warning_ready(void) { if (g_robo) g_robo->flags &= ~WAITING; }

// --- rocks, ground fire, capsules, halves, nuts & bolts ---------------------------------------------------------
typedef struct {
  Object o;
  Transform tf;
  int qx, qy, vx, vy, kind;
  uint16_t angle;
  int16_t spin;
  int16_t scaleX, scaleY;
} Rock;

static int rock_run(ActTask *t);
static void spawn_rock(int qx, int qy, int kind) {
  Rock *r = OBJECT_NEW(Rock);
  if (!r) return;
  r->qx = qx; r->qy = qy; r->kind = kind;
  if (qx == (512 << 8)) {
    r->vx = s16(-((act_random() << 14) >> 22));
    r->vy = (int)((act_random() & 0xFF00u) >> 8);
  } else {
    r->vx = s16(((act_random() & 0x3FF00u) >> 8) - 0x300);
    r->vy = s16(-((int)(act_random() & 0x3FF00u) >> 8) - 0x80);
  }
  if (kind == 2) { r->vx >>= 2; r->vy >>= 2; }
  r->angle = u16(act_random() >> 8);
  r->spin = s16(((act_random() << 11) >> 19) - 0x1000);
  r->scaleX = 256; r->scaleY = 256;
  if (kind == 0) {
    r->spin = s16(r->spin >> 1);
    r->scaleX = (int16_t)(r->scaleX - ((act_random() & 0x4000u) >> 8));
    r->scaleY = (int16_t)(r->scaleY - ((act_random() & 0x4000u) >> 8));
  }
  if (act_random() & 0x10000u) r->scaleY = (int16_t)(-r->scaleY);
  uint32_t dest = kind == 0 ? VRAM_ROCK0 : kind == 1 ? VRAM_ROCK1 : VRAM_ROCK2;
  int anim = kind == 0 ? ANIM_ROCK_BIG : kind == 1 ? ANIM_ROCK_MID : ANIM_ROCK_SMALL;
  object_sprite_at(&r->o.sprite, dest, anim, 0, 12, 1, 0, 0);
  object_task(&r->o, rock_run, PRIORITY_PARTS + (kind == 2 ? 2 : 1));
}

static int rock_run(ActTask *t) {
  Rock *r = (Rock *)t->data;
  if (r->qx < -(32 << 8) || r->qx > (512 << 8) || r->qy < -(32 << 8) || r->qy > (320 << 8)) return 0;
  if (supersonic_dashing(&act.player)) {
    if (struck(&r->o.sprite, r->qx >> 8, r->qy >> 8)) {
      for (int i = 3 - r->kind; i > 0; i--) spawn_rock(r->qx, r->qy, 2);
      play_song(SE_ROCK_BREAK);
      return 0;
    }
  } else if (g_robo && can_hurt(g_robo)) {
    hurts(&r->o.sprite, r->qx >> 8, r->qy >> 8);
  }
  update_sprite(&r->o.sprite, 0);
  r->tf.x = (int16_t)((r->qx >> 8) - cam_x());
  r->tf.y = (int16_t)((r->qy >> 8) - cam_y());
  r->tf.rotation = r->angle >> 6;
  r->tf.qScaleX = r->scaleX; r->tf.qScaleY = r->scaleY;
  r->o.sprite.frameFlags = (r->o.sprite.frameFlags & ~(uint32_t)SPRITE_ROT_SCALE) | (uint32_t)boss_matrix() | SPRITE_ROT_SCALE_ENABLE;
  transform_sprite(&r->o.sprite, &r->tf);
  display_sprite(&r->o.sprite);
  r->qx += r->vx; r->qy += r->vy;
  r->vy = s16(r->vy + 7);
  r->angle = u16(r->angle + r->spin);
  return 1;
}

typedef struct { Object o; int qx, qy; } GroundFire;

static int ground_fire_run(ActTask *t) {
  GroundFire *gf = (GroundFire *)t->data;
  if ((gf->o.sprite.frameFlags & SPRITE_ANIM_OVER) || gf->qx < -(32 << 8) || gf->qx > (512 << 8)) return 0;
  int cx = cam_x();
  gf->qy += terrain_tile_floor((gf->qx >> 8) + moon_ground_scroll(cx, act_stage_time()) - cx, gf->qy >> 8, 1, 8) << 8;
  if (!supersonic_dashing(&act.player) && g_robo && can_hurt(g_robo)) hurts(&gf->o.sprite, gf->qx >> 8, gf->qy >> 8);
  update_sprite(&gf->o.sprite, 0);
  boss_display(&gf->o.sprite, (gf->qx >> 8) - cx, (gf->qy >> 8) - cam_y());
  return 1;
}

static void spawn_ground_fire(int qx, int qy) {
  GroundFire *gf = OBJECT_NEW(GroundFire);
  if (!gf) return;
  gf->qx = qx; gf->qy = qy;
  object_sprite_at(&gf->o.sprite, vram_malloc(LASER_TILES), ANIM_GROUND_FIRE, 0, 12, 1, 0, 0);
  object_task(&gf->o, ground_fire_run, PRIORITY_PARTS + 1);
}

typedef struct {
  Object o;
  Transform tf;
  int qx, qy, vx, vy;
  uint16_t angle;
  int spin;
  int16_t scaleX;
} CapsuleHalf;

static int capsule_half_run(ActTask *t) {
  CapsuleHalf *h = (CapsuleHalf *)t->data;
  if (h->qx < -(32 << 8) || h->qx > (512 << 8) || h->qy < -(32 << 8) || h->qy > (320 << 8)) return 0;
  update_sprite(&h->o.sprite, 0);
  h->tf.x = (int16_t)((h->qx >> 8) - cam_x());
  h->tf.y = (int16_t)((h->qy >> 8) - cam_y());
  h->tf.rotation = h->angle >> 6;
  h->tf.qScaleX = h->scaleX; h->tf.qScaleY = 256;
  h->o.sprite.frameFlags = (h->o.sprite.frameFlags & ~(uint32_t)SPRITE_ROT_SCALE) | (uint32_t)boss_matrix() | SPRITE_ROT_SCALE_ENABLE;
  transform_sprite(&h->o.sprite, &h->tf);
  display_sprite(&h->o.sprite);
  h->qx += h->vx; h->qy += h->vy;
  h->vy = s16(h->vy + 7);
  h->angle = u16(h->angle + h->spin);
  return 1;
}

static void spawn_halves(int qx, int qy) {
  for (int i = 0; i < 2; i++) {
    CapsuleHalf *h = OBJECT_NEW(CapsuleHalf);
    if (!h) continue;
    h->qx = qx; h->qy = qy;
    h->vx = s16(-(((int)(act_random() & 0x7F00u) >> 8) + 0x80));
    h->vy = s16(((int)(act_random() & 0x7F00u) >> 8) + 0x40);
    h->angle = 0;
    h->spin = s16(((act_random() << 13) >> 21) - (4 << 8));
    h->scaleX = (i & 1) ? -256 : 256;
    if (i & 1) h->vx = s16(-h->vx);
    // both halves draw from the capsule's fixed place (VRAM_RESERVED_BOSS_XTRA_CAPSULE), not from the heap
    object_sprite_at(&h->o.sprite, VRAM_CAPSULE, ANIM_CAPSULE_HALF, 0, 12, 1, 0, 0);
    object_task(&h->o, capsule_half_run, PRIORITY_PARTS + 1);
  }
}

typedef struct {
  Object o;
  int qx, qy, vx, vy, count, stage, shake;
} Capsule;

static void draw_capsule(Sprite *s, int x, int y) {
  update_sprite(s, 0);
  int sx = x - cam_x(), sy = y - cam_y();
  s->frameFlags |= SPRITE_Y_FLIP;
  boss_display(s, sx, sy);
  s->frameFlags &= ~SPRITE_Y_FLIP;
  boss_display(s, sx, sy);
}

static int capsule_capture(Capsule *c) {
  Player *p = &act.player;
  if (supersonic_captured()) return 0;
  if (!struck(&c->o.sprite, c->qx >> 8, c->qy >> 8)) return 0;
  if (supersonic_dashing(p)) {
    play_song(SE_ITEM_BOX);
    scatter_launch_capsule(c->qx >> 8, c->qy >> 8, 8, p->layer);
    spawn_halves(c->qx, c->qy);
    return -1;
  }
  if (p->invulnerable != 0 || (g_robo && (g_robo->flags & DEFEATED))) return 0;
  c->o.sprite.variant = 3;
  supersonic_capture(0);
  c->stage = 2;
  return 1;
}

static int capsule_run(ActTask *t) {
  Capsule *c = (Capsule *)t->data;
  Player *p = &act.player;
  int x = c->qx >> 8, y = c->qy >> 8;
  switch (c->stage) {
    case 0: // thrown
      if (c->qx < -(32 << 8) || c->qx > (480 << 8)) return 0;
      draw_capsule(&c->o.sprite, x, y);
      c->qx += c->vx; c->qy += c->vy;
      if (--c->count <= 0) { c->o.sprite.variant = 2; c->vx = 0; c->vy = 0; c->stage = 1; }
      return 1;
    case 1: case 4: { // homing / shooting
      if (c->qx < -(32 << 8) || c->qx > (480 << 8)) return 0;
      int caught = capsule_capture(c);
      if (caught < 0) return 0;
      draw_capsule(&c->o.sprite, x, y);
      if (caught > 0) return 1;
      c->qx += c->vx; c->qy += c->vy;
      if (c->stage == 4) return 1;
      int py = (int)(p->y * 256.0);
      if (py - c->qy < -(8 << 8)) { c->vy = -(1 << 8); return 1; }
      if (py - c->qy > (8 << 8)) { c->vy = (1 << 8); return 1; }
      c->vx = -(3 << 8); c->vy = 0; c->stage = 4;
      return 1;
    }
    case 2: // closing
      if (p->invulnerable != 0) { supersonic_capture(-1); spawn_halves(c->qx, c->qy); return 0; }
      c->qx = (int)(p->x * 256.0); c->qy = (int)(p->y * 256.0);
      draw_capsule(&c->o.sprite, c->qx >> 8, c->qy >> 8);
      if (c->o.sprite.frameFlags & SPRITE_ANIM_OVER) {
        c->count = 240;
        supersonic_capture(1);
        c->o.sprite.variant = 1;
        c->stage = 3;
      }
      return 1;
    case 3: // holding
      if (p->invulnerable != 0 || --c->count < 0) {
        supersonic_capture(-1);
        spawn_halves(c->qx, c->qy);
        return 0;
      }
      if (p->pressedDirs & (0x10 | 0x20)) c->count -= 20;
      supersonic_captured_step();
      c->qx = (int)(p->x * 256.0) + c->shake;
      c->qy = (int)(p->y * 256.0);
      c->shake = (((p->pressedDirs & 0x10) << 1) - (p->pressedDirs & 0x20)) << 5;
      draw_capsule(&c->o.sprite, c->qx >> 8, c->qy >> 8);
      return 1;
  }
  return 0;
}

static void spawn_capsule(int qx, int qy) {
  Capsule *c = OBJECT_NEW(Capsule);
  if (!c) return;
  c->qx = qx; c->qy = qy; c->vx = -(1 << 8); c->vy = 0; c->count = 48; c->stage = 0; c->shake = 0;
  object_sprite_at(&c->o.sprite, vram_malloc(CAPSULE_TILES), ANIM_CAPSULE, 0, 12, 1, 0, 0);
  object_task(&c->o, capsule_run, PRIORITY_PARTS);
}

// --- laser triangle (sub_8052150 + sub_8006DB4) ---------------------------------------------------------------
static void triangle_lines(uint8_t *buf, const uint8_t t[8], int right) {
  int line = t[1] < t[5] ? t[1] : t[5];
  int end = t[1] > t[5] ? t[1] : t[5];
  int at = line * 2;
  int dx[2] = { s16(t[2] - t[0]), s16(t[6] - t[4]) };
  int dy[2] = { s16(t[3] - t[1]), s16(t[7] - t[5]) };
  int ax[2] = { s16((dx[0] < 0 ? -dx[0] : dx[0]) * 2), s16((dx[1] < 0 ? -dx[1] : dx[1]) * 2) };
  int ay[2] = { s16((dy[0] < 0 ? -dy[0] : dy[0]) * 2), s16((dy[1] < 0 ? -dy[1] : dy[1]) * 2) };
  uint8_t edge[2] = { t[0], t[4] };
  int err[2] = { s16(-dy[0]), s16(-dy[1]) };
  #define PUT(k, v) do { if (at + (k) < DISPLAY_HEIGHT * 2) buf[at + (k)] = u8(v); } while (0)
  if (line != end && t[1] < t[5]) {
    for (; line < end; line++, at += 2) {
      PUT(0, right); PUT(1, edge[0]); err[0] = s16(err[0] + ax[0]);
      while (err[0] >= 0) {
        if (dx[0] > 0) { if (right > edge[0]) edge[0] = u8(edge[0] + 1); err[0] = s16(err[0] - ay[0]); }
        else { if (edge[0] != 0) edge[0] = u8(edge[0] - 1); err[0] = s16(err[0] - ay[0]); if (err[0] >= 0) PUT(1, edge[0]); }
      }
    }
  } else {
    for (; line < end; line++, at += 2) {
      PUT(0, edge[1]); PUT(1, 0); err[1] = s16(err[1] + ax[1]);
      while (err[1] >= 0) {
        if (dx[1] > 0) { if (right > edge[1]) edge[1] = u8(edge[1] + 1); err[1] = s16(err[1] - ay[1]); if (err[1] >= 0) PUT(0, edge[1] + 1); }
        else { if (edge[1] != 0) edge[1] = u8(edge[1] - 1); err[1] = s16(err[1] - ay[1]); }
      }
    }
  }
  end = t[3] < t[7] ? t[3] : t[7];
  for (; line < end; line++, at += 2) {
    PUT(0, edge[1]); PUT(1, edge[0]);
    err[0] = s16(err[0] + ax[0]); err[1] = s16(err[1] + ax[1]);
    while (err[0] >= 0) {
      if (dx[0] > 0) { if (right > edge[0]) edge[0] = u8(edge[0] + 1); err[0] = s16(err[0] - ay[0]); }
      else { if (edge[0] != 0) edge[0] = u8(edge[0] - 1); err[0] = s16(err[0] - ay[0]); if (err[0] >= 0) PUT(1, edge[0]); }
    }
    while (err[1] >= 0) {
      if (dx[1] > 0) { if (right > edge[1]) edge[1] = u8(edge[1] + 1); err[1] = s16(err[1] - ay[1]); if (err[1] >= 0) PUT(0, edge[1] + 1); }
      else { if (edge[1] != 0) edge[1] = u8(edge[1] - 1); err[1] = s16(err[1] - ay[1]); }
    }
  }
  end = t[3] > t[7] ? t[3] : t[7];
  if (t[3] <= t[7]) {
    for (; line < end; line++, at += 2) {
      PUT(0, edge[1]); PUT(1, 0); err[1] = s16(err[1] + ax[1]);
      while (err[1] >= 0) {
        if (dx[1] > 0) { if (right > edge[1]) edge[1] = u8(edge[1] + 1); err[1] = s16(err[1] - ay[1]); if (err[1] >= 0) PUT(0, edge[1] + 1); }
        else { if (edge[1] != 0) edge[1] = u8(edge[1] - 1); err[1] = s16(err[1] - ay[1]); }
      }
    }
  } else {
    for (; line < end; line++, at += 2) {
      PUT(0, right); PUT(1, edge[0]); err[0] = s16(err[0] + ax[0]);
      while (err[0] >= 0) {
        if (dx[0] > 0) { if (right > edge[0]) edge[0] = u8(edge[0] + 1); err[0] = s16(err[0] - ay[0]); }
        else { if (edge[0] != 0) edge[0] = u8(edge[0] - 1); err[0] = s16(err[0] - ay[0]); if (err[0] >= 0) PUT(1, edge[0]); }
      }
    }
  }
  #undef PUT
}

static int clamp_int(int v, int hi) { return v < 0 ? 0 : v > hi ? hi : v; }

static int laser_beam(int sx, int sy, uint16_t a, const Part *head) {
  int c = cos10(head->angle >> 6), s = sin10(head->angle >> 6);
  int r7 = sx + (((s << 12) - c * 0xF00) >> 16);
  int r5 = sy + (((0 - (c << 12)) - s * 0xF00) >> 16);
  int r6 = r5 + 3, sl = 0, sp8 = 0;
  int slope = s16((sin10(a >> 6) << 8) / cos10(a >> 6));
  int inverse = 0x10000 / slope;
  int r1 = r5 - ((r7 * slope) >> 8), r8 = r1 + 3;
  if (r7 > 239) { int k = (slope * (240 - r7)) >> 8; r5 += k; r6 += k; r7 = 239; }
  if (r5 >= 159) return 0;
  int sb = r7, r4 = r7;
  if (r5 < 0) {
    r4 = r7 - ((r5 * inverse) >> 8); r5 = 0;
    if (r6 < 0) { sb = r7 - ((r6 * inverse) >> 8); r6 = 0; }
  }
  r5 = clamp_int(r5, 159); r6 = clamp_int(r6, 159);
  if (r8 > 159) {
    sp8 += ((160 - r8) * inverse) >> 8; r8 = 159;
    if (r1 > 159) { sl += (inverse * (160 - r1)) >> 8; r1 = 159; }
  }
  if (sl >= 239 || r5 >= 159 || r7 == sl || r5 == r1 || r6 == r8) return 0;
  sl = clamp_int(sl, 239);
  int r2 = clamp_int(sp8, 239);
  uint8_t t[8] = { u8(r4), u8(r5), u8(sl), u8(r1), u8(sb), u8(r6), u8(r2), u8(r8) };
  triangle_lines(moon_disp.win0Lines, t, r7 + 1);
  moon_disp.dispCnt |= DISPCNT_WIN0;
  moon_disp.win0On = 1;
  moon_disp.win0Top = clamp_int(r5, 159);
  moon_disp.win0Bottom = clamp_int(r8, 159);
  moon_disp.winOut = 0x1F1F;
  moon_disp.winIn = 0x3F3F;
  moon_disp.bldCnt = 0x3FBF;
  moon_disp.bldY = 14;
  return 1;
}

// --- robot parts ------------------------------------------------------------------------------------------------
static void place_part(Part *part) {
  const Part *parent = part->parent;
  int a = parent->angle >> 6;
  part->dx = (part->ox * cos10(a) - part->oy * sin10(a)) >> 8;
  part->dy = (part->ox * sin10(a) + part->oy * cos10(a)) >> 8;
  part->qx = part->dx + parent->qx;
  part->qy = part->dy + parent->qy;
  part->angle = u16(part->rel + parent->angle);
}

static void draw_turned(Part *part, int rotation, int scale, int dbl) {
  Sprite *s = &part->o.sprite;
  part->tf.x = (int16_t)((part->qx >> 8) - cam_x());
  part->tf.y = (int16_t)((part->qy >> 8) - cam_y());
  part->tf.rotation = (uint16_t)rotation;
  part->tf.qScaleX = (int16_t)scale;
  part->tf.qScaleY = (int16_t)scale;
  s->frameFlags = (s->frameFlags & ~(uint32_t)(SPRITE_ROT_SCALE | SPRITE_DOUBLE_SIZE))
                | (uint32_t)boss_matrix() | SPRITE_ROT_SCALE_ENABLE | (dbl ? SPRITE_DOUBLE_SIZE : 0u);
  transform_sprite(s, &part->tf);
  display_sprite(s);
}

static void finish_part(const Part *part, SuperEggRobo *boss) { boss->done |= 1 << part->index; }

static int part_run(ActTask *t) {
  if (!g_robo) return 0;
  Part *part = (Part *)t->data;
  SuperEggRobo *boss = part->boss;
  Sprite *s = &part->o.sprite;
  int mine = (NEAR[part->index] & 1) != 0;
  switch (part->kind) {
    case PK_BODY: {
      part->qx = part->dx + (boss->offsetX << 8) + boss->qx;
      part->qy = part->dy + (boss->baseY << 8) + boss->qy;
      part->angle = part->rel;
      if (can_hurt(boss)) hurts(s, part->qx >> 8, part->qy >> 8);
      update_sprite(s, 1);
      s->x = 0x80; s->y = 0x80;
      s->frameFlags = (s->frameFlags & ~0x18000u) | 0x10000u;
      queue_sprite_map(s);
      transform_background(&e.bgAffine[0], part->angle >> 6, 0x100, 0x100, 0x7C, 0x80,
                           (part->qx >> 8) - cam_x(), (part->qy >> 8) - cam_y());
      int lean = s16(u16(boss->parts[boss->state == 4 || boss->state == 5 ? 2 : 7]->rel - 0x4000)) >> 2;
      switch (boss->state) {
        case 4: ease(part, u16(lean), 64); break;
        case 5: part->rel = u16(lean); break;
        case 6: ease(part, u16(lean), 64); break;
        case 7: part->rel = u16(lean); break;
        case 0: ease(part, 0x800, 0x80); break;
        case 1: ease(part, 0xF800, 0x80); break;
        case 13: ease(part, 0, 0x80); break;
        case 14: ease(part, 0x4000, 0x200); break;
        default: ease(part, 0, 0x80); break;
      }
      break;
    }
    case PK_HEAD: {
      place_part(part);
      int x = part->qx >> 8, y = part->qy >> 8;
      Player *p = &act.player;
      if (supersonic_dashing(p) && struck(s, x, y)) {
        if (!(boss->flags & DEFEATED) && boss->flash <= 0) {
          boss->flash = 0x20;
          supersonic_bounce(p);
          if (--boss->hits <= 0) {
            moon_disp.dispCnt &= ~DISPCNT_WIN0;
            moon_disp.bldCnt = 0;
            moon_disp.win0On = 0;
            boss->state = boss->next = 13;
            boss->vx = 0x180; boss->vy = -0x100;
            boss->flags |= DEFEATED; boss->timer = 0;
            act.clockStopped = 1;
            world_add_score(1000);
          }
        }
      } else if (can_hurt(boss)) {
        hurts(s, x, y);
      }
      if (!(boss->flags & DEFEATED) || boss->flash != 0) {
        if (!p->dead) {
          moon_disp.dispCnt &= ~DISPCNT_OBJWIN;
          moon_disp.winOut = 0; moon_disp.bldCnt = 0; moon_disp.bldY = 0;
        }
        if (boss->flash != 0) {
          if (!(act_stage_time() & 2)) {
            s->frameFlags = (s->frameFlags & ~SPRITE_OBJ_MODE) | (2u << 7);
            moon_disp.dispCnt |= DISPCNT_OBJWIN;
            moon_disp.winOut = 0x3F1F; moon_disp.bldCnt = 0xBF; moon_disp.bldY = 16;
          } else {
            s->frameFlags &= ~SPRITE_OBJ_MODE;
          }
          boss->flash--;
        } else {
          s->frameFlags &= ~SPRITE_OBJ_MODE;
        }
      } else {
        s->frameFlags &= ~SPRITE_OBJ_MODE;
      }
      update_sprite(s, 0);
      draw_turned(part, part->angle >> 6, 256, 0);
      switch (boss->state) {
        case 2: case 3: ease(part, 0, 0x200); break;
        case 10: if (ease(part, 0xF000, 0x200)) finish_part(part, boss); break;
        case 11:
          moon_disp.dispCnt &= ~DISPCNT_WIN0;
          if (part->count == 0) { s->variant = 1; play_song(SE_LASER); }
          if (part->count == 10) stop_song(SE_LASER);
          if (part->count > 15) {
            finish_part(part, boss);
            moon_disp.bldCnt = 0; moon_disp.win0On = 0;
            s->variant = 0;
          } else {
            uint16_t a = u16((256 - cos10(((part->count << 10) >> 6) & 0x3FF)) * 32 + (92 << 8));
            if (!p->dead && !laser_beam(x - cam_x(), y - cam_y(), a, part)) moon_disp.win0On = 0;
            part->count++;
          }
          break;
        case 12:
          if (!(part->count & 7)) {
            int fx = part->qx - (part->count << 10) - (100 << 8);
            if (fx < -(32 << 8)) finish_part(part, boss);
            else spawn_ground_fire(fx, boss->baseY << 8);
          }
          part->count++;
          break;
        case 13: ease(part, 0x1800, 0x100); break;
        case 14: ease(part, 0x2000, 0x100); break;
        default: ease(part, 0, 0x100); break;
      }
      break;
    }
    case PK_BEARING:
      place_part(part);
      update_sprite(s, 0);
      draw_turned(part, 0, part->scale, 1);
      switch (boss->state) {
        case 2: ease(part, 0, 0x100); break;
        case 3: ease(part, mine ? 0x1000 : 0x2000, 0x200); break;
        case 4: case 6:
          if (mine == (boss->state == 4)) {
            ease(part, 0x6000, 0x100);
            if (part->rel == 0x6000 && part->count++ >= 30) finish_part(part, boss);
          }
          break;
        case 5: case 7:
          if (mine == (boss->state == 5)) {
            int k = part->count < 16 ? part->count : 16;
            int drop = (int)((uint32_t)((256 - cos10((k << 26) >> 22)) << 16) >> 10);
            ease(part, u16((boss->state == 5 ? 0x5800 : 0x6000) - drop), 0x800);
            if (part->count++ >= 76) finish_part(part, boss);
          }
          break;
        case 8: case 9:
          if (ease(part, 0xF000, 0x100)) {
            if (boss->timer++ >= 60) finish_part(part, boss);
            boss->timer = s16(boss->timer);
          }
          break;
        case 13: ease(part, 0xD000, 0x400); break;
        case 14: ease(part, 0xF000, 0x100); break;
        default: ease(part, 0, 0x100); break;
      }
      break;
    case PK_ELBOW:
      place_part(part);
      update_sprite(s, 0);
      draw_turned(part, 0, part->scale, 1);
      switch (boss->state) {
        case 2: ease(part, 0, 0x100); break;
        case 3: ease(part, mine ? 0x6000 : 0x6800, 0x200); break;
        case 4: if (mine) ease(part, 0x6000, 0x100); break;
        case 5: if (mine) ease(part, 0x1000, 0x400); break;
        case 6: if (!mine) ease(part, 0x6000, 0x100); break;
        case 7: if (!mine) ease(part, 0x1000, 0x400); break;
        case 8: ease(part, 0x4000, 0x200); break;
        case 9: ease(part, u16(0x4000 - ((act_random() << 12) >> 20)), 0x1000); break;
        case 13: ease(part, 0x2000, 0x400); break;
        case 14: ease(part, 0x1000, 0x100); break;
        default: ease(part, 0, 0x100); break;
      }
      break;
    case PK_JOINT:
      place_part(part);
      update_sprite(s, 0);
      boss_display(s, (part->qx >> 8) - cam_x(), (part->qy >> 8) - cam_y());
      ease(part, 0, 0x100);
      break;
    case PK_HAND: {
      place_part(part);
      int b = u16(part->angle - 0x4000) >> 6;
      if (can_hurt(boss)) {
        hurts(s, (part->qx >> 8) + ((-(cos10(b) * (23 << 8))) >> 16),
                 (part->qy >> 8) + ((-(sin10(b) * 0x1700)) >> 16));
      }
      update_sprite(s, 0);
      draw_turned(part, b, 256, 0);
      switch (boss->state) {
        case 2: ease(part, 0x4000, 0x200); break;
        case 3: ease(part, 0, 0x200); break;
        case 8: ease(part, u16(-part->parent->angle), 0x200); break;
        case 9:
          ease(part, u16(-part->parent->angle), 0x200);
          if (!(act_stage_time() & 0x1F)) spawn_rock(part->qx, part->qy + 0x1700, !(act_random() & 0x30000u) ? 1 : 0);
          break;
        case 13: ease(part, 0xB000, 0x400); break;
        case 14: ease(part, 0, 0x100); break;
        default: ease(part, 0, 0x100); break;
      }
      break;
    }
    case PK_THIGH:
      place_part(part);
      update_sprite(s, 0);
      draw_turned(part, part->angle >> 6, 256, 0);
      switch (boss->state) {
        case 2: case 3: ease(part, 0, 0x200); break;
        case 4: ease(part, part->parent->rel, 0x100); break;
        case 5: if (!mine) ease(part, 0xE800, 0x200); break;
        case 6: break;
        case 7: if (mine) ease(part, 0xE800, 0x200); break;
        case 0: ease(part, 0x1000, 0x80); break;
        case 13:
          ease(part, 0x4000, 0x200);
          if (boss->flash == 0 && part->rel == 0x4000) finish_part(part, boss);
          break;
        case 14: ease(part, 0xE800, 0x100); break;
        default: ease(part, 0, 0x80); break;
      }
      break;
    case PK_KNEE:
      part->qx = part->dx + part->parent->qx;
      part->qy = part->dy + part->parent->qy;
      part->angle = u16(part->rel + part->parent->angle);
      update_sprite(s, 0);
      boss_display(s, (part->qx >> 8) - cam_x(), (part->qy >> 8) - cam_y());
      ease(part, 0, 0x100);
      break;
    case PK_SHIN:
      place_part(part);
      update_sprite(s, 0);
      draw_turned(part, part->angle >> 6, 256, 0);
      switch (boss->state) {
        case 2: case 8: case 9: ease(part, 0, 0x200); break;
        case 0: ease(part, 0x2000, 0x80); break;
        case 1: ease(part, 0xE000, 0x80); break;
        case 13: ease(part, 0, 0x400); break;
        case 14: ease(part, 0x1800, 0x100); break;
        default: ease(part, 0x2000, 0x100); break;
      }
      break;
    case PK_FOOT:
      place_part(part);
      update_sprite(s, 0);
      draw_turned(part, part->angle >> 6, 256, 0);
      switch (boss->state) {
        case 2: case 3: break;
        case 4: case 5: case 6: case 7: ease(part, part->angle < 0x1000 ? u16(-part->angle) : 0, 0x100); break;
        case 0: case 11: case 12: ease(part, 0xE000, 0x100); break;
        case 13: ease(part, 0xF800, 0x400); break;
        default: ease(part, 0, 0x100); break;
      }
      break;
  }
  return 1;
}

static Part *add_part(SuperEggRobo *boss, int kind, Part *parent, int ox, int oy, int order, int prio,
                      uint32_t dest, int anim, int variant, uint16_t rel, int scale) {
  Part *p = OBJECT_NEW(Part);
  if (!p) return NULL;
  p->kind = kind; p->parent = parent; p->ox = ox; p->oy = oy; p->rel = rel; p->scale = scale; p->boss = boss;
  if (kind != PK_KNEE) { p->index = boss->partCount; boss->parts[boss->partCount++] = p; }
  object_sprite_at(&p->o.sprite, dest, anim, variant, order, prio, 0, 0);
  object_task(&p->o, part_run, PRIORITY_PARTS);
  return p;
}

// --- main task --------------------------------------------------------------------------------------------------
static int ground_check(SuperEggRobo *boss) {
  Part *body = boss->parts[0], *foot = boss->parts[14], *shin = boss->parts[13], *farFoot = boss->parts[17], *farShin = boss->parts[16];
  int minD = 9999;
  for (int i = 0; i < 2; i++) {
    Part *f = i ? farFoot : foot, *sh = i ? farShin : shin;
    int odd = i ? 0 : 1;
    int x = moon_ground_scroll(f->qx >> 8, act_stage_time());
    int a = f->angle >> 6, b = sh->angle >> 6;
    int y1 = (f->qy >> 8) + ((cos10(a) * (9 << 8) - (sin10(a) << 12)) >> 16) + 6;
    int d1 = terrain_tile_floor(x + 16, y1, 1, 8);
    int y2 = (f->qy >> 8) + ((sin10(b) * (21 << 8) + (cos10(b) << 11)) >> 16) + 6;
    int d2 = terrain_tile_floor(x + 21, y2, 1, 8);
    int d = d2 < d1 ? d2 : d1;
    if (d <= 0 && boss->state != 1 && (act_stage_time() & 1) == odd && !(act_random() & 0x30000u)) {
      moon_boss_brake_dust(f->qx >> 8, (y1 > y2 ? y1 : y2) - 2, -4);
    }
    if (d < minD) minD = d;
  }
  int a = body->angle >> 6;
  int y = (body->qy >> 8) + ((sin10(a) * (27 << 8) - cos10(a) * (22 << 8)) >> 16);
  int x = moon_ground_scroll((body->qx >> 8) + ((cos10(a) * (27 << 8) + sin10(a) * (22 << 8)) >> 16), act_stage_time());
  int db = terrain_tile_floor(x, y, 1, 8);
  return db < minD ? db : minD;
}

static void move_boss(SuperEggRobo *boss) {
  boss->qx += boss->vx; boss->qy += boss->vy;
  boss->vx = s16(boss->vx + boss->ax);
  boss->vy = s16(boss->vy + boss->ay);
}

typedef struct { Object o; SuperEggRobo boss; } RoboWrap;

static int robo_run(ActTask *t) {
  SuperEggRobo *boss = &((RoboWrap *)t->data)->boss;
  if (!(boss->flags & WAITING)) {
    if (boss->flags & FALLING) {
      move_boss(boss);
      boss->vy = s16(boss->vy + 16);
      int d = ground_check(boss);
      if (d < 0) { boss->qy += d << 8; boss->flags &= ~FALLING; boss->vy = 0; }
    } else {
      int d = ground_check(boss);
      if (d <= 3) boss->vy = d << 8; else boss->flags |= FALLING;
      move_boss(boss);
    }
  }
  switch (boss->state) {
    case 2: if (!(boss->flags & FALLING)) boss->next++; break;
    case 3: if (boss->timer++ >= 60) boss->next++; boss->timer = s16(boss->timer); break;
    case 9:
      if (boss->timer++ >= 300) { boss->rounds = 0; boss->next++; }
      boss->timer = s16(boss->timer);
      break;
    case 4: case 5: case 6: case 7: case 8: case 10: case 11:
      if (boss->done != 0) boss->next++;
      break;
    case 12:
      if (boss->done != 0) boss->next = ++boss->rounds < 4 ? 11 : 3;
      break;
    case 0:
      if (boss->qx < (416 << 8)) { boss->qy = -(128 << 8); boss->vy = 0; boss->vx = (4 << 8); }
      else { boss->ax = -16; boss->next = 1; }
      break;
    case 1:
      if (boss->qx < (416 << 8)) { boss->ax = 0; boss->vx = 0; boss->qx = (416 << 8); boss->next = 2; }
      else if (boss->vx < -(2 << 8)) boss->vx = -(2 << 8);
      break;
    case 13: if (boss->done != 0) boss->next = 14; break;
    case 14:
      if (!(boss->flags & FALLING)) {
        boss->ax = -16;
        if (boss->vx < -(6 << 8)) { boss->vx = -(6 << 8); boss->ax = 0; }
        if (boss->qx <= -(120 << 8)) boss->vx = 0;
      }
      break;
    default: boss->vx = 0; boss->ax = 0; break;
  }
  if (boss->flags & DEFEATED) {
    int fade = boss->timer - 120;
    fade = fade < 0 ? 0 : (fade >> 2);
    if (fade > 16) fade = 16;
    if (boss->flash == 0) {
      moon_disp.dispCnt &= ~DISPCNT_OBJWIN;
      moon_disp.winOut = 0x3F3F;
      moon_disp.bldCnt = 0xBF;
      moon_disp.bldY = (uint16_t)fade;
    }
    if (fade == 16) { g_robo = NULL; moon_defeated(); return 0; }
    // the next frame's fade is the last, and its save turns the interrupts off as this frame's picture is drawn
    if (((boss->timer + 1 - 120) >> 2) == 16) engine_lines_off_soon();
    if (!(act_stage_time() & 0xF) || (boss->state == 14 && !(act_stage_time() & 7))) {
      int dx = (int)((act_random() << 10) >> 18) - (32 << 8);
      int dy = (int)((act_random() << 9) >> 17) - (64 << 8);
      // sub_8017540 draws its flips, which the robot then replaces with plain priority 1 (frameFlags 0x1000)
      Sprite *blast = boss_explosion_at(boss->qx + (boss->offsetX << 8) + dx, boss->qy + (boss->baseY << 8) + dy, 14);
      if (blast) blast->frameFlags = 1u << 12;
    }
    if (boss->timer < 0x7FFF) boss->timer++;
  } else if (boss->state > 1 && --boss->capsule <= 0) {
    boss->capsule = 240;
    spawn_capsule((boss->offsetX << 8) + boss->qx - (21 << 8), (boss->baseY << 8) + boss->qy - (10 << 8));
  }
  if (boss->state != boss->next) {
    for (int i = 0; i < boss->partCount; i++) boss->parts[i]->count = 0;
    boss->done = 0; boss->timer = 0; boss->state = boss->next;
  }
  return 1;
}

ActTask *super_egg_robo_spawn(Slot *slot) {
  RoboWrap *w = OBJECT_NEW(RoboWrap);
  if (!w) return NULL;
  SuperEggRobo *boss = &w->boss;
  g_robo = boss;
  boss->qx = -0x10000; boss->qy = -0x3600;
  boss->flags = WAITING | FALLING;
  boss->baseY = slot->e.y;
  boss->hits = 8 - save.bytes[0x1A] * 2;
  boss->capsule = 240;

  Part *body = add_part(boss, PK_BODY, NULL, 0, 0, 21, 2, 0x4040, ANIM_BODY, 0, 0, 256);
  add_part(boss, PK_HEAD, body, 0x400, -0x1C00, 22, 2, vram_malloc(HEAD_TILES), ANIM_HEAD, 0, 0, 256);
  for (int arm = 0; arm < 2; arm++) {
    int ox = arm ? -0x500 : 0xB00, oy = arm ? -0x1900 : -0x1700, prio = arm ? 2 : 1;
    const int *ord = arm ? (const int[]){ 27, 28, 27, 28, 26 } : (const int[]){ 15, 16, 15, 16, 14 };
    Part *sh = add_part(boss, PK_BEARING, body, ox, oy, ord[0], prio, VRAM_BEARING, ANIM_JOINT, 0, 0, 384);
    Part *up = add_part(boss, PK_JOINT, sh, 0, 0x1400, ord[1], prio, VRAM_BEARING, ANIM_JOINT, 0, 0, 256);
    Part *el = add_part(boss, PK_ELBOW, up, 0, 0x1200, ord[2], prio, VRAM_BEARING, ANIM_JOINT, 0, 0, 320);
    Part *lo = add_part(boss, PK_JOINT, el, 0, 0x1200, ord[3], prio, VRAM_BEARING, ANIM_JOINT, 0, 0, 256);
    add_part(boss, PK_HAND, lo, 0, 0x800, ord[4], prio, VRAM_ARM, ANIM_HAND, 0, 0, 256);
  }
  Part *thigh = add_part(boss, PK_THIGH, body, 0x200, 0x500, 20, 1, vram_malloc(16), ANIM_THIGH, 0, 0xE000, 256);
  add_part(boss, PK_KNEE, thigh, 0, 0, 19, 1, vram_malloc(9), ANIM_KNEE, 0, 0, 256);
  Part *shin = add_part(boss, PK_SHIN, thigh, -0x900, 0xC00, 18, 1, vram_malloc(64), ANIM_SHIN, 0, 0, 256);
  add_part(boss, PK_FOOT, shin, 0x300, 0x1B00, 17, 1, vram_malloc(16), ANIM_THIGH, 2, 0, 256);
  Part *fThigh = add_part(boss, PK_THIGH, body, -0x600, 0x500, 23, 2, vram_malloc(16), ANIM_THIGH, 1, 0x2000, 256);
  Part *fShin = add_part(boss, PK_SHIN, fThigh, -0x900, 0xB00, 22, 2, vram_malloc(64), ANIM_SHIN, 1, 0, 256);
  add_part(boss, PK_FOOT, fShin, 0x300, 0x1B00, 24, 2, vram_malloc(16), ANIM_THIGH, 3, 0, 256);

  return object_task(&w->o, robo_run, PRIORITY_BOSS);
}
