// The act's results (results.c): "SONIC GOT THROUGH ACT 1", the time and ring bonuses counting into the score,
// the fade out and the hand-over to the next act.
#ifndef RESULTS_H
#define RESULTS_H

/**
 * CreateStageResults. Call it when the goal hands over (Sonic in his act-clear run, past the goal post's 120 frames),
 * after the act has stopped its clock and rings and written the save's ring bank and unlocked level. It plays the
 * act-clear jingle, loads the results' graphics and starts the results' tasks. `nextFrame` is 1 when the goal's own
 * task runs after the results' in the frame order, so the results' first frame is the next one.
 */
void results_start(int level, int rings, int courseTime, int longEnd, int nextFrame);

/** Task_8057888 and its four pieces for one frame (priorities 0x2100 and 0x2120). Returns 0 on the frame the next act starts. */
int results_run(void);

/** The fade out, set over the act's display once the frame is drawn (like titlecard_display). */
void results_display(void);

/** 1 from results_start until results_run returns 0. */
int results_active(void);

/** The total frames the results run for, matching world.stageResults in JS (r.wait + 285). */
int results_wait_total(void);

#endif
