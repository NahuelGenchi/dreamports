// Built to WebAssembly the kit has no C library, so the few of its functions the compiler calls on its own are here.
// On a computer the computer's own are used.

#include <stddef.h>
#include <stdint.h>

#ifdef __wasm__
void *memset(void *to, int value, size_t n) {
  uint8_t *p = to;
  while (n--) *p++ = (uint8_t)value;
  return to;
}
void *memcpy(void *restrict to, const void *restrict from, size_t n) {
  uint8_t *p = to;
  const uint8_t *q = from;
  while (n--) *p++ = *q++;
  return to;
}
void *memmove(void *to, const void *from, size_t n) {
  uint8_t *p = to;
  const uint8_t *q = from;
  if (p < q) while (n--) *p++ = *q++;
  else { p += n; q += n; while (n--) *--p = *--q; }
  return to;
}
int memcmp(const void *a, const void *b, size_t n) {
  const uint8_t *p = a, *q = b;
  for (; n--; p++, q++) if (*p != *q) return *p - *q;
  return 0;
}
#endif
