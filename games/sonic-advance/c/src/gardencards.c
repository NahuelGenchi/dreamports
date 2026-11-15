// Tiny Chao Garden's card game, which the right of the garden's two icons opens (0x020090E8 in the program Sonic
// Advance unpacks, garden.c). The board is 6 places by 5, its outer ring worth a ring a card, the ring inside it 3 and
// the two places in the middle 5, as three signs show as the game starts. Seven pairs of cards are dealt face up, and
// turn face down from the middle out. Then the Chao walks onto the board from an edge, turning now and then, and
// pushes some of the cards it walks over a place on; A while it walks left or right, once a game, has it stop and
// peek at the card it's pushing. Once it has walked off, the hand picks two cards at a time: a pair stays face up and
// pays where its cards lie, and two that differ turn back, a mistake. All seven pairs clear the board, with 30, 20 or
// 10 rings more for no mistakes, one or two; the third mistake ends the game. The rings go to the garden's count. The
// pause isn't in C yet. What it shares with the other game is in gardengames.c.

#include "gardengames.h"

enum {
  SE_MOVE = 0x0B, SE_PEEK = 0x11, SE_STEP = 0x0F, SE_RINGS = 0x18, SE_PAIR = 0x1B, SE_NO_PAIR = 0x1C, SE_PICK = 0x1D,
  MUS_GAME = 4,
};
enum { UP, DOWN, LEFT, RIGHT };   // the ways the Chao walks
#define HAND 0                     // the sprites: the hand, the two prizes a pair pays, the three signs, the Chao,
#define PRIZE 1                    // and the 14 cards
#define SIGN 3
#define CHAO 6
#define CARD 11
#define PRIZE_MATRIX 31

static int8_t board[5][6];   // the card on each place, or -1

/** 0x02008B28: card `card` turned `t` thirtieths of the way from its back (0) to its face (29); edge on at 15. */
static void turn_card(int card, int t) {
  int sprite = CARD + card;
  if (t <= 0x0E) {
    set_tile(sprite, 0x0C00, 0x506F);
    if (t == 0) { show(sprite); return; }
    MATRIX(card, 0) = (uint16_t)game_p16(0x02011BDCu + (uint32_t)((t * 128 + 15) / 30) * 2);
  } else {
    set_tile(sprite, 0x0C00, ((card >> 2) + 2) << 12 | (((card >> 1) << 4) + 0x7F));
    if (t == 0x1D) { show(sprite); return; }
    MATRIX(card, 0) = (uint16_t)game_p16(0x02011BDCu + (uint32_t)(((0x1D - t) * 128 + 15) / 30) * 2);
  }
  set_spr(sprite, (spr(sprite) & SHOWN) | 0x100 | (uint32_t)card << 25);
}

/** 0x02008C44: the 14 cards dealt face up to places by chance. */
static void deal(void) {
  memset(board, -1, sizeof board);
  for (int card = 0; card < 14; card++) {
    MATRIX(card, 0) = 0x100;
    MATRIX(card, 1) = 0;
    MATRIX(card, 2) = 0;
    MATRIX(card, 3) = 0x100;
    int row, col;
    do {
      row = ((int16_t)garden_random() >> 7) % 5;
      col = ((int16_t)garden_random() >> 7) % 6;
    } while (board[row][col] >= 0);
    board[row][col] = (int8_t)card;
    place(CARD + card, col * 32, row * 32);
    turn_card(card, 0x1D);
  }
}

// ---- the game's state ----

enum { SETS_UP, FADES_IN, SIGNS, DEALS, TURNS_DOWN, SHUFFLES, PICKS, CLEARED, LOST, LEAVES };
static struct { int8_t paused, canPause; int phase, part, t; } game;

// ---- the Chao, which walks the board from place to place, 32 frames each ----

static struct {
  int8_t col, row, moves, turnIn, anim, peek;   // its place, the places left to walk, and before it turns
  int16_t step, x, y;                           // the frames left to the next place, and where it's drawn
  int way;
} chao;
// the card it's pushing to the next place, a pixel a frame
static struct { int8_t card, left; int16_t x, y; int way; } pushed;

/** 0x02008EBC: how many places it walks before it turns: by chance, at most to the board's edge. */
static void chao_walks(void) {
  int r = (int16_t)garden_random() >> 7;
  switch (chao.way) {
    case UP: chao.turnIn = (int8_t)((chao.row * r >> 8) + 1); break;
    case DOWN: chao.turnIn = (int8_t)(((4 - chao.row) * r >> 8) + 1); break;
    case LEFT: game_chao_faces(0); chao.turnIn = (int8_t)((chao.col * r >> 8) + 1); break;
    case RIGHT: game_chao_faces(1); chao.turnIn = (int8_t)(((5 - chao.col) * r >> 8) + 1); break;
  }
}
/** 0x02009048: it turns across, more likely towards the middle. */
static void chao_turns(void) {
  int r = (int16_t)garden_random();
  if (chao.way <= DOWN) chao.way = r * 5 >= chao.col << 15 ? RIGHT : LEFT;
  else if (chao.way <= RIGHT) chao.way = r * 4 >= chao.row << 15 ? DOWN : UP;
  chao_walks();
}
/** 0x02008F50: it comes in at one of the board's 22 edge places, walks 14 more, and then off the board. */
static void chao_comes(void) {
  int r = ((int16_t)garden_random() >> 7) % 22;
  if (r <= 5) { chao.way = DOWN; chao.row = 0; chao.col = (int8_t)r; }
  else if (r <= 11) { chao.way = UP; chao.row = 4; chao.col = (int8_t)(r - 6); }
  else if (r <= 16) { chao.way = RIGHT; chao.row = (int8_t)(r - 12); chao.col = 0; }
  else { chao.way = LEFT; chao.row = (int8_t)(r - 17); chao.col = 5; }
  chao.moves = 15;
  chao.step = 0x20;
  chao.anim = 0;
  game_chao_first(CHAO);
  game_chao_ball(0x6C);
  game_chao_place(0, 0xA0);
  game_chao_faces(0);
  chao_walks();
  pushed.card = -1;
  chao.peek = 0;
}

/** On its way to a place, one time in four, it pushes the card it's on to the next place, if that's on the board and
 *  empty. */
static void chao_pushes(void) {
  int col = chao.col, row = chao.row, card = board[row][col];
  if (card < 0 || garden_random() > 0x5FFF) return;
  int toCol = col, toRow = row;
  switch (chao.way) {
    case UP: toRow--; break;
    case DOWN: toRow++; break;
    case LEFT: toCol--; break;
    case RIGHT: toCol++; break;
  }
  if ((unsigned)toRow > 4 || toCol < 0 || toCol > 5 || board[toRow][toCol] >= 0) return;
  pushed.card = (int8_t)card;
  pushed.x = (int16_t)(col * 32);
  pushed.y = (int16_t)(row * 32);
  pushed.left = 0x20;
  pushed.way = chao.way;
  board[toRow][toCol] = (int8_t)card;
  board[row][col] = -1;
}

/** It stops, looks, and peeks at the card it's pushing for 4 seconds, with its ball blinking. */
static void chao_peeks(void) {
  int t = game.t;
  switch (t) {
    case 0: gba_sound_play(SE_PEEK); game_chao_frame(0x51); break;
    case 0x14: game_chao_frame(0x5A); break;
    case 0x28: game_chao_frame(0x63); game_chao_ball(0x6D); break;
    case 0x3C: case 0x50: case 0x64: case 0x78: game_chao_ball(0x6D); break;
    case 0x32: case 0x46: case 0x5A: case 0x6E: case 0x82: game_chao_ball(0x6E); break;
    case 0x96: game_chao_frame(0x36); game_chao_ball(0x6C); break;
    case 0xBE: chao.peek = 2; break;
  }
  if (pushed.card >= 0) {
    if ((unsigned)(t - 10) <= 0x1D) turn_card(pushed.card, t - 10);
    if ((unsigned)(t - 0x96) <= 0x1D) turn_card(pushed.card, 0xB3 - t);
  }
}

// ---- the hand, which picks the cards ----

static struct { int8_t col, row, pressing; int16_t x, y; } hand;

/** 0x02008D08 and 0x02008D30: where it points at its place, a pixel left and 4 down while A is held. */
static int hand_x(void) { return hand.col * 32 + 0x14 - (hand.pressing ? 1 : 0); }
static int hand_y(void) { return (hand.row > 0 ? hand.row * 32 - 8 : 0) + (hand.pressing ? 4 : 0); }
/** 0x02008D5C: 16 pixels a frame from far, and half the way from near. */
static int slide(int at, int to) {
  int apart = at - to;
  if (apart == 0) return at;
  if ((unsigned)(apart + 4) <= 8) return to;
  if (apart > 0x20) return at - 0x10;
  if (apart < -0x20) return at + 0x10;
  return (at + to) / 2;
}
/** 0x02008DB8. */
static void hand_frame(void) {
  hand.x = (int16_t)slide(hand.x, hand_x());
  hand.y = (int16_t)slide(hand.y, hand_y());
  set_spr(HAND, (spr(HAND) & PLACE) | (uint32_t)hand.x << 16 | (uint32_t)(hand.y & 0xFF));
}
/** 0x02008E10: in the middle of the board. */
static void hand_comes(void) {
  hand.pressing = 0;
  hand.col = hand.row = 2;
  hand.x = (int16_t)hand_x();
  hand.y = (int16_t)hand_y();
  hand_frame();
  show(HAND);
}

/** 0x02008E78: the sign of mistake `n`, lit with a cross or not. */
static void mark_mistake(int n, int lit) {
  uint32_t at = 0xCC76u - (uint32_t)n * 0xC0;
  int tile = lit ? 0xC4 : 0xBB;
  for (int row = 0; row < 3; row++)
    for (int i = 0; i < 3; i++) game_vram16(at + (uint32_t)(row * 64 + i * 2), (uint16_t)(tile++ | 0x2000));
}

// the two cards picked: which, how far they've turned, their place, and what they pay
typedef struct { int8_t card, turned, col, row, prize; } Picked;
static Picked picked[2];
enum { FIRST, SECOND, TURNING, NO_PAIR, TURNS_BACK, PAIR, PRIZES_GO, PAYS, NEXT };
static int picking;
static int8_t mistakes, pairs;

/** 0x02009E2C: Up, Down, Left and Right move the hand a place, round the board's edges, and A picks the card it's on;
 *  both picked turn over, and stay up as a pair whose prizes grow and go to the rings, or turn back as a mistake. */
static void picks_frame(void) {
  switch (picking) {
    case FIRST: case SECOND: {
      uint16_t pressed = garden_pressed();
      if (pressed & KEY_UP) { if (--hand.row < 0) hand.row = 4; gba_sound_play(SE_MOVE); }
      if (pressed & KEY_DOWN) { if (++hand.row > 4) hand.row = 0; gba_sound_play(SE_MOVE); }
      if (pressed & KEY_LEFT) { if (--hand.col < 0) hand.col = 5; gba_sound_play(SE_MOVE); }
      if (pressed & KEY_RIGHT) { if (++hand.col > 5) hand.col = 0; gba_sound_play(SE_MOVE); }
      if (!(pressed & KEY_A)) break;
      int card = board[hand.row][hand.col];
      if (card < 0 || (picking == SECOND && card == picked[FIRST].card)) break;
      picked[picking] = (Picked){ .card = (int8_t)card, .col = hand.col, .row = hand.row };
      picking = picking == FIRST ? SECOND : TURNING;
      gba_sound_play(SE_PICK);
      break;
    }
    case TURNING:
      if (picked[SECOND].turned != 0x1E) break;
      hide(HAND);
      if (picked[FIRST].card >> 1 == picked[SECOND].card >> 1) {
        picking = PAIR;
        gba_sound_play(SE_PAIR);
      } else {
        picking = NO_PAIR;
        gba_sound_play(SE_NO_PAIR);
      }
      game.t = 0;
      break;
    case NO_PAIR:
      // the mistake's sign blinks, and lights
      switch (game.t) {
        case 0: hide(HAND); mark_mistake(mistakes, 1); break;
        case 0x28: case 0x50: mark_mistake(mistakes, 1); break;
        case 0x14: case 0x3C: mark_mistake(mistakes, 0); break;
      }
      if (++game.t == 0x54) {
        mistakes++;
        picking = TURNS_BACK;
      }
      break;
    case TURNS_BACK:
      if (picked[FIRST].turned != 0) break;
      if (mistakes == 3) {
        game.phase = LOST;
        game.part = game.t = 0;
      } else {
        show(HAND);
        picking = FIRST;
      }
      break;
    case PAIR:
      // the pair leaves the board, and each card's prize grows from nothing over it
      if (game.t == 0) {
        MATRIX(PRIZE_MATRIX, 0) = MATRIX(PRIZE_MATRIX, 3) = 0xFFFF;
        MATRIX(PRIZE_MATRIX, 1) = MATRIX(PRIZE_MATRIX, 2) = 0;
        for (int k = 0; k < 2; k++) {
          Picked *p = &picked[k];
          int prize = 1;
          if ((uint8_t)(p->col - 1) <= 3 && p->row > 0 && p->row <= 3) {
            prize = 3;
            if ((uint8_t)(p->col - 2) <= 1 && p->row == 2) prize = 5;
          }
          p->prize = (int8_t)prize;
          board[p->row][p->col] = -1;
          set_tile(PRIZE + k, 0xFC00, prize * 4 + 0xEB);
          set_spr(PRIZE + k, (((spr(PRIZE + k) & PLACE) | (uint32_t)(p->col * 32 + 6) << 16 | (uint32_t)(p->row * 32)) & SHOWN)
            | 0x3E000100);
        }
      } else MATRIX(PRIZE_MATRIX, 0) = MATRIX(PRIZE_MATRIX, 3) = (uint16_t)(0x1000 / game.t);
      if (++game.t == 0x11) {
        show(PRIZE);
        show(PRIZE + 1);
        game.t = 0;
        picking = PRIZES_GO;
      }
      break;
    case PRIZES_GO: {
      // the prizes fly to the rings in 21 frames
      int along = (game.t << 16) / 20;
      for (int k = 0; k < 2; k++) {
        int x = picked[k].col * 32 + 6, y = picked[k].row * 32, toX = k == 0 ? 0xDA : 0xC2;
        set_spr(PRIZE + k, (spr(PRIZE + k) & PLACE) | (uint32_t)(x + ((toX - x) * along >> 16)) << 16
          | (uint32_t)(y + ((0x10 - y) * along >> 16)));
      }
      if (++game.t == 0x15) picking = PAYS;
      break;
    }
    case PAYS:
      game_rings_win(picked[FIRST].prize + picked[SECOND].prize);
      picking = NEXT;
      gba_sound_play(SE_RINGS);
      break;
    case NEXT:
      if (++pairs == 7) {
        game.phase = CLEARED;
        game.part = 0;
      } else {
        show(HAND);
        picking = FIRST;
      }
      break;
    default: break;
  }
  // the cards picked turn over a thirtieth a frame, or back
  switch (picking) {
    case TURNING:
      if (picked[SECOND].turned <= 0x1D) { turn_card(picked[SECOND].card, picked[SECOND].turned); picked[SECOND].turned++; }
      // fallthrough
    case SECOND:
      if (picked[FIRST].turned <= 0x1D) { turn_card(picked[FIRST].card, picked[FIRST].turned); picked[FIRST].turned++; }
      break;
    case TURNS_BACK:
      for (int k = 0; k < 2; k++)
        if (--picked[k].turned >= 0) turn_card(picked[k].card, picked[k].turned);
      break;
    default: break;
  }
  hand.pressing = (int8_t)(garden_held() & KEY_A);
  hand_frame();
}

// ---- the Chao's walk ----

/** 0x0200998C: the Chao walks the board, and then off it, when the hand comes. */
static void shuffles_frame(void) {
  if (game.part == 0) {
    chao_comes();
    game.canPause = 1;
    game.part = 1;
    game.t = 0;
  }
  if (chao.peek == 1) {
    chao_peeks();
    game.t++;
    return;
  }
  chao.step--;
  if (game.part != 2) {
    if (chao.step == 0) {
      if (--chao.moves == 0) game.part = 2;
      else {
        if (--chao.turnIn == 0) chao_turns();
        switch (chao.way) {
          case UP: chao.row--; break;
          case DOWN: chao.row++; break;
          case LEFT: chao.col--; break;
          case RIGHT: chao.col++; break;
        }
        chao.step = 0x20;
      }
    }
    if (chao.step == 0x14) chao_pushes();
  } else if ((uint16_t)(chao.x + 0x1F) > 0xDE || chao.y <= -0x20 || chao.y > 0x9F) {
    game_chao_hide();
    game.phase = PICKS;
    picking = FIRST;
    hand_comes();
    mistakes = 0;
    pairs = 0;
    game.canPause = 1;
  }
  if ((chao.step & 0xF) == 0) gba_sound_play(SE_STEP);
  int x = chao.col * 32 + 4, y = chao.row * 32 + 4, frame;
  switch (chao.way) {
    case DOWN: y -= chao.step; frame = 0; break;
    case LEFT: x += chao.step; frame = 0x36; break;
    case RIGHT: x -= chao.step; frame = 0x36; break;
    default: y += chao.step; frame = 0x1B; break;
  }
  int stepAt = (chao.anim >> 3) & 3;
  game_chao_frame(frame + (stepAt == 1 ? 9 : stepAt == 3 ? 0x12 : 0));
  game_chao_place(x, y);
  chao.anim++;
  chao.x = (int16_t)x;
  chao.y = (int16_t)y;
  if (pushed.card >= 0) {
    switch (pushed.way) {
      case UP: pushed.y--; break;
      case DOWN: pushed.y++; break;
      case LEFT: pushed.x--; break;
      case RIGHT: pushed.x++; break;
    }
    place(CARD + pushed.card, pushed.x, pushed.y);
    if (--pushed.left == 0) {
      pushed.card = -1;
      game.t = 0;
    }
  }
  if ((garden_pressed() & (KEY_A | KEY_B)) && (chao.way == LEFT || chao.way == RIGHT) && chao.peek == 0) {
    chao.peek = 1;
    game.t = 0;
  }
}

// ---- the game ----

// the board's places: 4 by 4 tiles each, the outer ring's, the inner ring's or the middle's
static void board_map(void) {
  for (int by = 0; by < 5; by++)
    for (int bx = 0; bx < 6; bx++) {
      int base = 0x98;
      if ((unsigned)(by - 1) <= 2 && bx > 0 && bx <= 4) base = by == 2 && bx > 1 && bx <= 3 ? 0xAA : 0xA1;
      for (int r = 0; r < 4; r++)
        for (int c = 0; c < 4; c++)
          game_vram16(0xD800 + (uint32_t)(((by * 4 + r) * 32 + bx * 4 + c) * 2),
            (uint16_t)(game_p8(0x02011EF0u + (uint32_t)(r * 4 + c)) + base));
    }
}

// a map of 6 by 20 tiles, packed in the program, at `vramAddress`
static void panel_map(uint32_t from, uint32_t vramAddress) {
  uint16_t map[6 * 20];
  garden_unpack_halfwords(from, map, 6 * 20);
  for (int row = 0; row < 20; row++)
    for (int i = 0; i < 6; i++) game_vram16(vramAddress - 0x06000000u + (uint32_t)(row * 64 + i * 2), map[row * 6 + i]);
}

// the screen's pictures: its colours, tiles and maps, the labels in the game's language, the panel on the right, the
// sprites' colours and tiles, and the sprites themselves, as OAM holds them
static void pictures(void) {
  gba_write(REG_DISPCNT, 0x1E40);
  for (uint32_t i = 0; i < 0x2000; i += 2) game_vram16(0xC000 + i, 0);
  gba_write(REG_BLDY, 0x10);
  gba_write(REG_BLDCNT, 0xBF);
  garden_unpack_halfwords(0x0200FE38u, gba_pal, 256);
  garden_unpack_vram(0x0200E988u, 0x06000000u);
  garden_unpack_vram(0x0200FF30u, 0x06001300u);
  garden_unpack_vram(garden_language() ? 0x0200F5A8u : 0x0200F428u, 0x06000F00u);
  garden_unpack_vram(garden_language() ? 0x020102F0u : 0x02010130u, 0x060019A0u);
  gba_write(REG_BG3CNT, 0x1B03);
  gba_write(REG_BG0HOFS + 12, 0);
  gba_write(REG_BG0HOFS + 14, 0);
  board_map();
  gba_write(REG_BG2CNT, 0x1A02);
  gba_write(REG_BG0HOFS + 8, 0);
  gba_write(REG_BG0HOFS + 10, 0);
  panel_map(0x020104E8u, 0x0600D030u);
  gba_write(REG_BG1CNT, 0x1901);
  gba_write(REG_BG0HOFS + 4, 0);
  gba_write(REG_BG0HOFS + 6, 0);
  panel_map(0x02010558u, 0x0600C830u);
  garden_unpack_halfwords(0x020105B8u, gba_pal + 256 + 32, 224);
  garden_unpack_vram(0x0200F700u, 0x06010000u);
  garden_unpack_vram(0x02010654u, 0x06010DE0u);
  for (int i = 0; i < 512; i++) gba_oam[i] = 0x2A0;
  garden_unpack_halfwords(0x02010E4Cu, gba_oam, 512);
}

/** 0x020090C0: the rings won go to the garden's count, and the garden comes back. */
static void back_to_garden(void) {
  game_rings_bank();
  game.paused = 0;
  game.phase = SETS_UP;
  garden_run(garden_back);
}

// a sign comes up, at x 80 and `y`, and its places' colours flash twice over 48 frames
static void sign_comes(int sprite, int y) {
  set_spr(sprite, ((spr(sprite) & PLACE) | 0x500000 | (uint32_t)y) & SHOWN);
  game.t = 0;
  game.part++;
}
static void sign_flashes(int colour, const uint16_t lit[3], const uint16_t dim[3]) {
  int t = game.t++;
  const uint16_t *set = t == 7 || t == 23 ? lit : t == 15 || t == 31 ? dim : 0;
  if (set) for (int i = 0; i < 3; i++) gba_pal[colour + i] = set[i];
  if (t == 47) game.part++;
}

/** 0x020090E8: a frame of the game. */
void garden_cards(void) {
  if (game.paused) { garden_not_in_c(); return; }
  switch (game.phase) {
    case SETS_UP:
      pictures();
      game_rings_start();
      game_show_start(SHOW_FADE_IN);
      game.phase = FADES_IN;
      game.canPause = 0;
      gba_sound_play(MUS_GAME);
      // unpacking its pictures takes the console 2 frames more, one of them without the sound routine
      garden_lag(2);
      gba_sound_missed(1);
      break;
    case FADES_IN:
      if (game_show_frame()) {
        game.canPause = 1;
        game.phase = SIGNS;
        game.part = game.t = 0;
      }
      break;
    case SIGNS: {
      // what each ring of the board pays: +1, +3 and +5 come up over it in turn
      static const uint16_t LIT[3][3] = { { 0x7E07, 0x7EAF, 0x7F59 }, { 0x5439, 0x6CBF, 0x7E3F }, { 0x1016, 0x001B, 0x21FD } };
      static const uint16_t DIM[3][3] = { { 0x7E8D, 0x7F35, 0x7FDD }, { 0x5CBD, 0x71BF, 0x7EDF }, { 0x1018, 0x001E, 0x467E } };
      int sign = game.part / 2;
      if (game.part % 2 == 0) sign_comes(SIGN + sign, sign * 0x20);
      else {
        sign_flashes(2 + sign * 3, LIT[sign], DIM[sign]);
        if (game.part == 6) {
          for (int i = 0; i < 3; i++) hide(SIGN + i);
          game.phase = DEALS;
        }
      }
      break;
    }
    case DEALS:
      deal();
      game.phase = TURNS_DOWN;
      game.canPause = 0;
      game.part = 0;
      break;
    case TURNS_DOWN:
      // after a second, the middle's cards turn face down, then the inner ring's a second later, then the outer's
      if (game.part == 1 || game.part == 3 || game.part == 5) {
        static const struct { uint32_t at; int count; } RING[3] = { { 0x02011F70u, 2 }, { 0x02011F48u, 10 }, { 0x02011F00u, 18 } };
        int ring = game.part / 2, t = 0x1D - game.t;
        for (int i = 0; i < RING[ring].count; i++) {
          uint32_t at = RING[ring].at + (uint32_t)i * 4;
          int card = board[(int8_t)game_p8(at + 1)][(int8_t)game_p8(at)];
          if (card >= 0) turn_card(card, t);
        }
        if (++game.t == 0x1E) {
          game.t = 0;
          if (++game.part == 6) {
            game.phase = SHUFFLES;
            game.part = 0;
          }
        }
      } else if (++game.t == 0x3C) {
        game.t = 0;
        game.part++;
      }
      break;
    case SHUFFLES: shuffles_frame(); break;
    case PICKS: picks_frame(); break;
    case CLEARED:
      // CLEAR! falls in, and each mistake not made lights its sign for 10 rings more
      if (game.part == 0) {
        game.part = 1;
        game.canPause = 0;
        game_show_start(SHOW_CLEARED);
      }
      if (game.part == 1) {
        if (game_show_frame()) {
          game.part = mistakes + 2;
          game.t = 0;
        }
      } else if (game.part <= 4) {
        if (game.t == 0) {
          gba_sound_play(SE_RINGS);
          mark_mistake(game.part - 2, 1);
          game_rings_win_now(game.part == 2 ? 30 : game.part == 3 ? 20 : 10);
        }
        if (game.t++ == 0x28) {
          game.t = 0;
          game.part++;
        }
      } else if (game.part == 5) {
        game_show_start(SHOW_WAIT);
        game.phase = LEAVES;
      }
      break;
    case LOST: {
      // GAME OVER, while the cards left blink face up
      if (game.part == 0) {
        game.part = 1;
        game_show_start(SHOW_GAME_OVER);
        game.canPause = 0;
      }
      if (++game.t == 0x3A) game.t = 0;
      int t = game.t <= 0x1C ? game.t : 0x3A - game.t;
      for (int row = 0; row < 5; row++)
        for (int col = 0; col < 6; col++)
          if (board[row][col] >= 0) turn_card(board[row][col], t);
      if (game_show_frame()) { back_to_garden(); return; }
      break;
    }
    case LEAVES:
      if (game_show_frame()) { back_to_garden(); return; }
      break;
    default: break;
  }
  if (game.canPause && (garden_pressed() & KEY_START)) { garden_not_in_c(); return; }
  game_rings_roll();
}
