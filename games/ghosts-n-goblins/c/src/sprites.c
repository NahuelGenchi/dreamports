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
    took(SPRITES_SWAP_READ);
    RAM[FIELDS[i]] = RAM[FIELDS[i] + 3];
    took(SPRITES_SWAP_FIRST_STORED);
    RAM[FIELDS[i] + 3] = first;
    took(SPRITES_SWAP_FOURTH_STORED);
  }
  took(RETURNS);
}

// Whether a sprite is on the screen along one axis: the object's place plus the sprite's place around it has to stay in
// the screen's 256, and a place before the object's can't go below 0. The original works this out after it has written
// the sum, so $9F keeps what it compared with.
static int on_screen(uint8_t object_at, uint8_t around) {
  if (object_at + around < 0x100) return 1;
  if (!(around & 0x80)) { took(SPRITES_SPRITE_OFF_RIGHT); return 0; }
  RAM[0x9F] = (uint8_t)-around;
  took(object_at >= RAM[0x9F] ? SPRITES_SPRITE_PAST_EDGE : SPRITES_SPRITE_OFF_LEFT);
  return object_at >= RAM[0x9F];
}

// Where a table's entry for `index` is, as the original's shift and add find it.
static uint16_t entry(uint16_t table, uint8_t index) { return (uint16_t)(table + ((index << 1) & 0xFF) + (index >> 7)); }

// A two-byte entry of one of the copy's tables.
static uint16_t table_word(uint16_t at) {
  if ((at & 0xFF) == 0xFF) took(SPRITES_TABLE_PAST_PAGE);
  return peek16(at);
}

// sub_04_81D6, sub_04_81DD and sub_04_81E4: one of the three pointers moves on by one.
static void pointer_on(uint16_t *pointer) {
  (*pointer)++;
  took(SPRITES_POINTER_ON);
  if (!(*pointer & 0xFF)) took(SPRITES_POINTER_NEXT_PAGE);
}

// sub_04_80D0: each listed object's sprites, from its shape. A shape is a count, which set of places it uses, and a tile
// and its bits for each sprite; a tile of $FF is a sprite the shape leaves out. It stops if the sprites run past $03FF.
static void make_sprites(void) {
  uint16_t listed = LIST, out = SPRITES;
  set_ram16(0x29, listed);
  set_ram16(0x2B, out);
  for (; RAM[listed + 2] != 0xFF; listed += 4, set_ram16(0x29, listed)) {
    uint8_t y = RAM[listed], x = RAM[listed + 3];
    took(SPRITES_SHAPE);
    uint16_t shape = table_word((uint16_t)(SHAPES + RAM[listed + 1] * 2));
    RAM[0x23] = peek(shape);
    pointer_on(&shape);
    uint16_t places = table_word(entry(PLACES, peek(shape)));
    pointer_on(&shape);
    set_ram16(0x24, entry(COLOURS, RAM[listed + 2]));
    uint16_t colours = table_word(ram16(0x24));
    for (; RAM[0x23]; RAM[0x23]--) {
      uint8_t tile = peek(shape);
      if (tile == 0xFF) {
        // $81BD: past this sprite in all three lists
        took(SPRITES_SPRITE_LEFT_OUT);
        pointer_on(&places);
      } else {
        took(SPRITES_SPRITE_TILE_READ);
        RAM[out + 1] = tile;
        took(SPRITES_SPRITE_ACROSS_READ);
        RAM[out + 3] = (uint8_t)(x + peek(places));
        took(SPRITES_SPRITE_ACROSS_STORED);
        int shown = on_screen(x, peek(places));
        pointer_on(&places);
        if (shown) {
          took(SPRITES_SPRITE_DOWN_READ);
          RAM[out] = (uint8_t)(y + peek(places));
          took(SPRITES_SPRITE_DOWN_STORED);
          shown = on_screen(y, peek(places));
        }
        if (shown) {
          pointer_on(&places);
          pointer_on(&shape);
          took(SPRITES_SPRITE_COLOURS_READ);
          RAM[out + 2] = peek(colours) | peek(shape);
          took(SPRITES_SPRITE_COLOURS_STORED);
          pointer_on(&shape);
          pointer_on(&colours);
          took(SPRITES_SPRITE_NEXT);
          out += 4;
          set_ram16(0x2B, out);
          set_ram16(0x26, shape);
          set_ram16(0x2D, colours);
          set_ram16(0x2F, places);
          if (out >= 0x0400) return;
          took(SPRITES_SPRITE_COUNTED);
          took(RAM[0x23] > 1 ? GOES_ROUND : GOES_ON);
          continue;
        }
      }
      // $81C0: past the rest of a sprite that isn't made
      pointer_on(&shape);
      pointer_on(&shape);
      pointer_on(&colours);
      pointer_on(&places);
      took(SPRITES_SKIP_JUMP);
      took(SPRITES_SPRITE_COUNTED);
      took(RAM[0x23] > 1 ? GOES_ROUND : GOES_ON);
    }
    set_ram16(0x26, shape);
    set_ram16(0x2D, colours);
    set_ram16(0x2F, places);
    took(SPRITES_SHAPE_DONE);
  }
  took(SPRITES_MADE);
}

// $8000 in bank 4: the objects that are shown, at most 20, are listed at $0480 with where they are, their shape and
// their colours; their sprites are made at $0200, with the rest of the 64 put below the screen.
static void list_sprites(void) {
  took(CALLS);
  swap_first_and_fourth();
  took(SPRITES_LIST_BEGINS);
  uint8_t listed = 0;
  for (int object = 0; object < OBJECTS; object++) {
    if (object >= 0x10) took(SPRITES_OBJECT_PAST_PAGE);
    if (!(RAM[OBJECT_FLAGS + object] & OBJECT_FLAG_SHOWN)) took(SPRITES_OBJECT_HIDDEN);
    else {
      took(SPRITES_OBJECT_FIRST_BYTE);
      RAM[LIST + listed++] = RAM[OBJECT_SCREEN_Y + object];
      took(SPRITES_OBJECT_NEXT_BYTE);
      RAM[LIST + listed++] = RAM[OBJECT_SHAPE + object];
      took(SPRITES_OBJECT_NEXT_BYTE);
      RAM[LIST + listed++] = RAM[OBJECT_COLOURS + object];
      took(SPRITES_OBJECT_NEXT_BYTE);
      RAM[LIST + listed++] = RAM[OBJECT_SCREEN_X + object];
      if (listed >= LIST_MOST) { took(SPRITES_LIST_FULL); break; }
      took(SPRITES_OBJECT_LISTED);
    }
    took(object + 1 < OBJECTS ? GOES_ROUND : GOES_ON);
  }
  took(SPRITES_LIST_END_BEGINS);
  for (int i = 0; i < 4; i++) {
    took(SPRITES_LIST_END_READ);
    RAM[LIST + listed++] = 0xFF;
    took(SPRITES_LIST_END_BYTE);
    took(i < 3 ? GOES_ROUND : GOES_ON);
  }
  took(SPRITES_MAKE_BEGINS);
  make_sprites();
  took(SPRITES_FILL_BEGINS);
  set_ram16(0x26, ram16(0x2B));
  for (uint16_t at = ram16(0x2B); at < SPRITES_BACKWARDS; at++) {
    took(SPRITES_FILL_BYTE);
    RAM[at] = 0xFF;
    set_ram16(0x26, (uint16_t)(at + 1));
    took(SPRITES_FILL_NEXT);
    if (!((at + 1) & 0xFF)) took(SPRITES_POINTER_NEXT_PAGE);
  }
  took(SPRITES_FILL_OVER);
}

// $8069: the same sprites backwards at $0300, a byte at a time, and the first and fourth objects back in their places.
// V-blank often comes partway through, and sends the list as far as it has got.
static void list_sprites_backwards(void) {
  took(SPRITES_COPY_BEGINS);
  // with more than 64 sprites, the ones past the 64th were made at the second list's start, and the copy starts after them
  int first = (RAM[0x26] & 0xFC) / 4;
  for (int sprite = first; sprite < 64; sprite++) {
    took(SPRITES_COPY_SPRITE);
    for (int i = 0; i < 4; i++) {
      took(SPRITES_COPY_READ);
      RAM[SPRITES_BACKWARDS + sprite * 4 + i] = RAM[SPRITES + (63 - (sprite - first)) * 4 + i];
      RAM[0x22] = (uint8_t)(3 - i);
      took(SPRITES_COPY_STORED);
      took(i < 3 ? GOES_ROUND : GOES_ON);
    }
    took(SPRITES_COPY_SPRITE_DONE);
    took(sprite < 63 ? GOES_ROUND : GOES_ON);
  }
  swap_first_and_fourth();
}

// $F34F, the sprites' task
wait sprites_task(void) {
  enum { FIRST_TURN, LATER };
  if (task_step[TASK_SPRITES] == LATER) took(SPRITES_TASK_AGAIN);
  task_step[TASK_SPRITES] = LATER;
  took(SPRITES_TASK_BEGINS);
  switch_bank(4);
  list_sprites();
  list_sprites_backwards();
  switch_bank(BANK_HOME);
  took(SPRITES_TASK_ENDS);
  return YIELDS;
}
