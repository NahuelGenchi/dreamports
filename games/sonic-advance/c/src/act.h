// The act: X Zone's stage, the camera, Sonic and the HUD, translated from the JavaScript version's engine/game.js,
// engine/player.js, engine/camera.js, engine/terrain.js, engine/stage.js, engine/hud.js and rom/extract.js.

#ifndef SA_ACT_H
#define SA_ACT_H

#include "sa.h"

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
  int backgroundScroll;   // 0 still, 1 Casino Paradise's bands, 2 X Zone
  int paletteCount;
  const int *paletteAnimations;
  Tilemap front, back, background;
  Collision collision;
  int32_t spawnX, spawnY;
  int width, height;
} Stage;

typedef struct {
  double x, y, gsp, xsp, ysp;
  int facing, state, air, curled, pushing, jumped, airLock, spinDashing;
  uint8_t rotation, rotA, rotB;
  int layer, offsetY, idleT;
  int anim, variant, animSpeed;
  int pos;              // the sprite's graphics, kept by the animation
  int dead, invulnerable, hidden, inverted, wasInverted;
  int heldDirs, pressedDirs;
} Player;

typedef struct {
  double x, y, targetX, targetY, offsetY, deadY;
  int minX, minY, maxX, maxY, started, speedX, speedY, shiftX, shiftY;
  int width, height, freeze, locked, look, lookDelay, shakeX, shakeY, bgUpdates;
  int bgX, bgY;
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
  int clockStopped, cardFrame, cardDone, firstCard, started, preFrames, firstFrame, drawn;
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

void titlecard_start(int level, int character);
int titlecard_run(int pressed);
void titlecard_display(void);
void act_frame_now(void);
void act_start(int level, int cardSkip, int preFrames);
void act_queue(int level, int cardSkip, int preFrames);
void act_frame_now(void);
void act_task(Task *t);
uint32_t front_frame(void);

#endif
