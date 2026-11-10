// The ferris wheels (interactable kind 91). Translated from the original's ferris_wheel.c a function at a time, with the
// JavaScript version's engine/ferriswheels.js as the guide; every comment names the function it rewrites.
//
// Each entity is one seat: a thin platform going round its spawn point, d2 * 8 px away clockwise when d2 is above d3, else
// d3 * 8 px away the other way, d1 / 2048 of a turn a frame of the stage clock, starting (d0 & 15) / 16 of a turn on. A wheel
// is several seats on one spawn point. Each seat draws the hub and two spokes on its way to it, except in Casino Paradise. It
// sags by up to 6 px while Sonic stands on it, carries him across by what it moved the frame before, and holds him 20 px
// above its middle, 15 px curled up.

#include "objects.h"

enum {
  ZONE_CASINO_PARADISE = 2, LEVEL_CHAO_HUNT_C = 16,   // where the wheels have no hub or spokes
  ANIM_HUB = 530, ANIM_SPOKE = 531,               // SA1_ANIM_FERRIS_WHEEL_HOOK and SA1_ANIM_FERRIS_WHEEL_SEGMENT
  VRAM_HUB = 0x3020, VRAM_SPOKE = 0x30A0,         // VRAM_RESERVED_FERRIS_WHEEL_HOOK and _SEGMENT
  SEAT_TILES = 48 / 8 * (24 / 8),                 // ALLOC_TILES(SA1_ANIM_PLATFORM_HORZ_3), whichever look it has
  ORDER_WHEEL = 18, PRIORITY_WHEEL = 2,
  ANGLE_MASK = 0x7FF,                             // a turn is 2048 steps, the sine's 1024 at half that
  SAG_STEP = 0x10, SAG_MAX = 0x100, SAG_DIV = 2500,   // Q(0.0625) and Q(1.0); the sine over 2500 is 6 px at most
  RIDE_HEIGHT = 20, RIDE_HEIGHT_CURLED = 15,
  SPOKES = 2, SPOKE_DIV = 3,
};

// gUnknown_086CEE2C: each level's look, SA1_ANIM_PLATFORM_HORZ_1 to _6_2
static const uint16_t SEATS[] = { 463, 463, 506, 506, 495, 495, 523, 523, 535, 535, 517, 598, 517, 517, 463, 506, 495, 598 };

typedef struct {
  Object o;                       // the seat
  Sprite hub, spoke;
  int phase, radius, clockwise;   // unk9C, unkB3 and unkB2
  int32_t a, b, last;             // the seat's offsets from the hub, in 1/2048 px (unkA4, unkA8), and the last frame's across (unkA0)
  int sag, riding;                // qUnkB0 and unkB6
} Wheel;

/** Task_FerrisWheel */
static int wheel_run(ActTask *t) {
  Wheel *w = (Wheel *)t->data;
  const Entity *e = &w->o.slot->e;
  Player *p = &act.player;
  int speed = s8(e->d[1]);
  int angle = (int)(((uint32_t)((w->clockwise ? speed : -speed) * (int32_t)act.tick) + (uint32_t)w->phase) & ANGLE_MASK) >> 1;
  w->a = SINE[angle] * w->radius;
  w->b = SINE[angle + 256] * w->radius;
  int x = e->x, y = e->y;
  int dx = w->a >> 11, dy = w->b >> 11;
  if (w->riding) p->x += (((w->a - w->last) >> 3) + (int)(act.tick & 1)) / 256.0;
  if (!p->dead) {
    collide_platform_top(&w->o, x + dx, y + dy, object_box(&w->o.sprite, 0), p);   // Coll_Player_PlatformCrumbling
    if (p->onObject == &w->o) {
      w->riding = 1;
      w->sag += SAG_STEP;
      if (w->sag > SAG_MAX) w->sag = SAG_MAX;
      p->y = y + dy - (p->spinDashing || p->curled ? RIDE_HEIGHT_CURLED : RIDE_HEIGHT);
    } else {
      w->riding = 0;
      w->sag = w->sag > SAG_STEP ? w->sag - SAG_STEP : 0;
    }
  } else w->riding = 0;
  if (off_display(x, y) && off_cam(x + dx, y + dy)) return 0;
  object_draw(&w->o.sprite, x + dx, y + dy + bios_div(SINE[w->sag], SAG_DIV));
  if (act.stage.zone != ZONE_CASINO_PARADISE && act.stage.level != LEVEL_CHAO_HUNT_C) {
    object_draw(&w->hub, x, y);
    int32_t sx = bios_div(w->a, SPOKE_DIV), sy = bios_div(w->b, SPOKE_DIV), r8 = 0, r4 = 0;
    for (int k = 0; k < SPOKES; k++) {
      r8 += sx; r4 += sy;
      object_draw(&w->spoke, x + (r8 >> 11), y + (r4 >> 11));
    }
  }
  w->last = w->a;
  return 1;
}

/** CreateEntity_FerrisWheel */
ActTask *ferris_wheel_spawn(Slot *slot) {
  Wheel *w = OBJECT_NEW(Wheel);
  if (!w) return NULL;
  const Entity *e = &slot->e;
  w->o.slot = slot;
  w->o.x = e->x;
  w->phase = (s8(e->d[0]) & 0xF) << 7;
  if (e->d[2] > e->d[3]) { w->radius = e->d[2]; w->clockwise = 1; }
  else { w->radius = e->d[3]; w->clockwise = 0; }
  int level = act.stage.level;
  int anim = SEATS[level < (int)(sizeof SEATS / sizeof SEATS[0]) ? level : 0];
  object_sprite_at(&w->o.sprite, vram_malloc(SEAT_TILES), anim, 0, ORDER_WHEEL, PRIORITY_WHEEL, 0, 0);
  sprite_step(&w->o.sprite);
  object_sprite_at(&w->hub, OBJ_VRAM + VRAM_HUB, ANIM_HUB, 0, ORDER_WHEEL, PRIORITY_WHEEL, 0, 0);
  sprite_step(&w->hub);
  object_sprite_at(&w->spoke, OBJ_VRAM + VRAM_SPOKE, ANIM_SPOKE, 0, ORDER_WHEEL, PRIORITY_WHEEL, 0, 0);
  sprite_step(&w->spoke);
  return object_task(&w->o, wheel_run, PRIORITY_OBJECTS);
}
