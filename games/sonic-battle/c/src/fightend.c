// A fight's end in C: the knockout, the fighter coming back, and the fight's result once someone has won. This is a
// translation of the original's fight frames after the choice of special attacks: 0x0801ad38 (the countdown before a
// fight), 0x0801b394 (a fight's frame), 0x0801afc4 (the ending), and 0x0801bd90 (the way to the result). It follows
// the game's JavaScript where it has the part already and the original's instructions where it doesn't.
//
// The knockout is settled in 0x0800444c (moves.c's landOrFall): a fighter whose health reaches nothing takes state 253
// on the ground or state 252 in the air, and the one who reached it gains a point in the fight's setup (+51). The
// state's own script ends it in state 254, lying down, and 0x0801b394's frame lets the player press A to reset the
// fighter (0x080007fc) and choose again.

#include "game.h"

#define SETUP_ SETUP
#define PLAYER_ PLAYER
#define FIGHTERS_ FIGHTERS
#define SLOTS_ SLOTS
#define RECORD_ RECORD
#define SONG_ SONG
#define FIGHT_CLOCK 0x030030D0u
#define RESULT_WINNER 0x03003DA0u
#define RESULT_WINNER_LIST 0x03003D90u

static uint32_t record(int i) { return FIGHTERS_ + (uint32_t)i * RECORD_; }
static int active(int i) { return read8(SLOTS_ + i) != 255; }

static void unsupported(void) { __builtin_trap(); }

static uint16_t pressedKeys(int i) {
  uint32_t base = 0x03001B30u + (uint32_t)i * 64;
  uint32_t now = base + (uint32_t)read8(base + 60) * 2;
  return read16(now + 20);
}

/** 0x0801a228: whether a fighter has won, by the fight's rule: mode 2 counts the points each fighter reached, and the
 *  others go by time and points. Only the score rule is reached by a start point so far. */
int fightWinner(int mode) {
  if (read8(SETUP_ + 8) != 0) return 255;   // team fights aren't reached yet
  if (mode == 2) {
    int wins = 0;
    for (int i = 0; i < 4; i++) {
      if (read8(SETUP_ + 51 + i) >= read8(SETUP_ + 6)) wins++;
      else if (read8(SETUP_ + 20 + i) != 255) {
        uint32_t at = SETUP_ + 106 + (uint32_t)i * 2;
        write16(at, (uint16_t)(read16(at) + 1));
      }
    }
    if (wins < read8(SETUP_ + 36) - 1) return 255;
    for (int i = 0; i < 4; i++) {
      if (read8(SETUP_ + 51 + i) >= read8(SETUP_ + 6)) return i;
      if (read8(SETUP_ + 20 + i) != 255) return i;
    }
    return 9;
  }
  return 255;
}

/** 0x0801a61c: the fighter whose result is shown, by the score rule's lowest time or the others' points. */
void selectWinner(int mode) {
  int selected = 0;
  if (mode == 2) {
    for (int i = 1; i < 4; i++) {
      if (read8(SLOTS_ + i) != 255 && read16(SETUP_ + 106 + (uint32_t)selected * 2) > read16(SETUP_ + 106 + (uint32_t)i * 2)) selected = i;
    }
  } else {
    for (int i = 1; i < 4; i++) {
      if (read8(SLOTS_ + i) != 255 && read8(SETUP_ + 39 + selected) > read8(SETUP_ + 39 + i)) selected = i;
    }
  }
  write8(RESULT_WINNER_LIST, (uint8_t)selected);
}

/** The song a winner's character leaves, from 0x0801afc4's switch. */
static int winnerSong(int character) {
  switch (character) {
    case 0: return 0x103;
    case 1: return 0x104;
    case 2: return 0x105;
    case 3: return 0x106;
    case 4: return 0x108;
    case 5: return 0x107;
    case 6: return 0x109;
    case 7: return 0x10A;
    default: return 0x10B;
  }
}

/** 0x080207ec: the fade to black over `frames` frames, from the ending to the result. */
static void startFadeOut(int frames) {
  queueRegister(0x50, 0xFF);   // BLDCNT: every layer, brightness down
  queueRegister(0x54, 0);
  write8(0x03004B04, 1);
  write16(0x03004B00, 0);
  int step = 0x7FFF / (frames ? frames : 1);
  write16(0x03004B08, (uint16_t)(step ? step : 1));
}

/** The drawing every fight frame does after its wait: the view on the player, the HUD, the fighters and the arena. */
static void drawFightFrameHud(int player, int hud) {
  followFighter(player);
  setHeightShift();
  layersFromCamera();
  clearQueue();
  drawHud(hud);
  keepQueued();
  drawFighters(4);
  drawArenaThings();
  drawArena();
  sortQueue();
  drawSpritesNow();
  copyAtVblank();
}

static void drawFightFrame(int player) { drawFightFrameHud(player, 0); }

/** 0x0801ad38: the countdown before a fight. The first frames set each fighter's side, then 0x08015858 counts the
 *  banner; when it ends, the fight's own frame starts. */
void battleReadyFrame(void) {
  int player = (int)read32(PLAYER_);
  readAllKeys(player);
  if (read16(FIGHT_CLOCK + 4) <= 2) {
    static const int toward[4] = {6, 4, 6, 4};
    static const int side[4] = {1, 0, 1, 0};
    for (int i = 0; i < 4; i++) {
      write8(record(i) + 36, (uint8_t)toward[i]);
      write8(record(i) + 37, (uint8_t)toward[i]);
      write8(record(i) + 16, (uint8_t)side[i]);
      write8(record(i) + 18, (uint8_t)side[i]);
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

void battleReadyAfterWait(void) {
  drawFightFrame((int)read32(PLAYER_));
}

/** 0x0801b394: a fight's frame. It runs every fighter, then its wait, then the winner check. A win hands the next
 *  frame to the ending and starts the Game Set banner, whose first frame the wait below draws. */
void battleFrame(void) {
  int player = (int)read32(PLAYER_);
  readAllKeys(player);
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
  if (read8(SETUP_ + 135) == 0 && read8(SETUP_ + 116) == 0) {
    int winner = fightWinner(read8(SETUP_ + 4));
    write8(RESULT_WINNER, (uint8_t)winner);
    if (winner != 255) beginEnding();
  }
  g.after_wait = battleAfterWait;
}

/** 0x0801b394's win branch: the Game Set banner, the ending's next frame, and the sound the win plays. */
void beginEnding(void) {
  int player = (int)read32(PLAYER_);
  startHud(40);   // the Game Set banner, which the ending draws by the HUD's mode
  g.callback = endingFrame;
  write8(SETUP_ + 135, 1);
  endFade();
  gba_sound_play(47);
  forgetKeys(player);
}

void battleAfterWait(void) {
  int player = (int)read32(PLAYER_);
  if ((pressedKeys(player) & 8) && countUntilDone() == 30) unsupported();   // 0x0801c8f0, pausing
  // 0x0801bb1a, the way 0x0801b394 draws after a win: the fight's frame with the ending's HUD mode, whose first
  // draw only marks the banner as started
  drawFightFrameHud(player, read8(SETUP_ + 135) != 0 ? hudMode() : 0);
}

/** 0x0801afc4: the ending after someone has won. 0x080158c0 counts its frames; when it ends, the winner's song plays
 *  and the way to the result starts. The fighters keep their scripts and the view keeps following them, and the wait
 *  below draws the frame, as the original's wait does. */
void endingFrame(void) {
  for (int i = 0; i < 4; i++) forgetKeys(i);
  if (countSlides()) {
    startFadeOut(32);   // 0x080207ec(32), the fade the way to the result uses
    g.callback = resultTransition;
    int winner = fightWinner(read8(SETUP_ + 4));
    write8(RESULT_WINNER, (uint8_t)winner);
    int character = winner < 4 ? read8(record(winner) + 196) : 0;
    gba_sound_play(winnerSong(character));
    selectWinner(read8(SETUP_ + 4));
  }
  startFighterEffects();
  updateThings();
  for (int i = 0; i < 4; i++) {
    if (!active(i)) continue;
    fighterThink(i);
    moveFighter(i);
  }
  for (int i = 0; i < 4; i++) {
    if (!active(i)) continue;
    reachOthers(i);
    readFighterKeys(i);
    fighterAct(i);
  }
  g.after_wait = endingAfterWait;
}

void endingAfterWait(void) {
  int player = (int)read32(PLAYER_);
  drawFightFrameHud(player, hudMode());
  uint32_t at = SETUP_ + 114;
  write16(at, (uint16_t)(read16(at) + 1));
}

/** 0x0801bd90: the way out of a fight. It fades its song and then the screen, and chooses the result screen by the
 *  mode. The result screen itself is later work: reaching it here is a trap, as the recording ends before it. */
void resultTransition(void) {
  int player = (int)read32(PLAYER_);
  forgetKeys(player);
  write8(0x03002034, 0);
  uint8_t song = read8(SONG_);
  if (song != 255) {
    gba_sound_fade_out(gba_rom[0x08BF7244 - CARTRIDGE + (uint32_t)song * 8 + 4], 120 >> 4);
    write8(SONG_, 255);
  }
  if (stepFade()) {
    int mode = read8(SETUP_ + 125);
    if (mode == 0 || mode == 1) g.callback = resultScreen;
    else if (mode == 2) unsupported();
    else if (mode == 3) unsupported();
    else if (mode == 4) unsupported();
    else if (mode == 5) unsupported();
  }
  g.after_wait = resultTransitionAfterWait;
}

void resultTransitionAfterWait(void) {
  int player = (int)read32(PLAYER_);
  if (stepFade()) {
    for (int i = 0; i < 512; i++) gba_pal[i] = 0;
    endFade();
    return;
  }
  int shown = read8(SETUP_ + 136);
  drawFightFrameHud(shown == 255 ? player : shown, hudMode());
}

