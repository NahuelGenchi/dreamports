// A program of the project's own for the rebuild's test (../rebuild.mjs), with nothing from any game: a few dots a
// frame on, every value at an address of the console's, and every function where a made-up cartridge has it.
#ifndef CART_H
#define CART_H

typedef unsigned char u8;
typedef unsigned int u32;
typedef signed short s16;
typedef signed int s32;

#define DOTS 4
#define WIDTH 240
#define HEIGHT 160

/** A dot: where it is, and how far it goes each frame. */
struct Dot {
  s16 x;
  s16 y;
  s16 dx;
  s16 dy;
};

extern struct Dot gDots[DOTS];
extern u32 gFrame;
// in the cartridge, after the code: how fast a dot of each kind goes
extern const u8 gSpeeds[8];

s32 Clamp(s32 value, s32 most);
void Step(struct Dot *dot);
void StepAll(void);
void *Stepper(void);
s32 Speed(u32 kind);

#endif
