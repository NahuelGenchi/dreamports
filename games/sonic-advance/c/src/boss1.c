// Neo Green Hill's boss, the Egg Hammer Tank (enemy kinds 21 and 22): the intro at the end of act 2, and the tank.
// Translated from the JavaScript version's engine/boss1.js and the original's boss_1_egg_hammer_tank.c, on the boss
// helpers in bosses.c.
//
// Kind 21 brings the camera in and Eggman taunts Sonic from the Egg Mobile; once it has flown off, kind 22 starts the
// fight. The tank rolls between the arena's edges with a hammer swinging over it on five arm segments. Jumps into its
// body hit it; the eighth hit beats it, its belt, arms and hammer fly off, it falls and smokes, and then Eggman leaves
// and the capsule rises.

#include "bosses.h"


enum {
  ANIM_BODY = 607, BODY_PLAIN = 1, BODY_SECOND = 2,
  ANIM_ARM = 608, ANIM_HAMMER = 609,
  ANIM_EGGMAN_BOSS = 610, EGGMAN_STILL = 0, EGGMAN_LAUGH = 1, EGGMAN_HURT = 2,
  ANIM_EGGMAN = 694, EGGMAN_LAUGH_EGGMOBILE = 2, EGGMAN_TURN_EGGMOBILE = 9,
  ANIM_EGG_MOBILE = 693, EGG_MOBILE_STILL = 0, EGG_MOBILE_TURN = 1,
  ANIM_BEATEN = 612,
  ANIM_BELT0 = 613, ANIM_BELT1 = 614, ANIM_BELT2 = 615, ANIM_BELT3 = 616,
  BODY_ORDER = 19, EGGMAN_ORDER = 18, PART_ORDER = 17,
  BODY_TILES = 64, EGGMAN_TILES = 8,
  ARMS = 5, ARM_STEP = 16, HAMMER_REACH = 96, PIVOT_UP = 36,
  SWING_LOW = -568, SWING_HIGH = 56,
  WAIT = 120, HITS_BEATEN = 8, HITS_LAST = 7, FLASH = 0x20, FLASH_LAST = 0x40,
  SCORE = 1000, PART_FRAMES = 180, BELT_FRAMES = 60,
  FLY_VX = 0x200, FLY_VY = -0x600, FLY_GRAVITY = 40, BELT_VX = 0x400, BELT_VY = -0x200,
  EGG_MOBILE_UP = 64, EGG_MOBILE_SPEED = 512, EGG_MOBILE_GONE = DISPLAY_WIDTH + 64,
  SE_BOSS_HIT = 143, SE_EXPLOSION = 144, SE_IMPACT = 145,
  OBJ_WINDOW = 0x100,
  PRIORITY_OBJECTS_ = 0x2000,
};

typedef struct { int rotation, x, y; } Pivot;
static Pivot pivot;

static Player *sonic(void) { return &act.player; }
static int I(int v) { return v >> 8; }
static int cos1024(int a) { return SINE[(a + 256) & 1023]; }
static int hammer_angle(int swing) {
  return swing < 0 ? (s16(-swing - 512) > 0 ? s16(-swing - 512) : 0) : swing > 0 ? -swing : 0;
}
static int sin1024(int a) { return SINE[a & 1023]; }

static void play(Sprite *s, int anim, int variant) {
  s->graphics.anim = (uint16_t)anim;
  s->variant = (uint8_t)variant;
  s->prevAnim = 0xFFFF;
  s->prevVariant = 0xFF;
}
static void flip(Sprite *s, int right) {
  s->frameFlags = (s->frameFlags & ~(uint32_t)SPRITE_X_FLIP) | (right ? 0 : SPRITE_X_FLIP);
}
static void draw(Sprite *s, int x, int y) {
  s->x = (int16_t)x;
  s->y = (int16_t)y;
  if (objects_drawing()) display_sprite(s);
}

// --- the intro (kind 21) --------------------------------------------------------------------------------------------------
typedef struct EggIntro EggIntro;
typedef int (*IntroPhase)(EggIntro *);
struct EggIntro {
  Object o;
  Sprite s2;
  IntroPhase phase;
  int qx, y;
};

static void intro_show(EggIntro *b, int x) {
  int ended = sprite_step(&b->o.sprite);
  int ended2 = sprite_step(&b->s2);
  (void)ended2;
  draw(&b->o.sprite, x - cam_x(), b->y - cam_y());
  draw(&b->s2, x - cam_x(), b->y - cam_y());
  (void)ended;
}

static int intro_approach(EggIntro *b);
static int intro_taunt(EggIntro *b);
static int intro_turn(EggIntro *b);
static int intro_leave(EggIntro *b);

static int intro_approach(EggIntro *b) {
  const Entity *e = &b->o.slot->e;
  intro_show(b, e->x);
  act.cam.minX = cam_x() < act.cam.maxX ? cam_x() : act.cam.maxX;
  if (e->x - cam_x() <= DISPLAY_WIDTH - 64) {
    sonic()->gsp = 0; sonic()->ignoreInput = 1;
    play(&b->s2, ANIM_EGGMAN, EGGMAN_LAUGH_EGGMOBILE);
    boss_music(0x11);
    b->phase = intro_taunt;
  }
  return 1;
}
static int intro_taunt(EggIntro *b) {
  const Entity *e = &b->o.slot->e;
  int ended2 = sprite_step(&b->s2);
  sprite_step(&b->o.sprite);
  draw(&b->o.sprite, e->x - cam_x(), b->y - cam_y());
  draw(&b->s2, e->x - cam_x(), b->y - cam_y());
  if (ended2) {
    play(&b->o.sprite, ANIM_EGG_MOBILE, EGG_MOBILE_TURN);
    play(&b->s2, ANIM_EGGMAN, EGGMAN_TURN_EGGMOBILE);
    b->phase = intro_turn;
  }
  return 1;
}
static int intro_turn(EggIntro *b) {
  const Entity *e = &b->o.slot->e;
  // the frame the Egg Mobile's turn ends, like the JavaScript's animate(), the pan starts at once
  int ended = sprite_step(&b->o.sprite);
  sprite_step(&b->s2);
  draw(&b->o.sprite, e->x - cam_x(), b->y - cam_y());
  draw(&b->s2, e->x - cam_x(), b->y - cam_y());
  if (!ended) return 1;
  play(&b->o.sprite, ANIM_EGG_MOBILE, EGG_MOBILE_STILL);
  play(&b->s2, ANIM_EGGMAN, EGGMAN_STILL);
  flip(&b->o.sprite, 0);
  flip(&b->s2, 0);
  boss_cam_pan(e->y - 48, e->y + DISPLAY_HEIGHT - 48);
  b->phase = intro_leave;
  return 1;
}
static int intro_leave(EggIntro *b) {
  const Entity *e = &b->o.slot->e;
  b->qx += 512;
  int x = e->x + I(b->qx);
  if (x - cam_x() > DISPLAY_WIDTH + 64) {
    sonic()->ignoreInput = 0;
    sonic()->jumpPressed = sonic()->attackPressed = 0;
    act.cam.maxX = act.stage.width - DISPLAY_WIDTH;
    return 0;
  }
  intro_show(b, x);
  return 1;
}
static int intro_run(ActTask *t) {
  EggIntro *b = (EggIntro *)t->data;
  return b->phase(b);
}
static void intro_end(ActTask *t) {
  EggIntro *b = (EggIntro *)t->data;
  object_sprite_free(&b->s2);
  object_end(t);
}
ActTask *egg_hammer_tank_intro_spawn(Slot *slot) {
  slot->gone = 1;
  EggIntro *b = OBJECT_NEW(EggIntro);
  if (!b) return NULL;
  b->o.slot = slot;
  b->o.x = slot->e.x;
  b->y = slot->e.y;
  b->phase = intro_approach;
  int top = s16(slot->e.y - 48), bottom = s16(slot->e.y + DISPLAY_HEIGHT - 48);
  boss_cam_pan(top, bottom);
  if (bottom > cam_y() + DISPLAY_HEIGHT) act.cam.maxY = bottom - DISPLAY_HEIGHT;
  act.cam.minX = slot->e.x - DISPLAY_WIDTH > 0 ? slot->e.x - DISPLAY_WIDTH : 0;
  act.cam.maxX = slot->e.x + 64 - DISPLAY_WIDTH;
  object_sprite(&b->o.sprite, ANIM_EGG_MOBILE, EGG_MOBILE_STILL, EGG_MOBILE_TURN, BODY_ORDER, ENEMY_PRIORITY, 0, 0);
  object_sprite(&b->s2, ANIM_EGGMAN, EGGMAN_STILL, EGGMAN_TURN_EGGMOBILE, EGGMAN_ORDER, ENEMY_PRIORITY, 0, 0);
  return act_task_add(intro_run, intro_end, b, PRIORITY_OBJECTS_);
}

// --- the tank (kind 22) ---------------------------------------------------------------------------------------------------
typedef struct EggTank EggTank;
typedef int (*TankPhase)(EggTank *);
typedef struct {
  Object o;
  int i, flying, ax, ay, qax, qay, vx, vy, t;
  int rotation;
} Arm;
typedef struct {
  Object o;
  int flying, rotation, hx, hy, qhx, qhy, vx, vy, spin, t;
} Hammer;

typedef struct {
  EggTank *tank;
  Arm *arm;
  Hammer *hammer;
} PartTask;

struct EggTank {
  Object o;
  Sprite s2;
  TankPhase phase;
  int x0, y0;
  int swing, speed, hits, flash, count, grounded, qx, qy, fall;
  int bodyAgain, eggmanAgain;
};

static EggTank *current_tank;
static Arm *arms[ARMS];
static Hammer *hammer;

static int body_update(EggTank *b) {
  Sprite *s = &b->o.sprite;
  if (b->bodyAgain) { b->bodyAgain = 0; sprite_start(s, s->variant); }
  if (!sprite_step(s)) return 0;
  if (s->graphics.anim == ANIM_BODY) {
    int next = s->variant == BODY_PLAIN ? BODY_SECOND : BODY_PLAIN;
    play(s, ANIM_BODY, next);
    sprite_step(s);
    b->bodyAgain = 1;
  }
  return 0;
}
static int eggman_update(EggTank *b) {
  Sprite *s = &b->s2;
  if (b->eggmanAgain) { b->eggmanAgain = 0; sprite_start(s, s->variant); }
  if (!sprite_step(s)) return 0;
  if (s->graphics.anim == ANIM_EGGMAN_BOSS && (s->variant == EGGMAN_LAUGH || s->variant == EGGMAN_HURT)) {
    play(s, ANIM_EGGMAN_BOSS, EGGMAN_STILL);
    sprite_step(s);
    b->eggmanAgain = 1;
  }
  return 0;
}

static void tank_show(EggTank *b, int x, int y) {
  body_update(b);
  eggman_update(b);
  int ey = b->o.sprite.graphics.anim == ANIM_BODY && b->o.sprite.variant == BODY_SECOND ? y - 1 : y;
  if (b->flash != 0) {
    b->flash = s8(b->flash - 1);
    if (b->flash > 16) {
      if (!(b->flash & 2) && !sonic()->dead) {
        b->o.sprite.frameFlags |= OBJ_WINDOW;
        act.bossFlash = 1;
      }
    } else if (!(b->flash & 2)) return;
  }
  draw(&b->o.sprite, x - cam_x(), y - cam_y());
  draw(&b->s2, x - cam_x(), ey - cam_y());
}
static void turn_at_edges(EggTank *b, int x) {
  Sprite *s = &b->o.sprite;
  if (x < act.cam.minX - 64) flip(s, 0), flip(&b->s2, 0);
  else if (x > act.cam.maxX + DISPLAY_WIDTH + 64) flip(s, 1), flip(&b->s2, 1);
}
static void set_pivot(EggTank *b, int x, int y) {
  (void)b;
  pivot.rotation = current_tank->swing & 0x3FF;
  pivot.x = s16(x - cam_x());
  pivot.y = s16(y - cam_y() - PIVOT_UP);
}
static int hit_test(EggTank *b, int x, int y) {
  b->o.sprite.frameFlags &= ~(uint32_t)OBJ_WINDOW;
  if (!sonic()->dead) act.bossFlash = 0;
  if (b->flash != 0) return HIT_NONE;
  Player *p = sonic();
  if (p->dead) return HIT_NONE;
  const Hitbox *b0 = object_box(&b->o.sprite, 0), *b1 = object_box(&b->o.sprite, 1);
  const Hitbox *body = object_box(&p->sprite, 0), *attack = object_box(&p->sprite, 1);
  int px = enemy_sonic_x(), py = enemy_sonic_y();
  if (!b0 || !b1) return HIT_NONE;
  if (attack) {
    if (body && collide_overlap(x, y, b1, px, py, body)) { world_damage(p); return HIT_PLAYER; }
    if (collide_overlap(x, y, b0, px, py, attack)) { p->xsp = -p->xsp; p->ysp = -p->ysp; return HIT_ENEMY; }
  }
  return HIT_NONE;
}
static void tank_beaten(EggTank *b, int x, int y, int dx, int dy);
static int tank_falling(EggTank *b);
static int tank_settled(EggTank *b);
static int tank_last(EggTank *b);
static int tank_wait2(EggTank *b);
static int tank_fight(EggTank *b) {
  set_pivot(b, s16(b->x0 + I(b->qx)), b->y0);
  b->swing = s16(b->swing + b->speed);
  if (!(b->swing > SWING_LOW && b->swing < SWING_HIGH)) {
    play_song(SE_IMPACT);
    b->speed = s16(-b->speed);
    boss_shake(0x800, 0x40, 0x100, -1, SHAKE_VERTICAL);
  }
  b->qx += (b->o.sprite.frameFlags & SPRITE_X_FLIP) ? 256 : -256;
  int x = s16(b->x0 + I(b->qx)), y = b->y0;
  int result = hit_test(b, x, y);
  if (result == HIT_ENEMY) {
    b->hits = s8(b->hits + 1); b->flash = FLASH;
    if (b->hits == HITS_LAST) { b->flash = FLASH_LAST; b->phase = tank_last; }
    else if (b->hits > 4) b->speed = b->speed > 0 ? b->hits + 1 : ~b->hits;
    play(&b->s2, ANIM_EGGMAN_BOSS, EGGMAN_HURT);
    play_song(SE_BOSS_HIT);
  } else if (result == HIT_PLAYER) play(&b->s2, ANIM_EGGMAN_BOSS, EGGMAN_LAUGH);
  turn_at_edges(b, x);
  tank_show(b, x, y);
  set_pivot(b, x, y);
  return 1;
}
static int tank_last(EggTank *b);
static void tank_show_beaten(EggTank *b, int x, int y) {
  body_update(b); eggman_update(b);
  draw(&b->o.sprite, x - cam_x(), y - cam_y());
  draw(&b->s2, x - cam_x(), y - cam_y());
}
static void tank_smoke(EggTank *b, int x, int y) {
  b->count = (b->count + 1) & 0xFFFF;
  if (!(b->count & 7)) boss_debris(x, y - 32, 0);
}
static int tank_settled(EggTank *b) {
  int x = s16(b->x0 + I(b->qx)), y = s16(b->y0 + I(b->qy));
  if (b->count > DISPLAY_WIDTH) {
    boss_egg_mobile(x, y - 32);
    boss_capsule(x, y);
    boss_music(0x30);
    return 0;
  }
  tank_smoke(b, x, y);
  tank_show_beaten(b, x, y);
  return 1;
}
static int tank_falling(EggTank *b) {
  b->fall = s16(b->fall + 40); b->qy += b->fall;
  int x = s16(b->x0 + I(b->qx)), y = s16(b->y0 + I(b->qy));
  int d = terrain_tile_floor(x, y - 8, 1, 8);
  if (d < 0) {
    b->qy += d << 8;
    b->fall = s16((b->fall >> 2) - b->fall);
    if (b->fall > -256) { b->fall = 0; b->phase = tank_settled; }
  }
  b->o.sprite.frameFlags &= ~(uint32_t)OBJ_WINDOW;
  tank_smoke(b, x, y);
  tank_show_beaten(b, x, y);
  return 1;
}
static void tank_beaten(EggTank *b, int x, int y, int dx, int dy) {
  b->hits = s8(b->hits + 1); b->flash = FLASH;
  play(&b->s2, ANIM_EGGMAN_BOSS, EGGMAN_HURT);
  b->fall = -512;
  world_add_score(SCORE);
  play_song(SE_EXPLOSION);
  for (int i = 0; i < ARMS; i++) if (arms[i]) arms[i]->flying = 1, arms[i]->t = -1;
  if (hammer) { hammer->flying = 1; hammer->t = -1; }
  b->qx += dx << 8; b->qy = dy << 8;
  b->count = 0;
  play(&b->o.sprite, ANIM_BEATEN, 0);
  int right = (b->o.sprite.frameFlags & SPRITE_X_FLIP) != 0;
  static const struct { int anim, way; } BELTS[4] = { { ANIM_BELT0, -1 }, { ANIM_BELT1, -1 }, { ANIM_BELT2, 1 }, { ANIM_BELT3, 1 } };
  for (int i = 0; i < 4; i++) {
    BossPart *p = boss_part(x, y, (int)sprite_tiles(BELTS[i].anim, 0, 0), BELTS[i].anim, 0);
    if (!p) continue;
    int way = BELTS[i].way;
    p->vx = (right ? -way : way) * BELT_VX;
    p->vy = BELT_VY; p->spin = 0; p->grow = 0;
    p->tf.qScaleX = (int16_t)(right ? -0x100 : 0x100);
    p->frames = BELT_FRAMES;
  }
  act.cam.minX = act.cam.maxX = cam_x();
  b->phase = tank_falling;
  tank_falling(b);
}
static int tank_last(EggTank *b) {
  b->speed = s16((b->o.sprite.frameFlags & SPRITE_X_FLIP) ? b->hits * 2 - 2 : -4 - (b->hits - 3) * 2);
  b->swing = s16(b->swing + b->speed);
  if (b->swing < -0x300) { b->swing = s16(b->swing + 0x400); b->qx -= cos1024(56) * 3; }
  else if (b->swing > 0x100) { b->swing = s16(b->swing - 0x400); b->qx += cos1024(56) * 3; }
  int dx = 0, dy = 0;
  if (b->swing <= SWING_LOW || b->swing > SWING_HIGH - 1) {
    if (b->grounded == 0) { b->grounded = 1; play_song(SE_IMPACT); boss_shake(0x800, 0x40, 0x100, -1, SHAKE_VERTICAL); }
    int theta = (b->swing <= SWING_LOW ? 0x200 - b->swing : b->swing) & 0x3FF;
    dx = ((cos1024(56) - cos1024(theta)) * 3) >> 9;
    if (b->swing <= SWING_LOW) dx = -dx;
    dy = -(((sin1024(theta) - sin1024(56)) * 3) >> 9);
  } else {
    b->grounded = 0;
    b->qx += (b->o.sprite.frameFlags & SPRITE_X_FLIP) ? 256 : -256;
  }
  int x = s16(b->x0 + I(b->qx) + dx), y = s16(b->y0 + dy);
  if (hit_test(b, x, y) == HIT_ENEMY) { tank_beaten(b, x, y, dx, dy); return tank_falling(b); }
  if (dy == 0) turn_at_edges(b, x);
  tank_show(b, x, y);
  set_pivot(b, x, y);
  return 1;
}
// --- the arm segments and the hammer --------------------------------------------------------------------------------------
static int arm_placed(int i, int *wx, int *wy) {
  int g = pivot.rotation;
  int x = (((SINE[g + 256] >> 6) * (i * ARM_STEP)) + (pivot.x << 8)) >> 8;
  int y = (((SINE[g] >> 6) * (i * ARM_STEP)) + (pivot.y << 8)) >> 8;
  *wx = s16(x) + cam_x(); *wy = s16(y) + cam_y();
  return 1;
}
static int arm_fly_step(int *qx, int *qy, int *vy, int x, int y) {
  *vy = s16(*vy + FLY_GRAVITY);
  *qx += 0; // vx is applied by the caller
  *qy += *vy;
  int bounced = 0;
  if (*vy > 0) {
    int d = terrain_tile_floor(x + (*qx >> 8), y + (*qy >> 8), 1, 8);
    if (d < 0) { *qy += d << 8; *vy = s16((*vy >> 2) - *vy); bounced = 1; }
  }
  return bounced;
}
static int arm_run(ActTask *t) {
  PartTask *pt = (PartTask *)t->data;
  Arm *a = pt->arm;
  Sprite *s = &a->o.sprite;
  if (a->flying) {
    if (a->t == -1) {
      int g = pivot.rotation;
      a->ax = s16((((cos1024(g) << 4) * a->i) >> 14) + ((cam_x() + pivot.x) & 0xFFFF));
      a->ay = s16((((sin1024(g) << 4) * a->i) >> 14) + ((cam_y() + pivot.y) & 0xFFFF));
      a->vx = (a->i & 1) ? FLY_VX : -FLY_VX; a->vy = FLY_VY; a->qax = 0; a->qay = 0; a->t = 0;
    }
    if (a->t++ > PART_FRAMES) return 0;
    a->qax += a->vx;
    arm_fly_step(&a->qax, &a->qay, &a->vy, a->ax, a->ay);
    int x = a->ax + (a->qax >> 8);
    if (x > cam_x() + DISPLAY_WIDTH || x < cam_x()) a->vx = -a->vx;
    if (!(a->t & 7)) boss_explosion((a->ax << 8) + a->qax, (a->ay << 8) + a->qay);
    object_draw(s, x, a->ay + (a->qay >> 8));
    return 1;
  }
  int wx, wy; arm_placed(a->i, &wx, &wy);
  Transform tf = { 0, 0x100, 0x100, (int16_t)(wx - cam_x()), (int16_t)(wy - cam_y()) };
  tf.rotation = (uint16_t)(pivot.rotation & 0x3FF);
  s->frameFlags = (s->frameFlags & ~(uint32_t)SPRITE_ROT_SCALE) | SPRITE_ROT_SCALE_ENABLE | 16;
  transform_sprite(s, &tf);
  if (objects_drawing()) display_sprite(s);
  return 1;
}
static void arm_end(ActTask *t) { object_end(t); }
static Arm *arm_new(int i) {
  Arm *a = OBJECT_NEW(Arm);
  if (!a) return NULL;
  a->i = i;
  object_sprite(&a->o.sprite, ANIM_ARM, 0, 0, PART_ORDER, ENEMY_PRIORITY, 0, 0);
  update_sprite(&a->o.sprite, 0);
  PartTask *pt = OBJECT_NEW(PartTask);
  if (!pt) return NULL;
  pt->arm = a;
  if (!act_task_add(arm_run, arm_end, pt, PRIORITY_OBJECTS_ + i)) return NULL;
  return a;
}
static int hammer_run(ActTask *t) {
  PartTask *pt = (PartTask *)t->data;
  Hammer *h = pt->hammer;
  Sprite *s = &h->o.sprite;
  if (h->flying) {
    if (h->t == -1) {
      int g = pivot.rotation;
      h->rotation = (uint16_t)((hammer_angle(current_tank->swing) + g) & 0x3FF);
      h->hx = s16(((cos1024(g) * 3) >> 9) + ((cam_x() + pivot.x) & 0xFFFF));
      h->hy = s16(((sin1024(g) * 3) >> 9) + ((cam_y() + pivot.y) & 0xFFFF));
      h->vx = h->hx < cam_x() + DISPLAY_WIDTH / 2 ? FLY_VX : -FLY_VX; h->vy = FLY_VY;
      h->qhx = 0; h->qhy = 0; h->spin = 42; h->t = 0;
    }
    if (h->t++ > PART_FRAMES) return 0;
    h->qhx += h->vx;
    int bounced = arm_fly_step(&h->qhx, &h->qhy, &h->vy, h->hx, h->hy);
    if (bounced) h->spin = -h->spin;
    if (!(h->t & 7)) boss_explosion((h->hx << 8) + h->qhx, (h->hy << 8) + h->qhy);
    h->rotation = (uint16_t)((h->rotation + h->spin) & 0x3FF);
    Transform tf = { (uint16_t)h->rotation, 0x100, 0x100, (int16_t)(h->hx + (h->qhx >> 8) - cam_x()), (int16_t)(h->hy + (h->qhy >> 8) - cam_y()) };
    s->frameFlags = (s->frameFlags & ~(uint32_t)SPRITE_ROT_SCALE) | SPRITE_ROT_SCALE_ENABLE | 16;
    transform_sprite(s, &tf);
    if (objects_drawing()) display_sprite(s);
    return 1;
  }
  int wx, wy;
  int g = pivot.rotation;
  int x = (((SINE[g + 256] >> 6) * HAMMER_REACH) + (pivot.x << 8)) >> 8;
  int y = (((SINE[g] >> 6) * HAMMER_REACH) + (pivot.y << 8)) >> 8;
  wx = s16(x) + cam_x(); wy = s16(y) + cam_y();
  int own = hammer_angle(current_tank->swing);
  if (current_tank->flash == 0) {
    const Hitbox *hb = object_box(s, 0);
    if (hb) {
      int cx = s16(pivot.x + cam_x() + ((cos1024(g) * 3) >> 9));
      int cy = s16(pivot.y + cam_y() + ((sin1024(g) * 3) >> 9));
      Hitbox ownBox = { 0, -6, (int8_t)-sonic()->offsetY, 6, (int8_t)sonic()->offsetY };
      if (collide_overlap(cx, cy, hb, (int)__builtin_floor(sonic()->x), (int)__builtin_floor(sonic()->y), &ownBox)) {
        world_damage(sonic());
        play(&current_tank->s2, ANIM_EGGMAN_BOSS, EGGMAN_LAUGH);
      }
    }
  }
  Transform tf = { (uint16_t)((own + pivot.rotation) & 0x3FF), 0x100, 0x100, (int16_t)(wx - cam_x()), (int16_t)(wy - cam_y()) };
  s->frameFlags = (s->frameFlags & ~(uint32_t)SPRITE_ROT_SCALE) | SPRITE_ROT_SCALE_ENABLE | 16;
  transform_sprite(s, &tf);
  if (objects_drawing()) display_sprite(s);
  return 1;
}
static void hammer_end(ActTask *t) { object_end(t); }
static Hammer *hammer_new(void) {
  Hammer *h = OBJECT_NEW(Hammer);
  if (!h) return NULL;
  object_sprite(&h->o.sprite, ANIM_HAMMER, 0, 0, PART_ORDER, ENEMY_PRIORITY, 0, 0);
  update_sprite(&h->o.sprite, 0);
  PartTask *pt = OBJECT_NEW(PartTask);
  if (!pt) return NULL;
  pt->hammer = h;
  if (!act_task_add(hammer_run, hammer_end, pt, PRIORITY_OBJECTS_ + ARMS)) return NULL;
  return h;
}

static int tank_run(ActTask *t) {
  EggTank *b = (EggTank *)t->data;
  current_tank = b;
  return b->phase(b);
}
static void tank_end(ActTask *t) {
  EggTank *b = (EggTank *)t->data;
  object_sprite_free(&b->s2);
  object_end(t);
}
static void tank_start(EggTank *b) {
  for (int i = 0; i < ARMS; i++) arms[i] = arm_new(i);
  hammer = hammer_new();
}
static int tank_wait2(EggTank *b) {
  if (b->count++ <= WAIT) return 1;
  tank_start(b);
  b->phase = tank_fight;
  return tank_fight(b);
}
ActTask *egg_hammer_tank_spawn(Slot *slot) {
  slot->gone = 1;
  EggTank *b = OBJECT_NEW(EggTank);
  if (!b) return NULL;
  b->o.slot = slot;
  b->x0 = slot->e.x; b->y0 = slot->e.y;
  b->swing = 0; b->speed = -4; b->hits = 0; b->flash = 0; b->count = 0;
  b->phase = tank_wait2;
  current_tank = b;
  act.cam.shiftY = -56;
  act.cam.maxX = b->x0 - 64 - DISPLAY_WIDTH;
  act.cam.minX = b->x0 - 64 - 360;
  boss_music(0x10);
  // the original gives the body the whole tile count its scripts can load, which the tool's own count comes short of
  object_sprite_at(&b->o.sprite, vram_malloc((uint32_t)sprite_tiles(ANIM_BODY, BODY_PLAIN, BODY_SECOND) + 16), ANIM_BODY, BODY_PLAIN, BODY_ORDER, ENEMY_PRIORITY, 0, 0);
  object_sprite(&b->s2, ANIM_EGGMAN_BOSS, EGGMAN_STILL, EGGMAN_HURT, EGGMAN_ORDER, ENEMY_PRIORITY, 0, 0);
  update_sprite(&b->o.sprite, 0);
  update_sprite(&b->s2, 0);
  return act_task_add(tank_run, tank_end, b, PRIORITY_OBJECTS_);
}
