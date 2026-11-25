// The game of the PlayStation's test of a game whose tasks are its parts (../ps1-parts.mjs), on the PlayStation's kit
// in C: what the program's start does each frame (program.c, Start), written as a game's C on the kit is, a frame at a
// time, as the kit runs a game. It writes the GPU the same words, and each frame calls the twins of the program's two
// functions, Move and Turn, where the program calls them. The program waits for the V-blank where this one's frame
// starts.

#include "ps1.h"

#define TURNS_AT 60

int Move(int x);
int Turn(int x);
void Start(void);

static int x, frame;

// the start sets the screen, as the program's does before its first wait
void game_start(void) { Start(); }

void game_step(uint32_t buttons) {
  x = Move(x);
  gpu_gp0(0x02402010);
  gpu_gp0(0);
  gpu_gp0(240 << 16 | 320);
  gpu_gp0(0x6000C0F0);
  gpu_gp0(100 << 16 | (uint32_t)(frame >= TURNS_AT ? Turn(x) : x));
  gpu_gp0(32 << 16 | 32);
  frame++;
}

void game_draw(void) { gpu_show(); }

void game_sound(float *left, float *right, int count) {}
