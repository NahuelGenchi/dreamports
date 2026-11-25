// The record the made-up Nintendo DS program of the end-to-end test keeps in the main memory (../made-up-nds-parts.mjs),
// laid out as the original has it, which its two functions' twins work on.

#include <stdint.h>

struct state {
  uint32_t keys;     // the buttons held, a bit each, as the console's register has them turned round
  uint32_t frames;   // how many frames have been counted
  uint16_t colour;   // the upper screen's colour
  uint16_t lower;    // the lower screen's colour
  uint32_t presses;  // how many frames A was held in
};

void tick(struct state *state);
void bump(struct state *state);
