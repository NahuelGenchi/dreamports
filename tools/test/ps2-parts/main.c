// The game of the PlayStation 2's test of a game whose tasks are its parts (../ps2-parts.mjs), on the PlayStation 2's
// kit in C: what the program does each frame (program.c, Start), written as a game's C on the kit is, a frame at a
// time, as the kit runs a game. It sends the GS the same packet, and each frame calls the twins of the program's two
// functions, Move and Turn, where the program calls them. The program waits for the V-blank where this one's frame
// starts.

#include "ps2.h"
#include "program.h"

int Move(int x);
int Turn(int x);
void Boot(void);

static uint32_t packet[] = PACKET;
static int x, frame;

// the start sets the screen, as the program's does before its first wait
void game_start(void) { Boot(); }

void game_step(uint32_t buttons) {
  x = Move(x);
  int shown = frame >= TURNS_AT ? Turn(x) : x;
  packet[SQUARE] = (uint32_t)CORNER(shown);
  packet[SQUARE + 4] = (uint32_t)FAR_CORNER(shown);
  gif_send(packet, sizeof packet);
  frame++;
}

void game_draw(void) { gs_show(); }

void game_sound(float *left, float *right, int count) {}
