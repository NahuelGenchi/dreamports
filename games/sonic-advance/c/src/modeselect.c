// The VS menu's first screens, translated from front/modeselect.js (SAT-R's src/game/sa1/menus/mp_mode_select.c and
// mp_mode_select_2.c: CreateMultiplayerModeSelectScreen and its tasks), from VS on the main menu. A save whose player has
// no id yet goes to the name input first (nameinput.c), in game mode 2, which comes back here. The screen fades in from
// black over 32 frames to the character select's song: MULTI-PAK and SINGLE-PAK in the save's language, the chosen one
// with a bar behind it and a band of texts running across its row. Up and Down choose, wrapping round, and A or B fade it
// out to black over 32 frames: A to the Multi-Pak waiting screen and B to the main menu. A on Single-Pak does nothing, as
// its waiting screen needs the multiboot transfer, which isn't built.
//
// The Multi-Pak waiting screen (ModeSelect_InitMultiPak, Task_MultiPak) shows how many GBAs are linked (link.c), and the
// first GBA's Start, once every other is there, sends them all on to the connection's outcome (outcome.c). B leaves it
// for this screen again with the return sound.

#include "sa.h"

// by the save's language (0 Japanese, 1 English): the choices' animation, the waiting screen's texts and its "press start",
// and the choices' tilemap, the USA copy's numbers
static const uint16_t ANIM_MODES[2] = { 899, 895 }, ANIM_OUTCOME[2] = { 890, 889 }, ANIM_PRESS_START[2] = { 891, 888 };
static const uint16_t TM_MODES[2] = { 0x4C, 0x4D };
enum { TM_CONTINUE_SCREEN = 80, ANIM_BAR = 860, ANIM_PLAYER_ROWS = 886 };
enum { BAND_WIDTH = 200, BAR_COLUMNS = 8, PAK_COUNT = 2, MULTI_PAK = 0, SINGLE_PAK = 1 };
// what the GBA says on the link (mp_mode_select.c): the waiting screen's packet kinds
enum { HELLO = 0x10, START = 0x11, ACK = 0x12 };
#define HEARTBEATS 0xB5

static struct {
  int mode, qBand, qFade, leaving;   // mode, qUnk1FC, qUnk208, unk20A
  uint32_t frameCount;
  uint8_t joined[2][PLAYERS_MAX];    // unk20B
  int unk206, checked, unk219;       // checked: unk218
  Sprite s[3], bar, pressStart;
  Background bg;
} screen;

static void fade_in(Task *t);

/** CreateMultiplayerModeSelectScreen. */
void create_mode_select(void) {
  int lang = SAVE_UI_LANGUAGE;
  if (save_player_id() == 0) {
    play_song_or_change(SONG_CHARACTER_SELECTION);
    ctx.gameMode = GAME_MODE_RACE;
    create_name_input();
    return;
  }
  e.dispCnt = 0x1141;
  e.bgCnt[0] = 0x1E03;
  memset(&screen, 0, sizeof screen);
  screen.mode = MULTI_PAK;
  screen.qFade = 0x1000;
  vs_sprite(&screen.bar, ANIM_BAR, OBJ_VRAM + 0x840, 0, 64, 0x400, 0, 0x2000);
  vs_sprite(&screen.s[0], ANIM_MODES[lang], OBJ_VRAM, 232, 64, 0x3C0, 0, 0x2000);
  create_task(fade_in, &screen, 0x2000, 0, NULL);
  e.bldCnt = 0xFF;
  e.bldY = 0x10;
  update_sprite(&screen.s[0], 0);
  update_sprite(&screen.bar, 0);
  vs_background(&screen.bg, TM_MODES[lang], 0xF000, 30, 20);
  draw_background(&screen.bg);
  play_song_or_change(SONG_CHARACTER_SELECTION);
}

// sub_800E798: the band of texts moves half a pixel a frame and runs round every 200; the bar sits behind the chosen row
static void draw_mode(void) {
  Sprite *s = &screen.s[0];
  screen.qBand += 0x80;
  if (screen.qBand > BAND_WIDTH * 0x100) screen.qBand -= BAND_WIDTH * 0x100;
  s->y = (int16_t)(screen.mode * 24 + 64);
  s->variant = (uint8_t)screen.mode;
  update_sprite(s, 0);
  for (int x = (screen.qBand >> 8) - BAND_WIDTH; 232 - x > 0; x += BAND_WIDTH) {
    s->x = (int16_t)(232 - x);
    display_sprite(s);
  }
  Sprite *bar = &screen.bar;
  bar->y = (int16_t)(screen.mode * 24 + 54);
  for (int i = 0; i < BAR_COLUMNS; i++) {
    bar->x = (int16_t)(i * 32);
    display_sprite(bar);
  }
}

static void choose_mode(Task *t);
static void fade_out(Task *t);
static void init_multi_pak(Task *t);

// Task_MultiplayerModeSelectScreenInit: the fade in, half a step a frame
static void fade_in(Task *t) {
  screen.qFade -= 0x80;
  if (screen.qFade <= 0) {
    screen.qFade = 0;
    t->main = choose_mode;
  }
  e.bldY = (uint16_t)(screen.qFade >> 8);
  draw_mode();
}

// Task_800E648: Up and Down choose, A goes on to the chosen pak and B back
static void choose_mode(Task *t) {
  if (e.repeated & KEY_UP) {
    play_song(SONG_MENU_CURSOR);
    screen.mode = (screen.mode - 1) & 0xFF;
    if (screen.mode >= PAK_COUNT) screen.mode = SINGLE_PAK;
    screen.qBand = 0;
  } else if (e.repeated & KEY_DOWN) {
    play_song(SONG_MENU_CURSOR);
    if (++screen.mode >= PAK_COUNT) screen.mode = MULTI_PAK;
    screen.qBand = 0;
  }
  if ((e.pressed & KEY_A) && screen.mode == MULTI_PAK) {
    screen.leaving = 0;
    play_song(SONG_SELECT);
    e.bldCnt = 0xFF;
    t->main = fade_out;
  } else if (e.pressed & KEY_B) {
    screen.leaving = 1;
    play_song(SONG_RETURN);
    e.bldCnt = 0xFF;
    t->main = fade_out;
  }
  draw_mode();
}

// Task_800E868: the fade out, half a step a frame; at black B stops the music and starts the main menu again, and A
// starts the Multi-Pak waiting screen
static void fade_out(Task *t) {
  screen.qFade += 0x80;
  if (screen.qFade >= 0x1000) {
    screen.qFade = 0x1000;
    vs_clear_map(0, 0x20);
    if (screen.leaving) {
      e.bldCnt = 0;
      e.bldY = 0;
      stop_song(SONG_CHARACTER_SELECTION);
      destroy_task(t);
      create_main_menu(1);
    } else {
      t->main = init_multi_pak;
    }
  } else {
    e.bldY = (uint16_t)(screen.qFade >> 8);
    draw_mode();
    // CreateMainMenu's DmaFill32 over the first layer's and the sprites' first tiles already shows in the original's
    // picture on the frame before the main menu is made, as it does leaving the Time Attack menu
    if (screen.leaving && screen.qFade + 0x80 >= 0x1000) {
      memset(gba_vram, 0, 0x40);
      memset(gba_vram + OBJ_VRAM, 0, 0x40);
    }
  }
}

static void wait_multi_pak(Task *t);

// ModeSelect_InitMultiPak: the waiting screen's texts, the number of players and "press start", over its picture
static void init_multi_pak(Task *t) {
  int lang = SAVE_UI_LANGUAGE;
  play_song(SONG_VS_PLEASE_WAIT);
  screen.frameCount = save_player_id() + e.frameCount;
  memset(screen.joined, 0, sizeof screen.joined);
  uint32_t vram = OBJ_VRAM;
  vs_sprite(&screen.s[0], ANIM_OUTCOME[lang], vram, 120, 33, 0x3C0, 0, 0x2000);
  vs_sprite(&screen.s[1], ANIM_PLAYER_ROWS, vram += 0x540, 101, 41, 0x3C0, 0, 0x2000);
  vs_sprite(&screen.s[2], ANIM_OUTCOME[1], vram += 0x460, 120, 109, 0x3C0, 4, 0x2000);
  vs_sprite(&screen.pressStart, ANIM_PRESS_START[lang], vram += 0x80, 120, 125, 0x3C0, 0, 0x2000);
  for (int i = 0; i < 3; i++) update_sprite(&screen.s[i], 0);
  update_sprite(&screen.pressStart, 0);
  vs_background(&screen.bg, TM_CONTINUE_SCREEN, 0xF000, 30, 20);
  draw_background(&screen.bg);
  screen.unk206 = 0;
  screen.checked = 0;
  link_enable(1);
  t->main = wait_multi_pak;
}

// a packet to send: its kind, the GBA ids taking part (but in a hello), the save's id, the player's name and, with
// `withFrame`, the frame count
static void say(int kind, int mask, int withFrame, uint32_t frameCount) {
  uint8_t *packet = link_send();
  set_kind(packet, kind);
  if (kind != HELLO) set_le16(packet, 2, (uint32_t)mask);
  set_le32(packet, 4, save_player_id());
  memcpy(packet + 8, SAVE_PLAYER_NAME, 8);
  if (withFrame) set_le32(packet, 0x10, frameCount);
}

// sub_800FD9C: the player whose packet this is goes to the front of the save's ten records of players, which move down a
// place. A record is the same when its id and its name, from the second byte of the id, are those of the packet; that one
// moves to the front as it is. Otherwise the id and name are copied to a new first record, with no wins, losses or draws.
// Returns the place `place`
static int register_player(const uint8_t *packet, int place) {
  uint8_t *scores = SAVE_MULTIPLAYER_SCORES;
  for (int i = 0; i < 10; i++) {
    int same = scores[i * 16] == packet[4];
    for (int c = 1; same && c < 12; c++) if (packet[4 + c] != scores[i * 16 + c]) same = 0;
    if (same) {
      uint8_t own[16];
      memcpy(own, scores + i * 16, 16);
      memmove(scores + 16, scores, (size_t)i * 16);
      memcpy(scores, own, 16);
      return place;
    }
  }
  memmove(scores + 16, scores, 9 * 16);
  memcpy(scores, packet + 4, 12);
  memset(scores + 12, 0, 3);
  return place;
}

// the link was lost (LinkCommunicationError)
static void link_lost(Task *t) {
  vs_leave_link();
  destroy_task(t);
  create_link_error();
}

// back to the modes, as B does from the waiting screens
static void back_to_modes(Task *t) {
  vs_leave_link();
  stop_song(SONG_CHARACTER_SELECTION);
  play_song(SONG_RETURN);
  vs_clear_map(0, 0x20);
  destroy_task(t);
  create_mode_select();
}

// the count of GBAs seen, as every waiting task shows it
static void show_waiting(int count) {
  screen.s[2].variant = (uint8_t)(count + 3);
  for (int i = 0; i < 3; i++) { update_sprite(&screen.s[i], 0); display_sprite(&screen.s[i]); }
}

static void start_answer(Task *t);

// Task_MultiPak: who is on the link, and the first GBA's Start, which sends the others on
static void wait_multi_pak(Task *t) {
  int id = link_id(), flags = link_flags();
  if (flags & 0x81) {
    if (!(flags & (1 << id))) {
      if (ctx.missing[id]++ >= HEARTBEATS) { link_lost(t); return; }
    } else ctx.missing[id] = 0;
  }
  screen.qFade = s16(screen.qFade - 0x80);
  if (screen.qFade < 0) screen.qFade = 0;
  e.bldY = (uint16_t)(screen.qFade >> 8);

  int present = 0, seen = 0, mask = 0, gap = 0, notReady = 0, steady = 1;
  for (int i = 0; i < PLAYERS_MAX; i++) {
    screen.joined[0][i] = (uint8_t)(screen.joined[0][i] << 1);
    screen.joined[1][i] = (uint8_t)(screen.joined[1][i] << 1);
    const uint8_t *there = link_slot(i);
    if (i == id || (flags & (1 << i) && packet_kind(there) >= HELLO)) {
      screen.joined[0][i] |= 1;
      present++;
      mask |= 1 << i;
      if (gap) notReady = 1;
    } else {
      gap = 1;
      if (!(flags & (1 << i)) && link_data(i) == 0) {
        notReady = 1;
        screen.joined[1][i] |= 1;
        if (screen.joined[0][i] == 0) steady = 0;
      } else if (screen.joined[1][i] != 0) {
        notReady = 1;
        steady = 0;
      } else if ((flags & (1 << i)) && packet_kind(there) < HELLO) {
        notReady = 1;
        steady = 0;
      }
    }
    if (screen.joined[0][i] != 0) seen++;
  }
  if (seen == 0) seen = 1;

  int parent = packet_kind(link_slot(0));
  if (!screen.checked) {
    if ((flags & 0x81) == 1 && parent > HELLO) { link_lost(t); return; }
    screen.checked = 1;
  }
  if (!notReady && parent == START && screen.checked) {
    // the parent's Start: the seed and who is playing come with it, and the GBAs answer
    const uint8_t *from = link_slot(0);
    memset(&ctx.vsLink, 0, sizeof ctx.vsLink);
    ctx.vsLink.set = 1;
    ctx.vsLink.seed = le32(from, 0x10);
    ctx.vsLink.connections = (uint16_t)le16(from, 2);
    memset(ctx.vsLink.records, 0xFF, sizeof ctx.vsLink.records);
    // each of the other GBAs goes to the front of the save's records of players, and keeps its place there (from 2 down)
    for (int i = 3, place = 2; i >= 0; i--) {
      if (i != id && (flags & (1 << i))) ctx.vsLink.records[i] = (uint8_t)register_player(link_slot(i), place--);
      else if (i != id) place--;
    }
    screen.unk206 = 0;
    vs_reset_missing();
    screen.unk219 = 0;
    t->main = start_answer;
    start_answer(t);
    return;
  }
  if (parent > ACK) { link_lost(t); return; }
  if (e.pressed & KEY_B) { back_to_modes(t); return; }
  show_waiting(seen);
  if (flags & 0x80) {
    if (seen > 1 && steady) { update_sprite(&screen.pressStart, 0); display_sprite(&screen.pressStart); }
    if ((!notReady && present > 1 && (e.pressed & KEY_START)) || (screen.unk206 && !notReady && present > 1)) {
      say(START, mask, 1, screen.frameCount);
      screen.unk206 = 1;
      return;
    }
  }
  screen.unk206 = 0;
  say(HELLO, 0, 0, 0);
}

// Task_800F058: the GBAs have each other's Start; the parent waits for them all to answer, and then everyone goes on
static void start_answer(Task *t) {
  int id = link_id(), flags = link_flags(), connections = ctx.vsLink.connections;
  for (int i = 0; i < 4; i++) {
    if (!(connections >> i & 1)) break;
    if (!(flags & (1 << i))) {
      if (ctx.missing[i]++ >= HEARTBEATS) { link_lost(t); return; }
    } else ctx.missing[i] = 0;
  }
  int parent = packet_kind(link_slot(0));
  if (parent == ACK) {
    ctx.gameMode = GAME_MODE_RACE;
    destroy_task(t);
    create_multipack_outcome(0);
    return;
  }
  if (parent == HELLO) { back_to_modes(t); return; }
  if (flags & 0x80) {
    if (e.pressed & KEY_B) { back_to_modes(t); return; }
    if (screen.unk219++ > 60) { link_lost(t); return; }
  }
  int seen = 0, mask = 0;
  for (int i = 0; i < PLAYERS_MAX; i++) {
    screen.joined[0][i] = (uint8_t)(screen.joined[0][i] << 1);
    if (id == i || packet_kind(link_slot(i)) > HELLO) mask |= 1 << i;
    if (screen.joined[0][i] != 0) seen++;
  }
  if (seen == 0) seen = 1;
  show_waiting(seen);
  if (flags & 0x80) {
    say(ACK, mask, 0, 0);
    for (int i = 1; i < 4; i++) {
      if (!(connections >> i & 1)) continue;
      if (!(flags & (1 << i)) || packet_kind(link_slot(i)) != START) { say(START, mask, 0, 0); return; }
    }
  } else say(START, mask, 0, 0);
}
