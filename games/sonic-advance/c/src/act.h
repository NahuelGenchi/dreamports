// The act: X Zone's stage, the camera, Sonic and the HUD, translated from the JavaScript version's engine/game.js,
// engine/player.js, engine/camera.js, engine/terrain.js, engine/stage.js, engine/hud.js and rom/extract.js.

#ifndef SA_ACT_H
#define SA_ACT_H

#include "sa.h"
#include "player.h"

// how an act's background moves (its StageBgUpdate)
enum { BG_SCROLL_STILL, BG_SCROLL_CASINO_PARADISE, BG_SCROLL_X_ZONE, BG_SCROLL_SECRET_BASE, BG_SCROLL_NEO_GREEN };
#define ACT_LEVEL_NEO_GREEN_1 0
#define ACT_LEVEL_NEO_GREEN_2 1
#define ACT_LEVEL_SECRET_BASE_2 3
#define ACT_LEVEL_CASINO_PARADISE_1 4
#define ACT_LEVEL_X_ZONE 12
#define ACT_TILES 3072          // the largest metatile count of the acts' collision, with room to spare
#define ACT_LEVEL_BLOCKS 8192   // the largest layer, in 96 × 96 px blocks
#define ACT_TILE_ENTRIES (ACT_TILES * 144)

typedef struct {
  uint32_t at, tiles, tilesSize, palette, map;
  uint16_t xTiles, yTiles, animTileSize, animFrameCount, animDelay, mapWidth, mapHeight, paletteOffset, paletteLength;
} Tilemap;

typedef struct {
  uint32_t heights, angles, metatiles, flags, layers[2];
  uint16_t levelX, levelY, width, height;
} Collision;

typedef struct {
  int level, zone, act, music, hudFlash;
  int backgroundScroll;   // how the background moves (BG_SCROLL_*)
  int paletteCount;
  const int *paletteAnimations;
  const int *paletteVariants;   // each animation's variant, or NULL for variant 0
  Tilemap front, back, background;
  Collision collision;
  int32_t spawnX, spawnY;
  int loopX, loopShift;   // past x loopX Sonic and the camera go back by loopShift (gUnknown_084ADF78), loopX < 0 for none
  int cameraStop;        // how far short of the right edge the camera stops, or 0 for the screen's width
  int width, height;
} Stage;

typedef struct {
  double x, y, targetX, targetY, offsetY, deadY;
  int minX, minY, maxX, maxY, started, speedX, speedY, shiftX, shiftY;
  int width, height, freeze, locked, look, lookDelay, shakeX, shakeY, bgUpdates;
  int bgX, bgY;
  int wrapped;   // how far the act's loop point has moved the camera, which the background leaves out (unk20)
} Camera;

typedef struct {
  int flash, active;
} Hud;

typedef struct PaletteAnim PaletteAnim;
struct PaletteAnim {
  int frame, wait, shown, count, loop;
  int delays[64], at[64];
  int loadCount[64];
  struct { int entry, count, insert; } loads[64][8];
};

typedef struct {
  Stage stage;
  Player player;
  Camera cam;
  Hud hud;
  int tick, frames, courseTime, ringCount, lives, score;
  uint32_t seed;
  int goalReached, ringsStopped;   // past the goal; past the goal or a beaten boss, the rings manager neither takes nor draws
  int checkpointIndex, checkpointX, checkpointY, checkpointTime;   // the last checkpoint passed (gBossIndex), where and when
  int clockStopped, cardFrame, cardDone, firstCard, started, preFrames, firstFrame, drawn;
  // the stage's animated tiles (UpdateBgAnimationTiles), and its palette animations' sprites
  int bgAnimFrame, bgAnimShown, bgAnimDelay;
  int startCamX, startCamY;
  Task *task;
  int stallLoad, musicStarts;
  int palCount, palStarted;
  struct PaletteAnim *pal;
  // the title card's graphics and state (titlecard.c), and where its pieces are
  int cardGraphic;
  int cardX[6], cardY[6], cardCount[6], cardMark[6];
} Act;

extern Act act;
extern int act_active;

// what the act does for Sonic's moves: the effects they start, the camera they hold still, and his death
void act_brake_dust(void);
void act_dash_dust(void);
void act_insta_shield(void);
void act_freeze_camera(void);
void act_player_died(void);
void act_life_lost(void);
// what the objects hand to the act: the goal post, the checkpoints and the special springs (goal.c, checkpoints.c,
// specialspring.c)
int act_goal_passed(void);
void act_goal_reached(void);
void act_stage_results(void);
int act_checkpoint_index(void);
void act_checkpoint_pass(int index, int x, int y);
int act_special_stages(void);
void act_hold_camera(int x, int y);
void act_special_stage(int x, int y);
/** The game's random numbers (gPseudoRandom): the next, which also moves the sequence on. */
uint32_t act_random(void);

void titlecard_start(int level, int character);
int titlecard_run(int pressed);
void titlecard_display(void);
void act_frame_now(void);
void act_start(int level, int cardSkip, int preFrames);
void act_queue(int level, int cardSkip, int preFrames);
void act_song_playing(void);
/** Whether the C version has `level`'s act, which the course select may start. */
int act_level_ported(int level);
void act_task(Task *t);
uint32_t front_frame(void);

#endif
