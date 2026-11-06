// For the C kit's test (c-kit.mjs): a game that reads the words of the page's address, a recording's start point, at
// game_start, and shows what it read as the first pixels of a bitmap, a colour each: every number in NUMBERS in three
// (its bits 0-14, 15-29 and 30-31), then for every word in WORDS its length, or 0x7FFF when it isn't there, and its
// bytes. c-kit.mjs has the same lists, and reads the same words with the page's URLSearchParams and Number.

#include "gba.h"

static const char *const NUMBERS[] = { "unlocked", "level", "x", "d", "f", "bad", "e", "big", "small", "missing", "empty", "proof", "sp", "o", "b" };
static const char *const WORDS[] = { "name", "proof", "empty", "pct", "missing" };

static uint16_t shown[255];
static int count;
static void show(uint32_t value) { if (count < 255) shown[count++] = value & 0x7FFF; }

void game_start(void) {
  for (unsigned i = 0; i < sizeof NUMBERS / sizeof *NUMBERS; i++) {
    uint32_t value = (uint32_t)gba_start_number(NUMBERS[i], 0x1234);
    show(value); show(value >> 15); show(value >> 30);
  }
  for (unsigned i = 0; i < sizeof WORDS / sizeof *WORDS; i++) {
    const char *value = gba_start_point(WORDS[i]);
    if (!value) { show(0x7FFF); continue; }
    int length = 0;
    while (value[length]) length++;
    show((uint32_t)length);
    for (int k = 0; k < length; k++) show((uint8_t)value[k]);
  }
}

// mode 4, a bitmap of 240 × 160 colours from the 256 on BG2, at its own size: pixel i shows colour i + 1, as 0 shows
// nothing
void game_step(uint16_t keys) {
  gba_write(REG_DISPCNT, 0x0404);
  gba_write(REG_BG2PA, 0x100);
  gba_write(REG_BG2PA + 6, 0x100);
  for (int i = 0; i < count; i++) {
    gba_vram[i] = (uint8_t)(i + 1);
    gba_pal[i + 1] = shown[i];
  }
}
