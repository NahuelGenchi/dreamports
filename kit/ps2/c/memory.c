// The console's memory in a PlayStation 2 Dreamport, for the proof tools to compare with the original's after every
// frame (tools/lib/memory.mjs): a game that keeps its memory where the console keeps it, as one whose every function is
// a twin does, says where each stretch of it is (ps2_console_memory), and the page reads them back by the console's own
// addresses (dp_console_memory, kit/c/game.js). The kit keeps none of it for a game that says nothing.

#include "ps2-kit.h"
#include "page.h"

#define MOST 32
static struct { uint32_t memory, address, size; uint8_t *at; } held[MOST];
static int count;

void ps2_console_memory(uint32_t memory, uint32_t address, uint32_t size, void *at) {
  if (count == MOST) return;
  held[count].memory = memory;
  held[count].address = address;
  held[count].size = size;
  held[count].at = at;
  count++;
}

/** Where `bytes` from `address` of one of the console's memories are, or 0 when the game keeps none of them there. */
EXPORT("dp_console_memory") uint8_t *dp_console_memory(uint32_t memory, uint32_t address, uint32_t bytes) {
  for (int i = 0; i < count; i++) {
    if (held[i].memory == memory && address >= held[i].address && (uint64_t) address + bytes <= (uint64_t) held[i].address + held[i].size) return held[i].at + (address - held[i].address);
  }
  return 0;
}
