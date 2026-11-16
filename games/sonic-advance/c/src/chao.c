// The Chao of Chao Hunt, translated from the JavaScript version's engine/chao.js with SAT-R's src/game/sa1/stage/mp_chao.c
// (CreateMultiplayerChao and its tasks). Chao Hunt has one, made at the stage's start 16 px above one of its stage's eight
// places. It sits there until a player's body box touches its box; it then hovers by that player's head, 20 px behind them
// and 28 px up, bobbing, moving there at up to 2 px a frame, and turning to the front when it catches up with a bored
// player. When another player takes it (a knock, mpplayer.c, or the room event saying so, chaohunt.c) it jumps off in
// shock, falls to the ground, lands and goes over to its new player. It sees each player as their task does: as that
// player's GBA sent them two frames ago.
//
// Team play's other two Chao (Task_8028518 and Task_80286B0) aren't in C yet.

#include "objects.h"
#include "terrain.h"
#include "chaohunt.h"

enum {
  ANIM_SHOCKED = 698, ANIM_HOVER = 699, ANIM_DIAGONAL_R = 702, ANIM_TURN = 703, ANIM_SITTING = 704, SE_CHAO_HUH = 163,
  ABOVE = 16, BEHIND = 20, HEAD = 28, MAX_STEP = 0x200, JUMP_X = 0x180, JUMP_Y = 0x300, FALL = 0x28,
  // a character's own animations from its idle one (gPlayerCharacterIdleAnims): the bored one is the next
  CHAR_ANIM_BORED = 1,
};
static const uint16_t IDLE_ANIMS[4] = { 0, 99, 199, 298 };
enum { SITTING, FOLLOWING, FALLING, LANDING };

// the Chao's eight places in each multiplayer stage (sChaoSpawnPositions)
static const int16_t PLACES[4][8][2] = {
  { { 906, 290 }, { 1250, 267 }, { 1348, 700 }, { 1054, 843 }, { 753, 889 }, { 475, 554 }, { 475, 1035 }, { 1740, 215 } },
  { { 817, 483 }, { 817, 815 }, { 1400, 286 }, { 1177, 864 }, { 1506, 579 }, { 404, 480 }, { 1594, 1009 }, { 1029, 482 } },
  { { 458, 192 }, { 447, 578 }, { 534, 864 }, { 332, 1248 }, { 1023, 1250 }, { 433, 1536 }, { 410, 1728 }, { 650, 1728 } },
  { { 633, 335 }, { 1289, 335 }, { 722, 576 }, { 1162, 576 }, { 945, 960 }, { 706, 1057 }, { 1219, 1057 }, { 1009, 1008 } },
};

typedef struct {
  int made, started, id, phase;
  int playerA, playerB;   // whom it goes to, and whom it is with (0xFF for nobody)
  int32_t qx, qy, vx, vy;
  Sprite s;
} Chao;
static Chao chao;

static void show(Chao *c, int dy) {
  c->s.x = (int16_t)((c->qx >> 8) - (int)act.cam.x);
  c->s.y = (int16_t)((c->qy >> 8) - dy - (int)act.cam.y);
}

/** CreateMultiplayerChao: Chao `id` at `place` of the stage's eight. */
void mp_chao_create(int place, int id) {
  Chao *c = &chao;
  memset(c, 0, sizeof *c);
  c->made = 1; c->id = id; c->phase = SITTING;
  Sprite *s = &c->s;
  sprite_init(s);
  s->frameFlags = 2 << 12;
  int stage = act.stage.level - LEVEL_CHAO_HUNT_A, x = PLACES[stage][place & 7][0], y = PLACES[stage][place & 7][1];
  // on Chao Hunt D's places 5 to 7 it starts upside down, below its place, on the ceiling
  if (act.stage.level == LEVEL_CHAO_HUNT_D && place > 4) { s->frameFlags |= SPRITE_Y_FLIP; y += ABOVE; }
  else y -= ABOVE;
  c->playerA = c->playerB = 0xFF;
  c->qx = x << 8; c->qy = y << 8;
  show(c, 0);
  s->graphics.dest = vram_malloc((uint32_t)sprite_tiles(ANIM_SITTING, 0, 0));
  s->oamFlags = (uint16_t)((16 - id) << 6);
  s->graphics.size = 0;
  s->graphics.anim = ANIM_SITTING;
  s->variant = 0;
  s->animCursor = 0;
  s->qAnimDelay = 0;
  s->prevVariant = 0xFF;
  s->animSpeed = 0x10;
  s->palId = 0;
}

/** Who holds the Chao, 0xFF for nobody; and its being taken by player `id`. */
int mp_chao_holder(void) { return chao.made ? chao.playerA : 0xFF; }
void mp_chao_take(int id) { chao.playerA = id; }

// UpdateChaoPosition: toward (x, y) by up to 2 px along the angle the sprite code finds, facing its way; true once there
static int move_to(Chao *c, int x, int y) {
  const MpPlayer *m = &mpPlayers[c->playerA];
  int16_t dx = (int16_t)(x - (c->qx >> 8)), dy = (int16_t)(y - (c->qy >> 8));
  if (dx > 0 || (dx == 0 && (m->o.sprite.frameFlags & SPRITE_X_FLIP))) c->s.frameFlags |= SPRITE_X_FLIP;
  else c->s.frameFlags &= ~SPRITE_X_FLIP;
  if (dx == 0 && dy == 0) return 1;
  int16_t ux = dx, uy = dy;
  if (dx != 0 && dy != 0) {
    while (ux > 0x7F || ux < -0x7F || uy > 0x7F || uy < -0x7F) {
      ux = (int16_t)(ux / 2); uy = (int16_t)(uy / 2);
      if ((ux <= 1 && ux >= -1) || (uy <= 1 && uy >= -1)) break;
    }
  }
  int angle;
  int smallX = ux <= 1 && ux >= -1, smallY = uy <= 1 && uy >= -1;
  if (smallX && !smallY) angle = uy > 0 ? 256 : 768;
  else if (smallY && !smallX) angle = ux > 0 ? 0 : 512;
  else angle = (uint16_t)quick_angle(uy, ux);
  int dist = gba_sqrt((uint32_t)(dx * dx + dy * dy)) << 8;
  if (dist > MAX_STEP) dist = MAX_STEP;
  else if (dist == 0) dist = 1;
  c->qx += (dist * SINE[(angle + 256) & 1023]) >> 14;
  c->qy += (dist * SINE[angle & 1023]) >> 14;
  return 0;
}

// sub_802888C: it jumps away from the way it faces, and isn't drawn on this frame
static void jump_off(Chao *c) {
  const MpPlayer *m = &mpPlayers[c->playerA];
  c->vx = (c->s.frameFlags & SPRITE_X_FLIP) ? -JUMP_X : JUMP_X;
  c->vy = (m->o.sprite.frameFlags & SPRITE_Y_FLIP) ? JUMP_Y : -JUMP_Y;
  c->s.graphics.anim = ANIM_SHOCKED; c->s.variant = 0;
  c->phase = FALLING;
}

// Task_802816C: sitting, until a player's body box touches it (each player's box as it last was, set or not)
static void sitting(Chao *c) {
  Sprite *s = &c->s;
  s->graphics.anim = ANIM_SITTING; s->variant = 0;
  update_sprite(s, 0);
  if (c->playerA != 0xFF) { c->playerB = c->playerA; c->phase = FOLLOWING; }
  else {
    for (int pid = 0; pid < PLAYERS_MAX && mpPlayers[pid].made; pid++) {
      MpPlayer *m = &mpPlayers[pid];
      if (m->flags & 4) continue;
      if (!collide_overlap(c->qx >> 8, c->qy >> 8, &s->hitboxes[0], m->x, m->y, &m->o.sprite.hitboxes[0])) continue;
      m->state |= 0x10000u << c->id;
      c->playerA = c->playerB = pid;
      c->phase = FOLLOWING;
      play_song(SE_CHAO_HUH);
      break;
    }
  }
  show(c, 0);
  display_sprite(s);
}

// Task_8028388: by its player's head, bobbing
static void following(Chao *c) {
  if (c->playerA != c->playerB) { c->playerB = c->playerA; jump_off(c); return; }
  const MpPlayer *m = &mpPlayers[c->playerA];
  Sprite *s = &c->s;
  uint32_t angle = (uint32_t)act_stage_time() * 16;
  int theta;
  uint16_t y;
  if (m->o.sprite.frameFlags & SPRITE_Y_FLIP) { s->frameFlags |= SPRITE_Y_FLIP; y = (uint16_t)(m->y + HEAD); theta = (int)((angle + 0x200) & 0x3FF); }
  else { s->frameFlags &= ~SPRITE_Y_FLIP; y = (uint16_t)(m->y - HEAD); theta = (int)(angle & 0x3FF); }
  uint16_t x = (uint16_t)((m->o.sprite.frameFlags & SPRITE_X_FLIP) ? m->x - BEHIND : m->x + BEHIND);
  if ((int16_t)x == (c->qx >> 8)) {
    int charAnim = m->o.sprite.graphics.anim - (int16_t)IDLE_ANIMS[ctx.vsLink.characters[m->id] & 3];
    s->graphics.anim = charAnim == CHAR_ANIM_BORED ? ANIM_TURN : ANIM_DIAGONAL_R;
  } else s->graphics.anim = ANIM_HOVER;
  s->variant = 0;
  move_to(c, (int16_t)x, (int16_t)y);
  show(c, SINE[theta] >> 11);
  update_sprite(s, 0);
  display_sprite(s);
}

// sub_8028910: falling until the floor under its centre stops it
static void falling(Chao *c) {
  const MpPlayer *m = &mpPlayers[c->playerA];
  Sprite *s = &c->s;
  int up = (m->o.sprite.frameFlags & SPRITE_Y_FLIP) != 0;
  c->vy += up ? -FALL : FALL;
  c->qx += c->vx; c->qy += c->vy;
  int res = terrain_tile_floor(c->qx >> 8, c->qy >> 8, (m->flags >> 7) & 1, up ? -8 : 8);
  if (res < 0) {
    c->qy += up ? -(res << 8) : res << 8;
    s->graphics.anim = ANIM_SHOCKED; s->variant = 2;
    c->phase = LANDING;
  }
  show(c, 0);
  update_sprite(s, 0);
  display_sprite(s);
}

// Task_8028A1C: the landing plays out, its animation stepped twice a frame
static void landing(Chao *c) {
  Sprite *s = &c->s;
  show(c, 0);
  if (!update_sprite(s, 0)) c->phase = c->playerA != 0xFF ? FOLLOWING : SITTING;
  update_sprite(s, 0);
  display_sprite(s);
}

/** The Chao's task (0x2000), after the players'. */
void mp_chao_run(void) {
  Chao *c = &chao;
  if (!c->made) return;
  // made in the stage init, its task first runs on the frame after
  if (!c->started) { c->started = 1; return; }
  switch (c->phase) {
    case SITTING: sitting(c); break;
    case FOLLOWING: following(c); break;
    case FALLING: falling(c); break;
    case LANDING: landing(c); break;
  }
}

void mp_chao_stop(void) { memset(&chao, 0, sizeof chao); }
