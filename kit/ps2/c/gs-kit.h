// What the GS's own files share (gs.c, gs-memory.c), which a game doesn't need: its registers and draw
// list, its memory, laid out as the chip lays it out, and its palette buffer.

#ifndef DREAMPORTS_GS_KIT_H
#define DREAMPORTS_GS_KIT_H

#include "ps2-kit.h"

// the pixel formats, as a register gives them
enum {
  PSMCT32 = 0x00, PSMCT24 = 0x01, PSMCT16 = 0x02, PSMCT16S = 0x0A, PSMT8 = 0x13, PSMT4 = 0x14, PSMT8H = 0x1B,
  PSMT4HL = 0x24, PSMT4HH = 0x2C, PSMZ32 = 0x30, PSMZ24 = 0x31, PSMZ16 = 0x32, PSMZ16S = 0x3A,
};
// the GS's memory is 4 MB of 8 KB pages, each 32 blocks of 256 bytes: a framebuffer's place is counted in pages, and a
// texture's, a palette's or a picture's in blocks
#define GS_PAGE_BLOCKS 32

/** The registers as last written, by number (ps2.h), for the GS's files to read. */
extern uint64_t gs_registers[0x63];
/** Adds something written to the frame's draw list: 'R' a register, 'I' a picture's data, 'S' half of a privileged
 *  register, as the proof tools keep the original's. */
void gs_list_add(char kind, const void *data, size_t length);
/** SIGNAL, FINISH or LABEL written: what CSR and SIGLBLID make of it. */
void gs_event(uint8_t reg, uint64_t value);

/** Whether a format keeps 16-bit pixels. */
static inline int gs_is_16(int psm) { return psm == PSMCT16 || psm == PSMCT16S || psm == PSMZ16 || psm == PSMZ16S; }
/** A 16-bit colour as a 32-bit one: five bits a channel, shifted up, and its top bit as the alpha `one` or `zero` says. */
static inline uint32_t gs_from_16(uint32_t colour, uint32_t one, uint32_t zero) {
  uint32_t r = (colour & 31) << 3, g = (colour >> 5 & 31) << 3, b = (colour >> 10 & 31) << 3;
  return r | g << 8 | b << 16 | (colour & 0x8000 ? one : zero) << 24;
}

/** Gives the GS its memory, all zero. */
void gs_memory_power(void);
/** How many bits a pixel of a format takes in a transfer: 32, 24, 16, 8 or 4. */
int gs_transfer_bits(int psm);
/** A pixel of the buffer at block `block`, `width` 64-pixel columns across, in format `psm`: its bits as the format
 *  keeps them, 32, 24, 16, 8 or 4 of them, the rest 0. */
uint32_t gs_pixel(uint32_t block, uint32_t width, int psm, uint32_t x, uint32_t y);
/** Writes a pixel's bits, those set in `keep` staying as they were. */
void gs_pixel_set(uint32_t block, uint32_t width, int psm, uint32_t x, uint32_t y, uint32_t value, uint32_t keep);

/** TRXDIR written: starts moving a picture into memory, out of it, or from one place in it to another. */
void gs_transfer_start(uint64_t direction);
/** A picture's data for the transfer into memory, as IMAGE data or HWREG gives it. */
void gs_transfer_in(const uint8_t *bytes, uint32_t length);

/** TEX0 or TEX2 written: loads the palette buffer from memory as its CLD says. */
void gs_palette_load(uint64_t tex0);
/** The palette's entry for a texel of an 8 or 4-bit texture, as TEX0 reads it: 32 bits, or 16 in the low half. */
uint32_t gs_palette_entry(uint64_t tex0, uint32_t index);

#endif
