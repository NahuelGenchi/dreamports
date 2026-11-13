// Where the original's SoundMain runs late. SoundMain runs at one place in every frame (SOUND_MAIN_AT, main.c), as the
// game's main loop reaches it, except in a frame where the game's own work runs past that place, as it does while it
// loads a screen: SoundMain then starts later, and so does every write to the sound chip it makes, which a square's
// phase keeps from then on (#1240). The loads that do it are in this one table, each with the frame it falls in and
// how late, as mGBA measures them: SoundMain's first instruction (0x08096AB0) in every frame of every recording, 82,606
// cycles after the frame counter ticks give or take 8, and the recording and frame each entry comes from. The screens
// name the load as it starts (sound_late), and the kit hears it a frame ahead, as it hears every call (gba_sound_late).

#include "sa.h"
#include "act.h"

#define ANY -1

static const struct {
  int load, detail, character;   // the load, the level or character it's for, and the character playing, or ANY
  int frames, cycles;             // how many frames after the one the load starts in, and how late
} LATE[] = {
  // the character select appearing, from the main menu (character-select, frame 1701; every recording through it)
  { LOAD_CHARACTER_SELECT, ANY, ANY, 1, 726 },
  // the row turning from each character (detail), to the right and to the left, 4 frames on (character-select,
  // frames 1814 to 2186; amy-x-zone 1755 and 1795); turns that don't load anything are left out
  { LOAD_TURN_RIGHT, CHARACTER_SONIC, ANY, 4, 242 }, { LOAD_TURN_RIGHT, CHARACTER_KNUCKLES, ANY, 4, 386 },
  { LOAD_TURN_RIGHT, CHARACTER_AMY, ANY, 4, 220 },
  { LOAD_TURN_LEFT, CHARACTER_SONIC, ANY, 4, 61 }, { LOAD_TURN_LEFT, CHARACTER_KNUCKLES, ANY, 4, 571 },
  // a new game's first act, from the character select, the frame after it's picked (amy-neo-green-hill 1867,
  // sonic-neo-green-hill 1777)
  { LOAD_ACT_NEW_GAME, LEVEL_NEO_GREEN_HILL_1, ANY, 1, 6966 },
  // an act from the course select, the frame after A (course-select-first-act 4000, neo-green-hill-act-2 4134,
  // secret-base-act-1 2018, amy-secret-base-act-2 2122, sonic-casino-paradise 2146, casino-2-opening 4907,
  // sonic-ice-mountain 2194, sonic-ice-mountain-act-2 2218, sonic-angel-island 2242, angel-island-act-2 2276,
  // sonic-egg-rocket 2290, amy-cosmic-angel 2314 and sonic-cosmic-angel 2276, amy-x-zone 2338, tails-x-zone 2298)
  { LOAD_ACT_COURSE_SELECT, LEVEL_NEO_GREEN_HILL_1, ANY, 1, 10324 },
  { LOAD_ACT_COURSE_SELECT, LEVEL_NEO_GREEN_HILL_2, ANY, 1, 10324 },
  { LOAD_ACT_COURSE_SELECT, LEVEL_SECRET_BASE_1, ANY, 1, 1987 },
  { LOAD_ACT_COURSE_SELECT, LEVEL_SECRET_BASE_2, ANY, 1, 6715 },
  { LOAD_ACT_COURSE_SELECT, LEVEL_CASINO_PARADISE_1, ANY, 1, 8040 },
  { LOAD_ACT_COURSE_SELECT, LEVEL_CASINO_PARADISE_2, ANY, 1, 8042 },
  { LOAD_ACT_COURSE_SELECT, LEVEL_ICE_MOUNTAIN_1, ANY, 1, 14879 },
  { LOAD_ACT_COURSE_SELECT, LEVEL_ICE_MOUNTAIN_2, ANY, 1, 14879 },
  { LOAD_ACT_COURSE_SELECT, LEVEL_ANGEL_ISLAND_1, ANY, 1, 3486 },
  { LOAD_ACT_COURSE_SELECT, LEVEL_ANGEL_ISLAND_2, ANY, 1, 3548 },
  { LOAD_ACT_COURSE_SELECT, LEVEL_EGG_ROCKET, ANY, 1, 21216 },
  { LOAD_ACT_COURSE_SELECT, LEVEL_COSMIC_ANGEL, CHARACTER_SONIC, 1, 5160 },
  { LOAD_ACT_COURSE_SELECT, LEVEL_COSMIC_ANGEL, ANY, 1, 5097 },
  { LOAD_ACT_COURSE_SELECT, LEVEL_X_ZONE, CHARACTER_TAILS, 1, 8148 },
  { LOAD_ACT_COURSE_SELECT, LEVEL_X_ZONE, ANY, 1, 7956 },
  // an act coming on as the one before it ends (sonic-neo-green-hill 7366, neo-green-hill-act-2 12643,
  // sonic-secret-base-act-2 10489, sonic-casino-paradise 6561, sonic-casino-paradise-act-2 12814,
  // sonic-ice-mountain 9176, sonic-ice-mountain-act-2 16584, egg-rocket 39045, sonic-cosmic-angel 17781)
  { LOAD_ACT_NEXT, LEVEL_NEO_GREEN_HILL_2, ANY, 1, 7598 },
  { LOAD_ACT_NEXT, LEVEL_SECRET_BASE_1, ANY, 2, 4591 },
  { LOAD_ACT_NEXT, LEVEL_CASINO_PARADISE_1, ANY, 1, 6082 },
  { LOAD_ACT_NEXT, LEVEL_CASINO_PARADISE_2, ANY, 1, 5262 },
  { LOAD_ACT_NEXT, LEVEL_ICE_MOUNTAIN_1, ANY, 1, 13797 },
  { LOAD_ACT_NEXT, LEVEL_ICE_MOUNTAIN_2, ANY, 1, 13094 },
  { LOAD_ACT_NEXT, LEVEL_ANGEL_ISLAND_1, ANY, 1, 2523 },
  { LOAD_ACT_NEXT, LEVEL_COSMIC_ANGEL, ANY, 1, 3565 },
  { LOAD_ACT_NEXT, LEVEL_X_ZONE, ANY, 1, 5082 },
  // X Zone again after a life is lost (amy-x-zone 5887, tails-x-zone 4048 and 5604, knuckles-x-zone 4068)
  { LOAD_ACT_AGAIN, LEVEL_X_ZONE, ANY, 1, 7202 },
};

static struct { int frames, cycles; } pending;

void sound_late(int load, int detail) {
  for (unsigned i = 0; i < sizeof LATE / sizeof *LATE; i++) {
    if (LATE[i].load != load || (LATE[i].detail != ANY && LATE[i].detail != detail)) continue;
    if (LATE[i].character != ANY && LATE[i].character != ctx.character) continue;
    pending.frames = LATE[i].frames; pending.cycles = LATE[i].cycles;
    return;
  }
}

// once a frame, at its end: the frame before the late one tells the kit
void sound_late_step(void) {
  if (pending.frames > 0 && --pending.frames == 0) gba_sound_late(pending.cycles);
}
