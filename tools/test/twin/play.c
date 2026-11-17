// The part of the function check's made-up program that only play reaches (../twin.mjs), with nothing from any game.
// The cartridge starts Play, which makes a stage once A is held and shines its lamp every frame from then on. Shine
// reads the lamp through the stage, the stage's room and the room's lamp, none of which is anywhere until play makes
// them: called from the memory the console has at power-on it reads address 0, where a twin can't follow, as most of
// a real game's functions do. Only a memory of play has a stage for it.
#include "program.h"

#define FULL 100

/** A lamp: how bright it is and how often it got to full. */
struct Lamp {
  u16 light;
  u16 lit;
};

/** A room, with its lamp. */
struct Room {
  u32 number;
  struct Lamp *lamp;
};

/** The stage play makes, with the room it's in. */
struct Stage {
  struct Room *room;
  u32 rooms;
};

extern struct Stage *gStage;

/** Shine, 0x08000400: the stage's lamp that much brighter, up to full, and counted each time it gets there. */
void Shine(u8 by) {
  struct Lamp *lamp = gStage->room->lamp;
  u32 light = lamp->light + by;

  if (light > FULL) {
    light = FULL;
    lamp->lit++;
  }
  lamp->light = light;
}

#ifdef MATCHING
// the line the screen is drawing, and the buttons, a bit each, 0 while held
#define LINE (*(volatile u16 *)0x04000006)
#define KEYS (*(volatile u16 *)0x04000130)
#define KEY_A 1
#define KEY_B 2

/** Play: the made-up game itself, which the cartridge starts and which never comes back, so it has no twin. Each
 *  frame, it makes the stage if A is held and there's none yet, or shines the stage's lamp, less with B held. */
void Play(void) {
  for (;;) {
    while (LINE != 160) {}
    while (LINE == 160) {}
    if (gStage) Shine(KEYS & KEY_B ? 7 : 1);
    else if (!(KEYS & KEY_A)) {
      struct Stage *stage = (struct Stage *)0x02000400;
      struct Room *room = (struct Room *)0x02000420;
      struct Lamp *lamp = (struct Lamp *)0x02000440;

      lamp->light = 0;
      lamp->lit = 0;
      room->number = 1;
      room->lamp = lamp;
      stage->room = room;
      stage->rooms = 1;
      gStage = stage;
    }
  }
}
#endif
