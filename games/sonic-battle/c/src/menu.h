// menu.js's list of nodes and its sprites, shared by the screens built on it (menu.c, options.c), as the JavaScript
// shares menu.js between the main menu and the options.

#ifndef SONIC_BATTLE_MENU_H
#define SONIC_BATTLE_MENU_H

#include "game.h"

/** A sprite's place (the first 16 bytes of a node's allocation): the parts it's made of, its own copy of them
 *  (options.js's chosen text), where, and what they add. */
typedef struct {
  uint32_t parts;
  int x, y, tile, attr0, attr1, attr2, state;
  uint8_t own;
  uint8_t own_parts[16];
} Place;

typedef struct Node Node;

/** A node of the screen's list: what it runs, the sprite it draws, and the counters its handlers keep. */
struct Node {
  void (*run)(Node *node);
  Place place;
  int count, to, tile, timer;
  int base_x, base_y;
  Node *left, *right;
  int scrolled;
  // the screen of Emerl's skills (skills.c): a choice's or a row's place in its list, its slot of tiles and picture,
  // the page the cursor has scrolled to, and the nodes a screen keeps hold of
  int row, slot, index, page;
  Node *cursor, *header, *chosen;
  Node *list[5];
  // the points shown at the top of a skill's grid: the seven digits and the slash between them
  Node *digits[7];
  // the list's order, as 0x0801f7d0 links it: the next node, and whether this one is still on the list
  int next, active;
};

/** menu.js's place(): a sprite's parts, where, and what they add. */
Place menuPlace(uint32_t parts, int x, int y, int tile, int attr2);
/** menu.js's record(): a sprite's record in the cartridge, as a place of its own. */
Place menuRecord(uint32_t at);
/** 0x0801f7d0: a node added at the end of the list. */
Node *menuAddNode(void (*run)(Node *), Place place, int hasPlace);
/** 0x0801f8c0: a node taken off the list, with the walk through the list going on from the next. */
void menuRemoveNode(Node *node);
/** 0x0801fed8: a sprite asks to be drawn this frame. */
void menuDraw(Place position);
/** 0x080200f8, the list's first node: no sprite has asked yet this frame, and no matrix is taken. */
void menuStartFrame(void);
/** The list emptied, as a screen's first frame does. */
void menuReset(void);
/** 0x08039fd0: the frame wrapper. Every node, a node added on the way too, and then the sprites they asked for. */
void menuFrame(void);
/** 0x0801fbfc: display registers from the cartridge's table at `from`, each its offset in 0x04000000 and its value. */
void menuWriteRegisters(uint32_t from, int count);

#endif
