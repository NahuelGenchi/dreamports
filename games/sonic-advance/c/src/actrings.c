// The act's rings: the ring manager (SAT-R decompilation, src/game/shared/stage/rings_manager.c), translated from
// the JavaScript version's engine/rings.js. It runs after the camera and before the objects and Sonic, so it sees
// where he was at the end of the last frame; every ring shares one sprite, so they all spin together.

#include "act.h"

#define RING_REGION 256
#define RING_MAX 400
#define RING_REGIONS 512

// the sparkles a taken ring leaves (CreateCollectRingEffect): animation 708 at the reserved effect tiles
// (RESERVED_RING_EFFECT_TILES_VRAM, tile 248), OAM order 15. Every effect shares those tiles, as the original's do,
// and the last one its tasks update is the frame all of them show.
#define SPARKLE_MAX 8
#define SPARKLE_TILES 248
static struct {
  int regionsX, regionsY, count;
  struct { int x, y, region; uint8_t taken; } rings[RING_MAX];
  int start[RING_REGIONS], n[RING_REGIONS];
  Sprite anim;
  int loaded;
  struct { int x, y, seq, active; Sprite anim; } sparkles[SPARKLE_MAX];
  int sparkleCount, nextSparkle, sparkleSeq;
} rings;

static uint8_t rl[0x4000];

// a ring's sound: song 117 on player 1 or 2, at half volume and panned to the side the count's parity picks
static void play_ring(int odd) {
  int player = odd ? 2 : 1;
  gba_sound_start_on(player, 117);
  gba_sound_imm_init(player);
  gba_sound_volume(player, 0xFFFF, 128);
  gba_sound_pan(player, 0xFFFF, odd ? -64 : 64);
}

/** The GBA BIOS's RLUnComp: 0x30, then the size, runs and literal blocks. */
static int rl_decompress(uint32_t at) {
  uint32_t header = rom_u32(at);
  if ((header & 0xFF) != 0x30) return 0;
  uint32_t size = header >> 8, n = 0;
  if (size > sizeof rl) size = sizeof rl;
  at += 4;
  while (n < size) {
    uint32_t flag = rom_u8(at++);
    if (flag & 0x80) { uint32_t b = rom_u8(at++); for (uint32_t k = (flag & 0x7F) + 3; k > 0 && n < size; k--) rl[n++] = (uint8_t)b; }
    else for (uint32_t k = (flag & 0x7F) + 1; k > 0 && n < size; k--) rl[n++] = (uint8_t)rom_u8(at++);
  }
  return (int)size;
}

static uint32_t u32at(int at) { return (uint32_t)rl[at] | (uint32_t)rl[at + 1] << 8 | (uint32_t)rl[at + 2] << 16 | (uint32_t)rl[at + 3] << 24; }

/** The level's rings, kept in their 256 × 256 px regions (rom/entities.js readRings). */
void rings_init(int level) {
  memset(&rings, 0, sizeof rings);
  int size = rl_decompress(rom_ptr(OFFSET_RINGS + level * 4));
  if (!size) return;
  rings.regionsX = (int)u32at(4); rings.regionsY = (int)u32at(8);
  if (rings.regionsX * rings.regionsY > RING_REGIONS) return;
  for (int r = 0; r < rings.regionsX * rings.regionsY; r++) {
    uint32_t offset = u32at(12 + r * 4);
    rings.start[r] = rings.count;
    if (offset) {
      int rx = r % rings.regionsX, ry = r / rings.regionsX;
      for (int at = 4 + (int)offset; rl[at] != 0xFF && rings.count < RING_MAX; at += 2) {
        rings.rings[rings.count].x = rl[at] * 8 + rx * RING_REGION;
        rings.rings[rings.count].y = rl[at + 1] * 8 + ry * RING_REGION;
        rings.rings[rings.count].region = r;
        rings.count++;
      }
    }
    rings.n[r] = rings.count - rings.start[r];
  }
  // every ring shares the ring sprite (animation 707) at tile 240, in sprite palette 6
  sprite_init(&rings.anim);
  rings.anim.graphics.dest = OBJ_VRAM + 232 * 32;
  rings.anim.graphics.anim = 707;
  rings.anim.variant = 0;
  rings.anim.animSpeed = 0x10;
  rings.anim.palId = 0;
  rings.anim.oamFlags = 20 << 6;
  rings.anim.frameFlags = 2 << 12;
  rings.loaded = 1;
}

void rings_reset(void) {
  rings.sparkleCount = 0; rings.nextSparkle = 0; rings.sparkleSeq = 0;
  for (int i = 0; i < SPARKLE_MAX; i++) rings.sparkles[i].active = 0;
  for (int i = 0; i < rings.count; i++) rings.rings[i].taken = 0;
  if (rings.loaded) { rings.anim.graphics.anim = 707; rings.anim.prevAnim = 0xFFFF; rings.anim.animCursor = 0; rings.anim.qAnimDelay = 0; }
}

// a ring covers 16 × 16 px above its point; Sonic's box is ±6 px wide and ±spriteOffsetY tall around his centre
static int touching(int px, int py, int oy, int rx, int ry) {
  int l = px - 6, r = px + 6, t = py - oy, b = py + oy;
  return ((rx - 8 <= l && rx + 8 >= l) || (rx - 8 >= l && r >= rx - 8))
    && ((ry - 16 <= t && ry >= t) || (ry - 16 >= t && b >= ry - 16));
}

// the search's bottom and right edges come in by a ring's height and half its width (rings.js)
static int lower(uint32_t v) { return (int)((v >> 8) & 0xFFFF); }
static int upper(uint32_t v) { return (int)(v >> 8); }

/** The rings Sonic takes this frame, in the original's order, and the ring song for each. */
void rings_update(int px, int py, int oy) {
  if (!rings.loaded) return;
  update_sprite(&rings.anim, 0);
  for (int ry = lower((uint32_t)(py - oy)); ry <= upper((uint32_t)(py + oy - 16)) && ry < rings.regionsY; ry++) {
    for (int rx = lower((uint32_t)(px - 6 - 8)); rx <= upper((uint32_t)(px + 6 - 8)) && rx < rings.regionsX; rx++) {
      int r = rx + ry * rings.regionsX;
      for (int i = rings.start[r]; i < rings.start[r] + rings.n[r]; i++) {
        if (rings.rings[i].taken || !touching(px, py, oy, rings.rings[i].x, rings.rings[i].y)) continue;
        rings.rings[i].taken = 1;
        act.ringCount++;
        // CreateCollectRingEffect gives up before the sound when eight effects are already running; the ring is
        // still counted
        if (rings.sparkleCount >= SPARKLE_MAX) continue;
        play_ring(act.ringCount & 1);
        int k = rings.nextSparkle;
        for (int tries = 0; tries < SPARKLE_MAX && rings.sparkles[k].active; tries++) k = (k + 1) % SPARKLE_MAX;
        if (rings.sparkles[k].active) continue;
        rings.nextSparkle = (k + 1) % SPARKLE_MAX;
        rings.sparkleCount++;
        rings.sparkles[k].x = rings.rings[i].x; rings.sparkles[k].y = rings.rings[i].y;
        rings.sparkles[k].seq = rings.sparkleSeq; rings.sparkleSeq++;
        rings.sparkles[k].active = 1;
        // the sparkle's own task plays the ring song again as it first runs (game.js sparkle)
        play_song(117);
        sprite_init(&rings.sparkles[k].anim);
        rings.sparkles[k].anim.graphics.dest = OBJ_VRAM + SPARKLE_TILES * 32;
        rings.sparkles[k].anim.graphics.anim = 708;
        rings.sparkles[k].anim.variant = 0;
        rings.sparkles[k].anim.animSpeed = 0x10;
        rings.sparkles[k].anim.palId = 0;
        rings.sparkles[k].anim.oamFlags = 15 << 6;
        rings.sparkles[k].anim.frameFlags = 2 << 12;
      }
    }
  }
}

/** The rings the original draws: region by region from the camera's, those not taken whose point is on screen. */
void rings_draw(int cx, int cy) {
  if (!rings.loaded) return;
  for (int ry = cy >> 8; ry * RING_REGION < cy + 160 && ry < rings.regionsY; ry++) {
    for (int rx = cx >> 8; rx * RING_REGION < cx + 240 && rx < rings.regionsX; rx++) {
      int r = rx + ry * rings.regionsX;
      for (int i = rings.start[r]; i < rings.start[r] + rings.n[r]; i++) {
        int sx = rings.rings[i].x - cx, sy = rings.rings[i].y - cy;
        if (rings.rings[i].taken || sx < -8 || sx + 8 > 240 + 16 || sy < 0 || sy - 16 > 160) continue;
        rings.anim.x = (int16_t)sx;
        rings.anim.y = (int16_t)sy;
        display_sprite(&rings.anim);
      }
    }
  }
  // the sparkles, in front of Sonic at OAM order 15, in the order their tasks were made: the last one updated is
  // the frame they all show, as they share the effect tiles
  int last = -1;
  for (int pass = 0; pass < SPARKLE_MAX; pass++) {
    int k = -1;
    for (int i = 0; i < SPARKLE_MAX; i++) {
      if (!rings.sparkles[i].active || rings.sparkles[i].seq <= last) continue;
      if (k < 0 || rings.sparkles[i].seq < rings.sparkles[k].seq) k = i;
    }
    if (k < 0) break;
    last = rings.sparkles[k].seq;
    int more = update_sprite(&rings.sparkles[k].anim, 0);
    rings.sparkles[k].anim.x = (int16_t)(rings.sparkles[k].x - cx);
    rings.sparkles[k].anim.y = (int16_t)(rings.sparkles[k].y - cy);
    display_sprite(&rings.sparkles[k].anim);
    if (!more) { rings.sparkles[k].active = 0; rings.sparkleCount--; }
  }
}

