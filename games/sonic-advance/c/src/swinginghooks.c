// Secret Base's swinging hooks (kind 76). Translated from the JavaScript version's engine/swinginghooks.js (the original's
// swinging_hook.c): a hook on a chain of three links, hanging from an anchor and swinging to and fro on the stage clock (a hook
// with d0 set swings half a cycle behind). Sonic's centre within 16 px of the hook catches him and he hangs from it as it swings,
// until jump throws him up at 5 px a frame, at 2 px a frame left or right if one is held. It doesn't catch him again for 20
// frames.

#include "objects.h"

enum {
  ANIM_HOOK = 504, VARIANT_HOOK = 1,                          // SA1_ANIM_HOOK_RAIL_2
  ANIM_ANCHOR = 503, VARIANT_LINK = 1, VARIANT_ANCHOR = 2,    // SA1_ANIM_ANCHOR_HANDLES
  ORDER_HOOK = 18, PRIORITY_FRONT = 2,
  MATRIX = 31, MATRIX_BEHIND = 30,   // the rotation matrices of the hooks in step and half a cycle behind
  ANCHOR_UP = 8, LINKS = 3, REACH = 16,
  WAIT = 20,                         // frames after he lets go before it can catch him again (unkB0)
  JUMP = 5, JUMP_X = 2,
};

typedef struct {
  Object o;   // the hook
  Sprite link, anchor;
  int phase, holding, wait;
} Hook;

// gOamMatrixIndex, counted up by each hook's sprite in a frame: the hook puts it in its flags' priority bits, so the first hook
// to run in a frame is drawn at priority 0 and the next at 1, both in front of the layers
static int matrixTick = -1, matrixIndex;
static int next_index(void) {
  if (matrixTick != act_stage_time()) { matrixTick = act_stage_time(); matrixIndex = 0; }
  return matrixIndex++;
}

// Player_TransitionCancelFlyingAndBoost; his speeds and whether he is in the air stay as they were
static void cancel(Player *p) { player_end_attack(p); p->pushing = 0; }

// thrown off it, curled up (it leaving with him, or his jump)
static void let_go(Player *p) {
  cancel(p);
  p->carried = 0; p->air = 1; p->onObject = NULL;
  p->curled = 1; p->state = PS_SPIN;
  player_curl_up(p);
}

static int hook_run(ActTask *t) {
  Hook *h = (Hook *)t->data;
  const Entity *en = &h->o.slot->e;
  Player *p = &act.player;
  Sprite *s = &h->o.sprite;
  int x = en->x, y = en->y;
  // the swing at the stage clock: the angle the chain makes (sine and cosine, 1 = 16384, the cosine with a slight lean added,
  // which the decompilation's C adds to both) and the hook's rotation
  int m = (act_stage_time() * 8 / 3 + h->phase) % 512, lean;
  if (m > 256) { m = 512 - m; lean = SINE[m * 2] >> 8; } else lean = -(SINE[m * 2] >> 8);
  m = (SINE[((m - 0x7E) & 0x1FF) * 2] >> 7) & 0x1FF;
  m = m < 256 ? m >> 1 : 512 - ((512 - m) >> 1);
  m = (m << 1) & 0x3FF;
  int sin = SINE[m], cos = SINE[m + 256] + lean;
  if (off_display(x, y) && off_cam(x, y)) {
    if (p->onObject == &h->o) { let_go(p); p->xsp = p->gsp = p->ysp = 0; }
    return 0;
  }
  object_draw(&h->anchor, x, y - ANCHOR_UP);
  int dx = 0, dy = 0;
  for (int i = 0; i < LINKS; i++) {
    dx += sin * 90 / 100; dy += cos * 90 / 100;
    object_draw(&h->link, x + (dx >> 10), y + (dy >> 10));
  }
  dx += sin * 110 / 100; dy += cos * 110 / 100;

  if (p->dead) {
    if (h->holding) { p->carried = 0; h->wait = WAIT; h->holding = 0; }
  } else if (h->holding) {
    p->x = x + dx / 780 - 4 + (p->facing < 0 ? 10 : 0);
    p->y = y + dy / 680 + 2;
    p->rotation = 0;
    if (p->jumpPressed) {
      let_go(p);
      p->jumped = 1;
      p->ysp = -JUMP;
      int held = p->held[0];
      if (held & (DPAD_LEFT | DPAD_RIGHT)) {
        p->facing = held & DPAD_LEFT ? -1 : 1;
        p->xsp = p->gsp = JUMP_X * p->facing;
      } else p->xsp = p->gsp = 0;
      h->wait = WAIT; h->holding = 0;
    } else p->ysp = 0;
  } else if (h->wait) h->wait--;
  else {
    int hx = x + dx / 950, hy = y + dy / 950, px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y);
    if (hx - REACH <= px && hx + REACH >= px && hy - REACH <= py && hy + REACH >= py) {
      h->holding = 1;
      cancel(p);
      p->onObject = &h->o; p->carried = 1;
      p->xsp = p->gsp = p->ysp = 0;
      p->state = PS_HOOK;
    }
  }

  // the hook turned with the chain; the original turns it by the frame it showed before stepping its animation, so on its first
  // frame it stays where it was made, and it shows it twice
  Transform tf = { (uint16_t)(0x3FF & ~m), 256, 256, (int16_t)(x - cam_x() + (dx >> 10)), (int16_t)(y - cam_y() + (dy >> 10)) };
  s->frameFlags = (uint32_t)(next_index() & 3) << 12 | (h->phase ? MATRIX_BEHIND : MATRIX) | SPRITE_ROT_SCALE_ENABLE | SPRITE_DOUBLE_SIZE;
  transform_sprite(s, &tf);
  sprite_step(s);
  if (objects_drawing()) { display_sprite(s); display_sprite(s); }
  return 1;
}

static void hook_end(ActTask *t) {
  Hook *h = (Hook *)t->data;
  object_sprite_free(&h->link);
  object_sprite_free(&h->anchor);
  object_end(t);
}

// CreateEntity_SwingingHook
ActTask *swinging_hook_spawn(Slot *slot) {
  Hook *h = OBJECT_NEW(Hook);
  if (!h) return NULL;
  h->o.slot = slot;
  h->o.x = slot->e.x;
  h->phase = slot->e.d[0] != 0 ? 0x100 : 0;
  object_sprite(&h->o.sprite, ANIM_HOOK, VARIANT_HOOK, VARIANT_HOOK, ORDER_HOOK, PRIORITY_FRONT, 0, 0);
  h->o.sprite.x = (int16_t)(slot->e.x - cam_x());
  h->o.sprite.y = (int16_t)(slot->e.y - cam_y());
  object_sprite(&h->anchor, ANIM_ANCHOR, VARIANT_ANCHOR, VARIANT_ANCHOR, ORDER_HOOK, PRIORITY_FRONT, 0, 0);
  object_sprite(&h->link, ANIM_ANCHOR, VARIANT_LINK, VARIANT_LINK, ORDER_HOOK, PRIORITY_FRONT, 0, 0);
  sprite_step(&h->anchor);
  sprite_step(&h->link);
  ActTask *t = object_task(&h->o, hook_run, PRIORITY_OBJECTS);
  if (!t) { object_sprite_free(&h->link); object_sprite_free(&h->anchor); }
  else t->end = hook_end;
  return t;
}
