// The Moon Zone (the extra stage): Super Sonic, the Super Egg Robo, the ground scroll, the Earth and stars on BG1,
// the WARNING sign, and the display effects. Translated from the JavaScript version's engine/extra.js,
// engine/extrarender.js, engine/supersonic.js and engine/eggrobo.js (SAT-R decompilation: player_super_sonic.c,
// boss_xtra_super_egg_robot.c, backgrounds/zone_7_act_2.c).

#ifndef SA_EXTRA_H
#define SA_EXTRA_H

#include "objects.h"

extern const Level ACT_THE_MOON;

enum {
  MOON_START_RINGS = 50,
  MOON_SCATTER_GRAVITY = 7,
};

typedef struct {
  uint16_t dispCnt, winIn, winOut, bldCnt, bldY;
  int win0On, win0Top, win0Bottom;
  uint8_t win0Lines[DISPLAY_HEIGHT * 2];
} MoonDisplay;

extern MoonDisplay moon_disp;

int moon_ground_scroll(int camX, int tick);
void moon_load_stage(void);
void moon_warning_start(void);
void moon_defeated(void);
/** The robot's task has started the save (CreateExtraStageResults): the frame's other tasks don't run. */
int moon_saving(void);

// Super Sonic (supersonic.c)
void supersonic_init(Player *p, int x, int y);
void supersonic_step(Player *p, const PlayerInput *in);
void supersonic_animate(Player *p);
void supersonic_draw(Player *p, int camX, int camY);
int hurt_super_sonic(Player *p);
void supersonic_follow_ground(Player *p);
int supersonic_dashing(const Player *p);
void supersonic_bounce(Player *p);
void supersonic_capture(int hold);
void supersonic_captured_step(void);
int supersonic_captured(void);

// Super Egg Robo (eggrobo.c)
ActTask *super_egg_robo_spawn(Slot *slot);
void moon_warning_ready(void);
int moon_boss_down(void);
void moon_boss_brake_dust(int x, int y, int dx);

#endif
