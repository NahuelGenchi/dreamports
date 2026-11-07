// Sonic Battle Dreamport in C: the game's own code, on the Game Boy Advance kit in C (kit/gba/c/gba.h), translated
// from the JavaScript version in games/sonic-battle/src/. src/main.js runs it on the page, built to WebAssembly as
// src/game.wasm (kit/gba/c/README.md).
//
// The core (core.c) runs every screen from power-on: the SEGA and Sonic Team logos, the intro and the title screen are
// here, written from logos.js, intro.js and title.js, handing over to the name entry (nameentry.c), the main menu
// (menu.c) and a fight's opening (fight.c).
//
// A recording's start point can open a screen straight away: fight=training&vblanks=... opens the fight's opening
// (main.c's startFightFromPoint), and name=1 opens the screens that follow the title with a saved name.

#include "game.h"
#include "nameentry.h"

#define ROM(addr) (gba_rom + ((addr) - CARTRIDGE))

// the colour effect: alpha blending (1) of layer 2 (4) over layer 3 (8)
enum { ALPHA = 1, LAYER_2 = 4, LAYER_3 = 8 };

// the display registers the kit's REG doesn't name: BG0VOFS through BG2VOFS, BG2PC and BG2PD, and BG3's scroll
enum {
  BG0VOFS = REG_BG0HOFS + 2, BG1HOFS = REG_BG0HOFS + 4, BG1VOFS = REG_BG0HOFS + 6,
  BG2HOFS = REG_BG0HOFS + 8, BG2VOFS = REG_BG0HOFS + 10, BG2PC = REG_BG2PA + 4, BG2PD = REG_BG2PA + 6,
  BG3HOFS = REG_BG2PA - 4, BG3VOFS = REG_BG2PA - 2,
};

// the intro's counters and the values they ease, named after the original's
static int16_t introTimer, introScene, introX, introY, introScroll, introScale, introScaleTarget;
static int16_t introTargetX, introTargetY;

// the title's counters and the values they ease, named after the original's gUnknown_030016bc, its pulse
// counter gUnknown_03001b08, x gUnknown_03001b2c, y gUnknown_030016c0, scale gUnknown_03001b24 and targets
static int16_t titleCounter, titlePulse, titleX, titleY, titleScale;
static int16_t titleTargetX, titleTargetY, titleScaleTarget;
static int titlePulseCount;

static void showLogos(void);
static void fadeOut(void);
static void introSetup(void);
static void introPictures(void);
static void introAnimation(void);
static void titleStep(void);
static void nameEntry(void);

/** `words` 16-bit words from the cartridge into the palette at `to`, as a DMA does. */
static void copyPalette(uint32_t from, uint32_t to, int words) {
  const uint8_t *src = ROM(from);
  uint16_t *dst = gba_pal + ((to - PALETTE) >> 1);
  for (int i = 0; i < words; i++) dst[i] = (uint16_t)(src[i * 2] | (src[i * 2 + 1] << 8));
}

/** One signed 16-bit number of a table in the player's copy, which keeps them as signed 16-bit words. */
static int16_t fromTable(uint32_t table, int index) {
  return reads16(table + (uint32_t)(index * 2));
}

// ---- the logos (logos.js) ----

/** 0x080006ec: the colours from the first picture, then the logos. */
static void fadeIn(void) {
  if (fadeToward(PALETTE, 0x083270B4, 0x100)) {
    g.blend_target = 0x10;
    g.callback = showLogos;
  }
}

/** 0x080003a8: a frame count copies each logo into the hidden layer and turns the cross-fade toward it. */
static void showLogos(void) {
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
      g.callback = fadeOut;
      break;
  }
  if (g.keys.held & KEY_START) {
    if (((g.counter - 0x19) & 0xFFFF) <= 0x66) g.counter = 0x7F;
    else if (((g.counter - 0xA1) & 0xFFFF) <= 0x66) g.counter = 0x107;
  }
  if (g.blend > g.blend_target) g.blend -= 2;
  if (g.blend < g.blend_target) g.blend += 2;
  setBlend(ALPHA, LAYER_2, LAYER_3, g.blend & 0xFF, (0x10 - g.blend) & 0xFF, 0);
  setRotation(0, 0, 0x100, 0x100, 1, 1, 0, 2);
  setRotation(0, 0, 0x100, 0x100, 1, 1, 0, 3);
}

/** 0x08000724: every colour to black, then no colour effect, the palette cleared, and the intro. */
static void fadeOut(void) {
  if (fadeToBlack(PALETTE, 0x100)) {
    setBlend(0, 0, 0, 0, 0, 0);
    for (int i = 0; i < 512; i++) gba_pal[i] = 0;
    g.callback = introSetup;
  }
}

/** 0x08000210: the logos' screen, its two layers and the first picture. */
static void logosSetup(void) {
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
  gba_write(REG_BG2PA, 0x100); gba_write(REG_BG2PA + 2, 0); gba_write(REG_BG2PA + 4, 0); gba_write(REG_BG2PA + 6, 0x100);
  gba_write(REG_BG2X, 0); gba_write(REG_BG2X + 2, 0); gba_write(REG_BG2Y, 0); gba_write(REG_BG2Y + 2, 0);
  gba_write(REG_BG3PA, 0x100); gba_write(REG_BG3PA + 2, 0); gba_write(REG_BG3PA + 4, 0); gba_write(REG_BG3PA + 6, 0x100);
  gba_write(REG_BG3X, 0); gba_write(REG_BG3X + 2, 0); gba_write(REG_BG3Y, 0); gba_write(REG_BG3Y + 2, 0);
  setBlend(ALPHA, LAYER_2, LAYER_3, 0, 0x10, 0);
  gba_sound_stop_all();
  g.callback = fadeIn;
}

// ---- the intro (intro.js) ----

/** 0x08172a3c: each picture's centre as it comes in (x, y), then the centre it moves to; 0x08172a64: layer 0's
 *  scroll as each comes in, then where it moves to. */
#define POSITIONS 0x08172A3Cu
#define SCROLLS 0x08172A64u

// 0x0803d860's five pictures: layer 2's palette, tiles and map, and layer 0's tiles and map, with how many
// 16-bit words of each there are
typedef struct {
  uint32_t palette, tiles, map, layer0Tiles, layer0Map;
  int tilesWords, mapWords, layer0TilesWords, layer0MapWords;
} IntroPicture;

static const IntroPicture INTRO_PICTURE_LIST[5] = {
  { 0x083F4418, 0x083F4618, 0x083F8518, 0x08409038, 0x084093D8, 0x1F80, 0x200, 0x1D0, 0x400 },
  { 0x083F8918, 0x083F8B18, 0x083FCA98, 0x08409BF8, 0x0840A418, 0x1FC0, 0x400, 0x410, 0x400 },
  { 0x083FCE98, 0x083FD098, 0x08400E18, 0x0840AC38, 0x0840B318, 0x1EC0, 0x400, 0x370, 0x400 },
  { 0x08401218, 0x08401418, 0x08404CD8, 0x0840BB38, 0x0840BF38, 0x1C60, 0x400, 0x200, 0x400 },
  { 0x084050D8, 0x084052D8, 0x08408C18, 0x0840C758, 0x0840CCD8, 0x1CA0, 0x400, 0x2C0, 0x400 },
};

// 0x0803dd14's looping animation: six pictures, each layer 2's tiles and map. Only the first brings a palette
// too. The ones that move their centre a pixel up say so.
typedef struct { uint32_t palette, tiles, map; int tilesWords, mapWords; int up; } IntroFrame;
static const IntroFrame INTRO_ANIMATION_FRAMES[6] = {
  { 0x0840D4D8, 0x0840D6D8, 0x0840F318, 0xE20, 0x200, 0 },
  { 0, 0x0840F918, 0x08411458, 0xDA0, 0x200, 0 },
  { 0, 0x08411A58, 0x08413698, 0xE20, 0x200, 1 },
  { 0, 0x08413C98, 0x08415998, 0xE80, 0x200, 0 },
  { 0, 0x08415F98, 0x08417BD8, 0xE20, 0x200, 0 },
  { 0, 0x084181D8, 0x08419E18, 0xE20, 0x200, 1 },
};

/** BG2X and BG2Y, low half first, as the original writes them: the high half keeps only 12 bits. */
static void setReference(int32_t x, int32_t y) {
  gba_write(REG_BG2X, (uint16_t)x);
  gba_write(REG_BG2X + 2, (uint16_t)((uint32_t)x >> 16 & 0x0FFF));
  gba_write(REG_BG2Y, (uint16_t)y);
  gba_write(REG_BG2Y + 2, (uint16_t)((uint32_t)y >> 16 & 0x0FFF));
}

/** The intro's hand-over to the title (0x0803e1b0), whose frame 0 is the next one. */
static void toTitle(void) {
  for (int i = 0; i < 512; i++) gba_pal[i] = 0;
  titleCounter = -1;
  titlePulse = -1;
  titlePulseCount = 0;
  titleX = 0;
  titleY = 0;
  titleTargetX = 0;
  titleTargetY = 0;
  titleScale = 0;
  titleScaleTarget = 0;
  g.callback = titleStep;
}

/** 0x0803d748: the intro's start. */
static void introSetup(void) {
  newScreen(1);                 // 0x08016078
  for (int i = 0; i < 0x18000; i++) gba_vram[i] = 0;        // 0x08017cb0
  for (int i = 1; i < 512; i++) gba_pal[i] = gba_pal[0];    // 0x08017cd8
  queueRegister(REG_DISPCNT, 0x541);
  for (int i = 0; i < 512; i++) gba_pal[i] = 0;
  gba_write(REG_BG0CNT, 0);
  gba_write(REG_BG1CNT, 0);
  gba_write(REG_BG2CNT, 0);
  gba_write(REG_BG3CNT, 0);
  gba_write(REG_BG2CNT, 0x5782);
  gba_write(REG_BG0CNT, 0x1F0D);
  for (unsigned reg = REG_BG0HOFS; reg < 0x20; reg += 2) gba_write(reg, 0);
  setBlend(0, 0, 0, 0, 0, 0);
  introTimer = 255;
  introScene = -1;
  introX = fromTable(POSITIONS, 0);
  introY = fromTable(POSITIONS, 1);
  introScroll = fromTable(SCROLLS, 0);
  introScale = 0;
  introScaleTarget = 0;
  introTargetX = 0;
  introTargetY = 0;
  gba_sound_stop_all();        // 0x0801f638
  gba_sound_play(0);           // 0x0801f618
  g.callback = introPictures;
}

/** 0x0803d860: the five pictures, each panned toward its target, then the animation. */
static void introPictures(void) {
  if (introTimer > 12) {
    introScene++;
    const IntroPicture *picture = &INTRO_PICTURE_LIST[introScene];
    copyPalette(picture->palette, PALETTE, 0x100);
    copyToVram(picture->tiles, 0x06000000, (uint32_t)picture->tilesWords);
    copyToVram(picture->map, 0x0600B800, (uint32_t)picture->mapWords);
    copyToVram(picture->layer0Tiles, 0x0600C000, (uint32_t)picture->layer0TilesWords);
    copyToVram(picture->layer0Map, 0x0600F800, (uint32_t)picture->layer0MapWords);
    introTimer = 0;
    introX = fromTable(POSITIONS, introScene * 2);
    introY = fromTable(POSITIONS, introScene * 2 + 1);
    introScroll = fromTable(SCROLLS, introScene);
  } else {
    introTimer++;
    if (introScene > 3 && introTimer > 7) {
      introTimer = -1;
      introScene = -1;
      introScale = 1;
      introScaleTarget = 256;
      g.callback = introAnimation;
    }
  }
  introX = s16(introX - ((introX - fromTable(POSITIONS, 10 + introScene * 2)) >> 2));
  introY = s16(introY - ((introY - fromTable(POSITIONS, 11 + introScene * 2)) >> 2));
  introScroll = s16(introScroll - ((introScroll - fromTable(SCROLLS, 5 + introScene)) >> 2));
  gba_write(REG_BG2PA, 0x100);
  gba_write(REG_BG2PA + 2, 0);
  gba_write(REG_BG2PA + 4, 0);
  gba_write(REG_BG2PA + 6, 0x100);
  setReference(((120 - introX) << 8) - 0x7800, ((120 - introY) << 8) - 0x5000);
  gba_write(BG0VOFS, (uint16_t)introScroll);
  if (g.keys.held & KEY_START) toTitle();
}

/** 0x0803dd14: a looping animation, scaled out to 320 and back in to 176, moved to (54, -24) on the way. */
static void introAnimation(void) {
  introTimer++;
  introScene++;
  if (introTimer == 0) {
    queueRegister(REG_DISPCNT, 0x441);
    gba_write(REG_BG2CNT, 0x5782);
    introX = -8;
    introY = 30;
    introTargetX = -8;
    introTargetY = 30;
  }
  if (introScene > 11) introScene = 0;
  if ((introScene & 1) == 0) {
    const IntroFrame *frame = &INTRO_ANIMATION_FRAMES[introScene / 2];
    if (frame->palette) copyPalette(frame->palette, PALETTE, 0x100);
    copyToVram(frame->tiles, 0x06000000, (uint32_t)frame->tilesWords);
    copyToVram(frame->map, 0x0600B800, (uint32_t)frame->mapWords);
    if (frame->up) introTargetY = s16(introTargetY - 1);
  }
  introX = s16(introX - ((introX - introTargetX) >> 2));
  introY = s16(introY - ((introY - introTargetY) >> 2));
  introScale = s16(introScale - ((introScale - introScaleTarget) >> 2));
  if (introTimer == 60) introScaleTarget = 320;
  else if (introTimer == 75) {
    introScaleTarget = 176;
    introTargetX = 54;
    introTargetY = -24;
  } else if (introTimer == 90) {
    introTimer = -1;
    introScene = -1;
    introScroll = 0;
    introX = 0;
    introY = 0;
    introTargetX = 0;
    introTargetY = 0;
    toTitle();
  }
  // BG2's matrix at angle 0: pa and pd the cosine, pb the sine, pc its negation, each over the scale
  const int32_t cosine = (int32_t)reads16(0x0804DF7C + 0x800 * 2) * 8;
  const int32_t sine = (int32_t)reads16(0x0804DF7C) * 8;
  int32_t pa = divArm(introScale, cosine) & 0xFFFF;
  int32_t pb = divArm(introScale, sine) & 0xFFFF;
  int32_t pc = -divArm(introScale, sine) & 0xFFFF;
  int32_t pd = divArm(introScale, cosine) & 0xFFFF;
  gba_write(REG_BG2PA, (uint16_t)pa);
  gba_write(REG_BG2PA + 2, (uint16_t)pb);
  gba_write(REG_BG2PA + 4, (uint16_t)pc);
  gba_write(REG_BG2PA + 6, (uint16_t)pd);
  setReference(((120 - introX) << 8) - (int16_t)pa * 120 - (int16_t)pb * 80,
    ((120 - introY) << 8) - (int16_t)pc * 120 - (int16_t)pd * 80);
  if (g.keys.held & KEY_START) toTitle();
}

// ---- the title screen (title.js) ----

// The two choices of background tiles, by the language byte (0 picks the other): the map goes to the same place either way.
typedef struct { uint32_t tiles, map; int words; } TitleTiles;
static const TitleTiles TITLE_TILE_SETS[2] = {
  { 0x0841A418, 0x0841DBD8, 0x1BE0 },
  { 0x0841E5D8, 0x08421F18, 0x1CA0 },
};

// The four background layers' tile and map blocks, which the original copies into VRAM at frame 0: source,
// destination and 16-bit words. The first layer's tiles are the tile set above; these are the other blocks.
static const struct { uint32_t from, to; int words; } TITLE_LAYERS[6] = {
  { 0x08423FD8, 0x06004000, 0x300 },
  { 0x084245D8, 0x06007800, 0x400 },
  { 0x08424DF8, 0x06008000, 0x300 },
  { 0x084253F8, 0x0600B800, 0x400 },
  { 0x08425C18, 0x0600C000, 0x210 },
  { 0x08426038, 0x0600F800, 0x400 },
};

// The sprites' tiles, at 0x06010000 and 0x06011000, with the 1D object mapping DISPCNT gives them.
static const struct { uint32_t from, to; int words; } TITLE_SPRITE_TILES[2] = {
  { 0x08422738, 0x06010000, 0xC40 },
  { 0x08426858, 0x06011000, 0x800 },
};

// The palette loads of frame 1: two 16-colour sprite palettes, then the backgrounds' 256 colours.
static const struct { uint32_t from, to; int words; } TITLE_PALETTES[3] = {
  { 0x08422718, 0x05000200, 0x10 },
  { 0x08426838, 0x05000220, 0x10 },
  { 0x0841A218, 0x05000000, 0x100 },
};

// The six sprites, as 0x0803e1b0 queues them: x, y, tile, palette and the engine's sprite type. Types 106 and
// 117 are the engine's: 106 is the big affine sprite, 117 a normal 64x32 one. The affine two share matrix 0.
typedef struct { int x, y, tile, palette, type; } TitleSprite;
static const TitleSprite TITLE_SPRITES[6] = {
  { 32, 110, 0, 0, 106 },
  { 88, 110, 32, 0, 106 },
  { 0, 128, 128, 1, 117 },
  { 64, 128, 160, 1, 117 },
  { 128, 128, 192, 1, 117 },
  { 192, 128, 224, 1, 117 },
};

/** 0x08016b30's cases 106 and 117: a sprite's type and its place as the three words of an OAM entry. 0x08017690
 *  gives every sprite priority 3 here. */
static void titleOamEntry(int i, const TitleSprite *sprite) {
  uint16_t base = sprite->type == 106 ? 0x4300 : 0x4000;
  g.sprites[i * 4 + 0] = (uint16_t)(base | sprite->y);
  g.sprites[i * 4 + 1] = (uint16_t)(0xC000 | (sprite->x & 0x1FF));
  g.sprites[i * 4 + 2] = (uint16_t)((sprite->tile & 0x3FF) | (3 << 10) | ((sprite->palette & 0xF) << 12));
}

/** 0x0803e1b0's frame 0: the display off, the four layers and their pictures, the sprites' tiles, the BG2
 *  matrix at its start, and where the scene's counters begin. */
static void titleFirstFrame(void) {
  queueRegister(REG_DISPCNT, 0x40);
  gba_write(REG_BG0CNT, 0x0F07);
  gba_write(REG_BG1CNT, 0x170B);
  gba_write(REG_BG2CNT, 0x1F0F);
  gba_write(REG_BG3CNT, 0x1E81);
  const TitleTiles *tiles = &TITLE_TILE_SETS[g.language ? 1 : 0];
  copyToVram(tiles->tiles, 0x06000000, (uint32_t)tiles->words);
  copyToVram(tiles->map, 0x0600F000, 0x400);
  for (int i = 0; i < 6; i++) copyToVram(TITLE_LAYERS[i].from, TITLE_LAYERS[i].to, (uint32_t)TITLE_LAYERS[i].words);
  titleX = -16;
  titleY = 0;
  titleTargetX = 36;
  titleTargetY = 0;
  titleScale = 256;
  titleScaleTarget = 256;
  // BG3's scroll, then BG2's matrix (the identity) and reference point
  gba_write(BG3HOFS, 0);
  gba_write(BG3VOFS, 0);
  gba_write(REG_BG2PA, 256);
  gba_write(REG_BG2PA + 2, 0);
  gba_write(BG2PC, 0);
  gba_write(BG2PD, 256);
  gba_write(REG_BG2X, 0);
  gba_write(REG_BG2X + 2, 0);
  gba_write(REG_BG2Y, 0);
  gba_write(REG_BG2Y + 2, 0);
  for (int i = 0; i < 2; i++) copyToVram(TITLE_SPRITE_TILES[i].from, TITLE_SPRITE_TILES[i].to, (uint32_t)TITLE_SPRITE_TILES[i].words);
}

/** 0x0803e1b0's frame 1: the palettes, and the display on again, queued for the next V-blank. */
static void titleSecondFrame(void) {
  for (int i = 0; i < 3; i++) copyPalette(TITLE_PALETTES[i].from, TITLE_PALETTES[i].to, TITLE_PALETTES[i].words);
  queueRegister(REG_DISPCNT, 0x1F40);
}

/** The matrix the two affine sprites share: a scale from the angle's cosine over the scene's scale, no turn. */
static void titleMatrixOf(void) {
  int32_t cosine = (int32_t)reads16(0x0804DF7C + 0x800 * 2) * 8;
  int32_t sine = (int32_t)reads16(0x0804DF7C) * 8;
  g.matrices[0] = (uint16_t)(divArm(titleScale, cosine) & 0xFFFF);
  g.matrices[1] = (uint16_t)(divArm(titleScale, sine) & 0xFFFF);
  g.matrices[2] = (uint16_t)(-divArm(titleScale, sine) & 0xFFFF);
  g.matrices[3] = (uint16_t)(divArm(titleScale, cosine) & 0xFFFF);
}

/** The six sprites and their matrix, queued for the V-blank (0x08018004 and 0x08017f34), which it asks to copy. */
static void titleQueueSprites(void) {
  clearSprites();
  for (int i = 0; i < 6; i++) titleOamEntry(i, &TITLE_SPRITES[i]);
  titleMatrixOf();
  g.sprite_count = 6;
  g.matrix_count = 1;
  copyAtVblank();
}

/** What follows neither screen is ported yet: the screen goes black and waits there. */
static void afterTitle(void) {
  for (int i = 0; i < 512; i++) gba_pal[i] = 0;
  for (int i = 0; i < 512; i++) gba_oam[i] = 0x200;
}

/** 0x0803e6e8: the palette one step to black each frame, then the name entry, which leads on to the main menu. */
static void titleFadeToNext(void) {
  if (fadeToBlack(PALETTE, 0x100)) {
    setBlend(0, 0, 0, 0, 0, 0);
    for (int i = 0; i < 256; i++) gba_pal[i] = 0;
    queueRegister(REG_DISPCNT, 0x1F40);
    g.callback = nameEntry;
  }
}

/** 0x0803e74c: the same fade when the title screen is left alone, out to the attract mode. */
static void titleFadeToAttract(void) {
  if (fadeToBlack(PALETTE, 0x100)) {
    setBlend(0, 0, 0, 0, 0, 0);
    for (int i = 0; i < 256; i++) gba_pal[i] = 0;
    queueRegister(REG_DISPCNT, 0x1F40);
    g.callback = afterTitle;
  }
}

/**
 * 0x0803e1b0: the title screen's callback. The intro hands over with both counters at -1, so its first frame
 * is this function's frame 0, which sets the screen up; frame 1 loads the palettes; from then on the scale
 * pulses and the layers ease, until Start (pressed after frame 80) or the 600-frame attraction timeout.
 */
static void titleStep(void) {
  titleCounter = s16(titleCounter + 1);
  titlePulse = s16(titlePulse + 1);
  if (titleCounter == 0) titleFirstFrame();
  else if (titleCounter == 1) titleSecondFrame();
  else if (titleCounter == 15) titleTargetY = 40;
  if (titlePulse == 15) {
    if (++titlePulseCount > 3) {
      titlePulseCount = 0;
      titleScale = 448;
    } else titleScale = 352;
    titlePulse = 0;
    titleScaleTarget = 256;
  }
  titleScale = s16(titleScale - ((titleScale - titleScaleTarget) >> 2));
  titleX = s16(titleX - ((titleX - titleTargetX) >> 2));
  titleY = s16(titleY - ((titleY - titleTargetY) >> 2));
  // BG2 turns diagonally with the frame count, and BG0 and BG1 slide opposite ways with the eased x and y
  int scroll = (uint16_t)titleCounter * 2;
  gba_write(BG2HOFS, (uint16_t)scroll);
  gba_write(BG2VOFS, (uint16_t)-scroll);
  gba_write(BG1HOFS, (uint16_t)-titleX);
  gba_write(BG1VOFS, (uint16_t)(48 - titleY));
  gba_write(REG_BG0HOFS, (uint16_t)titleX);
  gba_write(BG0VOFS, (uint16_t)(48 + titleY));
  titleQueueSprites();
  if ((g.keys.pressed & KEY_START) && titleCounter > 80) {
    titleCounter = 0;
    titlePulse = 0;
    titleX = 0;
    titleY = 0;
    titleTargetX = 0;
    titleTargetY = 0;
    clearSprites();
    gba_sound_play(404);          // 0x0801f618
    // 0x0801f718(0, 120): the player of song 0, the title's music, a step down every 120 >> 4 frames
    gba_sound_fade_out(gba_rom[0x08BF7244 - CARTRIDGE + 4], 7);
    g.callback = titleFadeToNext;
  } else if (titleCounter > 600) {
    titleCounter = 0;
    titlePulse = 0;
    titleX = 0;
    titleY = 0;
    titleTargetX = 0;
    titleTargetY = 0;
    clearSprites();
    g.callback = titleFadeToAttract;
  }
}

/**
 * 0x08036560: the name entry's first frame, or, with a name saved, straight on to the main menu. Its grid and letters
 * are nameentry.c's; this is the hand-over the title screen's fade makes.
 */
static void nameEntry(void) {
  if (g.name[0] != 0) {
    // with a name saved, the screen goes straight on to the menu
    g.callback = menuBeforeMenu;
    menuBeforeMenu();
    return;
  }
  nameEntryScreen();
}

void startFightFromPoint(void) {
  int vblanks = (int)gba_start_number("vblanks", 0);
  int action = (int)gba_start_number("action", 0) & 0xFF;
  startFight(vblanks, action);
}

/** The game starts again from the logos, as Delete data in the options does (0x08000210): a new save's name and
 *  language, and the screen's state reset. */
void restartFromStart(void) {
  for (int i = 0; i < 6; i++) g.name[i] = 0;
  g.mini_games_open = 1;
  g.language = 1;
  g.saved_language = 1;
  g.frames = 1;
  g.restarted = 1;
  g.start_up = 0;
  logosSetup();
}

// once, with the player's copy in gba_rom: the sound engine, then the console's power-on. Sonic Battle's sound is six
// music players, eight DirectSound channels, master volume 14, 10,512 Hz and no reverb, with its wave voice's write
// 84,800 cycles into the frame (sound.js), and the cycle count the fight's moving colours need (core.c, arena.c).
void game_start(void) {
  __builtin_memset(&g, 0, sizeof(g));
  introTimer = 0; introScene = 0; introX = 0; introY = 0; introScroll = 0;
  introScale = 0; introScaleTarget = 0; introTargetX = 0; introTargetY = 0;
  titleCounter = 0; titlePulse = 0; titleX = 0; titleY = 0; titleScale = 0;
  titleTargetX = 0; titleTargetY = 0; titleScaleTarget = 0; titlePulseCount = 0;
  // the console after its start-up program: the screen white (forced blank) until the game shows it, and the rotating
  // layers at rest
  gba_write(REG_DISPCNT, 0x80);
  gba_write(REG_BG2PA, 0x100); gba_write(REG_BG2PA + 2, 0); gba_write(REG_BG2PA + 4, 0); gba_write(REG_BG2PA + 6, 0x100);
  gba_write(REG_BG2X, 0); gba_write(REG_BG2X + 2, 0); gba_write(REG_BG2Y, 0); gba_write(REG_BG2Y + 2, 0);
  gba_write(REG_BG3PA, 0x100); gba_write(REG_BG3PA + 2, 0); gba_write(REG_BG3PA + 4, 0); gba_write(REG_BG3PA + 6, 0x100);
  gba_write(REG_BG3X, 0); gba_write(REG_BG3X + 2, 0); gba_write(REG_BG3Y, 0); gba_write(REG_BG3Y + 2, 0);
  {
    // the language the save keeps, or a start point's, or a new save's
    uint8_t *save = gba_save(8);
    int asked = (int)gba_start_number("language", -1);
    int saved = save[0] == 0xA5 ? save[1] : -1;
    g.language = asked >= 0 ? asked : saved >= 0 ? saved : 1;
    g.saved_language = g.language;
  }
  g.keys.inverted = 0xFFFF;
  g.keys.timer = 15;
  g.keys.delay = 15;
  g.keys.interval = 7;
  gba_on_hblank(hblank);
  gba_sound_start_layout(0xBF71FC, 6, 8, 14, 10512, 0, 1, 84800);
  gba_sound_count_cycles();
  int name = (int)gba_start_number("name", 0);
  if (name) g.name[0] = (uint16_t)name;
  if (gba_start_point("fight")) {
    g.start_up = 1;
    g.callback = startFightFromPoint;
  } else {
    g.start_up = 45;
    g.callback = logosSetup;
  }
}

void game_step(uint16_t keys) {
  step(keys);
}
