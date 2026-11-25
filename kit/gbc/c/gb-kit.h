// What the Game Boy kit's own files share (gb.c, lcd.c, apu.c), which a game doesn't need.

#ifndef DREAMPORTS_GB_KIT_H
#define DREAMPORTS_GB_KIT_H

#include <stdint.h>

// a line of the screen and a whole picture, in the processor's cycles
#define GB_LINE 456
#define GB_FRAME 70224

// the interrupts' request register, $FF0F, which the screen and the timer set bits of
extern uint8_t gb_requested;

/** The screen as the console's own start-up leaves it, at the processor's cycle `cycle`. */
void gb_lcd_power(int colour, uint64_t cycle, const uint8_t *io);
/** Draws as far as the screen has got by `cycle`. */
void gb_lcd_run_to(uint64_t cycle);
/** Requests every interrupt the screen asks for up to `cycle`. */
void gb_lcd_request_to(uint64_t cycle);
/** The next cycle after `cycle` the screen may ask for an interrupt at, or UINT64_MAX with the screen off. */
uint64_t gb_lcd_next_request(uint64_t cycle);
void gb_lcd_write(uint8_t reg, uint8_t value, uint64_t cycle);
uint8_t gb_lcd_read(uint8_t reg, uint64_t cycle);
int gb_lcd_on(void);
/** The cycle the picture being drawn ends at, when its V-blank starts. */
uint64_t gb_lcd_vblank(void);
/** Whether the processor can reach the picture memory, the sprites and the colours at `cycle`. */
int gb_lcd_vram_open(uint64_t cycle);
int gb_lcd_oam_open(uint64_t cycle);
/** Keeps the picture drawn so far as the one the page shows, or a blank one. */
void gb_lcd_present(int blank);
void gb_lcd_draw(uint32_t *out);

void gb_apu_power(int colour, uint64_t cycle, const uint8_t *io);
/** Makes the sound up to the processor's cycle `cycle`. */
void gb_apu_run_to(uint64_t cycle);
void gb_apu_write(uint8_t reg, uint8_t value);
uint8_t gb_apu_read(uint8_t reg);
int gb_apu_powered(void);
/** How many samples are made and not yet taken, and how many have been made since power-on. */
int gb_apu_made(void);
uint64_t gb_apu_total(void);
/** The next `count` samples made, each -1 to 1. */
void gb_apu_take(float *left, float *right, int count);

#endif
