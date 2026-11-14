// The players as the multiplayer modes see them, translated from the JavaScript version's engine/mpplayer.js with the
// SA1 Task_CreateMultiplayerPlayer and CreateMultiplayerPlayer of SAT-R's src/game/shared/stage/mp_player.c. Each GBA has
// one of these tasks for every player on the link, its own among them, and draws every player, itself too, from the
// packets the link brings it: where they were two frames ago, the animation they showed, and how they were flipped,
// turned and layered. Sonic's own sprite isn't drawn in these modes (act.c), and the packet he sends is written at the
// end of his frame (sub_8024B10, mp_send).

#include "objects.h"
#include "chaohunt.h"

enum { STALE = 30, LINK_TIMEOUT = 30, KIND_STAGE = 0x1000 };

MpPlayer mpPlayers[PLAYERS_MAX];
static int matrixFrame = -1, matrixIndex;

static int16_t s16_at(const uint8_t *p) { return (int16_t)(p[0] | p[1] << 8); }
static uint16_t u16_at(const uint8_t *p) { return (uint16_t)(p[0] | p[1] << 8); }

// gOamMatrixIndex: the rotation matrices the players drawn turned take, one after another in a frame, after Sonic's
int mp_next_matrix(void) {
  if (matrixFrame != act_stage_time()) { matrixFrame = act_stage_time(); matrixIndex = 0; }
  return matrixIndex++;
}

// what a packet of kind 0x1000 says about its player (MultiSioData_0_4)
static void receive(MpPlayer *m, const uint8_t *r) {
  Sprite *s = &m->s;
  m->missed = 0;
  int x = s16_at(r + 2), y = s16_at(r + 4);
  m->dx = x - m->x; m->dy = y - m->y;
  m->x = x; m->y = y;
  if (m->dx > 0x40 || m->dx < -0x40 || m->dy > 0x40 || m->dy < -0x40) { m->qvx = 0; m->qvy = 0; }
  else { m->qvx = (int16_t)(m->dx << 8); m->qvy = (int16_t)(m->dy << 8); }
  m->items = r[0xA];
  m->flags = u16_at(r + 8);
  if (m->id != hunt.id) m->standsOn = (m->flags & 0x600) >> 9;
  // Chao Hunt: the animation, and the Chao the player carries in its top bits
  uint16_t word = u16_at(r + 6);
  uint16_t anim = word & 0x3FF;
  if (m->id != hunt.id) m->state |= (uint32_t)(word >> 12) << 16;
  int n = 0;
  for (int k = 0; k < 3; k++) if (m->state & (0x10000u << k)) n++;
  hunt.charRings[m->id] = n;
  uint8_t variant = r[0xB] & 7;
  if (s->graphics.anim != anim || s->variant != variant) { s->hitboxes[0].index = -1; s->hitboxes[1].index = -1; }
  s->graphics.anim = anim;
  s->variant = variant;
  m->offsetY = (int8_t)r[0xB] >> 3;
  s->animSpeed = r[0xC];
  m->tf.rotation = (uint16_t)(r[0xD] * 4);
}

// Task_CreateMultiplayerPlayer
static void player_task(MpPlayer *m) {
  Sprite *s = &m->s;
  const uint8_t *r = link_slot(m->id);
  if (r) m->missed = 0;
  if (r && packet_kind(r) == KIND_STAGE) receive(m, r);
  else {
    m->x += m->qvx >> 8;
    m->y += m->qvy >> 8;
    m->missed++;   // past LINK_TIMEOUT the original stops on its link error screen, which the page never reaches
  }
  int camX = (int)act.cam.x, camY = (int)act.cam.y;
  s->x = (int16_t)(m->x - camX); s->y = (int16_t)(m->y - camY);
  m->tf.x = s->x; m->tf.y = s->y;
  if (m->flags & 0x800) { s->prevVariant = 0xFF; s->hitboxes[0].index = -1; s->hitboxes[1].index = -1; }
  update_sprite(s, 0);

  // how it is drawn: through the rotation hardware, mirrored by a negative scale, or flipped
  if (m->flags & 1) {
    s->frameFlags &= ~SPRITE_ROT_SCALE;
    s->frameFlags |= (uint32_t)(mp_next_matrix() | SPRITE_ROT_SCALE_ENABLE);
    m->tf.qScaleX = (m->flags & 2) ? -0x100 : 0x100;
    if (m->flags & 8) m->tf.qScaleX = (int16_t)-m->tf.qScaleX;
    transform_sprite(s, &m->tf);
  } else {
    s->frameFlags &= ~SPRITE_ROT_SCALE_ENABLE;
    if (m->flags & 2) s->frameFlags |= SPRITE_X_FLIP; else s->frameFlags &= ~SPRITE_X_FLIP;
    if (m->flags & 8) s->frameFlags |= SPRITE_Y_FLIP; else s->frameFlags &= ~SPRITE_Y_FLIP;
  }
  s->frameFlags &= ~SPRITE_PRIORITY;
  s->frameFlags |= (uint32_t)((m->flags & 0x30) >> 4) << 12;
  if (m->flags & 0x40) return;
  // blinking while untouchable, and every other two frames until the title card ends
  if ((act_stage_time() & 2) || (m->items & 0x20) || (m->state & 1) || hunt.ranks[m->id] != -1
      || (m->wait == 0 && !(m->flags & 4) && !(m->state & 2))) {
    s->oamFlags = (m->flags & 0x80) ? 0x440 : 0x400;
    s->frameFlags &= ~SPRITE_OBJ_MODE;
    display_sprite(s);
  }
}

/** CreateMultiplayerPlayer: player `id`'s task, starting where this GBA's own player starts until its packets come. */
void mp_player_create(int id, int x, int y) {
  MpPlayer *m = &mpPlayers[id];
  memset(m, 0, sizeof *m);
  m->id = id;
  m->wait = id != hunt.id ? STALE : 0;
  m->items = 0x80;
  m->standsOn = id;
  m->state = 2;
  m->x = x; m->y = y;
  Sprite *s = &m->s;
  sprite_init(s);
  // the others' tiles come from the heap; this GBA's own player shares Sonic's, at the start of the sprites' memory
  s->graphics.dest = id != hunt.id ? vram_malloc(64) : OBJ_VRAM;
  s->oamFlags = 0x400;
  s->graphics.size = 0;
  s->animCursor = 0;
  s->qAnimDelay = 0;
  s->prevVariant = 0xFF;
  s->animSpeed = 0x10;
  s->palId = 0;
  s->hitboxes[0].index = -1;
  s->frameFlags = 2 << 12;
  s->graphics.anim = 0;
  s->variant = 0;
  m->tf.qScaleY = 0x100;
  m->made = 1;
}

/** The players' tasks (0x2000), which the act runs before the title card's (0x2100) and Sonic's (0x3000). */
void mp_players_run(void) {
  for (int i = 0; i < PLAYERS_MAX; i++) if (mpPlayers[i].made) player_task(&mpPlayers[i]);
  mp_indicators_run();
}

/** The round is over: the players' tasks go with the stage's. */
void mp_players_stop(void) { memset(mpPlayers, 0, sizeof mpPlayers); mp_indicators_stop(); }

/**
 * sub_8024B10's packet, at the end of Sonic's frame: where he is and how he looks, with the items he has. `fresh` is
 * whether his sprite's animation started over this frame (its prevVariant was 0xFF before the update).
 */
void mp_send(const Player *p, int fresh) {
  uint8_t *send = link_send();
  const Sprite *s = &p->sprite;
  MpPlayer *own = &mpPlayers[hunt.id];
  int x = (int)__builtin_floor(p->x), y = (int)__builtin_floor(p->y);
  uint16_t anim = (uint16_t)(s->graphics.anim | ((own->state & 0x70000) >> 4));
  int rotated = p->state == PS_WALK || p->state == PS_BOUNCE || p->state == PS_MARBLE_TRACK;
  uint16_t flags = (uint16_t)(send[8] | send[9] << 8);
  send[0] = KIND_STAGE & 0xFF; send[1] = KIND_STAGE >> 8;
  send[2] = (uint8_t)x; send[3] = (uint8_t)(x >> 8);
  send[4] = (uint8_t)y; send[5] = (uint8_t)(y >> 8);
  send[6] = (uint8_t)anim; send[7] = (uint8_t)(anim >> 8);
  send[0xA] = (uint8_t)hunt.itemEffect;
  send[0xB] = (uint8_t)(s->variant | (p->offsetY << 3));
  send[0xC] = s->animSpeed;
  send[0xD] = rotated ? (uint8_t)p->rotation : 0;
  flags = rotated ? flags | 1 : flags & ~1;
  flags = p->facing > 0 ? flags | 2 : flags & ~2;
  flags = p->inverted ? flags | 8 : flags & ~8;
  flags = (p->dead || (own->state & 1) || p->invulnerable != 0) ? flags | 4 : flags & ~4;
  flags = (own->state & 1) ? flags | 0x100 : flags & ~0x100;
  flags = p->invisible ? flags | 0x40 : flags & ~0x40;
  flags = (uint16_t)((flags & ~0x30) | ((s->frameFlags & SPRITE_PRIORITY) >> 8));
  flags = p->layer ? flags | 0x80 : flags & ~0x80;
  flags = fresh ? flags | 0x800 : flags & ~0x800;
  own->standsOn = hunt.id;
  for (int i = 0; i < hunt.count; i++)
    if (i != hunt.id && p->onObject == &mpPlayers[i].s) own->standsOn = i;
  flags = (uint16_t)((flags & ~0x600) | own->standsOn << 9);
  send[8] = (uint8_t)flags; send[9] = (uint8_t)(flags >> 8);
}
