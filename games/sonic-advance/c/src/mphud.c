// What a round shows over the stage, translated from the JavaScript version's engine/mphud.js with SAT-R's
// src/game/shared/stage/mp_indicators.c and src/game/sa1/stage/mp_hud.c: the arrow at the screen's edge toward each other
// player off screen.

#include "objects.h"
#include "chaohunt.h"

enum { ANIM_INDICATOR = 767, INDICATOR_TILES = OBJ_VRAM + 0x2500 };

typedef struct { int made, id; Sprite s; Transform tf; } Indicator;
static Indicator indicators[PLAYERS_MAX];

static int sin_1024(int a) { return SINE[a & 1023] >> 6; }
static int cos_1024(int a) { return SINE[(a + 256) & 1023] >> 6; }
// Div(SIN_24_8(a) * 256, COS_24_8(a)) as an s16
static int16_t slope(int a) { return (int16_t)bios_div(sin_1024(a) * 256, cos_1024(a)); }

/** CreateOpponentPositionIndicator: the arrow toward player `id`, in that player's character's colours. */
void mp_indicator_create(int id) {
  Indicator *k = &indicators[id];
  memset(k, 0, sizeof *k);
  k->made = 1; k->id = id;
  Sprite *s = &k->s;
  sprite_init(s);
  s->graphics.dest = INDICATOR_TILES;
  s->oamFlags = 1 << 6;
  s->graphics.size = 0;
  s->animCursor = 0;
  s->qAnimDelay = 0;
  s->prevVariant = 0xFF;
  s->animSpeed = 0x10;
  s->palId = ctx.vsLink.characters[id] & 3;
  s->hitboxes[0].index = -1;
  s->frameFlags = SPRITE_KEEP_PALETTE | SPRITE_ROT_SCALE_ENABLE | SPRITE_DOUBLE_SIZE;
  s->graphics.anim = ANIM_INDICATOR;
  s->variant = 0;
  k->tf.qScaleX = 0x100; k->tf.qScaleY = 0x100; k->tf.rotation = 0;
}

// Task_801951C: at the screen's edge where the line from its middle to the player leaves it, pointing at them, larger the
// nearer they are and animated faster within 256 px
static void indicator_task(Indicator *k) {
  const MpPlayer *m = &mpPlayers[k->id];
  Sprite *s = &k->s;
  int camX = (int)act.cam.x, camY = (int)act.cam.y;
  if (m->x - camX >= 0 && m->x - camX <= SCREEN_W && m->y - camY >= 0 && m->y - camY <= SCREEN_H) return;
  int16_t tx = (int16_t)(m->x - SCREEN_W / 2 - camX), ty = (int16_t)(m->y - SCREEN_H / 2 - camY);
  int16_t r1 = tx, r4 = ty, rot, x, y;
  if (tx != 0 && ty != 0) {
    while (r1 >= 128 || r1 <= -128 || r4 >= 128 || r4 <= -128) {
      r1 = (int16_t)(r1 / 2); r4 = (int16_t)(r4 / 2);
      if (r1 < 2 && r1 > -2) break;
      if (r4 < 2 && r4 > -2) break;
    }
  }
  if (r1 < 2 && r1 > -2) rot = r4 > 0 ? 256 : 768;
  else if (r4 < 2 && r4 > -2) rot = r1 > 0 ? 0 : 512;
  else rot = (int16_t)quick_angle(r4, r1);
  k->tf.rotation = (uint16_t)((rot + 256) & 1023);
  int32_t d = tx * tx + ty * ty;
  s->animSpeed = d < 0x10000 ? 0x18 : 0x10;
  int scale;
  if (d > 0x06000000) scale = 0x40;
  else if (d < 0x10000) scale = 0x1E0;
  else scale = bios_div(((0x06000000 - d) >> 16) * 0x1A0, 0x5FF) + 0x40;
  k->tf.qScaleX = (int16_t)scale; k->tf.qScaleY = (int16_t)scale;
  if (rot == 0) { y = SCREEN_H / 2; x = SCREEN_W; }
  else if (rot == 256) { y = SCREEN_H; x = SCREEN_W / 2; }
  else if (rot == 512) { y = SCREEN_H / 2; x = 0; }
  else if (rot == 768) { y = 0; x = SCREEN_W / 2; }
  else if (tx > 0) {
    y = (int16_t)(((slope(rot) * 15) >> 5) + SCREEN_H / 2);
    if (ty > 0) {
      if (y >= SCREEN_H) { y = SCREEN_H; x = (int16_t)(((slope((256 - rot) & 1023) * 5) >> 4) + SCREEN_W / 2); }
      else x = SCREEN_W;
    } else if (y < 0) { y = 0; x = (int16_t)(SCREEN_W / 2 - ((slope((256 - rot) & 1023) * 5) >> 4)); }
    else x = SCREEN_W;
  } else {
    y = (int16_t)(SCREEN_H / 2 - ((slope((rot - 512) & 1023) * 15) >> 5));
    if (ty > 0) {
      if (y >= SCREEN_H) { y = SCREEN_H; x = (int16_t)(((slope((768 - rot) & 1023) * 5) >> 4) + SCREEN_W / 2); }
      else x = 0;
    } else if (y < 0) { y = 0; x = (int16_t)(SCREEN_W / 2 - ((slope((768 - rot) & 1023) * 5) >> 4)); }
    else x = 0;
  }
  k->tf.x = x; k->tf.y = y;
  s->frameFlags &= ~SPRITE_ROT_SCALE;
  s->frameFlags |= (uint32_t)mp_next_matrix();
  update_sprite(s, 0);
  transform_sprite(s, &k->tf);
  display_sprite(s);
}

/** The arrows' tasks (0x2001), after the players'. */
void mp_indicators_run(void) {
  for (int i = 0; i < PLAYERS_MAX; i++) if (indicators[i].made) indicator_task(&indicators[i]);
}

void mp_indicators_stop(void) { memset(indicators, 0, sizeof indicators); }
