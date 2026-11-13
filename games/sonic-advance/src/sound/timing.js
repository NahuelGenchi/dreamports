// Where the original's SoundMain runs in the console's frame, as the C version has it (c/src/main.c and soundlate.c):
// the kit's engine writes the squares on the cycles the original's does (#1240), as a square's phase lasts from note to
// note from power-on (kit/gba/notes/a-squares-phase-runs-from-power-on.md).
//
// SoundMain runs at one place in every frame, as the game's main loop reaches it, except in a frame where the game's own
// work runs past that place, as it does while it loads a screen: SoundMain then starts later, and so does every write it
// makes. The loads that do it are in the one table here, each with the frame it falls in and how late, as mGBA measures
// them: SoundMain's first instruction (0x08096AB0) in every frame of every recording, 82,606 cycles after the frame
// counter ticks give or take 8, and the recording and frame each entry comes from. The screens name the load as it
// starts (soundLate), and the engine hears it a frame ahead, as it hears every call: the music manager counts the frames
// down (lateCountdown).

import { LIBRARY } from '../../../../kit/gba/sound/costs.js';

// The original's clock against the kit's: mGBA's power-on is 71,058 cycles before the kit's chip starts its first frame.
// SoundMain starts 82,606 cycles after the frame counter ticks (52,558 into the chip's frame, from the kit's writes'
// mean against the original's), the sound FIFO's first refill each frame lands 84,969 cycles after it and halts the CPU
// for 58, and the H-blank DMA's first visible line 84,778 after it (54,918 and 54,727 in the chip's frame).
export const POWER_ON_BEFORE = 71058;
export const SOUND_TIMING = { library: LIBRARY.sonicAdvance, psgAt: 52558, fifoAt: 54918, fifoCost: 58, hblankAt: 54727 };

const ANY = -1;
const CHARACTER_SELECT = 'characterSelect', TURN_RIGHT = 'turnRight', TURN_LEFT = 'turnLeft', ACT_NEW_GAME = 'actNewGame';
const ACT_COURSE_SELECT = 'actCourseSelect', ACT_NEXT = 'actNext', ACT_AGAIN = 'actAgain', ACT_TIME_ATTACK = 'actTimeAttack';
export const LOAD = { CHARACTER_SELECT, TURN_RIGHT, TURN_LEFT, ACT_NEW_GAME, ACT_COURSE_SELECT, ACT_NEXT, ACT_AGAIN, ACT_TIME_ATTACK };
const SONIC = 0, TAILS = 1, KNUCKLES = 2, AMY = 3;
const NEO_GREEN_HILL_1 = 0, NEO_GREEN_HILL_2 = 1, SECRET_BASE_1 = 2, SECRET_BASE_2 = 3, CASINO_PARADISE_1 = 4,
  CASINO_PARADISE_2 = 5, ICE_MOUNTAIN_1 = 6, ICE_MOUNTAIN_2 = 7, ANGEL_ISLAND_1 = 8, ANGEL_ISLAND_2 = 9, EGG_ROCKET = 10,
  COSMIC_ANGEL = 11, X_ZONE = 12;

// [load, the level or character it's for or ANY, the character playing or ANY, frames after the one it starts in, cycles]
const LATE = [
  // the character select appearing, from the main menu (character-select, frame 1701; every recording through it)
  [CHARACTER_SELECT, ANY, ANY, 1, 726],
  // the row turning from each character, to the right and to the left, 4 frames on (character-select, frames 1814 to
  // 2186; amy-x-zone 1755 and 1795); turns that don't load anything are left out
  [TURN_RIGHT, SONIC, ANY, 4, 242], [TURN_RIGHT, KNUCKLES, ANY, 4, 386], [TURN_RIGHT, AMY, ANY, 4, 220],
  [TURN_LEFT, SONIC, ANY, 4, 61], [TURN_LEFT, KNUCKLES, ANY, 4, 571],
  // a new game's first act, from the character select, the frame after it's picked (amy-neo-green-hill 1867,
  // sonic-neo-green-hill 1777)
  [ACT_NEW_GAME, NEO_GREEN_HILL_1, ANY, 1, 6966],
  // an act from the course select, the frame after A (course-select-first-act 4000, neo-green-hill-act-2 4134,
  // secret-base-act-1 2018, amy-secret-base-act-2 2122, sonic-casino-paradise 2146, casino-2-opening 4907,
  // sonic-ice-mountain 2194, sonic-ice-mountain-act-2 2218, sonic-angel-island 2242, angel-island-act-2 2276,
  // sonic-egg-rocket 2290, amy-cosmic-angel 2314 and sonic-cosmic-angel 2276, amy-x-zone 2338, tails-x-zone 2298)
  [ACT_COURSE_SELECT, NEO_GREEN_HILL_1, ANY, 1, 10324], [ACT_COURSE_SELECT, NEO_GREEN_HILL_2, ANY, 1, 10324],
  [ACT_COURSE_SELECT, SECRET_BASE_1, ANY, 1, 1987], [ACT_COURSE_SELECT, SECRET_BASE_2, ANY, 1, 6715],
  [ACT_COURSE_SELECT, CASINO_PARADISE_1, ANY, 1, 8040], [ACT_COURSE_SELECT, CASINO_PARADISE_2, ANY, 1, 8042],
  [ACT_COURSE_SELECT, ICE_MOUNTAIN_1, ANY, 1, 14879], [ACT_COURSE_SELECT, ICE_MOUNTAIN_2, ANY, 1, 14879],
  [ACT_COURSE_SELECT, ANGEL_ISLAND_1, ANY, 1, 3486], [ACT_COURSE_SELECT, ANGEL_ISLAND_2, ANY, 1, 3548],
  [ACT_COURSE_SELECT, EGG_ROCKET, ANY, 1, 21216],
  [ACT_COURSE_SELECT, COSMIC_ANGEL, SONIC, 1, 5160], [ACT_COURSE_SELECT, COSMIC_ANGEL, ANY, 1, 5097],
  [ACT_COURSE_SELECT, X_ZONE, TAILS, 1, 8148], [ACT_COURSE_SELECT, X_ZONE, ANY, 1, 7956],
  // an act coming on as the one before it ends (sonic-neo-green-hill 7366, neo-green-hill-act-2 12643,
  // sonic-secret-base-act-2 10489, sonic-casino-paradise 6561, sonic-casino-paradise-act-2 12814,
  // sonic-ice-mountain 9176, sonic-ice-mountain-act-2 16584, egg-rocket 39045, sonic-cosmic-angel 17781)
  [ACT_NEXT, NEO_GREEN_HILL_2, ANY, 1, 7598], [ACT_NEXT, SECRET_BASE_1, ANY, 2, 4591],
  [ACT_NEXT, CASINO_PARADISE_1, ANY, 1, 6082], [ACT_NEXT, CASINO_PARADISE_2, ANY, 1, 5262],
  [ACT_NEXT, ICE_MOUNTAIN_1, ANY, 1, 13797], [ACT_NEXT, ICE_MOUNTAIN_2, ANY, 1, 13094],
  [ACT_NEXT, ANGEL_ISLAND_1, ANY, 1, 2523], [ACT_NEXT, COSMIC_ANGEL, ANY, 1, 3565], [ACT_NEXT, X_ZONE, ANY, 1, 5082],
  // X Zone again after a life is lost (amy-x-zone 5887, tails-x-zone 4048 and 5604, knuckles-x-zone 4068)
  [ACT_AGAIN, X_ZONE, ANY, 1, 7202],
  // a Time Attack act, from its card or the lobby's choice to run it again, the frame after (time-attack-card 2505,
  // time-attack-result 10143); the C has no Time Attack yet
  [ACT_TIME_ATTACK, ANY, ANY, 1, 6990],
];

// The acts whose backgrounds scroll by the line on every frame they draw (Neo Green Hill, Secret Base act 2, Casino
// Paradise and Cosmic Angel), which keeps the H-blank DMA on, a line of two 16-bit values at a time: 6 cycles a line
// taken from SoundMain (the C's set_hblank_copy and gba_sound_hblank_dma)
export const ACTS_WITH_LINES = new Set([0, 1, 3, 4, 5, 11]);
export const LINES_DMA = 6;

/** The game's side: a load starts this frame, with the level or character it's for and the character playing. */
export function soundLate(sound, load, detail, character) {
  const row = LATE.find(([l, d, c]) => l === load && (d === ANY || d === detail) && (c === ANY || c === character));
  if (row) sound?.call?.('lateIn', row[3], row[4]);
}

/** The music manager's side (music.js): `lateIn(frames, cycles)` arrives a frame after the load starts, and the
 *  engine's SoundMain runs `cycles` late in the sound frame `frames` frames after the load's. */
export function lateCountdown(engine) {
  let pending = null;
  return {
    /** at the start of each sound frame, before its calls */
    frame() { if (pending && --pending.frames === 0) { engine.late(pending.cycles); pending = null; } },
    lateIn(frames, cycles) {
      if (frames <= 1) engine.late(cycles);
      else pending = { frames: frames - 1, cycles };
    },
  };
}
