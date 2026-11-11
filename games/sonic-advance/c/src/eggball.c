// Casino Paradise's boss, the Egg Ball (enemy kind 24), at the end of act 2. Translated from the JavaScript version's
// engine/eggball.js (the original's boss_3_egg_ball.c).
//
// When its spawn point comes into range the random numbers start over from the frame count, the camera closes in on the arena,
// 280 px wide and ending at the spawn point, and the boss music starts. 121 frames later Eggman's mobile shows 85 px left of the
// spawn point and rises 80 px, a second still, Eggman laughs, a second more, and it climbs out of sight, 208 px up, where it
// lets its spiked ball go. Then, a second between passes, the mobile and the ball each cross the arena along one of eight
// straight paths, picked together at random, faster with each hit it takes. Eight pipes slide out of the walls, the floor and
// the ceiling a second and a half after it spawned; the two in the floor are solid. A hit flashes it white for 16 of the 32
// frames in which it can't be hit again. The eighth hit beats it: the ball flies off bouncing and exploding for three seconds,
// the thin platforms go, the camera stops across and its top edge drops 40 px, the pipes slide back out, and the mobile falls
// and bounces, throwing debris, until four seconds after it was beaten Eggman escapes in the Egg Mobile, its star disc flies
// off, the capsule comes and the stage's music comes back.
//
// The white flash is the mobile drawn into the OBJ window, which the act brightens to white (act.bossFlash). The CPU partner is
// left out with the characters.

#include "bosses.h"

enum {
  ANIM_PIPES = 593, PIPE_FLOOR = 0, PIPE_SIDE = 1,
  ANIM_EGGMAN = 622, EGGMAN_STILL = 0, EGGMAN_LAUGH = 1, EGGMAN_HIT = 2,
  ANIM_STAR_DISC = 623, ANIM_MOBILE = 624, ANIM_SPIKE_BALL = 625,
  MOBILE_TILES = 36, EGGMAN_TILES = 8, PIPE_TILES = 28, SPIKE_BALL_TILES = 36, STAR_DISC_TILES = 16,
  MOBILE_ORDER = 21, EGGMAN_ORDER = 22, SPIKE_BALL_ORDER = 23, PIPE_ORDER = 14, PIPE_SIDE_ORDER = 18,
  PRIORITY_EGG_BALL = 0x2100, PRIORITY_PIPE = 0x2200, PRIORITY_SPIKE_BALL = 0x2800,
  PRIORITY_THIN = 0x2010, PRIORITY_THIN_END = 0x2011,
  OBJ_WINDOW = 0x100,                       // SPRITE_OBJ_MODE 2: the sprite is drawn into the OBJ window
  ARENA_UP = DISPLAY_HEIGHT + 24, ARENA_DOWN = 16, ARENA_WIDTH = DISPLAY_WIDTH + 40,
  WAIT = 120, APPEAR_X = -85, RISE_TO = -80, CLIMB_TO = -208, STILL = 60,
  HITS = 8, PINCH = 4, FLASH = 32, FLASH_WHITE = 16, HIT_SCORE = 1000,
  FACES_RIGHT_X = -140, OUT_LEFT = 312, OUT_WIDTH = 344, OUT_TOP = -208, OUT_BOTTOM = 40,
  FALL_START = -0x200, FALL_GRAVITY = 0x28, FLOOR_BELOW = 24, DEBRIS_EVERY = 7, DEBRIS_BELOW = 32, DEBRIS_GRAVITY = 40,
  CAM_TOP_DOWN = 40, WRECK_FRAMES = 240, EGG_MOBILE_UP = 8,
  DISC_VX = 4 * 256, DISC_VY = -2 * 256, DISC_SPIN = 0x80, DISC_FRAMES = 60,
  BALL_VX = 2 * 256, BALL_UP = -6 * 256, BALL_FASTER = 3 * 256, BALL_GRAVITY = 40, BALL_FRAMES = 0xB4,
  PIPES = 8, PIPE_DELAY = 90, PIPE_OUT_STEP = 4,
  SE_BOSS_HIT = 143, SE_EXPLOSION = 144,
};

// the speed of a pass for each number of hits taken, in tenths (gUnknown_084ACDC0)
static const int16_t SPEEDS[HITS + 1] = { 10, 10, 10, 10, 12, 12, 14, 16, 16 };
// the eight paths, each from where it starts off one side of the arena to where it leaves the other, from the spawn point, in
// 1/256 px: x, y and their speeds (gUnknown_084ACE24)
static const int32_t PATHS[8][4] = {
  { -79872, -32000, 489, 0 }, { -79872, -11008, 489, 0 }, { 8192, -32000, -489, 0 }, { 8192, -11008, -489, 0 },
  { -49920, -53248, 0, 352 }, { -21760, -53248, 0, 352 }, { -49920, 10240, 0, -352 }, { -21760, 10240, 0, -352 },
};
// the eight choices a pass picks from: the mobile's path and the ball's (gUnknown_084ACEA4)
static const uint8_t CHOICES[8][2] = { { 0, 3 }, { 5, 1 }, { 3, 6 }, { 4, 5 }, { 1, 7 }, { 6, 2 }, { 2, 4 }, { 7, 0 } };
// the pipes: where each sits from the spawn point, its variant and flips (gUnknown_084ACDD2), and how far out of place it starts
// before sliding in (gUnknown_084ACE12)
static const struct { int16_t x, y; uint8_t variant, flipX, flipY; int8_t startX, startY; } PIPE[PIPES] = {
  { -223, 16, PIPE_FLOOR, 0, 0, 0, 32 }, { -113, 16, PIPE_FLOOR, 0, 0, 0, 32 },
  { 0, -71, PIPE_SIDE, 1, 0, 32, 0 }, { 0, -153, PIPE_SIDE, 1, 0, 32, 0 },
  { -113, -184, PIPE_FLOOR, 0, 1, 0, -32 }, { -223, -184, PIPE_FLOOR, 0, 1, 0, -32 },
  { -280, -71, PIPE_SIDE, 0, 0, -32, 0 }, { -280, -153, PIPE_SIDE, 0, 0, -32, 0 },
};

typedef struct EggBall EggBall;
typedef struct SpikeBall SpikeBall;
typedef int (*Phase)(EggBall *);
typedef int (*BallPhase)(SpikeBall *);

struct EggBall {
  Object o;                 // the mobile
  Sprite s2;                // Eggman
  Phase phase;
  int x0, y0;               // the spawn point
  int qx, qy, vx, vy;       // the offsets from the spawn point and their speeds, 1/256 px (qUnk70, qUnk74, qUnk78, qUnk7C)
  int t;                    // a frame counter (unk88, 16 bits)
  int hits, flash;          // the hits taken (unk8A) and the frames left of a hit's flash (unk8B)
  int pinch;                // hit four times (unk8C); nothing reads it
  int choice;               // the pass's choice of paths (unk8E)
  int fall;                 // the beaten mobile's fall (qUnk90, 16 bits)
  SpikeBall *ball;          // strc6C
};

struct SpikeBall {
  Object o;
  BallPhase phase;
  EggBall *boss;
  int x0, y0, qx, qy, vx, vy;   // as the mobile's (qUnk30, qUnk34, qUnk38, qUnk3C)
  int t;                        // unk40, 16 bits
  int go;                       // the mobile has started a pass (unk42)
  int blow;                     // the mobile is beaten
};

typedef struct {
  Object o;
  EggBall *boss;
  int i, delay;             // which pipe (unk44) and the frames before it slides in
  int x, y, ox, oy;         // its place and how far out of it it is (unk3C, unk3E, unk40, unk42)
} Pipe;

static int at_x(const EggBall *b) { return s16(b->x0 + enemy_i(b->qx)); }
static int at_y(const EggBall *b) { return s16(b->y0 + enemy_i(b->qy)); }
static int alive(void) { return !act.player.dead; }
static int over(const Sprite *s) { return (s->frameFlags & SPRITE_ANIM_OVER) != 0; }
// the original sets the variant alone, so the animation starts over only when it changes
static void set_variant(Sprite *s, int variant) { s->variant = (uint8_t)variant; }
// it leaves the arena past 312 px left of the spawn point or 32 px right of it, above 208 px up or 40 px down
static int out(int qx, int qy) {
  return (uint32_t)(qx + OUT_LEFT * 256) > OUT_WIDTH * 256 || qy < OUT_TOP * 256 || qy > OUT_BOTTOM * 256;
}

static void update(EggBall *b) {
  update_sprite(&b->o.sprite, 0);
  update_sprite(&b->s2, 0);
}

static void draw(EggBall *b, int x, int y) {
  object_draw(&b->o.sprite, x, y);
  object_draw(&b->s2, x, y);
}

// sub_8030814: Eggman goes back to his still frame once laughing or wincing is over
static void settle(EggBall *b) {
  if (b->s2.variant != EGGMAN_STILL && over(&b->s2)) sprite_start(&b->s2, EGGMAN_STILL);
}

// a piece of debris and an explosion every 8 frames, from 32 px below its point
static void debris(EggBall *b, int x, int y) {
  if ((b->t & DEBRIS_EVERY) == 0) boss_debris(x, y + DEBRIS_BELOW, DEBRIS_GRAVITY);
}

// not drawn into the OBJ window, and the act neither brightening it nor blending while Sonic is alive
static void unflash(EggBall *b) {
  b->o.sprite.frameFlags &= ~(uint32_t)SPRITE_OBJ_MODE;
  if (alive()) { act.bossFlash = 0; act.blendOff = 1; }
}

// sub_802EF94: Sonic against it while it isn't flashing
static void hit(EggBall *b, int x, int y) {
  unflash(b);
  if (b->flash != 0) return;
  int result = boss_hit(&b->o.sprite, x, y);
  if (result == HIT_ENEMY) {
    b->hits = s8(b->hits + 1);
    b->flash = FLASH;
    if (b->hits == PINCH) b->pinch = 1;
    set_variant(&b->s2, EGGMAN_HIT);
    b->s2.frameFlags &= ~(uint32_t)SPRITE_ANIM_OVER;
    play_song(SE_BOSS_HIT);
  } else if (result == HIT_PLAYER) {
    set_variant(&b->s2, EGGMAN_LAUGH);
    b->s2.frameFlags &= ~(uint32_t)SPRITE_ANIM_OVER;
  }
}

// Task_802F0D0: the hit's flash, the mobile in the white OBJ window on every other pair of the first 16 of its 32 frames while
// Sonic is alive, then both sprites
static void show(EggBall *b, int x, int y) {
  if (b->flash != 0 && --b->flash > FLASH_WHITE && !(b->flash & 2) && alive()) {
    b->o.sprite.frameFlags |= OBJ_WINDOW;
    act.bossFlash = 1;
  }
  draw(b, x, y);
}

static int rise(EggBall *b);
static int climb(EggBall *b);
static int wait(EggBall *b);
static int pass(EggBall *b);
static int falling(EggBall *b);
static int wreck(EggBall *b);
static void spike_ball(EggBall *b);

// Task_EggBallMain: two seconds, then it shows 85 px left of the spawn point; its animations step twice this frame and it is
// drawn twice
static int start(EggBall *b) {
  if (b->t++ <= WAIT) return 1;
  b->qx = APPEAR_X * 256; b->qy = 0; b->vy = -256;
  update(b);
  draw(b, at_x(b), b->y0);
  b->t = STILL;
  b->phase = rise;
  return rise(b);
}

// Task_802F56C: up a pixel a frame to 80 px, then a second there, and Eggman laughs
static int rise(EggBall *b) {
  if (b->qy <= RISE_TO * 256) {
    if (--b->t == 0) { set_variant(&b->s2, EGGMAN_LAUGH); b->t = STILL; b->phase = climb; }
  } else b->qy -= 256;
  update(b);
  draw(b, at_x(b), at_y(b));
  return 1;
}

// Task_802F644: once he has laughed, a second, then up a pixel a frame to 208 px, out of sight, where it lets the ball go
static int climb(EggBall *b) {
  Sprite *s2 = &b->s2;
  if (s2->variant == EGGMAN_STILL) {
    if (b->t == 0) {
      b->qy -= 256;
      if (b->qy <= CLIMB_TO * 256) { b->t = STILL; b->phase = wait; spike_ball(b); }
    } else b->t--;
  }
  if (s2->variant == EGGMAN_LAUGH && over(s2)) { b->t = STILL; set_variant(s2, EGGMAN_STILL); }
  update(b);
  draw(b, at_x(b), at_y(b));
  return 1;
}

// Task_802F804: unseen, a second between passes, then a pass at random: the mobile's path and the ball's, facing right when it
// starts in the arena's left half
static int wait(EggBall *b) {
  Sprite *s = &b->o.sprite, *s2 = &b->s2;
  b->t = (b->t - 1) & 0xFFFF;
  if (b->t == 0) {
    b->choice = (int)(act_random() & 7);
    const int32_t *path = PATHS[CHOICES[b->choice][0]];
    b->qx = path[0]; b->qy = path[1];
    b->vx = path[2] * SPEEDS[b->hits] / 10; b->vy = path[3] * SPEEDS[b->hits] / 10;
    if (b->qx >= FACES_RIGHT_X * 256) { s->frameFlags &= ~(uint32_t)SPRITE_X_FLIP; s2->frameFlags &= ~(uint32_t)SPRITE_X_FLIP; }
    else { s->frameFlags |= SPRITE_X_FLIP; s2->frameFlags |= SPRITE_X_FLIP; }
    b->ball->go = 1;
    b->phase = pass;
  }
  b->flash = 0;
  update(b);
  settle(b);
  return 1;
}

// sub_802FB2C: the eighth hit. Eggman winces, the ball flies off, the thin platforms go, the camera stops across and its top
// edge drops 40 px, and 1000 points are scored
static void beaten(EggBall *b) {
  Camera *c = &act.cam;
  set_variant(&b->s2, EGGMAN_HIT);
  b->fall = FALL_START;
  play_song(SE_EXPLOSION);
  if (b->ball) b->ball->blow = 1;   // it flies off in its own run this frame
  act_tasks_destroy(PRIORITY_THIN, PRIORITY_THIN_END);
  act.player.onObject = NULL;
  c->minX = c->maxX = cam_x();
  // the pan's start leaves the top and bottom edges where they were
  int minY = c->minY, maxY = c->maxY;
  boss_cam_pan(minY + CAM_TOP_DOWN, maxY + DISPLAY_HEIGHT);
  c->minY = minY; c->maxY = maxY;
  world_add_score(HIT_SCORE);
  b->phase = falling;
  falling(b);
}

// Task_802F9F8: along its path until it leaves the arena; the eighth hit beats it
static int pass(EggBall *b) {
  b->qx += b->vx; b->qy += b->vy;
  if (out(b->qx, b->qy)) { b->t = STILL; b->phase = wait; }
  int x = at_x(b), y = at_y(b);
  update(b);
  hit(b, x, y);
  if (b->hits >= HITS) { beaten(b); return 1; }
  settle(b);
  show(b, x, y);
  return 1;
}

// Task_802FC14: it drops, bouncing off the floor with three quarters of its speed until it is slower than a pixel a frame,
// throwing debris
static int falling(EggBall *b) {
  b->fall = s16(b->fall + FALL_GRAVITY);
  b->qy += b->fall;
  int x = at_x(b), y = at_y(b);
  int d = terrain_tile_floor(x, y + FLOOR_BELOW, 1, 8);
  if (d < 0) {
    b->qy += d * 256;
    b->fall = s16((b->fall >> 2) - b->fall);
    if (b->fall > -256) { b->fall = 0; b->phase = wreck; }
  }
  unflash(b);
  b->t = (b->t + 1) & 0xFFFF;
  debris(b, x, y);
  update(b);
  draw(b, x, y);
  return 1;
}

// Task_802FE88: it lies wrecked until 241 frames from its beating, then Eggman escapes, the capsule comes, the stage's music comes
// back and the star disc flies off
static int wreck(EggBall *b) {
  int x = at_x(b), y = at_y(b);
  if (b->t > WRECK_FRAMES) {
    boss_egg_mobile(x, y - EGG_MOBILE_UP);
    boss_capsule(x, y);
    boss_music(BOSS_MUSIC_END);
    BossPart *disc = boss_part(x, y, STAR_DISC_TILES, ANIM_STAR_DISC, 0);
    if (disc) {
      disc->vy = DISC_VY; disc->grow = 0; disc->spin = DISC_SPIN; disc->frames = DISC_FRAMES;
      if (b->o.sprite.frameFlags & SPRITE_X_FLIP) { disc->tf.qScaleX = -0x100; disc->vx = DISC_VX; }
      else disc->vx = -DISC_VX;
    }
    return 0;
  }
  b->t = (b->t + 1) & 0xFFFF;
  debris(b, x, y);
  update(b);
  draw(b, x, y);
  return 1;
}

// --- the spiked ball (Task_8030120, Task_803020C, Task_8030364 and Task_8030414) -------------------------------------------
// It waits unseen until the mobile starts a pass, then rolls along its own path of the pass until it leaves the arena; touching
// it hurts Sonic, and Eggman laughs when it does. When the mobile is beaten it flies up toward the screen's middle, bouncing
// off the floor and exploding, for three seconds.

static int ball_x(const SpikeBall *k) { return s16(k->x0 + enemy_i(k->qx)); }
static int ball_y(const SpikeBall *k) { return s16(k->y0 + enemy_i(k->qy)); }

static int ball_roll(SpikeBall *k);
static int ball_tumble(SpikeBall *k);

// Task_8030120
static int ball_wait(SpikeBall *k) {
  if (!k->go) return 1;
  EggBall *b = k->boss;
  const int32_t *path = PATHS[CHOICES[b->choice & 7][1]];
  k->qx = path[0]; k->qy = path[1];
  k->vx = path[2] * SPEEDS[b->hits] / 10; k->vy = path[3] * SPEEDS[b->hits] / 10;
  if (k->qx >= FACES_RIGHT_X * 256) k->o.sprite.frameFlags &= ~(uint32_t)SPRITE_X_FLIP;
  else k->o.sprite.frameFlags |= SPRITE_X_FLIP;
  k->go = 0;
  k->phase = ball_roll;
  return 1;
}

// Task_803020C and sub_8030778
static int ball_roll(SpikeBall *k) {
  k->qx += k->vx; k->qy += k->vy;
  if (out(k->qx, k->qy)) k->phase = ball_wait;
  int x = ball_x(k), y = ball_y(k);
  update_sprite(&k->o.sprite, 0);
  if (boss_shot(&k->o.sprite, x, y) == HIT_PLAYER) {
    Sprite *s2 = &k->boss->s2;
    sprite_start(s2, EGGMAN_LAUGH);
    s2->frameFlags &= ~(uint32_t)SPRITE_ANIM_OVER;
  }
  object_draw(&k->o.sprite, x, y);
  return 1;
}

// Task_8030364: off toward the middle of the screen at 2 px a frame, up at 6 px a frame or 3 px a frame faster than it went
static int ball_blow(SpikeBall *k) {
  k->vx = ball_x(k) < cam_x() + DISPLAY_WIDTH / 2 ? BALL_VX : -BALL_VX;
  if (k->vy == 0) k->vy = BALL_UP;
  else if (k->vy < 0) k->vy -= BALL_FASTER;
  else k->vy += BALL_FASTER;
  k->t = 0;
  k->phase = ball_tumble;
  return ball_tumble(k);
}

// Task_8030414
static int ball_tumble(SpikeBall *k) {
  if (k->t++ > BALL_FRAMES) return 0;
  k->vy += BALL_GRAVITY;
  k->qx += k->vx; k->qy += k->vy;
  int x = ball_x(k), y = ball_y(k);
  if (k->vy > 0) {
    int d = terrain_tile_floor(x, y + FLOOR_BELOW, 1, 8);
    if (d < 0) { k->qy += d * 256; k->vy = (k->vy >> 2) - k->vy; }
  }
  if ((k->t & DEBRIS_EVERY) == 0) {
    uint32_t r = act_random();
    boss_explosion((x + (int)(r & 0x3F) - 32) << 8, (y + DEBRIS_BELOW - (int)((r & 0x3F0000) >> 16)) << 8);
  }
  update_sprite(&k->o.sprite, 0);
  object_draw(&k->o.sprite, x, y);
  return 1;
}

static int spike_ball_run(ActTask *t) {
  SpikeBall *k = (SpikeBall *)t->data;
  if (k->blow) { k->blow = 0; k->phase = ball_blow; }
  // with the mobile gone only its flight goes on
  if (!k->boss && k->phase != ball_tumble && k->phase != ball_blow) return 1;
  return k->phase(k);
}

static void spike_ball_end(ActTask *t) {
  SpikeBall *k = (SpikeBall *)t->data;
  if (k->boss && k->boss->ball == k) k->boss->ball = NULL;
  object_end(t);
}

// made where the mobile is, unseen until the first pass
static void spike_ball(EggBall *b) {
  SpikeBall *k = OBJECT_NEW(SpikeBall);
  if (!k) return;
  k->boss = b;
  k->x0 = b->x0; k->y0 = b->y0;
  k->qx = b->qx; k->qy = b->qy;
  k->phase = ball_wait;
  object_sprite_at(&k->o.sprite, vram_malloc(SPIKE_BALL_TILES), ANIM_SPIKE_BALL, 0, SPIKE_BALL_ORDER, ENEMY_PRIORITY, 0, 0);
  if (boss_task(&k->o, spike_ball_run, spike_ball_end, PRIORITY_SPIKE_BALL)) b->ball = k;
}

// --- the pipes (Task_PipeInitialDelay and Task_PipeExtend) ------------------------------------------------------------------
// A second and a half after the boss spawns each slides a pixel a frame into place from 32 px out; the two in the floor are
// solid. Once the boss is beaten they slide back out at 2 px a frame and go. Pipes 0 and 2 hold the tiles the others share.

static int pipe_run(ActTask *t) {
  Pipe *pp = (Pipe *)t->data;
  Sprite *s = &pp->o.sprite;
  int sx = PIPE[pp->i].startX, sy = PIPE[pp->i].startY;
  if (pp->delay != 0) {
    if (--pp->delay == 0) { pp->ox = sx; pp->oy = sy; }
    return 1;
  }
  if (pp->boss->hits > HITS - 1) {
    pp->ox = s16(pp->ox + (sx >> PIPE_OUT_STEP));
    pp->oy = s16(pp->oy + (sy >> PIPE_OUT_STEP));
    if (pp->ox == sx && pp->oy == sy) return 0;
  } else {
    if (pp->ox < 0) pp->ox++;
    if (pp->ox > 0) pp->ox--;
    if (pp->oy < 0) pp->oy++;
    if (pp->oy > 0) pp->oy--;
  }
  int x = pp->x + pp->ox, y = pp->y + pp->oy;
  pp->o.x = x;   // where Sonic balancing on it finds its sides
  if (!(pp->i & 6)) collide_platform(&pp->o, x, y, object_box(s, 0), &act.player);
  update_sprite(s, 0);
  object_draw(s, x, y);
  return 1;
}

// TaskDestructor_8030754: only the pipes holding the tiles free them
static void pipe_end(ActTask *t) {
  Pipe *pp = (Pipe *)t->data;
  if (pp->i & ~2) pp->o.sprite.graphics.dest = HEAP_END;
  object_end(t);
}

static void pipes(EggBall *b) {
  uint32_t tiles[2] = { HEAP_END, HEAP_END };
  for (int i = 0; i < PIPES; i++) {
    Pipe *pp = OBJECT_NEW(Pipe);
    if (!pp) continue;
    pp->boss = b;
    pp->i = i;
    pp->delay = PIPE_DELAY;
    pp->x = b->x0 + PIPE[i].x; pp->y = b->y0 + PIPE[i].y;
    pp->o.x = pp->x;
    int side = (i & 2) != 0;
    if (!(i & ~2)) tiles[side] = vram_malloc(PIPE_TILES);
    object_sprite_at(&pp->o.sprite, tiles[side], ANIM_PIPES, PIPE[i].variant, side ? PIPE_SIDE_ORDER : PIPE_ORDER,
                     ENEMY_PRIORITY, PIPE[i].flipX, PIPE[i].flipY);
    boss_task(&pp->o, pipe_run, pipe_end, PRIORITY_PIPE);
  }
}

static int egg_ball_run(ActTask *t) {
  EggBall *b = (EggBall *)t->data;
  return b->phase(b);
}

static void egg_ball_end(ActTask *t) {
  EggBall *b = (EggBall *)t->data;
  if (b->ball) b->ball->boss = NULL;
  object_sprite_free(&b->s2);
  object_end(t);
}

// CreateEntity_EggBall: it never spawns again in this act, beaten or not; on Easy it starts with two hits taken
ActTask *egg_ball_spawn(Slot *slot) {
  act_random_seed(e.frameCount);   // gPseudoRandom = gFrameCount
  EggBall *b = OBJECT_NEW(EggBall);
  if (!b) return NULL;
  slot->gone = 1;
  b->o.slot = slot;
  b->o.x = slot->e.x;
  b->x0 = slot->e.x; b->y0 = slot->e.y;
  b->hits = save.bytes[0x18] ? 2 : 0;
  b->phase = start;
  b->s2.graphics.dest = HEAP_END;   // nothing to free if the task can't be made
  object_sprite_at(&b->o.sprite, vram_malloc(MOBILE_TILES), ANIM_MOBILE, 0, MOBILE_ORDER, ENEMY_PRIORITY, 0, 0);
  ActTask *t = boss_task(&b->o, egg_ball_run, egg_ball_end, PRIORITY_EGG_BALL);
  if (!t) return NULL;
  object_sprite_at(&b->s2, vram_malloc(EGGMAN_TILES), ANIM_EGGMAN, EGGMAN_STILL, EGGMAN_ORDER, ENEMY_PRIORITY, 0, 0);
  pipes(b);
  boss_cam_bounds(b->y0 - ARENA_UP, b->y0 + ARENA_DOWN, b->x0 - ARENA_WIDTH, b->x0);
  boss_music(BOSS_MUSIC_START);
  return t;
}
