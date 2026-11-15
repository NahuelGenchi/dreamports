// Tiny Chao Garden's rock-paper-scissors game, which the left of the garden's two icons opens (0x0200B4E0 in the
// program Sonic Advance unpacks, garden.c). Ten hands go round a belt, the Chao walking about inside it. The player
// has three hands at the bottom and five more in stock: Left and Right choose one and A throws it up the screen. A
// hand it beats on the belt flies off for rings, 1 a hand in the first round, and one it draws with knocks it away;
// either way the next hand comes from the stock and turns over. The game is over when the 30 seconds run out, or with
// fewer than three hands left, and the rings go to the garden's count. The pause, a lost throw, a round cleared, and
// the game's other end aren't in C yet. What it shares with the other game is in gardengames.c.

#include "gardengames.h"

enum { SE_THROW = 0x1D, SE_WIN = 0x0C, SE_DRAW = 0x0D, SE_RINGS = 0x18, SE_TIME_LOW = 0x1F, MUS_GAME = 4 };

// ---- the Chao in the middle, sprites 0 to 4, which walks to places it picks, and stands between ----

static struct { int16_t x; uint16_t wait; int8_t doing; } chao;
enum { WALKS_LEFT, WALKS_RIGHT, STANDS };
/** 0x0200A4E4. */
static void chao_start(void) {
  chao.x = 0x50;
  chao.wait = 60;
  chao.doing = STANDS;
  game_chao_first(0);
  game_chao_ball(0x6C);
  game_chao_frame(0);
  game_chao_faces(0);
  game_chao_place(0x50, 0x2F);
}
/** 0x0200A528: it walks a pixel a frame, its steps 8 frames each; when it has got there, or stood its time, one time in
 *  three it walks to somewhere else along the middle, and otherwise stands one of four ways, for 1 to 4 seconds. */
static void chao_frame_step(void) {
  if (chao.doing <= WALKS_RIGHT) {
    chao.x = (int16_t)(chao.doing == WALKS_LEFT ? chao.x - 1 : chao.x + 1);
    game_chao_place(chao.x, 0x2F);
    int step = ((int16_t)chao.wait >> 3) & 3;
    game_chao_frame(step == 1 ? 0x3F : step == 3 ? 0x48 : 0x36);
  }
  if (--chao.wait) return;
  chao.doing = (int8_t)(garden_random() / 0x1556);
  switch (chao.doing) {
    case 0: case 1: {
      int to;
      do to = garden_random() / 0x1C8 + 0x2C; while (to == chao.x);
      if (to < chao.x) {
        chao.doing = WALKS_LEFT;
        chao.wait = (uint16_t)(chao.x - to);
        game_chao_faces(0);
      } else {
        chao.doing = WALKS_RIGHT;
        chao.wait = (uint16_t)(to - chao.x);
        game_chao_faces(1);
      }
      break;
    }
    case 2: game_chao_frame(0); chao.wait = (uint16_t)(garden_random() / 0xB6 + 60); break;
    case 3: game_chao_frame(0x1B); chao.wait = (uint16_t)(garden_random() / 0xB6 + 60); break;
    case 4: game_chao_frame(0x36); chao.wait = (uint16_t)(garden_random() / 0xB6 + 60); break;
    case 5: game_chao_faces(1); game_chao_frame(0x36); chao.wait = (uint16_t)(garden_random() / 0xB6 + 60); break;
  }
  game_chao_place(chao.x, 0x2F);
}

// ---- the two signs that flash: the time's when it runs low, and the stock's when it's empty ----

typedef struct { int8_t row, from, period, lit, tick; } Lamp;
static Lamp timeLamp, stockLamp;
/** 0x0200A6E0: lit for the end of each period, by the colours of its 6 by 5 tiles of the map. */
static void lamp(Lamp *l) {
  if (++l->tick >= l->period) l->tick = 0;
  int lit = l->tick >= l->from;
  if (l->lit == lit) return;
  l->lit = (int8_t)lit;
  for (int r = 0; r < 5; r++)
    for (int c = 0; c < 6; c++) {
      uint32_t at = 0xD82Eu + (uint32_t)((l->row + r) * 64 + c * 2);
      game_vram16(at, (uint16_t)((game_vram16_at(at) & 0x0FFF) | (lit ? 8 : 1) << 12));
    }
}

// ---- the clock: seconds, and sixtieths rolling its digits ----

static struct { int8_t seconds, frames, heard; } clock_;
/** 0x0200A728. */
static void draw_clock(void) {
  int step = clock_.frames, seconds = clock_.seconds;
  if (step > 11) { step = 0; seconds++; }
  game_roll_digit(0x9E, seconds / 10, seconds % 10 == 9 ? step : 0);
  game_roll_digit(0x9C, seconds % 10, step);
}
/** 0x0200A77C. */
static void set_clock(int seconds) {
  clock_.seconds = (int8_t)seconds;
  clock_.frames = 0;
  draw_clock();
}
/** 0x0200A7C0: a frame off the clock; returns 1 with none left. */
static int tick_clock(void) {
  int out = 0;
  if (--clock_.frames < 0) {
    clock_.frames = 59;
    if (--clock_.seconds < 0) {
      clock_.frames = clock_.seconds = 0;
      out = 1;
    }
  }
  draw_clock();
  return out;
}

// ---- the belt: ten hands going round, sprites 9 to 18 ----

enum { ON_BELT = 0, BEATEN = 2, WON = 3, GONE = 4 };
typedef struct { int8_t state, count, kind; int16_t along, x, y; int8_t vx, vy; } BeltHand;
static BeltHand belt[10];
static struct { int8_t round, speed, left, unbeaten; } beltState;
#define BELT_SPRITE 9

/** 0x0200A800: a new round: ten hands, each rock, paper or scissors by chance, coming on 32 apart; the first round
 *  starts the clock at 30 seconds. */
static void new_round(void) {
  beltState.round++;
  beltState.left = beltState.unbeaten = 10;
  for (int i = 0; i < 10; i++) {
    BeltHand *h = &belt[i];
    h->state = ON_BELT;
    h->along = (int16_t)(-(i * 32) - beltState.speed);
    h->kind = (int8_t)(garden_random() / 0x2AAB);
    uint32_t look = 0x02011F78u + (uint32_t)h->kind * 4;
    set_tile(BELT_SPRITE + i, 0x0C00, (int)(game_p8(look) << 12 | game_p8(look + 1)));
    gba_oam[(BELT_SPRITE + i) * 4 + 2] = (uint16_t)((gba_oam[(BELT_SPRITE + i) * 4 + 2] & 0xF3FF) | 0x800);
    hide(BELT_SPRITE + i);
  }
  if (beltState.round == 0) set_clock(30);
  else garden_not_in_c();
}
/** 0x0200A8C8. */
static void belt_start(void) {
  beltState.round = -1;
  beltState.speed = 2;
  new_round();
}

// a beaten or thrown hand flies its way until it's off the screen
static void fly(int sprite, int16_t *x, int16_t *y, int vx, int vy) {
  if ((unsigned)(*x + 0x20) > 0x10F || *y < -0x20 || *y > 0x9F) return;
  *x = (int16_t)(*x + vx);
  *y = (int16_t)(*y + vy);
  place(sprite, *x, *y);
}

/** 0x0200A8EC: the belt goes round, each hand along its four sides, and a beaten one flies off, in front of the rest,
 *  for half a second, and then pays: a ring, and one more for every two rounds. The belt goes twice as fast with one
 *  hand left. */
static void belt_frame(void) {
  for (int i = 0; i < 10; i++) {
    BeltHand *h = &belt[i];
    int sprite = BELT_SPRITE + i, count = h->count++;
    switch (h->state) {
      case BEATEN:
        if (count == 0) set_tile(sprite, 0xF3FF, 0x400);
        if (count > 0x1D) {
          set_tile(sprite, 0xF3FF, 0x800);
          hide(sprite);
          h->state = GONE;
          beltState.left--;
          game_rings_win(beltState.round / 2 + 1);
          gba_sound_play(SE_RINGS);
        }
        fly(sprite, &h->x, &h->y, h->vx, h->vy);
        break;
      case WON: garden_not_in_c(); return;
      case GONE: break;
      default:
        if (h->along < 0 && h->along + beltState.speed >= 0) {
          gba_sound_play(SE_THROW);
          show(sprite);
        }
        h->along = (int16_t)(h->along + beltState.speed);
        if (h->along < 0) { hide(sprite); break; }
        if (h->along > 0x188) h->along -= 0x188;
        if (h->along <= 0x3F) { h->x = 0x0A; h->y = (int16_t)(h->along + 8); }
        else if (h->along <= 0xC3) { h->x = (int16_t)(h->along - 0x36); h->y = 0x48; }
        else if (h->along <= 0x103) { h->x = 0x8E; h->y = (int16_t)(0x10C - h->along); }
        else { h->x = (int16_t)(0x192 - h->along); h->y = 8; }
        set_spr(sprite, (spr(sprite) & PLACE) | (uint32_t)h->x << 16 | (uint32_t)h->y);
        break;
    }
  }
  if (beltState.left == 0) new_round();
  beltState.speed = beltState.unbeaten > 1 ? 2 : 4;
}

// ---- the stock: how many hands are left to throw, its digit rolling down ----

static struct { int8_t left, shown, step, tick; } stock;
/** 0x0200AB54. */
static void draw_stock(void) { game_roll_digit(0x98, stock.shown % 10, stock.step); }
/** 0x0200AB84. */
static void roll_stock(void) {
  if (stock.shown == stock.left && stock.step == 0) return;
  if (++stock.tick != 2) return;
  stock.tick = 0;
  if (--stock.step < 0) {
    stock.step = 11;
    stock.shown--;
  }
  draw_stock();
}

// ---- the player's three hands, sprites 5 to 7, each with a matrix of its own to shrink, grow and turn over by ----

enum { READY = 0, THROWN = 1, BEAT_ONE = 2, TURNS_AWAY = 3, SHRINKS = 4, BOUNCES = 5, NEXT_COMES = 7, TURNS_OVER = 8, NO_MORE = 9 };
typedef struct { int8_t state, count, kind; int16_t x, y; int8_t vx, vy; } MyHand;
static MyHand mine[3];
#define MY_SPRITE 5
#define HAND_BACK 0x30AF   // a hand face down, as the stock's are

// what a hand looks like: its colours and its tile
static int hand_look(int kind) { return (int)(game_p8(0x02011FB4u + (uint32_t)kind * 4) << 12 | game_p8(0x02011FB6u - 1 + (uint32_t)kind * 4)); }
// how wide a hand turning over is, a twentieth of the way at a time (0x02011BDC)
static uint16_t turn(int twentieths) { return (uint16_t)game_p16(0x02011BDCu + (uint32_t)((twentieths * 128 + 10) / 20) * 2); }

/** 0x0200ABE8: three hands by chance, 64 apart along the bottom, and five in stock. */
static void hands_start(void) {
  for (int k = 0; k < 3; k++) {
    MyHand *t = &mine[k];
    t->state = READY;
    t->y = 0x74;
    t->kind = (int8_t)(garden_random() / 0x2AAB);
    set_spr(MY_SPRITE + k, (spr(MY_SPRITE + k) & PLACE) | (uint32_t)(0x0C + k * 64) << 16 | 0x74);
    set_tile(MY_SPRITE + k, 0x0C00, hand_look(t->kind));
    show(MY_SPRITE + k);
    MATRIX(k, 0) = 0x100;
    MATRIX(k, 1) = 0;
    MATRIX(k, 2) = 0;
    MATRIX(k, 3) = 0x100;
  }
  stock.left = stock.shown = 5;
  stock.step = stock.tick = 0;
  draw_stock();
}

/** 0x02007FB4: the cosine of `angle` of 65,536 to the turn, to 14 bits, from the program's quarter of a table. */
static int cosine14(int angle) {
  int i = ((angle << 7) + 0x4000) / 0x8000 & 0xFF;
  if (i <= 0x3F) return (int16_t)game_p16(0x02011C5Eu + (uint32_t)i * 2);
  if (i <= 0x7F) return (int16_t)-(int)game_p16(0x02011C5Eu + (uint32_t)(i ^ 0x7F) * 2);
  if (i <= 0xBF) return (int16_t)-(int)game_p16(0x02011C5Eu + (uint32_t)(i ^ 0x80) * 2);
  return (int16_t)game_p16(0x02011C5Eu + (uint32_t)(i ^ 0xFF) * 2);
}
// a speed of 8 pixels a frame along `angle`, its two parts
static int speed_part(int angle) {
  int v = cosine14(angle & 0xFFFF);
  if (v < 0) v += 0x7FF;
  return v >> 11;
}

// the BIOS's ArcTan and ArcTan2, as the console works them out
static int arctan(int i) {
  int a = -(i * i >> 14), b = (0xA9 * a >> 14) + 0x390;
  b = (b * a >> 14) + 0x91C;
  b = (b * a >> 14) + 0xFB6;
  b = (b * a >> 14) + 0x16AA;
  b = (b * a >> 14) + 0x2081;
  b = (b * a >> 14) + 0x3651;
  b = (b * a >> 14) + 0xA2F9;
  return i * b >> 16;
}
static int arctan2(int x, int y) {
  if (!y) return x >= 0 ? 0 : 0x8000;
  if (!x) return y >= 0 ? 0x4000 : 0xC000;
  if (y >= 0) {
    if (x >= 0) { if (x >= y) return arctan((y << 14) / x); }
    else if (-x >= y) return arctan((y << 14) / x) + 0x8000;
    return 0x4000 - arctan((x << 14) / y);
  }
  if (x <= 0) { if (-x > -y) return arctan((y << 14) / x) + 0x8000; }
  else if (x >= -y) return arctan((y << 14) / x) + 0x10000;
  return 0xC000 - arctan((x << 14) / y);
}

// a thrown hand has left the screen: one fewer in stock, and the next comes, or with too few left there's no more
static void spent(MyHand *t, int sprite) {
  if (--stock.left > 2) t->state = NEXT_COMES;
  else {
    t->state = NO_MORE;
    hide(sprite);
  }
  t->count = 0;
}

/** 0x0200ACCC: the player's hands. A thrown one goes up 4 pixels a frame until it meets a hand on the belt: one it beats
 *  flies off the way it was hit, one it draws with knocks it off the other way, and one that beats it isn't in C yet.
 *  Then, or once it's off the top, the next comes from the stock, growing as it slides to its place, and turns over:
 *  a kind by chance, or, one time in four, the kind that beats a hand on the belt. */
static void hands_frame(void) {
  for (int k = 0; k < 3; k++) {
    MyHand *t = &mine[k];
    int sprite = MY_SPRITE + k, count = t->count++, home = k * 64 + 0x0C;
    switch (t->state) {
      case THROWN:
        t->y -= 4;
        gba_oam[sprite * 4] = (uint16_t)((gba_oam[sprite * 4] & 0xFF00) | (t->y & 0xFF));
        if (t->y < -0x20) { spent(t, sprite); break; }
        for (int i = 0; i < 10; i++) {
          BeltHand *h = &belt[i];
          if (h->state != ON_BELT || h->along < 0) continue;
          int dy = h->y - t->y, dx = h->x - home;
          if ((unsigned)(dy + 0x19) > 0x2E) continue;
          int reach = (int8_t)game_p8(0x02011F84u + (uint32_t)(dy + 0x19));
          if (dx < -reach || dx >= reach) continue;
          int by = t->kind + 2 - h->kind;
          if (by == 0 || by == 3) {
            int angle = arctan2(dx, dy) ^ 0x8000;
            t->state = BOUNCES;
            t->vx = (int8_t)speed_part(angle);
            t->vy = (int8_t)speed_part(angle + 0xC000);
            t->x = (int16_t)home;
            gba_sound_play(SE_DRAW);
          } else if (by == 1 || by == 4) {
            int angle = arctan2(dx, dy);
            t->state = BEAT_ONE;
            h->state = BEATEN;
            beltState.unbeaten--;
            h->vx = (int8_t)speed_part(angle);
            h->vy = (int8_t)speed_part(angle + 0xC000);
            gba_sound_play(SE_WIN);
          } else {
            garden_not_in_c();
            return;
          }
          t->count = 0;
          h->count = 0;
          break;
        }
        break;
      case BEAT_ONE:
        if (count == 0x1E) { t->count = 0; t->state = TURNS_AWAY; }
        break;
      case TURNS_AWAY:
        // edge on, then its back, and then it shrinks away
        if (count <= 9) {
          if (count == 0) set_spr(sprite, (spr(sprite) & SHOWN) | 0x100 | (uint32_t)k << 25);
          MATRIX(k, 0) = turn(count);
        } else if (count <= 0x13) {
          if (count == 10) set_tile(sprite, 0x0C00, HAND_BACK);
          MATRIX(k, 0) = turn(0x13 - count);
        } else {
          t->state = SHRINKS;
          t->count = 0;
        }
        break;
      case SHRINKS: {
        int size = 0x10000 / (0x100 - count * 128 / 20), left = 0x14 - count;
        MATRIX(k, 0) = MATRIX(k, 3) = (uint16_t)size;
        set_spr(sprite, (spr(sprite) & PLACE) | (uint32_t)((k * 64 - 0xAB) * left / 20 + 0xB7) << 16
          | (uint32_t)(((t->y - 0x79) * left / 20 + 0x79) & 0xFF));
        if (count == 0x14) { t->count = 0; t->state = NEXT_COMES; }
        break;
      }
      case BOUNCES:
        fly(sprite, &t->x, &t->y, t->vx, t->vy);
        if (count == 0x1E) spent(t, sprite);
        break;
      case NEXT_COMES: {
        if (count == 0) {
          set_tile(sprite, 0x0C00, HAND_BACK);
          set_spr(sprite, (spr(sprite) & SHOWN) | 0x100 | (uint32_t)k << 25);
        }
        int size = 0x10000 / (count * 128 / 20 + 0x80);
        MATRIX(k, 0) = MATRIX(k, 3) = (uint16_t)size;
        set_spr(sprite, (spr(sprite) & PLACE) | (uint32_t)((k * 64 - 0xAB) * count / 20 + 0xB7) << 16
          | (uint32_t)(-(count * 5) / 20 + 0x79));
        if (count == 0x14) { t->count = 0; t->state = TURNS_OVER; }
        break;
      }
      case TURNS_OVER:
        if (count <= 9) MATRIX(k, 0) = turn(count);
        else if (count <= 0x13) {
          if (count == 10) {
            int kind = garden_random() / 0x2AAB;
            if (garden_random() <= 0x1FFF) {
              int8_t on[10];
              int n = 0;
              for (int i = 0; i < 10; i++) if (belt[i].state == ON_BELT) on[n++] = (int8_t)i;
              if (n > 0) {
                int beats = belt[on[garden_random() / ((n + 0x7FFE) / n)]].kind;
                kind = beats + 2 > 2 ? beats - 1 : beats + 2;
              }
            }
            t->kind = (int8_t)kind;
            set_tile(sprite, 0x0C00, hand_look(kind));
          }
          MATRIX(k, 0) = turn(0x13 - count);
        } else {
          t->state = READY;
          t->y = 0x74;
          show(sprite);
        }
        break;
      default: break;
    }
  }
}

// ---- the cursor, sprite 8, under the hand that A throws ----

static struct { int8_t on; uint8_t x; } cursor;
/** 0x0200B3B4. */
static void cursor_start(void) {
  cursor.on = 1;
  cursor.x = 0x4C;
  set_spr(8, ((spr(8) & PLACE) | 0x004C0074) & SHOWN);
}
/** 0x0200B3EC: Left and Right move it a hand, sliding 16 pixels a frame and then half the way left; A throws the hand
 *  it's under, if that one is ready. */
static void cursor_frame(void) {
  uint16_t pressed = garden_pressed();
  int on = cursor.on;
  if ((pressed & KEY_LEFT) && on > 0) on--;
  if ((pressed & KEY_RIGHT) && on <= 1) on++;
  cursor.on = (int8_t)on;
  int to = on * 64 + 0x0C, apart = cursor.x - to, x = cursor.x;
  if (apart) {
    if ((unsigned)(apart + 2) <= 4) x = to;
    else if (apart > 0x20) x -= 0x10;
    else if (apart < -0x20) x += 0x10;
    else x = (x + to) / 2;
  }
  cursor.x = (uint8_t)x;
  gba_oam[8 * 4 + 1] = (uint16_t)((gba_oam[8 * 4 + 1] & 0xFE00) | cursor.x);
  if ((pressed & KEY_A) && mine[on].state == READY) {
    mine[on].state = THROWN;
    gba_sound_play(SE_THROW);
  }
}

// ---- the game ----

enum { SETS_UP, FADES_IN, PLAYS, ENDS, IDLE, LEAVES };
static struct { int8_t paused, canPause; int phase; } game;

// the screen's pictures: its colours, tiles and maps, the labels in the game's language, the sprites' colours and tiles,
// and the sprites themselves, as OAM holds them
static void pictures(void) {
  gba_write(REG_DISPCNT, 0x1C40);
  for (uint32_t i = 0; i < 0x2000; i += 2) game_vram16(0xC000 + i, 0);
  gba_write(REG_BLDY, 0x10);
  gba_write(REG_BLDCNT, 0xBF);
  garden_unpack_halfwords(0x02010E94u, gba_pal, 256);
  garden_unpack_vram(0x0200E988u, 0x06000000u);
  garden_unpack_vram(0x02010FA4u, 0x06001300u);
  garden_unpack_vram(garden_language() ? 0x0200F5A8u : 0x0200F428u, 0x06000F00u);
  garden_unpack_vram(garden_language() ? 0x020112F8u : 0x020111ECu, 0x060019A0u);
  gba_write(REG_BG3CNT, 0x1B03);
  gba_write(REG_BG0HOFS + 12, 0);
  gba_write(REG_BG0HOFS + 14, 0);
  garden_unpack_vram(0x02011424u, 0x0600D800u);
  gba_write(REG_BG2CNT, 0x1A02);
  gba_write(REG_BG0HOFS + 8, 0);
  gba_write(REG_BG0HOFS + 10, 0);
  // the three signs' icons on the second layer: each two tiles square, and the two digits beside it
  static const struct { uint16_t at, icon, digits; int count; } SIGNS[3] = {
    { 0xD0F0, 0x7005, 0x2001, 4 }, { 0xD270, 0x10C9, 0x209C, 4 }, { 0xD430, 0x10C5, 0x2098, 2 },
  };
  for (int i = 0; i < 3; i++) {
    uint32_t at = SIGNS[i].at;
    game_vram16(at, SIGNS[i].icon);
    game_vram16(at + 2, (uint16_t)(SIGNS[i].icon + 1));
    game_vram16(at + 0x40, (uint16_t)(SIGNS[i].icon + 2));
    game_vram16(at + 0x42, (uint16_t)(SIGNS[i].icon + 3));
    game_vram16(at + 6, SIGNS[i].digits);
    game_vram16(at + 0x46, (uint16_t)(SIGNS[i].digits + 1));
    if (SIGNS[i].count == 4) {
      game_vram16(at + 4, (uint16_t)(SIGNS[i].digits + 2));
      game_vram16(at + 0x44, (uint16_t)(SIGNS[i].digits + 3));
    }
  }
  garden_unpack_halfwords(0x02011578u, gba_pal + 256 + 16, 240);
  garden_unpack_vram(0x0200F700u, 0x06010000u);
  garden_unpack_vram(0x020115E0u, 0x06010DE0u);
  for (int i = 0; i < 512; i++) gba_oam[i] = 0x2A0;
  garden_unpack_halfwords(0x02011BACu, gba_oam, 512);
}

/** 0x0200B4B8: the rings won go to the garden's count, and the garden comes back. */
static void back_to_garden(void) {
  game_rings_bank();
  game.paused = 0;
  game.phase = SETS_UP;
  garden_run(garden_back);
}

/** 0x0200B4E0: a frame of the game. */
void garden_rps(void) {
  if (game.paused) { garden_not_in_c(); return; }
  switch (game.phase) {
    case SETS_UP:
      pictures();
      game.phase = FADES_IN;
      game.canPause = 0;
      timeLamp = (Lamp){ .row = 7 };
      stockLamp = (Lamp){ .row = 14 };
      game_rings_start();
      game_show_start(SHOW_FADE_IN);
      chao_start();
      belt_start();
      hands_start();
      cursor_start();
      gba_sound_play(MUS_GAME);
      garden_lag(1);
      break;
    case FADES_IN:
      if (game_show_frame()) {
        game.canPause = 1;
        game.phase = PLAYS;
      }
      break;
    case PLAYS:
      chao_frame_step();
      belt_frame();
      hands_frame();
      cursor_frame();
      // over with no hand left to throw, or out of time with something still on the belt
      if (stock.left == 0 || (tick_clock() && beltState.unbeaten > 0)) game.phase = ENDS;
      break;
    case ENDS:
      game_show_start(SHOW_GAME_OVER);
      game.phase = LEAVES;
      game.canPause = 0;
      // fallthrough
    case LEAVES:
      belt_frame();
      if (game_show_frame()) { back_to_garden(); return; }
      break;
    default: break;
  }
  if (game.canPause && (garden_pressed() & KEY_START)) { garden_not_in_c(); return; }
  game_rings_roll();
  roll_stock();
  if (clock_.heard != clock_.seconds) {
    clock_.heard = clock_.seconds;
    if (clock_.seconds <= 2) gba_sound_play(SE_TIME_LOW);
  }
  if (clock_.seconds == 0 && clock_.frames == 0) { timeLamp.from = 6; timeLamp.period = 12; }
  else if (clock_.seconds <= 2) { timeLamp.from = 15; timeLamp.period = 30; }
  else timeLamp.from = timeLamp.period = 1;
  lamp(&timeLamp);
  if (stock.left == 0) { stockLamp.from = 6; stockLamp.period = 12; }
  else stockLamp.from = stockLamp.period = 1;
  lamp(&stockLamp);
}
