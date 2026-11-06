// The rest of the C kit: the player's copy, the save memory, the words of the page's address, memory for the game, and
// the few functions the page calls, by name, to run the game (game.js as WebAssembly, native.c on a computer).

#include "gba.h"

const uint8_t *gba_rom;
uint32_t gba_rom_size;

#ifdef __wasm__
#define EXPORT(name) __attribute__((export_name(name)))
#define IMPORT(name) __attribute__((import_module("dreamports"), import_name(name)))

// what the page gives: the save memory's bytes it kept, and a place to keep them
IMPORT("save_read") void host_save_read(uint8_t *bytes, uint32_t size);
IMPORT("save_write") void host_save_write(const uint8_t *bytes, uint32_t size);

// memory past what the program takes, given out in turn and never taken back, as a game's memory lasts for the page
extern unsigned char __heap_base;
static uintptr_t heap_top;
void *gba_alloc(size_t size) {
  if (!heap_top) heap_top = (uintptr_t)&__heap_base;
  uintptr_t at = (heap_top + 15) & ~(uintptr_t)15, end = at + size;
  size_t have = __builtin_wasm_memory_size(0) * 65536;
  if (end > have && __builtin_wasm_memory_grow(0, (end - have + 65535) / 65536) == (size_t)-1) __builtin_trap();
  heap_top = end;
  return __builtin_memset((void *)at, 0, size);
}
#else
#include <stdlib.h>
#define EXPORT(name)
void host_save_read(uint8_t *bytes, uint32_t size);
void host_save_write(const uint8_t *bytes, uint32_t size);
void *gba_alloc(size_t size) {
  void *at = calloc(1, size ? size : 1);
  if (!at) abort();
  return at;
}
#endif

static uint8_t *save_bytes;
static uint32_t save_size;
uint8_t *gba_save(uint32_t size) {
  if (!save_bytes) {
    save_bytes = gba_alloc(size);
    save_size = size;
    host_save_read(save_bytes, size);
  }
  return save_bytes;
}
void gba_save_write(void) {
  if (save_bytes) host_save_write(save_bytes, save_size);
}

// The words of the page's address, such as proof&unlocked=1, as the page gave them, and as gba_start_point reads them:
// each word's name and value, decoded, with a zero after each, made the first time one is read.
static char *start_text, *start_words, *start_words_end;
static uint32_t start_size;

static int hex_digit(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  c |= 0x20;
  return c >= 'a' && c <= 'f' ? c - 'a' + 10 : -1;
}
// from..to with + as a space and %XX as its byte, as URLSearchParams decodes them, into out, and where it ended. A %00
// stays as it is, as a zero would end the word early.
static char *decode_word(char *out, const char *from, const char *to) {
  for (const char *p = from; p < to; p++) {
    int high, low;
    if (*p == '+') *out++ = ' ';
    else if (*p == '%' && to - p > 2 && (high = hex_digit(p[1])) >= 0 && (low = hex_digit(p[2])) >= 0 && (high | low)) {
      *out++ = (char)(high << 4 | low);
      p += 2;
    } else *out++ = *p;
  }
  return out;
}
static void read_start_words(void) {
  // each word takes at most two bytes more than it had, and the & before it
  char *out = start_words = gba_alloc(start_size * 2 + 2);
  const char *p = start_text, *end = start_text + start_size;
  if (p < end && *p == '?') p++;
  while (p < end) {
    const char *word_end = p, *equals;
    while (word_end < end && *word_end != '&') word_end++;
    if (word_end > p) {
      for (equals = p; equals < word_end && *equals != '='; equals++) {}
      out = decode_word(out, p, equals);
      *out++ = 0;
      out = decode_word(out, equals < word_end ? equals + 1 : word_end, word_end);
      *out++ = 0;
    }
    p = word_end + 1;
  }
  start_words_end = out;
}

const char *gba_start_point(const char *name) {
  if (!start_text) return NULL;
  if (!start_words) read_start_words();
  for (const char *word = start_words; word < start_words_end;) {
    const char *value = word;
    while (*value) value++;
    value++;
    const char *a = word, *b = name;
    while (*a && *a == *b) a++, b++;
    if (!*a && !*b) return value;
    for (word = value; *word; word++) {}
    word++;
  }
  return NULL;
}

static int is_space(char c) { return c == ' ' || (c >= '\t' && c <= '\r'); }
// a number as JavaScript's | 0 makes it a whole one: what's after the point dropped, and kept to 32 bits
static int32_t to_int32(double d) {
  if (d != d || d >= 0x1p84 || d <= -0x1p84) return 0;   // NaN, the infinities, and numbers whose low 32 bits are all 0
  int64_t high = (int64_t)(d / 0x1p32);
  return (int32_t)(uint32_t)(int64_t)(d - (double)high * 0x1p32);
}
int32_t gba_start_number(const char *name, int32_t absent) {
  const char *s = gba_start_point(name), *end;
  if (!s) return absent;
  while (is_space(*s)) s++;
  for (end = s; *end; end++) {}
  while (end > s && is_space(end[-1])) end--;
  if (s == end) return 0;
  // 0x, 0o and 0b, with no sign
  char kind = end - s > 2 && s[0] == '0' ? s[1] | 0x20 : 0;
  int base = kind == 'x' ? 16 : kind == 'o' ? 8 : kind == 'b' ? 2 : 0;
  if (base) {
    uint32_t value = 0;
    for (const char *p = s + 2; p < end; p++) {
      int digit = hex_digit(*p);
      if (digit < 0 || digit >= base) return 0;
      value = value * (uint32_t)base + (uint32_t)digit;
    }
    return (int32_t)value;
  }
  // decimal: a sign, digits with or without a point, and an exponent
  int negative = *s == '-', digits = 0, exponent = 0, after_point = 0;
  if (*s == '-' || *s == '+') s++;
  double value = 0;
  for (; s < end && *s >= '0' && *s <= '9'; s++, digits++) value = value * 10 + (*s - '0');
  if (s < end && *s == '.') {
    for (s++; s < end && *s >= '0' && *s <= '9'; s++, digits++, after_point++) value = value * 10 + (*s - '0');
  }
  if (!digits) return 0;
  if (s < end && (*s | 0x20) == 'e') {
    int sign = 1, e = 0, any = 0;
    if (++s < end && (*s == '-' || *s == '+')) sign = *s++ == '-' ? -1 : 1;
    for (; s < end && *s >= '0' && *s <= '9'; s++, any = 1) if (e < 10000) e = e * 10 + (*s - '0');
    if (!any) return 0;
    exponent = sign * e;
  }
  if (s != end) return 0;
  for (exponent -= after_point; exponent > 0 && value < 0x1p84; exponent--) value *= 10;
  for (; exponent < 0 && value != 0; exponent++) value /= 10;
  return to_int32(negative ? -value : value);
}

// what the page calls
static uint32_t *screen;

/** A place for the player's copy, `size` bytes, which the page fills before it calls dp_start. */
EXPORT("dp_rom") uint8_t *dp_rom(uint32_t size) {
  uint8_t *at = gba_alloc(size);
  gba_rom = at;
  gba_rom_size = size;
  return at;
}
/** A place for the words of the page's address, `size` bytes, which the page fills before it calls dp_start. */
EXPORT("dp_start_point") char *dp_start_point(uint32_t size) {
  start_text = gba_alloc(size + 1);
  start_size = size;
  start_words = NULL;
  return start_text;
}
/** Starts the game. */
EXPORT("dp_start") void dp_start(void) {
  if (!screen) screen = gba_alloc(SCREEN_W * SCREEN_H * 4);
  game_start();
}
/** Runs one frame with the buttons in `keys` held. */
EXPORT("dp_step") void dp_step(uint32_t keys) { game_step((uint16_t)keys); }
/** Draws the frame, and gives where its 240 × 160 words are. */
EXPORT("dp_draw") uint32_t *dp_draw(void) {
  gba_draw_frame(screen);
  return screen;
}
/** Where the video hardware is, for the page to show the proof tools what it holds (proof.js `video`). */
EXPORT("dp_vram") uint8_t *dp_vram(void) { return gba_vram; }
EXPORT("dp_pal") uint16_t *dp_pal(void) { return gba_pal; }
EXPORT("dp_oam") uint16_t *dp_oam(void) { return gba_oam; }
EXPORT("dp_io") uint16_t *dp_io(void) { return gba_io; }
