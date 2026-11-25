/* A program of the project's own for the PlayStation's test of a game whose tasks are its parts (../ps1-parts.mjs): a
   square that crosses a screen of one colour, made up here, with nothing of any game in it. The same file is the
   program, built by the console's compiler and laid out as a PS-X EXE by the test, and the twins of its functions in
   the game's version in C. The test fills in each function's address where the @ signs are. */

#define TURNS_AT 60

/* Move, @MOVE@: the square's place across a frame on, two along, back at the left past 255 */
int Move(int x) {
  return (x + 2) & 0xFF;
}

/* Turn, @TURN@: the place across as it's shown once the square has turned, counted from the right */
int Turn(int x) {
  return 255 - x;
}

#ifdef MATCHING
/* What the console's build writes the hardware by: a register of the interrupts', and the GPU's two. */
#define REGISTER(address) (*(volatile unsigned long *)(address))
#define I_STAT REGISTER(0x1F801070)
#define I_MASK REGISTER(0x1F801074)
#define GP0 REGISTER(0x1F801810)
#define GP1 REGISTER(0x1F801814)
#else
/* And the game's version, through the kit. */
#include "ps1.h"
#endif

/* Start, @START@: where the console starts the program. It sets the screen, and then for ever waits for the V-blank,
   moves the square and draws it, turned from frame TURNS_AT on. Move never gives 256, so its loop goes round for ever,
   written so the compiler can't tell: after a loop it knows is endless GCC leaves the function's end, which nothing
   reaches, and the code map takes such code for a function of its own. The console's build writes the hardware and never
   comes back; the game's version sets the screen through the kit and comes back, as the kit runs a game a frame at a
   time, and what each frame does is the game's step (main.c). */
void Start(void) {
#ifdef MATCHING
  int x = 0, frame = 0;
  I_MASK = 0;
  I_STAT = 0xFFFFFFFE;
  GP1 = 0x00000000;
  GP1 = 0x08000001;
  GP1 = 0x06C60260;
  GP1 = 0x07040010;
  GP1 = 0x05000000;
  GP1 = 0x03000000;
  GP0 = 0xE3000000;
  GP0 = 0xE403BD3F;
  GP0 = 0xE5000000;
  do {
    while (!(I_STAT & 1)) {
    }
    I_STAT = 0xFFFFFFFE;
    x = Move(x);
    GP0 = 0x02402010;
    GP0 = 0;
    GP0 = 240 << 16 | 320;
    GP0 = 0x6000C0F0;
    GP0 = 100 << 16 | (frame >= TURNS_AT ? Turn(x) : x);
    GP0 = 32 << 16 | 32;
    frame++;
  } while (x != 256);
#else
  gpu_gp1(0x00000000);
  gpu_gp1(0x08000001);
  gpu_gp1(0x06C60260);
  gpu_gp1(0x07040010);
  gpu_gp1(0x05000000);
  gpu_gp1(0x03000000);
  gpu_gp0(0xE3000000);
  gpu_gp0(0xE403BD3F);
  gpu_gp0(0xE5000000);
#endif
}
