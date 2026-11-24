// Sonic Advance Dreamport in C, made the stricter way (docs/STANDARD.md, Twins and their proof): a function at a
// time, as #1455 tried it and #1790 made it the game's version in C. Every function here but the few lines below is the
// twin of one of the original's, with every value where the console keeps it, and has its proof in
// proof/proofs.json. src/main.js runs it on the page, built to WebAssembly as src/game.wasm (kit/gba/c/README.md).
//
// It plays as far as its twins go: from power-on through its logos and the story's opening to the title screen's
// first frames, the same as the original's (proof/progress.json). The twins are made in the order the game runs them.
//
// Its twins follow SAT-R's decompilation of Sonic Advance (https://github.com/SAT-R/sa1 at fdd8956).

#ifndef MATCHING
#include "console.h"
#include "animation.h"
#include "background.h"
#include "bg_anim.h"
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
#include "save.h"
#include "spotlight.h"
#include "sprite.h"
#include "task.h"
// the shared sound engine the game takes from the kit (kit/gba/c/lib/m4a/, proof/libraries.json)
#include "m4a_internal.h"

// the twins no header of theirs declares
struct OamData *OamMalloc(u8 order);
void Timer1Intr(void);
// and those of the compiler's helpers and the BIOS's stubs the game takes from the kit (kit/gba/c/lib/libgcc/ and
// bios/), which only the twins' table names
unsigned int _call_via_r0(void), _call_via_r1(void), _call_via_r2(void), _call_via_r3(void), _call_via_r4(void);
unsigned int _call_via_r5(void), _call_via_r6(void), _call_via_r7(void), _call_via_r8(void), _call_via_r9(void);
unsigned int _call_via_sl(void), _call_via_fp(void), _call_via_ip(void), _call_via_sp(void), _call_via_lr(void);
int __divsi3(int numerator, int denominator);
void __div0(void);
int Div(int num, int denom), Mod(int num, int denom);
// and the cartridge's own start, in ARM code, which does nothing here (crt0.c)
void CartridgeStart(void), CartridgeInit(void), IntrMainArm(void);
// and the C library's, whose twins are the console's build's alone (kit/gba/c/lib/newlib/): here the kit's own
void *memcpy(void *dest, const void *src, unsigned long n);
void *memset(void *dest, int c, unsigned long n);

// the console's start and what the page gives it each frame (hardware.c)
void console_power_on(void);
void console_set_keys(u16 keys);
void console_start(void);
void Task_LoadGameLogo(void);
void TaskDestructor_TitleScreen(struct Task *t);
void IntroOpenTitlescreenSilent(void);
void TaskDestructor_8065810(struct Task *t);
void IntroOpenTitlescreenPlayMusic(void);
void sub_8063B8C(void);
void sub_8063C4C(void);
void sub_8063D0C(void);
void sub_8063DCC(void);
void sub_8063E8C(u16 arg0);
void Task_80640C8(void);
void sub_8064244(void);
void sub_80645E4(void);
void sub_80648D4(void);
void sub_8064BB4(void);
void sub_8064E84(void);
void Task_8065058(void);
void Task_806515C(void);
void Task_RenderSonic(void);
void Task_IntroRenderTails(void);
void Task_IntroRenderKnuckles(void);
void Task_IntroRenderAmy(void);
void Task_806562C(void);
void sub_80656A4(void);
void sub_806571C(void);
void sub_8065794(void);
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
