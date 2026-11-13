// The special stages between two runs of an act, translated from special/run.js and its hand-over in main.js
// (enterSpecialStage): the fall into the stage when the character leaves the act on a special spring, the stage with
// its title card and rings counter, the Chaos Emerald's scene when it is won, the results, and then the act again from
// the spring. Each screen makes the next as the original's create functions call each other (special.h).
//
// The JavaScript version starts the special stage on a new engine and video of its own (createSpecialStageRun), once
// the act's last frame is over, and draws nothing for that frame; so does this, on the one engine (front.c).

#include "special.h"
#include "act.h"

SpecialGame spGame;
int spStageIndex;

/** The special stage of spGame.level, from the fall into it; gFrameCount goes on through it, a frame each frame. */
void special_stage_enter(void) {
  spStageIndex = sp_stage_of_level(spGame.level);
  uint32_t frameCount = e.frameCount;
  front_new_engine();
  engine_clear_video();
  e.frameCount = frameCount;
  sp_intro_create();
}

/** The results are over: the special stage stops every music player, and the act starts again from the spring (act.c),
 *  with what the special stage changed. */
void special_stage_back(void) {
  stop_all_songs();
  SAVE_CHAOS_EMERALDS = (uint8_t)spGame.emeralds;
  uint32_t frameCount = e.frameCount;
  front_new_engine();
  engine_clear_video();
  e.frameCount = frameCount;
  act_come_back();
}
