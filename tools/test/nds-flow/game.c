// The twins of the made-up Nintendo DS program's two functions (../made-up-nds-parts.mjs), each naming its function of
// the original in the comment above it, as a game's C does. The test fills in where each is (nds-flow.mjs).

#include "game.h"

/** @TICK@: counts a frame, and works out the upper screen's colour from the count */
void tick(struct state *state) {
  state->frames += 1;
  state->colour = state->frames & 31;
}

/** @BUMP@: counts a frame A was held in, and works out the lower screen's colour from that count */
void bump(struct state *state) {
  state->presses += 1;
  state->lower = (state->presses & 31) << 5;
}
