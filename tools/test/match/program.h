// A program of the project's own, with nothing from any game, written the way a twin is: every value at an address
// of the console's, and every function at one of a cartridge the test makes up (../match.mjs).
#ifndef PROGRAM_H
#define PROGRAM_H

typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
typedef signed short s16;
typedef signed int s32;

#define BALLS 8
#define FLOOR 152

/** A ball: where it is, how fast it falls and what it's doing. */
struct Ball {
  s16 x;
  s16 y;
  u8 speed;
  u8 kind;
  u16 hits;
};

extern struct Ball gBalls[BALLS];
extern u32 gFrame;
extern u16 gUnknown_03000040;
void DrawBall(struct Ball *ball);
void sub_8000500(u32 frame);

s32 Bounce(s32 at, s32 edge);
u32 StepFor(u32 kind);
void MoveBall(struct Ball *ball);
void MoveBalls(void);

#endif
