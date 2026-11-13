// What each of the seven special stages is made of, and the tables the stages share, read from the copy, translated
// from special/stages.js (SAT-R's src/game/sa1/special_stage/main.c constants). The engine (specialstage.c,
// specialplayer.c, specialobjects.c) runs any of them the same way: a stage is its layout, its two rings targets and
// its colours.

#include "special.h"

// main.c's constants, as offsets from the first
enum {
  AT_LEVEL_STAGES = 0x140,   // gUnknown_08487134: each level's stage, 12 bytes
  AT_TARGETS = 0x14C,        // gUnknown_08487140: each stage's rings for the checkpoint and the goal
  AT_AREA_ANIMS = 0x168,     // gUnknown_0848715C: the character's animation and variant by where they are
  AT_DPAD_ANIMS = 0x190,     // gUnknown_08487184: ... and by the direction held
  AT_STEER = 0x1D0,          // gUnknown_084871C4: the push each direction gives, x and y
  AT_WIDE_HIT = 0x210,       // gUnknown_08487204: the character's hitbox against dash pads and bombs
  AT_BOOST_HIT = 0x218,      // gUnknown_0848720C: ... while boosting
  AT_DASH_ANIMS = 0x220,     // gUnknown_08487214: the animation and variant each dash pad gives
  AT_DASH_SPEEDS = 0x238,    // gUnknown_0848722C: the speeds each dash pad gives, x, y and forward
  AT_OBJECT_ANIMS = 0x298,   // gUnknown_0848728C: each kind of object's animation and variant
  AT_OBJECT_TILES = 0x2D0,   // gUnknown_084872C4: where each kind's tiles are, in tiles from the sprites' VRAM
  AT_BUMPER_RINGS = 0x2EC,   // gUnknown_084872E0: the 12 rings around a bumper, x and y
  AT_SPARKS = 0x31C,         // gUnknown_08487310: the 8 sparks off a bumper, x and y
  AT_LOST_RINGS = 0x33C,     // gUnknown_08487330: the speeds of the 10 rings the character drops, x and y
};
#define LAYOUT_ENTRY 12

SpTables spTables;

/** The stage `level` leads to, 0 to 6 (gUnknown_08487134). */
int sp_stage_of_level(int level) { return (int)rom_u8(OFFSET_SPECIAL_STAGE + AT_LEVEL_STAGES + level); }

// `n` rows of `w` halfwords from `at`, as stages.js's rows reads them
static void rows(int16_t *to, uint32_t at, int n, int w) {
  for (int i = 0; i < n * w; i++) to[i] = (int16_t)rom_s16(OFFSET_SPECIAL_STAGE + at + i * 2);
}
static SpBox box(uint32_t at) {
  int16_t b[4];
  rows(b, at, 1, 4);
  return (SpBox){ b[0], b[1], b[2], b[3] };
}

/** The tables every stage shares, into spTables. */
void sp_read_tables(void) {
  SpTables *t = &spTables;
  rows(&t->areaAnims[0][0], AT_AREA_ANIMS, 10, 2);
  rows(&t->dpadAnims[0][0], AT_DPAD_ANIMS, 16, 2);
  rows(&t->steer[0][0], AT_STEER, 16, 2);
  t->wideHit = box(AT_WIDE_HIT);
  t->boostHit = box(AT_BOOST_HIT);
  rows(&t->dashAnims[0][0], AT_DASH_ANIMS, 6, 2);
  rows(&t->dashSpeeds[0][0], AT_DASH_SPEEDS, 16, 3);
  rows((int16_t *)&t->objectAnims[0][0], AT_OBJECT_ANIMS, 14, 2);
  rows((int16_t *)t->objectTiles, AT_OBJECT_TILES, 14, 1);
  rows(&t->bumperRings[0][0], AT_BUMPER_RINGS, 12, 2);
  rows(&t->sparks[0][0], AT_SPARKS, 8, 2);
  rows(&t->lostRings[0][0], AT_LOST_RINGS, 10, 2);
  for (int i = 0; i < 4; i++) t->characterAnims[i] = (uint16_t)rom_u16(OFFSET_CHARACTER_ANIMS + i * 2);
}

/** Entry `i` of the stage's layout, in order of depth, ending with the goal (stages.js stageData). */
SpEntry sp_entry(int i) {
  uint32_t at = sp.layout + (uint32_t)i * LAYOUT_ENTRY;
  return (SpEntry){ rom_s16(at), rom_s16(at + 2), rom_s32(at + 4), rom_u16(at + 8) };
}
