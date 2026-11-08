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
  int level, zone, act, music, hudFlash, cameraStop;
  Tilemap front, back, background;
  Collision collision;
  int32_t spawnX, spawnY;
  int width, height;
  uint32_t bgMapBase;   // where BG3's map sits in VRAM, and the register that names it
  uint16_t bgCnt;
  int animFrame, animCounter;   // the front layer's animated tiles (UpdateBgAnimationTiles)
  int animShown;                // the frame the screen shows while the next one is queued
} Stage;

/** A palette animation the act's stage init makes (CreatePaletteLoaderTask): a sprite whose colours-only script
 *  runs, for the acts that have one. */
typedef struct { Sprite sprite; int anim, variant; } PaletteAnimation;
#define PALETTE_ANIMATIONS_MAX 8

typedef struct {
  double x, y, gsp, xsp, ysp;
  int facing, state, air, curled, pushing, jumped, airLock, spinDashing;
  uint8_t rotation, rotA, rotB;
  int layer, offsetY, idleT;
  void *onObject;        // the solid object he stands on, as the original keeps it
  int anim, variant, animSpeed;
  int pos;              // the sprite's graphics, kept by the animation
  int dead, invulnerable, hidden, inverted, wasInverted;
  int heldDirs, pressedDirs;
  int attack, attackNext, midAir, death, countdown;
  int jumpPressed, attackPressed;
  int actClear, forcedRoll, ignoreInput, lock;
  int held[16], pressed[16];
} Player;

typedef struct {
  double x, y, targetX, targetY, offsetY, deadY;
  int minX, minY, maxX, maxY, started, speedX, speedY, shiftX, shiftY;
  int width, height, freeze, locked, look, lookDelay, shakeX, shakeY, bgUpdates;
} Camera;

typedef struct {
  int flash, active;
} Hud;

typedef struct {
  Stage stage;
  Player player;
  Camera cam;
  Hud hud;
  int tick, courseTime, ringCount, lives, score;
  int clockStopped, cardFrame, cardDone, firstCard, started, preFrames, firstFrame, drawn;
  int goalReached, actClear, livesLost, ringsStopped, preRight;
} Act;

extern Act act;
extern int act_active;

void act_start(int level, int cardSkip, int preFrames);
void act_music_already(void);
void act_queue(int level, int cardSkip, int preFrames);
void act_frame_now(void);
void act_task(Task *t);
uint32_t front_frame(void);

#endif
