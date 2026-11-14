// What the enemies share. Translated from the JavaScript version's engine/enemies.js (data, gone, sprite, leftOutOnEasy) and
// engine/defeat.js (attackTest, projectileTest and defeatEffects with the points and the freed animal), which are the original's
// collision_3.c, enemy_defeat_score.c, entities_manager.c and trapped_animals.c.

#include "enemies.h"

enum {
  SE_ENEMY_DEFEAT = 138,
  ANIM_SCORE = 709, ORDER_SCORE = 0,
  SCORE_RISE = 60, SCORE_HOLD = 30,
  SCORE_KINDS = 5,
  ANIMAL_ORDER = 17,
  ANIMAL_GRAVITY = 48, ANIMAL_HOP = 1024, ANIMAL_RUN = 512,   // in 1/256 px
  ANIMAL_START_AIR = 42,     // frames before the floor is looked at
  ANIMAL_MARGIN = 32,        // the animal goes when this far off the screen
  ANIMAL_TILE = 192,         // where the zone's first animal's tiles are, the second's 4 on and the third's 8
  FLY_START = 576, FLY_TOP = 640, FLY_BOTTOM = 512, FLY_SWING = 6, FLY_SLOW = 20,   // its heading, 1024 a turn
  ZONES = 6, ZONE_ANIMALS_EACH = 3,
};

// --- an entity's data ---------------------------------------------------------------------------------------------------
EnemyData enemy_data(const Entity *e) {
  return (EnemyData){ s8(e->d[0]), s8(e->d[1]), e->d[2] & 0xFF, e->d[3] & 0xFF };
}

int enemy_gone(int spawnX, int spawnY, int x, int y) { return off_display(spawnX, spawnY) && off_cam(x, y); }

int enemy_left_out_on_easy(int zone) { return act.stage.zone == zone && difficulty_easy(); }

void enemy_sprite(Sprite *s, int anim, int first, int last, int order) {
  object_sprite(s, anim, first, last, order, ENEMY_PRIORITY, 0, 0);
  sprite_step(s);
}

void enemy_flip_x(Sprite *s, int flip) {
  if (flip) s->frameFlags |= SPRITE_X_FLIP;
  else s->frameFlags &= ~(uint32_t)SPRITE_X_FLIP;
}

// --- the points a defeat gives, rising from where the enemy was ---------------------------------------------------------------
static const int SCORES[SCORE_KINDS] = { 100, 200, 400, 800, 1000 };   // enemyDefeatScores, for each enemy in a row before landing

typedef struct { Object o; int x, y, dy, holding; } Popup;

// they rise 1 px a frame for 60 frames, stay 30 more, and go
static int popup_run(ActTask *t) {
  Popup *p = (Popup *)t->data;
  p->dy++;
  if (!p->holding) {
    object_draw(&p->o.sprite, p->x, p->y - p->dy);
    if (p->dy >= SCORE_RISE) { p->holding = 1; p->y -= p->dy; p->dy = 0; }
    return 1;
  }
  if (p->dy > SCORE_HOLD) return 0;
  object_draw(&p->o.sprite, p->x, p->y);
  return 1;
}

static void popup_new(int x, int y, int chain) {
  Popup *p = OBJECT_NEW(Popup);
  if (!p) return;
  p->x = x; p->y = y;
  object_sprite(&p->o.sprite, ANIM_SCORE, chain, chain, ORDER_SCORE, ENEMY_PRIORITY, 0, 0);
  sprite_step(&p->o.sprite);
  object_task(&p->o, popup_run, PRIORITY_OBJECTS);
}

// --- the freed animal ---------------------------------------------------------------------------------------------------------
// Each zone's three animals, in turn, and how each moves once freed: it sits once it has landed, hops away left or flies
// (sAnimsTrappedAnimals). The zone is the level's index halved, as LEVEL_TO_ZONE has it. The table holds six zones: from level 12
// on the original reads the next table's bytes as animals, and this game frees none.
enum { SITS, HOPS, FLIES };
enum {
  ANIM_SEAL = 437, ANIM_GORILLA, ANIM_PEACOCK, ANIM_LION, ANIM_MOLE, ANIM_PARROT, ANIM_PENGUIN, ANIM_RABBIT, ANIM_OTTER, ANIM_DEER,
  ANIM_SKUNK, ANIM_ROBIN, ANIM_KANGAROO, ANIM_KOALA, ANIM_ELEPHANT,
};
static const struct { uint16_t anim; uint8_t moves; } ANIMALS[ZONES][ZONE_ANIMALS_EACH] = {
  { { ANIM_OTTER, SITS }, { ANIM_KOALA, SITS }, { ANIM_KANGAROO, HOPS } },
  { { ANIM_MOLE, SITS }, { ANIM_SKUNK, HOPS }, { ANIM_ROBIN, FLIES } },
  { { ANIM_LION, SITS }, { ANIM_PEACOCK, HOPS }, { ANIM_PARROT, FLIES } },
  { { ANIM_OTTER, SITS }, { ANIM_SEAL, SITS }, { ANIM_PENGUIN, HOPS } },
  { { ANIM_ELEPHANT, SITS }, { ANIM_LION, SITS }, { ANIM_GORILLA, HOPS } },
  { { ANIM_MOLE, SITS }, { ANIM_DEER, HOPS }, { ANIM_RABBIT, HOPS } },
};
static int next_animal;   // gTrappedAnimalVariant: the next defeat's animal

void enemies_start(void) { next_animal = 0; }

typedef struct { Object o; int x, y, fall, vx, inAir, bouncing, moves, heading, up; } Animal;   // x and y in 1/256 px

// IS_OUT_OF_RANGE_3(x, y, 32, 32): more than 32 px off the screen
static int animal_out(const Animal *a) {
  int sx = enemy_i(a->x) - cam_x(), sy = enemy_i(a->y) - cam_y();
  return sx < -ANIMAL_MARGIN || sx > DISPLAY_WIDTH + ANIMAL_MARGIN || sy + ANIMAL_MARGIN < 0 || sy > DISPLAY_HEIGHT + ANIMAL_MARGIN;
}

// it hops up and lands on the ground, then sits there or hops away left
static int animal_run(ActTask *t) {
  Animal *a = (Animal *)t->data;
  a->fall += ANIMAL_GRAVITY; a->y += a->fall; a->x += a->vx;
  if (a->inAir > 0) a->inAir--;
  else {
    int d = terrain_tile_floor(enemy_i(a->x), enemy_i(a->y), ENEMY_LAYER, 8);
    if (d <= 0) {
      a->y += d * 256;
      if (a->moves == HOPS) {
        a->fall = -ANIMAL_HOP;
        if (!a->bouncing) a->vx = -ANIMAL_RUN;
        a->bouncing = 1;
      } else a->fall = 0;
    }
  }
  if (animal_out(a)) return 0;
  sprite_step(&a->o.sprite);
  object_draw(&a->o.sprite, enemy_i(a->x), enemy_i(a->y));
  return 1;
}

// Task_FlyingAnimal, the robin and the parrot: it flies off up and to the left, swaying, its heading swinging between 512 and 640
// (1024 a turn) by 6 a frame
static int flying_animal_run(ActTask *t) {
  Animal *a = (Animal *)t->data;
  if (a->up) { a->heading += FLY_SWING; if (a->heading > FLY_TOP) a->up = 0; }
  else { a->heading -= FLY_SWING; if (a->heading < FLY_BOTTOM) a->up = 1; }
  a->x += SINE[(a->heading & 1023) + 256] / FLY_SLOW;
  a->y += SINE[a->heading & 1023] / FLY_SLOW;
  if (animal_out(a)) return 0;
  sprite_step(&a->o.sprite);
  object_draw(&a->o.sprite, enemy_i(a->x), enemy_i(a->y));
  return 1;
}

static void animal_new(int x, int y, int zone) {
  Animal *a = OBJECT_NEW(Animal);
  if (!a) return;
  int anim = ANIMALS[zone][next_animal].anim, moves = ANIMALS[zone][next_animal].moves;
  a->x = x * 256; a->y = y * 256;
  a->moves = moves;
  // its tiles are at a fixed place in sprite VRAM, the zone's first, second or third animal's (sAnimsTrappedAnimals'
  // vramOffset), shared by every one of that animal
  object_sprite_at(&a->o.sprite, OBJ_VRAM + (uint32_t)(ANIMAL_TILE + 4 * next_animal) * 32, anim, 0, ANIMAL_ORDER, ENEMY_PRIORITY, 0, 0);
  if (moves == FLIES) {
    a->heading = FLY_START; a->up = 1;
    object_task(&a->o, flying_animal_run, PRIORITY_OBJECTS);
  } else {
    a->fall = -ANIMAL_HOP; a->vx = moves == HOPS ? 1 : 0; a->inAir = ANIMAL_START_AIR;
    object_task(&a->o, animal_run, PRIORITY_OBJECTS);
  }
}

// --- Sonic against an enemy and what a defeat leaves --------------------------------------------------------------------------
void enemy_defeat(int x, int y) {
  Player *p = &act.player;
  int zone = act.stage.level >> 1;
  dust_cloud(x, y);
  if (zone < ZONES) animal_new(x, y, zone);
  next_animal = (next_animal + 1) % ZONE_ANIMALS_EACH;
  play_song(SE_ENEMY_DEFEAT);
  int chain = p->chain < SCORE_KINDS ? p->chain : SCORE_KINDS - 1;
  world_add_score_jingle(SCORES[chain]);
  popup_new(x, y, chain);
  if (p->chain < SCORE_KINDS - 1) p->chain++;
}

// Sonic, then the CPU partner (PLAYER(i) for each single-player character)
static Player *player_of(int i) { return i == 0 ? &act.player : act.hasPartner ? &act.partner : NULL; }

int enemy_attack(const Sprite *s, int x, int y) {
  const Hitbox *hb = object_box(s, 0);
  if (!hb) return 0;
  for (int i = 0; i < 2; i++) {
    Player *p = player_of(i);
    if (!p || p->dead) continue;
    int px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y);
    const Hitbox *body = object_box(&p->sprite, 0), *attack = object_box(&p->sprite, 1);
    if (attack && collide_overlap(x, y, hb, px, py, attack)) {
      if (p->ysp > 0) p->ysp = -p->ysp;
      enemy_defeat(x, y);
      return 1;
    }
    if (body && collide_overlap(x, y, hb, px, py, body)) {
      if (p->invincible > 0) { enemy_defeat(x, y); return 1; }
      world_damage(p);
    }
  }
  return 0;
}

int enemy_projectile(const Sprite *s, int x, int y) {
  const Hitbox *hb = object_box(s, 0);
  if (!hb) return 0;
  int touched = 0;
  for (int i = 0; i < 2; i++) {
    Player *p = player_of(i);
    if (!p || p->dead) continue;
    const Hitbox *body = object_box(&p->sprite, 0);
    if (!body || !collide_overlap(x, y, hb, (int)__builtin_floor(p->x), (int)__builtin_floor(p->y), body)) continue;
    world_damage(p);
    touched = 1;
  }
  return touched;
}
