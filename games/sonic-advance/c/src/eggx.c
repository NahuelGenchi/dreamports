// X Zone's last boss, Egg X (SAT-R decompilation, src/game/sa1/stage/enemies/boss_x3_egg_x.c; Task_803775C,
// Task_8039A64 and sub_803A170 don't match there, and were read from their assembly instead). Positions are in
// whole pixels, offsets and speeds in 1/256 px.

#include "xbosses.h"

#define HITS 8
#define ARM_UP (-0x1700)

typedef struct EggX EggX;
typedef struct RotaryArm RotaryArm;
typedef int (*EggXFn)(EggX *b);

struct EggX {
  Object o;
  Sprite s2;
  int x0, y0;
  int qx, qy, vx, vy, ax;
  int x, y, bobAngle;
  int timer;
  int hits;
  int flash;
  int armed;
  int phase;
  int attack;
  int laugh;
  RotaryArm *arm;
  EggXFn main;
};

struct RotaryArm {
  Object o;
  Sprite s2;
  EggX *b;
  int state, flags, target, timer;
  int ax, ay, vxA, vyA;
};

void player_throw_from_claw(Player *p, int flip) {
  p->invulnerable = 120;
  p->xsp = flip ? -2.0 : 2.0;
  p->ysp = -(double)0x5E0 / 256.0;
  p->rotation = 0;
  p->carried = 0; p->ignoreInput = 0; p->onObject = NULL; p->pushing = 0; p->spinDashing = 0;
  p->air = 1;
  p->state = PS_HURT;
  player_stand_up(p);
  player_end_attack(p);
}

static void set_eggman(EggX *b, int variant) {
  b->s2.variant = (uint8_t)variant;
  b->s2.prevVariant = 0xFF;
}

// it bobs 4 px up and down, 8/1024 of a turn a frame, while it isn't rising or falling (Task_803753C, Task_803775C)
static void eggx_place(EggX *b) {
  int bob = 0;
  if (b->vy == 0) {
    b->bobAngle = (b->bobAngle + 8) & 0x3FF;
    bob = (xcos(b->bobAngle) >> 6) >> 6;
  } else {
    b->bobAngle = 0;
  }
  b->x = s16(b->x0 + (b->qx >> 8));
  b->y = s16(bob + b->y0 + (b->qy >> 8));
}

// a sprite's palId is added to its own palette: the body's 15 and the arm's 14 both wrap round to palette 12, all
// white, while it flashes (sub_80370B4, Task_8039264); the hit test puts the body's back each frame
enum { BODY_FLASH = 253, ARM_FLASH = 254 };

static void eggx_show(EggX *b) {
  if (b->flash != 0 && --b->flash > 16 && !(b->flash & 2) && !act.player.dead) b->o.sprite.palId = BODY_FLASH;
  boss_display(&b->o.sprite, b->x - cam_x(), b->y - cam_y());
  boss_display(&b->s2, b->x - cam_x(), b->y - cam_y());
}

static void eggx_hit_test(EggX *b) {
  if (!act.player.dead) b->o.sprite.palId = 0;
  if (b->flash != 0) return;
  int own = (b->arm && (b->arm->flags & 4)) ? 0 : boss_hit(&b->o.sprite, b->x, b->y);
  int hit = own == 0 ? boss_hurt(&b->o.sprite, b->x, b->y) : own;
  if (hit == HIT_ENEMY) {
    b->hits++;
    b->flash = 0x20;
    set_eggman(b, 2);
    play_song(SE_BOSS_HIT);
  } else if (hit == HIT_PLAYER) {
    set_eggman(b, 3);
  }
}

// Chances: near: [30, 10, 30, 30], nearAir: [50, 50, 0, 0], far: [20, 40, 20, 20], farAir: [30, 50, 0, 20]
static int pick_attack(EggX *b) {
  int d = (int)__builtin_fabs((double)enemy_sonic_x() - b->x);
  static const int CHANCES[4][4] = {
    { 30, 10, 30, 30 }, // near
    { 50, 50, 0, 0 },   // nearAir
    { 20, 40, 20, 20 }, // far
    { 30, 50, 0, 20 },  // farAir
  };
  int idx = act.player.air ? (d > 120 ? 3 : 1) : (d > 120 ? 2 : 0);
  int r = (int)(act_random() % 100), i = 0;
  for (; i < 4; i++) {
    r -= CHANCES[idx][i];
    if (r <= 0) break;
  }
  return i + 1;
}

static void eggx_laser(EggX *b) {
  int alive = !act.player.dead;
  if (--b->timer == 0) {
    b->phase = 4;
    if (alive) {
      xzone_disp.winIn = 0x1F1F;
      xzone_disp.win0h = DISPLAY_WIDTH;
      xzone_disp.win0v = DISPLAY_HEIGHT;
    }
    return;
  }
  if (alive) xzone_disp.winIn = 0x3F3F;
  int half = 15 - (int)__builtin_fabs((double)s16(b->timer - 15)), reach = half;
  if (half > 11) { half = 12; reach = 11; }
  int sx = s16(b->x - cam_x()), sy = s16(b->y - cam_y());
  int top = s16(sy - half);
  int bottom = s16(sy + half);
  if (bottom > DISPLAY_HEIGHT) bottom = DISPLAY_HEIGHT;
  int flip = (b->o.sprite.frameFlags & SPRITE_X_FLIP) != 0;
  int rect[4];
  if (flip) { rect[0] = s8(sx - 88); rect[1] = -reach; rect[2] = 120; rect[3] = reach; }
  else { rect[0] = -120; rect[1] = -reach; rect[2] = s8(sx - 152); rect[3] = reach; }
  if (alive) {
    xzone_disp.win0h = (uint16_t)((flip ? ((sx + 32) << 8) | DISPLAY_WIDTH : sx - 32) & 0xFFFF);
    xzone_disp.win0v = (uint16_t)(((top << 8) | bottom) & 0xFFFF);
  }
  if (boss_rect_hit(rect[0], rect[1], rect[2], rect[3], cam_x() + DISPLAY_WIDTH / 2, b->y) == HIT_PLAYER) {
    set_eggman(b, 3);
  }
}

// Bouncing Ball
typedef struct { Object o; EggX *b; int qx, qy, vx, vy, g, x0, y0; } BouncingBall;

static int bouncing_ball_run(ActTask *t) {
  BouncingBall *bl = (BouncingBall *)t->data;
  EggX *b = bl->b;
  bl->vy = s16(bl->vy + bl->g);
  bl->qx += bl->vx; bl->qy += bl->vy;
  int x = s16((bl->qx >> 8) + bl->x0), y = s16((bl->qy >> 8) + bl->y0);
  int d = terrain_tile_floor(x, y + 8, 1, 8);
  if (d < 0) {
    bl->qy += d << 8;
    bl->vy = s16(-bl->vy + (bl->vy / 4));
  }
  if (b->hits < HITS && boss_shot(&bl->o.sprite, x, y) == HIT_PLAYER) b->laugh = 1;
  update_sprite(&bl->o.sprite, 0);
  boss_display(&bl->o.sprite, x - cam_x(), y - cam_y());
  return ((uint32_t)(bl->qx + 0xD000)) <= 0x1A000;
}

static void spawn_bouncing_ball(EggX *b) {
  BouncingBall *bl = OBJECT_NEW(BouncingBall);
  if (!bl) return;
  int far = (act_random() & 0x800) != 0;
  bl->b = b;
  bl->g = far ? 40 : 48;
  int speed = far ? 3 << 8 : 0x180;
  bl->vy = far ? -2 << 8 : -5 << 8;
  int flip = (b->o.sprite.frameFlags & SPRITE_X_FLIP) != 0;
  bl->qx = b->qx + (flip ? 20 << 8 : -20 << 8);
  bl->qy = b->qy;
  bl->vx = flip ? speed : -speed;
  bl->x0 = b->x0; bl->y0 = b->y0;
  object_sprite_at(&bl->o.sprite, vram_malloc(EGGX_BALL_TILES), ANIM_EGGX_BALL, 1, 23, ENEMY_PRIORITY, 0, 0);
  play_song(SE_IMPACT);
  object_task(&bl->o, bouncing_ball_run, 0x2100);
}

// Falling piece for wrecked claw
// once the boss is wrecked, a piece of the claw or its chain falls from where it is, 32/256 px a frame faster,
// bouncing off the floor a quarter as fast the other way, and after its timer it blows up (Task_803A46C)
typedef struct { int falling, qx, qy, vy, timer; } Fall;

static void fall_from(Fall *f, int x, int y, int timer) {
  f->falling = 1; f->qx = x << 8; f->qy = y << 8; f->vy = 0; f->timer = timer;
}

static int fall_run(Fall *f, Sprite *s, Transform *tf) {
  f->vy = s16(f->vy + 0x20);
  f->qy += f->vy;
  int x = f->qx >> 8, y = f->qy >> 8;
  int d = terrain_tile_floor(x, y + 8, 1, 8);
  if (d < 0) {
    f->qy += d << 8;
    f->vy = s16((f->vy >> 2) - f->vy);
  }
  update_sprite(s, 0);
  tf->x = (int16_t)(x - cam_x());
  tf->y = (int16_t)(y - cam_y());
  s->frameFlags = (s->frameFlags & ~(uint32_t)SPRITE_ROT_SCALE) | (uint32_t)boss_matrix() | SPRITE_ROT_SCALE_ENABLE;
  transform_sprite(s, tf);
  display_sprite(s);
  if (--f->timer == 0) {
    boss_explosion(x << 8, y << 8);
    return 0;
  }
  return 1;
}

typedef struct { Object o; Transform tf; Fall fall; struct Claw *c; EggX *b; int n, flip; } ChainBall;

// Claw
typedef struct Claw {
  Object o;
  Transform tf;
  EggX *b;
  int cx, cy;
  int radius, target, dr;
  Fall fall;
  int angle, dAngle, shown, timer, chain, state, caught, flip;
} Claw;

static void mirrored_angles(int angle, int flip, int *place, int *rot) {
  if (flip) {
    *place = (-angle - 0x200) & 0x3FF;
    *rot = -angle & 0x3FF;
  } else {
    *place = angle;
    *rot = angle;
  }
}

static void point_along(int angle, int radius, int cx, int cy, int *x, int *y) {
  *x = (((xcos(angle) >> 6) * radius) >> 16) + cx;
  *y = (((xsin(angle) >> 6) * radius) >> 16) + cy;
}

// sub_803A1D8 and Task_803A2F8: the nth ball 16 px along the chain from the claw back toward the machine
static int chain_ball_run(ActTask *t) {
  ChainBall *cb = (ChainBall *)t->data;
  if (cb->fall.falling) return fall_run(&cb->fall, &cb->o.sprite, &cb->tf);
  Claw *c = cb->c;
  EggX *b = cb->b;
  int place, rot;
  mirrored_angles(s16(c->shown) & 0xFFFF, cb->flip, &place, &rot);
  int radius = c->radius + ((cb->n * 16 + 8) << 8);
  int x, y;
  point_along(place, radius, c->cx, c->cy, &x, &y);
  update_sprite(&cb->o.sprite, 0);
  cb->tf.x = (int16_t)(x - cam_x());
  cb->tf.y = (int16_t)(y - cam_y());
  cb->tf.rotation = (uint16_t)rot;
  cb->tf.qScaleX = cb->flip ? -0x100 : 0x100;
  cb->tf.qScaleY = 0x100;
  cb->o.sprite.frameFlags = (cb->o.sprite.frameFlags & ~(uint32_t)SPRITE_ROT_SCALE) | (uint32_t)boss_matrix() | SPRITE_ROT_SCALE_ENABLE;
  transform_sprite(&cb->o.sprite, &cb->tf);
  display_sprite(&cb->o.sprite);
  if (radius > 0x800 || c->state == 6) return 0;
  if (b->hits >= HITS) fall_from(&cb->fall, x, y, 0x50 - cb->n * 4);
  return 1;
}

static void spawn_chain_ball(Claw *c, int flip, EggX *b) {
  ChainBall *cb = OBJECT_NEW(ChainBall);
  if (!cb) return;
  cb->c = c; cb->b = b; cb->n = c->chain; cb->flip = flip;
  object_sprite_at(&cb->o.sprite, vram_malloc(EGGX_BALL_TILES), ANIM_EGGX_BALL, 0, 24, ENEMY_PRIORITY, flip, 0);
  object_task(&cb->o, chain_ball_run, 0x2101);
}

static int claw_run(ActTask *t) {
  Claw *c = (Claw *)t->data;
  if (c->fall.falling) return fall_run(&c->fall, &c->o.sprite, &c->tf);
  EggX *b = c->b;
  int flip = c->flip;
  if (b->hits < HITS) {
    c->cx = s16(b->x + (flip ? 26 : -26));
    c->cy = b->y;
  }
  c->radius += c->dr;
  c->shown = c->angle;
  int place, rot;
  mirrored_angles(s16(c->shown) & 0xFFFF, flip, &place, &rot);
  int x, y;
  point_along(place, c->radius, c->cx, c->cy, &x, &y);

  // it's drawn before it moves on (Task_8039A64)
  update_sprite(&c->o.sprite, 0);
  c->tf.x = (int16_t)(x - cam_x());
  c->tf.y = (int16_t)(y - cam_y());
  c->tf.rotation = (uint16_t)rot;
  c->tf.qScaleX = flip ? -0x100 : 0x100;
  c->tf.qScaleY = 0x100;
  c->o.sprite.frameFlags = (c->o.sprite.frameFlags & ~(uint32_t)SPRITE_ROT_SCALE) | (uint32_t)boss_matrix() | SPRITE_ROT_SCALE_ENABLE;
  transform_sprite(&c->o.sprite, &c->tf);
  display_sprite(&c->o.sprite);

  if (b->hits >= HITS) {
    c->o.sprite.oamFlags = (uint16_t)(23 << 6);
    fall_from(&c->fall, x, y, 0x50);
    return 1;
  }

  Player *p = &act.player;
  int hit = 0;
  if (c->state <= 2) {
    hit = c->state == 2 ? boss_grab_test(&c->o.sprite, x, y) : boss_shot(&c->o.sprite, x, y);
  }
  if (hit == HIT_PLAYER) b->laugh = 1;
  if (c->state == 2 && hit == HIT_PLAYER && act.ringCount == 0) {
    world_damage(p);
    hit = 0;
  }

  switch (c->state) {
    case 0:
      // it pulls in for 17 frames, then aims for 3, 1, 0.3 or 5 seconds, 35, 35, 20 and 10 times in 100
      if (--c->timer == 0) {
        int r = (int)act_random() % 100;
        c->dr = 0; c->state++;
        c->timer = r - 35 <= 0 ? 180 : r - 70 <= 0 ? 60 : r - 90 <= 0 ? 18 : 300;
      }
      break;
    case 1: {
      int dx = c->cx - enemy_sonic_x(), dy = c->cy - enemy_sonic_y();
      if (dx < 0) dx = -dx;
      int want = coarse_angle(s16(dy), s16(dx)) & 0xFFFF;
      if (((want - 225) & 0xFFFF) <= 286) want = 224;
      if (((want - 513) & 0xFFFF) <= 286) want = 800;
      int now = (c->angle << 22) >> 16, to = (want << 22) >> 16;
      if (now > to) c->angle = now >= to + 0x180 ? c->angle - 6 : want;
      else if (now < to) c->angle = now > to - 0x180 ? want : c->angle + 6;
      c->angle &= 0x3FF;
      if (--c->timer == 0) {
        int ex = c->cx - enemy_sonic_x(), ey = c->cy - enemy_sonic_y();
        double dist = __builtin_sqrt((double)(((ex * ex) << 8) + ((ey * ey) << 8)));
        c->target = -0x1000 - (((int)dist & 0xFFFF) << 4);
        c->dr = -6 << 8;
        c->chain = 0;
        c->state++;
        c->o.sprite.oamFlags = (uint16_t)(15 << 6);
        c->o.sprite.variant = 1;
        c->o.sprite.prevVariant = 0xFF;
        play_song(SE_CLAW);
      }
      break;
    }
    case 2: {
      int links = (((((-c->radius) >> 8) - 20) >> 4) + 1) & 0xFF;
      if (c->chain < links) {
        c->chain = links;
        spawn_chain_ball(c, flip, b);
      }
      if (hit == HIT_PLAYER) {
        c->caught = 1; c->dr = 0; c->state = 7;
        c->o.sprite.variant = 2; c->o.sprite.prevVariant = 0xFF;
        p->pushing = 0; p->spinDashing = 0; player_end_attack(p);
        p->xsp = 0; p->ysp = 0; p->gsp = 0;
        p->carried = 1; p->ignoreInput = 1;
        p->x = x; p->y = y;
        p->rotation = flip ? ((-s16(c->angle)) >> 2) & 0xFF : (c->angle >> 2) & 0xFF;
        p->state = PS_GRABBED;
      } else if (c->radius <= c->target) {
        c->dr = 0; c->state++;
        c->o.sprite.variant = 2; c->o.sprite.prevVariant = 0xFF;
      }
      break;
    }
    case 3:
      if (c->o.sprite.frameFlags & SPRITE_ANIM_OVER) { c->dr = 0x200; c->state++; }
      break;
    case 4:
      if (c->radius >= -0x1400) {
        c->radius = -0x1400; c->dr = 0;
        c->o.sprite.oamFlags = (uint16_t)(23 << 6);
        c->o.sprite.variant = 0; c->o.sprite.prevVariant = 0xFF;
        c->state++;
      }
      break;
    case 5: {
      int a = s16(c->angle);
      if (a == 0) {
        c->o.sprite.oamFlags = (uint16_t)(23 << 6);
        c->dr = 0x100; c->state++;
      } else if (a > 0x200) {
        c->angle = (c->angle + 6) & 0x3FF;
        if (c->angle <= 6) c->angle = 0;
      } else {
        c->angle = (c->angle - 6) & 0x3FF;
        if (c->angle > 0x200) c->angle = 0;
      }
      break;
    }
    case 6:
      if (c->radius > 0xDFF) {
        if (!c->caught) b->phase++; else b->timer = 1;
        return 0;
      }
      break;
    case 7:
      p->x = x; p->y = y;
      p->rotation = flip ? ((-s16(c->angle)) >> 2) & 0xFF : (c->angle >> 2) & 0xFF;
      if (c->o.sprite.frameFlags & SPRITE_ANIM_OVER) { c->dr = 0x600; c->state++; }
      break;
    case 8:
      p->x = x; p->y = y;
      p->rotation = flip ? ((-s16(c->angle)) >> 2) & 0xFF : (c->angle >> 2) & 0xFF;
      if (c->radius >= -0x2400) {
        c->radius = -0x2400; c->dr = 0; c->dAngle = 0x10; c->timer = 0; c->state++;
      }
      break;
    case 9:
      p->x = x; p->y = y;
      p->rotation = flip ? ((-s16(c->angle)) >> 2) & 0xFF : (c->angle >> 2) & 0xFF;
      c->angle = (c->angle + c->dAngle) & 0x3FF;
      if (c->angle > 0x1FF) {
        if (act.ringCount > 0 && c->dAngle < 0) {
          int lose = act.ringCount < 5 ? act.ringCount : 5;
          world_lose_rings(lose);
        }
        c->dAngle = 0x10;
      }
      if (((c->angle - 0x100) & 0xFFFF) <= 0xFF) {
        c->dAngle = -0x10;
        c->timer = (c->timer + 1) & 0xFFFF;
        if (c->timer == 4) b->phase = 0x33;
        if (c->timer == 5) {
          player_throw_from_claw(p, flip);
          c->state = 5;
        }
      }
      break;
  }

  return 1;
}

static void spawn_claw(EggX *b) {
  Claw *c = OBJECT_NEW(Claw);
  if (!c) return;
  int flip = (b->o.sprite.frameFlags & SPRITE_X_FLIP) != 0;
  c->b = b; c->flip = flip;
  c->cx = s16(b->x0 + (b->qx >> 8) + (flip ? 26 : -26));
  c->cy = s16(b->y0 + (b->qy >> 8));
  c->radius = 14 << 8; c->dr = -2 << 8; c->timer = 0x11;
  c->target = 0; c->angle = 0; c->dAngle = 0; c->shown = 0; c->chain = 0; c->state = 0; c->caught = 0;
  object_sprite_at(&c->o.sprite, vram_malloc(EGGX_HAND_TILES), ANIM_EGGX_HAND, 0, 23, ENEMY_PRIORITY, flip, 0);
  object_task(&c->o, claw_run, 0x2100);
}

// Rotary Arm
static void arm_set_pair(RotaryArm *arm, int v, int v2) {
  arm->o.sprite.variant = (uint8_t)v;
  arm->o.sprite.prevVariant = 0xFF;
  arm->s2.variant = (uint8_t)v2;
  arm->s2.prevVariant = 0xFF;
}

static void arm_point(RotaryArm *arm, int attack) {
  if (attack == 1) { arm_set_pair(arm, 4, 5); arm->target = 4; }
  else if (attack == 2) { arm_set_pair(arm, 2, 3); arm->target = 2; }
  else if (attack == 3) { arm_set_pair(arm, 6, 7); arm->target = 6; }
}

static void arm_unpoint(RotaryArm *arm) {
  if (arm->o.sprite.variant == 4) { arm_set_pair(arm, 14, 17); arm->target = 14; }
  else if (arm->o.sprite.variant == 2) { arm_set_pair(arm, 15, 18); arm->target = 15; }
  else if (arm->o.sprite.variant == 6) { arm_set_pair(arm, 16, 19); arm->target = 16; }
}

static void arm_turn(RotaryArm *arm) {
  if (arm->o.sprite.frameFlags & SPRITE_ANIM_OVER) {
    if (arm->o.sprite.variant == arm->target) { arm->flags |= 1; return; }
    int v = arm->o.sprite.variant;
    if (v == 8 || v == 14) arm_set_pair(arm, 10, 13);
    else if (v == 9 || v == 15) arm_set_pair(arm, 8, 11);
    else if (v == 10 || v == 16) arm_set_pair(arm, 9, 12);
    else arm_set_pair(arm, v, arm->s2.variant);
  }
  arm->flags &= ~1;
}

static int rotary_arm_run(ActTask *t) {
  RotaryArm *arm = (RotaryArm *)t->data;
  EggX *b = arm->b;
  int flip = (b->o.sprite.frameFlags & SPRITE_X_FLIP) != 0;
  if (flip) {
    arm->o.sprite.frameFlags |= SPRITE_X_FLIP;
    arm->s2.frameFlags |= SPRITE_X_FLIP;
  } else {
    arm->o.sprite.frameFlags &= ~SPRITE_X_FLIP;
    arm->s2.frameFlags &= ~SPRITE_X_FLIP;
  }
  arm->o.sprite.palId = arm->s2.palId = b->o.sprite.palId != 0 ? ARM_FLASH : 0;

  if (b->hits >= HITS) {
    if (arm->state != 0) {
      if (arm->o.sprite.variant != 6) arm_unpoint(arm);
      arm->state = 0;
    }
    arm->vxA = 0; arm->vyA = 0;
    if (b->phase > 1) return 0;
  } else {
    switch (arm->state) {
      case 1:
        arm->target = 8;
        if (arm->flags & 1) { arm->timer = 30; arm->state++; }
        break;
      case 2:
        if (--arm->timer == 0) { arm->vyA = 0x100; arm->state++; }
        break;
      case 3: case 11:
        if (arm->ay + arm->vyA >= 0) { arm->ay = 0; arm->vyA = 0; arm->state++; }
        break;
      case 5:
        arm->vyA = -0x100; arm->state++;
        break;
      case 8:
        arm->ay = ARM_UP; arm->target = 0; arm->state++;
        // falls through
      case 9:
        if (b->attack != 0 && b->attack >= 1 && b->attack <= 3) arm->target = b->attack + 7;
        break;
      case 10:
        arm->vyA = 0x200; arm->state++;
        if (arm->ay + arm->vyA >= 0) { arm->ay = 0; arm->vyA = 0; arm->state++; }
        break;
      case 13:
        arm_point(arm, b->attack); arm->state++;
        break;
      case 15:
        arm_unpoint(arm); arm->timer = 10; arm->state++;
        // falls through
      case 16:
        if (--arm->timer == 0) { arm->vyA = -0x200; arm->state++; }
        break;
      case 19:
        arm->vyA = -0x200; arm->state += 2;
        break;
      case 6: case 17: case 21:
        if (arm->ay + arm->vyA <= ARM_UP) { arm->ay = ARM_UP; arm->vyA = 0; arm->state++; }
        break;
    }
  }

  arm->ax += arm->vxA; arm->ay += arm->vyA;
  if (arm->ay <= -23 << 8) arm->flags |= 4; else arm->flags &= ~4;
  if (arm->ay >= 0) arm->flags |= 2; else arm->flags &= ~2;
  int x = s16((arm->ax >> 8) + b->x), y = s16((arm->ay >> 8) + b->y);

  // it turns towards its target before its animation steps (Task_8039264)
  arm_turn(arm);
  if (b->armed != 0 && b->flash == 0 && b->hits < HITS && boss_shot(&arm->o.sprite, x, y) == HIT_PLAYER) {
    b->laugh = 1;
  }
  update_sprite(&arm->o.sprite, 0);
  update_sprite(&arm->s2, 0);
  boss_display(&arm->o.sprite, x - cam_x(), y - cam_y());
  boss_display(&arm->s2, x - cam_x(), y - cam_y());
  return 1;
}

static void rotary_arm_end(ActTask *t) {
  RotaryArm *arm = (RotaryArm *)t->data;
  object_sprite_free(&arm->s2);
  object_end(t);
}

static void create_rotary_arm(EggX *b) {
  RotaryArm *arm = OBJECT_NEW(RotaryArm);
  if (!arm) return;
  arm->b = b; b->arm = arm;
  arm->ay = ARM_UP;
  object_sprite_at(&arm->o.sprite, vram_malloc(EGGX_ARM_TILES), ANIM_EGGX_ARM, 8, 20, ENEMY_PRIORITY, 0, 0);
  object_sprite_at(&arm->s2, vram_malloc(EGGX_ARM_TILES), ANIM_EGGX_ARM, 11, 20, ENEMY_PRIORITY, 0, 0);
  boss_task(&arm->o, rotary_arm_run, rotary_arm_end, 0x20FF);
}

static int eggx_falling(EggX *b);

static void eggx_wrecked(EggX *b) {
  b->flash = 0; act.bossFlash = 0; b->o.sprite.frameFlags &= ~(uint32_t)OBJ_WINDOW;
  b->phase = 0; b->vx = 0; b->vy = 0;
  set_eggman(b, 2);
  act.cam.minX = (int)act.cam.x;
  act.cam.maxX = (int)act.cam.x;
  play_song(SE_EXPLOSION);
  if (!act.player.dead) {
    xzone_disp.active = 0;
  }
  Player *p = &act.player;
  p->gsp = 0; p->ignoreInput = 1;
  act.clockStopped = 1; act.ringsStopped = 1;
  world_add_score(1000);
  b->main = eggx_falling;
  eggx_falling(b);
}

static int eggx_falling(EggX *b) {
  if (b->phase <= 1) {
    if (b->phase == 0) b->vy += 0x10;
    b->qx += b->vx; b->qy += b->vy;
    b->x = s16(b->x0 + (b->qx >> 8)); b->y = s16(b->y0 + (b->qy >> 8));
    if (!(b->timer & 7)) x_boss_debris(b->x, b->y + 16, b->y + 32);
    update_sprite(&b->o.sprite, 0);
    update_sprite(&b->s2, 0);
    boss_display(&b->o.sprite, b->x - cam_x(), b->y - cam_y());
    boss_display(&b->s2, b->x - cam_x(), b->y - cam_y());
  }
  switch (b->phase) {
    case 0: {
      b->timer = (b->timer - 1) & 0xFFFF;
      int d = terrain_tile_floor(b->x, b->y + 20, 1, 8);
      if (d < 0) {
        b->qy += d << 8;
        b->vy = (b->vy >> 2) - b->vy;
        if (b->vy > -0x100) {
          b->vy = 0; b->timer = 240; b->phase++;
          if (moon_opens()) {
            save_moon_opened();
            moon_ending_start();
          } else {
            normal_ending_start();
          }
        }
      }
      break;
    }
    case 1:
      if (--b->timer == 0) {
        if (moon_opens()) {
          boss_egg_mobile(b->x, b->y - 8);
        }
        boss_music(MUSIC_END_EGG_X);
        for (int i = 0; i < 4; i++) {
          static const int8_t EX[4][2] = { {0, -24}, {-16, 0}, {16, 0}, {0, 24} };
          boss_explosion((b->x + EX[i][0]) << 8, (b->y + EX[i][1]) << 8);
        }
        b->phase++;
      }
      break;
    case 2:
      b->o.slot->gone = 1;
      return 0;
  }
  return 1;
}

static int reached(EggX *b, int left, int right) {
  int flip = (b->o.sprite.frameFlags & SPRITE_X_FLIP) != 0;
  return flip ? b->qx >= right : b->qx <= left;
}

static void turn_round(EggX *b) {
  b->o.sprite.frameFlags ^= SPRITE_X_FLIP;
  b->s2.frameFlags ^= SPRITE_X_FLIP;
}

static int eggx_fight(EggX *b) {
  RotaryArm *arm = b->arm;
  b->vx += b->ax;
  int flip = (b->o.sprite.frameFlags & SPRITE_X_FLIP) != 0;
  b->qx += flip ? -b->vx : b->vx;
  b->qy += b->vy;
  eggx_place(b);

  if (b->laugh) {
    b->laugh = 0;
    set_eggman(b, 3);
  }

  eggx_hit_test(b);
  if (b->hits >= HITS) {
    eggx_wrecked(b);
    return 1;
  }
  update_sprite(&b->o.sprite, 0);
  update_sprite(&b->s2, 0);
  if (b->s2.variant != 0 && (b->s2.frameFlags & SPRITE_ANIM_OVER)) set_eggman(b, 0);
  eggx_show(b);

  switch (b->phase) {
    case 0: {
      b->attack = 0;
      arm->state = 8;
      b->phase++;
      static const int TIMERS[4] = { 0x5A, 0xB4, 0xF0, 0x5A };
      b->timer = TIMERS[(act_random() & 0x30) >> 4];
      // falls through
    }
    case 1:
      if (--b->timer != 0) return 1;
      b->attack = pick_attack(b);
      if (b->attack != 4) { b->timer = 10; b->phase++; }
      else { arm->state = 10; b->timer = 0x14; b->phase = 0x40; }
      break;
    case 2:
      arm->flags &= 1;
      if (arm->flags == 0) return 1;
      if (--b->timer == 0) { b->timer = 10; b->phase++; arm->state = 10; }
      break;
    case 3:
      if (!(arm->flags & 2) || --b->timer != 0) return 1;
      arm->state = 13;
      b->phase = b->attack * 0x10;
      if (b->attack == 2) { b->timer = 30; play_song(SE_LASER); }
      else if (b->attack == 1) b->timer = 0;
      break;
    case 4:
      arm->state = 15;
      b->attack = 0;
      b->phase++;
      break;
    case 5:
      if (arm->flags & 4) b->phase = 0;
      break;
    case 0x10:
      spawn_bouncing_ball(b);
      b->timer++;
      b->vx = 0x200; b->ax = -0x40;
      b->phase++;
      break;
    case 0x11: {
      if (b->vx <= 0) b->ax -= b->ax / 4;
      int stop = 0;
      if (flip ? b->qx >= -0x7400 : b->qx <= 0x7400) {
        b->qx = flip ? -0x7400 : 0x7400; stop = 1;
      }
      if (stop) { b->vx = 0; b->ax = 0; b->phase = b->timer != 0 ? 4 : 0x10; }
      break;
    }
    case 0x20:
      eggx_laser(b);
      break;
    case 0x30:
      spawn_claw(b);
      b->phase++;
      break;
    case 0x32:
      b->phase = 4;
      break;
    case 0x33:
      b->vx = -0x200; b->timer = 0;
      b->phase++;
      break;
    case 0x34:
      if (b->timer != 0) { arm->state = 15; b->timer = 0; }
      if (reached(b, -0xD000, 0xD000)) {
        b->qx = flip ? 0xD000 : -0xD000;
        turn_round(b);
        b->phase++;
      }
      break;
    case 0x35:
      if (reached(b, 0x7400, -0x7400)) {
        b->qx = flip ? -0x7400 : 0x7400;
        b->vx = 0;
        b->phase = 0;
      }
      break;
    case 0x40:
      if ((arm->flags & 2) && --b->timer == 0) { b->vx = -0x300; b->phase++; }
      break;
    case 0x41:
      if (reached(b, -0xD000, 0xD000)) {
        b->vx = -0x200;
        arm->state = 0x13;
        b->qx = flip ? 0xD000 : -0xD000;
        turn_round(b);
        b->phase++;
      }
      break;
    case 0x42:
      if (reached(b, 116 << 8, -116 << 8)) {
        b->qx = flip ? -116 << 8 : 116 << 8;
        b->vx = 0;
        if (arm->flags & 4) b->phase = 0;
      }
      break;
  }
  return 1;
}

static int eggx_arrive(EggX *b) {
  RotaryArm *arm = b->arm;
  b->qx += b->vx; b->qy += b->vy;
  eggx_place(b);
  update_sprite(&b->o.sprite, 0);
  update_sprite(&b->s2, 0);
  eggx_show(b);
  switch (b->phase) {
    case 0:
      if (b->qy <= 110 << 8) { b->qy = 110 << 8; b->vx = 0; b->vy = 0; b->timer = 15; b->phase++; }
      break;
    case 1:
      if (--b->timer == 0) { arm->state = 1; b->phase++; }
      break;
    case 2:
      if (arm->state == 4) { set_eggman(b, 1); b->phase++; }
      break;
    case 3:
      if (b->s2.frameFlags & SPRITE_ANIM_OVER) { arm->state = 5; set_eggman(b, 0); b->phase++; }
      break;
    case 4:
      if (arm->state == 7) { b->timer = 15; b->phase++; }
      break;
    case 5:
      if (--b->timer == 0) { b->armed = 0xFF; b->phase = 0; b->main = eggx_fight; }
      break;
  }
  return 1;
}

static int eggx_wait_for_camera(EggX *b) {
  switch (b->phase) {
    case 0:
      if (b->x0 - 120 <= cam_x()) {
        act.cam.minX = (b->x0 & 0xFFFF) - (120 + 24);
        act.cam.maxX = (b->x0 & 0xFFFF) + (120 + 24) - DISPLAY_WIDTH;
        b->phase = 1;
      }
      return 1;
    case 1:
      if (b->y0 - 40 <= cam_y()) {
        boss_cam_pan(b->y0 - 40, b->y0 + DISPLAY_HEIGHT);
        b->phase = 2;
      }
      break;
    case 2:
      if (act.cam.minY == (b->y0 - 40) && act.cam.maxY + DISPLAY_HEIGHT == (b->y0 + DISPLAY_HEIGHT)) {
        b->phase = 3;
      }
      break;
    case 3:
      b->phase = 0;
      b->vy = -0x100;
      b->x = b->x0 + (b->qx >> 8);
      b->y = b->y0 + (b->qy >> 8);
      create_rotary_arm(b);
      b->main = eggx_arrive;
      boss_shake(0x400, 4, 0x100, 0x7A, SHAKE_VERTICAL);
      boss_music(MUSIC_EGG_X);
      break;
  }
  return 1;
}

static int egg_x_run(ActTask *t) {
  EggX *b = (EggX *)t->data;
  return b->main(b);
}

static void egg_x_end(ActTask *t) {
  EggX *b = (EggX *)t->data;
  object_sprite_free(&b->s2);
  object_end(t);
}

ActTask *egg_x_spawn(Slot *slot) {
  EggX *b = OBJECT_NEW(EggX);
  if (!b) return NULL;
  b->o.slot = slot;
  b->o.x = slot->e.x;
  b->x0 = slot->e.x; b->y0 = slot->e.y;
  b->qx = 116 << 8; b->qy = 232 << 8;
  b->timer = 120;
  b->hits = difficulty_easy() ? 2 : 0;
  b->main = eggx_wait_for_camera;

  for (int i = 0; i < 16; i++) e.objPalette[12 * 16 + i] = 0x7FFF;
  e.flags |= FLAGS_UPDATE_OBJ_PALETTES;

  if (!act.player.dead) {
    xzone_disp.active = 1;
    xzone_disp.dispCnt = 0x2000;
    xzone_disp.win0h = DISPLAY_WIDTH;
    xzone_disp.win0v = DISPLAY_HEIGHT;
    xzone_disp.winIn = 0x1F1F;
    xzone_disp.winOut = 0x1F1F;
    xzone_disp.bldCnt = 0xBF;
    xzone_disp.bldY = 12;
  }

  object_sprite_at(&b->o.sprite, vram_malloc(EGGX_TILES), ANIM_EGGX_BODY, 0, 22, ENEMY_PRIORITY, 0, 0);
  ActTask *t = boss_task(&b->o, egg_x_run, egg_x_end, PRIORITY_OBJECTS);
  if (!t) return NULL;

  object_sprite_at(&b->s2, vram_malloc(EGGX_EGGMAN_TILES), ANIM_EGGX_EGGMAN, 0, 21, ENEMY_PRIORITY, 0, 0);
  return t;
}
