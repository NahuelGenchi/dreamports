// A program of the project's own for the function check's test (../twin.mjs), with nothing from any game, written the
// way a twin is: every value at an address of the console's, and every function at one of a cartridge the test makes
// up. The console's compiler builds it into that cartridge, with MATCHING defined, and the same C is its twin.
#ifndef PROGRAM_H
#define PROGRAM_H

typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
typedef signed short s16;
typedef signed int s32;

#define FLOOR 152
#define TILES 0x06000000
#define SPRITE_TILES 0x06010000

/** A ball: where it is, how fast it falls and how often it met the floor. */
struct Ball {
  s16 x;
  s16 y;
  s16 speed;
  u16 hits;
};

extern struct Ball gBall;
extern u32 gFrame;
extern void (*gHandler)(void);
// in the cartridge: how much each kind of thing counts for
extern const u8 gSteps[4];

#ifdef MATCHING
// on the console a byte written to video memory is the hardware's to deal with
#define VIDEO8(address, value) (*(volatile u8 *)(address) = (value))
#else
// and in a Dreamport the kit does what the hardware would, in its own video memory (kit/gba/c/gba.h)
#include "gba.h"
#define VIDEO8(address, value) gba_vram_write8((address) - TILES, value)
#endif

void Fall(void);
u32 Scale(u32 value, u8 kind);
s32 Sum(s32 a, s32 b, s32 c, s32 d, s16 e);
void Paint(u8 colour);
void Step(void);
void Skip(void);
void Choose(u32 which);
void Run(void);

#endif
