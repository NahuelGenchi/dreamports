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
  // the record's 14th byte, which the Mini-games screen's rows keep the row they go to in
  int player;
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
  // whether the node is on the list, as 0x0801f8c0 takes one off
  int used;
  // the Mini-games screen's (minigames.c): the entry chosen, the first row shown, its four rows and its frames of waiting
  int selected, top, wait, index;
  Node *rows[4], *child;
};

/** menu.js's place(): a sprite's parts, where, and what they add. */
Place menuPlace(uint32_t parts, int x, int y, int tile, int attr2);
/** menu.js's record(): a sprite's record in the cartridge, as a place of its own. */
Place menuRecord(uint32_t at);
/** 0x0801f7d0: a node added at the end of the list. */
Node *menuAddNode(void (*run)(Node *), Place place, int hasPlace);
/** 0x0801fed8: a sprite asks to be drawn this frame. */
void menuDraw(Place position);
/** 0x080200f8, the list's first node: no sprite has asked yet this frame, and no matrix is taken. */
void menuStartFrame(void);
/** The list emptied, as a screen's first frame does. */
void menuReset(void);
/** 0x0801f8c0: a node taken off the list, with the walk through the list going on from the next. */
void menuRemoveNode(Node *node);
/** 0x0801fd18, with no turn: a sprite matrix that scales by 256 over `scale`, and its number. */
int menuTakeMatrix(int scale);
/** 0x0801f9d8: a sprite that only asks to be drawn. */
void menuDrawOnly(Node *node);
/** 0x080200f8 as a node of the list. */
void menuStartFrameNode(Node *node);
/** 0x08039dd8: the animated picture's block of the map, a new picture of the eight every four frames. */
void menuAnimate(Node *node);
/** 0x0801f718: a song's player fades out over `frames`, a step every sixteenth of them. */
void menuFadeSongOut(int song, int frames);
/** 0x0801fbfc: display registers from the cartridge's table at `from`, each its offset in 0x04000000 and its value. */
void menuWriteRegisters(uint32_t from, int count);
/** 0x08039e20's last step: the display queued on for the next V-blank, and the menu's frames from then on. */
void menuDisplayOn(void);
/** A node runs past a V-blank: the list goes on from that node in the next frame, with no sprites drawn in this one. */
void menuPause(void);
/** A frame's work runs past the next V-blank: with `spritesToo`, its sprites are all the next frame has, and without,
 *  the next frame of the list is lost. */
void menuRunsLate(int spritesToo);
/** 0x080211f0 and 0x08021244: the first of the six slots of letters nobody has, or six, and a slot given back. */
int menuTakeSlot(void);
void menuGiveSlot(int slot);
/** 0x08039fd0: the frame wrapper. Every node, a node added on the way too, and then the sprites they asked for. */
void menuFrame(void);

#endif
