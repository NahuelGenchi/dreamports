// The VS play choice for three or four players, translated from front/vsteams.js (SAT-R's src/game/sa1/stage/
// mp_results_b.c: sub_8018AE0 and Task_8018ECC): after the overview, each player against all the others or the players in
// two teams. The first GBA, the parent, picks with Left and Right and A, and the others wait with a "please wait" text in
// the middle. The pick shows on a marker over the two texts, with two pictures turning behind. All against all (the right
// one, as the screen starts) goes on to the Chao Hunt stage choice (vschao.c). The teams aren't built, so A on them does
// nothing, as on Race in the game choice.
//
// The GBAs tell each other over the link: the parent sends 0x34 with the pick, and 0x35 once every other GBA has answered
// and it presses A; the others follow the pick and, on 0x35, go on.

#include "sa.h"

// the USA copy's numbers: the texts' band, the bar, the messages (variants 2 and 3, the two picks), the marker and the
// waiting text
enum { ANIM_TEXTS = 892, ANIM_BAR = 860, ANIM_MESSAGES = 889, ANIM_MARKER = 858, ANIM_WAIT = 903 };
enum { CHOOSING = 0x34, CHOSEN = 0x35 };
static const uint16_t TILEMAPS[2] = { 81, 82 };

static struct {
  int frame, speed, angle, band, pick, chosen;   // unk234, unk236, unk238, unk230, unk246, unk247
  uint16_t scroll[2];                            // unk23E, unk240
  Sprite s, bar, messages[3], wait;
  Background bg, bg2;
} screen;

static void choose(Task *t);

/** sub_8018AE0. */
void create_vs_teams(void) {
  vs_reset_missing();
  e.dispCnt = 0x1340;
  e.bgCnt[0] = 0x1E03;
  e.bgCnt[1] = 0x1F06;
  memset(&screen, 0, sizeof screen);
  screen.pick = 1;
  vs_sprite(&screen.s, ANIM_TEXTS, OBJ_VRAM, 0, 0x19, 15 << 6, 2, 0);
  vs_sprite(&screen.bar, ANIM_BAR, OBJ_VRAM + 0x340, 0, 0xE, 0x400, 0, 0);
  vs_sprite(&screen.messages[0], ANIM_MESSAGES, OBJ_VRAM + 0x4C0, 0x35, 0x58, 0x400, 2, 0);
  vs_sprite(&screen.messages[1], ANIM_MESSAGES, OBJ_VRAM + 0x640, 0xB7, 0x58, 0x400, 3, 0);
  vs_sprite(&screen.messages[2], ANIM_MARKER, OBJ_VRAM + 0x740, 25, 73, 0x400, 0, 0);
  vs_sprite(&screen.wait, ANIM_WAIT, OBJ_VRAM + 0xAC0, 120, 80, 0x80, 0, 0x2000);
  create_task(choose, &screen, 0x2000, 0, NULL);
  update_sprite(&screen.s, 0);
  update_sprite(&screen.bar, 0);
  for (int i = 0; i < 3; i++) update_sprite(&screen.messages[i], 0);
  update_sprite(&screen.wait, 0);
  vs_background(&screen.bg, TILEMAPS[0], 0xF000, 30, 20);
  draw_background(&screen.bg);
  vs_background(&screen.bg2, TILEMAPS[1], 0xF800, 32, 32);
  screen.bg2.graphics.dest = 0x4000;
  screen.bg2.flags = 1;
  draw_background(&screen.bg2);
  play_song_or_change(SONG_CHARACTER_SELECTION);
  e.repeated = 0;
  e.pressed = 0;
  e.keys = 0;
  e.winRegs[5] = 0x3F;
  e.bldCnt = 0x3F46;
  e.bldAlpha = 0xA10;
  e.winRegs[2] = 0xA0;
}

// Task_8018ECC
static void choose(Task *t) {
  int flags = link_flags(), connections = ctx.vsLink.connections;
  screen.frame++;
  if (vs_link_lost()) return;

  const uint8_t *parent = link_slot(0);
  int kind = packet_kind(parent), shown = parent ? parent[2] : -1;
  uint8_t *send = link_send();
  if (kind == CHOOSING) {
    if (screen.pick != shown) {
      play_song(SONG_MENU_CURSOR);
      if (!(flags & 0x80)) screen.pick = shown;
    }
  } else if (kind == CHOSEN) {
    int everyone = 1;
    if (flags & 0x80) {
      for (int i = 1; i < PLAYERS_MAX; i++) {
        if (!(connections >> i & 1)) break;
        if (packet_kind(link_slot(i)) < CHOSEN) everyone = 0;
      }
    } else set_kind(send, kind);
    if (everyone) {
      if (screen.pick != shown) {
        play_song(SONG_MENU_CURSOR);
        screen.pick = shown;
      }
      play_song(SONG_SELECT);
      // the Chao Hunt stage choice (sub_8062F90); the teams aren't in the game yet, so A on them does nothing
      ctx.gameMode = GAME_MODE_CHAO_HUNT;
      destroy_task(t);
      create_vs_chao_select();
      return;
    }
  } else if (kind > CHOSEN) {
    destroy_tasks(0, 0xFFFF);
    clear_queues();
    create_link_error();
    return;
  }

  if (flags & 0x80) {
    set_kind(send, CHOOSING);
    if (!screen.chosen) {
      if (e.keys & KEY_RIGHT) screen.pick = 1;
      else if (e.keys & KEY_LEFT) screen.pick = 0;
    }
    send[2] = (uint8_t)screen.pick;
    int everyone = 1;
    for (int i = 1; i < PLAYERS_MAX; i++) {
      if (!(connections >> i & 1)) break;
      if (packet_kind(link_slot(i)) < CHOOSING) everyone = 0;
    }
    if ((everyone && (e.pressed & KEY_A) && screen.pick == 1) || screen.chosen) {
      set_kind(send, CHOSEN);
      send[2] = (uint8_t)screen.pick;
      screen.chosen = 1;
    }
  } else {
    set_kind(send, CHOOSING);
    update_sprite(&screen.wait, 0);
    display_sprite(&screen.wait);
  }

  // the marker under the pick, and the two pictures behind turning one way or the other with it
  screen.messages[2].x = (int16_t)(screen.pick * 0x83 + 0x19);
  screen.speed = screen.speed + 0x10 < 0x400 ? screen.speed + 0x10 : 0x400;
  screen.angle = (screen.angle + (screen.pick == 0 ? 1 : -1)) & 0x3FF;
  int dx = (screen.speed * (SINE[screen.angle + 256] >> 6)) >> 8, dy = (screen.speed * (SINE[screen.angle] >> 6)) >> 8;
  screen.scroll[0] = (uint16_t)(screen.scroll[0] + dx);
  screen.scroll[1] = (uint16_t)(screen.scroll[1] + dy);
  e.bgScroll[2] = (uint16_t)(s16(screen.scroll[0]) >> 8);
  e.bgScroll[3] = (uint16_t)(s16(screen.scroll[1]) >> 8);

  // the band of texts runs across, half a pixel a frame
  screen.band += 0x80;
  if (screen.band > 136 << 8) screen.band -= 136 << 8;
  for (int x = s16(-screen.band >> 8); x < 240; x += 136) {
    screen.s.x = (int16_t)x;
    display_sprite(&screen.s);
  }
  for (int i = 0; i < 3; i++) {
    update_sprite(&screen.messages[i], 0);
    display_sprite(&screen.messages[i]);
  }
  for (int i = 0; i < 8; i++) {
    screen.bar.x = (int16_t)(i * 32);
    display_sprite(&screen.bar);
  }
}
