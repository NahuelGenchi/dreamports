// The part of the function check's made-up program that only play reaches (../twin.mjs), with nothing from any game.
// The cartridge starts Play, which makes a stage once A is held and shines its lamp every frame from then on. Shine
// reads the lamp through the stage, the stage's room and the room's lamp, none of which is anywhere until play makes
// them: called from the memory the console has at power-on it reads address 0, where a twin can't follow, as most of
// a real game's functions do. Only a memory of play has a stage for it. Play also puts a little code of its own in the
// fast work memory, as a game copies code there to run it faster, and Glow runs it every frame: that code loads a
// constant from beside itself, which is the code's and not a value the check may change (#1518). Every other frame
// the stage has a spare room, its own, and Spare, called on the frames it has none, counts that room's lamp when there
// is one: from its own memories a call never has one, and only a word the game kept there in another memory of play
// is a room to aim it with (#1709).
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

/** The stage play makes, with the room it's in, its spare room, if it has one, and how many frames it's been played. */
struct Stage {
  struct Room *room;
  u32 rooms;
  struct Room *spare;
  u32 frames;
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

// where play puts its code in the fast work memory, and the constant that code loads from beside itself
#define GLOW_CODE 0x03000200
#define GLOW 0x5EED1234

/** Glow, 0x08000800: the stage's lamp's count as the code play put in the fast work memory gives it. */
void Glow(void) {
#ifdef MATCHING
  gStage->room->lamp->lit = ((u32(*)(void))(GLOW_CODE | 1))();
#else
  // what that code does: it gives back its constant
  gStage->room->lamp->lit = GLOW;
#endif
}

/** Spare, 0x08000880: the spare room's lamp counted twice, if the stage has one. */
void Spare(void) {
  struct Room *spare = gStage->spare;

  if (spare)
    spare->lamp->lit += 2;
}

#ifdef MATCHING
// the line the screen is drawing, and the buttons, a bit each, 0 while held
#define LINE (*(volatile u16 *)0x04000006)
#define KEYS (*(volatile u16 *)0x04000130)
#define KEY_A 1
#define KEY_B 2

/** Play: the made-up game itself, which the cartridge starts and which never comes back, so it has no twin. Each
 *  frame, it makes the stage if A is held and there's none yet, with its code in the fast work memory, or shines the
 *  stage's lamp, less with B held, and has it glow. */
void Play(void) {
  for (;;) {
    while (LINE != 160) {}
    while (LINE == 160) {}
    if (gStage) {
      struct Stage *stage = gStage;

      stage->spare = ++stage->frames & 1 ? stage->room : 0;
      Shine(KEYS & KEY_B ? 7 : 1);
      Glow();
      if (!stage->spare)
        Spare();
    } else if (!(KEYS & KEY_A)) {
      u16 *code = (u16 *)GLOW_CODE;
      struct Stage *stage = (struct Stage *)0x02000400;
      struct Room *room = (struct Room *)0x02000420;
      struct Lamp *lamp = (struct Lamp *)0x02000440;

      lamp->light = 0;
      lamp->lit = 0;
      room->number = 1;
      room->lamp = lamp;
      stage->room = room;
      stage->rooms = 1;
      stage->spare = 0;
      stage->frames = 0;
      // ldr r0, [pc, #0] and bx lr: the word after them
      code[0] = 0x4800;
      code[1] = 0x4770;
      *(u32 *)(GLOW_CODE + 4) = GLOW;
      gStage = stage;
    }
  }
}
#endif
