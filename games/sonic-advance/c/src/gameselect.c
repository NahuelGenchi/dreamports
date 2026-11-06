// The VS game choice, translated from front/gameselect.js (SAT-R's src/game/sa1/stage/mp_results.c: sub_8018538 and
// Task_801874C): after the lobby, the first GBA, the parent, picks Race or Chao Hunt with Up and Down and A, and the others
// wait with a "please wait" text in the middle. The chosen row has a bar behind it and a band of texts running across it.
// The GBAs tell each other over the link: the parent sends 0x30 with the row it is on, and 0x31 once every other GBA has
// answered 0x30 and it presses A; the others follow whatever row the parent shows and, on 0x31, go on to the character
// select. Race isn't in the game yet, so A on its row does nothing.

#include "sa.h"

// the USA copy's numbers: the texts in Japanese and English, the bar and the waiting text; and the band's widths, for
// each language those of the Race row and of the Chao Hunt row
static const uint16_t ANIM_TEXTS[2] = { 893, 892 };
enum { ANIM_BAR = 860, ANIM_WAIT = 903, TILEMAP = 84, HEARTBEATS = 0xB5, CHOOSING = 0x30, CHOSEN = 0x31 };
static const int BAND_WIDTH[2][2] = { { 56, 92 }, { 64, 104 } };

static struct {
  int mode, qBand, chosen;   // unk203, unk1FC, unk213
  Sprite s, bar, wait;
  Background bg;
} screen;

static void choose(Task *t);

/** sub_8018538. */
void create_game_select(void) {
  int lang = SAVE_UI_LANGUAGE;
  vs_reset_missing();
  e.dispCnt = 0x1141;
  e.bgCnt[0] = 0x1E03;
  e.bldCnt = 0;
  e.bldY = 0;
  memset(&screen, 0, sizeof screen);
  vs_sprite(&screen.s, ANIM_TEXTS[lang], OBJ_VRAM, 232, 64, 0x3C0, 0, 0x2000);
  vs_sprite(&screen.bar, ANIM_BAR, OBJ_VRAM + 0x2C0, 0, 64, 0x400, 0, 0x2000);
  vs_sprite(&screen.wait, ANIM_WAIT, OBJ_VRAM + 0x2C0 + 0x180, 120, 80, 0x80, 0, 0x2000);
  create_task(choose, &screen, 0x2000, 0, NULL);
  update_sprite(&screen.s, 0);
  update_sprite(&screen.bar, 0);
  update_sprite(&screen.wait, 0);
  vs_background(&screen.bg, (uint16_t)(TILEMAP + lang), 0xF000, 30, 20);
  draw_background(&screen.bg);
  play_song_or_change(SONG_VS_LOBBY);
}

// Task_801874C
static void choose(Task *t) {
  int flags = link_flags(), connections = vs_connections();
  for (int i = 0; i < PLAYERS_MAX; i++) {
    if (!(connections >> i & 1)) break;
    if (!(flags & (1 << i))) {
      if (ctx.missing[i]++ >= HEARTBEATS) {
        destroy_tasks(0, 0xFFFF);
        clear_queues();
        create_link_error();
        return;
      }
    } else ctx.missing[i] = 0;
  }

  const uint8_t *parent = link_slot(0);
  int kind = packet_kind(parent), shown = parent ? parent[2] : -1;
  if (kind == CHOOSING) {
    if (screen.mode != shown) {
      play_song(SONG_MENU_CURSOR);
      if (!(flags & 0x80)) screen.mode = shown;
    }
  } else if (kind == CHOSEN) {
    if (screen.mode != shown) {
      play_song(SONG_MENU_CURSOR);
      screen.mode = shown;
    }
    play_song(SONG_SELECT);
    // GAME_MODE_RACE or GAME_MODE_CHAO_HUNT, and the character select
    ctx.gameMode = screen.mode == 0 ? GAME_MODE_RACE : GAME_MODE_CHAO_HUNT;
    destroy_task(t);
    create_vs_character_select();
    return;
  }

  uint8_t *send = link_send();
  if (flags & 0x80) {
    int everyone = 1;
    set_kind(send, CHOOSING);
    if (!screen.chosen) {
      if (e.repeated & KEY_UP) {
        play_song(SONG_MENU_CURSOR);
        screen.mode = (screen.mode - 1) & 0xFF;
        if (screen.mode > 1) screen.mode = 1;
        screen.qBand = 0;
      } else if (e.repeated & KEY_DOWN) {
        play_song(SONG_MENU_CURSOR);
        if (++screen.mode > 1) screen.mode = 0;
        screen.qBand = 0;
      }
    }
    send[2] = (uint8_t)screen.mode;
    for (int i = 1; i < PLAYERS_MAX; i++) {
      if (!(connections >> i & 1)) break;
      if (packet_kind(link_slot(i)) != CHOOSING) everyone = 0;
    }
    if ((everyone && (e.pressed & KEY_A) && screen.mode == 1) || screen.chosen) {
      screen.chosen = 1;
      set_kind(send, CHOSEN);
    }
  } else {
    set_kind(send, CHOOSING);
    update_sprite(&screen.wait, 0);
    display_sprite(&screen.wait);
  }

  // the band of texts runs across the row, half a pixel a frame
  Sprite *s = &screen.s;
  int width = BAND_WIDTH[SAVE_UI_LANGUAGE][screen.mode];
  screen.qBand += 0x80;
  if (screen.qBand > width * 0x100) screen.qBand -= width * 0x100;
  s->y = (int16_t)(screen.mode * 24 + 64);
  s->variant = (uint8_t)screen.mode;
  update_sprite(s, 0);
  for (int x = (screen.qBand >> 8) - width; 232 - x > 0; x += width) {
    s->x = (int16_t)(232 - x);
    display_sprite(s);
  }
  Sprite *bar = &screen.bar;
  bar->y = (int16_t)(screen.mode * 24 + 54);
  for (int i = 0; i < 8; i++) {
    bar->x = (int16_t)(i * 32);
    display_sprite(bar);
  }
}
