// What the objects ask of the act: a hazard hurting Sonic, points, and an item box's prize. Translated from the JavaScript
// version's engine/game.js (the world's damage, addScore and prize). The music manager's part of a prize (the 1-up jingle, the
// invincibility song, the speed shoes' tempo) is not here yet.

#include "objects.h"

enum {
  SE_RING = 117, SE_LIFE_LOST = 119, SE_SHIELD = 168,
  ONE_UP = 0, SHIELD = 1, MAGNETIC_SHIELD = 2, INVINCIBILITY = 3, SPEED_UP = 4, RANDOM_RINGS = 5, RINGS_5 = 6, RINGS_10 = 7,
  ITEM_TIME = 1200,        // invincibility and speed shoes last 20 seconds
  POINTS_PER_LIFE = 50000,
  RANDOM_RING_KINDS = 6,
};
static const uint8_t RANDOM_RING_PRIZES[RANDOM_RING_KINDS] = { 1, 5, 10, 20, 30, 40 };   // ItemBox_RingAmountTable

void world_life_more(void) { act.lives = (act.lives + 1) & 0xFF; }

// Coll_DamagePlayer: a shield takes the hit, or with rings he drops them all, up to 48 of them scattering, and without any he
// dies; false while he is invincible or still blinking from the last hit
int world_damage(Player *p) {
  if (!player_hurt(p)) return 0;
  if (p->shield) {
    play_song(SE_LIFE_LOST);
    p->shield = SHIELD_NONE;
  } else if (act.ringCount > 0) {
    scatter_launch((int)__builtin_floor(p->x), (int)__builtin_floor(p->y), act.ringCount, p->layer, p->inverted);
    act.ringCount = 0;
  } else p->dead = 1;
  return 1;
}

// INCREMENT_SCORE_A: points with a life every 50000, without the jingle
void world_add_score(int points) {
  int before = act.score;
  act.score += points;
  if (act.score / POINTS_PER_LIFE != before / POINTS_PER_LIFE) world_life_more();
}

// an item box's prize (Task_Itembox2)
void world_prize(int kind) {
  Player *p = &act.player;
  switch (kind) {
    case ONE_UP: world_life_more(); break;
    case SHIELD: case MAGNETIC_SHIELD:
      p->shield = kind == SHIELD ? SHIELD_NORMAL : SHIELD_MAGNETIC;
      items_shield(p->shield);
      play_song(SE_SHIELD);
      break;
    case INVINCIBILITY:
      if (!p->invincible) items_stars();
      p->invincible = ITEM_TIME;
      break;
    case SPEED_UP: p->speedUp = ITEM_TIME; break;
    case RANDOM_RINGS: case RINGS_5: case RINGS_10:
      rings_add(kind == RINGS_5 ? 5 : kind == RINGS_10 ? 10 : RANDOM_RING_PRIZES[act_random() % RANDOM_RING_KINDS]);
      play_song(SE_RING);
      break;
  }
}
