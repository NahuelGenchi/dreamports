// Chao Hunt, the VS mode's round, for one GBA of the link, translated from the JavaScript version's engine/chaohunt.js
// (SAT-R decompilation: the multiplayer parts of src/game/shared/stage/stage.c, player.c, stage_ui_z.c and
// mp_event_mgr.c). Every GBA runs the whole stage for itself and sees the others only through the link (link.c). Its
// first stage, Forest Chao Garden (level 14), is Neo Green Hill's sky and sea with the zone's palette animations.

#include "objects.h"
#include "chaohunt.h"

void draw_sky_and_sea(int camX, int camY);

// StageInit_ForestChaoGarden: Neo Green Hill's two palette animations, then 820's variants 1 and 0, and act 1's song
static const int PALETTES_A[] = { 814, 815, 820, 820 };
static const int VARIANTS_A[] = { 0, 0, 1, 0 };

const Level ACT_CHAO_HUNT_A = {
  .song = 12, .hudFlash = 90, LEVEL_PALETTES(PALETTES_A), .paletteVariants = VARIANTS_A,
  .bgCnt = 0x1D0B,   // 256 × 256, priority 3, map 29 (0xE800), character base 2
  .drawBackground = draw_sky_and_sea,
};

// gSpawnPositions_Modes_4_and_5: four start places for each multiplayer stage, right after the per-level table
enum { OFFSET_SPAWNS = 0x4A6DEC, LEVELS_IN_TABLE = 18 };

Round hunt;

int chaohunt_active(void) { return hunt.active; }

void chaohunt_spawn(int level, int player, int32_t *x, int32_t *y) {
  uint32_t at = OFFSET_SPAWNS + LEVELS_IN_TABLE * 4 + (uint32_t)(level - LEVEL_CHAO_HUNT_A) * 16 + (uint32_t)player * 4;
  *x = rom_s16(at);
  *y = rom_s16(at + 2);
}

/** The VS menus have chosen the round: Chao Hunt's `level`, with the Chao at place `chao`. */
void chaohunt_start(int level, int chao) {
  memset(&hunt, 0, sizeof hunt);
  hunt.active = 1;
  hunt.id = link_id();
  hunt.count = link_count();
  hunt.chaoPlace = chao;
  // each GBA plays the character its player picked in the VS character select
  ctx.character = ctx.vsLink.characters[hunt.id] & 3;
  ctx.partner = 0;
  act_active = 1;
  act_hold_black();
  // the VS screen's task ends itself as it asks for the round: the stage starts from the next frame
  act_queue(level, -1, 0);
}
