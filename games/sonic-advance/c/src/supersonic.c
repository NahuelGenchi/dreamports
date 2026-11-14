// Super Sonic, the Moon Zone's player (SAT-R decompilation, src/game/sa1/stage/player_super_sonic.c, checked in
// the USA ROM). Translated from the JavaScript version's engine/supersonic.js.

#include "extra.h"
#include "terrain.h"
#include "bosses.h"

enum {
  CHAR_START = 0, CHAR_DEAD = 1, CHAR_FLY = 2, CHAR_DASH = 3, CHAR_HURT = 4,
  ANIM_SUPER_START = 398, ANIM_SUPER_DEAD = 21, ANIM_SUPER_FLY = 399, ANIM_SUPER_DASH = 400, ANIM_SUPER_SPARKLE = 775,
  DASH_TRAIL_TILES = 40, SPARKLE_TILES = 4,
  MAX_X = 480 << 8,
  FLY_ACCEL = 36, FLY_DECEL = 96, AIR_ACCEL = 72, MAX_SPEED = 2 << 8,
  JUMP = 1088, JUMP_RELEASE_CAP = -384, GRAVITY = 32,
  DASH_SPEED = 4 << 8, DASH_DECEL = 64, DASH_WAIT = 8,
  STEP_DOWN = 11,
  HURT_SPEED = -3 << 8, HURT_FRAMES = 24, HURT_BLINK = 30, HURT_SPIN = 12,
  OFFSET_X = 6, OFFSET_Y = 14,
  DEAD_GRAVITY = 42, DEAD_BELOW = 240, DEAD_RESTART = 60,
  MAX_SPARKLES = 4,
  TRAIL = 16,
  SCROLL_WRAP = 28 * 96, SCROLL_FROM = 72,
  KEY_BIT_A = 0x1, KEY_BIT_B = 0x2, KEY_BIT_RIGHT = 0x10, KEY_BIT_LEFT = 0x20, KEY_BIT_UP = 0x40, KEY_BIT_DOWN = 0x80,
  SE_JUMP = 104, SE_AIR_DASH = 112, SE_LIFE_LOST = 119, SE_TIMER = 139,
};

typedef struct {
  int qx, qy, vx, vy, gsp;
  uint8_t rotation;
  int air, jumped, captured, override;
  int charState, knockback, dashWait, dashing, drain;
  int held, pressed;
  int trailI, trailX[TRAIL], trailY[TRAIL];
} SuperState;

static SuperState ss;
static int sparklesLeft, dashTrails, had3001;

static const uint16_t ANIMS[5][2] = {
  { ANIM_SUPER_START, 0 },
  { ANIM_SUPER_DEAD, 0 },
  { ANIM_SUPER_FLY, 0 },
  { ANIM_SUPER_FLY, 1 },
  { ANIM_SUPER_FLY, 2 },
};

int moon_ground_scroll(int camX, int tick) {
  int x = camX + tick * 8;
  if (x - SCROLL_FROM >= SCROLL_WRAP) x = ((x - SCROLL_FROM) % SCROLL_WRAP) + SCROLL_FROM;
  return x;
}

static void sync_player(Player *p) {
  p->x = (double)ss.qx / 256.0;
  p->y = (double)ss.qy / 256.0;
  p->xsp = (double)ss.vx / 256.0;
  p->ysp = (double)ss.vy / 256.0;
  p->gsp = (double)ss.gsp / 256.0;
  p->air = ss.air;
  p->state = ss.charState;
}

void supersonic_init(Player *p, int x, int y) {
  player_init(p, x, y);
  p->layer = LAYER_BACK;
  p->offsetY = OFFSET_Y;
  p->ignoreInput = 1;
  p->sprite.oamFlags = (uint16_t)(16 << 6);
  p->sprite.frameFlags = (1u << 12) | SPRITE_X_FLIP;
  memset(&ss, 0, sizeof ss);
  ss.qx = x << 8;
  ss.qy = y << 8;
  ss.charState = CHAR_START;
  ss.held = KEY_BIT_A | KEY_BIT_B;
  for (int i = 0; i < TRAIL; i++) { ss.trailX[i] = ss.qx; ss.trailY[i] = ss.qy; }
  sparklesLeft = MAX_SPARKLES; dashTrails = 0;
  sync_player(p);
}

static int floor_dist(const Player *p) {
  int cx = (int)act.cam.x;
  int x = (ss.qx >> 8) - (cx - moon_ground_scroll(cx, act_stage_time()));
  int y = (ss.qy >> 8) + OFFSET_Y;
  int a = terrain_scan(PROBE_FLOOR, y, x - 2 - OFFSET_X, p->layer, 8).d;
  int b = terrain_scan(PROBE_FLOOR, y, x + 2 + OFFSET_X, p->layer, 8).d;
  return a < b ? a : b;
}

void supersonic_follow_ground(Player *p) {
  int d = floor_dist(p);
  if (d < 0) { if (d >= -STEP_DOWN) ss.qy += d << 8; return; }
  if (d > STEP_DOWN) { if (!ss.captured) ss.air = 1; return; }
  ss.qy += d << 8;
}

static void land(Player *p) {
  int d = floor_dist(p);
  if (d >= 0) return;
  ss.qy += d << 8;
  ss.gsp = ss.vx; ss.vy = 0;
  ss.jumped = 0; ss.air = 0;
  ss.dashing = 0;
}

static void clamp_x(void) {
  int x = ss.qx < 0 ? 0 : ss.qx > MAX_X ? MAX_X : ss.qx;
  if (x != ss.qx) { if (!ss.air) ss.gsp = 0; ss.vx = 0; }
  ss.qx = x;
}

static void move_ss(void) {
  ss.qx += 2 * ss.vx;
  ss.qy += 2 * ss.vy;
}

// --- dash trail & sparkles --------------------------------------------------------------------------------------
typedef struct { Object o; int ending, ready; } DashTrail;

static int dash_trail_run(ActTask *t) {
  DashTrail *dt = (DashTrail *)t->data;
  Player *p = &act.player;
  if (!dt->ready) { dt->ready = 1; return 1; }
  if (p->dead || (dt->ending && (dt->o.sprite.frameFlags & SPRITE_ANIM_OVER))) { dashTrails--; return 0; }
  if (!ss.dashing || ss.captured) {
    dt->ending = 1;
    dt->o.sprite.variant = 1;
  }
  dt->o.sprite.frameFlags = (dt->o.sprite.frameFlags & ~SPRITE_PRIORITY) | ((act_stage_time() & 2 ? 2u : 1u) << 12) | SPRITE_X_FLIP;
  update_sprite(&dt->o.sprite, 0);
  boss_display(&dt->o.sprite, (ss.qx >> 8) - cam_x(), (ss.qy >> 8) - cam_y());
  return 1;
}

static void spawn_dash_trail(void) {
  DashTrail *dt = OBJECT_NEW(DashTrail);
  if (!dt) return;
  dt->ending = 0; dt->ready = had3001;
  dashTrails++;
  object_sprite_at(&dt->o.sprite, vram_malloc(DASH_TRAIL_TILES), ANIM_SUPER_DASH, 0, 8, 1, 1, 0);
  object_task(&dt->o, dash_trail_run, PRIORITY_SONIC + 1);
}

typedef struct { Object o; int qx, qy, speed, ready; } Sparkle;

static int sparkle_run(ActTask *t) {
  Sparkle *sp = (Sparkle *)t->data;
  if (!sp->ready) { sp->ready = 1; return 1; }
  int x = (sp->qx >> 8) - cam_x();
  if ((sp->o.sprite.frameFlags & SPRITE_ANIM_OVER) || x < -16 || x >= 256) {
    sparklesLeft++;
    return 0;
  }
  update_sprite(&sp->o.sprite, 0);
  boss_display(&sp->o.sprite, x, (sp->qy >> 8) - cam_y());
  sp->qx += (int16_t)sp->speed;
  sp->speed = (sp->speed - 64) & 0xFFFF;
  return 1;
}

static void spawn_sparkle(int qx, int qy, int small) {
  if (sparklesLeft <= 0) return;
  sparklesLeft--;
  Sparkle *sp = OBJECT_NEW(Sparkle);
  if (!sp) { sparklesLeft++; return; }
  sp->qx = qx; sp->qy = qy; sp->speed = 0; sp->ready = had3001;
  object_sprite_at(&sp->o.sprite, vram_malloc(SPARKLE_TILES), ANIM_SUPER_SPARKLE, small ? 1 : 0, 8, 1, 1, 0);
  object_task(&sp->o, sparkle_run, PRIORITY_SONIC + 1);
}

// --- movement ---------------------------------------------------------------------------------------------------
static int start_dash(void) {
  if (ss.dashWait != 0 && --ss.dashWait != 0) return 0;
  if (!(ss.pressed & KEY_BIT_B)) return 0;
  ss.dashWait = DASH_WAIT; ss.dashing = 1;
  ss.gsp = DASH_SPEED; ss.vx = 0; ss.vy = 0;
  spawn_dash_trail();
  play_song(SE_AIR_DASH);
  return 1;
}

static void dash_step(Player *p) {
  ss.gsp -= DASH_DECEL;
  if (ss.gsp <= 0) { ss.dashing = 0; ss.vx = 0; ss.vy = 0; }
  else ss.vx = ss.gsp;
  clamp_x(); move_ss();
  supersonic_follow_ground(p);
  ss.charState = CHAR_DASH;
}

static void ground_step(Player *p) {
  if (ss.dashing) { dash_step(p); return; }
  if (start_dash()) return;
  if (ss.pressed & KEY_BIT_A) {
    ss.air = 1; ss.jumped = 1;
    ss.vy -= JUMP;
    play_song(SE_JUMP);
    return;
  }
  switch (ss.held & (KEY_BIT_LEFT | KEY_BIT_RIGHT)) {
    case 0:
      if (ss.gsp > 0) ss.gsp = ss.gsp - FLY_DECEL > 0 ? ss.gsp - FLY_DECEL : 0;
      else if (ss.gsp < 0) ss.gsp = ss.gsp + FLY_DECEL < 0 ? ss.gsp + FLY_DECEL : 0;
      break;
    case KEY_BIT_LEFT: ss.gsp = ss.gsp - FLY_ACCEL > -MAX_SPEED ? ss.gsp - FLY_ACCEL : -MAX_SPEED; break;
    case KEY_BIT_RIGHT: ss.gsp = ss.gsp + FLY_ACCEL < MAX_SPEED ? ss.gsp + FLY_ACCEL : MAX_SPEED; break;
  }
  ss.vx = ss.gsp;
  clamp_x(); move_ss();
  supersonic_follow_ground(p);
  ss.charState = CHAR_FLY;
}

static void air_step(Player *p) {
  if (ss.dashing) { dash_step(p); return; }
  if (start_dash()) return;
  if (!(ss.held & KEY_BIT_A) && ss.jumped && ss.vy < JUMP_RELEASE_CAP) ss.vy = JUMP_RELEASE_CAP;
  switch (ss.held & (KEY_BIT_LEFT | KEY_BIT_RIGHT)) {
    case KEY_BIT_LEFT: ss.vx = ss.vx - AIR_ACCEL > -MAX_SPEED ? ss.vx - AIR_ACCEL : -MAX_SPEED; break;
    case KEY_BIT_RIGHT: ss.vx = ss.vx + AIR_ACCEL < MAX_SPEED ? ss.vx + AIR_ACCEL : MAX_SPEED; break;
  }
  clamp_x(); move_ss();
  ss.vy += GRAVITY;
  int rot = (int8_t)ss.rotation;
  if (rot < 0) ss.rotation = (uint8_t)(rot + 2 < 0 ? rot + 2 : 0);
  else if (rot > 0) ss.rotation = (uint8_t)(rot - 2 > 0 ? rot - 2 : 0);
  if (ss.vy >= 0) land(p);
  ss.charState = CHAR_FLY;
}

static void move_step(Player *p) {
  if (ss.knockback != 0) {
    ss.rotation = (uint8_t)(ss.rotation - HURT_SPIN);
    move_ss();
    supersonic_follow_ground(p);
    return;
  }
  if (ss.air) air_step(p);
  else ground_step(p);
  if (act_stage_time() % 4 != 0 || !(act_random() & 0x10000)) return;
  int x = ss.qx + ((act_random() & 0xF0000) >> 8);
  int y = ss.qy + ((act_random() & 0xF0000) >> 8) - (8 << 8);
  spawn_sparkle(x, y, (act_random() & 0x10000) != 0);
}

int hurt_super_sonic(Player *p) {
  if (p->invincible > 0 || p->invulnerable > 0) return 0;
  p->invulnerable = HURT_BLINK;
  ss.vx = HURT_SPEED; ss.gsp = HURT_SPEED; ss.vy = 0;
  ss.knockback = HURT_FRAMES;
  ss.charState = CHAR_HURT;
  ss.dashWait = 0; ss.dashing = 0;
  play_song(SE_LIFE_LOST);
  return 1;
}

int supersonic_dashing(const Player *p) { (void)p; return ss.dashing; }

void supersonic_bounce(Player *p) {
  ss.dashing = 0;
  p->invulnerable = 8;
  ss.vx = -(2 << 8); ss.gsp = -(2 << 8);
}

void supersonic_capture(int hold) {
  if (hold < 0) { ss.captured = 0; ss.override = 0; act.player.invisible = 0; return; }
  if (hold == 0) { ss.captured = 1; return; }
  ss.gsp = 0; ss.vx = 0; ss.vy = 0; ss.dashing = 0;
  ss.override = 1;
  act.player.invisible = 1;
}

int supersonic_captured(void) { return ss.captured; }

void supersonic_captured_step(void) { supersonic_follow_ground(&act.player); sync_player(&act.player); }

static void dead_step(Player *p) {
  if (p->death == PLAYER_GONE) {
    if (p->countdown != 0) p->countdown--;
    else act_life_lost();
    return;
  }
  if (ss.qy >= (((int)act.cam.y + DEAD_BELOW) << 8) - 1) {
    p->death = PLAYER_GONE;
    p->countdown = DEAD_RESTART;
    return;
  }
  ss.qx += ss.vx; ss.qy += ss.vy;
  ss.vy += DEAD_GRAVITY;
  sync_player(p);
}

void supersonic_step(Player *p, const PlayerInput *in) {
  had3001 = (sparklesLeft < 4) || (dashTrails > 0);
  if (p->death != PLAYER_ALIVE) { dead_step(p); return; }
  act.cam.minY = act.stage.height - 200;
  act.cam.maxX = 480 - SCREEN_W;
  act.cam.shiftX = 64;
  act.cam.shiftY = 0;
  int old = ss.held;
  if (!p->ignoreInput) {
    ss.held = (in->jump ? KEY_BIT_A : 0) | (in->attack ? KEY_BIT_B : 0)
            | (in->right ? KEY_BIT_RIGHT : 0) | (in->left ? KEY_BIT_LEFT : 0)
            | (in->up ? KEY_BIT_UP : 0) | (in->down ? KEY_BIT_DOWN : 0);
  }
  ss.pressed = (old ^ ss.held) & ss.held;
  p->heldDirs = ss.held;
  p->pressedDirs = ss.pressed;
  if (p->dead) {
    p->death = PLAYER_FALLING;
    ss.charState = CHAR_DEAD;
    ss.vx = 0;
    p->invulnerable = 2;
    act_player_died();
    music_call(MUSIC_PLAYER, 0);
  } else if (!ss.override) {
    move_step(p);
  }
  ss.trailI = (ss.trailI + 1) & (TRAIL - 1);
  ss.trailX[ss.trailI] = ss.qx;
  ss.trailY[ss.trailI] = ss.qy;
  if (act.cardDone && p->death == PLAYER_ALIVE && !moon_boss_down()) {
    if (++ss.drain >= 60) {
      ss.drain -= 60;
      if (--act.ringCount <= 10) play_song(SE_TIMER);
      if (act.ringCount == 0) p->dead = 1;
    }
  }
  sync_player(p);
}

void supersonic_animate(Player *p) {
  if (p->death == PLAYER_GONE) return;
  Sprite *s = &p->sprite;
  s->graphics.anim = ANIMS[ss.charState][0];
  s->variant = (uint8_t)ANIMS[ss.charState][1];
  s->frameFlags = (s->frameFlags & ~SPRITE_Y_FLIP) | SPRITE_X_FLIP;
  update_sprite(s, 0);
  p->prio = (int)((s->frameFlags & SPRITE_PRIORITY) >> 12);
  p->hidden = !p->dead && (p->invisible || (ss.knockback == 0 && p->invulnerable != 0 && (act_stage_time() & 2)));
  if (ss.knockback != 0) ss.knockback--;
  else if (p->invulnerable > 0) p->invulnerable--;
}

void supersonic_draw(Player *p, int camX, int camY) {
  if (p->death == PLAYER_GONE) return;
  Sprite *s = &p->sprite;
  if (p->death != PLAYER_ALIVE) {
    s->x = (int16_t)((ss.qx >> 8) - camX);
    s->y = (int16_t)((ss.qy >> 8) - camY);
    display_sprite(s);
    return;
  }
  if (p->hidden) return;
  int hurt = ss.charState == CHAR_HURT;
  int sx = (ss.qx >> 8) - camX, sy = (ss.qy >> 8) - camY;
  s->frameFlags &= ~(SPRITE_ROT_SCALE | SPRITE_ROT_SCALE_ENABLE | SPRITE_DOUBLE_SIZE | SPRITE_X_FLIP);
  if (hurt) {
    Transform tf = { .rotation = (uint16_t)(ss.rotation * 4), .qScaleX = -256, .qScaleY = 256, .x = (int16_t)sx, .y = (int16_t)sy };
    s->frameFlags |= SPRITE_ROT_SCALE_ENABLE;
    transform_sprite(s, &tf);
  } else {
    s->frameFlags |= SPRITE_X_FLIP;
    s->x = (int16_t)sx; s->y = (int16_t)sy;
  }
  display_sprite(s);
  if ((act_stage_time() - 1) & 2) return;
  for (int k = 1; k < 4; k++) {
    int i = (ss.trailI - 2 * k) & (TRAIL - 1);
    int tx = (ss.trailX[i] >> 8) - k * 8 - camX, ty = (ss.trailY[i] >> 8) - camY;
    if (hurt) {
      Transform tf = { .rotation = (uint16_t)(ss.rotation * 4), .qScaleX = -256, .qScaleY = 256, .x = (int16_t)tx, .y = (int16_t)ty };
      transform_sprite(s, &tf);
    } else {
      s->x = (int16_t)tx; s->y = (int16_t)ty;
    }
    display_sprite(s);
  }
}
