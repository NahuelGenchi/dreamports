// What the NES kit's own files share (ppu.c, apu.c, nes.c), which a game doesn't need.

#ifndef DREAMPORTS_NES_KIT_H
#define DREAMPORTS_NES_KIT_H

#include <stdint.h>

// a frame's length in the PPU's dots, as kit/consoles.js has it
extern const int nes_frame_dots;
// whether the cartridge's tiles are memory it can write
extern int nes_chr_writable;

void nes_ppu_power(void);
void nes_ppu_wiring(void);
void nes_ppu_frame_start(uint32_t frame);
void nes_ppu_frame_end(void);
int nes_ppu_frame_length(void);
int nes_ppu_dot(void);
void nes_ppu_write(uint16_t address, uint8_t value);
uint8_t nes_ppu_read(uint16_t address);
void nes_oam_dma(const uint8_t *page);
void nes_ppu_draw(uint32_t *out);

void nes_apu_power(void);
/** Runs the sound hardware on to `dots` of the PPU's from power-on. */
void nes_apu_run_to(uint64_t dots);
void nes_apu_write(uint16_t address, uint8_t value);
uint8_t nes_apu_status(void);
/** Forgets the samples made so far, which no frame plays: those before the kit's first frame. */
void nes_apu_drop(void);
/** The next `count` samples made, left and right alike, each -1 to 1. */
void nes_apu_take(float *left, float *right, int count);

#endif
