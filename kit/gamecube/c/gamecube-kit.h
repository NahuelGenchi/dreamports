// What the GameCube kit's own files share (gamecube.c, vi.c, audio.c, si.c), which a game doesn't need.

#ifndef DREAMPORTS_GAMECUBE_KIT_H
#define DREAMPORTS_GAMECUBE_KIT_H

#include "gamecube.h"
#include "kit.h"

// numbers in the console's order, highest byte first
static inline uint32_t gc_be32(const uint8_t *p) { return (uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 8 | p[3]; }
static inline uint16_t gc_be16(const uint8_t *p) { return (uint16_t)(p[0] << 8 | p[1]); }
static inline void gc_put_be32(uint8_t *p, uint32_t value) {
  p[0] = (uint8_t)(value >> 24); p[1] = (uint8_t)(value >> 16); p[2] = (uint8_t)(value >> 8); p[3] = (uint8_t)value;
}

/** The video interface as the console starts it, with or without a disc's start-up having set it going first. */
void vi_power(int started_by_disc);
uint16_t vi_read(uint32_t reg);
void vi_write(uint32_t reg, uint16_t value);
/** The next field, as each frame ends: the picture it shows from memory. */
void vi_field(void);

/** The audio interface and the sound processor's audio DMA as the console starts them. */
void audio_power(void);
uint16_t dsp_read(uint32_t reg);
void dsp_write(uint32_t reg, uint16_t value);
uint32_t ai_read(uint32_t reg);
void ai_write(uint32_t reg, uint32_t value);

/** The serial interface as the console starts it, and the buttons of the frame it polls the first controller for. */
void si_power(void);
void si_buttons(uint32_t buttons);
uint32_t si_read(uint32_t reg);
void si_write(uint32_t reg, uint32_t value);

#endif
