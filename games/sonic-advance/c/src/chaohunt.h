// Chao Hunt, the VS mode's round (chaohunt.c): what the act asks of it.

#ifndef SA_CHAOHUNT_H
#define SA_CHAOHUNT_H

#include <stdint.h>

typedef struct {
  int active;      // a round is being played (gGameMode 4)
  int id, count;   // this GBA's number on the link, and how many play
  int chaoPlace;   // the Chao's place among the stage's eight, as the link handed it
} Round;

extern Round hunt;

/** Whether the act is a round of Chao Hunt. */
int chaohunt_active(void);
/** Player `player`'s start place in multiplayer stage `level`. */
void chaohunt_spawn(int level, int player, int32_t *x, int32_t *y);
/** Starts the round the VS menus chose. */
void chaohunt_start(int level, int chao);

#endif
