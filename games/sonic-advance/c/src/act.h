// The act: X Zone's stage, the camera, Sonic and the HUD, translated from the JavaScript version's engine/game.js,
// engine/player.js, engine/camera.js, engine/terrain.js, engine/stage.js, engine/hud.js and rom/extract.js.

#ifndef SA_ACT_H
#define SA_ACT_H

#include "sa.h"
#include "player.h"
#include "levels.h"

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
  const Level *row;       // what the engine asks of this level (levels.h)
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
  int wrappedThisFrame;   // the loop point's shift on this frame, which the layer maps are drawn without (the camera's task runs before it)
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
  int timerReversed;
  uint32_t seed;
  int goalReached, ringsStopped;   // past the goal; past the goal or a beaten boss, the rings manager neither takes nor draws
  int afterLevel;                  // made by GoToNextLevel after the act before, rather than by the course select
  int fromStartPoint;              // opened by the recording's start point, past its card: only the first act it starts
  int loadFrames;                  // the frames left that the next act spends loading after its first (act_task)
  int bossFlash;                   // a hit boss drawn into the OBJ window, which the frame brightens to white
  int blendOff;                    // a boss's task cleared the blending this frame
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
/** The original's stage clock, gStageTime: the act's own frame count less the frames the level's row says the
 *  original doesn't count yet (`stageClockAhead`). */
int act_stage_time(void);
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
void act_go_to_next_level(void);
int act_checkpoint_index(void);
void act_checkpoint_pass(int index, int x, int y);
int act_special_stages(void);
void act_hold_camera(int x, int y);
void act_special_stage(int x, int y);
/** The game's random numbers (gPseudoRandom): the next, which also moves the sequence on. */
uint32_t act_random(void);
/** Starts the game's random numbers over from `seed`, as a boss does from the frame count. */
void act_random_seed(uint32_t seed);

// the water at Ice Mountain's foot (icemountain.c)
void water_create(int level, uint32_t mask);
void water_card(int ending);
void water_card_flush(void);
void water_task(void);
int water_line_on_screen(void);
/** gWater.currentWaterLevel: the water line's height in the world, -1 in an act without water. */
int water_level(void);
/** The water's colours for the frame's palette, and the water line's target moved down by dy px (the Egg Spider's). */
void water_mask_palettes(void);
void water_lower(int dy);
/** The background's colours as the palette animations will leave them next frame, worked out on copies of them. */
void act_next_bg_palette(uint16_t *pal);
// what happens under it (underwater.c): the splash at the line, a bubble rising from (x, y) in 1/256 px, the bubbles after
// Sonic drowns, a number of the drowning countdown over him, and the drowning music, started and stopped
void water_splash(int x);
void water_bubble(int x, int y, int dx, int group);
void water_drowned_bubbles(void);
void water_countdown(int n);
void water_drowning_music(void);
void water_drowning_music_stop(void);
void titlecard_start(int level, int character);
int titlecard_run(int pressed);
void titlecard_display(void);
extern int actHudFlash;
void act_hold_black(void);
void act_frame_now(void);
/** The rings' animation doesn't step on the frame a menu hands over to the act (rings.c). */
void rings_skip_first_update(void);
void act_start(int level, int cardSkip, int preFrames);
void act_queue(int level, int cardSkip, int preFrames);
void act_song_playing(void);
// what a zone's own code asks of the act (levels.h): one step of a palette animation, the tiles of frame `frame` of
// the stage's animation copied now, and the frames of the act's music before the first one shown rendered there
void act_palette_step(PaletteAnim *p);
void act_copy_tiles(int frame);
void act_render_music_at_first_frame(void);
void act_task(Task *t);
uint32_t front_frame(void);

// Secret Base act 1's spotlights (engine/spotlights.js), in actspot.c
void spotlights_start(void);
void spotlights_frame(void);
void spotlights_beams(void);
void spotlights_apply(void);

#endif
