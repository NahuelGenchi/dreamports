// The Nintendo 64's kit in C, on what every console's kit in C shares (kit/c/README.md). A game reads and writes the
// console as its original does, at the same addresses: its memory, RDRAM, and the registers of the chips around it.
// The kit does what the console's chips do with them: the RSP runs the microcode the game gives it, the RDP draws the
// commands it's sent into RDRAM, and the video interface shows the part of RDRAM it's told to (kit/n64/c/README.md).

#ifndef DREAMPORTS_N64_H
#define DREAMPORTS_N64_H

#include "console.h"

// how much RDRAM the console has, without the Expansion Pak
#define N64_RDRAM_SIZE 0x800000

/** RDRAM, as the console keeps it: each number highest byte first. */
extern uint8_t n64_rdram[N64_RDRAM_SIZE];

// the registers a game writes, at the addresses its processor sees them, uncached
enum {
  // the RSP's memories, data and then instructions, and its registers
  SP_DMEM = 0xA4000000, SP_IMEM = 0xA4001000,
  SP_MEM_ADDR = 0xA4040000, SP_DRAM_ADDR = 0xA4040004, SP_RD_LEN = 0xA4040008, SP_WR_LEN = 0xA404000C,
  SP_STATUS = 0xA4040010, SP_DMA_FULL = 0xA4040014, SP_DMA_BUSY = 0xA4040018, SP_SEMAPHORE = 0xA404001C, SP_PC = 0xA4080000,
  // the RDP's command registers
  DPC_START = 0xA4100000, DPC_END = 0xA4100004, DPC_CURRENT = 0xA4100008, DPC_STATUS = 0xA410000C, DPC_CLOCK = 0xA4100010,
  DPC_BUFBUSY = 0xA4100014, DPC_PIPEBUSY = 0xA4100018, DPC_TMEM = 0xA410001C,
  // the MIPS interface: the interrupts the chips raise
  MI_MODE = 0xA4300000, MI_VERSION = 0xA4300004, MI_INTR = 0xA4300008, MI_INTR_MASK = 0xA430000C,
  // the video interface
  VI_STATUS = 0xA4400000, VI_ORIGIN = 0xA4400004, VI_WIDTH = 0xA4400008, VI_V_INTR = 0xA440000C, VI_V_CURRENT = 0xA4400010,
  VI_BURST = 0xA4400014, VI_V_SYNC = 0xA4400018, VI_H_SYNC = 0xA440001C, VI_LEAP = 0xA4400020, VI_H_START = 0xA4400024,
  VI_V_START = 0xA4400028, VI_V_BURST = 0xA440002C, VI_X_SCALE = 0xA4400030, VI_Y_SCALE = 0xA4400034,
  // the audio interface
  AI_DRAM_ADDR = 0xA4500000, AI_LEN = 0xA4500004, AI_CONTROL = 0xA4500008, AI_STATUS = 0xA450000C, AI_DACRATE = 0xA4500010,
  AI_BITRATE = 0xA4500014,
  // the peripheral interface, which reads the cartridge
  PI_DRAM_ADDR = 0xA4600000, PI_CART_ADDR = 0xA4600004, PI_RD_LEN = 0xA4600008, PI_WR_LEN = 0xA460000C, PI_STATUS = 0xA4600010,
  // where the processor sees the cartridge
  CARTRIDGE = 0xB0000000,
};

// the bits of MI_INTR, a chip's each
enum { MI_INTR_SP = 0x01, MI_INTR_SI = 0x02, MI_INTR_AI = 0x04, MI_INTR_VI = 0x08, MI_INTR_PI = 0x10, MI_INTR_DP = 0x20 };

/** A word read at `address`, as the processor reads it there: from RDRAM, the RSP's memories, a register or the
 *  cartridge. Any of the processor's ways of seeing an address is taken: cached, uncached or physical. */
uint32_t n64_read32(uint32_t address);
/** A word written at `address`, as the processor writes it there, with what the chip whose register it is does. */
void n64_write32(uint32_t address, uint32_t value);
/** A half-word or a byte of memory, RDRAM or the RSP's, read or written as the processor's loads and stores do. */
uint16_t n64_read16(uint32_t address);
void n64_write16(uint32_t address, uint16_t value);
uint8_t n64_read8(uint32_t address);
void n64_write8(uint32_t address, uint8_t value);

/** Paints the page's picture with what the video interface shows of RDRAM, as the console's emulator does. For
 *  game_draw. */
void n64_show(void);

// What a game defines, as on every console (kit/c/README.md).
void game_start(void);
void game_step(uint32_t buttons);
void game_draw(void);
void game_sound(float *left, float *right, int count);

#endif
