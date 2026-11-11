// Ghosts'n Goblins Dreamport: the sprites' task, which turns the objects that are shown into the console's sprites, from
// the original's code in bank 4 at $8000. Each object has a shape, and the copy's own tables say which tiles a shape is
// made of and where each sits around the object. The task writes the sprites twice, at $0200 in order and at $0300
// backwards, and V-blank sends one list one frame and the other the next, so when a line has more sprites than the
// console can show, each is still seen every other frame.

#include "game.h"

enum { LIST = 0x0480, LIST_MOST = 0x50, SPRITES = 0x0200, SPRITES_BACKWARDS = 0x0300 };
// the copy's tables in bank 4: each shape's tiles, each set of places around an object, and each object's colours
enum { SHAPES = 0x81EB, PLACES = 0x9491, COLOURS = 0x9AE7 };

// sub_04_8089: the first object and the fourth change places in every list, before and after the sprites are made, so
// the fourth's sprites come first.
static void swap_first_and_fourth(void) {
  static const uint16_t FIELDS[] = { OBJECT_FLAGS, OBJECT_SCREEN_Y, OBJECT_SCREEN_X, OBJECT_SHAPE, OBJECT_COLOURS };
  for (unsigned i = 0; i < sizeof FIELDS / sizeof *FIELDS; i++) {
    uint8_t first = RAM[FIELDS[i]];
    RAM[FIELDS[i]] = RAM[FIELDS[i] + 3];
    RAM[FIELDS[i] + 3] = first;
  }
}

// Whether a sprite is on the screen along one axis: the object's place plus the sprite's place around it has to stay in
// the screen's 256, and a place before the object's can't go below 0. The original works this out after it has written
// the sum, so $9F keeps what it compared with.
static int on_screen(uint8_t object_at, uint8_t around) {
  if (object_at + around < 0x100) return 1;
  if (!(around & 0x80)) return 0;
  RAM[0x9F] = (uint8_t)-around;
  return object_at >= RAM[0x9F];
}

// Where a table's entry for `index` is, as the original's shift and add find it.
static uint16_t entry(uint16_t table, uint8_t index) { return (uint16_t)(table + ((index << 1) & 0xFF) + (index >> 7)); }

// sub_04_80D0: each listed object's sprites, from its shape. A shape is a count, which set of places it uses, and a tile
// and its bits for each sprite; a tile of $FF is a sprite the shape leaves out. It stops if the sprites run past $03FF.
static void make_sprites(void) {
  uint16_t listed = LIST, out = SPRITES;
  set_ram16(0x29, listed);
  set_ram16(0x2B, out);
  for (; RAM[listed + 2] != 0xFF; listed += 4, set_ram16(0x29, listed)) {
    uint8_t y = RAM[listed], x = RAM[listed + 3];
    uint16_t shape = peek16((uint16_t)(SHAPES + RAM[listed + 1] * 2));
    RAM[0x23] = peek(shape);
    uint16_t places = peek16(entry(PLACES, peek((uint16_t)(shape + 1))));
    set_ram16(0x24, entry(COLOURS, RAM[listed + 2]));
    uint16_t colours = peek16(ram16(0x24));
    shape += 2;
    for (; RAM[0x23]; RAM[0x23]--, shape += 2, places += 2, colours++) {
      set_ram16(0x26, (uint16_t)(shape + 2));
      set_ram16(0x2D, (uint16_t)(colours + 1));
      set_ram16(0x2F, (uint16_t)(places + 2));
      uint8_t tile = peek(shape);
      if (tile == 0xFF) continue;
      RAM[out + 1] = tile;
      RAM[out + 3] = (uint8_t)(x + peek(places));
      if (!on_screen(x, peek(places))) continue;
      RAM[out] = (uint8_t)(y + peek((uint16_t)(places + 1)));
      if (!on_screen(y, peek((uint16_t)(places + 1)))) continue;
      RAM[out + 2] = peek(colours) | peek((uint16_t)(shape + 1));
      out += 4;
      set_ram16(0x2B, out);
      if (out >= 0x0400) return;
    }
  }
}

// $8000 in bank 4: the objects that are shown, at most 20, are listed at $0480 with where they are, their shape and
// their colours; their sprites are made at $0200, with the rest of the 64 put below the screen.
static void list_sprites(void) {
  swap_first_and_fourth();
  uint8_t listed = 0;
  for (int object = 0; object < OBJECTS && listed < LIST_MOST; object++) {
    if (!(RAM[OBJECT_FLAGS + object] & OBJECT_FLAG_SHOWN)) continue;
    RAM[LIST + listed++] = RAM[OBJECT_SCREEN_Y + object];
    RAM[LIST + listed++] = RAM[OBJECT_SHAPE + object];
    RAM[LIST + listed++] = RAM[OBJECT_COLOURS + object];
    RAM[LIST + listed++] = RAM[OBJECT_SCREEN_X + object];
  }
  for (int i = 0; i < 4; i++) RAM[LIST + listed++] = 0xFF;
  make_sprites();
  for (uint16_t at = ram16(0x2B); at < SPRITES_BACKWARDS; at++) RAM[at] = 0xFF;
  set_ram16(0x26, SPRITES_BACKWARDS);
}

// $8069: the same sprites backwards at $0300, and the first and fourth objects back in their places.
static void list_sprites_backwards(void) {
  for (int sprite = 0; sprite < 64; sprite++) for (int i = 0; i < 4; i++) RAM[SPRITES_BACKWARDS + sprite * 4 + i] = RAM[SPRITES + (63 - sprite) * 4 + i];
  RAM[0x22] = 0;
  swap_first_and_fourth();
}

// $F34F, the sprites' task. In a round that started late, V-blank comes while the list is filled, so it sends the new
// list at $0200 or the last round's at $0300, whichever's turn it is, and the task goes on after it (main.c).
wait sprites_task(void) {
  enum { LIST_THEM, BACKWARDS };
  uint8_t *step = &task_step[TASK_SPRITES];
  if (*step == LIST_THEM) {
    switch_bank(4);
    list_sprites();
    *step = BACKWARDS;
    if (round_started_late()) return SPINS;
  }
  list_sprites_backwards();
  switch_bank(BANK_HOME);
  *step = LIST_THEM;
  return YIELDS;
}
