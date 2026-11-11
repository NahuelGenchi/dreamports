// Secret Base act 2's steam exhausts. Translated from the JavaScript version's engine/steamexhausts.js (the original's
// steam_exhaust.c): a vent in the floor with a lid on it, both solid. Whenever the stage clock is a multiple of 160 it blows
// the lid up at 5 px a frame, 37/256 px a frame slower every frame, and the lid bounces twice when it lands again, each time
// at 2/5 of the speed. The steam scalds Sonic from its 7th frame to its 53rd, a box above the vent. On the rising lid he is
// carried up, and he can ride it for as long as he stays on it.

#include "objects.h"
#include "terrain.h"

enum {
  STEAM_EXHAUST = 79,
  ANIM_LID = 501, ANIM_BLOW = 567,   // SA1_ANIM_STEAM_EXHAUST_LID and SA1_ANIM_STEAM_EXHAUST
  VARIANT_SHUT = 0, VARIANT_LID = 2, VARIANT_BLOW = 0, VARIANT_BLOW_END = 1,
  ORDER_VENT = 18, ORDER_LID = 17, PRIORITY_FRONT = 2,
  VENT_TILES = 32 / 8 * (48 / 8), LID_TILES = 32 / 8 * (16 / 8),   // ALLOC_TILES and ALLOC_TILES_VARIANT
  PERIOD = 160,                  // Mod(gStageTime, 160)
  LAUNCH = -1280, GRAVITY = 37,  // the lid's speed and its fall, in 1/256 px
  BOUNCES = 3,                   // its landings until it rests
  STEAM = 102,                   // the steam's countdown (unk84): it scalds from 96 down to 50 and ends at 48
  STEAM_END = 48, SCALD_FROM = 50, SCALD_UNTIL = 97,
  SOX = 6,                       // Sonic's spriteOffsetX
  SE_LAVA_PLATFORM_SPURT = 182,
};

typedef struct {
  Object o;      // the vent
  Sprite lid;
  int blowing, vel, off, bounces, steam, riding;   // qLidAcceleration, qLidOffsetY, unk80, unk84, unk74
} SteamExhaust;

// a ceiling over his head pushes him back down out of it (sub_801E4E4 up from 19 px above his centre)
static void unstick(Player *p) {
  int d = terrain_scan(PROBE_FLOOR, (int)__builtin_floor(p->y) - 19, (int)__builtin_floor(p->x), p->layer, -8).d;
  if (d < 0) p->y += d;
}

// Task_SteamExhaust: the lid at rest, waiting for the clock
static int rest(SteamExhaust *se, const Entity *en, Player *p) {
  if (collide_platform(&se->lid, en->x, en->y, object_box(&se->lid, 0), p) & COLLIDE_LANDED) p->y += 1;
  // the original checks for the vent twice where it meant the vent or the lid
  else if (p->onObject == &se->o) {
    if (p->jumpPressed) p->onObject = NULL;
    unstick(p);
  } else if (collide_platform(&se->o, en->x, en->y, object_box(&se->o.sprite, 0), p)) unstick(p);
  if (off_display(en->x, en->y) && off_cam(en->x, en->y)) return 0;
  if (act_stage_time() % PERIOD == 0) {
    se->steam = STEAM; se->riding = 0; se->vel = LAUNCH; se->off = 0; se->bounces = BOUNCES;
    se->o.sprite.graphics.anim = ANIM_BLOW;
    sprite_start(&se->o.sprite, VARIANT_BLOW);
    play_song(SE_LAVA_PLATFORM_SPURT);
    se->blowing = 1;
  }
  sprite_step(&se->o.sprite); object_draw(&se->o.sprite, en->x, en->y);
  sprite_step(&se->lid); object_draw(&se->lid, en->x, en->y);
  return 1;
}

// Task_SteamExhaust2: while it blows, it stays even off screen
static int blow(SteamExhaust *se, const Entity *en, Player *p) {
  Sprite *vent = &se->o.sprite;
  se->vel += GRAVITY; se->off += se->vel;
  int ly = en->y + (se->off >> 8);
  const Hitbox *lidBox = object_box(&se->lid, 0);
  if (se->riding) {
    p->y += se->vel / 256.0;
    if (p->air) se->riding = 0;
    Hitbox body = { 0, -SOX, (int8_t)-p->offsetY, SOX, (int8_t)p->offsetY };
    if (!lidBox || p->dead || !collide_overlap(en->x, ly, lidBox, (int)__builtin_floor(p->x), (int)__builtin_floor(p->y), &body)) se->riding = 0;
  }
  if (collide_platform_top(&se->lid, en->x, ly, lidBox, p)) { se->riding = 1; p->y += 1; }
  collide_platform(&se->o, en->x, en->y, object_box(vent, 0), p);
  if (se->off >= 0) {
    if (--se->bounces != 0) { se->vel = -(se->vel * 2 / 5); se->riding = 0; se->off = 0; }
    else { vent->graphics.anim = ANIM_LID; sprite_start(vent, VARIANT_SHUT); se->blowing = 0; }
  }
  if (--se->steam == STEAM_END) {
    vent->graphics.anim = ANIM_BLOW;
    sprite_start(vent, VARIANT_BLOW_END);
    sprite_step(vent);
  } else if (se->steam + 1 >= SCALD_FROM && se->steam + 1 < SCALD_UNTIL) {
    const Hitbox *steam = object_box(vent, 1), *body = object_box(&p->sprite, 0);
    if (body && steam && collide_overlap(en->x, en->y, steam, (int)__builtin_floor(p->x), (int)__builtin_floor(p->y), body) && !p->dead) world_damage(p);
    sprite_step(vent);
  } else if (se->steam < STEAM_END) {
    // UpdateSpriteAnimation keeps returning ACMD_RESULT__ENDED once the script has ended, and here it runs twice a frame
    if (sprite_step(vent)) { vent->graphics.anim = ANIM_LID; sprite_start(vent, VARIANT_SHUT); }
    sprite_step(vent);
  }
  object_draw(vent, en->x, en->y);
  sprite_step(&se->lid); object_draw(&se->lid, en->x, ly);
  return 1;
}

static int steam_exhaust_run(ActTask *t) {
  SteamExhaust *se = (SteamExhaust *)t->data;
  const Entity *en = &se->o.slot->e;
  return se->blowing ? blow(se, en, &act.player) : rest(se, en, &act.player);
}

// the vent's and the lid's tiles go together (TaskDestructor_SteamExhaust)
static void steam_exhaust_end(ActTask *t) {
  object_sprite_free(&((SteamExhaust *)t->data)->lid);
  object_end(t);
}

// CreateEntity_SteamExhaust: neither sprite has run its script yet, so they are not solid on their first frame
ActTask *steam_exhaust_spawn(Slot *slot) {
  SteamExhaust *se = OBJECT_NEW(SteamExhaust);
  if (!se) return NULL;
  se->o.slot = slot;
  se->o.x = slot->e.x;
  object_sprite_at(&se->o.sprite, vram_malloc(VENT_TILES), ANIM_LID, VARIANT_SHUT, ORDER_VENT, PRIORITY_FRONT, 0, 0);
  se->o.sprite.hitboxes[0].index = -1;
  object_sprite_at(&se->lid, vram_malloc(LID_TILES), ANIM_LID, VARIANT_LID, ORDER_LID, PRIORITY_FRONT, 0, 0);
  se->lid.hitboxes[0].index = -1;
  ActTask *t = object_task(&se->o, steam_exhaust_run, PRIORITY_OBJECTS);
  if (!t) object_sprite_free(&se->lid);
  else t->end = steam_exhaust_end;
  return t;
}
