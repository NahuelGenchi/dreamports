// The Game Boy Advance kit in C: what a game written in C sees of the console. It is the same hardware layer as the
// JavaScript kit's (kit/gba/video.js, input.js, save.js, sound/), drawn the same way to the pixel and sounding the same
// to the sample, so a game moves between the two languages with nothing else changing. It builds on what every
// console's kit in C shares (kit/c/kit.h): the copy, the save memory, the start point's words and memory, which it
// gives a game under the names below too. The page around the game, its start screen, settings, controller and
// achievements, stays the JavaScript kit's, which game.js joins to the C (kit/gba/c/README.md).
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
#include "kit.h"

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

// The player's copy of the game, which game.js checked against the versions the game supports, its save memory, the
// words of the page's address and memory for the game, as every console's kit in C has them (kit/c/kit.h), under the
// Game Boy Advance's names: gba_save(size) and gba_save_write() for the cartridge's save memory, gba_start_point(name)
// and gba_start_number(name, absent) for a recording's start point, and gba_alloc(size).
#define gba_rom kit_copy
#define gba_rom_size kit_copy_size
#define gba_save kit_save
#define gba_save_write kit_save_write
#define gba_start_point kit_start_point
#define gba_start_number kit_start_number
#define gba_alloc kit_alloc

// The sound: Nintendo's sound engine (MusicPlayer2000, or "m4a") and the sound hardware, playing the songs and
// sounds in the player's copy, as the JavaScript kit's sound/ does to the sample. gba_sound_start finds the engine's
// tables and starts it with the game's sound mode, from its DEFAULT_SOUND_MODE: `players` music players, `channels`
// DirectSound channels, master `volume` 1 to 15, `rate` samples a second (10512 for SOUND_MODE_FREQ_10512) and
// `reverb` 0 to 127. It returns 0 when the copy has no such tables, and the game stays silent. Each call after it
// plays at the start of the next sound frame, as the original's calls during a frame are sequenced on the next, and
// each is named for the sound library's function it stands for.
int gba_sound_start(int players, int channels, int volume, int rate, int reverb);
/** m4aSoundInit after a soft reset: the engine starts again from nothing, with the sound chip as it was. */
void gba_sound_reset(void);
/** m4aSongNumStart */
void gba_sound_play(int song);
/** m4aSongNumStartOrChange: starts the song unless it is already playing on its player */
void gba_sound_play_or_change(int song);
/** m4aSongNumStartOrContinue: restarts a different song or an ended one, and lets a stopped one go on */
void gba_sound_start_or_continue(int song);
/** m4aSongNumStop */
void gba_sound_stop(int song);
/** m4aSongNumStart, then m4aMPlayImmInit and m4aMPlayPitchControl on its player (pitch in 1/256 semitones) */
void gba_sound_play_pitched(int song, int pitch);
/** MPlayStart with the song on music player `player` */
void gba_sound_start_on(int player, int song);
/** MPlayStop on music player `player` */
void gba_sound_stop_player(int player);
/** m4aMPlayContinue on music player `player` */
void gba_sound_continue_player(int player);
/** m4aMPlayImmInit on music player `player` */
void gba_sound_imm_init(int player);
/** m4aMPlayPitchControl, m4aMPlayVolumeControl (256 is full) and m4aMPlayPanpotControl (-64 left, +63 right) on the
 *  tracks `bits` of music player `player` */
void gba_sound_pitch(int player, int bits, int pitch);
void gba_sound_volume(int player, int bits, int volume);
void gba_sound_pan(int player, int bits, int pan);
/** m4aMPlayFadeIn and m4aMPlayFadeOut on music player `player`, a step every `speed` frames */
void gba_sound_fade_in(int player, int speed);
void gba_sound_fade_out(int player, int speed);
/** m4aMPlayTempoControl on the music (0x100 is normal speed) */
void gba_sound_tempo(int tempo);
/** m4aMPlayAllStop and m4aMPlayAllContinue: every music player stops, or goes on from where it stopped */
void gba_sound_stop_all(void);
void gba_sound_continue_all(void);
/** m4aSoundVSyncOff and m4aSoundVSyncOn: the mixing cleared and held, as a game does around a flash write */
void gba_sound_vsync_off(void);
void gba_sound_vsync_on(void);

// what a game defines
void game_start(void);
void game_step(uint16_t keys);

#endif
