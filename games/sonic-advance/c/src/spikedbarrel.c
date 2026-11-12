// Egg Rocket's spiked barrels (kind 93). Translated from engine/spikedbarrel.js (the original's spiked_barrel.c:
// CreateEntity_SpikedBarrel, Task_SpikedBarrel). A platform that swings on the stage clock and turns its spikes round:
// on top for 16 frames, turning for 48, underneath for 16, turning back for 48. Sonic stands on top; while either set
// is out, touching its spike box hurts him.

#include "objects.h"

enum {
  ANIM_SPIKED_BARREL = 516,
  ORDER_BARREL = 18, PRIORITY_FRONT = 2,
  SHORT_WAIT = 0x10, LONG_WAIT = 0x30,
  SWING_HALF = 0x80,
  BARREL_TILES = 30,   // ALLOC_TILES: 48 x 40 px
};

typedef struct {
  Object o;
  int across, phase, reach, offset;
  int sag, variant, wait;
} SpikedBarrel;

static int spiked_barrel_run(ActTask *t) {
  SpikedBarrel *b = (SpikedBarrel *)t->data;
  const Entity *en = &b->o.slot->e;
  Player *p = &act.player;

  int32_t next = (int32_t)((uint32_t)b->reach * (uint32_t)(int32_t)SINE[(4 * ((act_stage_time() + b->phase) & 0xFF)) & 0x3FF]) >> 14;
  int moved = next - b->offset;
  b->offset = next;

  // it stands where I() floors its offset, and is drawn and hurts where Div() rounds it towards zero
  int x = en->x + (b->across ? next >> 8 : 0), y = en->y + (b->across ? 0 : next >> 8);
  int drawX = en->x + (b->across ? next / 256 : 0), drawY = en->y + (b->across ? 0 : next / 256);
  b->o.x = x;

  if (p->onObject == &b->o) {
    if (b->across) p->x += moved / 256.0;
    p->y += 1 + (b->across ? 0 : moved / 256.0);
  }
  collide_platform_top(&b->o, x, y, object_box(&b->o.sprite, 0), p);

  if ((b->variant == 0 || b->variant == 2) && object_box(&b->o.sprite, 1)) {
    // against his animation's own body box (spriteInfoBody's hitboxes[0]), whatever its state
    if (!p->dead && collide_overlap(drawX, drawY, object_box(&b->o.sprite, 1), (int)__builtin_floor(p->x), (int)__builtin_floor(p->y),
                                    &p->sprite.hitboxes[0])) {
      if (world_damage(p)) play_song(171);
    }
  }

  if (off_display(en->x, en->y) && off_cam(drawX, drawY)) { b->o.slot->live = NULL; return 0; }

  if (p->onObject == &b->o) {
    b->sag = b->sag + 0x10 > 0x100 ? 0x100 : b->sag + 0x10;
  } else {
    b->sag = b->sag - 0x10 < 0 ? 0 : b->sag - 0x10;
  }

  if (--b->wait == 0) {
    b->wait = (b->variant == 0 || b->variant == 2) ? LONG_WAIT : SHORT_WAIT;
    b->variant = (b->variant + 1) & 3;
    sprite_start(&b->o.sprite, b->variant);
  }

  sprite_step(&b->o.sprite);
  object_draw(&b->o.sprite, drawX, drawY + (SINE[b->sag] >> 12));
  return 1;
}

ActTask *spiked_barrel_spawn(Slot *slot) {
  const Entity *en = &slot->e;
  SpikedBarrel *b = OBJECT_NEW(SpikedBarrel);
  if (!b) return NULL;
  b->o.slot = slot;
  b->o.x = en->x;
  b->across = en->d[2] > en->d[3];
  b->phase = s8(b->across ? en->d[0] : en->d[1]) < 0 ? SWING_HALF : 0;
  b->reach = (b->across ? en->d[2] : en->d[3]) << 11;
  b->wait = SHORT_WAIT;
  b->variant = 0;
  object_sprite_at(&b->o.sprite, vram_malloc(BARREL_TILES), ANIM_SPIKED_BARREL, 0, ORDER_BARREL, PRIORITY_FRONT, 0, 0);
  sprite_step(&b->o.sprite);
  return object_task(&b->o, spiked_barrel_run, PRIORITY_OBJECTS);
}
