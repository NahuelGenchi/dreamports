// Sonic Battle Dreamport in C: the SEGA and Sonic Team logos, the game's first part. Written from
// games/sonic-battle/src/logos.js and the screen functions its core.js gives it, a function at a time: the palette
// fades from black to the first picture, the SEGA logo cross-fades in and out, then Sonic Team's, and the screen fades
// to black. The rest of the game follows it.
//
// The original's functions: 0x08000210 the logos' screen, 0x080006ec the colours from the first picture,
// 0x080003a8 the frame count, 0x08000724 the fade to black, 0x08016078 the new screen, 0x08017ed0 the sprites
// hidden, 0x080163c0 and 0x08017d78 the layers, 0x080183d0 the colour effect, 0x08016438 the rotation,
// 0x08020500 the colours toward the first picture and 0x0802067c the colours to black.

#include "gba.h"

#define ROM(addr) (gba_rom + ((addr) - 0x08000000u))

// the colour effect: alpha blending (1) of layer 2 (4) over layer 3 (8)
enum { ALPHA = 1, LAYER_2 = 4, LAYER_3 = 8 };

// the layers' control registers, and the rotating layers' parameters
static const unsigned BGCNT[4] = { REG_BG0CNT, REG_BG1CNT, REG_BG2CNT, REG_BG3CNT };

static int state;                 // 0 the fade in, 1 the logos, 2 the fade out, 3 black
static int counter, blend, blendTarget;
static int startUp;                // the console's frames before the first callback (core.js's START_UP_FRAMES)
static unsigned pendingDispcnt;    // 0xFFFF when nothing waits
static int affineDirty;
static uint16_t affine[2][8];      // layer 2's and layer 3's PA, PB, PC, PD, X low, X high, Y low, Y high

/** 0x08017ed0's pattern over all of OAM: every sprite hidden and every rotation matrix the identity. */
static void hideSprites(void) {
  for (int i = 0; i < 512; i += 16) {
    gba_oam[i + 0] = 0x200; gba_oam[i + 1] = 0; gba_oam[i + 2] = 0; gba_oam[i + 3] = 0x100;
    gba_oam[i + 4] = 0x200; gba_oam[i + 5] = 0; gba_oam[i + 6] = 0; gba_oam[i + 7] = 0;
    gba_oam[i + 8] = 0x200; gba_oam[i + 9] = 0; gba_oam[i + 10] = 0; gba_oam[i + 11] = 0;
    gba_oam[i + 12] = 0x200; gba_oam[i + 13] = 0; gba_oam[i + 14] = 0; gba_oam[i + 15] = 0x100;
  }
}

/** core.js's copyToVram: `words` 16-bit words from the cartridge into VRAM. */
static void copyVram(uint32_t from, uint32_t to, int words) {
  const uint8_t *src = ROM(from);
  uint8_t *dst = gba_vram + (to - 0x06000000u);
  for (int i = 0; i < words * 2; i++) dst[i] = src[i];
}

/** 0x080163c0 and 0x08017d78: a layer's control cleared, or given more bits. */
static void clearLayer(int layer) { gba_write(BGCNT[layer], 0); }
static void layerBits(int layer, uint16_t bits) { gba_write(BGCNT[layer], gba_io[BGCNT[layer] >> 1] | bits); }
static void layerCharBase(int layer, int base) { layerBits(layer, (uint16_t)(base << 2)); }
static void layerScreenBase(int layer, int base) { layerBits(layer, (uint16_t)(base << 8)); }

/** 0x080183d0: the colour effect, BLDCNT, BLDALPHA and BLDY. */
static void setBlend(int effect, int first, int second, int a, int b, int y) {
  gba_write(REG_BLDCNT, (uint16_t)(first | (second << 8) | (effect << 6)));
  gba_write(REG_BLDALPHA, (uint16_t)(a | (b << 8)));
  gba_write(REG_BLDY, (uint16_t)y);
}

/** 0x08016438: setRotation(c, 0, 0, 0x100, 0x100, 1, 1, 0, layer), the identity, kept until the next V-blank. */
static void setIdentityRotation(int layer) {
  uint16_t *out = affine[layer - 2];
  out[0] = 0x100; out[1] = 0; out[2] = 0; out[3] = 0x100;
  out[4] = 0; out[5] = 0; out[6] = 0; out[7] = 0;
  affineDirty = 1;
}

/** 0x08020500: each colour one step nearer the cartridge's colours at `from`. */
static int fadeToward(uint16_t *out, uint32_t from, int count) {
  const uint8_t *wantAt = ROM(from);
  int done = 1;
  for (int i = 0; i < count; i++) {
    uint16_t want = (uint16_t)(wantAt[i * 2] | (wantAt[i * 2 + 1] << 8));
    uint16_t v = out[i];
    if ((v & 0x7FFF) != (want & 0x7FFF)) {
      if ((v & 0x1F) > (want & 0x1F)) v--;
      if ((v & 0x1F) < (want & 0x1F)) v++;
      if ((v & 0x3E0) > (want & 0x3E0)) v -= 0x20;
      if ((v & 0x3E0) < (want & 0x3E0)) v += 0x20;
      if ((v & 0x7C00) > (want & 0x7C00)) v -= 0x400;
      if ((v & 0x7C00) < (want & 0x7C00)) v += 0x400;
      out[i] = v;
      done = 0;
    }
  }
  return done;
}

/** 0x0802067c: each colour one step darker in each of red, green and blue. */
static int fadeToBlack(uint16_t *out, int count) {
  int done = 1;
  for (int i = 0; i < count; i++) {
    uint16_t v = out[i];
    if (v & 0x7FFF) {
      if (v & 0x1F) v--;
      if (v & 0x3E0) v -= 0x20;
      if (v & 0x7C00) v -= 0x400;
      out[i] = v;
      done = 0;
    }
  }
  return done;
}

/** 0x08016078: newScreen(c, 1), the palette filled with its first colour, VRAM cleared, sprites hidden, DISPCNT queued. */
static void newScreen(void) {
  for (int i = 1; i < 512; i++) gba_pal[i] = gba_pal[0];
  for (int i = 0; i < 0x18000; i++) gba_vram[i] = 0;
  hideSprites();
  for (int layer = 2; layer <= 3; layer++)
    for (int i = 0; i < 8; i++) affine[layer - 2][i] = 0;
  pendingDispcnt = 0x1C62;
  blend = 0;
  blendTarget = 0;
  counter = 0;
}

/** 0x080006ec: the colours from the first picture, then the logos. */
static void fadeIn(void) {
  if (fadeToward(gba_pal, 0x083270B4, 0x100)) {
    blendTarget = 0x10;
    state = 1;
  }
}

/** 0x080003a8: a frame count copies each logo into the hidden layer and turns the cross-fade toward it. */
static void showLogos(uint16_t keys) {
  counter = (counter + 1) & 0xFFFF;
  switch (counter) {
    case 0x8:
      copyVram(0x083272B4, 0x06008000, 0xAE0);
      copyVram(0x08328874, 0x0600F000, 0x200);
      blendTarget = 0;
      break;
    case 0x80:
      blendTarget = 0x10;
      break;
    case 0x88:
      copyVram(0x0832B1B4, 0x06008000, 0x1600);
      copyVram(0x0832DDB4, 0x0600F000, 0x200);
      blendTarget = 0;
      break;
    case 0x90:
      gba_sound_play(400);
      copyVram(0x0832E1B4, 0x06000000, 0xDC0);
      copyVram(0x0832FD34, 0x06007000, 0x200);
      blendTarget = 0x10;
      break;
    case 0x108:
      blendTarget = 0;
      break;
    case 0x110:
      copyVram(0x08330134, 0x06000000, 0x20);
      copyVram(0x08330174, 0x06007000, 0x200);
      blendTarget = 0x10;
      break;
    case 0x118:
      state = 2;
      break;
  }
  if (keys & KEY_START) {
    if (((counter - 0x19) & 0xFFFF) <= 0x66) counter = 0x7F;
    else if (((counter - 0xA1) & 0xFFFF) <= 0x66) counter = 0x107;
  }
  if (blend > blendTarget) blend -= 2;
  if (blend < blendTarget) blend += 2;
  setBlend(ALPHA, LAYER_2, LAYER_3, blend & 0xFF, (0x10 - blend) & 0xFF, 0);
  setIdentityRotation(2);
  setIdentityRotation(3);
}

/** 0x08000724: every colour to black, then no colour effect, the palette cleared, and what comes next. */
static void fadeOut(void) {
  if (fadeToBlack(gba_pal, 0x100)) {
    setBlend(0, 0, 0, 0, 0, 0);
    for (int i = 0; i < 512; i++) gba_pal[i] = 0;
    state = 3;
  }
}

/** What the original's V-blank applies after the frame's work: the queued display control and the rotation. */
static void vblank(void) {
  if (pendingDispcnt != 0xFFFF) {
    gba_write(REG_DISPCNT, (uint16_t)pendingDispcnt);
    pendingDispcnt = 0xFFFF;
  }
  if (affineDirty) {
    for (int layer = 2; layer <= 3; layer++) {
      const uint16_t *a = affine[layer - 2];
      unsigned base = layer == 2 ? REG_BG2PA : REG_BG3PA;
      gba_write(base + 0, a[0]);
      gba_write(base + 2, a[1]);
      gba_write(base + 4, a[2]);
      gba_write(base + 6, a[3]);
      gba_write(base + 8, a[4]);
      gba_write(base + 10, a[5]);
      gba_write(base + 12, a[6]);
      gba_write(base + 14, a[7]);
    }
    affineDirty = 0;
  }
}

/** 0x08000210: the logos' screen, its two layers and the first picture. */
static void logosSetup(void) {
  newScreen();
  // the first picture in layer 2 (tiles at 0x06000000, map at 0x06007000), and an empty one in layer 3
  copyVram(0x08328C74, 0x06000000, 0x10A0);
  copyVram(0x0832ADB4, 0x06007000, 0x200);
  copyVram(0x08330134, 0x06008000, 0x20);
  copyVram(0x08330174, 0x0600F000, 0x200);
  // both rotating layers 512 pixels across, in 256 colours: layer 2 in front, layer 3 behind it
  clearLayer(2);
  layerBits(2, 0x4000); layerBits(2, 0); layerBits(2, 0x80); layerBits(2, 0); layerBits(2, 0);
  layerCharBase(2, 0); layerScreenBase(2, 0xE);
  clearLayer(3);
  layerBits(3, 0x4000); layerBits(3, 2); layerBits(3, 0x80); layerBits(3, 0); layerBits(3, 0);
  layerCharBase(3, 2); layerScreenBase(3, 0x1E);
  setBlend(ALPHA, LAYER_2, LAYER_3, 0, 0x10, 0);
  gba_sound_stop_all();
  state = 0;
}

void game_start(void) {
  // the console after its start-up program: the screen white (forced blank) until the game shows it, and the rotating
  // layers at rest
  gba_write(REG_DISPCNT, 0x80);
  gba_write(REG_BG2PA, 0x100); gba_write(REG_BG2PA + 2, 0); gba_write(REG_BG2PA + 4, 0); gba_write(REG_BG2PA + 6, 0x100);
  gba_write(REG_BG2X, 0); gba_write(REG_BG2X + 2, 0); gba_write(REG_BG2Y, 0); gba_write(REG_BG2Y + 2, 0);
  gba_write(REG_BG3PA, 0x100); gba_write(REG_BG3PA + 2, 0); gba_write(REG_BG3PA + 4, 0); gba_write(REG_BG3PA + 6, 0x100);
  gba_write(REG_BG3X, 0); gba_write(REG_BG3X + 2, 0); gba_write(REG_BG3Y, 0); gba_write(REG_BG3Y + 2, 0);
  pendingDispcnt = 0xFFFF;
  affineDirty = 0;
  startUp = 45;
  // the sound engine, as the original's start-up does: six players, eight channels, master volume 14, 10,512 Hz. Its
  // player table is at 0x08BF71FC and its players point into IWRAM, which gba_sound_start's finder doesn't take, so the
  // game sets the same layout through the kit's own setup call (sound.c's OP_SETUP), as sound.js's soundLayout does.
  if (!gba_sound_start(6, 8, 14, 10512, 0)) {
    void dp_sound_call(int op, int a, int b, int c, int d);
    dp_sound_call(1, 0xBF71FC, 0x000E0806, 10512 | (1 << 16), 84800);
  }
}

void game_step(uint16_t keys) {
  if (startUp > 0) {
    if (--startUp == 0) {
      for (int i = 0; i < 512; i++) gba_pal[i] = 0x7FFF;
      logosSetup();
    }
    return;
  }
  vblank();
  if (state == 0) fadeIn();
  else if (state == 1) showLogos(keys);
  else if (state == 2) fadeOut();
}
