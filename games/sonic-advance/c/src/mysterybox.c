// The multiplayer stages' mystery item boxes, kind 115, translated from the JavaScript version's engine/mysterybox.js with
// SAT-R's src/game/sa1/stage/mystery_itembox.c. All of a stage's boxes share one turn: the box whose d0 is the low three
// bits of the shared item turn (gRandomItemBox, which the stage moves on every 512 frames from the players' shared random
// numbers, chaohunt.c) shows, the others wait unseen. Its d1 counts the boxes broken there: a box shows only while its count
// is at most the turn's generation (gRandomItemBox's high bits, one more every 4096 frames), which a box catches up on as it
// shows. A box grows into view, its height through the rotation hardware, and shrinks out when the turn moves on. Like an
// item box it is solid, or broken by Sonic's attack box; broken, its icon rises for 60 frames and then gives its item:
// confusion or darkness to the others, or invisibility to the breaker. A box broken by another player shows the same dust
// cloud and rising icon without giving anything. Its item is picked from the shared random numbers each time it appears.

#include "objects.h"
#include "terrain.h"
#include "chaohunt.h"

enum {
  ANIM_ITEM_BOX = 705, ANIM_ICON = 706, ORDER_BOX = 18, ORDER_ICON = 19, PRIORITY_FRONT = 2, SE_ITEM_BOX_BREAK = 167,
  RISE_FRAMES = 60, HOLD_FRAMES = 30, GROW = 8, HOP_SPEED = -256, HOP_GRAVITY = 40, INVISIBLE_TIME = 600,
};
// each item's icon (gUnknown_080BB4D0): confusion, darkness, invisibility and confusion again
static const uint8_t ICONS[4] = { 13, 16, 14, 13 };
enum { WAITING, APPEAR, APPEARING, SHOWN, VANISHING, OPENING, RISING, HELD };

typedef struct {
  Object o;       // the box
  Sprite icon;
  Transform tf;
  uint32_t lastHit;   // unk78: what its last collision found
  int dy, vy;         // unk7C, unk7E
  int n;              // unk80: frames into a phase, or whether it hops
  int item;           // rndItemIndex
  int phase;
} MysteryBox;

static int turn(void) { return hunt.itemTurn & 7; }
static int generation(void) { return hunt.itemTurn >> 4; }

// he stops standing on it, and stops pushing it if its last collision had him push
static void let_go(MysteryBox *b) {
  Player *p = &act.player;
  if (p->onObject == &b->o) { p->onObject = NULL; p->air = 1; }
  if (b->lastHit & COLLIDE_PUSHING) { p->pushing = 0; b->lastHit = 0; }
}

// the box and its icon through the rotation hardware, at its height (Task_801C4EC and sub_801C5C4)
static void draw_scaled(MysteryBox *b, int x, int y) {
  b->tf.x = (int16_t)(x - cam_x()); b->tf.y = (int16_t)(y - cam_y());
  int matrix = mp_next_matrix();
  b->o.sprite.frameFlags = (b->o.sprite.frameFlags & ~SPRITE_ROT_SCALE) | (uint32_t)matrix;
  b->icon.frameFlags = (b->icon.frameFlags & ~SPRITE_ROT_SCALE) | (uint32_t)matrix;
  transform_sprite(&b->o.sprite, &b->tf);
  transform_sprite(&b->icon, &b->tf);
  display_sprite(&b->o.sprite);
  display_sprite(&b->icon);
}

static void set_scaled(MysteryBox *b, int scaleY) {
  b->o.sprite.frameFlags |= SPRITE_ROT_SCALE_ENABLE;
  b->icon.frameFlags |= SPRITE_ROT_SCALE_ENABLE;
  b->tf.rotation = 0; b->tf.qScaleX = 0x100; b->tf.qScaleY = (int16_t)scaleY; b->tf.x = 0; b->tf.y = 0;
}
static void set_plain(MysteryBox *b) {
  b->o.sprite.frameFlags &= ~SPRITE_ROT_SCALE_ENABLE;
  b->icon.frameFlags &= ~SPRITE_ROT_SCALE_ENABLE;
}

static int run(ActTask *t);

// Task_801C420: a new item from the shared random numbers, and the box starts to grow
static int appear(MysteryBox *b) {
  b->item = (int)(hunt.random % 4u);
  b->vy = 0; b->dy = 0; b->n = 0;
  b->icon.graphics.anim = ANIM_ICON;
  b->icon.variant = ICONS[b->item];
  update_sprite(&b->icon, 0);
  set_scaled(b, 0);
  b->phase = APPEARING;
  return 1;
}

static int run(ActTask *t) {
  MysteryBox *b = (MysteryBox *)t->data;
  Slot *slot = b->o.slot;
  Entity *en = &slot->e;
  Player *p = &act.player;
  int x = en->x, y = en->y;
  switch (b->phase) {
    case WAITING:   // Task_MysteryItemBox_Main1: unseen until its turn comes and its count catches up
      if (en->d[0] == turn() && en->d[1] <= generation()) {
        en->d[1] = generation();
        b->phase = APPEAR;
        return 1;
      }
      if ((uint32_t)(x - cam_x() + 0x80) > DISPLAY_WIDTH + 256u || y - cam_y() + 0x80 < 0 || y - cam_y() > DISPLAY_HEIGHT + 208) return 0;
      return 1;
    case APPEAR:   // Task_801C420, on the next frame
      appear(b);
      return run(t);
    case APPEARING:   // Task_801C4EC: it grows from nothing to its full height, 8/256 of it a frame
      b->tf.qScaleY = (int16_t)(b->tf.qScaleY + GROW);
      if (b->tf.qScaleY < 0x100) { draw_scaled(b, x, y); return 1; }
      set_plain(b);
      b->tf.qScaleY = 0x100;
      b->phase = SHOWN;
      return run(t);
    case VANISHING:   // sub_801C5C4: it shrinks away, then waits unseen
      b->tf.qScaleY = (int16_t)(b->tf.qScaleY - GROW);
      if (b->tf.qScaleY > 0) { draw_scaled(b, x, y); return 1; }
      set_plain(b);
      b->tf.qScaleY = 0x100;
      b->phase = WAITING;
      return run(t);
    case OPENING:   // sub_801C130: broken by this player, the icon rises and then gives its item
      b->dy--;
      if (++b->n > RISE_FRAMES - 1) {
        if (b->item == 1) chaohunt_send_event(6, 1, 0, 0, 0);
        else if (b->item == 2) { hunt.itemEffect |= 0x20; hunt.invisibleTimer = INVISIBLE_TIME; }
        else chaohunt_send_event(6, 0, 0, 0, 0);
        b->phase = HELD; b->n = 0;
      }
      object_draw(&b->icon, x, y + b->dy);
      return 1;
    case RISING:   // Task_801C2FC: broken by another player, the icon rises and gives nothing
      b->dy--;
      if (++b->n >= RISE_FRAMES) { b->phase = HELD; b->n = 0; }
      object_draw(&b->icon, x, y + b->dy);
      return 1;
    case HELD:   // Task_801C3A0: it stays a moment, then waits for its next turn
      if (++b->n > HOLD_FRAMES) { b->phase = WAITING; return 1; }
      object_draw(&b->icon, x, y + b->dy);
      return 1;
  }
  // Task_MysteryItemBox_Main0
  if (en->d[0] != turn()) {
    let_go(b);
    set_scaled(b, 0x100);
    b->phase = VANISHING;
    return run(t);
  }
  if (en->d[1] > generation()) {
    // another player broke it
    play_song(SE_ITEM_BOX_BREAK);
    dust_cloud(x, y + b->dy);
    b->phase = RISING; b->n = 0;
    let_go(b);
    return 1;
  }
  if (b->n) {
    b->dy += b->vy >> 8; b->vy += HOP_GRAVITY;
    int d = terrain_tile_floor(x, y + b->dy, 1, 8);
    if (d < 0) { b->dy += d; b->n = 0; }
  }
  const Hitbox *box = object_box(&b->o.sprite, 0);
  if (!p->carried) {
    uint32_t res;
    if (p->onObject == &b->o || !object_box(&p->sprite, 1)) {
      res = (uint32_t)collide_platform(&b->o, x, y + b->dy, box, p);
      if (res & COLLIDE_FROM_BELOW) { b->vy = HOP_SPEED; b->n = 0xFF; }
    } else {
      res = (uint32_t)collide_item_box(x, y + b->dy, box, p);
      if (res & COLLIDE_FROM_BELOW) { b->vy = HOP_SPEED; b->n = 0xFF; }
      else if (res & (COLLIDE_LANDED | COLLIDE_PUSHING)) {
        if (p->onObject == &b->o) { p->onObject = NULL; p->pushing = 0; p->air = 1; }
        play_song(SE_ITEM_BOX_BREAK);
        dust_cloud(x, y + b->dy);
        b->phase = OPENING; b->n = 0;
        en->d[1] = (en->d[1] + 1) & 0xFF;
        chaohunt_send_event(5, slot->regionX, slot->regionY, slot->id, en->d[1]);
        return 1;
      }
    }
    b->lastHit = res;
  }
  // the offset counts twice, as on the item boxes
  int sx = x - cam_x(), sy = y - cam_y() + b->dy;
  if ((uint16_t)(sx + 128) > DISPLAY_WIDTH + 256u || sy + 128 + b->dy < 0 || sy + b->dy > DISPLAY_HEIGHT + 128) return 0;
  object_draw(&b->o.sprite, x, y + b->dy);
  object_draw(&b->icon, x, y + b->dy);
  return 1;
}

static void end(ActTask *t) {
  MysteryBox *b = (MysteryBox *)t->data;
  object_sprite_free(&b->icon);
  object_end(t);
}

/** CreateEntity_MysteryItemBox: shown at once on its turn, else waiting. */
ActTask *mystery_box_spawn(Slot *slot) {
  if (!chaohunt_active()) return NULL;
  MysteryBox *b = OBJECT_NEW(MysteryBox);
  if (!b) return NULL;
  Entity *en = &slot->e;
  b->phase = turn() == en->d[0] && en->d[1] <= generation() ? SHOWN : WAITING;
  if (en->d[1] <= generation()) en->d[1] = generation();
  b->o.slot = slot;
  b->o.x = en->x;
  b->item = (int)(hunt.random % 4u);
  object_sprite(&b->o.sprite, ANIM_ITEM_BOX, 0, 0, ORDER_BOX, PRIORITY_FRONT, 0, 0);
  object_sprite(&b->icon, ANIM_ICON, 13, 16, ORDER_ICON, PRIORITY_FRONT, 0, 0);
  b->icon.variant = ICONS[b->item];
  sprite_step(&b->o.sprite);
  sprite_step(&b->icon);
  ActTask *t = act_task_add(run, end, b, PRIORITY_OBJECTS);
  if (!t) end(&(ActTask){ .data = b });
  return t;
}
