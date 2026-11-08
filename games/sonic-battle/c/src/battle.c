// A fight's frame with computer players, in C: 0x0801c4bc, the frame Battle mode runs. It reads every fighter's keys,
// gives each computer player its thought (brain.c), runs the fighters, waits for the V-blank, then turns the view and
// draws. The start point's `cpu` frame turns a Training fight into this one, so the other fighter's play can be proven
// without a Battle screen in the C menu yet.

#include "game.h"

#define SETUP_ SETUP
#define SLOTS_ SLOTS
#define FIGHTERS_ FIGHTERS
#define RECORD_ RECORD
#define CAMERA_TURN 0x0300204Cu
#define KEYS 0x03001B30u
#define KEYS_PER_FIGHTER 64
#define KEYS_PRESSED 20
#define KEYS_NOW 60
#define FIGHT_CLOCK 0x030030D0u
#define CAMERA_X 0x03001374u
#define CAMERA_Y 0x03001B24u
#define CAMERA_HEIGHT 0x03002100u
#define SOUND_STATE 0x030048E0u

static int active(int i) { return read8(SLOTS_ + i) != 255; }

static uint32_t keysNow(int i) {
  uint32_t at = KEYS + (uint32_t)i * KEYS_PER_FIGHTER;
  return at + (uint32_t)read8(at + KEYS_NOW) * 2;
}
static uint16_t heldKeys(int i) { return read16(keysNow(i)); }
static uint16_t pressedKeys(int i) { return read16(keysNow(i) + KEYS_PRESSED); }

/** 0x08015384: the fight's clock, which counts the frames until its time is up. */
static int fightClock(void) {
  uint16_t value = read16(FIGHT_CLOCK + 4);
  write16(FIGHT_CLOCK + 4, (uint16_t)(value + 1));
  if ((uint16_t)(value - 60) <= 0x0E9A && (read16(SOUND_STATE + 4) & 8) != 0) {
    write16(FIGHT_CLOCK + 4, 0x0ED8);
  }
  uint16_t now = read16(FIGHT_CLOCK + 4);
  if (now > 0x0F00) return 2;
  if (now > 0x0ED8) return 1;
  return 0;
}

/** 0x0801c4bc: a fight's frame with the computer players' thoughts. */
void battleFrame(void) {
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
  g.after_wait = battleAfterWait;
}

/** 0x0801b394: a fight's frame as Story mode runs it: the computer players' thoughts, every fighter's keys, the
 * fighters, then the wait. Its draw is the Training view's, which the fight's opening already proves. */
void battleStoryFrame(void) {
  for (int i = 0; i < 4; i++) {
    uint8_t kind = read8(SETUP_ + 28 + i);
    if (kind != 0 && kind != 255) brainTick(i);
  }
  int player = (int)read32(PLAYER);
  readAllKeys(player);
  // 0x0801b42c: the view's turn while the player stands, dodges or is knocked about, and level with the arena
  uint16_t state = read16(FIGHTERS_ + (uint32_t)player * RECORD_ + 20);
  if (state == 55) {
    uint16_t keys = heldKeys(player);
    if (keys & 32) write16(CAMERA_TURN, read16(CAMERA_TURN) - 128);
    else if (keys & 16) write16(CAMERA_TURN, read16(CAMERA_TURN) + 128);
    else write16(CAMERA_TURN, 0);
  } else if (state == 53) {
    if (pressedKeys(player) & 0x200) __builtin_trap();
  } else if (read8(SETUP_ + 136) == 255) write16(CAMERA_TURN, 0);
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
  g.after_wait = battleStoryAfterWait;
}

/** 0x0801ad38: the countdown before a Battle fight. The first frames set each fighter's side, then the banner counts in;
 * when it ends, the fight's own frame starts. */
void battleReadyFrame(void) {
  int player = (int)read32(PLAYER);
  readAllKeys(player);
  if (read16(FIGHT_CLOCK + 4) <= 2) {
    static const int toward[4] = {6, 4, 6, 4};
    static const int side[4] = {1, 0, 1, 0};
    for (int i = 0; i < 4; i++) {
      write8(FIGHTERS_ + (uint32_t)i * RECORD_ + 36, (uint8_t)toward[i]);
      write8(FIGHTERS_ + (uint32_t)i * RECORD_ + 37, (uint8_t)toward[i]);
      write8(FIGHTERS_ + (uint32_t)i * RECORD_ + 16, (uint8_t)side[i]);
      write8(FIGHTERS_ + (uint32_t)i * RECORD_ + 18, (uint8_t)side[i]);
    }
  }
  if (countBanner()) {
    startHud(30);
    g.callback = battleFrame;
  }
  for (int i = 0; i < 4; i++) {
    if (!active(i)) continue;
    fighterThink(i);
    moveFighter(i);
    takeHits(i);
    reachOthers(i);
    readFighterKeys(i);
    fighterAct(i);
  }
  g.after_wait = battleReadyAfterWait;
}

void battleReadyAfterWait(void) { battleStoryAfterWait(); }

void battleStoryAfterWait(void) {
  int player = (int)read32(PLAYER);
  if (stepFade()) endFade();
  followFighter(player);
  setHeightShift();
  layersFromCamera();
  clearQueue();
  drawHud(hudMode());
  keepQueued();
  drawFighters(4);
  drawArenaThings();
  drawArena();
  sortQueue();
  drawSpritesNow();
  copyAtVblank();
}

/** 0x0801c4bc past its wait: the clock, the turning view, and everything drawn. */
void battleAfterWait(void) {
  int clock = fightClock();
  if (clock == 0) {
    if (stepFade()) endFade();
  } else {
    // the fight's time ran out, which this recording doesn't reach
    __builtin_trap();
  }
  uint16_t turn = (uint16_t)(read16(CAMERA_TURN) + 16);
  if (turn > 0x2000) turn = 0;
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
  drawFighters(4);
  drawArenaThings();
  drawArena();
  sortQueue();
  drawSpritesNow();
  copyAtVblank();
}
