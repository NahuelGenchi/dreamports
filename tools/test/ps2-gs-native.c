// A Dreamport on the PlayStation 2's kit, run on this computer with no browser, for the strict reference to judge its
// drawing (gs-reference.mjs): it writes everything the kit's GS was given as a PCSX2 GS dump, for PCSX2's software
// renderer to replay, and each frame's picture as read circuit 1 shows it, the way PCSX2 saves one.
//
//   game <frames> <pictures.out> <dump.gs> [<screen.out>]
//
// The build wraps the GS's ways in (gs_write, gs_image, gs_screen and gs_read_image), so what the game and the kit's GIF
// give it is written to the dump as it goes in: register writes as A+D packets, pictures as IMAGE packets, reads back as
// the replay's own reads, and the privileged registers at each V-blank. <pictures.out> gets each frame's picture,
// SCREEN_W × SCREEN_H words from where DISPFB1 says, each a 32-bit colour, alpha in the top byte: a 32-bit pixel as it
// is, a 24-bit one with 0x80 above it, and a 16-bit one widened with 0x80 or 0 as its top bit says. <screen.out> gets
// what the kit shows of each frame, both circuits merged as the page would paint it, SCREEN_W × SCREEN_H words.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "gs-kit.h"

uint8_t *dp_rom(uint32_t size);
void dp_start(void);
void dp_step(uint32_t buttons);
uint32_t *dp_draw(void);
void host_save_read(uint8_t *bytes, uint32_t size) { (void)bytes; (void)size; }
void host_save_write(const uint8_t *bytes, uint32_t size) { (void)bytes; (void)size; }

// the dump's version and the size of the GS's state in it, all of it 0 here but its version and Q, as the GS starts
#define DUMP_VERSION 9
#define STATE_SIZE 4194821
static FILE *dump;
// the privileged registers as the game wrote them, from PMODE's address on, as the dump keeps them
static uint8_t privileged[8192];
// register writes waiting to go as one A+D packet: each its 64 bits and its register
static uint64_t pending[2 * 4096];
static int pending_count;

static void put(const void *data, size_t size) { fwrite(data, 1, size, dump); }
static void put32(uint32_t value) { put(&value, 4); }
// the dump's packets: GIF data, a V-blank, a read back and the privileged registers
enum { TRANSFER, VSYNC, READ_FIFO, REGISTERS };
// GIF data, under the one path number PCSX2 writes all of it with now, whichever path it came by
static void transfer(const void *data, uint32_t size) {
  uint8_t head[2] = { TRANSFER, 3 };
  put(head, 2);
  put32(size);
  put(data, size);
}
static void flush_writes(void) {
  if (!pending_count) return;
  uint64_t packet[2 + 2 * 4096] = { (uint64_t)pending_count | 1ull << 60, 0xE };
  memcpy(packet + 2, pending, (size_t)pending_count * 16);
  transfer(packet, 16 + (uint32_t)pending_count * 16);
  pending_count = 0;
}

void __real_gs_write(uint8_t reg, uint64_t value);
void __wrap_gs_write(uint8_t reg, uint64_t value) {
  if (pending_count == 4096) flush_writes();
  pending[pending_count * 2] = value;
  pending[pending_count * 2 + 1] = reg;
  pending_count++;
  __real_gs_write(reg, value);
}
void __real_gs_image(const void *data, uint32_t length);
void __wrap_gs_image(const void *data, uint32_t length) {
  flush_writes();
  uint32_t qwords = (length + 15) / 16;
  uint8_t *packet = calloc(16 + (size_t)qwords * 16, 1);
  uint64_t tag[2] = { (uint64_t)qwords | 2ull << 58, 0 };
  memcpy(packet, tag, 16);
  memcpy(packet + 16, data, length);
  transfer(packet, 16 + qwords * 16);
  free(packet);
  __real_gs_image(data, length);
}
void __real_gs_screen(uint32_t address, uint32_t value);
void __wrap_gs_screen(uint32_t address, uint32_t value) {
  uint32_t at = address - GS_PMODE;
  if (at + 4 <= sizeof privileged) memcpy(privileged + at, &value, 4);
  __real_gs_screen(address, value);
}
void __real_gs_read_image(void *data, uint32_t length);
void __wrap_gs_read_image(void *data, uint32_t length) {
  flush_writes();
  uint8_t id = READ_FIFO;
  put(&id, 1);
  put32((length + 15) / 16);
  __real_gs_read_image(data, length);
}
static void vsync(int field) {
  flush_writes();
  uint8_t id = REGISTERS;
  put(&id, 1);
  put(privileged, sizeof privileged);
  uint8_t sync[2] = { VSYNC, (uint8_t)field };
  put(sync, 2);
}

int main(int argc, char **argv) {
  if (argc != 4 && argc != 5) {
    fprintf(stderr, "Usage: %s <frames> <pictures.out> <dump.gs> [<screen.out>]\n", argv[0]);
    return 2;
  }
  int frames = atoi(argv[1]);
  FILE *pictures = fopen(argv[2], "wb");
  dump = fopen(argv[3], "wb");
  FILE *screen = argc == 5 ? fopen(argv[4], "wb") : NULL;
  if (!pictures || !dump) {
    fprintf(stderr, "Can't write %s or %s\n", argv[2], argv[3]);
    return 1;
  }
  const uint32_t header[11] = { 0xFFFFFFFF, 36, DUMP_VERSION, STATE_SIZE, 36, 0, 0, 0, 0, 36, 0 };
  put(header, sizeof header);
  uint8_t *state = calloc(STATE_SIZE, 1);
  const uint32_t version = DUMP_VERSION;
  const float q = 1;
  memcpy(state, &version, 4);
  memcpy(state + STATE_SIZE - 4, &q, 4);
  put(state, STATE_SIZE);
  free(state);
  // the privileged registers the game sets up as it starts go in the header's place for them
  long privileged_at = ftell(dump);
  put(privileged, sizeof privileged);
  dp_rom(0);
  dp_start();
  long end = ftell(dump);
  fseek(dump, privileged_at, SEEK_SET);
  put(privileged, sizeof privileged);
  fseek(dump, end, SEEK_SET);
  for (int frame = 0; frame < frames; frame++) {
    vsync(frame & 1);
    dp_step(0);
    uint64_t dispfb;
    memcpy(&dispfb, privileged + (GS_DISPFB1 - GS_PMODE), 8);
    uint32_t block = (uint32_t)(dispfb & 0x1FF) * GS_PAGE_BLOCKS, width = (uint32_t)(dispfb >> 9) & 63, left = (uint32_t)(dispfb >> 32) & 0x7FF, top = (uint32_t)(dispfb >> 43) & 0x7FF;
    int psm = (int)(dispfb >> 15) & 31;
    for (uint32_t y = 0; y < SCREEN_H; y++) {
      for (uint32_t x = 0; x < SCREEN_W; x++) {
        uint32_t held = gs_pixel(block, width, psm, left + x, top + y);
        uint32_t colour = gs_is_16(psm) ? gs_from_16(held, 0x80, 0) : psm == PSMCT24 ? held | 0x80000000u : held;
        fwrite(&colour, 4, 1, pictures);
      }
    }
    if (screen) fwrite(dp_draw(), 4, SCREEN_W * SCREEN_H, screen);
  }
  vsync(frames & 1);
  fclose(pictures);
  if (screen) fclose(screen);
  fclose(dump);
  return 0;
}
