// Sonic Advance Dreamport, the stricter way (docs/STANDARD.md, Twins and their proof): the trial of #1455, a second
// version in C beside the game's own, made a function at a time. Every function here but the few lines below is the
// twin of one of the original's, with every value where the console keeps it, and has its proof in
// proof/proofs.json. src/main.js runs it on the page, built to WebAssembly as src/game.wasm (kit/gba/c/README.md).
//
// Nothing of it plays yet: the twins are being proven in the order the game runs them from power-on, and the game
// calls them from here once all that its logos run are proven.

#ifndef MATCHING
#include "console.h"
#include "animation.h"
#include "background.h"
#include "core.h"
#include "language.h"
#include "multi_sio.h"
#include "screen.h"
#include "stage.h"
#include "ui.h"
#include "logos.h"
#include "malloc.h"
#include "save.h"
#include "sprite.h"
#include "task.h"

// the twins no header of theirs declares
struct OamData *OamMalloc(u8 order);
void CreateTask_8011DBC(void);

// once: the console's work memory at the console's addresses, and the player's copy where the console has the cartridge
void game_start(void) { gba_console_memory(1); }

// every frame: nothing yet
void game_step(uint16_t keys) { (void)keys; }

// from an address kept in memory to the twin to call
TWIN_TABLE
#endif
