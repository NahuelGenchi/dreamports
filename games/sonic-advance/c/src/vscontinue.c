// The VS continue screen, translated from the JavaScript version's front/continuescreen.js (SAT-R's
// src/game/sa1/ui/multiplayer_continue_screen.c: CreateMultiplayerContinueScreen and its tasks): after a round's results,
// the first GBA, the parent, picks with Left and Right whether the players go on to play another round or stop, and A once
// every other GBA has answered. The others wait with a "please wait" text in the middle and follow the choice. Going on
// leads back to the game choice (gameselect.c); stopping closes the link, which the lobby's closed-link mode shows
// (lobby.c) before the title screen.
//
// The GBAs tell each other over the link: 0xA0 with the choice they show (0 go on, 1 stop), and 0xA1 from the parent once
// it has pressed A, which the others answer with the same choice shown.

#include "sa.h"
#include "chaohunt.h"

// the USA copy's numbers, and its tables at 0x08684648 (the decompilation's gUnknown_0868B76C to gUnknown_0868B790): the
// three texts, each in Japanese and English, and their tiles, variants and places; the marker's x for each choice; the
// choice's own text, and its variants
static const uint16_t TEXT_ANIM[3][2] = { { 890, 889 }, { 890, 889 }, { 890, 889 } };
static const uint8_t TEXT_VARIANT[3][2] = { { 1, 1 }, { 2, 2 }, { 3, 3 } }, TEXT_TILES[3] = { 0x2A, 0xC, 0xC };
static const uint8_t TEXT_AT[3][2] = { { 120, 33 }, { 49, 73 }, { 191, 73 } }, MARKER_X[2] = { 23, 165 };
static const uint16_t ANIM_CHOICE[2] = { 886, 886 };
static const uint8_t VARIANT_CHOICE[2] = { 2, 1 };
enum { ANIM_MARKER = 858, ANIM_WAIT = 903, TILEMAP = 0x50, SONG_VS_CONTINUE = 155, CHOOSING = 0xA0, CHOSEN = 0xA1, SETTLE = 120 };

static struct {
  Background bg;
  Sprite texts[3], marker, choice, wait;
  Fade fade;
  int choosing, frames, chosen;   // unk16C, unk16E, unk170
} screen;

static void sprite_at(Sprite *s, uint16_t anim, int variant, int tiles, int x, int y, uint16_t oamFlags) {
  sprite_init(s);
  s->graphics.dest = vram_malloc((uint32_t)tiles);
  s->graphics.anim = anim;
  s->variant = (uint8_t)variant;
  s->x = (int16_t)x; s->y = (int16_t)y;
  s->oamFlags = oamFlags;
  s->frameFlags = 0;
}

// sub_806B5A4
static void show(void) {
  for (int i = 0; i < 3; i++) {
    Sprite *s = &screen.texts[i];
    s->prevVariant = 0xFF;
    update_sprite(s, 0);
    display_sprite(s);
  }
  screen.marker.x = MARKER_X[screen.choosing];
  update_sprite(&screen.marker, 0);
  display_sprite(&screen.marker);
  update_sprite(&screen.choice, 0);
  display_sprite(&screen.choice);
}

static void free_sprites(Task *t) {
  (void)t;
  for (int i = 0; i < 3; i++) vram_free(screen.texts[i].graphics.dest);
  vram_free(screen.marker.graphics.dest);
  vram_free(screen.choice.graphics.dest);
  vram_free(screen.wait.graphics.dest);
}

// sub_806B534: the picture fades out, then the players go on to the game choice, or stop
static void leave(Task *t) {
  if (!fade_step(&screen.fade)) { show(); return; }
  e.dispCnt &= ~0xE000;
  e.bldCnt = 0;
  e.bldY = 0;
  int choosing = screen.choosing;
  stop_song(SONG_VS_CONTINUE);
  destroy_task(t);
  if (choosing == 0) create_game_select();
  else create_lobby(2);
}

// Task_MultiplayerContinueScreen
static void run(Task *t) {
  if (screen.frames > SETTLE) {
    if (vs_link_lost()) return;
  } else screen.frames++;
  if (fade_step(&screen.fade)) {
    e.dispCnt &= 0x9FFF;
    e.bldCnt = 0;
    e.bldY = 0;
    const uint8_t *parent = link_slot(0);
    int kind = packet_kind(parent), flags = link_flags();
    if (kind == CHOOSING) {
      if (screen.choosing != parent[2]) {
        play_song(SONG_MENU_CURSOR);
        if (!(flags & 0x80)) screen.choosing = parent[2];
      }
    } else if (kind == CHOSEN) {
      if (screen.choosing != parent[2]) {
        play_song(SONG_MENU_CURSOR);
        screen.choosing = parent[2];
      }
      play_song(SONG_SELECT);
      screen.fade.unk4 = 1;
      screen.fade.unk6 = 0;
      t->main = leave;
    }
    uint8_t *send = link_send();
    send[0] = CHOOSING; send[1] = 0;
    send[2] = (uint8_t)screen.choosing;
    if (flags & 0x80) {
      if (screen.chosen == 0) {
        if (e.repeated & KEY_RIGHT) screen.choosing = 1;
        else if (e.repeated & KEY_LEFT) screen.choosing = 0;
        send[2] = (uint8_t)screen.choosing;
        if (e.pressed & KEY_A) {
          int everyone = 1;
          for (int i = 0; i < PLAYERS_MAX; i++) {
            if (i == link_id()) continue;
            if (!(ctx.vsLink.connections >> i & 1)) break;
            if (packet_kind(link_slot(i)) != CHOOSING) everyone = 0;
          }
          if (everyone) { send[0] = CHOSEN; screen.chosen = 1; }
        }
      } else send[0] = CHOSEN;
    } else {
      update_sprite(&screen.wait, 0);
      display_sprite(&screen.wait);
    }
  }
  screen.choice.graphics.anim = ANIM_CHOICE[screen.choosing];
  screen.choice.variant = VARIANT_CHOICE[screen.choosing];
  show();
}

/** CreateMultiplayerContinueScreen. */
void create_vs_continue(void) {
  int lang = SAVE_UI_LANGUAGE ? 1 : 0;
  memset(&screen, 0, sizeof screen);
  vs_reset_missing();
  play_song(SONG_VS_CONTINUE);
  for (int i = 0; i < 10; i++) { e.firstRepeat[i] = 0x14; e.nextRepeat[i] = 8; }
  e.dispCnt = 0x1140;
  e.bgCnt[0] = 0x1E00;
  e.bgScroll[0] = 0; e.bgScroll[1] = 0;
  create_task(run, &screen, 0x2000, 0, free_sprites);
  background_init(&screen.bg);
  screen.bg.graphics.dest = 0; screen.bg.graphics.anim = 0;
  screen.bg.layoutVram = 0xF000; screen.bg.tilemapId = TILEMAP; screen.bg.targetTilesX = 30; screen.bg.targetTilesY = 20;
  draw_background(&screen.bg);
  for (int i = 0; i < 3; i++) sprite_at(&screen.texts[i], TEXT_ANIM[i][lang], TEXT_VARIANT[i][lang], TEXT_TILES[i], TEXT_AT[i][0], TEXT_AT[i][1], 0x480);
  sprite_at(&screen.marker, ANIM_MARKER, 0, 0x1C, 23, 57, 0x480);
  // the choice's text starts as the English one's "stop", whatever the language (gUnknown_0868B782[UILANG_ENGLISH])
  sprite_at(&screen.choice, ANIM_CHOICE[1], VARIANT_CHOICE[1], 0x23, 101, 81, 0x480);
  sprite_at(&screen.wait, ANIM_WAIT, 0, 0xC, SCREEN_W / 2, SCREEN_H / 2, 0x80);
  update_sprite(&screen.wait, 0);
  screen.fade = create_fade(0, 1, 2, 0, 0x100, 0x10);
  // the fade's first step, as the screen is made (sub_805423C)
  fade_step(&screen.fade);
}
