// A function of the function check's test (../twin.mjs) that reads video memory, in a file of its own so the other
// tests' program stays as it is. On the kit, video memory is the kit's own (gba_vram), and a value the check changes
// there has to reach the twin there.
#include "program.h"

#ifdef MATCHING
#define VIDEO_READ8(address) (*(volatile u8 *)(address))
#else
#define VIDEO_READ8(address) gba_vram[(address) - TILES]
#endif

/** Look, 0x080005C0: the frame set to a byte of a background tile, as video memory holds it. */
void Look(void) {
  gFrame = VIDEO_READ8(TILES + 8);
}
