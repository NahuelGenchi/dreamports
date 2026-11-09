// The title card, translated from the JavaScript version's engine/titlecard.js and rom/titlecard.js (SAT-R's
// src/game/stage/ui_z.c: sub_80550F8, Task_8055458 and the six tasks it makes), with its pictures: six pieces slide
// in over the act while the screen fades in from black, hold, and slide out; the HUD takes their place a frame later.

#ifndef SA_TITLECARD_H
#define SA_TITLECARD_H

#include "sa.h"

/** The card's first frame, on the act's first frame: loads its graphics into VRAM and sets its pieces up. */
void titlecard_start(int level, int character);
/** Runs the card's main task and its pieces for one frame; true while it draws, false on the frame it ends. */
int titlecard_step(int pressed);
/** Draws this frame's card after the act's own picture: its sprites, and the fade over the stage. */
void titlecard_draw(void);
/** Whether the card is still running. */
int titlecard_active(void);

#endif
