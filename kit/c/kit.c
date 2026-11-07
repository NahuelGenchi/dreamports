// What every console's kit in C shares: the player's copy, the save memory, the words of the page's address, memory for
// the game, the picture the page shows, and the functions the page calls, by name, to give it the copy and the words.
// Starting the game, its frames and its drawing are the console's (console.c, or a kit's own, such as kit/gba/c/gba.c).

#include "kit.h"
#include "page.h"

const uint8_t *kit_copy;
uint32_t kit_copy_size;

#ifdef __wasm__
static void kit_trap(void) { __builtin_trap(); }
// memory past what the program takes, given out in turn and never taken back, as a game's memory lasts for the page
extern unsigned char __heap_base;
static uintptr_t heap_top;
void *kit_alloc(size_t size) {
  if (!heap_top) heap_top = (uintptr_t)&__heap_base;
  if (heap_top > ~(uintptr_t)15) kit_trap();
  uintptr_t at = (heap_top + 15) & ~(uintptr_t)15;
  if (size > ~(uintptr_t)0 - at) kit_trap();
  uintptr_t end = at + size;
  size_t have = __builtin_wasm_memory_size(0) * 65536;
  if (end > have) {
    size_t need = end - have;
    if (need > ~(size_t)65535 || __builtin_wasm_memory_grow(0, (need + 65535) / 65536) == (size_t)-1) kit_trap();
  }
  heap_top = end;
  return __builtin_memset((void *)at, 0, size);
}
#else
#include <stdlib.h>
#include <string.h>
static void kit_trap(void) { abort(); }
void *kit_alloc(size_t size) {
  void *at = calloc(1, size ? size : 1);
  if (!at) kit_trap();
  return at;
}
#endif

static void *kit_reuse(void **slot, size_t *room, size_t size) {
  size_t need = size ? size : 1;
  if (!*slot || need > *room) {
    *slot = kit_alloc(need);
    *room = need;
    return *slot;
  }
#ifdef __wasm__
  return __builtin_memset(*slot, 0, size);
#else
  return memset(*slot, 0, size);
#endif
}

static uint8_t *save_bytes;
static uint32_t save_size;
uint8_t *kit_save(uint32_t size) {
  if (!save_bytes) {
    save_bytes = kit_alloc(size);
    save_size = size;
    host_save_read(save_bytes, size);
  }
  return save_bytes;
}
void kit_save_write(void) {
  if (save_bytes) host_save_write(save_bytes, save_size);
}

// the picture, made again only when it needs more room than it has
static uint32_t *screen;
static int screen_width, screen_height;
static size_t screen_room;
uint32_t *kit_screen(int width, int height) {
  size_t w = (size_t)(width > 0 ? width : 0), h = (size_t)(height > 0 ? height : 0);
  if (h && w > ~(size_t)0 / h) kit_trap();
  size_t words = w * h;
  if (words > ~(size_t)0 / 4) kit_trap();
  if (!screen || words > screen_room) {
    screen = kit_alloc(words ? words * 4 : 4);
    screen_room = words;
  }
  screen_width = width;
  screen_height = height;
  return screen;
}

// The words of the page's address, such as proof&unlocked=1, as the page gave them, and as kit_start_point reads them:
// each word's name and value, decoded, with a zero after each, made the first time one is read.
static char *start_text, *start_words, *start_words_end;
static size_t start_text_room, start_words_room;
static uint32_t start_size;
static int start_words_ready;

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
  size_t len = start_size;
  if (len > (~(size_t)0 - 2) / 2) kit_trap();
  char *out = start_words = kit_reuse((void **)&start_words, &start_words_room, len * 2 + 2);
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
  start_words_ready = 1;
}

const char *kit_start_point(const char *name) {
  if (!start_text) return NULL;
  if (!start_words_ready) read_start_words();
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
int32_t kit_start_number(const char *name, int32_t absent) {
  const char *s = kit_start_point(name), *end;
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
static uint8_t *rom_bytes;
static size_t rom_room;
/** A place for the player's copy, `size` bytes, which the page fills before it calls dp_start. */
EXPORT("dp_rom") uint8_t *dp_rom(uint32_t size) {
  uint8_t *at = kit_reuse((void **)&rom_bytes, &rom_room, size);
  kit_copy = at;
  kit_copy_size = size;
  return at;
}
/** A place for the words of the page's address, `size` bytes, which the page fills before it calls dp_start. */
EXPORT("dp_start_point") char *dp_start_point(uint32_t size) {
  size_t len = size;
  if (len > ~(size_t)0 - 1) kit_trap();
  start_text = kit_reuse((void **)&start_text, &start_text_room, len + 1);
  start_size = size;
  start_words_ready = 0;
  return start_text;
}
/** The picture's size as the game last gave it to kit_screen, for the page to show it at that size. */
EXPORT("dp_width") int dp_width(void) { return screen_width; }
EXPORT("dp_height") int dp_height(void) { return screen_height; }
