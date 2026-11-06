// The Game Boy Advance kit in C: what a game written in C sees of the console. It is the same hardware layer as the
// JavaScript kit's (kit/gba/video.js, input.js, save.js), drawn the same way to the pixel, so a game moves between
// the two languages with nothing else changing. The page around the game, its start screen, settings, controller
// and achievements, stays the JavaScript kit's, which game.js joins to the C (kit/gba/c/README.md).
//
// A game defines two functions, which the kit calls:
//   void game_start(void)          once, with the player's copy in gba_rom
//   void game_step(uint16_t keys)  every frame, with the buttons held (KEY_A and the rest, as KEYINPUT has them,
//                                  a bit set for each button down)
// and draws each frame by writing the video hardware below. The kit draws it once the step is over.

#ifndef DREAMPORTS_GBA_H
#define DREAMPORTS_GBA_H

#include <stddef.h>
#include <stdint.h>

#define SCREEN_W 240
#define SCREEN_H 160

// the console's buttons, as its KEYINPUT register has them, a bit each (input.js KEY)
enum {
  KEY_A = 0x1, KEY_B = 0x2, KEY_SELECT = 0x4, KEY_START = 0x8, KEY_RIGHT = 0x10, KEY_LEFT = 0x20,
  KEY_UP = 0x40, KEY_DOWN = 0x80, KEY_R = 0x100, KEY_L = 0x200,
};

// the display registers, as byte offsets from 0x04000000 (video.js REG)
enum {
  REG_DISPCNT = 0x00, REG_BG0CNT = 0x08, REG_BG1CNT = 0x0A, REG_BG2CNT = 0x0C, REG_BG3CNT = 0x0E, REG_BG0HOFS = 0x10,
  REG_BG2PA = 0x20, REG_BG2X = 0x28, REG_BG2Y = 0x2C, REG_BG3PA = 0x30, REG_BG3X = 0x38, REG_BG3Y = 0x3C,
  REG_WIN0H = 0x40, REG_WIN1H = 0x42, REG_WIN0V = 0x44, REG_WIN1V = 0x46, REG_WININ = 0x48, REG_WINOUT = 0x4A,
  REG_MOSAIC = 0x4C, REG_BLDCNT = 0x50, REG_BLDALPHA = 0x52, REG_BLDY = 0x54,
};
#define GBA_IO_HALFWORDS (0x58 >> 1)

// The video hardware: VRAM, the colours (the backgrounds' 256, then the sprites'), OAM and the display registers,
// by halfword (gba_io[REG_BLDCNT >> 1]). Write a register with gba_write, which keeps only what the register keeps
// and restarts a rotating layer from a new reference point; the arrays can be written as they are.
extern uint8_t gba_vram[0x18000];
extern uint16_t gba_pal[512];
extern uint16_t gba_oam[512];
extern uint16_t gba_io[GBA_IO_HALFWORDS];

/** Writes a 16-bit display register, as the CPU or a DMA does. */
void gba_write(unsigned reg, uint16_t value);
/** Reads the colours again, for an H-blank that changes them between lines. */
void gba_update_colors(void);
/** Runs `hblank(y)` after each line y is drawn, as the H-blank does, or nothing with NULL. */
void gba_on_hblank(void (*hblank)(int y));
/** A picture put behind everything the scene draws, 240 × 160 words of colour as the frame has them, or NULL. */
extern const uint32_t *gba_underlay;
/** A BGR555 colour as 8 bits a channel, red in the lowest byte. */
uint32_t gba_color555(uint16_t c);
/**
 * Draws a frame into `out`, 240 × 160 words, red in the lowest byte and 0xFF above blue, as an ImageData holds
 * them. The registers are as they were before it afterwards, so a frame can be drawn again.
 */
void gba_draw_frame(uint32_t *out);

// The player's copy of the game, which game.js checked against the versions the game supports.
extern const uint8_t *gba_rom;
extern uint32_t gba_rom_size;

/**
 * The cartridge's save memory, `size` bytes, with what the browser kept of it, or zeros the first time. It is the
 * same memory every call. What its bytes mean is the game's, which calls gba_save_write when the original writes it.
 */
uint8_t *gba_save(uint32_t size);
/** Keeps the save memory's bytes, as the original writes them to the cartridge. */
void gba_save_write(void);

/** Memory for the game, zeroed, which lasts as long as the page. */
void *gba_alloc(size_t size);

// what a game defines
void game_start(void);
void game_step(uint16_t keys);

#endif
