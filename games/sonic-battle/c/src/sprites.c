// sprites.js in C: a fight's camera and its queue of sprites, rewritten from the original's instructions, with the
// decompilation's src/unknown_08017c5c.cpp as a guide. The camera turns and zooms over the arena: what a fighter's
// position comes to on the screen (0x0801816c, 0x08018204) and the rotating layers' parameters (0x08016684) both come
// from it. Sprites wait in a queue of 16-byte entries, sorted by depth, which the V-blank turns into OAM entries in the
// buffer it copies.

#include "game.h"

#define SINE 0x0804DF7Cu
#define QUARTER_TURN 0x800

#define ZOOM 0x03001B04u
#define ANGLE 0x03001B08u
#define TILT 0x030016C8u
#define CAMERA_X 0x03001B2Cu
#define CAMERA_Y 0x030016C0u
#define HEIGHT_SHIFT 0x03001384u
#define FACING 0x03001370u
#define CAMERA_LEAD 0x030016BCu

#define QUEUED 0x030017CCu
#define KEPT 0x030017C8u
#define QUEUE 0x030033E0u
#define ENTRY_SIZE 16

#define MATRICES_QUEUED 0x03001388u
#define MATRICES 0x03003190u
#define NEXT_OAM 0x030033CCu
#define NEXT_MATRIX 0x03003170u
#define VIEW_TOP 0x030016D0u
#define VIEW_BOTTOM 0x030017C0u
#define BUFFER_MATRICES 0x030044C0u
#define BUFFER_SPRITES 0x030048D4u

static inline int16_t sine(int angle) { return reads16(SINE + (uint32_t)(angle * 2)); }

void layersFromCamera(void) {
  int16_t zoom = reads16(ZOOM), angle = reads16(ANGLE), tilt = reads16(TILT);
  int16_t cos = sine(angle + QUARTER_TURN), sin = sine(angle);
  uint16_t pa = u16(divArm(zoom, cos << 3));
  uint16_t pb = u16(divArm(zoom, (int32_t)((int32_t)sin * tilt) >> 5));
  uint16_t pc = u16(-divArm(zoom, sin << 3));
  uint16_t pd = u16(divArm(zoom, (int32_t)((int32_t)cos * tilt) >> 5));
  int16_t cameraX = reads16(CAMERA_X), cameraY = reads16(CAMERA_Y);
  int32_t across = ((int32_t)sin * cameraY - (int32_t)cos * cameraX) >> 13;
  int32_t along = (-(int32_t)sin * cameraX - (int32_t)cos * cameraY) >> 13;
  int32_t scale = zoom << 7;
  int32_t left = ((int32_t)across * scale) >> 20;
  int32_t top = divArm(tilt, (int32_t)scale * along) >> 12;
  int32_t originX = left + 120;
  int32_t firstX = (int32_t)s16(pa) * originX, firstY = (int32_t)s16(pc) * originX;
  uint16_t *out = g.affine[g.affine_half ^ 1];
  int16_t rows[2] = {(int16_t)(top - reads16(HEIGHT_SHIFT) + 82), (int16_t)(top + 80)};
  for (int n = 0; n < 2; n++) {
    int at = n * 8;
    int32_t row = rows[n];
    int32_t x = (int32_t)(0x10000 - (int32_t)s16(pb) * row - firstX);
    int32_t y = (int32_t)(0x10000 - (int32_t)s16(pd) * row - firstY);
    out[at] = pa; out[at + 1] = pb; out[at + 2] = pc; out[at + 3] = pd;
    out[at + 4] = (uint16_t)x; out[at + 5] = (uint16_t)((x & 0x0FFF0000) >> 16);
    out[at + 6] = (uint16_t)y; out[at + 7] = (uint16_t)((y & 0x0FFF0000) >> 16);
  }
}

enum { LIFT = 1, MODE = 2, MATRIX = 4, FLIP = 8 };

typedef struct { uint16_t first, second; int what; } Kind;
static const Kind KINDS[132] = {
  [0] = {0x0300, 0x8000, MATRIX}, [1] = {0x8300, 0x8000, MATRIX}, [2] = {0x8300, 0x4000, MATRIX},
  [10] = {0x0000, 0xC000, LIFT | FLIP}, [11] = {0x0000, 0x8000, LIFT | FLIP}, [12] = {0x4000, 0x8000, LIFT | FLIP},
  [13] = {0x8000, 0x8000, LIFT | FLIP}, [14] = {0x0000, 0x4000, LIFT | FLIP}, [20] = {0x4000, 0x8000, LIFT | FLIP},
  [30] = {0x0000, 0x4000, LIFT | MODE | FLIP}, [31] = {0x4000, 0x8000, LIFT | MODE | FLIP},
  [32] = {0x8000, 0x8000, LIFT | MODE | FLIP}, [33] = {0x0000, 0x8000, LIFT | MODE | FLIP},
  [34] = {0x0000, 0x0000, LIFT | MODE | FLIP}, [98] = {0x0000, 0x8000, LIFT | FLIP},
  [100] = {0x0300, 0x4000, MODE | MATRIX}, [101] = {0x4300, 0x8000, MODE | MATRIX},
  [102] = {0x8300, 0x8000, MODE | MATRIX}, [103] = {0x0300, 0x8000, MODE | MATRIX},
  [104] = {0x0300, 0x0000, MODE | MATRIX}, [105] = {0x0300, 0xC000, MODE | MATRIX},
  [106] = {0x4300, 0xC000, MODE | MATRIX}, [110] = {0x0000, 0x4000, MODE | FLIP},
  [111] = {0x4000, 0x8000, MODE | FLIP}, [112] = {0x8000, 0x8000, MODE | FLIP},
  [113] = {0x0000, 0x8000, MODE | FLIP}, [114] = {0x0000, 0x0000, MODE | FLIP},
  [115] = {0x0000, 0xC000, MODE | FLIP}, [116] = {0x4000, 0x4000, MODE | FLIP},
  [117] = {0x4000, 0xC000, MODE | FLIP}, [118] = {0x4000, 0x0000, MODE | FLIP},
  [120] = {0x8000, 0x0000, 0}, [130] = {0x2300, 0xC000, MODE | MATRIX}, [131] = {0x2000, 0xC000, MODE | FLIP},
};

static uint16_t attributes[3];

void drawQueuedSprite(uint32_t word0, uint32_t word1, uint32_t word2, uint32_t word3) {
  uint16_t x = word0 & 0xFFFF, y = word0 >> 16, height = word1 & 0xFFFF;
  uint16_t tile = word2 & 0xFFFF;
  uint8_t priority = (word2 >> 16) & 0xFF, matrix = word2 >> 24;
  uint8_t palette = word3 & 0xFF, kind = (word3 >> 8) & 0xFF, mode = (word3 >> 16) & 0xFF, flip = word3 >> 24;
  const Kind *shape = kind < 132 && (KINDS[kind].first || KINDS[kind].second || KINDS[kind].what) ? &KINDS[kind] : 0;
  if (shape) {
    attributes[0] = (uint16_t)(((shape->what & LIFT ? y - height : y) & 0xFF) | shape->first
      | (shape->what & MODE ? (mode & 3) << 10 : 0));
    attributes[1] = (uint16_t)((x & 0x1FF) | shape->second
      | (shape->what & MATRIX ? (matrix & 31) << 9 : 0) | (shape->what & FLIP ? (flip & 3) << 12 : 0));
    attributes[2] = (uint16_t)((tile & 0x3FF) | ((priority & 3) << 10) | ((palette & 15) << 12));
  }
  writeNextSprite(attributes[0], attributes[1], attributes[2]);
}

void writeNextSprite(uint16_t first, uint16_t second, uint16_t third) {
  uint16_t at = read16(NEXT_OAM);
  spriteInBuffer(at, first, second, third);
  write16(NEXT_OAM, at + 1);
}

void drawQueue(void) {
  for (int i = 0; i < read8(QUEUED); i++) {
    uint32_t entry = QUEUE + (uint32_t)i * ENTRY_SIZE;
    if (i >= read8(KEPT)) write8(entry + 10, reads16(entry + 4) > 29 ? 2 : 3);
    drawQueuedSprite(read32(entry), read32(entry + 4), read32(entry + 8), read32(entry + 12));
  }
}

void sortQueue(void) {
  int pass = 1;
  for (int round = read8(KEPT) + 1; round < read8(QUEUED); round++) {
    for (int i = read8(KEPT); i < read8(QUEUED) - pass; i++) {
      uint32_t a = QUEUE + (uint32_t)i * ENTRY_SIZE, b = a + ENTRY_SIZE;
      if (reads16(a + 6) < reads16(b + 6)) {
        for (int word = 0; word < ENTRY_SIZE; word += 4) {
          uint32_t kept = read32(a + word);
          write32(a + word, read32(b + word));
          write32(b + word, kept);
        }
      }
    }
    pass++;
  }
}

void turnCamera(int target) {
  int32_t wanted = s16(target);
  while (wanted > 0x2000) wanted = s16(wanted - 0x2000);
  while (wanted < 0) wanted = s16(wanted + 0x2000);
  int16_t apart = reads16(ANGLE) - wanted;
  if (apart > 0x1000) write16(ANGLE, read16(ANGLE) - 0x2000);
  else if (apart < -0x1000) write16(ANGLE, read16(ANGLE) + 0x2000);
  int32_t angle = s16(read16(ANGLE) - ((reads16(ANGLE) - wanted) >> 3));
  while (angle > 0x1FFF) angle = s16(angle - 0x2000);
  while (angle < 0) angle = s16(angle + 0x2000);
  write16(ANGLE, (uint16_t)angle);
}

void drawSpritesNow(void) {
  restartBuffer();
  hideSpriteBuffer();
  drawQueue();
  drawMatrices();
  g.vblank_copies = 1;
}

void clearQueue(void) {
  write8(QUEUED, 0);
  write8(KEPT, 0);
  write8(MATRICES_QUEUED, 0);
}

void restartBuffer(void) {
  write16(NEXT_OAM, 0);
  write16(NEXT_MATRIX, 0);
}

void queueSprite(uint32_t word0, uint32_t word1, uint32_t word2, uint32_t word3) {
  uint8_t count = read8(QUEUED);
  uint32_t at = QUEUE + (uint32_t)count * ENTRY_SIZE;
  write32(at, word0);
  write32(at + 4, word1);
  write32(at + 8, word2);
  write32(at + 12, word3);
  write8(QUEUED, count + 1);
}

void queueMatrix(uint32_t word0, uint32_t word1) {
  uint8_t count = read8(MATRICES_QUEUED);
  uint32_t at = MATRICES + (uint32_t)count * 8;
  write32(at, word0);
  write32(at + 4, word1);
  write8(MATRICES_QUEUED, count + 1);
}

void setViewRows(int top, int bottom) {
  write8(VIEW_TOP, (uint8_t)top);
  write8(VIEW_BOTTOM, (uint8_t)bottom);
}

void keepQueued(void) { write8(KEPT, read8(QUEUED)); }

void drawMatrices(void) {
  for (int i = 0; i < read8(MATRICES_QUEUED); i++) {
    uint32_t at = MATRICES + (uint32_t)i * 8;
    uint32_t first = read32(at), second = read32(at + 4);
    uint16_t n = read16(NEXT_MATRIX);
    matrixInBuffer(n, first & 0xFFFF, first >> 16, second & 0xFFFF, second >> 16);
    write16(NEXT_MATRIX, n + 1);
  }
}

void viewFromArena(int x, int y, int *outX, int *outY) {
  int16_t across = s16(s16(x) - read16(CAMERA_X)), along = s16(s16(y) - read16(CAMERA_Y));
  int16_t angle = reads16(ANGLE), cos = sine(angle + QUARTER_TURN), sin = sine(angle);
  int32_t viewX = ((int32_t)cos * across - (int32_t)sin * along) >> 13;
  int32_t viewY = ((int32_t)across * sin + (int32_t)cos * along) >> 13;
  if (outX) *outX = s16(viewX);
  if (outY) *outY = s16(viewY);
}

void screenFromView(int x, int y, int *outX, int *outY) {
  int16_t zoom = reads16(ZOOM);
  int32_t screenX = ((int32_t)zoom * s16(x) >> 13) + 120;
  int32_t scale = divArm(reads16(TILT), zoom << 8);
  int32_t screenY = ((int32_t)scale * s16(y) >> 13) + 80;
  if (outX) *outX = s16(screenX);
  if (outY) *outY = s16(screenY);
}

void setHeightShift(void) {
  write16(HEIGHT_SHIFT, (uint16_t)((reads16(ZOOM) * 42) >> 9));
  int32_t part = divArm(reads16(TILT), reads16(HEIGHT_SHIFT));
  write16(HEIGHT_SHIFT, read16(HEIGHT_SHIFT) - part);
}

void zoomCamera(int target) {
  int16_t step = (reads16(ZOOM) - s16(target)) >> 3;
  write16(ZOOM, read16(ZOOM) - step);
}

void tiltCamera(int target) { write16(TILT, (uint16_t)((reads16(TILT) + s16(target)) >> 1)); }

void moveCamera(int x, int y) {
  uint16_t toX = u16(x), toY = u16(y);
  uint8_t facing = (uint8_t)(read8(FACING) - 2);
  if (facing <= 1) toX = u16(s16(toX) + read16(CAMERA_LEAD));
  else toY = u16(s16(toY) + read16(CAMERA_LEAD));
  int16_t stepX = (reads16(CAMERA_X) - s16(toX)) >> 3;
  write16(CAMERA_X, read16(CAMERA_X) - stepX);
  int16_t stepY = (reads16(CAMERA_Y) - s16(toY)) >> 3;
  write16(CAMERA_Y, read16(CAMERA_Y) - stepY);
}

int16_t cameraAngle(void) { return reads16(ANGLE); }

int addMatrixToBuffer(uint16_t a, uint16_t b, uint16_t d, uint16_t e) {
  uint8_t count = read8(BUFFER_MATRICES);
  if (count > 31) return 255;
  g.oam_buffer[count + 3] = a;
  g.oam_buffer[count + 7] = b;
  g.oam_buffer[count + 11] = d;
  g.oam_buffer[count + 15] = e;
  write8(BUFFER_MATRICES, count + 1);
  return count;
}

int addSpriteToBuffer(uint16_t first, uint16_t second, uint16_t third) {
  uint8_t count = read8(BUFFER_SPRITES);
  if (count & 0x80) return 0;
  g.oam_buffer[count * 4] = first;
  g.oam_buffer[count * 4 + 1] = second;
  g.oam_buffer[count * 4 + 2] = third;
  write8(BUFFER_SPRITES, count + 1);
  return 1;
}

void hideRestOfBuffer(void) {
  for (int i = read8(BUFFER_SPRITES); i < 128; i++) g.oam_buffer[i * 4] = 0x200;
  g.oam_buffer_full = 1;
}

void spriteInBuffer(int n, uint16_t first, uint16_t second, uint16_t third) {
  if (n < 0 || n > 127) return;   // a typed array ignores what's past its end, as the JavaScript kit's does
  int at = (uint16_t)n * 4;
  g.oam_buffer[at] = first;
  g.oam_buffer[at + 1] = second;
  g.oam_buffer[at + 2] = third;
}

void matrixInBuffer(int n, uint16_t a, uint16_t b, uint16_t d, uint16_t e) {
  if (n < 0 || n > 31) return;
  int at = (uint16_t)n * 16;
  g.oam_buffer[at + 3] = a;
  g.oam_buffer[at + 7] = b;
  g.oam_buffer[at + 11] = d;
  g.oam_buffer[at + 15] = e;
}
