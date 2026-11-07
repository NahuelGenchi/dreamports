// arena.js in C: the arena of a fight, its pictures and shape loaded, its walls and the things standing in it drawn
// each frame, and the colours that move (the original's 0x0800FDC8, 0x0801103C, 0x08011C7C, 0x0800F9C0 and 0x0800F3C4).
// Only Emerald Beach, the arena a fight's opening uses, is here so far; the other arenas' loads are the same kind of
// table.

#include "game.h"

#define ARENA 0x03002CB4u
#define ARENA_LAYOUT 0x03002CB0u
#define LIMIT_A_HIGH 0x03002B74u
#define LIMIT_A_LOW 0x03002BD0u
#define LIMIT_B_HIGH 0x03002B80u
#define LIMIT_B_LOW 0x03002B70u
#define POINTS 0x03002AD0u
#define POINT_COUNT 0x03002B7Cu
#define SCREEN_POINTS 0x03002BE0u
#define WALL_POINTS 0x03002A80u
#define WALL_COUNT 0x03002C80u
#define WALL_LOOKS 0x030029C0u
#define FLOORS 0x03002B90u
#define FLOOR_COUNT 0x03002B84u
#define SHAPE_DONE 0x03001B00u

#define CAMERA_HEIGHT 0x03001384u
#define MATRIX_COUNT 0x03001388u
#define SCREEN_TOP 0x030016D0u
#define SCREEN_BOTTOM 0x030017C0u
#define VIEW_SIDE 0x03001370u

#define THINGS 0x030017D0u
#define THING_SIZE 68
#define THING_COUNT 12
#define THING_FLIP 5
#define THING_BASE_FLIP 6
#define THING_COLOURS 4
#define THING_PICTURES 26
#define THING_X 18
#define THING_Y 20
#define THING_PART_X 34
#define THING_PART_Y 42
#define THING_SIZE_KIND 52
#define THING_OWNER 53
#define THING_KIND 56
#define THING_AT_X 58
#define THING_AT_Y 60
#define THING_HEIGHT 62
#define THING_FACING 64
#define KIND_PARTS 0x0806B414u
#define NOTHING_NEW 0xFFFF
#define THINGS_DRAWN 0x03002684u

#define SETUP_ 0x03001620u
#define OWNER_CHARACTER 20
#define OWNER_OTHER 24
#define PICTURES_ONE 0x08B40858u
#define PICTURES_TWO 0x08A8F038u
static const int PICTURE_BYTES[5] = {256, 512, 512, 1024, 64};

#define COLOUR_FRAME 0x03002B78u
#define COLOURS_MOVE 0x03002034u
#define COLOUR_FRAMES 0x08070F1Au
#define COLOURS_A 0x03002C90u
#define COLOURS_B 0x03002A60u
#define PALETTE_1A0 0x050001A0u
#define PALETTE_1C0 0x050001C0u
#define PALETTE_002 0x05000002u
#define PALETTE_060 0x05000060u

typedef struct { uint32_t from, to; int count; } ArenaCopy;
static const ArenaCopy ARENA_0[] = {
  {0x0846DD38, 0x06000000, 0xDA0}, {0x0846F878, 0x0600E000, 0x800}, {0x08468B78, 0x06004000, 0x1FE0},
  {0x0846CB38, 0x0600F000, 0x800}, {0x08468978, 0x05000000, 0x100}, {0x08467E78, 0x05000340, 0x10},
  {0x08467E98, 0x05000360, 0x10}, {0x08467EB8, 0x05000380, 0x10}, {0x08467ED8, 0x050003A0, 0x10},
  {0x08467EF8, 0x06014D00, 0x100}, {0x084680F8, 0x06014F00, 0x80}, {0x084681F8, 0x06015000, 0x40},
  {0x08468278, 0x06015080, 0x100}, {0x08468478, 0x06015280, 0x80}, {0x08468578, 0x06015380, 0x40},
  {0x084685F8, 0x06015400, 0x100}, {0x084687F8, 0x06015600, 0x80}, {0x084688F8, 0x06015700, 0x40},
};

void loadArena(int arena) {
  arena &= 0xFF;
  write8(ARENA, (uint8_t)arena);
  if (arena == 0) {
    for (unsigned i = 0; i < sizeof ARENA_0 / sizeof ARENA_0[0]; i++)
      copy16(ARENA_0[i].from, ARENA_0[i].to, (uint32_t)ARENA_0[i].count);
    write8(ARENA_LAYOUT, 9);
  }
  setArenaLayers();
}

void setArenaLayers(void) {
  static const int layers[2][3] = {{2, 0, 28}, {3, 1, 30}};
  for (int n = 0; n < 2; n++) {
    int layer = layers[n][0], charBase = layers[n][1], screenBase = layers[n][2];
    clearLayer(layer);
    layerBits(layer, 0x8000);
    layerBits(layer, (uint16_t)layer);
    layerBits(layer, 0x80);
    layerCharBase(layer, charBase);
    layerScreenBase(layer, screenBase);
  }
}

void loadArenaShape(int arena) {
  arena &= 0xFF;
  if (arena != 0) return;
  write16(LIMIT_A_HIGH, 0x1300);
  write16(LIMIT_A_LOW, (uint16_t)-0x1300);
  write16(LIMIT_B_HIGH, 0x1300);
  write16(LIMIT_B_LOW, (uint16_t)-0x1300);
  write8(POINT_COUNT, 70);
  write8(WALL_COUNT, 70);
  write8(FLOOR_COUNT, 24);
  for (int i = 0; i < 70; i++) write16(POINTS + (uint32_t)i * 2, read16(0x08070B62 + (uint32_t)i * 2));
  for (int i = 0; i < 70; i++) write8(WALL_POINTS + i, read8(0x08070BEE + (uint32_t)i));
  for (int i = 0; i < 70; i++) write16(WALL_LOOKS + (uint32_t)i * 2, read16(0x08070C34 + (uint32_t)i * 2));
  for (int i = 0; i < 24; i++) write16(FLOORS + (uint32_t)i * 2, read16(0x08070CC2 + (uint32_t)i * 2));
  write8(SHAPE_DONE, 3);
}

typedef struct {
  int x, y, height, depth, tile, byte10, matrix, colours, shape, byte14, flip;
} SpriteEntry;

static void queueSpriteEntry(const SpriteEntry *s) {
  queueSprite(((uint32_t)(s->x & 0xFFFF) | ((uint32_t)s->y << 16)),
    ((uint32_t)(s->height & 0xFFFF) | ((uint32_t)s->depth << 16)),
    ((uint32_t)(s->tile & 0xFFFF) | ((uint32_t)(s->byte10 & 0xFF) << 16) | ((uint32_t)(s->matrix & 0xFF) << 24)),
    ((uint32_t)(s->colours & 0xFF) | ((uint32_t)(s->shape & 0xFF) << 8) | ((uint32_t)(s->byte14 & 0xFF) << 16)
      | ((uint32_t)(s->flip & 0xFF) << 24)));
}

static void drawWalls(void) {
  SpriteEntry sprite = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8};
  for (int i = 0; i < read8(POINT_COUNT); i += 2) {
    uint32_t x = SCREEN_POINTS + (uint32_t)i * 2, y = SCREEN_POINTS + (uint32_t)(i + 1) * 2;
    g.cycles += 395;
    int vx, vy;
    viewFromArena(reads16(POINTS + (uint32_t)i * 2), reads16(POINTS + (uint32_t)(i + 1) * 2), &vx, &vy);
    screenFromView(vx, vy, &vx, &vy);
    write16(x, (uint16_t)vx);
    write16(y, (uint16_t)vy);
  }
  #define SCREEN_X(n) (SCREEN_POINTS + (uint32_t)(n) * 2)
  for (int i = 0; i < read8(WALL_COUNT); i += 2) {
    int a = read8(WALL_POINTS + i), b = read8(WALL_POINTS + i + 1);
    int middleX = (reads16(SCREEN_X(a)) + reads16(SCREEN_X(b))) >> 1;
    int middleY = (reads16(SCREEN_X(a + 1)) + reads16(SCREEN_X(b + 1))) >> 1;
    int height = read16(CAMERA_HEIGHT);
    int y = middleY - (((height << 16) >> 17) + 32);
    sprite.x = middleX - 32;
    sprite.y = y & 0xFFFF;
    g.cycles += 35 + 135;
    if ((((uint32_t)(middleX + 32) << 16) >> 0) > 0x01300000u) { g.cycles += 8; continue; }
    g.cycles += 6 + 21;
    int top = (int16_t)y;
    if (top > read8(SCREEN_BOTTOM)) { g.cycles += 8; continue; }
    g.cycles += 6 + 19;
    if (top < read8(SCREEN_TOP) - 64) { g.cycles += 8; continue; }
    g.cycles += 6 + 24;
    if (reads16(SCREEN_X(a)) >= reads16(SCREEN_X(b))) { g.cycles += 8; continue; }
    g.cycles += 6 + 118 + 455;
    sprite.shape = 0;
    sprite.depth = (y + height) & 0xFFFF;
    sprite.matrix = read8(MATRIX_COUNT);
    uint16_t look = read16(WALL_LOOKS + (uint32_t)i * 2);
    sprite.tile = look * 28 + 616;
    sprite.colours = read8(WALL_LOOKS + (uint32_t)(i + 1) * 2) + 10;
    int difference = read16(SCREEN_X(b)) - read16(SCREEN_X(a));
    uint16_t across = difference & 0xFFFF;
    uint16_t down = (uint16_t)(read16(SCREEN_X(b + 1)) - read16(SCREEN_X(a + 1)));
    int wide = (int16_t)difference;
    g.cycles += wide <= 15 ? 62 : wide <= 31 ? 64 : 36;
    if (wide <= 15) {
      sprite.x = middleX - 8;
      across = (uint16_t)(wide << 2);
      down = (uint16_t)(down << 2);
      sprite.shape = 2;
      sprite.tile = look * 28 + 640;
    } else if (wide <= 31) {
      sprite.x = middleX - 16;
      across = (uint16_t)(wide << 1);
      down = (uint16_t)(down << 1);
      sprite.shape = 1;
      sprite.tile = look * 28 + 632;
    }
    int16_t acrossS = (int16_t)across;
    int16_t lean = (int16_t)(reads16(CAMERA_HEIGHT) << 3);
    uint16_t first = (uint16_t)(divArm(acrossS, 8192) & 0xFFFF);
    uint16_t second = (uint16_t)(-divArm(lean, divArm(acrossS, (int32_t)down << 16)) & 0xFFFF);
    uint32_t third = (uint32_t)(divArm(reads16(CAMERA_HEIGHT) << 3, 65536) << 16);
    queueSpriteEntry(&sprite);
    queueMatrix(first, (uint32_t)(second | third));
  }
  #undef SCREEN_X
}

// from the first CpuSet's writes to the second's, for a frame whose work reaches them partway down the screen
#define WORK_BEFORE_LINE_ONE 81796
#define LINE_CYCLES 1232
#define LINE_ONE_CONSTANT 90
#define COLOURS_APART 300

static int landLines[4];

static void landWrite(void);

static void landSchedule(void) {
  if (g.line_write_index >= g.line_write_count) return;
  int line = landLines[g.line_write_index];
  if (g.line_work || line > 158) { landWrite(); return; }
  g.line_work_line = line;
  g.line_work = landWrite;
}

static void landWrite(void) {
  if (g.line_write_index >= g.line_write_count) return;
  ColourWrite w = g.line_writes[g.line_write_index];
  copy16(w.from, w.to, 16);
  gba_update_colors();
  g.line_write_index++;
  landSchedule();
}

static void landColours(const ColourWrite *writes, int count) {
  int counted = g.counting, sound = (int)g.sound_cycles;
  g.counting = 0;
  int late = g.cycles - WORK_BEFORE_LINE_ONE;
  if (!counted || sound < 0 || late < 0) {
    for (int i = 0; i < count; i++) copy16(writes[i].from, writes[i].to, 16);
    return;
  }
  g.line_write_count = count;
  g.line_write_index = 0;
  for (int i = 0; i < count; i++) {
    g.line_writes[i] = writes[i];
    landLines[i] = (late + sound + LINE_ONE_CONSTANT + i * COLOURS_APART) / LINE_CYCLES;
  }
  landSchedule();
}

static void moveColours(void) {
  if (read8(COLOURS_MOVE) == 0) return;
  int arena = read8(ARENA);
  write8(COLOUR_FRAME, read8(COLOUR_FRAME) + 1);
  if (read8(COLOUR_FRAME) >= read8(COLOUR_FRAMES + (uint32_t)arena)) write8(COLOUR_FRAME, 0);
  int frame = read8(COLOUR_FRAME);
  if (arena == 0) {
    for (int i = 0; i < 12; i++) write16(COLOURS_A + (uint32_t)(12 - i) * 2, read16(0x080710D2 + (uint32_t)((frame >> 2) + i) * 2));
    for (int i = 0; i < 12; i++) write16(COLOURS_B + (uint32_t)(12 - i) * 2, read16(0x08071102 + (uint32_t)((frame >> 2) + i) * 2));
    ColourWrite writes[2] = {{COLOURS_A, PALETTE_1A0}, {COLOURS_B, PALETTE_1C0}};
    landColours(writes, 2);
  }
}

void drawArena(void) {
  drawWalls();
  moveColours();
}

void drawArenaThings(void) {
  SpriteEntry sprite = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
  int depth = 0;
  for (int n = 0; n < THING_COUNT; n++) {
    uint32_t thing = THINGS + (uint32_t)n * THING_SIZE;
    if (read16(thing + THING_KIND) == 0) continue;
    int vx, vy;
    viewFromArena(reads16(thing + THING_AT_X), reads16(thing + THING_AT_Y), &vx, &vy);
    screenFromView(vx, vy, &vx, &vy);
    int left = (uint16_t)vx, top = (uint16_t)vy;
    switch (read8(thing + THING_SIZE_KIND)) {
      case 0: left -= 8; top -= 8; depth = (top - 1) & 0xFFFF; break;
      case 1: left -= 16; top -= 8; depth = (top - 1) & 0xFFFF; break;
      case 2: left -= 8; top -= 16; depth = (top - 2) & 0xFFFF; break;
      case 3: left -= 16; top -= 16; depth = (top - 2) & 0xFFFF; break;
      case 4: left -= 4; top -= 4; depth = top; break;
      default: break;
    }
    write16(thing + THING_X, (uint16_t)left);
    write16(thing + THING_Y, (uint16_t)top);
    if ((((uint32_t)(left + 64) << 16) >> 0) > 0x01300000u) continue;
    int row = top - reads16(thing + THING_HEIGHT);
    if (row > read8(SCREEN_BOTTOM) || row < read8(SCREEN_TOP) - 64) continue;
    uint8_t facing = read8(thing + THING_FACING), base = read8(thing + THING_BASE_FLIP);
    int front = facing == 4 || facing == 7 || facing == 1;
    int back = facing == 6 || facing == 9 || facing == 3;
    int low = ((facing - 1) & 0xFF) <= 2, high = ((facing - 7) & 0xFF) <= 2;
    int flip = -1;
    switch (read8(VIEW_SIDE)) {
      case 0: if (front) flip = base; else if (back) flip = base ^ 1; break;
      case 1: if (front) flip = base ^ 1; else if (back) flip = base; break;
      case 2: if (low) flip = base; else if (high) flip = base ^ 1; break;
      case 3: if (low) flip = base ^ 1; else if (high) flip = base; break;
      default: break;
    }
    if (flip >= 0) write8(thing + THING_FLIP, (uint8_t)flip);
    int parts = read8(KIND_PARTS + read16(thing + THING_KIND));
    for (int part = 0; part < parts; part++) {
      int picture = read8(thing + part);
      if (picture <= 26 && part <= 3) {
        int offset = read16(thing + THING_PART_X + (uint32_t)part * 2);
        int flipNow = read8(thing + THING_FLIP);
        sprite.x = flipNow == 0 ? left + offset : left - offset;
        sprite.y = (uint16_t)(top + read16(thing + THING_PART_Y + (uint32_t)part * 2));
        sprite.height = read16(thing + THING_HEIGHT);
        sprite.byte10 = 3;
        sprite.depth = depth;
        sprite.flip = flipNow;
        sprite.matrix = 0;
        sprite.tile = (picture << 4) + 176;
        int colours = read8(thing + THING_COLOURS);
        sprite.colours = colours == 255 ? read8(thing + THING_OWNER) : colours == 254 ? 4 : colours + 5;
        sprite.shape = read8(thing + THING_SIZE_KIND) + 30;
        sprite.byte14 = 0;
      }
      queueSpriteEntry(&sprite);
    }
  }
  write8(THINGS_DRAWN, 0);
  sendThingPictures();
}

void sendThingPictures(void) {
  for (int n = 0; n < THING_COUNT; n++) {
    uint32_t thing = THINGS + (uint32_t)n * THING_SIZE;
    if (read16(thing + THING_KIND) == 0) continue;
    int parts = read8(KIND_PARTS + read16(thing + THING_KIND));
    for (int part = 0; part < parts; part++) {
      uint32_t wanted = thing + THING_PICTURES + (uint32_t)part * 2;
      if (read16(wanted) == NOTHING_NEW) continue;
      int owner = read8(thing + THING_OWNER);
      int first = ((read8(SETUP_ + OWNER_CHARACTER + owner) - 9) & 0xFF) <= 7 || read8(SETUP_ + OWNER_OTHER + owner) != 0;
      int kind = read8(thing + THING_SIZE_KIND);
      if (kind <= 4) queuePicture(first ? PICTURES_ONE : PICTURES_TWO, PICTURE_BYTES[kind], read8(thing + part), read16(wanted));
      write16(wanted, NOTHING_NEW);
    }
  }
}

void queuePicture(uint32_t from, int bytes, int place, int picture) {
  if (g.copy_count > 31) return;
  g.copies[g.copy_count].to = 0x06011600 + ((uint32_t)(place & 0xFF) << 9);
  g.copies[g.copy_count].from = from + (uint32_t)(picture & 0xFFFF) * 32;
  g.copies[g.copy_count].bytes = (int32_t)(((((bytes & 0xFFFF) >> 3) + 7) & ~7) * 4);
  g.copy_count++;
}
