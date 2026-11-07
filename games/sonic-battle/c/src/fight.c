// fight.js in C: a fight's opening, in Training mode: the arena, both fighters, their gauges and the choice of special
// attacks, until a player can move. The fight's functions share their state in work RAM at the original's addresses
// (bus.c), so what one sets the next reads, as in the original.
//
// Nothing before a fight leads here yet, so a recording's start point opens it: the address's fight=training says so,
// and vblanks= gives how many V-blanks the console has counted by then, which the view turns with during the choice.

#include "game.h"

#define SETUP_ SETUP
#define PLAYER_ PLAYER
#define SAVE_ SAVE
#define CHOSEN_ CHOSEN
#define SONG_ SONG
// each player's skills, stats and outfit, 156 bytes each
#define CHOICES_ 0x030013B0u
// the six starter decks a new save holds, and the catalogue each halfword is looked up in
#define STARTER_DECKS (SAVE_ + 0x322u)
#define DECK_BYTES 0x38
#define STARTER_IDS 0x0810B2F4u
#define STARTER_COUNT 0x1B
#define CATALOGUE 0x0810B32Cu
#define CATALOGUE_BYTES 8
#define FADE_LEVEL 0x03004B00u
#define FADE_KIND 0x03004B04u
#define FADE_STEP 0x03004B08u
#define VIEW_ VIEW
#define REGISTERS 0x0816EBECu
#define REGISTER_COUNT 16
#define BLDCNT 0x50
#define BLDY 0x54
#define NO_FIGHTER 255

static int setup(int at) { return read8(SETUP_ + (uint32_t)at); }

/** 0x08020840: the colour effect's fade in from black, over `frames` frames. */
static void startFadeIn(int frames) {
  queueRegister(BLDCNT, 0xFF);
  queueRegister(BLDY, 0x10);
  write16(FADE_KIND, 2);
  write16(FADE_LEVEL, 0x8000);
  int step = 0x7FFF / (frames ? frames : 1);
  write16(FADE_STEP, (uint16_t)(step ? step : 1));
}

/** 0x080198b0: the fight's counters cleared, the fighters' colours, the arena and the fighters set up. */
static void setUpFight(void) {
  write8(CHOSEN_, 0);
  write8(CHOSEN_ + 4, 0);
  for (int i = 0; i < 4; i++) {
    if (setup(28 + i) == 0 && setup(20 + i) != NO_FIGHTER) write8(CHOSEN_ + 4, read8(CHOSEN_ + 4) + 1);
  }
  write8(SETUP_ + 136, 0xFF);
  static const int byteFields[5] = {39, 43, 47, 51, 137};
  static const int halfFields[7] = {58, 66, 74, 82, 90, 98, 106};
  for (int i = 0; i < 4; i++) {
    for (int n = 0; n < 5; n++) write8(SETUP_ + (uint32_t)byteFields[n] + i, 0);
    for (int n = 0; n < 7; n++) write16(SETUP_ + (uint32_t)halfFields[n] + (uint32_t)i * 2, 0);
    if (setup(12 + i) > 100) write8(SETUP_ + 12 + i, 100);
    if (setup(16 + i) > 100) write8(SETUP_ + 16 + i, 100);
    write8(SETUP_ + 141 + i, (uint8_t)setup(12 + i));
    write8(SETUP_ + 145 + i, (uint8_t)setup(16 + i));
  }
  write8(SETUP_ + 55, 0);
  write8(SETUP_ + 56, 0);
  write16(SETUP_ + 114, 0);
  write8(SETUP_ + 116, 0);
  write16(SETUP_ + 130, 0);
  write8(SETUP_ + 117, 0);
  write8(SETUP_ + 133, 0);
  write8(SETUP_ + 134, 0);
  write8(SETUP_ + 135, 0);
  write16(SETUP_ + 126, (uint16_t)(setup(7) * 3608));
  write16(SETUP_ + 128, (uint16_t)(setup(10) * 30));
  zeroQueue();
  write16(VIEW_ + 12, 0);
  write16(VIEW_ + 8, 0);
  write16(VIEW_ + 10, 0);
  write16(0x03001374, 0);
  write16(0x03001B24, 0);
  for (int i = 0; i < 4; i++) forgetKeys(i);
  clearBrainFlags();
  write8(0x03002034, 1);
  loadColours();
  for (int i = 0; i < 4; i++) if (setup(20 + i) != NO_FIGHTER) showColours(i, setup(20 + i), 0);
  int arena = setup(3 + setup(1));
  loadArena(arena);
  loadArenaShape(arena);
  resetFighters();
  clearEffects();
  for (int i = 0; i < 5; i++) {
    for (int n = 0; n < 16; n++) write16(0x050002A0 + (uint32_t)i * 32 + (uint32_t)n * 2, read16(0x08BF2058 + (uint32_t)i * 32 + (uint32_t)n * 2));
  }
  setViewRows(0, 160);
  setBrainLevel(setup(11));
  for (int i = 0; i < 4; i++) restartBrain(i);
  for (int i = 0; i < 4; i++) write8(0x03001C40 + 159 + (uint32_t)i * 252, 0);
}

/**
 * 0x08019b5c, for a fight that isn't a team's: each fighter's choices cleared, the gauges at nothing, a second fighter
 * of the same character marked to wear its other colours, and the colours loaded with that known.
 */
static void setUpFighters(void) {
  if (read8(0x03002600 + 7) == 0) {
    static const int fields[4] = {12, 16, 141, 145};
    for (int i = 0; i < 4; i++) for (int n = 0; n < 4; n++) write8(SETUP_ + (uint32_t)fields[n] + i, 0);
  }
  for (int i = 0; i < 4; i++) clearChoices(i);
  for (int i = 0; i < 4; i++) write8(SETUP_ + 24 + i, 0);
  int player = (int)read32(PLAYER_);
  for (int i = 0; i < 3; i++) {
    if (setup(20 + i) > 8) continue;
    for (int j = i + 1; j < 4; j++) {
      if (setup(20 + i) == setup(20 + j)) write8(SETUP_ + 24 + (j == player ? i : j), 1);
    }
  }
  loadColours();
  for (int i = 0; i < 4; i++) if (setup(20 + i) != NO_FIGHTER) showColours(i, setup(20 + i), 0);
  loadSharedSprites();
}

/** The song of the arena a fight is in, from 0x08019ed8. */
static const int ARENA_SONGS[12] = {10, 11, 12, 14, 15, 13, 17, 16, 18, 21, 22, 20};

/** 0x0801a898: a frame of the choice of special attacks. The view turns round the arena, and three choices start the fight. */
void choosing(void) {
  if (stepFade()) {
    readAllKeys(read8(PLAYER_));
    endFade();
  }
  int answer = chooseSpecials() & 0xFF;
  int chosen = read8(CHOSEN_);
  if (chosen > 8) {
    write8(CHOSEN_, 0);
    for (int i = 0; i < 4; i++) forgetKeys(i);
    if (setup(125) != 4) __builtin_trap();
    g.callback = trainingFrame;
  } else if (chosen != 0) write8(CHOSEN_, chosen + 1);
  else if (answer != 0) write8(CHOSEN_, 1);
  g.after_wait = choosingAfterWait;
}

/** 0x0801a898 past its wait for the V-blank: the view moves, and the picture is built for the next V-blank to show. */
void choosingAfterWait(void) {
  g.cycles = 0;
  g.counting = 1;
  moveCamera(0, 0);
  turnCamera(((g.vblanks & 0xFFFF) << 19) >> 16);
  zoomCamera(0x100);
  tiltCamera(0x300);
  int mode = hudMode();
  setHeightShift();
  layersFromCamera();
  clearQueue();
  drawHud(mode);
  keepQueued();
  if (mode != 10) {
    drawFighters(4);
    drawArenaThings();
  }
  drawArena();
  sortQueue();
  drawSpritesNow();
  copyAtVblank();
}

/**
 * 0x080215a8, partly: the starter decks a brand new save holds, each of its six the same 27 skills, as the game lays
 * them down when it finds no save. The rest of the block stays as a new one has it for what a fight reads.
 */
static void starterDecks(void) {
  for (int deck = 0; deck < 6; deck++) {
    for (int n = 0; n < STARTER_COUNT; n++) {
      write16(STARTER_DECKS + (uint32_t)deck * DECK_BYTES + (uint32_t)n * 2, read16(STARTER_IDS + (uint32_t)n * 2));
    }
  }
}

/** 0x08029cfc: one player's stats and outfit, looked up from the save's three rows of skills in the catalogue. */
static void loadProfile(int i) {
  uint32_t record = CHOICES_ + (uint32_t)i * 156;
  write8(record + 0x96, read8(SAVE_ + 0x320));
  for (int row = 0; row < 3; row++) {
    for (int n = 0; n < 27; n++) {
      uint16_t id = read16(STARTER_DECKS + (uint32_t)row * DECK_BYTES + (uint32_t)n * 2);
      write8(record + 0x45 + (uint32_t)row * 27 + (uint32_t)n, read8(CATALOGUE + (uint32_t)id * CATALOGUE_BYTES + 4));
    }
  }
}

/** The save and the four players' profiles as the mode-select screen leaves them for a fight: 0x080215a8's decks,
 *  then 0x08029cfc for each player. */
static void loadProfiles(void) {
  starterDecks();
  for (int i = 0; i < 4; i++) loadProfile(i);
}

/**
 * The fight's first frame: the values Start on Training's screen leaves with its first choices, 0x0801c82c, the new
 * screen and its fade, and 0x0801c8a4, with 0x08019ed8, which load everything and start the song. In the original these
 * take from the Training screen's fade to the fight's first picture, with the screen black all along.
 */
void startFight(int vblanks, int action, int you, int rival, int arena, int colour) {
  g.vblanks = vblanks;
  g.line_one = playQueuedEffects;
  for (int i = 0; i < 512; i++) gba_pal[i] = 0;
  write8(SAVE_ + 119, 1);
  for (int i = 0; i < REGISTER_COUNT; i++) {
    write16(IO + read16(REGISTERS + (uint32_t)i * 4), read16(REGISTERS + (uint32_t)i * 4 + 2));
  }
  write8(SETUP_ + 4, 0);
  write8(SETUP_ + 5, 10);
  for (int at = 6; at <= 11; at++) write8(SETUP_ + (uint32_t)at, 0);
  write8(SETUP_ + 36, 2);
  write8(SETUP_ + 20, (uint8_t)you);
  write8(SETUP_ + 21, NO_FIGHTER);
  write8(SETUP_ + 22, NO_FIGHTER);
  write8(SETUP_ + 23, (uint8_t)rival);
  write8(SETUP_ + 1, 0);
  write8(SETUP_ + 2, 1);
  write8(SETUP_ + 3, (uint8_t)arena);
  write8(SETUP_ + 38, (uint8_t)action);
  write8(SETUP_ + 125, 4);
  write8(SETUP_ + 0, 0);
  write32(PLAYER_, 0);
  loadProfiles();
  hideSpriteBuffer();
  newScreen(6);
  startFadeIn(24);
  stepFade();
  g.vblank_copies = 1;
  // the colour rows the Training screen copies into the player's choices for a character whose colours come from
  // them (loadColours), such as Chaos: byte 93 picks colours 3 to 6, 94 picks 7 to 10, and 95 picks 11 to 13
  if (colour != 255) {
    static const int rows[3] = {93, 94, 95};
    for (int n = 0; n < 3; n++) write8(CHOICES_ + (uint32_t)rows[n], (uint8_t)colour);
  }
  setUpFight();
  write8(SONG_, (uint8_t)ARENA_SONGS[setup(3 + setup(1))]);
  startHud(10);
  setUpFighters();
  gba_sound_frames_gone_by(vblanks - 2);
  gba_sound_play(read8(SONG_));
  fightVblank();
  g.callback = choosing;
}
