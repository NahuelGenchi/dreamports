// The act: X Zone's stage, the camera, Sonic and the HUD, translated from the JavaScript version's engine/game.js,
// engine/player.js, engine/camera.js, engine/terrain.js, engine/stage.js, engine/hud.js and rom/extract.js.

#ifndef SA_ACT_H
#define SA_ACT_H

#include "sa.h"
#include "player.h"

#define ACT_LEVEL_X_ZONE 12
#define ACT_LEVEL_SECRET_BASE_2 3
#define ACT_LEVEL_CASINO_PARADISE_1 4
#define ACT_LEVEL_ICE_MOUNTAIN_1 6
#define ACT_LEVEL_ICE_MOUNTAIN_2 7
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
  int backgroundScroll;   // 0 still, 1 Casino Paradise's bands, 2 X Zone, 3 Secret Base's inside, 4 Ice Mountain's snow
  int waterLevel;         // the water line the act starts with, -1 for none
  int paletteCount;
  const int *paletteAnimations;
  Tilemap front, back, background;
  Collision collision;
  int32_t spawnX, spawnY;
  int loopX, loopShift;   // past x loopX Sonic and the camera go back by loopShift (gUnknown_084ADF78), loopX < 0 for none
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
  int afterLevel;                  // made by GoToNextLevel after the act before, rather than by the course select
  int loadFrames;                  // the frames left that the next act spends loading after its first (act_task)
  int bossFlash;                   // a hit boss drawn into the OBJ window, which the frame brightens to white
  int blendOff;                    // a boss turned the zone's blending off this frame (gBldRegs cleared after the camera)
  int checkpointIndex, checkpointX, checkpointY, checkpointTime;   // the last checkpoint passed (gBossIndex), where and when
  int clockStopped, cardFrame, cardDone, firstCard, started, preFrames, firstFrame, drawn;
  int cardWater;            // the card's colours under water are due from its task this frame (card_water_task)
  struct Task *cardWaterTask;
  // the stage's animated tiles (UpdateBgAnimationTiles), and its palette animations' sprites
  int bgAnimFrame, bgAnimShown, bgAnimDelay;
  int startCamX, startCamY;
  Task *task;
  int stallLoad, musicStarts;
  int palCount;
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
/** The background's colours as the palette animations will leave them next frame. */
void act_next_bg_palette(uint16_t *pal);
uint32_t front_frame(void);

// the act's water (water.c, gWater)
typedef struct {
  int active, level, target;
  uint8_t line, seen;   // unk2 and unk1: where the line is on the screen, 0 above it, 255 below it
  uint32_t mask;
  Sprite surface;
  int bubbles;          // gSmallAirBubbleCount
  int late;             // the waves start a line late this frame (water.c)
  int early;            // the colours under water are next frame's (water.c)
} Water;
extern Water water;
void water_start(int level, uint32_t mask);
void water_task(int time, int camX, int camY);
void water_mask_palettes(void);
void water_load_palette_423(void);
/** The water's line in the act, -1 without any. */
int water_level(void);
/** What Sonic does in the water (Player_HandleWater): the splash at the line, a bubble from (x, y) in 1/256 px moving
 *  dx across (a group of them when `group`), a number of the drowning countdown over him, and drowning. */
void water_splash(int x);
void water_bubble(int x, int y, int dx, int group);
void water_countdown(const Player *p, int n);
void water_drowned(const Player *p);
void water_drowning_music(void);
void water_stop_drowning_music(void);

// Ice Mountain's background and snow (icemountain.c)
void ice_mountain_create_bg(void);
void ice_mountain_bg_update(int x, int y, int time);
void ice_mountain_display(void);

#endif
