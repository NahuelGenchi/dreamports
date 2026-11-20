// The music program of the Super Nintendo kit's test (../made-up-snes.mjs, madeUpMusicCartridge) in C, on the
// console's kit (kit/snes/c/), as a Dreamport of it is written: the main program sends the sound processor its program
// through the ports with the same writes and reads, from the player's copy as the original reads it, and the sound
// program's twin, game_spc, runs beside it, with the same writes to the sound processor's registers, in the same
// order, waiting where its original waits for its timer. The test fills in where the program is, each name between
// two at signs.

#include "snes.h"

// a word to a register and the one after it, as a 16-bit store writes them, and from them, as a 16-bit load reads
// them: low byte first
static void store16(uint16_t address, uint16_t value) {
  snes_write(address, (uint8_t)value);
  snes_write((uint16_t)(address + 1), (uint8_t)(value >> 8));
}
static uint16_t load16(uint16_t address) {
  uint8_t low = snes_read(address);
  return (uint16_t)(low | snes_read((uint16_t)(address + 1)) << 8);
}

void game_start(void) {
  SNES_RAM[0] = 0;
  snes_write(0x2121, 0x00);
  snes_write(0x2122, 0x6B);
  snes_write(0x2122, 0x2D);
  snes_write(0x2100, 0x0F);
  // the start-up program says $AA and $BB, and takes the sound program, a byte at a time, each one's count said back
  while (load16(0x2140) != 0xBBAA) {}
  store16(0x2142, @SOUND_START@);
  snes_write(0x2141, 0x01);
  snes_write(0x2140, 0xCC);
  while (snes_read(0x2140) != 0xCC) {}
  uint16_t y = 0;
  do {
    snes_write(0x2141, snes_bus(@SOUND@ + y));
    snes_write(0x2140, (uint8_t)y);
    while (snes_read(0x2140) != (uint8_t)y) {}
    y++;
  } while (y != @SOUND_BYTES@);
  // and then sends the sound processor to its start
  store16(0x2142, @SOUND_INIT@);
  snes_write(0x2141, 0x00);
  snes_write(0x2140, (uint8_t)(y + 1));
  // and waits for its first answer, its count on the second port, where the start-up program left $BB, reading both
  // ports as a word
  while ((load16(0x2140) & 0xFF00) == 0xBB00) {}
  snes_write(0x4200, 0x80);
}

// the V-blank: the frame's count to the first port, and on by one
void game_step(uint32_t buttons) {
  (void)buttons;
  snes_read(0x4210);
  snes_write(0x2140, SNES_RAM[0]);
  SNES_RAM[0]++;
}

void game_draw(void) {}
void game_sound(float *left, float *right, int count) {
  (void)left;
  (void)right;
  (void)count;
}

// the sound program, from its start
void game_spc(uint16_t address) {
  (void)address;
  // the table into the sound chip, a register and its value each, to the end, a byte with its top bit set
  for (uint8_t x = 0;;) {
    uint8_t value = snes_aram[(uint16_t)(@TABLE@ + x)];
    if (value & 0x80) break;
    snes_spc_write(0xF2, value);
    x++;
    snes_spc_write(0xF3, snes_aram[(uint16_t)(@TABLE@ + x)]);
    x++;
  }
  // the first timer every 32 steps of 8 kHz
  snes_spc_write(0xFA, 0x20);
  snes_spc_write(0xF1, 0x01);
  for (;;) {
    while (!snes_spc_read(0xFD)) snes_spc_wait();
    uint8_t count = ++snes_aram[0x10];
    // voice 0's pitch from the main program's count
    uint8_t pitch = (uint8_t)((snes_spc_read(0xF4) >> 4) | 0x08);
    snes_spc_write(0xF2, 0x03);
    snes_spc_write(0xF3, pitch);
    // the noise's rate from its own count, with the echo written
    snes_spc_write(0xF2, 0x6C);
    snes_spc_write(0xF3, (uint8_t)((count >> 1 & 0x1F) | 0x1C));
    // voice 0 keyed on again at every 64th count, and off at the 32nd between
    uint8_t phase = count & 0x3F;
    if (phase == 0) {
      snes_spc_write(0xF2, 0x5C);
      snes_spc_write(0xF3, 0x00);
      snes_spc_write(0xF2, 0x4C);
      snes_spc_write(0xF3, 0x01);
    }
    if (phase == 0x20) {
      snes_spc_write(0xF2, 0x5C);
      snes_spc_write(0xF3, 0x01);
    }
    // its count on the second port
    snes_spc_write(0xF5, snes_aram[0x10]);
  }
}
