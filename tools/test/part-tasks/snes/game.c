// The twins of the parts program's functions (../../made-up-snes.mjs, madeUpPartsCartridge), each with its contract
// beside it, which says what of the 65816's registers and flags it's given and gives back (../../../snes/contracts.mjs).
// Each keeps its values where the original does, at the console's own addresses, and reads and writes the hardware
// through the kit, as the original's loads and stores do. The test fills in each function's label, between two at signs.

#include "snes.h"

// a byte and a word at one of the console's 24-bit addresses
#define BYTE(address) (*(volatile uint8_t *)(uintptr_t)(address))
#define WORD(address) (*(volatile uint16_t *)(uintptr_t)(address))
// where the direct page's byte `at` is, in the work memory, as the console has it below $2000 of every low bank
#define DIRECT(d, at) (0x7E0000 | (uint16_t)((d) + (at)))

// dp:twin @NMI@ a8i16 nmi(D) if D < 0x1E00 && (DB & 0x40) == 0
void nmi(uint16_t d) {
  snes_read(0x4210);
  BYTE(DIRECT(d, 2)) = (uint8_t)(BYTE(DIRECT(d, 2)) + 1);
}

// dp:twin @COUNT@ a8i16 count(D) if D < 0x1E00
void count(uint16_t d) {
  WORD(DIRECT(d, 0)) = (uint16_t)(WORD(DIRECT(d, 0)) + 1);
}

// dp:twin @RED@ a8i16 red(&A, D) if D < 0x1E00 && (DB & 0x40) == 0
void red(uint16_t *a, uint16_t d) {
  uint8_t level = (uint8_t)(BYTE(DIRECT(d, 0)) & 0x1F);
  snes_write(0x2121, 0x00);
  snes_write(0x2122, level);
  snes_write(0x2122, 0x00);
  *a = (uint16_t)((*a & 0xFF00) | level);
}

// dp:twin @BLUE@ a8i16 blue(&A, D) if D < 0x1E00 && (DB & 0x40) == 0
void blue(uint16_t *a, uint16_t d) {
  uint8_t level = (uint8_t)((BYTE(DIRECT(d, 0)) & 0x1F) << 2);
  snes_write(0x2121, 0x00);
  snes_write(0x2122, 0x00);
  snes_write(0x2122, level);
  *a = (uint16_t)((*a & 0xFF00) | level);
}

// dp:twin @BONUS@ a8i16 bonus(&A, D) if D < 0x1E00
void bonus(uint16_t *a, uint16_t d) {
  BYTE(DIRECT(d, 4)) = 0x01;
  *a = (uint16_t)((*a & 0xFF00) | 0x01);
}

