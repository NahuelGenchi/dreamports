// The effects that objects leave behind. Translated from the JavaScript version's engine/defeat.js (dustCloud).

#include "objects.h"

enum { ANIM_DUST_CLOUD = 407, ORDER_EFFECT = 15, PRIORITY_FRONT = 2 };

typedef struct { Object o; int x, y; } Dust;

static int dust_run(ActTask *t) {
  Dust *d = (Dust *)t->data;
  int ended = sprite_step(&d->o.sprite);
  object_draw(&d->o.sprite, d->x, d->y);
  return !ended;
}

void dust_cloud(int x, int y) {
  Dust *d = OBJECT_NEW(Dust);
  if (!d) return;
  d->x = x; d->y = y;
  // CreateDustCloud: at its fixed place in sprite VRAM, not from the heap
  object_sprite_at(&d->o.sprite, OBJ_VRAM + VRAM_DUST_CLOUD, ANIM_DUST_CLOUD, 0, ORDER_EFFECT, PRIORITY_FRONT, 0, 0);
  object_task(&d->o, dust_run, PRIORITY_OBJECTS);
}

// --- Sonic's effects (game.js spawn and updateEffect) ------------------------------------------------------------------
// Each is a task of its own at 0x4001, made as it appears, so it runs after Sonic and after the item tasks made before it,
// and first runs in the frame that makes it. They sit on OAM order 8, in front of the front layer.
enum {
  PRIORITY_EFFECTS = 0x4001,
  ORDER_SONIC_EFFECT = 8,
  ANIM_BRAKE_DUST = 748, ANIM_DASH_DUST = 746, ANIM_DASH_DUST_BIG = 747, ANIM_INSTA_SHIELD = 50, VARIANT_INSTA_SHIELD = 1,
  ANIM_TAIL_SWIPE = 777,
  ANIM_UPPERCUT_FLAME = 250, VARIANT_UPPERCUT_FLAME = 3, UPPERCUT_FLAME_TILES = 32 / 8 * (48 / 8),   // SA1_ANIM_KNUCKLES_UPPERCUT's box
  ANIM_FLOAT_SPLASH = 782, FLOAT_SPLASH_TILES = 32 / 8 * (16 / 8),
  FLOAT_SPLASH_ABOVE = 4, FLOAT_SPLASH_SHOWN_BELOW = 6,
  MAX_BRAKE_DUST = 20,          // the original keeps a pool of 20 brake dust clouds (CreateBrakingDustEffect)
  DASH_DUST_BIG_ABOVE = 0x200,  // the spin dash dust is the big one while the charge is above 2.0
};
enum { EFFECT_BRAKE, EFFECT_DASH, EFFECT_SHIELD, EFFECT_SWIPE, EFFECT_SPLASH };

typedef struct { Object o; int kind, x, y; const Player *p; } Effect;
static int brakeDust;   // the brake dust clouds on screen

// his feet, above his centre under flipped gravity
// whole pixels as the original takes them (I(), an arithmetic shift), so rounding down above the level's top too
static int whole(double v) { return (int)__builtin_floor(v); }
static int feet_y(const Player *p) { return whole(p->y + (p->inverted ? -p->offsetY : p->offsetY)); }

static int effect_run(ActTask *t) {
  Effect *e = (Effect *)t->data;
  const Player *p = e->p;   // whose effect it is, Sonic's or the CPU partner's
  Sprite *s = &e->o.sprite;
  if (e->kind == EFFECT_DASH) {
    // the spin dash dust follows his feet while he charges, turned over with him under flipped gravity
    if (!p->spinDashing) return 0;
    int anim = p->dashAccel > DASH_DUST_BIG_ABOVE ? ANIM_DASH_DUST_BIG : ANIM_DASH_DUST;
    if (s->graphics.anim != anim) { s->graphics.anim = (uint16_t)anim; sprite_start(s, 0); }
    e->x = whole(p->x); e->y = feet_y(p);
    s->frameFlags = (s->frameFlags & ~(uint32_t)(SPRITE_X_FLIP | SPRITE_Y_FLIP)) | (p->facing > 0 ? SPRITE_X_FLIP : 0) | (p->inverted ? SPRITE_Y_FLIP : 0);
    sprite_step(s);
    object_draw(s, e->x, e->y);
    return 1;
  }
  // brake dust goes back to the pool the frame after its animation ends, as Task_BrakingDustEffect checks first, and
  // stays where it appeared
  if (e->kind == EFFECT_BRAKE) {
    if (s->frameFlags & SPRITE_ANIM_OVER) { brakeDust--; return 0; }
    sprite_step(s);
    object_draw(s, e->x, e->y);
    return 1;
  }
  // the insta-shield's flash follows his centre, turned over each frame the gravity is flipped (its task's 0x80)
  if (e->kind == EFFECT_SHIELD) {
    e->x = whole(p->x); e->y = whole(p->y);
    s->frameFlags = (s->frameFlags & ~(uint32_t)SPRITE_Y_FLIP) | (p->inverted ? SPRITE_Y_FLIP : 0);
  }
  // the tail swipe's follows Tails, facing as he does
  if (e->kind == EFFECT_SWIPE) {
    e->x = whole(p->x); e->y = whole(p->y);
    s->frameFlags = (s->frameFlags & ~(uint32_t)(SPRITE_X_FLIP | SPRITE_Y_FLIP)) | (p->facing > 0 ? SPRITE_X_FLIP : 0) | (p->inverted ? SPRITE_Y_FLIP : 0);
  }
  // Knuckles' splash: gone once he stops floating, 4 px above his centre at his sprite's priority, never ending, shown while
  // his centre is less than 6 px under the water's line
  if (e->kind == EFFECT_SPLASH) {
    if (p->state != PS_WATER_FLOAT) return 0;
    e->x = whole(p->x); e->y = whole(p->y) - FLOAT_SPLASH_ABOVE;
    s->frameFlags = (s->frameFlags & ~(uint32_t)(SPRITE_X_FLIP | SPRITE_PRIORITY)) | (p->facing > 0 ? SPRITE_X_FLIP : 0)
      | (uint32_t)(p->front ? 1 : p->prio) << 12;
    sprite_step(s);
    int level = water_level();
    if (level >= 0 && whole(p->y) - FLOAT_SPLASH_SHOWN_BELOW < level) object_draw(s, e->x, e->y);
    return 1;
  }
  int ended = sprite_step(s);
  object_draw(s, e->x, e->y);
  return !ended;
}

static void effect_make(const Player *p, int kind, int anim, int variant, int x, int y, int flipX, int flipY) {
  Effect *e = OBJECT_NEW(Effect);
  if (!e) return;
  e->kind = kind; e->x = x; e->y = y; e->p = p;
  // the dash dust swaps between its two sizes, so it has the tiles of the bigger
  if (kind == EFFECT_DASH) {
    object_sprite(&e->o.sprite, sprite_tiles(ANIM_DASH_DUST_BIG, 0, 0) > sprite_tiles(ANIM_DASH_DUST, 0, 0) ? ANIM_DASH_DUST_BIG : ANIM_DASH_DUST, 0, 0, ORDER_SONIC_EFFECT, PRIORITY_FRONT, flipX, flipY);
    e->o.sprite.graphics.anim = (uint16_t)anim;
  } else if (kind == EFFECT_BRAKE) object_sprite_at(&e->o.sprite, OBJ_VRAM + VRAM_DUST_EFFECT_BRAKING, anim, variant, ORDER_SONIC_EFFECT, PRIORITY_FRONT, flipX, flipY);
  else if (kind == EFFECT_SWIPE && anim == ANIM_UPPERCUT_FLAME)
    object_sprite_at(&e->o.sprite, vram_malloc(UPPERCUT_FLAME_TILES), anim, variant, ORDER_SONIC_EFFECT, PRIORITY_FRONT, flipX, flipY);
  else if (kind == EFFECT_SPLASH)
    object_sprite_at(&e->o.sprite, vram_malloc(FLOAT_SPLASH_TILES), anim, variant, ORDER_SONIC_EFFECT, PRIORITY_FRONT, flipX, flipY);
  else object_sprite(&e->o.sprite, anim, variant, variant, ORDER_SONIC_EFFECT, PRIORITY_FRONT, flipX, flipY);
  if (!object_task(&e->o, effect_run, PRIORITY_EFFECTS)) return;
  if (kind == EFFECT_BRAKE) brakeDust++;
}

static int heartsShownCount, heartsLive;
void effects_start(void) { brakeDust = 0; heartsShownCount = 0; heartsLive = 0; }

// brake dust stays where it appeared, flipped by the game's random numbers (CreateBrakingDustEffect), with no more than
// the pool holds
void act_brake_dust_at(int x, int y) {
  if (brakeDust >= MAX_BRAKE_DUST) return;
  uint32_t r = act_random();
  effect_make(&act.player, EFFECT_BRAKE, ANIM_BRAKE_DUST, 0, x, y, (r & 0x400) != 0, (r & 0x800) != 0);
}
void act_brake_dust_of(const Player *p) { act_brake_dust_at(whole(p->x), feet_y(p)); }
void act_dash_dust_of(const Player *p) {
  effect_make(p, EFFECT_DASH, ANIM_DASH_DUST, 0, whole(p->x), feet_y(p), p->facing > 0, p->inverted);
}
void act_tail_swipe(const Player *p) {
  effect_make(p, EFFECT_SWIPE, ANIM_TAIL_SWIPE, 0, whole(p->x), whole(p->y), p->facing > 0, p->inverted);
}
void act_uppercut_flame(const Player *p) {
  effect_make(p, EFFECT_SWIPE, ANIM_UPPERCUT_FLAME, VARIANT_UPPERCUT_FLAME, whole(p->x), whole(p->y), p->facing > 0, p->inverted);
}
void act_float_splash(const Player *p) {
  effect_make(p, EFFECT_SPLASH, ANIM_FLOAT_SPLASH, 0, whole(p->x), whole(p->y) - FLOAT_SPLASH_ABOVE, p->facing > 0, 0);
}
// the insta-shield's flash, facing the way he faced when it started
void act_insta_shield(void) {
  const Player *p = &act.player;
  effect_make(p, EFFECT_SHIELD, ANIM_INSTA_SHIELD, VARIANT_INSTA_SHIELD, whole(p->x), whole(p->y), p->facing > 0, 0);
}

// --- Amy's hearts (amy_attack_heart_effect.c, engine/amyhearts.js) --------------------------------------------------------
// A task at 0x3001, just after hers, made with each swing of her hammer, which ends when her move does and takes its hearts
// with it. Its pattern, read from the copy (sHeartOffsets: four of eight [when, x, y], a when of -1 ending one), gives when
// each heart comes, in her animation's time, and where, from where she is then. A heart takes 4 tiles from the heap as it
// comes and gives them back the frame after its animation ends. The hearts are drawn just after her, as her task and theirs
// put them in the OAM one after the other.
enum {
  PRIORITY_HEARTS = 0x3001, MAX_HEARTS = 4, HEART_TILES = 4, ANIM_HEART = 759, ORDER_HEART = 16, HEART_PRIORITY = 2,
  HEART_OFFSETS = 0x4A6924, HEART_ROWS = 8, HEART_ROW_BYTES = 6, HEART_SPEED_SCALE = 16,
};
typedef struct {
  Object o;
  const Player *p;
  int state, kind, fresh;
  uint16_t time, frame;
  int used[MAX_HEARTS], x[MAX_HEARTS], y[MAX_HEARTS];
  Sprite hearts[MAX_HEARTS];
} Hearts;
// the hearts' tasks this frame drew, in the order they ran, which act.c puts in the OAM after her
static Hearts *heartsShown[2];

static void hearts_end(ActTask *t) {
  Hearts *h = (Hearts *)t->data;
  for (int i = 0; i < MAX_HEARTS; i++) if (h->used[i]) vram_free(h->hearts[i].graphics.dest);
  heartsLive--;
  object_end(t);
}

// HandleAnimFrame: the next heart, in the first slot that's free, which decides which of two hearts is in front
static void heart_new(Hearts *h, int frame) {
  const Player *p = h->p;
  int i = 0;
  while (i < MAX_HEARTS && h->used[i]) i++;
  if (i == MAX_HEARTS) return;
  uint32_t row = HEART_OFFSETS + (uint32_t)(h->kind * HEART_ROWS + frame) * HEART_ROW_BYTES;
  int dx = rom_s16(row + 2), dy = rom_s16(row + 4);
  h->used[i] = 1;
  h->x[i] = (int)__builtin_floor(p->x) + (p->facing < 0 ? -dx : dx);
  h->y[i] = (int)__builtin_floor(p->y) + (p->inverted ? -dy : dy);
  Sprite *s = &h->hearts[i];
  sprite_init(s);
  s->graphics.dest = vram_malloc(HEART_TILES);
  s->oamFlags = (uint16_t)(ORDER_HEART << 6);
  s->graphics.size = 0;
  s->graphics.anim = ANIM_HEART; s->variant = 0;
  s->animCursor = 0; s->qAnimDelay = 0; s->prevVariant = 0xFF;
  s->animSpeed = p->sprite.animSpeed;
  s->palId = 0;
  s->frameFlags = HEART_PRIORITY << 12;
}

static int hearts_run(ActTask *t) {
  Hearts *h = (Hearts *)t->data;
  const Player *p = h->p;
  // made by her task just before its place in the list, it first runs on the next frame; after the last swing's task, which
  // the list reaches after hers, it runs on this one
  if (h->fresh) { h->fresh = 0; return 1; }
  if (p->state != h->state) return 0;
  for (int i = 0; i < MAX_HEARTS; i++)
    if (h->used[i] && (h->hearts[i].frameFlags & SPRITE_ANIM_OVER)) { h->used[i] = 0; vram_free(h->hearts[i].graphics.dest); }
  // the time passes by her animation's speed; a when of -1 is never reached
  uint16_t when = (uint16_t)(rom_s16(HEART_OFFSETS + (uint32_t)(h->kind * HEART_ROWS + h->frame) * HEART_ROW_BYTES) * HEART_SPEED_SCALE);
  if (when != 0xFFFF) {
    uint16_t was = h->time;
    h->time = (uint16_t)(h->time + p->sprite.animSpeed);
    if (was >= when) {
      heart_new(h, h->frame);
      h->frame = (uint16_t)((h->frame + 1) & 7);
      if (h->frame == 0) h->time = 0;
    }
  }
  int any = 0;
  for (int i = 0; i < MAX_HEARTS; i++) {
    if (!h->used[i]) continue;
    update_sprite(&h->hearts[i], 0);
    any = 1;
  }
  if (any && heartsShownCount < 2) heartsShown[heartsShownCount++] = h;
  return 1;
}

void act_amy_hearts(const Player *p) {
  if (p->character != CHARACTER_AMY || p->cpu) return;
  Hearts *h = PLAIN_NEW(Hearts);
  if (!h) return;
  h->p = p; h->state = p->state; h->kind = p->state - PS_HAMMER;
  h->time = 0; h->frame = 0; h->fresh = heartsLive == 0;
  for (int i = 0; i < MAX_HEARTS; i++) h->used[i] = 0;
  if (object_task_ending(&h->o, hearts_run, hearts_end, PRIORITY_HEARTS)) heartsLive++;
}

void act_amy_hearts_draw(void) {
  for (int k = 0; k < heartsShownCount; k++) {
    Hearts *h = heartsShown[k];
    for (int i = 0; i < MAX_HEARTS; i++) if (h->used[i]) object_draw(&h->hearts[i], h->x[i], h->y[i]);
  }
  heartsShownCount = 0;
}
