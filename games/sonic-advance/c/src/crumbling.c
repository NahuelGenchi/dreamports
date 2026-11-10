// The crumbling platforms (interactable kind 24). Translated from the original's platform_crumbling.c a function at a time,
// with the JavaScript version's engine/platforms.js as the guide; every comment names the function it rewrites.
//
// Sonic lands on it from above only. 32 frames after he does, it plays its sound and falls apart: its 32 tiles of 8 x 8 px are
// drawn one by one, each starting to fall a frame after the one before it, faster and faster. When the first one lets go it lets
// him drop, and once a tile has fallen below the screen the rest aren't drawn. It comes back once out of range, unless it fell
// apart below the screen before letting go of him. d0 mirrors it.

#include "objects.h"

enum {
  ORDER_PLATFORM = 18, PRIORITY_PLATFORM = 2,
  PLATFORM_TILES = 64 / 8 * (32 / 8),   // ALLOC_TILES(SA1_ANIM_CRUMBLE_PLATFORM)
  COLUMNS = 8, ROWS = 4, TILE = 8,
  WAIT = 30,                            // it starts to crumble when its count passes this after the landing
  LETS_GO = 31,                         // tile i starts to fall LETS_GO - i frames after it crumbles
  FALL = 42,                            // a tile has fallen t * t * 42 / 256 px t frames after it lets go
  SE_CRUMBLING_PLATFORM = 173,
  RANGE = 128,                          // CAM_REGION_WIDTH / 2
};

// sPlatformCrumblingAnims, for each level, with the USA copy's numbers, 2 lower than the decompilation's from about 886 on
static const uint16_t ANIMS[] = { 904, 904, 502, 502, 502, 502, 527, 527, 551, 551, 513, 602, 513, 513, 904, 502, 502, 602 };

enum { WAITING, LANDED, CRUMBLING, FALLING };

typedef struct { Object o; int phase, n; } Crumbling;

// how it is ranged out while it stands: well away from the camera and out of its range (Task_PlatformCrumbling)
static int far(int x, int y) {
  int cx = cam_x(), cy = cam_y();
  return (x > cx + SCREEN_W + RANGE || x < cx - RANGE || y > cy + SCREEN_H + RANGE || y < cy - RANGE) && off_cam(x, y);
}

/** Task_8025190 and Task_8025400: each of its tiles drawn on its own, with how far it has fallen. Returns 0 once it is gone. */
static int crumble(Crumbling *c, int x, int y) {
  Sprite *s = &c->o.sprite;
  Slot *slot = c->o.slot;
  int sx = s16(x - cam_x()), sy = s16(y - cam_y()), below = s16(cam_y() - y + SCREEN_H);
  uint32_t d = s->dimensions;
  uint16_t template = (uint16_t)rom_u16(rom_ptr(sprites.oam + s->graphics.anim * 4) + rom_u8(d + 1) * 6 + 4);
  int flip = (s->frameFlags & SPRITE_X_FLIP) != 0, was = c->phase;   // which of the two tasks runs this frame
  for (int i = 0; i < COLUMNS * ROWS; i++) {
    int t = s16(i - LETS_GO + c->n), dy = 0;
    if (t > 0 || was == FALLING) {
      if (was == CRUMBLING && i == 0 && t == 1) {
        Player *p = &act.player;
        if (p->onObject == &c->o) { p->onObject = NULL; p->air = 1; }
        c->phase = FALLING;
      }
      dy = (int16_t)(((t * FALL * t) << 8) >> 16);
      if (dy > below) {
        if (i != 0) return 1;
        if (was == CRUMBLING) slot->gone = 1;   // Task_8025190 leaves it initialised, so it never comes back
        return 0;
      }
    }
    if (!objects_drawing()) continue;
    int k = alloc_oam((s->oamFlags & 0x7C0) >> 6);
    if (k < 0) return 1;
    int col = i % COLUMNS, row = i / COLUMNS;
    e.oamMalloc[k * 4] = (uint16_t)((dy + row * TILE + sy) & 0xFF);
    e.oamMalloc[k * 4 + 1] = flip ? (uint16_t)(((sx - col * TILE - TILE) & 0x1FF) | 0x1000) : (uint16_t)((sx + col * TILE) & 0x1FF);
    e.oamMalloc[k * 4 + 2] = (uint16_t)(((template + s->palId) & ~0xFFF) | ((s->frameFlags & SPRITE_PRIORITY) >> 2)
                                        | (uint16_t)(((s->graphics.dest - OBJ_VRAM) >> 5) + i));
  }
  return 1;
}

/** Task_PlatformCrumbling, Task_8025008, Task_8025190 and Task_8025400 */
static int crumbling_run(ActTask *t) {
  Crumbling *c = (Crumbling *)t->data;
  Sprite *s = &c->o.sprite;
  Player *p = &act.player;
  int x = c->o.slot->e.x, y = c->o.slot->e.y;
  const Hitbox *hb = object_box(s, 0);
  if (c->phase >= CRUMBLING) {
    c->n++;
    if (c->phase == CRUMBLING) collide_platform_top(&c->o, x, y, hb, p);
    int cx = cam_x();
    if ((x > cx + SCREEN_W + RANGE || x < cx - RANGE) && (uint16_t)(s16(x - cx) + RANGE) > (uint16_t)(SCREEN_W + 2 * RANGE)) return 0;
    return crumble(c, x, y);
  }
  int landed = collide_platform_top(&c->o, x, y, hb, p) & COLLIDE_LANDED;
  if (c->phase == WAITING) {
    if (landed) { c->phase = LANDED; c->n = 0; }
  } else if (c->n++ > WAIT) {
    c->n = 0;
    c->phase = CRUMBLING;
    play_song(SE_CRUMBLING_PLATFORM);
  }
  if (far(x, y)) return 0;
  object_draw(s, x, y);
  return 1;
}

/** CreateEntity_PlatformCrumbling */
ActTask *crumbling_platform_spawn(Slot *slot) {
  Crumbling *c = OBJECT_NEW(Crumbling);
  if (!c) return NULL;
  c->o.slot = slot;
  c->o.x = slot->e.x;
  int level = act.stage.level;
  int anim = ANIMS[level < (int)(sizeof ANIMS / sizeof ANIMS[0]) ? level : 0];
  object_sprite_at(&c->o.sprite, vram_malloc(PLATFORM_TILES), anim, 0, ORDER_PLATFORM, PRIORITY_PLATFORM, slot->e.d[0] != 0, 0);
  sprite_step(&c->o.sprite);
  return object_task(&c->o, crumbling_run, PRIORITY_OBJECTS);
}
