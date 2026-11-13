// The character in a special stage, translated from special/player.js (SAT-R's src/game/sa1/special_stage/main.c,
// gUnknown_03005690 and the tasks from Task_802A560 on). They fly down the tunnel at 8 lines a frame, steered across it
// with the D-pad in 1/256 px, the jump button speeding them up to 12 a frame, and the attack button doing a trick. A dash
// pad throws them a fixed way for a while, a bomb makes them drop up to 10 rings, and a trick done just after a bumper
// (the window it opens) pulls in the rings around it. At the checkpoint and the goal they glide back to the middle and
// cheer or fall. The character's state is the original's struct, with its fields named as special.h's SpPlayer says.

#include "special.h"

enum { ANIM_STAND = 27, ANIM_FLY = 29, ANIM_TRICK = 30, ANIM_BUMPER_TRICK = 31, ANIM_HIT = 32, ANIM_COOL = 33, ANIM_FALL = 34 };
#define NORMAL_SPEED 0x800
#define TOP_SPEED 0xC00
#define MAX_SIDEWAYS 0x400
#define EDGE_X (134 * 256)
#define EDGE_Y (94 * 256)
#define KEY_L_BIT 0x200

// the bob: SIN_24_8 / 16u and the like all come to this
static int bob(int phase) { return SINE[phase] >> 10; }
static int character_anim(const SpPlayer *p) { return spTables.characterAnims[p->character & 3]; }

static void fly(Task *t);

/** sub_8029E0C, sub_8029EA8 and the character's task (Task_802A560). */
void sp_player_create(void) {
  SpPlayer *p = sp.player;
  // the fields CreateSpecialStage leaves are as the last special stage left them (phase, the sprite's hitbox)
  p->character = spGame.character & 0xFF; p->x = 0; p->y = 0; p->depth = 0; p->lift = -52; p->vx = 0; p->vy = 0;
  p->speed = NORMAL_SPEED; p->unk1A = 0; p->unk2B = 0; p->state = SP_STATE_FLYING; p->flags = SP_FLAG_STILL; p->end = 0;
  p->unk2E = 0; p->unk30 = 0; p->unk31 = 0; p->unk40 = 1; p->held = 0; p->pressed = 0; p->variant = 4; p->blink = 0;
  p->unk3F = 0; p->pad = 0; p->lastPad = 0; p->window = 0; p->cooldown = 0; p->timer = 0;
  p->anim = (uint16_t)(ANIM_STAND + character_anim(p));
  Sprite *s = &p->s;
  s->x = s16(120 + I8(p->x)); s->y = s16(80 - I8(p->y)); s->oamFlags = 0x180; s->qAnimDelay = 0; s->animSpeed = 0x10;
  s->palId = 0; s->frameFlags = SP_AFFINE; s->variant = (uint8_t)p->variant; s->prevVariant = 0xFF;
  s->graphics.dest = 0x10000; s->graphics.size = 0; s->graphics.anim = p->anim;
  p->tf.scaleX = 0x100; p->tf.scaleY = 0x100; p->tf.x = 0; p->tf.y = 0;
  create_task(fly, p, 0x1100, 0, NULL);
}

static void move(SpPlayer *p);
static void place(SpPlayer *p);
// what most of the tasks end with: move, place, animate, show
static void step(SpPlayer *p) {
  move(p);
  place(p);
  update_sprite(&p->s, 0);
  sp_transform(&p->s, &p->tf);
  display_sprite(&p->s);
}
static void read_keys(SpPlayer *p) { p->held = e.input; p->pressed = e.pressed; }
static void count_down(SpPlayer *p) { if (p->window != 0) p->window = (int8_t)(p->window - 1); }
static void set_anim(SpPlayer *p, int anim, int variant) {
  p->anim = (uint16_t)anim; p->variant = variant;
  p->s.graphics.anim = p->anim; p->s.variant = (uint8_t)variant; p->s.prevVariant = 0xFF;
}
static void faster_brakes(SpPlayer *p) { p->accel = p->flags & SP_FLAG_FAST ? -0x100 : 0; }

static void glide(Task *t);
static int check_hits(Task *t, SpPlayer *p);
static int check_trick(Task *t, SpPlayer *p);
static void steer(SpPlayer *p);
static void animate(SpPlayer *p);

// Task_802A560: flying
static void fly(Task *t) {
  SpPlayer *p = t->data;
  read_keys(p);
  if (p->end & (SP_END_CHECKPOINT | SP_END_GOAL)) {
    p->timer = 0x78;
    p->vx = s16(sp_div(-p->x, 120)); p->vy = s16(sp_div(-p->y, 120));
    p->ax = 0; p->ay = 0;
    t->main = glide;
    glide(t);
    return;
  }
  if (check_hits(t, p) || check_trick(t, p)) return;
  p->phase = (p->phase + 0x10) & 0x3FF;
  p->lift = (int16_t)bob(p->phase);
  if ((p->held & sp.jump) && !(p->flags & SP_FLAG_STILL)) p->accel = 0x100;
  else faster_brakes(p);
  steer(p);
  animate(p);
  step(p);
}

static void hit(Task *t);
static void dash(Task *t);
static void trick(Task *t);
static void bumper_trick(Task *t);

// sub_8029F30: a bomb's hit, or a dash pad other than the last one
static int check_hits(Task *t, SpPlayer *p) {
  if (p->flags & SP_FLAG_STILL) return 0;
  if (p->flags & SP_FLAG_HIT) {
    p->state = SP_STATE_HIT;
    p->flags &= ~SP_FLAG_HIT;
    hit(t);
    return 1;
  }
  if (p->flags & SP_FLAG_ON_PAD && p->lastPad != p->pad) {
    p->state = SP_STATE_THROWN;
    p->flags &= ~SP_FLAG_ON_PAD;
    p->lastPad = p->pad;
    dash(t);
    return 1;
  }
  return 0;
}

// sub_8029FA4: the attack button. Within a bumper's window it does the bumper trick, which stops the music for the
// trick's own; otherwise a trick, after 12 frames since the last.
static int check_trick(Task *t, SpPlayer *p) {
  if (p->cooldown != 0) {
    p->cooldown = (int8_t)(p->cooldown - 1);
    p->window = 0;
  } else if (p->window != 0) {
    p->window = (int8_t)(p->window - 1);
    if (p->pressed & sp.attack) {
      bumper_trick(t);
      sp_trick_jingle();
      return 1;
    }
  } else if (p->pressed & sp.attack && !(p->flags & SP_FLAG_STILL)) {
    p->turn = p->pressed & KEY_L_BIT ? 0 : -1;
    trick(t);
    return 1;
  }
  return 0;
}

// sub_802A068: the D-pad pushes them its way; let go, they slow by a quarter a frame
static void steer(SpPlayer *p) {
  const int16_t *push = spTables.steer[(p->held & 0xF0) >> 4];
  if (p->held & 0xC0) {
    p->ay = push[1];
    if ((p->vy > 0 && p->ay < 0) || (p->vy < 0 && p->ay > 0)) p->vy = 0;
  } else {
    p->ay = s16(-sp_div(p->vy, 4));
    if (p->ay == 0) p->ay = s16(-p->vy);
  }
  if (p->held & 0x30) {
    p->ax = push[0];
    if ((p->vx > 0 && p->ax < 0) || (p->vx < 0 && p->ax > 0)) p->vx = 0;
  } else {
    p->ax = s16(-sp_div(p->vx, 4));
    if (p->ax == 0) p->ax = s16(-p->vx);
  }
}

// sub_802D2F4: which of the nine areas of the tunnel they are in, 1 to 9, top left first
static int area(const SpPlayer *p) {
  int i = p->x < -40 * 256 ? 1 : p->x <= 40 * 256 ? 2 : 3;
  if (p->y < 30 * 256) i += p->y > -30 * 256 ? 3 : 6;
  return i;
}

// sub_802A134: flying fast, holding a direction, or the area they are in
static void animate(SpPlayer *p) {
  int base = character_anim(p);
  if (p->flags & SP_FLAG_FAST) {
    p->anim = (uint16_t)(ANIM_FLY + base);
    p->variant = p->speed <= 12 * 256 ? 0 : 1;
  } else {
    const int16_t *row = p->held & 0xF0 ? spTables.dpadAnims[(p->held & 0xF0) >> 4] : spTables.areaAnims[area(p)];
    p->anim = (uint16_t)(row[0] + base);
    p->variant = row[1] & 0xFFFF;
  }
  Sprite *s = &p->s;
  if (s->graphics.anim != p->anim || s->variant != p->variant) {
    s->graphics.anim = p->anim; s->variant = (uint8_t)p->variant; s->prevVariant = 0xFF;
  }
}

static int clamp(int v, int lim) { return v > lim ? lim : v < -lim ? -lim : v; }

// sub_802A248: the speeds, then the move, then the tunnel's edges
static void move(SpPlayer *p) {
  int32_t x0 = p->x, y0 = p->y;
  p->vx = s16(p->vx + p->ax);
  p->vy = s16(p->vy + p->ay);
  p->speed = s16(p->speed + p->accel);
  if (p->state == SP_STATE_THROWN) {
    if (p->padKind == 4 || p->padKind == 5) {
      p->vx = (int16_t)clamp(s16(p->vx + p->ax), MAX_SIDEWAYS);
      p->vy = (int16_t)clamp(s16(p->vy + p->ay), MAX_SIDEWAYS);
      // the backward pad scales the speeds across by the speed down, the forward one by its inverse
      if (p->padKind == 4) { p->vx = s16(sp_div(p->vx * I8(p->speed), 8)); p->vy = s16(sp_div(p->vy * I8(p->speed), 8)); }
      else { p->vx = s16(sp_div(p->vx * 8, I8(p->speed))); p->vy = s16(sp_div(p->vy * 8, I8(p->speed))); }
      p->x = p->x + p->vx;
      p->y = p->y + p->vy;
    } else {
      p->x = x0 + p->vx;
      p->y = y0 + p->vy;
    }
  } else {
    p->vx = (int16_t)clamp(p->vx, MAX_SIDEWAYS);
    p->vy = (int16_t)clamp(p->vy, MAX_SIDEWAYS);
    if (p->speed > TOP_SPEED) p->speed = TOP_SPEED;
    else if (p->speed < NORMAL_SPEED) p->speed = NORMAL_SPEED;
    if (p->speed == NORMAL_SPEED) p->flags &= ~SP_FLAG_FAST;
    else p->flags |= SP_FLAG_FAST;
    if (p->flags & SP_FLAG_FAST) {
      // faster, they steer less, drift back to the middle, and can't move away from it faster than 1/32 of how far
      // they are
      int lim = p->y >> 5;
      if (lim >= 0 ? lim < p->vy : lim > p->vy) p->vy = s16(lim);
      p->x = p->x + sp_div(p->vx * 8, I8(p->speed));
      p->y = p->y + sp_div(p->vy * 8, I8(p->speed));
      p->x = p->x - (p->x >> 5);
      p->y = p->y - (p->y >> 5);
    } else {
      p->x = p->x + p->vx;
      p->y = p->y + p->vy;
    }
  }
  if (!(p->flags & SP_FLAG_STILL)) p->depth = p->depth + p->speed;
  p->x = clamp(p->x, EDGE_X);
  p->y = clamp(p->y, EDGE_Y);
}

// sub_802A4C4: where they show, nearer the middle when the bob takes them further away, and how big
static void place(SpPlayer *p) {
  Sprite *s = &p->s;
  int f = p->lift + 0x240;
  int x = s16(sp_div(p->x * f, 576) >> 8), y = s16(sp_div(p->y * f, 576) >> 8);
  p->screenX = s16(x + 120 + sp.bg.x);
  p->screenY = s16(80 - y - sp.bg.y);
  s->x = p->screenX; s->y = p->screenY;
  p->tf.x = s->x; p->tf.y = s->y;
  p->tf.scaleX = p->tf.scaleY = s16(p->lift + 0x100);
  s->frameFlags = SP_AFFINE;
}

static void dashing(Task *t);
// sub_802A688: a dash pad throws them: its speeds (a third more when they were fast) and its animation; the diagonal
// ones half as much again, slowing down three times as fast
static void dash(Task *t) {
  SpPlayer *p = t->data;
  int i = (p->padKind - 4) & 0xFFFF, vx = spTables.dashSpeeds[i][0], vy = spTables.dashSpeeds[i][1], speed = spTables.dashSpeeds[i][2];
  set_anim(p, spTables.dashAnims[i][0] + character_anim(p), spTables.dashAnims[i][1]);
  if (p->flags & SP_FLAG_FAST) { p->vx = s16(sp_div(vx * 4, 3)); p->vy = s16(sp_div(vy * 4, 3)); p->speed = s16(sp_div(speed * 4, 3)); }
  else { p->vx = (int16_t)vx; p->vy = (int16_t)vy; p->speed = (int16_t)speed; }
  if (i == 0) { p->ax = 0; p->ay = 0; p->accel = 0x40; }
  else if (i == 1) { p->ax = 0; p->ay = 0; p->accel = -0x40; }
  else {
    // the original multiplies by 1.5 and 3 in floating point, which truncates as these do
    p->ax = s16(-(vx >> 7) * 3); p->ay = s16(-(vy >> 7) * 3);
    p->vx = s16(p->vx * 3 / 2); p->vy = s16(p->vy * 3 / 2); p->speed = s16(p->speed * 3 / 2);
    p->accel = -0x60;
  }
  sp_se(SONG_SPECIAL_DASH);
  p->flags &= ~(SP_FLAG_FAST | SP_FLAG_ON_PAD);
  step(p);
  t->main = dashing;
}

// sub_802A890: thrown, steering only on the forward and backward pads, until back to normal speed
static void dashing(Task *t) {
  SpPlayer *p = t->data;
  read_keys(p);
  count_down(p);
  if (p->padKind == 4 ? p->speed > 0 : p->padKind == 5) steer(p);
  if (check_hits(t, p)) return;
  if (p->padKind == 4 ? p->speed >= NORMAL_SPEED : p->speed <= NORMAL_SPEED) {
    t->main = fly;
    p->state = SP_STATE_FLYING; p->speed = NORMAL_SPEED; p->accel = 0; p->cooldown = 0;
  }
  step(p);
}

static void blinking(Task *t);
// sub_802A988: a bomb: they drop up to 10 rings and blink for a second, steering again for its last half
static void hit(Task *t) {
  SpPlayer *p = t->data;
  if (sp.collected != 0) {
    sp_lost_rings_create();
    sp_se(SONG_RINGS_LOST);
  }
  set_anim(p, character_anim(p) + ANIM_HIT, 0);
  p->vx = 0; p->vy = 0; p->speed = NORMAL_SPEED; p->ax = 0; p->ay = 0; p->accel = 0;
  p->flags &= 0xFE;
  p->blink = 0x3C;
  step(p);
  t->main = blinking;
}

// Task_802AA48
static void blinking(Task *t) {
  SpPlayer *p = t->data;
  read_keys(p);
  count_down(p);
  p->blink = s16(p->blink - 1);
  if (p->blink == 0) {
    t->main = fly;
    p->state = SP_STATE_FLYING;
    p->cooldown = 0;   // the byte 0x16 after unk28
  }
  if (p->blink <= 30) steer(p);
  move(p);
  place(p);
  update_sprite(&p->s, 0);
  sp_transform(&p->s, &p->tf);
  if (!(p->blink & 2)) display_sprite(&p->s);
}

static void tricking(Task *t);
// sub_802ABA0: a trick, 45 frames of their trick animation, still across the tunnel
static void trick(Task *t) {
  SpPlayer *p = t->data;
  set_anim(p, character_anim(p) + ANIM_TRICK, 0);
  p->vx = 0; p->vy = 0; p->ax = 0; p->ay = 0; p->accel = 0;
  p->state = SP_STATE_TRICK;
  p->flags |= SP_FLAG_TRICK;
  p->trickTime = 0x2D;
  sp_se(SONG_SPECIAL_TRICK);
  step(p);
  t->main = tricking;
}

// Task_802AC50
static void tricking(Task *t) {
  SpPlayer *p = t->data;
  count_down(p);
  if (check_hits(t, p)) return;
  p->accel = p->flags & SP_FLAG_FAST ? -0x80 : 0;
  p->trickTime = s16(p->trickTime - 1);
  if (p->trickTime == 0) {
    t->main = fly;
    p->flags &= ~SP_FLAG_TRICK;
    p->state = SP_STATE_FLYING;
    p->cooldown = 0xC;
  }
  step(p);
}

static void bumper_tricking(Task *t);
// sub_802ACF0: the trick after a bumper, its own animation through once
static void bumper_trick(Task *t) {
  SpPlayer *p = t->data;
  set_anim(p, character_anim(p) + ANIM_BUMPER_TRICK, 0);
  p->vx = 0; p->vy = 0; p->ax = 0; p->ay = 0; p->accel = 0;
  p->state = SP_STATE_BUMPER_TRICK;
  p->flags |= SP_FLAG_BUMPER_TRICK;
  sp_se(SONG_SPECIAL_TRICK);
  step(p);
  t->main = bumper_tricking;
}

// Task_802AD9C
static void bumper_tricking(Task *t) {
  SpPlayer *p = t->data;
  count_down(p);
  if (check_hits(t, p)) return;
  p->accel = p->flags & SP_FLAG_FAST ? -0x80 : 0;
  if (p->s.frameFlags & SPRITE_ANIM_OVER) {
    t->main = fly;
    p->flags &= ~SP_FLAG_BUMPER_TRICK;
    p->state = SP_STATE_FLYING;
    p->cooldown = 0xC;
  }
  step(p);
}

static void falling(Task *t);
static void cheering(Task *t);
static void cleared(Task *t);

// not enough rings at the checkpoint or the goal: they fall away, AAARGH!
static void fall(Task *t, SpPlayer *p, int base) {
  p->timer = 0;
  p->anim = (uint16_t)(base + ANIM_FALL); p->variant = 0;
  t->main = falling;
  sp_fall_effect_create();
  sp_message_create(SP_MESSAGE_AAARGH);
}

// Task_802AE40: 120 frames gliding back to the middle, then the checkpoint's or the goal's outcome
static void glide(Task *t) {
  SpPlayer *p = t->data;
  p->held = 0; p->pressed = 0;
  p->phase = (p->phase + 0x10) & 0x3FF;
  p->lift = (int16_t)bob(p->phase);
  p->accel = p->flags & SP_FLAG_FAST ? -0x100 : 0;
  animate(p);
  step(p);
  p->timer = s16(p->timer - 1);
  if (p->timer != 0) return;
  int base = character_anim(p);
  if (p->end == SP_END_CHECKPOINT) {
    if (sp.targets[0] <= sp.collected) {
      p->timer = 0x14A;
      p->anim = (uint16_t)(base + ANIM_COOL); p->variant = 0;
      t->main = cheering;
      sp_message_create(SP_MESSAGE_COOL);
    } else fall(t, p, base);
  } else if (sp.targets[1] <= sp.collected) {
    p->anim = (uint16_t)(base + ANIM_COOL); p->variant = 0;
    t->main = cleared;
    sp_play(SONG_SPECIAL_STAGE_CLEAR);
    sp_message_create(SP_MESSAGE_COOL);
  } else fall(t, p, base);
  p->s.graphics.anim = p->anim; p->s.variant = (uint8_t)p->variant; p->s.prevVariant = 0xFF;
}

// sub_802B008: not enough rings: they shrink away for 120 frames, then stay out of sight
static void falling(Task *t) {
  SpPlayer *p = t->data;
  if (p->timer <= -120) return;
  p->timer = s16(p->timer - 1);
  p->lift = p->timer;
  p->held = 0; p->pressed = 0;
  faster_brakes(p);
  steer(p);
  step(p);
}

// sub_802B07C: past the checkpoint: the goal's target and its title card 151 frames in, the cheer's second half at the
// end of the count, and on once the cheer's animation ends
static void cheering(Task *t) {
  SpPlayer *p = t->data;
  p->held = 0; p->pressed = 0;
  p->phase = (p->phase + 0x10) & 0x3FF;
  p->lift = (int16_t)bob(p->phase);
  p->accel = p->flags & SP_FLAG_FAST ? -0x100 : 0;
  steer(p);
  step(p);
  if (p->timer == 0xB4) {
    sp.target = sp.targets[1];
    destroy_tasks(0x1180, 0x1181);
    sp.hudBlink = 0;
    sp_title_card_create(0);
  }
  if (p->timer != 0) {
    p->timer = s16(p->timer - 1);
    if (p->timer == 0) { p->variant = 1; p->s.variant = 1; p->s.prevVariant = 0xFF; }
  }
  if (p->s.frameFlags & SPRITE_ANIM_OVER) {
    t->main = fly;
    p->flags = 0;
    p->end = 0;
    p->cooldown = 0xC;
  }
}

// sub_802B18C: past the goal, cheering until the stage fades out
static void cleared(Task *t) {
  SpPlayer *p = t->data;
  p->held = 0; p->pressed = 0;
  p->phase = (p->phase + 0x10) & 0x3FF;
  p->lift = (int16_t)bob(p->phase);
  p->accel = p->flags & SP_FLAG_FAST ? -0x100 : 0;
  steer(p);
  step(p);
}
