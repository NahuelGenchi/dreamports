// arena.js in C: the arena of a fight, its pictures and shape loaded, its walls and the things standing in it drawn
// each frame, and the colours that move (the original's 0x0800FDC8, 0x0801103C, 0x08011C7C, 0x0800F9C0 and 0x0800F3C4).
// Each of the original's switch's cases is an entry of ARENAS and of SHAPES, for every one of Training's twelve maps.

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
typedef struct { const ArenaCopy *copies; int count, layout; } ArenaCopyList;
typedef struct {
  int16_t limits[4];
  uint8_t counts[3];
  uint32_t points, walls, looks, floors;
  uint8_t done;
} ArenaShape;
static const ArenaCopy ARENA_0[] = {
  {0x0846DD38, 0x06000000, 3488},
  {0x0846F878, 0x0600E000, 2048},
  {0x08468B78, 0x06004000, 8160},
  {0x0846CB38, 0x0600F000, 2048},
  {0x08468978, 0x05000000, 256},
  {0x08467E78, 0x05000340, 16},
  {0x08467E98, 0x05000360, 16},
  {0x08467EB8, 0x05000380, 16},
  {0x08467ED8, 0x050003A0, 16},
  {0x08467EF8, 0x06014D00, 256},
  {0x084680F8, 0x06014F00, 128},
  {0x084681F8, 0x06015000, 64},
  {0x08468278, 0x06015080, 256},
  {0x08468478, 0x06015280, 128},
  {0x08468578, 0x06015380, 64},
  {0x084685F8, 0x06015400, 256},
  {0x084687F8, 0x06015600, 128},
  {0x084688F8, 0x06015700, 64},
};
static const ArenaCopy ARENA_1[] = {
  {0x0844A738, 0x06000000, 544},
  {0x0844AB78, 0x0600E000, 2048},
  {0x08445578, 0x06004000, 8160},
  {0x08449538, 0x0600F000, 2048},
  {0x08445378, 0x05000000, 256},
  {0x08444898, 0x05000340, 16},
  {0x084448B8, 0x05000360, 16},
  {0x084448D8, 0x05000380, 16},
  {0x084448F8, 0x06014D00, 256},
  {0x08444AF8, 0x06014F00, 128},
  {0x08444BF8, 0x06015000, 64},
  {0x08444C78, 0x06015080, 256},
  {0x08444E78, 0x06015280, 128},
  {0x08444F78, 0x06015380, 64},
  {0x08444FF8, 0x06015400, 256},
  {0x084451F8, 0x06015600, 128},
  {0x084452F8, 0x06015700, 64},
};
static const ArenaCopy ARENA_2[] = {
  {0x0842BA98, 0x06000000, 1056},
  {0x0842C2D8, 0x0600E000, 2048},
  {0x08428898, 0x06004000, 4096},
  {0x0842A898, 0x0600F000, 2048},
  {0x08428698, 0x05000000, 256},
  {0x08427858, 0x05000340, 16},
  {0x08427878, 0x05000360, 16},
  {0x08427898, 0x06014D00, 256},
  {0x08427A98, 0x06014F00, 128},
  {0x08427B98, 0x06015000, 64},
  {0x08427C18, 0x06015080, 256},
  {0x08427E18, 0x06015280, 128},
  {0x08427F18, 0x06015380, 64},
  {0x08427F98, 0x06015400, 256},
  {0x08428198, 0x06015600, 128},
  {0x08428298, 0x06015700, 64},
  {0x08428318, 0x06015780, 256},
  {0x08428518, 0x06015980, 128},
  {0x08428618, 0x06015A80, 64},
};
static const ArenaCopy ARENA_3[] = {
  {0x0843B498, 0x06000000, 1056},
  {0x0843BCD8, 0x0600E000, 2048},
  {0x08436318, 0x06004000, 8128},
  {0x0843A298, 0x0600F000, 2048},
  {0x08436118, 0x05000000, 256},
  {0x08435298, 0x05000340, 16},
  {0x084352B8, 0x05000360, 16},
  {0x084352D8, 0x05000380, 16},
  {0x084352F8, 0x050003A0, 16},
  {0x08435318, 0x06014D00, 256},
  {0x08435518, 0x06014F00, 128},
  {0x08435618, 0x06015000, 64},
  {0x08435698, 0x06015080, 256},
  {0x08435898, 0x06015280, 128},
  {0x08435998, 0x06015380, 64},
  {0x08435A18, 0x06015400, 256},
  {0x08435C18, 0x06015600, 128},
  {0x08435D18, 0x06015700, 64},
  {0x08435D98, 0x06015780, 256},
  {0x08435F98, 0x06015980, 128},
  {0x08436098, 0x06015A80, 64},
};
static const ArenaCopy ARENA_4[] = {
  {0x08442F58, 0x06000000, 1184},
  {0x08443898, 0x0600E000, 2048},
  {0x0843DD58, 0x06004000, 8192},
  {0x08441D58, 0x0600F000, 2048},
  {0x0843DB58, 0x05000000, 256},
  {0x0843CCD8, 0x05000340, 16},
  {0x0843CCF8, 0x05000360, 16},
  {0x0843CD18, 0x05000380, 16},
  {0x0843CD38, 0x050003A0, 16},
  {0x0843CD58, 0x06014D00, 256},
  {0x0843CF58, 0x06014F00, 128},
  {0x0843D058, 0x06015000, 64},
  {0x0843D0D8, 0x06015080, 256},
  {0x0843D2D8, 0x06015280, 128},
  {0x0843D3D8, 0x06015380, 64},
  {0x0843D458, 0x06015400, 256},
  {0x0843D658, 0x06015600, 128},
  {0x0843D758, 0x06015700, 64},
  {0x0843D7D8, 0x06015780, 256},
  {0x0843D9D8, 0x06015980, 128},
  {0x0843DAD8, 0x06015A80, 64},
};
static const ArenaCopy ARENA_5[] = {
  {0x08451A38, 0x06000000, 4128},
  {0x08453A78, 0x0600E000, 2048},
  {0x0844C878, 0x06004000, 8160},
  {0x08450838, 0x0600F000, 2048},
  {0x0844C678, 0x05000000, 256},
  {0x0844BB78, 0x05000340, 16},
  {0x0844BB98, 0x05000360, 16},
  {0x0844BBB8, 0x05000380, 16},
  {0x0844BBD8, 0x050003A0, 16},
  {0x0844BBF8, 0x06014D00, 256},
  {0x0844BDF8, 0x06014F00, 128},
  {0x0844BEF8, 0x06015000, 64},
  {0x0844BF78, 0x06015080, 256},
  {0x0844C178, 0x06015280, 128},
  {0x0844C278, 0x06015380, 64},
  {0x0844C2F8, 0x06015400, 256},
  {0x0844C4F8, 0x06015600, 128},
  {0x0844C5F8, 0x06015700, 64},
};
static const ArenaCopy ARENA_6[] = {
  {0x084795D8, 0x06000000, 544},
  {0x08479A18, 0x0600E000, 2048},
  {0x08474658, 0x06004000, 7872},
  {0x084783D8, 0x0600F000, 2048},
  {0x08474458, 0x05000000, 256},
  {0x08473898, 0x05000340, 16},
  {0x084738B8, 0x05000360, 16},
  {0x084738D8, 0x05000380, 16},
  {0x084738F8, 0x050003A0, 16},
  {0x08473918, 0x06014D00, 256},
  {0x08473B38, 0x06014F00, 128},
  {0x08473C58, 0x06015000, 64},
  {0x08473CD8, 0x06015080, 256},
  {0x08473EF8, 0x06015280, 128},
  {0x08474018, 0x06015380, 64},
  {0x08474098, 0x06015400, 256},
  {0x084742B8, 0x06015600, 128},
  {0x084743D8, 0x06015700, 64},
};
static const ArenaCopy ARENA_7[] = {
  {0x08432ED8, 0x06000000, 2528},
  {0x08434298, 0x0600E000, 2048},
  {0x0842E318, 0x06004000, 7744},
  {0x08431CD8, 0x0600F000, 2048},
  {0x0842E118, 0x05000000, 256},
  {0x0842D2F8, 0x05000340, 16},
  {0x0842D2D8, 0x05000360, 16},
  {0x0842D318, 0x06014D00, 256},
  {0x0842D518, 0x06014F00, 128},
  {0x0842D618, 0x06015000, 64},
  {0x0842D698, 0x06015080, 256},
  {0x0842D898, 0x06015280, 128},
  {0x0842D998, 0x06015380, 64},
  {0x0842DA18, 0x06015400, 256},
  {0x0842DC18, 0x06015600, 128},
  {0x0842DD18, 0x06015700, 64},
  {0x0842DD98, 0x06015780, 256},
  {0x0842DF98, 0x06015980, 128},
  {0x0842E098, 0x06015A80, 64},
};
static const ArenaCopy ARENA_8[] = {
  {0x08457078, 0x06000000, 8192},
  {0x0845B078, 0x0600E000, 2048},
  {0x08455738, 0x06004000, 928},
  {0x08455E78, 0x0600F000, 2048},
  {0x08455538, 0x05000000, 256},
  {0x08454A78, 0x05000340, 16},
  {0x08454A98, 0x05000360, 16},
  {0x08454AB8, 0x06014D00, 256},
  {0x08454CB8, 0x06014F00, 128},
  {0x08454DB8, 0x06015000, 64},
  {0x08454E38, 0x06015080, 256},
  {0x08455038, 0x06015280, 128},
  {0x08455138, 0x06015380, 64},
  {0x084551B8, 0x06015400, 256},
  {0x084553B8, 0x06015600, 128},
  {0x084554B8, 0x06015700, 64},
};
static const ArenaCopy ARENA_9[] = {
  {0x08472278, 0x06000000, 288},
  {0x084724B8, 0x0600E000, 2048},
  {0x08470A78, 0x06004000, 768},
  {0x08471078, 0x0600F000, 2048},
  {0x08470878, 0x05000000, 256},
  {0x084734B8, 0x05000340, 16},
  {0x084734D8, 0x06014D00, 256},
  {0x084736F8, 0x06014F00, 128},
  {0x08473818, 0x06015000, 64},
};
static const ArenaCopy ARENA_10[] = {
  {0x08465AF8, 0x06000000, 2496},
  {0x08466E78, 0x0600E000, 2048},
  {0x08461EF8, 0x06004000, 5376},
  {0x084648F8, 0x0600F000, 2048},
  {0x08461CF8, 0x05000000, 256},
  {0x08461238, 0x05000340, 16},
  {0x08461258, 0x05000360, 16},
  {0x08461278, 0x06014D00, 256},
  {0x08461478, 0x06014F00, 128},
  {0x08461578, 0x06015000, 64},
  {0x084615F8, 0x06015080, 256},
  {0x084617F8, 0x06015280, 128},
  {0x084618F8, 0x06015380, 64},
  {0x08461978, 0x06015400, 256},
  {0x08461B78, 0x06015600, 128},
  {0x08461C78, 0x06015700, 64},
};
static const ArenaCopy ARENA_11[] = {
  {0x0845C278, 0x06004000, 8160},
  {0x08460238, 0x0600F000, 2048},
  {0x0845C078, 0x05000000, 256},
};

static const ArenaCopyList ARENAS[12] = {
  {ARENA_0, 18, 9},
  {ARENA_1, 17, 4},
  {ARENA_2, 19, 0},
  {ARENA_3, 21, 2},
  {ARENA_4, 21, 3},
  {ARENA_5, 18, 5},
  {ARENA_6, 18, 11},
  {ARENA_7, 19, 1},
  {ARENA_8, 16, 6},
  {ARENA_9, 9, 10},
  {ARENA_10, 16, 8},
  {ARENA_11, 3, 7},
};

static const ArenaShape SHAPES[12] = {
  {{(int16_t)4864, (int16_t)-4864, (int16_t)4864, (int16_t)-4864}, {70, 70, 24}, 0x08070B62, 0x08070BEE, 0x08070C34, 0x08070CC2, 3},
  {{(int16_t)3328, (int16_t)-3328, (int16_t)3328, (int16_t)-3328}, {56, 56, 8}, 0x0807062A, 0x0807069A, 0x080706D2, 0x08070744, 3},
  {{(int16_t)3840, (int16_t)-3840, (int16_t)3840, (int16_t)-3840}, {64, 64, 24}, 0x0806FFBA, 0x0807003A, 0x0807007A, 0x080700FC, 3},
  {{(int16_t)3840, (int16_t)-3840, (int16_t)3840, (int16_t)-3840}, {72, 72, 32}, 0x080702C2, 0x08070352, 0x0807039A, 0x0807042C, 3},
  {{(int16_t)4864, (int16_t)-4864, (int16_t)4864, (int16_t)-4864}, {80, 80, 20}, 0x0807046E, 0x0807050E, 0x0807055E, 0x08070600, 3},
  {{(int16_t)6144, (int16_t)-6144, (int16_t)3072, (int16_t)-3072}, {64, 64, 32}, 0x08070756, 0x080707D6, 0x08070816, 0x08070898, 3},
  {{(int16_t)3072, (int16_t)-3072, (int16_t)3072, (int16_t)-3072}, {32, 32, 16}, 0x08070E58, 0x08070E98, 0x08070EB8, 0x08070EFA, 3},
  {{(int16_t)7936, (int16_t)-7936, (int16_t)1792, (int16_t)-1792}, {72, 72, 20}, 0x0807012E, 0x080701BE, 0x08070206, 0x08070298, 4},
  {{(int16_t)4352, (int16_t)-4352, (int16_t)4352, (int16_t)-4352}, {40, 40, 28}, 0x080708DA, 0x0807092A, 0x08070952, 0x080709A4, 3},
  {{(int16_t)4096, (int16_t)-4096, (int16_t)4096, (int16_t)-4096}, {64, 64, 16}, 0x08070CF4, 0x08070D74, 0x08070DB4, 0x08070E36, 3},
  {{(int16_t)7936, (int16_t)-7936, (int16_t)1792, (int16_t)-1792}, {68, 68, 20}, 0x080709E2, 0x08070A6A, 0x08070AAE, 0x08070B38, 4},
  {{(int16_t)4864, (int16_t)-4864, (int16_t)4864, (int16_t)-4864}, {0, 0, 0}, 0, 0, 0x080709DE, 0x080709E0, 3},
};

void loadArena(int arena) {
  arena &= 0xFF;
  write8(ARENA, (uint8_t)arena);
  if (arena <= 11) {
    const ArenaCopyList *list = &ARENAS[arena];
    for (int i = 0; i < list->count; i++)
      copy16(list->copies[i].from, list->copies[i].to, (uint32_t)list->copies[i].count);
    write8(ARENA_LAYOUT, (uint8_t)list->layout);
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
  if (arena > 11) return;
  const ArenaShape *shape = &SHAPES[arena];
  write16(LIMIT_A_HIGH, (uint16_t)shape->limits[0]);
  write16(LIMIT_A_LOW, (uint16_t)shape->limits[1]);
  write16(LIMIT_B_HIGH, (uint16_t)shape->limits[2]);
  write16(LIMIT_B_LOW, (uint16_t)shape->limits[3]);
  write8(POINT_COUNT, shape->counts[0]);
  write8(WALL_COUNT, shape->counts[1]);
  write8(FLOOR_COUNT, shape->counts[2]);
  for (int i = 0; i < shape->counts[0]; i++) write16(POINTS + (uint32_t)i * 2, read16(shape->points + (uint32_t)i * 2));
  for (int i = 0; i < shape->counts[1]; i++) write8(WALL_POINTS + i, read8(shape->walls + (uint32_t)i));
  for (int i = 0; i < shape->counts[1]; i++) write16(WALL_LOOKS + (uint32_t)i * 2, read16(shape->looks + (uint32_t)i * 2));
  for (int i = 0; i < shape->counts[2]; i++) write16(FLOORS + (uint32_t)i * 2, read16(shape->floors + (uint32_t)i * 2));
  write8(SHAPE_DONE, shape->done);
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

/** `count` 16-bit colours from `table`, starting at its entry `from` and `step` entries apart, into the buffer `to` from its place `at`. */
static void colourRun(uint32_t to, int at, uint32_t table, int from, int count, int step) {
  for (int i = 0; i < count; i++) write16(to + (uint32_t)(at + i) * 2, read16(table + (uint32_t)(from + i * step) * 2));
}

static void moveColours(void) {
  if (read8(COLOURS_MOVE) == 0) return;
  int arena = read8(ARENA);
  write8(COLOUR_FRAME, read8(COLOUR_FRAME) + 1);
  if (read8(COLOUR_FRAME) >= read8(COLOUR_FRAMES + (uint32_t)arena)) write8(COLOUR_FRAME, 0);
  int frame = read8(COLOUR_FRAME);
  switch (arena) {
    case 0: {
      // the two tables run backward, from the 13th colour down to the second
      for (int i = 0; i < 12; i++) write16(COLOURS_A + (uint32_t)(12 - i) * 2, read16(0x080710D2 + (uint32_t)((frame >> 2) + i) * 2));
      for (int i = 0; i < 12; i++) write16(COLOURS_B + (uint32_t)(12 - i) * 2, read16(0x08071102 + (uint32_t)((frame >> 2) + i) * 2));
      ColourWrite writes[2] = {{COLOURS_A, PALETTE_1A0}, {COLOURS_B, PALETTE_1C0}};
      landColours(writes, 2);
      break;
    }
    case 1:
      colourRun(COLOURS_A, 0, 0x0807104A, frame >> 1, 12, 1);
      colourRun(COLOURS_A, 12, 0x0807107A, frame >> 1, 4, 2);
      copy16(COLOURS_A, PALETTE_1C0, 16);
      break;
    case 3:
      colourRun(COLOURS_A, 0, 0x08070F66, frame, 16, 1);
      colourRun(COLOURS_B, 0, 0x08070FA6, frame, 16, 1);
      copy16(COLOURS_A, PALETTE_1A0, 16);
      copy16(COLOURS_B, PALETTE_1C0, 16);
      break;
    case 4:
      colourRun(COLOURS_A, 0, 0x08070FE6, frame >> 2, 5, 1);
      colourRun(COLOURS_A, 5, 0x08070FFA, frame >> 2, 5, 1);
      colourRun(COLOURS_A, 10, 0x0807100E, frame >> 4, 2, 1);
      colourRun(COLOURS_A, 12, 0x08071022, frame >> 3, 2, 1);
      colourRun(COLOURS_A, 14, 0x08071036, frame >> 4, 2, 1);
      copy16(COLOURS_A, PALETTE_1C0, 16);
      break;
    case 6:
    case 7:
      colourRun(COLOURS_A, 0, 0x08070F26, frame >> 1, 16, 1);
      copy16(COLOURS_A, PALETTE_1C0, 16);
      break;
    case 9:
      write16(COLOURS_A, 0);
      colourRun(COLOURS_A, 1, 0x08071132, frame >> 1, 15, 1);
      copy16(COLOURS_A, PALETTE_002, 16);
      break;
    case 11:
      write16(COLOURS_A, 0);
      colourRun(COLOURS_A, 1, 0x080710BA, frame >> 2, 6, 1);
      for (int i = 7; i < 16; i++) write16(COLOURS_A + (uint32_t)i * 2, 0);
      copy16(COLOURS_A, PALETTE_060, 16);
      break;
    default:
      break;
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
      case 0: depth = (top - 1) & 0xFFFF; left -= 8; top -= 8; break;
      case 1: depth = (top - 1) & 0xFFFF; left -= 16; top -= 8; break;
      case 2: depth = (top - 2) & 0xFFFF; left -= 8; top -= 16; break;
      case 3: depth = (top - 2) & 0xFFFF; left -= 16; top -= 16; break;
      case 4: depth = top; left -= 4; top -= 4; break;
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
