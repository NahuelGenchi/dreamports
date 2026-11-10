// The title screen's demo in C: left alone, the title fades out and four computer fighters, picked at random, fight in
// a random arena while the view turns round them, until the clock runs out or Start is pressed. This is where a player
// first sees the other fighters' brains (brain.c) at work. It translates the original's 0x0801c930 (the demo's
// screen), 0x0801c770 (its fighters and arena) and 0x0801c4bc (its frame).
#include "game.h"

#define SETUP_ SETUP
#define SLOTS_ SLOTS
#define CAMERA_TURN 0x0300204Cu
#define CAMERA_X 0x03001374u
#define CAMERA_Y 0x03001B24u
#define CAMERA_HEIGHT 0x03002100u
#define SHOW_AT_VBLANK 0x030013A0u
#define CHARACTERS_FREE 0x08071237u   // which of the first seven characters the demo may pick
#define CHARACTER_COUNT 7
#define ARENA_COUNT 9
#define COMPUTER 1
#define NO_PLACE 255                  // the screen a fight's choice of specials starts after: none, in the demo
#define HUD_PRESS_START 50
#define HUD_CHOOSING 10

static int active(int i) { return read8(SLOTS_ + i) != 255; }

static int randomBelow(uint32_t count) { return (int)((uint32_t)randomNumber() % count); }

/** 0x0801c930: the demo's screen, a fight's, with its fade in from black started. */
void demoScreen(void) {
  newScreen(6);
  g.line_one = playQueuedEffects;   // what mode 6's interrupts do on a fight's first line
  write8(SETUP_, 0);
  g.callback = demoSetup;
  startFadeIn(24);
  stepFade();
  write8(SHOW_AT_VBLANK, 1);
  g.vblank_copies = 1;
}

/** 0x0801c770: four different characters of the first seven, all computers, in an arena of the first nine, and the
 *  blinking Press Start over them. Unlike a fight a player starts, the demo plays no song of its own. */
void demoSetup(void) {
  uint8_t free[CHARACTER_COUNT];
  for (int n = 0; n < CHARACTER_COUNT; n++) free[n] = read8(CHARACTERS_FREE + (uint32_t)n);
  write8(SETUP_ + 36, 4);
  for (int i = 0; i < 4; i++) write8(SETUP_ + 28 + i, COMPUTER);
  int pick = randomBelow(CHARACTER_COUNT);
  for (int i = 0; i < 4; i++) {
    while (free[pick] == 0) pick = randomBelow(CHARACTER_COUNT);
    free[pick] = 0;
    write8(SLOTS_ + i, (uint8_t)pick);
  }
  write8(SETUP_ + 1, 0);
  write8(SETUP_ + 2, 1);
  write8(SETUP_ + 3, (uint8_t)randomBelow(ARENA_COUNT));
  write8(SETUP_ + 125, NO_PLACE);
  setUpFight();   // 0x08019ed8, which picks no song for a fight with no place to go back to
  setUpFighters();
  startHud(HUD_PRESS_START);
  g.callback = demoFrame;
  stepFade();
}

/** 0x0801c4bc: the demo's frame, its four brains thinking before the fighters move. */
void demoFrame(void) {
  readNextKeys();
  for (int i = 0; i < 4; i++) {
    uint8_t kind = read8(SETUP_ + 28 + i);
    if (kind != 0 && kind != 255) brainTick(i);
  }
  startFighterEffects();
  updateThings();
  for (int i = 0; i < 4; i++) {
    if (!active(i)) continue;
    fighterThink(i);
    moveFighter(i);
    takeHits(i);
  }
  holdHits();
  for (int i = 0; i < 4; i++) {
    if (!active(i)) continue;
    reachOthers(i);
    readFighterKeys(i);
    fighterAct(i);
  }
  g.after_wait = demoAfterWait;
}

/** 0x0801c4bc past its wait: the clock, the view turning a step, and everything drawn. */
void demoAfterWait(void) {
  if (countUntilDone() == 0) {
    if (stepFade()) endFade();
  } else {
    __builtin_trap();   // the clock ran out or Start was pressed, which no recording reaches yet
  }
  uint16_t turn = (uint16_t)(read16(CAMERA_TURN) + 16);
  if ((int16_t)turn > 0x2000) turn = 0;
  write16(CAMERA_TURN, turn);
  followFighterTarget(0);
  moveCamera(reads16(CAMERA_X), reads16(CAMERA_Y));
  turnCamera(reads16(CAMERA_TURN));
  tiltCamera(s16(0x200 + read16(CAMERA_HEIGHT)));
  zoomCamera(0x200);
  int mode = hudMode();
  setHeightShift();
  layersFromCamera();
  clearQueue();
  drawHud(mode);
  keepQueued();
  if (mode != HUD_CHOOSING) {
    drawFighters(4);
    drawArenaThings();
  }
  drawArena();
  sortQueue();
  drawSpritesNow();
  copyAtVblank();
  for (int i = 0; i < 4; i++) {
    // a knocked-out fighter who has lain long enough comes back, with new special attacks
    uint32_t f = FIGHTERS + (uint32_t)i * RECORD;
    if (read16(f + 20) != 254 || reads16(f + 26) <= 64) continue;
    resetFighter(i);
    giveComputerPicks(i);
  }
}
