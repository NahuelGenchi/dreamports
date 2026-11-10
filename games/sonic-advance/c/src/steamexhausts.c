// Secret Base's steam exhausts (the original's steam_exhaust.c): a vent in the floor with a lid Sonic can stand on. Every 160
// frames of the stage clock the vent blows: the lid jumps up and bounces back three times, carrying whoever stands on it, and
// the steam hurts for the frames it is out.

#include "objects.h"
#include "terrain.h"

enum {
  KIND_STEAM_EXHAUST = 79,
  ANIM_LID = 501, ANIM_STEAM = 567,    // the vent with its lid, and without it, blowing
  VARIANT_VENT = 0, VARIANT_STEAM_ENDS = 1, VARIANT_LID = 2,
  VENT_TILES = (32 / 8) * (48 / 8),    // ALLOC_TILES(SA1_ANIM_STEAM_EXHAUST)
  LID_TILES = (32 / 8) * (16 / 8),     // ALLOC_TILES_VARIANT(SA1_ANIM_STEAM_EXHAUST_LID, 2)
  ORDER_VENT = 18, ORDER_LID = 17, PRIORITY_FRONT = 2,
  BLOW_EVERY = 160,                    // frames of the stage clock between blows
  BLOW_FRAMES = 0x66, STEAM_ENDS_AT = 48, HURTS_FROM = 50, HURTS_UNTIL = 97,
  LID_LAUNCH = -5 * 256, LID_GRAVITY = 37, BOUNCES = 3,   // Q8 pixels a frame
  SE_LAVA_PLATFORM_SPURT = 182,
  HEAD_ROOM = 19,                      // how far above his centre the ceiling is looked for
};

typedef struct {
  Object o;            // the vent's sprite
  Sprite lid;
  int blowing, riding, lidSpeed, lidY, bounces, blowLeft;
} SteamExhaust;

static int floor_px(double v) { return (int)__builtin_floor(v); }

// sub_801E4E4 up from his head: a ceiling into him puts him back under it
static void out_of_ceiling(Player *p) {
  Scan s = terrain_scan(PROBE_FLOOR, floor_px(p->y) - HEAD_ROOM, floor_px(p->x), p->layer, -8);
  if (s.d < 0) p->y += s.d;
}

// Task_SteamExhaust: the lid shut, solid, until the stage clock says blow
static void shut(SteamExhaust *se, Player *p, int x, int y) {
  Sprite *vent = &se->o.sprite;
  if (collide_platform(&se->lid, x, y, object_box(&se->lid, 0), p) & COLLIDE_LANDED) { p->y += 1; return; }
  // the original asks twice whether he stands on the vent, never on the lid: kept as it is
  if (p->onObject == vent) {
    if (e.input & KEY_A) p->onObject = NULL;
    out_of_ceiling(p);
  } else if (collide_platform(vent, x, y, object_box(vent, 0), p)) out_of_ceiling(p);
}

// Task_SteamExhaust2: the lid flies and bounces, carrying whoever lands on it
static void blow(SteamExhaust *se, Player *p, int x, int y) {
  Sprite *vent = &se->o.sprite;
  se->lidSpeed += LID_GRAVITY;
  se->lidY += se->lidSpeed;
  int lidY = y + (se->lidY >> 8);
  const Hitbox *lidBox = object_box(&se->lid, 0);
  if (se->riding) {
    p->y += se->lidSpeed / 256.0;
    if (p->air) se->riding = 0;
    // Coll_Player_Entity_Intersection: his body's box against the lid's
    Hitbox body = collide_body(p);
    if (p->dead || !lidBox || !collide_overlap(x, lidY, lidBox, floor_px(p->x), floor_px(p->y), &body)) se->riding = 0;
  }
  if (collide_platform_top(&se->lid, x, lidY, lidBox, p)) { se->riding = 1; p->y += 1; }
  collide_platform(vent, x, y, object_box(vent, 0), p);

  if (se->lidY >= 0) {
    if (--se->bounces != 0) {
      se->lidSpeed = -((se->lidSpeed * 2) / 5);
      se->riding = 0;
      se->lidY = 0;
    } else {
      vent->graphics.anim = ANIM_LID;
      sprite_start(vent, VARIANT_VENT);
      se->blowing = 0;
    }
  }

  if (--se->blowLeft == STEAM_ENDS_AT) {
    vent->graphics.anim = ANIM_STEAM;
    sprite_start(vent, VARIANT_STEAM_ENDS);
    sprite_step(vent);
  } else if (se->blowLeft + 1 >= HURTS_FROM && se->blowLeft + 1 < HURTS_UNTIL) {
    // the steam's box (its second hitbox) against his body hurts him
    const Hitbox *steam = object_box(vent, 1), *body = object_box(&p->sprite, 0);
    if (steam && body && collide_overlap(x, y, steam, floor_px(p->x), floor_px(p->y), body) && !p->dead) world_damage(p);
    sprite_step(vent);
  } else if (se->blowLeft < STEAM_ENDS_AT) {
    if (sprite_step(vent)) {
      vent->graphics.anim = ANIM_LID;
      sprite_start(vent, VARIANT_VENT);
    }
    sprite_step(vent);
  }
}

static int steam_exhaust_run(ActTask *t) {
  SteamExhaust *se = (SteamExhaust *)t->data;
  const Entity *en = &se->o.slot->e;
  Sprite *vent = &se->o.sprite;
  Player *p = &act.player;
  int x = en->x, y = en->y;
  if (se->blowing) {
    blow(se, p, x, y);
    object_draw(vent, x, y);
    sprite_step(&se->lid);
    object_draw(&se->lid, x, y + (se->lidY >> 8));
    return 1;
  }
  shut(se, p, x, y);
  if (off_display(x, y) && off_cam(x, y)) return 0;
  if (act.tick % BLOW_EVERY == 0) {
    se->blowLeft = BLOW_FRAMES;
    se->riding = 0;
    se->lidSpeed = LID_LAUNCH;
    se->lidY = 0;
    se->bounces = BOUNCES;
    vent->graphics.anim = ANIM_STEAM;
    sprite_start(vent, 0);
    play_song(SE_LAVA_PLATFORM_SPURT);
    se->blowing = 1;
  }
  sprite_step(vent);
  object_draw(vent, x, y);
  sprite_step(&se->lid);
  object_draw(&se->lid, x, y);
  return 1;
}

static void steam_exhaust_end(ActTask *t) {
  SteamExhaust *se = (SteamExhaust *)t->data;
  object_sprite_free(&se->lid);
  object_end(t);
}

ActTask *steam_exhaust_spawn(Slot *slot) {
  SteamExhaust *se = OBJECT_NEW(SteamExhaust);
  if (!se) return NULL;
  se->o.slot = slot;
  se->o.x = slot->e.x;
  // the vent's tiles are room for the blowing vent's, which is bigger than the shut one it starts as
  object_sprite_at(&se->o.sprite, vram_malloc(VENT_TILES), ANIM_LID, VARIANT_VENT, ORDER_VENT, PRIORITY_FRONT, 0, 0);
  object_sprite_at(&se->lid, vram_malloc(LID_TILES), ANIM_LID, VARIANT_LID, ORDER_LID, PRIORITY_FRONT, 0, 0);
  se->o.sprite.hitboxes[0].index = -1;
  se->lid.hitboxes[0].index = -1;
  ActTask *t = object_task(&se->o, steam_exhaust_run, PRIORITY_OBJECTS);
  if (t) t->end = steam_exhaust_end;
  else object_sprite_free(&se->lid);
  return t;
}
