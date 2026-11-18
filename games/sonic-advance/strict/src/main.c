// Sonic Advance Dreamport, the stricter way (docs/STANDARD.md, Twins and their proof): the trial of #1455, a second
// version in C beside the game's own, made a function at a time. Every function here but the few lines below is the
// twin of one of the original's, with every value where the console keeps it, and has its proof in
// proof/proofs.json. src/main.js runs it on the page, built to WebAssembly as src/game.wasm (kit/gba/c/README.md).
//
// Nothing of it plays yet: the twins are being proven in the order the game runs them from power-on, and the game
// calls them from here once all that its logos run are proven.
//
// Its twins follow SAT-R's decompilation of Sonic Advance (https://github.com/SAT-R/sa1 at fdd8956).

#ifndef MATCHING
#include "console.h"
#include "animation.h"
#include "background.h"
#include "bg_triangles.h"
#include "core.h"
#include "language.h"
#include "multi_sio.h"
#include "screen.h"
#include "stage.h"
#include "ui.h"
#include "logos.h"
#include "malloc.h"
#include "flash.h"
#include "m4a_internal.h"
#include "save.h"
#include "spotlight.h"
#include "sprite.h"
#include "task.h"

// the twins no header of theirs declares
struct OamData *OamMalloc(u8 order);
void MP2K_event_null(void);
void SoundMainBTM(void *at);

// the console's start and what the page gives it each frame (hardware.c)
void console_power_on(void);
void console_set_keys(u16 keys);
void console_start(void);
void sub_8063E8C(u16 arg0);
void Task_80640C8(void);
void sub_8064244(void);
void Task_8065058(void);
void Task_806515C(void);
void Task_IntroChaosEmeraldUpdate(void);

// once: the console's work memory at the console's addresses, and the player's copy where the console has the cartridge
void game_start(void) {
  gba_console_memory(1);
  console_power_on();
}

// every frame: the buttons held, then the game from where it last waited for the V-blank to its next wait
void game_step(uint16_t keys) {
  console_set_keys(keys);
  kit_run(console_start);
}

// from an address kept in memory to the twin to call
TWIN_TABLE
#endif
