// A PlayStation 2 Dreamport on the kit in C, run on this computer with no browser, for the check of the kit's EE and
// vector units (ps2-ee-vu.mjs): it runs the game a frame at a time with no buttons held and writes, for each frame,
// what the proof tools compare with the console's emulator, in the shape the emulator's patch writes them
// (tools/libretro/play.patch): the draw list's hash and count to <draws>, its whole list to <list>, and the vector
// units' memories to <vu>, vector unit 0's code and data and then vector unit 1's.
//
//   frames <count> <draws> <list> <vu>

#include <stdio.h>
#include <stdlib.h>
#include "ps2-kit.h"

void dp_start(void);
void dp_step(uint32_t buttons);
uint32_t dp_draw_list(void);
uint32_t dp_draw_list_count(void);

// the programs it runs keep no saves
void host_save_read(uint8_t *bytes, uint32_t size) {}
void host_save_write(const uint8_t *bytes, uint32_t size) {}

int main(int argc, char **argv) {
  if (argc != 5) {
    fputs("frames <count> <draws> <list> <vu>\n", stderr);
    return 2;
  }
  long frames = atol(argv[1]);
  FILE *draws = fopen(argv[2], "wb"), *list = fopen(argv[3], "wb"), *vu = fopen(argv[4], "wb");
  if (!draws || !list || !vu) return 2;
  dp_start();
  for (long frame = 0; frame < frames; frame++) {
    dp_step(0);
    uint32_t drawn[2] = { dp_draw_list(), dp_draw_list_count() }, size;
    fwrite(drawn, 4, 2, draws);
    const uint8_t *bytes = gs_list_bytes(&size);
    if (size != 0xFFFFFFFF) fwrite(bytes, 1, size, list);
    fputc('F', list);
    fwrite(vu_code(0), 1, vu_code_size(0), vu);
    fwrite(vu_data(0), 1, vu_data_size(0), vu);
    fwrite(vu_code(1), 1, vu_code_size(1), vu);
    fwrite(vu_data(1), 1, vu_data_size(1), vu);
  }
  fclose(draws);
  fclose(list);
  fclose(vu);
  return 0;
}
