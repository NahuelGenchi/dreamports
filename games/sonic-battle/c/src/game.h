// Sonic Battle Dreamport in C: what the fight's functions share, translated from the JavaScript version in
// games/sonic-battle/src/ (bus.js, core.js and the fight's modules). The original's state lives in work RAM at its own
// addresses, and every function reads and writes it by address, as the original and the JavaScript do.

#ifndef SONIC_BATTLE_GAME_H
#define SONIC_BATTLE_GAME_H

#include "gba.h"

#define EWRAM 0x02000000u
#define IWRAM 0x03000000u
#define IO 0x04000000u
#define PALETTE 0x05000000u
#define VRAM 0x06000000u
#define OAM 0x07000000u
#define CARTRIDGE 0x08000000u

// the fight's setup and the records, at the original's addresses
#define SETUP 0x03001620u
#define PLAYER 0x03001380u
#define FIGHTERS 0x03001C40u
#define RECORD 252u
#define SAVE 0x03002110u
#define SONG 0x03003D94u
#define CHOSEN 0x03003D98u
#define VIEW 0x03002040u
#define SLOTS 0x03001634u

// a fighter's record, by what the code does with it
enum {
  X = 0, Y = 2, Z = 4, OLD_X = 6, OLD_Y = 8, OLD_Z = 10, ANIMATION = 22, SCRIPT_AT = 24, SCRIPT_FRAME = 26,
  PAUSE = 28, PAUSE_NEXT = 29, PAUSE_DONE = 30, STATE = 20, CHARACTER_NOW = 23, WALK = 32, SLOW = 34, FACING = 36,
  LAST_FACING = 37, FALL = 38, TOP_SPEED = 40, MAX_SPEED = 42, SPEED_X = 44, SPEED_Y = 46, SPEED_Z = 48, BUMPED = 50,
  GROUND = 52, ATTACKS = 116, FLAGS = 180, CAMERA = 159, CHARACTER = 196, HEALTH = 191, KEYS_FOR_NEXT = 200,
};
#define FLAG_GROUNDED 0x1u
#define FLAG_LANDED 0x2u
#define FLAG_IN_AIR 0x4u
#define FLAG_LOCKED 0x100000u
#define FLAG_NEW_STATE 0x200000u
#define FLAG_CHAIN 0x400000u

// a queued copy: bytes from the cartridge to `to`, or a picture unpacked there when `bytes` is -1
typedef struct { uint32_t to, from; int32_t bytes; } Copy;
typedef struct { uint16_t at, value; } QueuedRegister;
typedef struct { uint32_t from, to; } ColourWrite;

// the core's state, as core.js keeps it on `c`
typedef struct {
  uint8_t ewram[0x40000];
  uint8_t iwram[0x8000];

  // 0x08020198: the keys held, pressed, released and repeating
  struct { uint16_t held, inverted, pressed, released, repeated; uint8_t timer, delay, interval; } keys;

  // 0x0801fba0: display registers queued for the next V-blank
  QueuedRegister queue[20];
  int queue_count;

  // 0x0802036c: what's copied just after the next V-blank
  Copy copies[32];
  int copy_count;

  // 0x08018004: the sprites and matrices the V-blank copies, as the screens built from a list of nodes use them
  uint16_t sprites[128 * 4];
  int sprite_count;
  uint16_t matrices[32 * 4];
  int matrix_count;
  uint16_t oam_buffer[512];
  int oam_buffer_full;
  uint16_t affine[2][16];
  int affine_half;
  int vblank_copies;

  // 0x03001378 and 0x03002610: the V-blanks and main loop frames counted
  int vblanks, frames;

  int start_up;
  void (*callback)(void);
  void (*after_wait)(void);
  void (*line_one)(void);
  void (*vblank_work)(void);
  int fight_vblank;
  int hold_queue;

  // a screen's counters and the colour effect's target
  int counter, blend_target, blend;
  int menu_choice;
  int mini_games_open;
  int language, saved_language;
  int restarted;
  int saving_frames;
  // 0x03002170: the player's name, six letters' room, which a saved one from a start point fills
  uint16_t name[6];

  // the line work a long job leaves for the display's lines, as arena.js's landColours does
  int line_work_line;
  void (*line_work)(void);
  ColourWrite line_writes[4];
  int line_write_count, line_write_index;

  // how many of the console's cycles the frame's work has taken, and whether it's counted
  int32_t cycles;
  int counting;

  // the last sound frame's cycles, which the JavaScript kit gives as frameCycles()
  int32_t sound_cycles;
} Game;

extern Game g;

// bus.js: the console's memory as the original's code sees it
uint8_t read8(uint32_t address);
uint16_t read16(uint32_t address);
uint32_t read32(uint32_t address);
int8_t reads8(uint32_t address);
int16_t reads16(uint32_t address);
int32_t reads32(uint32_t address);
void write8(uint32_t address, uint8_t value);
void write16(uint32_t address, uint16_t value);
void write32(uint32_t address, uint32_t value);
void copy16(uint32_t from, uint32_t to, uint32_t count);
void copy32(uint32_t from, uint32_t to, uint32_t count);
void fill16(uint32_t to, uint16_t value, uint32_t count);
void fill32(uint32_t to, uint32_t value, uint32_t count);
int32_t divArm(int32_t denominator, int32_t numerator);

static inline uint8_t u8(int32_t v) { return (uint8_t)v; }
static inline uint16_t u16(int32_t v) { return (uint16_t)v; }
static inline int8_t s8(int32_t v) { return (int8_t)v; }
static inline int16_t s16(int32_t v) { return (int16_t)v; }

// core.js
void step(uint16_t held);
void runFightSetup(int count);
void hblank(int line);
void fightVblank(void);
void queueCopy(uint32_t to, uint32_t from, uint32_t bytes);
void queueDecompress(uint32_t to, uint32_t from);
void hideSpriteBuffer(void);
void clearSprites(void);
void copyAtVblank(void);
void queueRegister(uint16_t offset, uint16_t value);
void copyToVram(uint32_t from, uint32_t to, uint32_t count);
void decompress(uint32_t from, uint32_t to);
void copyTileBlock(uint32_t to, uint32_t from, int columns, int rows, int base);
uint16_t *colours(uint32_t first);
void clearLayer(int layer);
void layerBits(int layer, uint16_t bits);
void layerCharBase(int layer, int base);
void layerScreenBase(int layer, int base);
void setBlend(int effect, int first, int second, int a, int b, int y);
void setRotation(int originX, int originY, int firstDenominator, int secondDenominator, int scaleX, int scaleY,
                 int angle, int layer);
int fadeToward(uint32_t first, uint32_t from, int count);
int fadeToBlack(uint32_t first, int count);
int fadeToWhite(uint32_t first, int count);
void newScreen(int mode);

// sprites.js
void layersFromCamera(void);
void drawQueuedSprite(uint32_t word0, uint32_t word1, uint32_t word2, uint32_t word3);
void writeNextSprite(uint16_t first, uint16_t second, uint16_t third);
void drawQueue(void);
void sortQueue(void);
void turnCamera(int target);
void drawSpritesNow(void);
void clearQueue(void);
void restartBuffer(void);
void queueSprite(uint32_t word0, uint32_t word1, uint32_t word2, uint32_t word3);
void queueMatrix(uint32_t word0, uint32_t word1);
void setViewRows(int top, int bottom);
void keepQueued(void);
void drawMatrices(void);
void viewFromArena(int x, int y, int *outX, int *outY);
void screenFromView(int x, int y, int *outX, int *outY);
void setHeightShift(void);
void zoomCamera(int target);
void tiltCamera(int target);
void moveCamera(int x, int y);
int16_t cameraAngle(void);
int addMatrixToBuffer(uint16_t a, uint16_t b, uint16_t d, uint16_t e);
int addSpriteToBuffer(uint16_t first, uint16_t second, uint16_t third);
void hideRestOfBuffer(void);
void spriteInBuffer(int n, uint16_t first, uint16_t second, uint16_t third);
void matrixInBuffer(int n, uint16_t a, uint16_t b, uint16_t d, uint16_t e);

// fighters.js
void chosenColours(int i);
void loadColours(void);
void showColours(int i, int character, int flash);
void resetFighter(int i);
void clearFighterCounters(int i);
void resetFighters(void);
void loadFighterFrames(void);
void startFighterEffects(void);
void drawFighters(int count);
void followFighterTarget(int i);
int stepAnimation(int set, int id, int loops, int tiles, int player);
int slotOfAnimation(int id);
void clearEffect(int n);
void clearEffects(void);
void startEffect(int effect, int mode, int x, int y, int height, int a, int b, int d, int e, int owner, int f);
void loadSharedSprites(void);
void clearChoices(int i);
void zeroQueue(void);
void clearHudRecords(void);
void clearBrainFlags(void);
int32_t randomNumber(void);
int rollChance(int chance);
void resetBrain(int i);
void restartBrain(int i);
int wayToTarget(int i);
void setBrainLevel(int level);
void queueFrameAtTile(uint32_t sheet, int tile, int frame);
void queueFighterFrame(uint32_t sheet, int slot, int frame);

// hud.js
void queueHudSprite(int x, int y, int third, int tile, int palette, int sixth, int shape, int eighth, int ninth);
void startHud(int mode);
void drawHud(int mode);
int countUntilDone(void);
int chooseAnswer(void);
int chooseSpecials(void);
int countBanner(void);
int hudMode(void);
int countSlides(void);
void clearPushes(void);
void drawPicture(int x, int y, int tile, int palette, int index);
int16_t pushAcross(int index);
int16_t pushDown(int index);

// arena.js
void loadArena(int arena);
void setArenaLayers(void);
void loadArenaShape(int arena);
void drawArena(void);
void drawArenaThings(void);
void sendThingPictures(void);
void queuePicture(uint32_t from, int bytes, int place, int picture);

// moves.js
int32_t nextRandom(void);
int queueEffect(int sound, int place);
void playQueuedEffects(void);
int stepFade(void);
void endFade(void);
void forgetKeys(int i);
void readAllKeys(int player);
void readNextKeys(void);
void dummyKeys(void);
int16_t padFacing(int i);
void fighterThink(int i);
void runScript(uint32_t script, int i);
void setState(int i, int state);
void moveFighter(int i);
void takeHits(int i);
void holdHits(void);
void reachOthers(int i);
void readFighterKeys(int i);
void fighterAct(int i);
void landOrFall(int i);
void updateThings(void);
void followFighter(int i);
void trainingFrame(void);
void trainingAfterWait(void);
void setFightEndAt(int vblank);
int fightWinner(int mode);
void selectWinner(int mode);
void battleReadyFrame(void);
void battleReadyAfterWait(void);
void battleFrame(void);
void battleAfterWait(void);
void beginEnding(void);
void placeRealBlast(void);
void endingFrame(void);
void endingAfterWait(void);
void resultTransition(void);
void resultTransitionAfterWait(void);
void resultScreen(void);

// fight.js
void startFight(int vblanks, int action, int you, int rival, int arena, int colour, int battle);
void choosing(void);
void choosingAfterWait(void);

// menu.js
void showMenu(int playSong);
void menuBeforeMenu(void);

// main.c
void startFightFromPoint(void);
void restartFromStart(void);

// options.js
void startOptions(void);

#endif
