// The table of levels (levels.h): every level the game has, written once, each with its row. A new act changes the
// one line that is its own, from NOT_IN_C to the row in its zone's file.

#include "levels.h"
#include <stddef.h>

// a level that isn't in C yet: nothing starts it, and the game stops safely where it would have (front.c, act.c)
static const Level NOT_IN_C = { 0 };

static const Level *const LEVELS[LEVEL_COUNT] = {
  // Zone 1
  [LEVEL_NEO_GREEN_HILL_1] = &ACT_NEO_GREEN_HILL_1,
  // and its second act
  [LEVEL_NEO_GREEN_HILL_2] = &ACT_NEO_GREEN_HILL_2,
  // Zone 2
  [LEVEL_SECRET_BASE_1] = &ACT_SECRET_BASE_1,
  // and its second act
  [LEVEL_SECRET_BASE_2] = &ACT_SECRET_BASE_2,
  // Zone 3
  [LEVEL_CASINO_PARADISE_1] = &ACT_CASINO_PARADISE_1,
  // and its second act
  [LEVEL_CASINO_PARADISE_2] = &ACT_CASINO_PARADISE_2,
  // Zone 4
  [LEVEL_ICE_MOUNTAIN_1] = &ACT_ICE_MOUNTAIN_1,
  // and its second act
  [LEVEL_ICE_MOUNTAIN_2] = &ACT_ICE_MOUNTAIN_2,
  // Zone 5
  [LEVEL_ANGEL_ISLAND_1] = &ACT_ANGEL_ISLAND_1,
  // and its second act
  [LEVEL_ANGEL_ISLAND_2] = &ACT_ANGEL_ISLAND_2,
  // Zone 6, whose two acts are zones of their own to the player
  [LEVEL_EGG_ROCKET] = &NOT_IN_C,
  // and its second
  [LEVEL_COSMIC_ANGEL] = &ACT_COSMIC_ANGEL,
  // Zone 7, the last fight
  [LEVEL_X_ZONE] = &ACT_X_ZONE,
  // and the one after it, with every Chaos Emerald
  [LEVEL_THE_MOON] = &NOT_IN_C,
  // the VS mode's Chao Hunt stages, the first
  [LEVEL_CHAO_HUNT_A] = &NOT_IN_C,
  // the second
  [LEVEL_CHAO_HUNT_B] = &NOT_IN_C,
  // the third
  [LEVEL_CHAO_HUNT_C] = &NOT_IN_C,
  // the fourth
  [LEVEL_CHAO_HUNT_D] = &NOT_IN_C,
};

const Level *level_row(int level) { return level >= 0 && level < LEVEL_COUNT ? LEVELS[level] : &NOT_IN_C; }
int level_in_c(int level) { return level_row(level)->drawBackground != NULL; }
