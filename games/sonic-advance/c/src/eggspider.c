// Ice Mountain's boss, the Egg Spider (enemy kind 25), at the end of act 2. Translated from the JavaScript version's
// engine/eggspider.js (the original's boss_4_egg_spider.c).
//
// When its spawn point comes into range the camera closes in on the arena, 400 px wide and ending at the spawn point, Sonic's
// controls are held and the colours under the water follow the stage's from then on. Two seconds later the boss music starts
// and the spider walks in along the ceiling, a pixel a frame, to 120 px left of the spawn point, while the camera pans up 96
// px; a second still, Eggman laughs, a second more, and the fight starts. It walks to one of nine places picked at random,
// stops for half a second, and then for two seconds shakes the screen and drops icicles from the ceiling, more often with each
// hit it takes; after the drops it walks to two more places before the next. A hit flashes it white for 120 frames, in which
// it can't be hit again. The eighth hit beats it: three parts fly off, what is left falls to the floor throwing debris, the
// camera drops back to the arena's floor, the water goes down 160 px, and five seconds after it was beaten Eggman escapes in
// the Egg Mobile, the capsule comes and the stage's music comes back.
//
// The icicles fall slowly under the water while the boss is whole, and Sonic can stand on them there. The white flash is the
// spider drawn into the OBJ window, which the act brightens to white (act.bossFlash). The CPU partner, and Knuckles floating
// on the water as the boss arrives, are left out with the characters.

#include "bosses.h"

enum {
  ANIM_SPIDER = 628, SPIDER_WALK = 0, SPIDER_DROP = 1, SPIDER_STILL = 2,
  ANIM_EGGMAN = 629, EGGMAN_STILL = 0, EGGMAN_LAUGH = 1, EGGMAN_HIT = 2,
  ANIM_BODY = 626, ANIM_PARTS = 627, PART_TOP = 0, PART_LEG = 1, ANIM_ICICLE = 630,
  SPIDER_TILES = 64, EGGMAN_TILES = 8, TOP_TILES = 16, LEG_TILES = 12, VRAM_ICICLE = 0x2720,
  SPIDER_ORDER = 22, EGGMAN_ORDER = 21, ICICLE_ORDER = 20,
  PRIORITY_ICICLE = 0x2200, PRIORITY_WATER_PALETTES = 0xFFFD,
  ARENA_DOWN = DISPLAY_HEIGHT + 32, ARENA_WIDTH = DISPLAY_WIDTH + 80,
  START_X = 48, START_Y = 16, WAIT = 120, WALK_IN_TO = -120, CAM_UP = -96, STILL = 60,
  SPEED = 0x100, STOP_WAIT = 30, DROPS = 120, REST = 120,
  STOPS = 9, STOPS_AGAIN = 5,
  FLASH = 120, BEATEN_AFTER = 7, HIT_SCORE = 1000,
  SHAKE = 0x400, SHAKE_STEP = 0x100,
  PART_SPIN = 0x80, LEG_SPIN = 0x380, PART_FRAMES = 60, TOP_VX = 0x100, LEG_VX = 0x400, LEG_APART = 16,
  FALL_GRAVITY = 2, FLOOR_BELOW = 56, LANDS_AFTER = 120, DEBRIS_EVERY = 7, DEBRIS_BELOW = 32, DEBRIS_GRAVITY = 5,
  WRECK_FRAMES = 300, EGG_MOBILE_DOWN = 40,
  ICICLE_UP = 32, ICICLE_STEP = 20, ICICLE_LEFT = 10, ICICLE_ACCEL = 10, WATER_BELOW = 17, UNDER_SLOWER = 3,
  ICICLE_GONE = 208, ICICLE_LETS_GO = 196,
  SE_BOSS_HIT = 143, SE_EXPLOSION = 144, SE_IMPACT = 145,
};

// how often it drops an icicle, in frames, by the hits taken (gUnknown_084ACEB4)
static const uint8_t DROP_EVERY[] = { 59, 59, 59, 59, 39, 39, 39, 29, 19 };
// the nine places it walks to, in px from the spawn point (gUnknown_084ACEC6)
static const int16_t STOP_X[STOPS] = { -288, -256, -224, -192, -160, -128, -96, -64, -32 };
// how far Eggman sits lower than its point, by the first OAM entry of its frame (gUnknown_084ACED8)
static const int8_t EGGMAN_DROP[] = { 0, 1, 0, 1, 1, -1 };

typedef struct EggSpider EggSpider;
typedef int (*Phase)(EggSpider *);
struct EggSpider {
  Object o;                 // the spider
  Sprite s2;                // Eggman
  Phase phase;
  int x0, y0;               // the spawn point
  int qx, qy, vx, vy;       // the offsets from the spawn point and their speeds, 1/256 px (qUnk6C, qUnk70, unk74, unk78)
  int target;               // the place it walks to, 1/256 px (unk80)
  int t;                    // a frame counter (unk84, 16 bits)
  int hits, flash, rest;    // the hits taken (unk86), the frames left of a hit's flash (unk87), the drops' cooldown (unk8A)
  int step;                 // the phase's step (unk8C)
  int fall;                 // the beaten spider's fall (qUnk88, 16 bits)
};

typedef struct { Object o; int x0, y0, qx, qy, vy, accel; } Icicle;

// the one on the stage, which its icicles read
static EggSpider *spider;

// the original sets the variant alone, so the animation starts over only when it changes
static void set_variant(Sprite *s, int variant) { s->variant = (uint8_t)variant; }
static int over(const Sprite *s) { return (s->frameFlags & SPRITE_ANIM_OVER) != 0; }
static int at_x(const EggSpider *b) { return s16(b->x0 + enemy_i(b->qx)); }
static int at_y(const EggSpider *b) { return s16(b->y0 + enemy_i(b->qy)); }
static int alive(void) { return !act.player.dead; }

// sub_8031D0C and the drawing: Eggman sits on it, lower by its frame while it is whole
static void draw(EggSpider *b, int x, int y) {
  Sprite *s = &b->o.sprite;
  int drop = 0;
  if (s->graphics.anim == ANIM_SPIDER && s->dimensions != NO_FRAME) {
    int k = (int8_t)rom_u8(s->dimensions + 1);
    if (k >= 0 && k < (int)sizeof EGGMAN_DROP) drop = EGGMAN_DROP[k];
  }
  object_draw(s, x, y);
  object_draw(&b->s2, x, y - drop);
}

static void update(EggSpider *b) {
  update_sprite(&b->o.sprite, 0);
  update_sprite(&b->s2, 0);
}

// sub_80309CC: the hit's flash, the spider in the white OBJ window on every other pair of its frames while Sonic is alive,
// then both sprites
static void show(EggSpider *b, int x, int y) {
  if (b->flash != 0 && --b->flash > 0 && !(b->flash & 2) && alive()) {
    b->o.sprite.frameFlags |= 0x100;
    act.bossFlash = 1;
  }
  draw(b, x, y);
}

// not drawn into the OBJ window, and the act neither brightening it nor blending while Sonic is alive
static void unflash(EggSpider *b) {
  b->o.sprite.frameFlags &= ~(uint32_t)SPRITE_OBJ_MODE;
  if (alive()) { act.bossFlash = 0; act.blendOff = 1; }
}

// sub_80308A4: Sonic against it while it isn't flashing
static void hit(EggSpider *b, int x, int y) {
  unflash(b);
  if (b->flash != 0) return;
  int result = boss_hit(&b->o.sprite, x, y);
  if (result == HIT_ENEMY) {
    b->hits = s8(b->hits + 1);
    b->flash = FLASH;
    set_variant(&b->s2, EGGMAN_HIT);
    b->s2.frameFlags &= ~(uint32_t)SPRITE_ANIM_OVER;
    play_song(SE_BOSS_HIT);
  } else if (result == HIT_PLAYER) {
    set_variant(&b->s2, EGGMAN_LAUGH);
    b->s2.frameFlags &= ~(uint32_t)SPRITE_ANIM_OVER;
  }
}

static int fight(EggSpider *b);
static int falling(EggSpider *b);
static int wreck(EggSpider *b);
static void icicle(EggSpider *b);

// Task_EggSpiderInit: two seconds, then it walks in to 120 px left of the spawn point while the camera pans up 96 px, a second
// still, Eggman laughs, a second, and the fight starts with Sonic's controls back
static int intro(EggSpider *b) {
  Sprite *s = &b->o.sprite, *s2 = &b->s2;
  Camera *c = &act.cam;
  b->qx += b->vx; b->qy += b->vy;
  int x = at_x(b), y = at_y(b);
  update(b);
  show(b, x, y);
  switch (b->step) {
    case 0:
      if (--b->t == 0) { boss_music(BOSS_MUSIC_START); set_variant(s, SPIDER_WALK); b->vx = -SPEED; b->step++; }
      break;
    case 1:
      if (b->qx <= WALK_IN_TO * 256) { set_variant(s, SPIDER_STILL); b->qx = WALK_IN_TO * 256; b->vx = 0; b->t = STILL; b->step++; }
      if (c->shiftY != CAM_UP) c->shiftY--;
      break;
    case 2:
      if (--b->t == 0) { set_variant(s2, EGGMAN_LAUGH); b->step++; }
      break;
    case 3:
      if (over(s2)) { set_variant(s2, EGGMAN_STILL); b->t = STILL; b->step++; }
      break;
    case 4:
      if (--b->t == 0) {
        c->shiftY = 0;
        // his controls back, with the jump and attack buttons he holds not counting as presses
        act.player.ignoreInput = 0;
        e.pressed &= (uint16_t)~(KEY_A | KEY_B);
        b->step = 0; b->t = STOP_WAIT;
        b->phase = fight;
      }
      break;
  }
  return 1;
}

// sub_80311D4: the eighth hit. Eggman winces, three parts fly off, what is left starts falling, the camera stops across and drops
// back to the arena's floor, the water goes down 160 px and 1000 points are scored
static void beaten(EggSpider *b) {
  Sprite *s = &b->o.sprite;
  Camera *c = &act.cam;
  int x = at_x(b), y = at_y(b);
  set_variant(&b->s2, EGGMAN_HIT);
  b->fall = 0;
  play_song(SE_EXPLOSION);
  b->t = 0;
  s->graphics.anim = ANIM_BODY;
  sprite_start(s, 0);
  int right = (s->frameFlags & SPRITE_X_FLIP) != 0;
  BossPart *top = boss_part(x, y, TOP_TILES, ANIM_PARTS, PART_TOP);
  if (top) {
    top->vy = 0; top->grow = 0; top->spin = PART_SPIN; top->frames = PART_FRAMES;
    if (right) top->tf.qScaleX = -0x100;
    top->vx = right ? TOP_VX : -TOP_VX;
  }
  BossPart *leg = boss_part(x + LEG_APART, y + LEG_APART, LEG_TILES, ANIM_PARTS, PART_LEG);
  if (leg) {
    leg->vy = 0; leg->grow = 0; leg->spin = PART_SPIN; leg->frames = PART_FRAMES;
    if (right) leg->tf.qScaleX = -0x100;
    leg->vx = right ? LEG_VX : -LEG_VX;
  }
  leg = boss_part(x - LEG_APART, y + LEG_APART, LEG_TILES, ANIM_PARTS, PART_LEG);
  if (leg) {
    leg->vy = 0; leg->grow = 0; leg->spin = LEG_SPIN; leg->frames = PART_FRAMES;
    leg->o.sprite.frameFlags |= SPRITE_X_FLIP;
    if (right) leg->tf.qScaleX = -0x100;
    leg->vx = right ? -LEG_VX : LEG_VX;
  }
  c->minX = c->maxX = cam_x();
  // the pan's start leaves the top and bottom edges where they were
  int minY = c->minY, maxY = c->maxY;
  boss_cam_pan(maxY, maxY + DISPLAY_HEIGHT);
  c->minY = minY; c->maxY = maxY;
  water.target += DISPLAY_HEIGHT;
  world_add_score(HIT_SCORE);
  b->phase = falling;
  falling(b);
}

// sub_8030EE4: from rest, to a place at random 1 px a frame (another one when it is already there), half a second still, then
// two seconds shaking the screen and dropping icicles; after the drops two more places before the next
static int fight(EggSpider *b) {
  Sprite *s = &b->o.sprite, *s2 = &b->s2;
  b->qx += b->vx; b->qy += b->vy;
  int x = at_x(b), y = at_y(b);
  hit(b, x, y);
  if (b->hits > BEATEN_AFTER) { beaten(b); return 1; }
  // sub_8031CD0: Eggman goes back to his still frame once laughing or wincing is over
  if (s2->variant != EGGMAN_STILL && over(s2)) sprite_start(s2, EGGMAN_STILL);
  update(b);
  show(b, x, y);
  if (b->rest != 0) b->rest--;
  switch (b->step) {
    case 0: {
      if (--b->t != 0) return 1;
      set_variant(s, SPIDER_WALK);
      int r = (int)(act_random() % STOPS);
      b->target = STOP_X[r] * 256;
      if (b->qx == b->target) b->target = STOP_X[(r + STOPS_AGAIN) % STOPS] * 256;
      b->vx = b->qx <= b->target ? SPEED : -SPEED;
      b->step = 1;
      break;
    }
    case 1:
      if (b->vx > 0 ? b->qx > b->target : b->qx < b->target) {
        b->qx = b->target; b->vx = 0; b->t = STOP_WAIT; b->step = 2;
        set_variant(s, SPIDER_STILL);
      }
      break;
    case 2:
      if (--b->t == 0) {
        if (b->rest != 0) { b->t = STOP_WAIT; b->step = 0; }
        else {
          b->t = DROPS; b->step = 3;
          set_variant(s, SPIDER_DROP);
          if (alive()) boss_shake(SHAKE, 0, SHAKE_STEP, DROPS, SHAKE_VERTICAL);
        }
      }
      break;
    case 3:
      if (--b->t == 0) { b->t = STOP_WAIT; b->step = 0; b->rest = REST; set_variant(s, SPIDER_STILL); }
      else if (b->t % DROP_EVERY[b->hits] == 0 && alive()) {
        icicle(b);
        play_song(SE_IMPACT);
      }
      break;
  }
  return 1;
}

// a piece of debris and an explosion every 8 frames, from 32 px below its point
static void debris(EggSpider *b, int x, int y) {
  if ((b->t & DEBRIS_EVERY) == 0) boss_debris(x, y + DEBRIS_BELOW, DEBRIS_GRAVITY);
}

// Task_8031480: it falls 2/256 px a frame faster each frame, throwing debris, until 2 seconds have passed and the floor is under
// its feet
static int falling(EggSpider *b) {
  b->fall = s16(b->fall + FALL_GRAVITY);
  b->qy += b->fall;
  int x = at_x(b), y = at_y(b);
  int d = terrain_tile_floor(x, y + FLOOR_BELOW, 1, 8);
  if (b->t > LANDS_AFTER && d < 0) { b->fall = 0; b->phase = wreck; }
  unflash(b);
  b->t = (b->t + 1) & 0xFFFF;
  debris(b, x, y);
  update(b);
  draw(b, x, y);
  return 1;
}

// sub_803170C: on the floor, still throwing debris, until 5 seconds after it was beaten; then Eggman escapes, the capsule comes
// and the stage's music comes back. The blending is off whether Sonic is alive or not.
static int wreck(EggSpider *b) {
  int x = at_x(b), y = at_y(b);
  b->o.sprite.frameFlags &= ~(uint32_t)SPRITE_OBJ_MODE;
  if (b->t++ > WRECK_FRAMES) {
    boss_egg_mobile(x, y + EGG_MOBILE_DOWN);
    boss_capsule(x, y);
    boss_music(BOSS_MUSIC_END);
    return 0;
  }
  b->t &= 0xFFFF;
  debris(b, x, y);
  act.bossFlash = 0;
  act.blendOff = 1;
  update(b);
  draw(b, x, y);
  return 1;
}

// sub_8031AB4: an icicle falls faster each frame, an eighth as fast under the water while the boss is whole; its point hurts
// Sonic while the boss is whole, and under the water he can land on it and is taken down with it, a pixel a frame faster,
// until it is more than 196 px down. It goes 208 px down.
static int icicle_run(ActTask *t) {
  Icicle *ic = (Icicle *)t->data;
  Sprite *s = &ic->o.sprite;
  Player *p = &act.player;
  int whole = spider && spider->hits <= BEATEN_AFTER, under = 0, moved;
  if (ic->y0 + enemy_i(ic->qy) - WATER_BELOW < water_level()) {
    ic->vy += ic->accel; ic->qy += ic->vy; moved = ic->vy;
  } else {
    under = 1;
    ic->vy += whole ? ic->accel / 8 : ic->accel;
    moved = ic->vy / 8;
    ic->qy += moved;
  }
  if (ic->qy > ICICLE_GONE * 256) return 0;
  int x = ic->x0 + enemy_i(ic->qx), y = ic->y0 + enemy_i(ic->qy);
  ic->o.x = x;   // where Sonic balancing on it finds its sides
  update_sprite(s, 0);
  if (whole) boss_hurt(s, x, y);
  const Hitbox *hb = object_box(s, 0);
  if (under && hb) collide_platform_top(&ic->o, x, y, hb, p);
  if (p->onObject == &ic->o) {
    if (ic->qy > ICICLE_LETS_GO * 256) p->onObject = NULL;
    else p->y += (256 + moved) / 256.0;
  }
  object_draw(s, x, y);
  return 1;
}

// it has no destructor: the fixed tiles are never freed
static void icicle_end(ActTask *t) {
  ((Icicle *)t->data)->o.sprite.graphics.dest = HEAP_END;
  object_end(t);
}

// CreateIciclePlatform: from 32 px above the spawn point, 10 to 310 px left of it in steps of 20, falling faster by 10 to 25/256
// px a frame each frame. Its tiles sit at a fixed place.
static void icicle(EggSpider *b) {
  Icicle *ic = OBJECT_NEW(Icicle);
  if (!ic) return;
  ic->o.x = b->x0;
  ic->x0 = b->x0; ic->y0 = b->y0;
  ic->qx = -((int)((act_random() >> 1) & 0xF) * ICICLE_STEP + ICICLE_LEFT) * 256;
  ic->qy = -ICICLE_UP * 256;
  act_random();
  ic->accel = (int)(act_random() & 0xF) + ICICLE_ACCEL;
  object_sprite_at(&ic->o.sprite, OBJ_VRAM + VRAM_ICICLE, ANIM_ICICLE, 0, ICICLE_ORDER, ENEMY_PRIORITY, 0, 0);
  boss_task(&ic->o, icicle_run, icicle_end, PRIORITY_ICICLE);
}

// sub_804C40C as a task: the colours under the water follow the stage's from now on
static void water_palettes_task(Task *t) {
  (void)t;
  water_mask_palettes();
}

static int egg_spider_run(ActTask *t) {
  EggSpider *b = (EggSpider *)t->data;
  return b->phase(b);
}

static void egg_spider_end(ActTask *t) {
  EggSpider *b = (EggSpider *)t->data;
  if (spider == b) spider = NULL;
  object_sprite_free(&b->s2);
  object_end(t);
}

// CreateEntity_EggSpider: it never spawns again in this act, beaten or not; on Easy it starts with two hits taken
ActTask *egg_spider_spawn(Slot *slot) {
  EggSpider *b = OBJECT_NEW(EggSpider);
  if (!b) return NULL;
  slot->gone = 1;
  b->o.slot = slot;
  b->o.x = slot->e.x;
  b->x0 = slot->e.x; b->y0 = slot->e.y;
  b->qx = START_X * 256; b->qy = START_Y * 256;
  b->t = WAIT;
  b->hits = save.bytes[0x18] ? 2 : 0;
  b->phase = intro;
  b->s2.graphics.dest = HEAP_END;   // nothing to free if the task can't be made
  object_sprite_at(&b->o.sprite, vram_malloc(SPIDER_TILES), ANIM_SPIDER, SPIDER_STILL, SPIDER_ORDER, ENEMY_PRIORITY, 0, 0);
  ActTask *t = boss_task(&b->o, egg_spider_run, egg_spider_end, PRIORITY_OBJECTS);
  if (!t) return NULL;
  create_task(water_palettes_task, NULL, PRIORITY_WATER_PALETTES, 0, NULL);
  object_sprite_at(&b->s2, vram_malloc(EGGMAN_TILES), ANIM_EGGMAN, EGGMAN_STILL, EGGMAN_ORDER, ENEMY_PRIORITY, 0, 0);
  spider = b;
  boss_cam_bounds(b->y0, b->y0 + ARENA_DOWN, b->x0 - ARENA_WIDTH, b->x0);
  act.player.gsp = 0;
  act.player.ignoreInput = 1;
  scatter_ceilings();
  return t;
}
