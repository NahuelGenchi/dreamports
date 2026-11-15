// What the garden's two games share (gardengames.c): their sprites, their ring counts, the banners and fades of their
// screens, and the Chao they draw. Each game draws without the garden's objects: its sprites are the ones its pictures
// unpack straight into OAM, which it changes in place, and its numbers are tiles it rolls by copying rows of them.

#ifndef SONIC_ADVANCE_GARDEN_GAMES_H
#define SONIC_ADVANCE_GARDEN_GAMES_H

#include "garden.h"

static inline uint32_t game_p8(uint32_t address) { return *garden_at(address); }
static inline uint32_t game_p16(uint32_t address) { return le16(garden_at(address), 0); }
static inline void game_vram16(uint32_t offset, uint16_t v) { set_le16(gba_vram, (int)offset, v); }
static inline uint32_t game_vram16_at(uint32_t offset) { return le16(gba_vram, (int)offset); }

// ---- the sprites, as OAM holds them: the first two attributes as one word, the third, and the matrices ----

#define PLACE 0xFE00FF00u    // all of the two attributes but where the sprite is
#define SHOWN 0xC1FFFCFFu    // all but the flips, the matrix and whether it's hidden or turned
static inline uint32_t spr(int i) { return gba_oam[i * 4] | (uint32_t)gba_oam[i * 4 + 1] << 16; }
static inline void set_spr(int i, uint32_t v) { gba_oam[i * 4] = (uint16_t)v; gba_oam[i * 4 + 1] = (uint16_t)(v >> 16); }
static inline void place(int i, int x, int y) {
  set_spr(i, (spr(i) & PLACE) | (uint32_t)(x & 0x1FF) << 16 | (uint32_t)(y & 0xFF));
}
static inline void hide(int i) { gba_oam[i * 4] |= 0x200; }
static inline void show(int i) { set_spr(i, spr(i) & SHOWN); }
static inline void set_tile(int i, int keep, int tile) { gba_oam[i * 4 + 2] = (uint16_t)((gba_oam[i * 4 + 2] & keep) | tile); }
// the matrix `k`'s four numbers are the fourth halfwords of sprites 4k to 4k + 3
#define MATRIX(k, n) gba_oam[3 + 16 * (k) + 4 * (n)]

/** 0x02008014: tile `tile`'s picture is `digit`, `step` rows on the way to the next. */
void game_roll_digit(int tile, int digit, int step);

// ---- the rings won, which the count shown rolls up to ----

/** 0x02008094: none won yet. */
void game_rings_start(void);
/** 0x020080C0: a frame of the count rolling up. */
void game_rings_roll(void);
/** 0x02008128: rings won, which the count rolls up to; 99 at most. */
void game_rings_win(int rings);
/** 0x02008144: rings won, which the count shows at once. */
void game_rings_win_now(int rings);
/** 0x0200816C: the rings won go to the garden's count. */
void game_rings_bank(void);

// ---- the screen's way in and out (0x020087CC) ----

enum { SHOW_NOTHING, SHOW_FADE_IN, SHOW_GAME_OVER, SHOW_CLEARED, SHOW_WAIT, SHOW_FADE_OUT };
/** 0x02008744, 0x0200875C, 0x02008774, 0x0200878C: what shows from the next frame. */
void game_show_start(int what);
/** 0x020087A4: the screen fades out to white, and its music with it. */
void game_leave(void);
/** A frame of what's showing; returns 1 once a fade is over, or once CLEAR! has flashed. */
int game_show_frame(void);

// ---- the Chao: five sprites from the first one given, its body four and the ball over its head ----

/** 0x02008190. */
void game_chao_first(int sprite);
/** 0x0200819C: hidden. */
void game_chao_hide(void);
/** 0x02008204: which way it faces. */
void game_chao_faces(int flipped);
/** 0x02008284: its body's four tiles, from `tile`. */
void game_chao_frame(int tile);
/** 0x020082FC: its ball's tile. */
void game_chao_ball(int tile);
/** 0x0200832C: where it is, its parts the other way round when it's flipped, and its ball over its head. */
void game_chao_place(int x, int y);

#endif
