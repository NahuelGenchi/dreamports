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

// (the USA copy's numbers: the digits are 905, where the decompilation's copy has 907)
// The HUD (CreateChaoHuntHUD, Task_ChaoHuntHUD), made as the title card ends: the clock, which blinks red in its last minute,
// and each player's Chao count over a backdrop in their character's colours

enum { ANIM_COUNTER_BACKDROP = 606, ANIM_TIMER_DIGITS = 905, SE_TIMER = 139, MINUTE = 3600 };

// the clock's hundredths for each of a second's 60 frames, as two decimal digits (gUnknown_080E0234)
static const uint8_t HUNDREDTHS[60] = {
  0, 2, 3, 5, 7, 8, 16, 18, 19, 21, 23, 24, 32, 34, 35, 37, 39, 40, 48, 50, 51, 53, 55, 56, 64, 66, 67, 69, 71, 72,
  80, 82, 83, 85, 87, 88, 96, 98, 99, 101, 103, 104, 112, 114, 115, 117, 119, 120, 128, 130, 131, 133, 135, 136,
  144, 146, 147, 149, 151, 152,
};

static struct { int made; Sprite backdrop, white[11], red[11]; } hud;

// Base10DigitsToHexNibbles
static int bcd(int n) {
  int out = 0, shift = 0;
  while (n > 0 && shift < 32) { out |= (n % 10) << shift; n /= 10; shift += 4; }
  return out;
}

static void hud_sprite(Sprite *s, uint32_t dest, uint16_t oamFlags, uint16_t anim, int variant, uint32_t frameFlags) {
  sprite_init(s);
  s->x = 0; s->y = 0;
  s->graphics.dest = dest;
  s->oamFlags = oamFlags;
  s->graphics.size = 0;
  s->graphics.anim = anim;
  s->variant = (uint8_t)variant;
  s->animCursor = 0;
  s->qAnimDelay = 0;
  s->prevVariant = 0xFF;
  s->animSpeed = 0x10;
  s->palId = 0;
  s->frameFlags = frameFlags;
  update_sprite(s, 0);
}

void mp_hud_create(void) {
  memset(&hud, 0, sizeof hud);
  hud.made = 1;
  hud_sprite(&hud.backdrop, vram_malloc(16), 5 << 6, ANIM_COUNTER_BACKDROP, 0, SPRITE_KEEP_PALETTE);
  hud.backdrop.y = 8;
  uint32_t white = 0, red = 0;
  for (int i = 0; i < 11; i++) {
    if (i == 0) white = vram_malloc(22);
    hud_sprite(&hud.white[i], white + (uint32_t)i * 64, 0x100, ANIM_TIMER_DIGITS, i, 0);
    if (i == 0) red = vram_malloc(22);
    hud_sprite(&hud.red[i], red + (uint32_t)i * 64, 0x100, ANIM_TIMER_DIGITS, i + 11, 0);
  }
}

static void show_at(Sprite *s, int x, int y) { s->x = (int16_t)x; s->y = (int16_t)y; display_sprite(s); }

static void hud_task(void) {
  int t = act.courseTime;
  Sprite *set = t < MINUTE && (t & 2) ? hud.red : hud.white;
  if (!act.clockStopped && t < MINUTE && t % 60 == 0) play_song(SE_TIMER);
  show_at(&set[10], 24, 32);
  show_at(&set[10], 48, 32);
  int seconds = t / 60, hs = HUNDREDTHS[t - seconds * 60];
  show_at(&set[hs >> 4], 56, 32);
  show_at(&set[hs & 0xF], 64, 32);
  int minutes = seconds / 60, ss = bcd(seconds - minutes * 60);
  show_at(&set[(ss >> 4) & 0xF], 32, 32);
  show_at(&set[ss & 0xF], 40, 32);
  show_at(&set[bcd(minutes - minutes / 60 * 60) & 0xF], 16, 32);
  int connections = vs_connections();
  for (int i = 0; i < PLAYERS_MAX; i++) {
    if (!(connections >> i & 1)) break;
    Sprite *b = &hud.backdrop;
    b->x = (int16_t)(i * 20 + 8); b->y = 8;
    b->palId = (uint8_t)(ctx.vsLink.characters[i] & 3);
    display_sprite(b);
    int n = bcd(hunt.charRings[i]);
    if (n >= 0x100) {
      show_at(&hud.white[(n >> 8) & 0xF], b->x + 3, 14);
      show_at(&hud.white[(n >> 4) & 0xF], b->x + 11, 14);
      show_at(&hud.white[n & 0xF], b->x + 19, 14);
    } else if (n >= 0x10) {
      show_at(&hud.white[(n >> 4) & 0xF], b->x + 7, 14);
      show_at(&hud.white[n & 0xF], b->x + 15, 14);
    } else show_at(&hud.white[n & 0xF], b->x + 11, 14);
  }
}

/** The HUD's task (0x2000), made after the players' and so run after them. */
void mp_hud_run(void) { if (hud.made) hud_task(); }
void mp_hud_stop(void) { memset(&hud, 0, sizeof hud); }

// --- the round's end (mp_finish.c): each player's result over their head, then the fade to white -------------------------

enum { ANIM_RESULT = 902, SONG_ROUND_OVER = 304, FINISH_WAIT = 240, FADE_STEP = 0x40, FADE_END = 0x1000 };

static struct { int made; Sprite s; } results[PLAYERS_MAX];
static struct { int made, frame, whitening; } finish;

// CreateMultiplayerFinishResult: in Chao Hunt the variant is the rank (0 won, 1 lost), 2 a draw (rank 4) and 1 for rank 5
static void result_create(int id, int rank) {
  results[id].made = 1;
  hunt.ranks[id] = rank < 6 ? rank : hunt.count - 1;
  Sprite *s = &results[id].s;
  sprite_init(s);
  s->graphics.size = 0;
  s->graphics.anim = ANIM_RESULT;
  s->variant = (uint8_t)(rank == 5 ? 1 : rank == 4 ? 2 : rank);
  s->graphics.dest = vram_malloc(12);
  s->prevVariant = 0xFF;
  s->oamFlags = 0;
  s->qAnimDelay = 0;
  s->animSpeed = 0x10;
  s->palId = 0;
  s->frameFlags = 0;
  update_sprite(s, 0);
}

/** CreateMultiplayerFinishTransition: the round-over sound, and each player's result from the Chao they hold, ties drawn. */
void mp_finish_start(void) {
  memset(&finish, 0, sizeof finish);
  finish.made = 1;
  music_call(MUSIC_OFF, 0);
  play_song(SONG_ROUND_OVER);
  uint8_t order[4] = { 0, 1, 2, 3 }, counts[4] = { 0 };
  for (int i = 0; i < PLAYERS_MAX; i++) counts[i] = (uint8_t)hunt.charRings[i];
  for (int i = 0; i < 4; i++) {
    for (int j = 0; j < 3 - i; j++) {
      if (counts[j] < counts[j + 1]) {
        uint8_t c = counts[j]; counts[j] = counts[j + 1]; counts[j + 1] = c;
        uint8_t o = order[j]; order[j] = order[j + 1]; order[j + 1] = o;
      }
    }
  }
  for (int i = 0; i < 4; i++) {
    if (i != 0) hunt.ranks[order[i]] = counts[i] == counts[0] ? 4 : 1;
    else hunt.ranks[order[0]] = counts[0] == counts[1] ? 4 : 0;
  }
  for (int i = 0; i < PLAYERS_MAX; i++) if (mpPlayers[i].made) result_create(i, hunt.ranks[i] & 0xFF);
}

// Task_DisplayResult (0x2010): over the player, 32 px above (below with gravity turned over)
static void result_task(int id) {
  Sprite *s = &results[id].s;
  const MpPlayer *m = &mpPlayers[id];
  s->x = (int16_t)(m->x - (int)act.cam.x);
  s->y = (int16_t)(m->y - (int)act.cam.y + (act.player.inverted ? 32 : -32));
  display_sprite(s);
}

void mp_results_run(void) {
  for (int i = 0; i < PLAYERS_MAX; i++) if (results[i].made) result_task(i);
}

/**
 * Task_TransitionWaitForResults and Task_TransitionToResultsScreen (0x2000): once this GBA's room events are all out, 241
 * frames more, then the sound fades and the screen whitens over 64 frames. True on the frame the white is complete.
 */
int mp_finish_run(void) {
  if (!finish.made) return 0;
  if (!finish.whitening) {
    if (chaohunt_queue_empty() && finish.frame++ > FINISH_WAIT) {
      for (int player = 0; player < 4; player++) fade_out_sound(player, 4);
      finish.frame = 0;
      finish.whitening = 1;
    }
    return 0;
  }
  finish.frame += FADE_STEP;
  return finish.frame >= FADE_END;
}

/** The blending the transition sets, after the act's picture: lightening all of it, by bldY. */
void mp_finish_display(void) {
  if (!finish.whitening) return;
  e.bldCnt = 0xBF;
  e.bldY = (uint16_t)(finish.frame >= FADE_END ? 0 : finish.frame >> 8);
}

void mp_finish_stop(void) { memset(&finish, 0, sizeof finish); memset(results, 0, sizeof results); }
