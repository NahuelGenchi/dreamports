// The Dreamport in C of the pad program of the PlayStation's kit test (../made-up-ps1.mjs, madeUpPadExe), written as a
// game's C on the kit is: each frame it reads the pad in the first port through SIO0, a byte at a time, as the program
// does, and draws what came back, each byte as a square of its grey and each button's bit as a square lit while it's
// held. ps1-kit.mjs fills in its numbers where the @ signs are. The program waits for the V-blank where this one's
// frame starts.

#include "ps1.h"

static const uint8_t sends[] = { 0x01, 0x42, 0x00, 0x00, 0x00 };
static uint8_t received[sizeof sends];
static uint32_t port_select = @PORT@;

void game_start(void) {
  gpu_gp1(0x00000000);
  gpu_gp1(0x08000001);
  gpu_gp1(0x06C60260);
  gpu_gp1(0x07040010);
  gpu_gp1(0x05000000);
  gpu_gp1(0x03000000);
  gpu_gp0(0xE3000000);
  gpu_gp0(0xE403BD3F);
  gpu_gp0(0xE5000000);
  sio_write(SIO_BASE + 0x8, 0x000D);
  sio_write(SIO_BASE + 0xE, 0x0088);
}

void game_step(uint32_t buttons) {
  sio_write(SIO_BASE + 0xA, port_select);
  for (unsigned i = 0; i < sizeof sends; i++) {
    sio_write(SIO_BASE, sends[i]);
    while (!(sio_read(SIO_BASE + 0x4) & 2)) {}
    received[i] = (uint8_t)sio_read(SIO_BASE);
  }
  sio_write(SIO_BASE + 0xA, 0);
  gpu_gp0(0x02000000 | @BACKGROUND@);
  gpu_gp0(0);
  gpu_gp0(240 << 16 | 320);
  for (unsigned i = 0; i < sizeof sends; i++) {
    gpu_gp0(0x60000000 | received[i] << 16 | received[i] << 8 | received[i]);
    gpu_gp0(40 << 16 | (20 + i * 24));
    gpu_gp0(16 << 16 | 16);
  }
  uint32_t word = received[3] | received[4] << 8;
  for (unsigned bit = 0; bit < 16; bit++) {
    gpu_gp0(0x60000000 | (word >> bit & 1 ? @LOOSE@ : @HELD@));
    gpu_gp0(100 << 16 | (20 + bit * 18));
    gpu_gp0(12 << 16 | 12);
  }
}

void game_draw(void) { gpu_show(); }

void game_sound(float *left, float *right, int count) { spu_sound(left, right, count); }
