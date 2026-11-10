// Every level the game has, named once, and what the act's engine (act.c) asks of one: its row. The original keeps
// what differs between its stages in tables by level (its stage init procedures, sStageBgInitProcedures and each
// camera's fnBgUpdate), and so does this. Each act in C has a row of its own, in its zone's file, and the engine reads
// the row where it would otherwise name the level. A new act writes its row there and puts it in its line of
// levels.c: it needs no other line here or in act.c, so two acts made at once don't edit the same ones.

#ifndef SA_LEVELS_H
#define SA_LEVELS_H

#include <stdint.h>

// LEVEL_INDEX(zone, act): the zones' acts in the game's order, then the VS mode's Chao Hunt stages
enum {
  LEVEL_NEO_GREEN_HILL_1, LEVEL_NEO_GREEN_HILL_2, LEVEL_SECRET_BASE_1, LEVEL_SECRET_BASE_2,
  LEVEL_CASINO_PARADISE_1, LEVEL_CASINO_PARADISE_2, LEVEL_ICE_MOUNTAIN_1, LEVEL_ICE_MOUNTAIN_2,
  LEVEL_ANGEL_ISLAND_1, LEVEL_ANGEL_ISLAND_2, LEVEL_EGG_ROCKET, LEVEL_COSMIC_ANGEL, LEVEL_X_ZONE, LEVEL_THE_MOON,
  LEVEL_CHAO_HUNT_A, LEVEL_CHAO_HUNT_B, LEVEL_CHAO_HUNT_C, LEVEL_CHAO_HUNT_D,
  LEVEL_COUNT
};
// LEVEL_TO_ZONE: a level's zone is its index halved, so the zones with two acts each have a name
enum { ZONE_NEO_GREEN_HILL, ZONE_SECRET_BASE, ZONE_CASINO_PARADISE, ZONE_ICE_MOUNTAIN, ZONE_ANGEL_ISLAND };

typedef struct {
  // The stage init: the act's song, where the HUD's zero-ring flash starts, and the palette animations
  // palette_loader.c makes for it (LEVEL_PALETTES), each with its variant, or NULL for variant 0 of every one
  int song, hudFlash;
  const int *palettes, *paletteVariants;
  int paletteCount;
  int cameraStop;   // how far short of the stage's right edge the camera stops, or 0 for the screen's width
  // The background's screen (sStageBgDimensions) as BG3CNT has it, and how much of its map goes in, 0 for all of it
  uint16_t bgCnt, bgCols, bgRows;

  // What the zone's own code does for the act, each NULL when there's nothing:
  void (*start)(void);                          // as the act is made: its background's and its stage's own tasks
  void (*cameraMoved)(int runs);                // after the camera's move (fnBgUpdate); `runs` once its task has got going
  void (*drawBackground)(int camX, int camY);   // the background's place in the frame's picture: every act in C has one
  void (*beforeObjects)(void);                  // a task of its own, made before the entities manager
  void (*afterFrame)(int shown);                // after the frame's picture; `shown` is 0 in a frame run with no picture
  // and for a start point (tools/README.md) that opens the act past its card, whose frames run with no picture:
  void (*cardStarts)(void);                     // before those frames
  void (*cardFrame)(void);                      // in each, after the camera's move
  void (*cardEnded)(void);                      // after them, in place of the usual start of the act's music

  // Where its frames differ from the other acts':
  unsigned runsFromFirstFrame : 1;     // its objects, animated tiles and palette animations run from the frame that makes it
  unsigned blackAtGameStart : 1;       // Game Start hands over to it with the screen black for a frame
  unsigned ownsBlend : 1;              // its background sets the blend, which the frame then leaves alone
  unsigned ownsWindows : 1;            // its own code sets WIN0V and WIN1V, which the frame then leaves alone
  unsigned sharedRandom : 1;           // its random numbers go on from the menus' (gPseudoRandom), not from a start of their own
  unsigned blankZeroTiles : 1;         // the two tiles a zero-ring count reads past its string are blank
  unsigned zeroFlashesInSixteens : 1;  // the ring counter's zero is red for sixteen frames, then white for sixteen
  unsigned palettesAfterSonic : 1;     // the frame steps its palette animations itself, after Sonic's, with no tasks for them
  unsigned tilesShownLate : 1;         // its animated tiles are copied as a frame is drawn, the frame before the step's
  unsigned cardStepsOn : 1;            // a start point's frames after the card step the whole act, and its card has its own timing
} Level;

/** A row's palette animations and how many there are. */
#define LEVEL_PALETTES(list) .palettes = (list), .paletteCount = (int)(sizeof (list) / sizeof (list)[0])

// The rows, each in its zone's file. One that isn't written yet is only named here, and nothing links to it
extern const Level ACT_NEO_GREEN_HILL_1, ACT_NEO_GREEN_HILL_2, ACT_SECRET_BASE_1, ACT_SECRET_BASE_2,
  ACT_CASINO_PARADISE_1, ACT_CASINO_PARADISE_2, ACT_ICE_MOUNTAIN_1, ACT_ICE_MOUNTAIN_2, ACT_ANGEL_ISLAND_1,
  ACT_ANGEL_ISLAND_2, ACT_EGG_ROCKET, ACT_COSMIC_ANGEL, ACT_X_ZONE, ACT_THE_MOON, ACT_CHAO_HUNT_A, ACT_CHAO_HUNT_B,
  ACT_CHAO_HUNT_C, ACT_CHAO_HUNT_D;

/** A level's row (levels.c): an empty one for a level that isn't in C yet, or for a number that is no level. */
const Level *level_row(int level);
/** Whether the C version has `level`'s act, which the course select and the act before it may start. */
int level_in_c(int level);

#endif
