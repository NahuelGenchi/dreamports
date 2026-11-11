// Breakable walls (kind 114). Translated from the JavaScript version's engine/breakablewalls.js (the original's
// breakable_wall.c: CreateEntity_BreakableWall, Task_BreakableWall and Task_BreakableWall2). A wall pushes Sonic out of
// its sides until his attack box, or his flank while it is out, touches it: then it breaks with sound 173, bouncing him
// back up if he was falling, and its 32 tiles of 8 x 8 fall away column by column, the column he came from first,
// drifting the way he was going at half his speed. It never stays broken: once the first column's top tile falls past
// the screen's bottom, or the camera leaves it behind, its task ends and the wall spawns again when its spawn point
// comes back into range. d0 non-zero mirrors it.

#include "objects.h"

enum {
  ORDER_WALL = 15, PRIORITY_WALL = 2, SE_WALL_BREAK = 173,
  ROWS = 8, COLUMNS = 4, TILE = 8,
  COLUMN_DELAY = 10, ROW_DELAY = 2, FALL_ACCEL = 42, FALL_START = 0x200,
  CAM_REGION_WIDTH = 256,
};

// gUnknown_080BB544: the wall's animation in each act
static int wall_animation(int level) {
  if (level == 6 || level == 7) return 594;
  if (level == 8 || level == 9) return 595;
  if ((level >= 10 && level <= 13) || level == 17) return 596;
  return 559;
}

typedef struct { Object o; int broken, n, v; } Wall;

// Task_BreakableWall2: tile (row, column) starts falling 10 frames after the column before it and 2 frames after the
// row below it, 42/256 px a frame faster every frame from 2 px a frame up. Each tile is an OAM entry of its own.
static int fall(Wall *w, const Entity *en) {
  Sprite *s = &w->o.sprite;
  int flipX = en->d[0] != 0, bottom = s16(cam_y() - en->y + DISPLAY_HEIGHT), sx = s16(en->x - cam_x()), sy = en->y - cam_y();
  w->n = s16(w->n + 1);
  if ((en->x > cam_x() + DISPLAY_WIDTH + CAM_REGION_WIDTH / 2 || en->x < cam_x() - CAM_REGION_WIDTH / 2)
      && (uint16_t)(sx + CAM_REGION_WIDTH / 2) > DISPLAY_WIDTH + CAM_REGION_WIDTH)
    return 0;
  if (s->dimensions == NO_FRAME) return 1;
  // the tile whose fall ends it: the top one of the column that falls first
  int last = (w->v >= 0) != flipX ? 0 : COLUMNS - 1;
  uint32_t entry = rom_ptr(sprites.oam + s->graphics.anim * 4) + (rom_u8(s->dimensions + 1) & 0x3FFF) * 6;
  uint16_t attr2 = (uint16_t)((((rom_u16(entry + 4) + ((uint32_t)s->palId << 12)) & ~0xFFFu) | ((s->frameFlags & SPRITE_PRIORITY) >> 2)));
  int firstTile = (int)((s->graphics.dest - OBJ_VRAM) >> 5);
  for (int row = 0; row < ROWS; row++) {
    for (int j = 0; j < COLUMNS; j++) {
      int column = flipX ? COLUMNS - 1 - j : j, delay = w->v >= 0 ? j : COLUMNS - 1 - j, tile = row * COLUMNS + column;
      int t = s16(w->n - delay * COLUMN_DELAY - (ROWS - 1 - row) * ROW_DELAY), dx = 0, dy = 0;
      if (t > 0) {
        dy = s16((t * (t * FALL_ACCEL - FALL_START)) >> 8);
        dx = s16((t * w->v) >> 8);
        if (dy > bottom) {
          if (tile == last) return 0;
          continue;
        }
      }
      if (!objects_drawing()) continue;
      int k = alloc_oam(ORDER_WALL);
      if (k < 0) return 1;
      uint16_t *o = &e.oamMalloc[k * 4];
      o[0] = (uint16_t)((dy + sy + row * TILE) & 0xFF);
      o[1] = flipX ? (uint16_t)(((sx - column * TILE - TILE + dx) & 0x1FF) | 0x1000) : (uint16_t)((sx + column * TILE + dx) & 0x1FF);
      o[2] = (uint16_t)(attr2 | (firstTile + tile));
    }
  }
  return 1;
}

static int wall_run(ActTask *t) {
  Wall *w = (Wall *)t->data;
  const Entity *en = &w->o.slot->e;
  if (w->broken) return fall(w, en);
  Player *p = &act.player;
  const Hitbox *hb = object_box(&w->o.sprite, 0), *attack = object_box(&p->sprite, 1);
  if (hb && !p->dead) {
    int px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y);
    Hitbox flank = collide_flank(p);
    // Coll_Player_Gate with its attack test on
    if (attack && (collide_overlap(en->x, en->y, hb, px, py, attack) || collide_overlap(en->x, en->y, hb, px, py, &flank))) {
      if (p->air && p->ysp > 0) p->ysp = -p->ysp;
      play_song(SE_WALL_BREAK);
      w->broken = 1;
      // half his speed across, or a pixel a frame away from him when he wasn't moving across
      w->v = s16((int)__builtin_floor(p->xsp * 256 + 0.5)) >> 1;
      if (w->v == 0) w->v = en->x < px ? -256 : 256;
      if (p->onObject == w) { p->onObject = NULL; p->air = 1; }
    } else collide_gate(en->x, en->y, hb, p);
  }
  if (off_display(en->x, en->y) && off_cam(en->x, en->y)) return 0;
  object_draw(&w->o.sprite, en->x, en->y);
  return 1;
}

// CreateEntity_BreakableWall
ActTask *breakable_wall_spawn(Slot *slot) {
  Wall *w = OBJECT_NEW(Wall);
  if (!w) return NULL;
  w->o.slot = slot;
  w->o.x = slot->e.x;
  object_sprite(&w->o.sprite, wall_animation(act.stage.level), 0, 0, ORDER_WALL, PRIORITY_WALL, slot->e.d[0] != 0, 0);
  sprite_step(&w->o.sprite);   // its one frame, which it keeps
  return object_task(&w->o, wall_run, PRIORITY_OBJECTS);
}
