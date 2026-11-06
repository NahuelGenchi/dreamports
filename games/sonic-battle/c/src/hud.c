// hud.js in C: the fight's HUD and the choice of special attacks, rewritten from the original's instructions. A mode
// byte says which screen of the fight's frame is showing: 10 to 12 the choice of the three specials, 20 and 40 banners
// that slide across, 30 the bars, timer and scores of the fight itself, 50 a blinking line, and 60 the question after a
// fight. 0x08012b98 starts a mode and 0x08013214 draws it once a frame, as sprites queued for the next V-blank.

#include "game.h"

#define HUD 0x030030D0u
#define MODE 0
#define CHOICE 1
#define BOUNCE 2
#define STEP 3
#define TIMER 4
#define PICKS 6
#define TAKEN 9
#define X1 12
#define X2 14
#define X3 16
#define Y1 18
#define Y2 20
#define Y3 22
#define X1_GOAL 24
#define X2_GOAL 26
#define X3_GOAL 28
#define Y1_GOAL 30
#define Y2_GOAL 32
#define Y3_GOAL 34

#define STARTED 0x03002CC0u
#define FIGHT 0x03001620u
#define LANGUAGE (SAVE + 119)
#define RECORDS 0x03001C40u
#define RECORD_SIZE 252
#define PLAYER_ 0x03001380u
#define RINGS 0x03001B30u
#define RING_SIZE 64
#define RING_KEYS 20
#define RING_AT 60
#define PUSH_X 0x03003100u
#define PUSH_Y 0x03003118u
#define SPRITE_QUEUE 0x030033E0u
#define SPRITE_COUNT 0x030017CCu

#define SINE_ 0x0804DF7Cu
#define PALETTE_14 0x050003C0u
#define PALETTE_15 0x050003E0u
#define KEY_A 0x1
#define KEY_B 0x2
#define KEY_START 0x8
#define KEY_RIGHT 0x10
#define KEY_LEFT 0x20
#define KEY_UP 0x40
#define KEY_DOWN 0x80
#define SOUND_MOVE 600
#define SOUND_YES 601
#define SOUND_BACK 602
#define SOUND_DONE 603
#define SOUND_BANNER 46

static inline uint8_t byte(int at) { return read8(HUD + (uint32_t)at); }
static inline void setByte(int at, uint8_t value) { write8(HUD + (uint32_t)at, value); }
static inline uint16_t half(int at) { return read16(HUD + (uint32_t)at); }
static inline int16_t shalf(int at) { return reads16(HUD + (uint32_t)at); }
static inline void setHalf(int at, uint16_t value) { write16(HUD + (uint32_t)at, value); }

static int32_t sdiv(int32_t n, int32_t d) { return d == 0 ? 0 : n / d; }
static int32_t smod(int32_t n, int32_t d) { return d == 0 ? 0 : n % d; }
static uint32_t udiv(uint32_t n, uint32_t d) { return d == 0 ? 0 : n / d; }
static uint32_t umod(uint32_t n, uint32_t d) { return d == 0 ? 0 : n % d; }

static uint32_t record(void) { return RECORDS + read32(PLAYER_) * RECORD_SIZE; }
static uint16_t vblanks(void) { return (uint16_t)g.vblanks; }

static void fastCopy(uint32_t from, uint32_t to, uint32_t words) { copy32(from, to, words); }
static void playSound(int sound) { gba_sound_play(sound); }

static uint16_t ringKeys(void) {
  uint32_t base = read32(PLAYER_) * RING_SIZE;
  uint8_t at = read8(RINGS + base + RING_AT);
  return read16(RINGS + RING_KEYS + base + (uint32_t)at * 2);
}

static void ease(int at, int goal, int shift) {
  int16_t now = shalf(at), to = shalf(goal);
  if (now != to) setHalf(at, (uint16_t)(half(at) - ((now - to) >> shift)));
}

void queueHudSprite(int x, int y, int third, int tile, int palette, int sixth, int shape, int eighth, int ninth) {
  g.cycles += 327;
  uint8_t count = read8(SPRITE_COUNT);
  uint32_t at = SPRITE_QUEUE + (uint32_t)count * 16;
  write16(at, (uint16_t)x);
  write16(at + 2, (uint16_t)y);
  write16(at + 4, 0);
  write16(at + 6, 200);
  write16(at + 8, (uint16_t)tile);
  write8(at + 10, (uint8_t)third);
  write8(at + 11, (uint8_t)sixth);
  write8(at + 12, (uint8_t)palette);
  write8(at + 13, (uint8_t)shape);
  write8(at + 14, (uint8_t)eighth);
  write8(at + 15, (uint8_t)ninth);
  write8(SPRITE_COUNT, count + 1);
}

static void put(int x, int y, int tile, int palette, int shape) { queueHudSprite(x, y, 0, tile, palette, 0, shape, 0, 0); }
static void putScore(int x, int y, int tile, int palette, int shape) { queueHudSprite(x, y, 1, tile, palette, 0, shape, 0, 0); }

void startHud(int mode) {
  mode &= 0xFF;
  setByte(MODE, (uint8_t)mode);
  write8(STARTED, 0);
  switch (mode) {
    case 10:
    case 11: {
      uint32_t rec = record();
      write8(rec + 142, read8(rec + 141));
      write8(rec + 141, 0);
      setHalf(X1, 0xFF10);
      setHalf(X2, 0xFF10);
      setHalf(X1_GOAL, 0);
      setHalf(X2_GOAL, 0);
      setByte(CHOICE, 0);
      setByte(BOUNCE, 0);
      setByte(STEP, 0);
      setHalf(TIMER, 0);
      setByte(PICKS, 0);
      setByte(PICKS + 1, 0);
      setByte(PICKS + 2, 0);
      queueCopy(PALETTE_14, 0x083DFF34, 32);
      queueCopy(PALETTE_15, 0x083DFF54, 32);
      fastCopy(read8(LANGUAGE) == 0 ? 0x083DFF74 : 0x083E1174, 0x06016300, 320);
      fastCopy(0x083E3274, 0x06016800, 32);
      fastCopy(0x083E3274 + 128, 0x06016880, 32);
      fastCopy(0x083E3274 + 128, 0x06016900, 32);
      fastCopy(0x083E3974, 0x06016980, 672);
      fastCopy(0x083E2374, 0x06017400, 640);
      fastCopy((uint32_t)(read8(FIGHT + 4) << 9) + 0x083E3374, 0x06016100, 128);
      fastCopy(0x0831EB14, 0x06017E00, 128);
      clearPushes();
      break;
    }
    case 20: {
      setHalf(TIMER, 0);
      setHalf(X1, 0);
      setHalf(X2, 0);
      setHalf(X3, 0);
      setByte(STEP, 4);
      setHalf(X1_GOAL, 0);
      setHalf(Y1_GOAL, 0);
      setHalf(X2_GOAL, 0);
      setHalf(Y2_GOAL, 0);
      queueCopy(PALETTE_14, 0x0831ED14, 32);
      uint32_t from = 0x0831FD34;
      fastCopy(from, 0x06016800, 128);
      fastCopy(from + 0x200, 0x06016A00, 128);
      fastCopy(from + 0x400, 0x06016C00, 128);
      fastCopy(from + 0x600, 0x06016E00, 128);
      fastCopy(from + 0x800, 0x06017000, 128);
      fastCopy(from + 0xA00, 0x06017200, 128);
      fastCopy(from + 0xC00, 0x06017800, 32);
      fastCopy(from + 0xC80, 0x06017900, 32);
      fastCopy(from + 0x1000, 0x06017A00, 128);
      fastCopy(from + 0xD00, 0x06017C00, 128);
      fastCopy(0x0831EB14, 0x06017E00, 128);
      break;
    }
    case 30: {
      setHalf(Y1, 0xFFC0);
      setHalf(Y2, 64);
      setHalf(Y1_GOAL, 0);
      setHalf(Y2_GOAL, 0);
      queueCopy(PALETTE_14, 0x08321D54, 32);
      queueCopy(PALETTE_15, 0x08321D74, 32);
      fastCopy(0x08321DD4, 0x06016800, 192);
      fastCopy((uint32_t)(read8(record() + 196) << 10) + 0x08322054, 0x06016A80, 256);
      fastCopy(0x08322054 + 0x2800, 0x06016E80, 256);
      fastCopy(0x08324C54, 0x06017280, 336);
      for (int i = 0; i < 4; i++) {
        uint8_t fighter = read8(FIGHT + 20 + i);
        uint32_t to = 0x06017800 + ((uint32_t)i << 7);
        uint32_t from;
        if (fighter <= 8 && read8(FIGHT + 24 + i) == 0) from = ((uint32_t)fighter << 7) + 0x083251D4;
        else if (u8(fighter - 17) <= 1) from = 0x08325554;
        else if (fighter == 19) from = 0x083256D4;
        else from = 0x08325654;
        fastCopy(from, to, 32);
      }
      fastCopy(0x08326FB4, 0x06017B60, 64);
      fastCopy(0x08326954, 0x06017A00, 32);
      fastCopy(0x08326954, 0x06017A80, 32);
      fastCopy(0x08326E54, 0x06017B00, 8);
      fastCopy(0x08326E54, 0x06017B20, 8);
      fastCopy(0x08326E54 + 320, 0x06017B40, 8);
      break;
    }
    case 40: {
      setHalf(TIMER, 0);
      setHalf(X1, 128);
      setHalf(X2, 32);
      setHalf(X3, 56);
      setHalf(Y1, 0xFFE0);
      setHalf(Y2, 160);
      setHalf(Y3, 102);
      setHalf(X1_GOAL, 32);
      setHalf(X2_GOAL, 128);
      setHalf(Y1_GOAL, 64);
      setHalf(Y2_GOAL, 64);
      queueCopy(PALETTE_14, 0x08320F34, 32);
      uint32_t from = 0x08320F54;
      fastCopy(from, 0x06016800, 384);
      fastCopy(from + 0x600, 0x06016E00, 384);
      fastCopy(from + 0xC00, 0x06017C00, 128);
      fastCopy(0x0831EB14, 0x06017E00, 128);
      break;
    }
    case 50:
      setHalf(TIMER, 0);
      queueCopy(PALETTE_14, 0x08422718, 32);
      copy16(0x08422738, 0x06016800, 0xC40);
      break;
    case 60: {
      playSound(SOUND_YES);
      setHalf(X1, 16);
      setHalf(X1_GOAL, 0);
      setHalf(Y3, 0);
      setHalf(Y3_GOAL, 20);
      setByte(CHOICE, 0);
      setByte(BOUNCE, 0);
      setByte(STEP, 0);
      setHalf(TIMER, 0);
      queueCopy(PALETTE_14, 0x0831ED14, 32);
      queueCopy(PALETTE_15, 0x083F15F4, 32);
      static const uint32_t words[6] = {0x083F170C, 0x083F1DA4, 0x083F24D0, 0x083F2CC8, 0x083F3500, 0x083F3CC4};
      decompress(read8(LANGUAGE) < 6 ? words[read8(LANGUAGE)] : 0x083F1DA4, 0x06016800);
      decompress(0x083F1614, 0x06017400);
      fastCopy(0x0831EB14, 0x06017E00, 128);
      break;
    }
  }
}

static void drawEdges(int top, int bottom) {
  for (int i = 0; i < 8; i++) {
    put(i << 5, top, 0x3F0, 14, 113);
    put(i << 5, bottom, 0x3F0, 14, 113);
  }
}

static void drawRow(int y, int tile, int shape) {
  for (int i = 0; i < 8; i++) put(i << 5, y, tile, 14, shape);
}

static void drawChoice(int mode) {
  if (read8(FIGHT + 125) != 4 && umod(vblanks(), 60) > 15) {
    put(168, 146, 0x308, 14, 111);
    put(200, 146, 0x310, 14, 111);
  }
  if (byte(STEP) <= 2) {
    int bounce = byte(BOUNCE);
    int x = byte(CHOICE) * 40 + half(X1);
    put(x - (bounce - 15), 76 - bounce, 0x3E8, 15, 114);
    put(x + bounce + 41, 76 - bounce, 0x3E9, 15, 114);
    put(x - (bounce - 15), bounce + 102, 0x3EA, 15, 114);
    put(x + bounce + 41, bounce + 102, 0x3EB, 15, 114);
  }
  for (int i = 0; i < 3; i++) {
    int taken = byte(TAKEN + i);
    if (taken == 0) continue;
    int x = half(X1) + i * 40;
    put(x, 95, (taken << 3) + 0x3C8, 15, 116);
    put(x + 32, 95, (taken << 3) + 0x3CC, 15, 116);
  }
  int words = half(X2);
  put(words, 58, 0x318, 14, 111);
  put(words + 32, 58, 0x320, 14, 111);
  put(words + 64, 58, 0x328, 14, 111);
  put(words + 96, 58, 0x330, 14, 111);
  put(words + 128, 58, 0x338, 14, 111);
  int x = half(X1);
  put(x + 16, 77, 0x3A0, 15, 113);
  put(x + 56, 77, 0x3B0, 15, 113);
  put(x + 96, 77, 0x3C0, 15, 113);
  if (mode != 10 && read16(FIGHT + 128) != 0 && read8(FIGHT + 10) != 0) {
    int seconds = sdiv(read16(FIGHT + 128) - read16(FIGHT + 130), 30);
    fastCopy((uint32_t)(u8(sdiv(seconds, 10)) << 7) + 0x083E2D74, 0x06016880, 32);
    fastCopy((uint32_t)(u8(smod(seconds, 10)) << 7) + 0x083E2D74, 0x06016900, 32);
  }
  put(x + 194, 68, 0x340, 14, 116);
  put(x + 196, 82, 0x344, 14, 110);
  put(x + 208, 82, 0x348, 14, 110);
  static const uint16_t edge[15] = {0x34C, 0x34C, 0x34C, 0x34C, 0x34C, 0x34C, 0x34C, 0x34C, 0x34C, 0x35C, 0x36C, 0x37C, 0x34C, 0x34C, 0x38C};
  for (int i = 0; i < 15; i++) put(x + i * 16, 52, edge[i], 14, 112);
  static const uint16_t lower[15] = {0x354, 0x354, 0x354, 0x354, 0x354, 0x354, 0x354, 0x354, 0x354, 0x364, 0x374, 0x384, 0x354, 0x354, 0x394};
  for (int i = 0; i < 15; i++) put(x + i * 16, 84, lower[i], 14, 112);
  if (byte(MODE) != 12) {
    int player = (int)read32(PLAYER_);
    uint8_t face = read8(record() + 196);
    uint16_t to = (uint16_t)(player * 36);
    int step = byte(STEP), choice = byte(CHOICE);
    if (step == 0) {
      if (choice == 0) stepAnimation(face, 19, 8, to, player);
      else if (choice == 1) { if (u8(stepAnimation(face, 21, 8, to, player)) == 255) stepAnimation(face, 0, 8, to, player); }
      else if (choice == 2) stepAnimation(face, 23, 8, to, player);
    } else if (step == 1) {
      if (choice == 0) stepAnimation(face, 20, 8, to, player);
      else if (choice == 1) { if (u8(stepAnimation(face, 22, 8, to, player)) == 255) stepAnimation(face, 0, 8, to, player); }
      else if (choice == 2) stepAnimation(face, 24, 8, to, player);
    } else stepAnimation(face, 53, 8, to, player);
    drawPicture(s16(half(X1) + 146), 61, u8(player * 36), u8(player), u8(player));
  }
  int right = half(X1);
  for (int n = 0; n < 3; n++) {
    int y = 61 + n * 16;
    put(right + 144, y, 0x39C, 14, 110);
    put(right + 160, y, 0x39C, 14, 110);
    put(right + 176, y, 0x39C, 14, 110);
  }
  drawEdges(-12, 140);
}

static void drawBanner(void) {
  uint16_t t = half(TIMER);
  if (t <= 27) {
  } else if (t <= 39) {
    setHalf(X1, half(X1) + 32);
    setHalf(X2, half(X2) + 4);
  } else if (t <= 87) {
    setHalf(X1, half(X1) + 1);
    setHalf(X2, half(X2) + 4);
  } else if (t <= 91) {
    setHalf(X3, half(X3) + 18);
  } else if (t <= 99) {
    uint16_t v = vblanks();
    int step = byte(STEP);
    #define SHAKE(a, b) (smod((int32_t)(a) * (int32_t)(b), step << 3) - (step << 2))
    setHalf(X1_GOAL, (uint16_t)SHAKE(v + 5, v + 1));
    setHalf(Y1_GOAL, (uint16_t)SHAKE(v + 1, v + 2));
    setHalf(X2_GOAL, (uint16_t)SHAKE(v + 8, v));
    setHalf(Y2_GOAL, (uint16_t)SHAKE(v + 7, v + 4));
    #undef SHAKE
    if (step != 0) setByte(STEP, step - 1);
  } else {
    setHalf(X3_GOAL, 0);
    setHalf(Y3_GOAL, 0);
    setHalf(X3, half(X3) - 64);
  }
  if (shalf(X1) > 240) setHalf(X1, 0);
  if (shalf(X2) > 240) setHalf(X2, 0);
  if (shalf(X3) > 240) setHalf(X3, 0);
  if (u16(t - 29) <= 58) {
    int a = half(X1);
    put(240 - a, 63, 0x340, 14, 113);
    put(272 - a, 63, 0x350, 14, 113);
    put(304 - a, 63, 0x360, 14, 113);
    put(a - 96, 66, 0x370, 14, 113);
    put(a - 64, 66, 0x380, 14, 113);
    put(a - 32, 66, 0x390, 14, 113);
    for (int i = 0; i < 9; i++) put(i << 5, 64, 0x3D0, 14, 113);
    for (int i = 0; i < 8; i++) {
      put(i << 5, 61, 0x3C0, 14, 116);
      put(i << 5, 96, 0x3C0, 14, 116);
    }
    for (int i = 0; i < 8; i++) {
      int left = shalf(X2) + (i << 5) - 256;
      if (((left + 31) & 0xFFFF) <= 302) put(left, 61, 0x3C8, 14, 116);
      int away = (i << 5) + 240 - shalf(X2);
      if (((away + 31) & 0xFFFF) <= 302) put(away, 96, 0x3C8, 14, 116);
    }
  } else if (u16(t - 89) <= 14) {
    int slide = half(X3);
    put(half(X1_GOAL) - 12 + slide, half(Y1_GOAL) + 44, 0x340, 14, 115);
    put(half(X2_GOAL) + 188 - slide, half(Y2_GOAL) + 52, 0x380, 14, 115);
  }
  if (t == 28 || t == 89 || t == 101 || t == 29 || t == 90 || t == 102) drawRow(64, 0x3E0, 113);
  if (t == 27 || t == 88 || t == 100 || t == 30 || t == 91 || t == 103) drawRow(76, 0x3E0, 116);
  int out = t - 100 > 0 ? (t - 100) << 1 : 0;
  drawEdges(-12 - out, 140 + out);
}

static void drawBars(void) {
  ease(Y1, Y1_GOAL, 2);
  ease(Y2, Y2_GOAL, 2);
  int top = half(Y1);
  uint32_t rec = record();
  put(0, top - 8, 0x354, 14, 117);
  put(64, top - 8, 0x374, 14, 117);
  int life = read16(rec + 194);
  put(0xFF95 + life, top + 13, 0x344, 14, 116);
  put(0xFFB5 + life, top + 13, 0x344, 14, 116);
  put(0xFFD5 + life, top + 13, 0x344, 14, 116);
  put(0xFFF5 + life, top + 13, 0x340, 14, 116);
  int power = read8(rec + 148);
  put(0xFFD0 + power, top + 5, 0x348, 14, 116);
  put(0xFFF0 + power, top + 5, 0x348, 14, 116);
  put(power + 16, top + 5, 0x348, 14, 116);
  static const int xs[4] = {-6, 26, 58, 90};
  for (int i = 0; i < 4; i++) put(xs[i], top + 5, 0x34C, 14, 111);
  if (read8(FIGHT + 4) == 1) {
    int left = read16(FIGHT + 126) - read16(FIGHT + 114);
    int minuteTens = u8(smod(sdiv(left, 0x4650), 10));
    int minuteOnes = u8(smod(sdiv(left, 0x708), 10));
    int seconds = smod(sdiv(left, 30), 60);
    fastCopy((uint32_t)(minuteTens << 7) + 0x08326954, 0x06017A00, 32);
    fastCopy((uint32_t)(minuteOnes << 7) + 0x08326954, 0x06017A80, 32);
    fastCopy((uint32_t)(u8(sdiv(seconds, 10)) << 5) + 0x08326E54, 0x06017B00, 8);
    fastCopy((uint32_t)(u8(smod(seconds, 10)) << 5) + 0x08326E54, 0x06017B20, 8);
    put(208, top + 5, 0x3D0, 14, 110);
    put(217, top + 5, 0x3D4, 14, 110);
    put(228, top + 13, 0x3D8, 14, 114);
    put(233, top + 13, 0x3D9, 14, 114);
    if (smod(left, 30) > 15) put(225, top + 13, 0x3DA, 14, 114);
    put(192, top + 8, 0x3DB, 14, 110);
    put(208, top + 8, 0x3DF, 14, 110);
    put(224, top + 8, 0x3DF, 14, 110);
  }
  int bottom = half(Y2);
  for (int i = 0; i < 4; i++) {
    if (read8(FIGHT + 20 + i) == 255) continue;
    int tens, ones;
    if (read8(FIGHT + 4) == 2) {
      int score = read8(FIGHT + 6) - read8(FIGHT + 51 + i);
      ones = u8(smod(score, 10));
      tens = u8(sdiv(score, 10));
    } else {
      if (read8(FIGHT + 39 + i) > 99) write8(FIGHT + 39 + i, 99);
      int score = read8(FIGHT + 39 + i);
      ones = u8(umod(score, 10));
      tens = u8(udiv(score, 10));
    }
    int x = 4 + i * 60;
    putScore(x, bottom + 140, 0x3C0 + (i << 2), i, 110);
    int marked = read8(FIGHT + 8) != 0 && read8(FIGHT + 32 + i) == 0;
    int palette = marked ? 15 : 14;
    putScore(x + 16, bottom + 140, (tens << 2) + 0x394, palette, 110);
    putScore(x + 28, bottom + 140, (ones << 2) + 0x394, palette, 110);
    if (marked && i == 0) queueHudSprite(x + 38, bottom + 148, 1, 0x3BC, 14, 1, 118, 0, 0);
    else putScore(x + 38, bottom + 148, 0x3BC, palette, 118);
  }
}

static void drawSlides(void) {
  uint16_t t = half(TIMER);
  if (t <= 45) {
    if (t <= 39) {
      static const int pairs[4][2] = {{X1, X1_GOAL}, {X2, X2_GOAL}, {Y1, Y1_GOAL}, {Y2, Y2_GOAL}};
      for (int i = 0; i < 4; i++) {
        int at = pairs[i][0], goal = pairs[i][1];
        if (shalf(at) < shalf(goal)) setHalf(at, half(at) + 24);
        else if (shalf(at) > shalf(goal)) setHalf(at, half(at) - 24);
      }
    } else {
      setHalf(X1, half(X1) - 32);
      setHalf(X2, half(X2) + 32);
    }
    int x1 = half(X1), x2 = half(X2), y1 = half(Y1), y2 = half(Y2);
    put(x1, y1, 0x340, 14, 113);
    put(x1 + 32, y1, 0x350, 14, 113);
    put(x1 + 64, y1, 0x360, 14, 113);
    put(x2, y2, 0x370, 14, 113);
    put(x2 + 32, y2, 0x380, 14, 113);
    put(x2 + 64, y2, 0x390, 14, 113);
  }
  if (u16(t - 5) <= 1 || t == 41 || t == 42) drawRow(64, 0x3E0, 113);
  if (t == 4 || t == 7 || t == 40 || t == 43) drawRow(76, 0x3E0, 116);
  int out = t <= 9 ? (10 - t) << 1 : 0;
  drawEdges(-12 - out, 140 + out);
}

static void drawBlink(void) {
  if ((half(TIMER) & 24) <= 8) return;
  put(66, 128, 0x340, 14, 117);
  put(120, 128, 0x360, 14, 117);
}

static void drawQuestion(void) {
  int16_t swing = s16(read16(SINE_ + (uint32_t)half(TIMER) * 2)) >> 11;
  int yes = byte(CHOICE) == 0 ? swing : 0, no = byte(CHOICE) == 0 ? 0 : swing;
  ease(X1, X1_GOAL, 1);
  int x = half(X1);
  put(yes + 70 + x, 78, 0x340, 15, 111);
  put(yes + 102 + x, 78, 0x348, 15, 111);
  put(yes + 134 + x, 78, 0x350, 15, 111);
  put(no + 70 + x, 100, 0x358, 15, 111);
  put(no + 102 + x, 100, 0x360, 15, 111);
  put(no + 134 + x, 100, 0x368, 15, 111);
  put(72 - x, 32, 0x370, 15, 117);
  put(136 - x, 32, 0x390, 15, 113);
  static const int ys[3] = {64, 80, 96};
  for (int i = 0; i < 3; i++) {
    put(72 - x, ys[i], 0x3A0, 15, 111);
    put(104 - x, ys[i], 0x3A8, 15, 111);
    queueHudSprite(136 - x, ys[i], 0, 0x3A0, 15, 0, 111, 0, 3);
  }
  put(72 - x, 112, 0x3B0, 15, 111);
  put(104 - x, 112, 0x3B8, 15, 111);
  put(136 - x, 112, 0x3C0, 15, 111);
  ease(Y3, Y3_GOAL, 1);
  int edge = half(Y3);
  drawEdges(edge - 32, 160 - edge);
}

void drawHud(int mode) {
  mode &= 0xFF;
  if (read8(STARTED) == 0 && mode != 12 && mode != 20) {
    write8(STARTED, 1);
    return;
  }
  switch (mode) {
    case 10:
    case 11:
    case 12: drawChoice(mode); break;
    case 20: drawBanner(); break;
    case 30: drawBars(); break;
    case 40: drawSlides(); break;
    case 50: drawBlink(); break;
    case 60: drawQuestion(); break;
    default: break;
  }
}

int countUntilDone(void) {
  uint16_t before = half(TIMER);
  setHalf(TIMER, before + 1);
  if (u16(before - 60) <= 0xE9A && (g.keys.pressed & KEY_START)) setHalf(TIMER, 0xED8);
  uint16_t now = half(TIMER);
  if (now > 0xF00) return 2;
  return now <= 0xED8 ? 0 : 1;
}

int chooseAnswer(void) {
  uint16_t t = half(TIMER);
  setHalf(TIMER, t <= 0x1FFF ? t + 0x200 : t - 0x2000);
  uint16_t keys = ringKeys();
  if (keys & (KEY_UP | KEY_DOWN)) {
    setByte(CHOICE, byte(CHOICE) ^ 1);
    playSound(SOUND_MOVE);
  }
  if (keys & KEY_A) { playSound(SOUND_YES); return byte(CHOICE); }
  if (!(keys & KEY_START)) return 255;
  playSound(SOUND_YES);
  return 0;
}

static void moveChoice(int by, int end, int start) {
  for (;;) {
    int choice = u8(byte(CHOICE) + by);
    setByte(CHOICE, (uint8_t)choice);
    if (choice == end) setByte(CHOICE, (uint8_t)start);
    if (byte(TAKEN + byte(CHOICE)) == 0) break;
  }
  setByte(BOUNCE, 5);
}

int chooseSpecials(void) {
  uint8_t picks[3] = {byte(PICKS), byte(PICKS + 1), byte(PICKS + 2)};
  for (int n = 1; n <= 3; n++) {
    int pick = -1;
    for (int i = 0; i < 3; i++) if (picks[i] == n) pick = i;
    setByte(TAKEN + n - 1, pick < 0 ? 0 : (uint8_t)(pick + 1));
  }
  if (half(TIMER) > 5) {
    static const uint32_t words0[3] = {0x083DFF74, 0x083E0574, 0x083E0B74};
    static const uint32_t words1[3] = {0x083E1174, 0x083E1774, 0x083E1D74};
    const uint32_t *words = read8(LANGUAGE) == 0 ? words0 : words1;
    int step = byte(STEP);
    if (step <= 2) fastCopy(words[step], 0x06016300, 320);
  }
  uint16_t timer = half(TIMER);
  if (timer >= 2) setHalf(TIMER, timer - 1);
  else if (timer == 1) {
    setHalf(TIMER, 0);
    if (byte(STEP) == 3) setByte(STEP, 4);
  } else if (byte(STEP) <= 2) {
    uint16_t keys = ringKeys();
    int step = byte(STEP);
    if (keys & KEY_B) {
      if (step != 0) {
        playSound(SOUND_BACK);
        setByte(STEP, step - 1);
        setByte(PICKS + step - 1, 0);
        setHalf(X2, 0xFF10);
        setHalf(TIMER, 6);
        clearPushes();
      }
    } else if (keys & KEY_A) {
      setByte(PICKS + step, byte(CHOICE) + 1);
      setByte(STEP, step + 1);
      if (u8(step + 1) <= 2) {
        playSound(SOUND_YES);
        setHalf(X2, 0xFF10);
        setHalf(TIMER, 6);
        clearPushes();
      } else {
        playSound(SOUND_DONE);
        setHalf(TIMER, 6);
        int away = byte(MODE) == 10 ? 0xFF06 : 0xFF3C;
        setHalf(X1_GOAL, (uint16_t)away);
        setHalf(X2_GOAL, (uint16_t)away);
        clearPushes();
      }
    }
    if ((keys & KEY_RIGHT) || ((keys & KEY_A) && !(keys & KEY_B))) {
      moveChoice(1, 3, 0);
      if (keys & KEY_RIGHT) playSound(SOUND_MOVE);
      clearPushes();
    } else if (keys & KEY_LEFT) {
      moveChoice(-1, 255, 2);
      playSound(SOUND_MOVE);
      clearPushes();
    }
  }
  uint8_t bounce = byte(BOUNCE);
  if (bounce != 0) setByte(BOUNCE, bounce - 1);
  ease(X1, X1_GOAL, 1);
  ease(X2, X2_GOAL, 1);
  ease(X3, X3_GOAL, 1);
  if (byte(STEP) <= 3) return 0;
  uint8_t chosen = (byte(PICKS) & 3) | ((byte(PICKS + 1) & 3) << 2) | ((byte(PICKS + 2) & 3) << 4);
  write8(record() + 141, chosen);
  return 1;
}

int countBanner(void) {
  uint16_t t = (uint16_t)(half(TIMER) + 1);
  setHalf(TIMER, t);
  if (t == 27) playSound(SOUND_BANNER);
  else if (t == 88) {
    fastCopy(0x0831ED34, 0x06016800, 512);
    fastCopy(0x0831ED34 + 0x800, 0x06017000, 512);
  }
  return t > 103 ? 1 : 0;
}

int hudMode(void) { return byte(MODE); }

int countSlides(void) {
  uint16_t t = (uint16_t)(half(TIMER) + 1);
  setHalf(TIMER, t);
  return t > 119 ? 1 : 0;
}

void clearPushes(void) {
  static const uint32_t ats[3] = {0x03003108, 0x03003110, 0x030030F8};
  for (int a = 0; a < 3; a++) for (int i = 0; i < 4; i++) write16(ats[a] + (uint32_t)i * 2, 0);
  for (int i = 0; i < 4; i++) write8(0x03003120 + i, 0);
}

void drawPicture(int x, int y, int tile, int palette, int index) {
  tile &= 0xFF;
  palette &= 0xFF;
  index &= 0xFF;
  x = s16(x);
  y = s16(y);
  uint32_t pushX = PUSH_X + (uint32_t)index * 2, pushY = PUSH_Y + (uint32_t)index * 2;
  put(x - read16(pushX), y + read16(pushY), tile, palette, 113);
  put(x - read16(pushX), y + read16(pushY) + 32, tile + 16, palette, 111);
  put(x - (read16(pushX) - 32), y + read16(pushY), tile + 24, palette, 112);
  put(x - (read16(pushX) - 32), y + read16(pushY) + 32, tile + 32, palette, 110);
}

int16_t pushAcross(int index) { return s16(-read16(PUSH_X + (uint32_t)(index & 0xFF) * 2)); }
int16_t pushDown(int index) { return reads16(PUSH_Y + (uint32_t)(index & 0xFF) * 2); }
