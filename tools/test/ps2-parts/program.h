/* What the program of the PlayStation 2's test of a game whose tasks are its parts (../ps2-parts.mjs) and its game
   share: when the square turns, and what the GS is given each frame, as one packet through the GIF. */

#define TURNS_AT 60

/* A tag for 13 register writes, each a value's two halves and its register: the framebuffer, the whole screen, no
   offset, every pixel passing, no depth written, sprites, a background over the screen, and the square, whose corners
   are words SQUARE and SQUARE + 4. */
#define SQUARE 48
#define PACKET { \
  13 | 0x8000, 0x10000000, 0xE, 0, \
  10 << 16, 0, 0x4C, 0, \
  639 << 16, 447 << 16, 0x40, 0, \
  0, 0, 0x18, 0, \
  0x30000, 0, 0x47, 0, \
  0, 1, 0x4E, 0, \
  1, 0, 0x1A, 0, \
  6, 0, 0x00, 0, \
  0x80602010, 0x3F800000, 0x01, 0, \
  0, 0, 0x05, 0, \
  640 << 4 | 448 << 20, 0, 0x05, 0, \
  0x8010D0F0, 0x3F800000, 0x01, 0, \
  200 << 20, 0, 0x05, 0, \
  32 << 4 | 232 << 20, 0, 0x05, 0 }

/* The square's two corners at a place across, as the GS takes them, in sixteenths of a pixel. */
#define CORNER(x) ((x) << 4 | 200 << 20)
#define FAR_CORNER(x) (((x) + 32) << 4 | 232 << 20)
