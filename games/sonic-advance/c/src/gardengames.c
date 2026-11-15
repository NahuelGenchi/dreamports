// What Tiny Chao Garden's two games share, from 0x02008014 to 0x02008AE0 in the program (garden.c): their ring counts,
// the fades and banners their screens come and go by, and the Chao they draw (gardengames.h).

#include "gardengames.h"

enum { SE_GAME_OVER = 0x17, SE_CLEARED = 0x23 };

void game_roll_digit(int tile, int digit, int step) {
  memcpy(gba_vram + 0x10 + tile * 32, garden_at(0x02011CE0u + (uint32_t)(digit * 48 + step * 4)), 48);
}

// ---- the rings won: the count, what's shown, which rolls up to it, and its rolling ----

static struct { int8_t won, shown, tick, step; } purse;

/** 0x02008040. */
static void draw_rings(void) {
  int ones = purse.shown % 10, tens = purse.shown / 10;
  game_roll_digit(3, tens, ones == 9 ? purse.step : 0);
  game_roll_digit(1, ones, purse.step);
}
void game_rings_start(void) {
  purse.won = purse.shown = purse.tick = purse.step = 0;
  draw_rings();
}
/** The count shown rolls up to the rings won, faster when it's 6 or more behind. */
void game_rings_roll(void) {
  if (purse.shown == purse.won) return;
  if (++purse.tick <= 1 && purse.won < purse.shown + 6) return;
  purse.tick = 0;
  if (++purse.step == 12) {
    purse.step = 0;
    purse.shown++;
  }
  draw_rings();
}
void game_rings_win(int rings) {
  purse.won = (int8_t)(purse.won + rings);
  if (purse.won > 99) purse.won = 99;
}
void game_rings_win_now(int rings) {
  game_rings_win(rings);
  purse.shown = purse.won;
  purse.step = 0;
  draw_rings();
}
void game_rings_bank(void) { garden_add_rings(purse.won); }

// ---- the screen's way in and out ----

static struct { int8_t what, step; int16_t t; } shown;

void game_show_start(int what) {
  shown.what = (int8_t)what;
  shown.step = 0;
  shown.t = 0;
}
void game_leave(void) {
  game_show_start(SHOW_FADE_OUT);
  gba_sound_fade_out(0, 1);
}

// a banner of 3 rows of `wide` tiles from `tile` on the first layer, put where `x` and `y` scroll it to
static void banner(int tile, int wide, int x, int y, int sound) {
  for (uint32_t i = 0; i < 0x800; i += 2) game_vram16(0xC000 + i, 0);
  for (int row = 0; row < 3; row++)
    for (int i = 0; i < wide; i++) game_vram16(0xC000 + (uint32_t)(row * 64 + i * 2), (uint16_t)tile++);
  gba_write(REG_BG0CNT, 0x1800);
  gba_write(REG_BG0HOFS, (uint16_t)x);
  gba_write(REG_BG0HOFS + 2, (uint16_t)y);
  gba_write(REG_DISPCNT, gba_io[REG_DISPCNT >> 1] | 0x100);
  shown.step = 1;
  shown.t = 0;
  gba_sound_play(sound);
}

/** 0x020087CC: from white in over 16 frames, or out to it. GAME OVER drops in on its own layer and bounces, CLEAR!
 *  falls in from above; each settles, flashes white, and then GAME OVER waits 3 seconds, or for A or Start, before the
 *  fade out, while CLEAR! is over. */
int game_show_frame(void) {
  int done = 0;
  switch (shown.what) {
    case SHOW_NOTHING: return 1;
    case SHOW_FADE_IN: case SHOW_FADE_OUT:
      gba_write(REG_BLDY, (uint16_t)(shown.what == SHOW_FADE_IN ? 16 - shown.t : shown.t));
      if (shown.t == 16) {
        if (shown.what == SHOW_FADE_IN) gba_write(REG_BLDCNT, 0);
        done = 1;
      }
      if (shown.t == 0) gba_write(REG_BLDCNT, 0xBF);
      shown.t++;
      break;
    case SHOW_GAME_OVER: case SHOW_CLEARED:
      switch (shown.step) {
        case 0:
          if (shown.what == SHOW_GAME_OVER) banner(0x5009, 20, 0xF0, 0x18, SE_GAME_OVER);
          else banner(0x6045, 13, 0xD0, 0x60, SE_CLEARED);
          break;
        case 1: {
          int at = shown.what == SHOW_GAME_OVER ? 0x118 - (shown.t * shown.t >> 2) : (shown.t * shown.t >> 2) + 0x60;
          shown.t++;
          if (shown.what == SHOW_GAME_OVER ? at <= 0xB7 : at > 0xB8) {
            at = 0xB8;
            shown.step = 2;
            shown.t = 0;
          }
          gba_write(REG_BG0HOFS + 2, (uint16_t)at);
          break;
        }
        case 2:
          gba_write(REG_BG0HOFS + 2, (uint16_t)(shown.t + 0xB8));
          if (++shown.t == 8) {
            gba_write(REG_BLDY, 0);
            gba_write(REG_BLDCNT, 0x81);
            shown.step = 3;
            shown.t = 0;
          }
          break;
        case 3:
          gba_write(REG_BLDY, (uint16_t)shown.t);
          if (++shown.t == 16) shown.step = 4;
          break;
        case 4:
          gba_write(REG_BLDY, (uint16_t)shown.t);
          if (--shown.t < 0) {
            gba_write(REG_BLDCNT, 0);
            if (shown.what == SHOW_GAME_OVER) game_show_start(SHOW_WAIT);
            else done = 1;
          }
          break;
      }
      break;
    case SHOW_WAIT:
      if ((garden_pressed() & (KEY_A | KEY_START)) || ++shown.t == 180) game_leave();
      break;
    default: break;
  }
  return done;
}

// ---- the Chao ----

static struct { int first, flipped; } chao;

void game_chao_first(int sprite) { chao.first = sprite; }
void game_chao_hide(void) {
  for (int k = 0; k < 5; k++) hide(chao.first + k);
}
void game_chao_faces(int flipped) {
  chao.flipped = flipped;
  for (int k = 0; k < 5; k++) set_spr(chao.first + k, (spr(chao.first + k) & SHOWN) | (uint32_t)flipped << 28);
}
void game_chao_frame(int tile) {
  static const uint8_t PART[4] = { 0, 4, 6, 8 };
  for (int k = 0; k < 4; k++) set_tile(chao.first + k, 0xFC00, tile + PART[k]);
}
void game_chao_ball(int tile) { set_tile(chao.first + 4, 0xFC00, tile); }
void game_chao_place(int x, int y) {
  int f = chao.first, near = chao.flipped ? 8 : 0, far = chao.flipped ? 0 : 16;
  place(f, x + near, y);
  place(f + 1, x + far, y);
  place(f + 2, x + near, y + 16);
  place(f + 3, x + far, y + 16);
  place(f + 4, x + (chao.flipped ? 4 : 12), y + 0xF8);
}
