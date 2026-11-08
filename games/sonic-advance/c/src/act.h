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
  Tilemap front, back, background;
  Collision collision;
  int32_t spawnX, spawnY;
  int loopX, loopShift;   // past x loopX Sonic and the camera go back by loopShift
  int width, height;
} Stage;

typedef struct {
  double x, y, gsp, xsp, ysp;
  int facing, state, air, curled, pushing, jumped, airLock, lock, spinDashing, dashAccel, midAir, chain, forcedRoll;
  uint8_t rotation, rotA, rotB;
  int layer, offsetY, idleT;
  int anim, variant, animSpeed;
  int pos;              // the sprite's graphics, kept by the animation
  int dead, invulnerable, hidden, inverted, wasInverted;
  int heldDirs, pressedDirs;
  int carried, ignoreInput, actClear, halfPipe;
} Player;

typedef struct {
  double x, y, targetX, targetY, offsetY, deadY;
  int minX, minY, maxX, maxY, started, speedX, speedY, shiftX, shiftY;
  int width, height, freeze, locked, look, lookDelay, shakeX, shakeY, bgUpdates;
  int wrapped;   // how far the act's loop point has moved the camera, which the background leaves out
} Camera;

typedef struct {
  int flash, active;
} Hud;

// the title card (engine/titlecard.js): the pieces' state, the fade and the sprites each frame
#define CARD_PIECES 6
#define CARD_SPRITES 128
typedef struct { int slot, glyph, a0, a1, order; } CardSprite;
typedef struct {
  int slot, x, y, count, order, rows, grid, mark, drops;
  int text[32];
} CardPiece;
typedef struct {
  int frame, done, fading, blank, level, character;
  int fadeLevel, fadeSpeed, fadeBldY;
  CardPiece pieces[CARD_PIECES];
  CardSprite sprites[CARD_SPRITES];
  int spriteCount;
  struct { uint32_t vram; int shape, size, w, h, perGlyph, glyphs; int palette; } slots[CARD_PIECES];
} TitleCard;

typedef struct {
  Stage stage;
  Player player;
  Camera cam;
  Hud hud;
  TitleCard card;
  int tick, courseTime, ringCount, lives, score;
  int clockStopped, cardFrame, cardDone, firstCard, started, preFrames, firstFrame, drawn;
} Act;

extern Act act;
extern int act_active;
extern int actHudFlash;   // 1 from the character select, -1 for the stage's own (a course select or start point)

// Sonic's sprite hitboxes as his animation script last set them (0 when the slot is off): relative to him
int act_player_attack_box(int *l, int *t, int *r, int *b);
int act_player_body_box(int *l, int *t, int *r, int *b);
void rings_init(int level);
void rings_reset(void);
void rings_update(int px, int py, int oy);
void rings_draw(int cx, int cy);
void card_create(int level, int character, int fromResults, int blank);
int card_run(int pressed);
void card_draw(void);
void act_start(int level, int cardSkip, int preFrames);
void act_queue(int level, int cardSkip, int preFrames);
void act_frame_now(void);
void act_start_clear(void);
void act_stage_results(void);
void act_task(Task *t);
uint32_t front_frame(void);

#endif
