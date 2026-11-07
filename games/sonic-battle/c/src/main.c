// Sonic Battle Dreamport in C: the game's own code, on the Game Boy Advance kit in C (kit/gba/c/gba.h), translated
// from the JavaScript version in games/sonic-battle/src/. src/main.js runs it on the page, built to WebAssembly as
// src/game.wasm (kit/gba/c/README.md).
//
// The SEGA and Sonic Team logos are written from logos.js. The intro, the title screen and the name entry in C come in
// their own tasks (#643, #644 and #645), and here only the way the original takes through them is, so a recording from
// power-on reaches the main menu: the intro's pictures, the title's layers and the name entry's grid aren't drawn, and
// their frames differ in C until their tasks are done. The main menu is written from menu.js (menu.c).
//
// What comes after a screen is what it hands over to: the logos' fade hands over to the intro, its last animation frame
// to the title, the title's Start to the name entry, and Start there to the main menu. A recording's start point opens
// the fight's own opening (fight.c), as its own recording does.

#include "game.h"

#define CARTRIDGE 0x08000000u
#define PALETTE 0x05000000u
#define SONG_TABLE 0x08BF7244u

// the colour effect: alpha blending (1) of layer 2 (4) over layer 3 (8)
enum { ALPHA = 1, LAYER_2 = 4, LAYER_3 = 8 };

static int savingFrames;
static int nameLength;
static int introTimer, introScene;
static int titleCounter;

static void logosFirstFrame(void);
static void logosFadeIn(void);
static void logosShow(void);
static void logosFadeOut(void);
static void introStart(void);
static void introPictures(void);
static void introAnimation(void);
static void titleFrame(void);
static void nameEntry(void);
static void nameDisplayOn(void);
static void nameEntering(void);
static void nameFadeOut(void);
static void nameSaving(void);

static inline uint16_t rom16(uint32_t at) { return (uint16_t)(gba_rom[at - CARTRIDGE] | (gba_rom[at - CARTRIDGE + 1] << 8)); }
static inline uint8_t rom8(uint32_t at) { return gba_rom[at - CARTRIDGE]; }
static inline void copyPalette(uint32_t from, uint32_t to, int count) {
  int at = (int)((to - PALETTE) >> 1);
  for (int i = 0; i < count; i++) gba_pal[at + i] = rom16(from + (uint32_t)i * 2);
}

/** The identity matrix both of the logos' rotating layers keep, as logos.js writes it. */
static void writeIdentity(void) {
  static const uint16_t identity[8] = {0x100, 0, 0, 0x100, 0, 0, 0, 0};
  for (int i = 0; i < 8; i++) {
    gba_write((uint16_t)(REG_BG2PA + i * 2), identity[i]);
    gba_write((uint16_t)(REG_BG3PA + i * 2), identity[i]);
  }
}

/** 0x08020500: each colour one step nearer the cartridge's colours at `from`. */
static int logosFadeToward(uint32_t from, int count) { return fadeToward(PALETTE, from, count); }

/** 0x08000210: the logos' screen, its two layers and the first picture. */
static void logosFirstFrame(void) {
  newScreen(1);
  // the first picture in layer 2 (tiles at 0x06000000, map at 0x06007000), and an empty one in layer 3
  copyToVram(0x08328C74, 0x06000000, 0x10A0);
  copyToVram(0x0832ADB4, 0x06007000, 0x200);
  copyToVram(0x08330134, 0x06008000, 0x20);
  copyToVram(0x08330174, 0x0600F000, 0x200);
  // both rotating layers 512 pixels across, in 256 colours: layer 2 in front, layer 3 behind it
  clearLayer(2);
  layerBits(2, 0x4000); layerBits(2, 0); layerBits(2, 0x80); layerBits(2, 0); layerBits(2, 0);
  layerCharBase(2, 0); layerScreenBase(2, 0xE);
  clearLayer(3);
  layerBits(3, 0x4000); layerBits(3, 2); layerBits(3, 0x80); layerBits(3, 0); layerBits(3, 0);
  layerCharBase(3, 2); layerScreenBase(3, 0x1E);
  setBlend(ALPHA, LAYER_2, LAYER_3, 0, 0x10, 0);
  writeIdentity();
  gba_sound_stop_all();
  g.counter = 0;
  g.blend = 0;
  g.blend_target = 0;
  g.callback = logosFadeIn;
}

/** 0x080006ec: the colours from the first picture, then the logos. */
static void logosFadeIn(void) {
  if (logosFadeToward(0x083270B4, 0x100)) {
    g.blend_target = 0x10;
    g.callback = logosShow;
  }
}

/** 0x080003a8: a frame count copies each logo into the hidden layer and turns the cross-fade toward it. */
static void logosShow(void) {
  g.counter = (g.counter + 1) & 0xFFFF;
  switch (g.counter) {
    case 0x8:
      copyToVram(0x083272B4, 0x06008000, 0xAE0);
      copyToVram(0x08328874, 0x0600F000, 0x200);
      g.blend_target = 0;
      break;
    case 0x80:
      g.blend_target = 0x10;
      break;
    case 0x88:
      copyToVram(0x0832B1B4, 0x06008000, 0x1600);
      copyToVram(0x0832DDB4, 0x0600F000, 0x200);
      g.blend_target = 0;
      break;
    case 0x90:
      gba_sound_play(400);
      copyToVram(0x0832E1B4, 0x06000000, 0xDC0);
      copyToVram(0x0832FD34, 0x06007000, 0x200);
      g.blend_target = 0x10;
      break;
    case 0x108:
      g.blend_target = 0;
      break;
    case 0x110:
      copyToVram(0x08330134, 0x06000000, 0x20);
      copyToVram(0x08330174, 0x06007000, 0x200);
      g.blend_target = 0x10;
      break;
    case 0x118:
      g.callback = logosFadeOut;
      break;
  }
  if (g.keys.held & KEY_START) {
    if (((g.counter - 0x19) & 0xFFFF) <= 0x66) g.counter = 0x7F;
    else if (((g.counter - 0xA1) & 0xFFFF) <= 0x66) g.counter = 0x107;
  }
  if (g.blend > g.blend_target) g.blend -= 2;
  if (g.blend < g.blend_target) g.blend += 2;
  setBlend(ALPHA, LAYER_2, LAYER_3, g.blend & 0xFF, (0x10 - g.blend) & 0xFF, 0);
  writeIdentity();
}

/** 0x08000724: every colour to black, then no colour effect, the palette cleared, and what comes next. */
static void logosFadeOut(void) {
  if (fadeToBlack(PALETTE, 0x100)) {
    setBlend(0, 0, 0, 0, 0, 0);
    for (int i = 0; i < 512; i++) gba_pal[i] = 0;
    g.callback = introStart;
  }
}

/**
 * The intro, whose pictures and animation are their own task (#643): here only its time and its song are, so the title
 * starts on the frame the original's does. 0x0803d748's start, its five pictures (0x0803d860) and its animation
 * (0x0803dd14).
 */
static void introStart(void) {
  newScreen(1);
  for (int i = 0; i < 0x18000; i++) gba_vram[i] = 0;
  for (int i = 1; i < 512; i++) gba_pal[i] = gba_pal[0];
  queueRegister(REG_DISPCNT, 0x541);
  for (int i = 0; i < 512; i++) gba_pal[i] = 0;
  gba_write(REG_BG0CNT, 0);
  gba_write(REG_BG1CNT, 0);
  gba_write(REG_BG2CNT, 0);
  gba_write(REG_BG3CNT, 0);
  gba_write(REG_BG2CNT, 0x5782);
  gba_write(REG_BG0CNT, 0x1F0D);
  for (int reg = REG_BG0HOFS; reg < 0x20; reg += 2) gba_write((uint16_t)reg, 0);
  setBlend(0, 0, 0, 0, 0, 0);
  introTimer = 255;
  introScene = -1;
  gba_sound_stop_all();   // 0x0801f638
  gba_sound_play(0);      // 0x0801f618
  g.callback = introPictures;
}

static void introPictures(void) {
  if (introTimer > 12) {
    introScene++;
    introTimer = 0;
  } else {
    introTimer++;
    if (introScene > 3 && introTimer > 7) {
      introTimer = -1;
      introScene = -1;
      g.callback = introAnimation;
    }
  }
}

static void toTitle(void) {
  for (int i = 0; i < 512; i++) gba_pal[i] = 0;
  titleCounter = -1;
  g.callback = titleFrame;
}

static void introAnimation(void) {
  introTimer++;
  introScene++;
  if (introTimer == 60) {
    // the scale out
  } else if (introTimer == 75) {
    // the scale back in
  } else if (introTimer == 90) {
    toTitle();
    return;
  }
  if (introScene > 11) introScene = 0;
}

/**
 * The title screen, whose layers and logo are its own task (#644): here its counters, its palettes and Start are, which
 * is what decides when the name entry begins. 0x0803e1b0, 0x0803e6e8.
 */
static void titleFadeToNext(void);

static void titleFrame(void) {
  titleCounter = s16(titleCounter + 1);
  if (titleCounter == 0) {
    queueRegister(REG_DISPCNT, 0x40);
    gba_write(REG_BG0CNT, 0x0F07);
    gba_write(REG_BG1CNT, 0x170B);
    gba_write(REG_BG2CNT, 0x1F0F);
    gba_write(REG_BG3CNT, 0x1E81);
  } else if (titleCounter == 1) {
    // the palettes: two 16-colour sprite palettes, then the backgrounds' 256 colours
    copyPalette(0x08422718, 0x05000200, 0x10);
    copyPalette(0x08426838, 0x05000220, 0x10);
    copyPalette(0x0841A218, 0x05000000, 0x100);
    queueRegister(REG_DISPCNT, 0x1F40);
  }
  if ((g.keys.pressed & KEY_START) && titleCounter > 80) {
    titleCounter = 0;
    gba_sound_play(404);          // 0x0801f618
    gba_sound_fade_out(rom8(SONG_TABLE + 4), 7);   // 0x0801f718(0, 120)
    g.callback = titleFadeToNext;
  }
}

/** 0x0803e6e8: the palette one step to black each frame, then the name entry. */
static void titleFadeToNext(void) {
  if (!fadeToBlack(PALETTE, 0x100)) return;
  setBlend(0, 0, 0, 0, 0, 0);
  for (int i = 0; i < 0x100; i++) gba_pal[i] = 0;
  queueRegister(REG_DISPCNT, 0x1F40);
  g.callback = nameEntry;
}

static void nameSetUp(void);

/**
 * The name entry, whose grid and letters are its own task (#645): here its palettes, its keys and its way out are, so
 * Start keeps the name and the main menu begins on the frame the original's does. 0x08036560, 0x080368dc, 0x08036ce4.
 */
static void nameEntry(void) {
  if (g.name[0] != 0) {
    // with a name saved, the screen goes straight on to the menu (0x08036560)
    g.callback = menuBeforeMenu;
    menuBeforeMenu();
    return;
  }
  g.callback = nameSetUp;
}

static void nameSetUp(void) {
  for (int i = 0; i < 512; i++) gba_pal[i] = 0;
  // the palettes 0x08036d90 fades toward: the grid's, the name's and the mark's
  copyPalette(0x08156CD0, PALETTE, 32);
  copyPalette(0x08132754, 0x050001E0, 16);
  copyPalette(0x08158194, 0x05000200, 48);
  for (int i = 0; i < 0x18000; i++) gba_vram[i] = 0;
  nameLength = 0;
  g.callback = nameDisplayOn;
}

/** 0x08036560's last step: it runs past a V-blank, and the display and the song come as it ends. */
static void nameDisplayOn(void) {
  queueRegister(REG_DISPCNT, 8000);
  gba_sound_wave_at(163059);   // where the song's start comes in its frame, as mGBA measures it
  gba_sound_play(4);
  g.callback = nameEntering;
}

/** 0x080368dc: one key a frame, Start first: Start keeps the name, A and B change it. */
static void nameEntering(void) {
  uint16_t pressed = g.keys.pressed;
  if (pressed & KEY_START) {
    if (!nameLength) {
      gba_sound_play(419);
      return;
    }
    for (int i = 0; i < nameLength; i++) g.name[i] = (uint16_t)(0x41 + i);
    g.name[nameLength] = 0xFFFE;
    g.callback = nameFadeOut;
    gba_sound_fade_out(rom8(SONG_TABLE + 4 * 8 + 4), 7);
    gba_sound_play(404);
  } else if (pressed & KEY_A) {
    if (nameLength < 5) nameLength++;
  } else if (pressed & KEY_B) {
    if (nameLength) nameLength--;
  }
}

/** 0x08036ce4: every colour fades to black, and then the main menu starts. */
static void nameFadeOut(void) {
  if (!fadeToBlack(PALETTE, 512)) return;
  savingFrames = 20;
  g.callback = nameSaving;
}

/** The time 0x080217d0 takes, with the screen black. */
static void nameSaving(void) {
  if (--savingFrames <= 0) showMenu(1);
}

void startFightFromPoint(void) {
  int vblanks = (int)gba_start_number("vblanks", 0);
  int action = (int)gba_start_number("action", 0) & 0xFF;
  startFight(vblanks, action);
}

// once, with the player's copy in gba_rom: the sound engine, then the console's power-on, as core.js's createCore
// sets it up. Sonic Battle's sound is six music players, eight DirectSound channels, master volume 14, 10,512 Hz and no
// reverb (sound.js).
void game_start(void) {
  gba_write(REG_DISPCNT, 0x80);
  g.keys.timer = 15;
  g.keys.delay = 15;
  g.keys.interval = 7;
  g.language = 1;
  g.start_up = 45;
  g.callback = logosFirstFrame;
  gba_on_hblank(hblank);
  gba_sound_start_layout(0xBF71FC, 6, 8, 14, 10512, 0, 1, 84800);
  // the arena's moving colours land where the frame's work and SoundMain's take them (arena.c), as main.js's countCycles
  gba_sound_count_cycles();
  // a recording's start point: the fight's opening, or a saved name for the screens that follow the title
  if (gba_start_point("fight")) {
    g.start_up = 1;
    g.callback = startFightFromPoint;
  }
  int name = (int)gba_start_number("name", 0);
  if (name) g.name[0] = (uint16_t)name;
}

// what the original does each frame, writing the video hardware's registers, VRAM, colours and sprites as it does
void game_step(uint16_t keys) { step(keys); }
