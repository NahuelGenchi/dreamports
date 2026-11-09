// core.js in C: Sonic Battle's engine core, rewritten from how the original does it. AgbMain (0x08000778) starts the
// console up, then runs its main loop once a frame: it reads the keys, runs the screen's callback, waits for the
// V-blank, whose interrupt applies the display registers the callback queued, and copies what the callback queued for
// VRAM. A callback writes the palette, VRAM and most registers directly, while the V-blank is still on, so they show in
// the next frame; the registers it queues show a frame later. Here a frame is step(): the V-blank's work comes first,
// then the callback, then the kit draws.

#include "game.h"

#define REG_DISPCNT_ 0x00
#define REG_BG0CNT_ 0x08
#define REG_BG2PA_ 0x20
#define REG_BLDCNT_ 0x50
#define REG_BLDALPHA_ 0x52
#define REG_BLDY_ 0x54

#define START_UP_FRAMES 45

// the BIOS's LZ77UnCompVram, 0x0804a5b4
static uint8_t *decompressOut;
static uint32_t decompressAt;

void decompress(uint32_t from, uint32_t to) {
  const uint8_t *bytes = gba_rom;
  uint32_t at = from - CARTRIDGE;
  decompressOut = to < VRAM ? (uint8_t *)gba_pal : gba_vram;
  uint32_t base = to < VRAM ? PALETTE : VRAM;
  uint32_t out = to - base, end = out + (bytes[at + 1] | (bytes[at + 2] << 8) | (bytes[at + 3] << 16));
  at += 4;
  decompressAt = out;
  uint8_t waiting = 0;
  while (out < end) {
    uint8_t flags = bytes[at++];
    for (int bit = 7; bit >= 0 && out < end; bit--) {
      if (flags & (1 << bit)) {
        uint16_t word = (uint16_t)((bytes[at] << 8) | bytes[at + 1]);
        at += 2;
        int length = (word >> 12) + 3, back = (word & 0xFFF) + 1;
        for (int i = 0; i < length; i++) {
          uint8_t byte = decompressOut[out - back];
          if (out & 1) {
            decompressOut[out - 1] = waiting;
            decompressOut[out] = byte;
          } else waiting = byte;
          out++;
        }
      } else {
        uint8_t byte = bytes[at++];
        if (out & 1) {
          decompressOut[out - 1] = waiting;
          decompressOut[out] = byte;
        } else waiting = byte;
        out++;
      }
    }
  }
}

/** How many of the console's cycles 0x0804a5b4 takes on the picture at `from`, as mGBA counts its stand-in for the
 *  BIOS's LZ77UnCompVram and the swi that calls it, without unpacking it: the call, each flag byte, each of its bits,
 *  and each byte a copy or a literal writes, the second of each halfword costing two fewer. */
#define UNPACK_CALL 103
#define UNPACK_FLAGS 19
#define UNPACK_BIT 32
#define UNPACK_COPY 10
#define UNPACK_COPIED 12
#define UNPACK_LITERAL 5
#define UNPACK_SECOND_BYTE 2

int32_t unpackCycles(uint32_t from) {
  const uint8_t *bytes = gba_rom;
  uint32_t at = from - CARTRIDGE;
  uint32_t size = bytes[at + 1] | (bytes[at + 2] << 8) | (bytes[at + 3] << 16), out = 0;
  int32_t cycles = UNPACK_CALL;
  at += 4;
  while (out < size) {
    uint8_t flags = bytes[at++];
    cycles += UNPACK_FLAGS;
    for (int bit = 7; bit >= 0 && out < size; bit--) {
      cycles += UNPACK_BIT;
      if (flags & (1 << bit)) {
        int length = (((bytes[at] << 8) | bytes[at + 1]) >> 12) + 3;
        at += 2;
        cycles += UNPACK_COPY;
        for (int i = 0; i < length; i++, out++) cycles += UNPACK_COPIED - (out & 1 ? UNPACK_SECOND_BYTE : 0);
      } else {
        at++;
        cycles += UNPACK_LITERAL - (out & 1 ? UNPACK_SECOND_BYTE : 0);
        out++;
      }
    }
  }
  return cycles;
}

static void hideSprites(void) {
  for (int i = 0; i < 32; i++) {
    uint16_t pattern[16] = {0x200, 0, 0, 0x100, 0x200, 0, 0, 0, 0x200, 0, 0, 0, 0x200, 0, 0, 0x100};
    for (int n = 0; n < 16; n++) gba_oam[i * 16 + n] = pattern[n];
  }
}

void hideSpriteBuffer(void) {
  for (int i = 0; i < 32; i++) {
    uint16_t pattern[16] = {0x200, 0, 0, 0x100, 0x200, 0, 0, 0, 0x200, 0, 0, 0, 0x200, 0, 0, 0x100};
    for (int n = 0; n < 16; n++) g.oam_buffer[i * 16 + n] = pattern[n];
  }
  g.oam_buffer_full = 1;
}

/** 0x08017ed0: nothing queued, so the next copy leaves every sprite hidden. */
void clearSprites(void) {
  g.sprite_count = 0;
  g.matrix_count = 0;
}

/** 0x08017c5c: asks the next V-blank for the other half of the rotation parameters and for the queued sprites. */
void copyAtVblank(void) {
  g.affine_half ^= 1;
  g.vblank_copies = 1;
}

void queueRegister(uint16_t offset, uint16_t value) {
  if (g.queue_count <= 19) {
    g.queue[g.queue_count].at = offset;
    g.queue[g.queue_count].value = value;
    g.queue_count++;
  }
}

void copyToVram(uint32_t from, uint32_t to, uint32_t count) {
  for (uint32_t i = 0; i < count * 2; i++) gba_vram[(to - VRAM) + i] = gba_rom[(from - CARTRIDGE) + i];
}

void copyTileBlock(uint32_t to, uint32_t from, int columns, int rows, int base) {
  uint32_t at = from - CARTRIDGE;
  uint32_t out = (to - VRAM) >> 1;
  for (int y = 0; y < rows; y++) {
    for (int x = 0; x < columns; x++, out++) {
      uint16_t tile = (uint16_t)(gba_rom[at] | (gba_rom[at + 1] << 8));
      at += 2;
      uint16_t value = (uint16_t)(base + tile);
      gba_vram[out * 2] = value & 0xFF;
      gba_vram[out * 2 + 1] = value >> 8;
    }
    out += 32 - columns;
  }
}

uint16_t *colours(uint32_t first) { return gba_pal + ((first - PALETTE) >> 1); }

void clearLayer(int layer) {
  static const uint16_t BGCNT[4] = {REG_BG0CNT_, REG_BG0CNT_ + 2, REG_BG0CNT_ + 4, REG_BG0CNT_ + 6};
  gba_io[BGCNT[layer] >> 1] = 0;
  gba_write(BGCNT[layer], 0);
}

void layerBits(int layer, uint16_t bits) {
  static const uint16_t BGCNT[4] = {REG_BG0CNT_, REG_BG0CNT_ + 2, REG_BG0CNT_ + 4, REG_BG0CNT_ + 6};
  gba_io[BGCNT[layer] >> 1] |= bits;
  gba_write(BGCNT[layer], gba_io[BGCNT[layer] >> 1]);
}

void layerCharBase(int layer, int base) { layerBits(layer, (uint16_t)((base << 2) & 0xFFFF)); }
void layerScreenBase(int layer, int base) { layerBits(layer, (uint16_t)((base << 8) & 0xFFFF)); }

void setBlend(int effect, int first, int second, int a, int b, int y) {
  gba_write(REG_BLDCNT_, (uint16_t)(first | (second << 8) | (effect << 6)));
  gba_write(REG_BLDALPHA_, (uint16_t)(a | (b << 8)));
  gba_write(REG_BLDY_, (uint16_t)y);
}

static inline int16_t sineAt(int a) { return reads16(0x0804DF7C + (uint32_t)(a * 2)); }

/** 0x08016438: rotating layer `layer`'s parameters (2 or 3) into the half of `g.affine` the V-blank doesn't copy. */
void setRotation(int originX, int originY, int firstDenominator, int secondDenominator, int scaleX, int scaleY,
                 int angle, int layer) {
  uint16_t pa = (uint16_t)(scaleX * divArm(s16(firstDenominator), sineAt(angle + 0x800) << 3));
  uint16_t pb = (uint16_t)(scaleY * divArm(s16(firstDenominator), sineAt(angle) << 3));
  uint16_t pc = (uint16_t)(scaleX * -divArm(s16(secondDenominator), sineAt(angle) << 3));
  uint16_t pd = (uint16_t)(divArm(s16(secondDenominator), sineAt(angle + 0x800) << 3) * scaleY);
  int32_t x = (int32_t)(0x8000 - (int32_t)s16(pa) * s16(originX) - (int32_t)s16(pb) * s16(originY));
  int32_t y = (int32_t)(0x8000 - (int32_t)s16(pc) * s16(originX) - (int32_t)s16(pd) * s16(originY));
  uint16_t *out = g.affine[g.affine_half ^ 1];
  int at = layer == 2 ? 0 : layer == 3 ? 8 : -1;
  if (at < 0) return;
  out[at] = pa; out[at + 1] = pb; out[at + 2] = pc; out[at + 3] = pd;
  out[at + 4] = (uint16_t)x; out[at + 5] = (uint16_t)((x & 0x0FFF0000) >> 16);
  out[at + 6] = (uint16_t)y; out[at + 7] = (uint16_t)((y & 0x0FFF0000) >> 16);
}

int fadeToward(uint32_t first, uint32_t from, int count) {
  uint16_t *out = colours(first);
  uint32_t at = from - CARTRIDGE;
  int done = 1;
  for (int i = 0; i < count; i++) {
    uint16_t want = (uint16_t)(gba_rom[at + i * 2] | (gba_rom[at + i * 2 + 1] << 8));
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

int fadeToBlack(uint32_t first, int count) {
  uint16_t *out = colours(first);
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

int fadeToWhite(uint32_t first, int count) {
  uint16_t *out = colours(first);
  int done = 1;
  for (int i = 0; i < count; i++) {
    uint16_t v = out[i];
    if ((v & 0x7FFF) != 0x7FFF) {
      if ((v & 0x1F) <= 0x1E) v++;
      if ((v & 0x3E0) <= 0x3DF) v += 0x20;
      if ((v & 0x7C00) <= 0x7BFF) v += 0x400;
      out[i] = v;
      done = 0;
    }
  }
  return done;
}

/** 0x08016078: a new screen's start, with the palette filled from its first colour, VRAM cleared, sprites hidden and
 *  the random numbers seeded. */
void newScreen(int mode) {
  for (int i = 1; i < 512; i++) gba_pal[i] = gba_pal[0];
  for (uint32_t i = 0; i < 0x18000; i++) gba_vram[i] = 0;
  hideSprites();
  g.affine_half = 0;
  g.vblank_copies = 0;
  if ((mode >= 1 && mode <= 4) || mode == 40) queueRegister(REG_DISPCNT_, 0x1C62);
  else if (mode == 6) gba_write(REG_DISPCNT_, 0x1C62);
  g.blend = 0;
  g.blend_target = 0;
  g.counter = 0;
  if (mode == 6) {
    g.fight_vblank = 1;
    write8(0x030016C4, 160);
  }
  write8(0x030017CC, 0);
  write8(0x030017C8, 0);
  write8(0x03001388, 0);
  write16(0x030033CC, 0);
  write16(0x03003170, 0);
  write16(0x03001B2C, 0);
  write16(0x030016C0, 0);
  write16(0x03001B08, 0);
  write16(0x03001B04, 0x100);
  write16(0x030016C8, 0x200);
  // 0x08020134: the random numbers start again from the save's word at +4 and the main loop's frames
  write32(0x0300019C, (read32(SAVE + 4) + (uint32_t)g.frames) | 1);
}

void queueCopy(uint32_t to, uint32_t from, uint32_t bytes) {
  if (g.copy_count <= 31) {
    g.copies[g.copy_count].to = to;
    g.copies[g.copy_count].from = from;
    g.copies[g.copy_count].bytes = (int32_t)bytes;
    g.copy_count++;
  }
}

void queueDecompress(uint32_t to, uint32_t from) {
  if (g.copy_count <= 31) {
    g.copies[g.copy_count].to = to;
    g.copies[g.copy_count].from = from;
    g.copies[g.copy_count].bytes = -1;
    g.copy_count++;
  }
}

static void runCopies(void) {
  for (int i = 0; i < g.copy_count; i++) {
    Copy copy = g.copies[i];
    if (copy.bytes < 0) {
      decompress(copy.from, copy.to);
      continue;
    }
    if (copy.to < VRAM) {
      uint16_t *out = colours(copy.to);
      for (int n = 0; n < copy.bytes / 2; n++) out[n] = read16(copy.from + (uint32_t)n * 2);
    } else {
      for (int n = 0; n < copy.bytes; n++) gba_vram[(copy.to - VRAM) + n] = gba_rom[(copy.from - CARTRIDGE) + n];
    }
  }
  g.copy_count = 0;
}

static void readKeys(uint16_t held) {
  uint16_t oldHeld = g.keys.held, oldInverted = g.keys.inverted;
  g.keys.inverted = (uint16_t)((~held & 0x3FF) | 0xFC00);
  g.keys.held = (uint16_t)(~g.keys.inverted & 0xFFFF);
  g.keys.pressed = (uint16_t)(oldInverted & g.keys.held);
  g.keys.released = (uint16_t)(g.keys.inverted & oldHeld);
  if (g.keys.held == 0) { g.keys.repeated = 0; return; }
  if (g.keys.held > oldHeld) {
    g.keys.repeated = (uint16_t)(oldHeld ^ g.keys.held);
    g.keys.timer = g.keys.delay;
    return;
  }
  g.keys.timer = (uint8_t)(g.keys.timer - 1);
  if (g.keys.timer != 0) { g.keys.repeated = 0; return; }
  g.keys.repeated = g.keys.held;
  g.keys.timer = g.keys.interval;
}

void fightVblank(void) {
  g.vblanks++;
  if (g.vblank_copies) {
    hideSprites();
    for (int i = 0; i < 16; i++) gba_write((uint16_t)(REG_BG2PA_ + i * 2), g.affine[g.affine_half][i]);
    for (int i = 0; i < 512; i++) gba_oam[i] = g.oam_buffer[i];
    g.oam_buffer_full = 0;
    for (int i = 0; i < g.queue_count; i++) gba_write(g.queue[i].at, g.queue[i].value);
    g.queue_count = 0;
  }
  g.vblank_copies = 0;
  g.frames++;
}

static void vblank(void) {
  // what a screen adds to the V-blank, before its sprites are copied (options.js's vblankWork)
  if (g.vblank_work) g.vblank_work();
  if (g.fight_vblank) { fightVblank(); return; }
  g.vblanks++;
  if (g.vblank_copies) {
    for (int i = 0; i < 16; i++) gba_write((uint16_t)(REG_BG2PA_ + i * 2), g.affine[g.affine_half][i]);
    hideSprites();
    // each queued sprite has three OAM attribute words; word 3 belongs to the rotation matrices
    for (int i = 0; i < g.sprite_count; i++) for (int n = 0; n < 3; n++) gba_oam[i * 4 + n] = g.sprites[i * 4 + n];
    for (int i = 0; i < g.matrix_count; i++) for (int n = 0; n < 4; n++) gba_oam[i * 16 + n * 4 + 3] = g.matrices[i * 4 + n];
    g.vblank_copies = 0;
  }
  if (g.hold_queue) g.hold_queue = 0;
  else {
    for (int i = 0; i < g.queue_count; i++) gba_write(g.queue[i].at, g.queue[i].value);
    g.queue_count = 0;
  }
  if (g.oam_buffer_full) {
    for (int i = 0; i < 512; i++) gba_oam[i] = g.oam_buffer[i];
    g.oam_buffer_full = 0;
  }
  g.frames++;
}

static void finishLineWork(void) {
  void (*run)(void) = g.line_work;
  g.line_work = 0;
  if (run) run();
}

void hblank(int line) {
  while (g.line_work && g.line_work_line <= line) {
    void (*run)(void) = g.line_work;
    g.line_work = 0;
    run();
  }
}

/** A start point at a fight's end runs the way there before the recording opens: the choice screen's A presses at
 *  70, 100 and 130, then the fight's frames, one frame at a time, as `step` runs them, without recursing into it. */
void runFightSetup(int count) {
  for (int f = 0; f < count; f++) {
    uint16_t held = (f == 70 || f == 100 || f == 130) ? 1 : 0;
    if (g.after_wait) {
      void (*rest)(void) = g.after_wait;
      g.after_wait = 0;
      rest();
      if (g.line_one) g.line_one();
      continue;
    }
    vblank();
    runCopies();
    readKeys(held);
    g.callback();
    if (g.line_one) g.line_one();
  }
}

void step(uint16_t held) {
  if (g.start_up > 0) {
    if (--g.start_up == 0) {
      for (int i = 0; i < 512; i++) gba_pal[i] = 0x7FFF;
      readKeys(held);
      g.callback();
    }
    return;
  }
  g.sound_cycles = gba_sound_frame_cycles();
  finishLineWork();
  vblank();
  if (g.after_wait) {
    void (*rest)(void) = g.after_wait;
    g.after_wait = 0;
    rest();
    if (g.line_one) g.line_one();
    return;
  }
  runCopies();
  readKeys(held);
  g.callback();
  if (g.line_one) g.line_one();
}
