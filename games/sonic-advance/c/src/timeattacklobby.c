// The Time Attack lobby, translated from front/timeattacklobby.js (SAT-R's src/game/sa1/ui/time_attack_lobby.c:
// CreateTimeAttackLobbyScreen and its tasks), where a run ends: after the results, a life lost, the time running out, or
// A in the pause menu. Four choices in the save's language over a picture, with a marker beside the chosen one and the
// character beside them: Retry (the same act again), the character select, the course select and the title screen. Up
// and Down move the marker, wrapping round, with the key repeat of 20 frames and then 8. A makes the character run off to
// the right (all but for the title screen), then the screen fades out to black and the choice's screen comes.

#include "sa.h"

enum { CHOICES = 4, RETRY = 0, CHARACTER_SELECT = 1, COURSE_SELECT = 2, TITLE = 3 };
enum { ANIM_MARKER = 857, SCREEN_CENTRE = 120, RUN_STEP = 32 };
// the tables in the ROM: the four choices' animations and variants by language, their sizes, and by character the
// three animations and variants of the figure beside them
enum { ANIMS = 0, VARIANTS = 0x10, SIZES = 0x18, FIGURE_ANIMS = 0x1C, FIGURE_VARIANTS = 0x34 };
// the picture: 256 colours, then its tiles and its map of 0x500 bytes each
enum { PICTURE_TILES = 0x200, PICTURE_MAP = 0x500 };
#define TABLES OFFSET_TIME_ATTACK_LOBBY_TABLES

static struct { int choice, x, speed; Fade fade; Sprite texts[CHOICES], marker, figure; } lobby;   // unk134, qUnk12C, qUnk130

static void lobby_sprite(Sprite *s, uint16_t anim, uint32_t dest, int variant, int x, int y) {
  sprite_init(s);
  s->graphics.anim = anim;
  s->graphics.dest = dest;
  s->prevVariant = 0xFF;
  s->animSpeed = 0x10;
  s->oamFlags = 0x480;
  s->frameFlags = 0x2000;
  s->variant = (uint8_t)variant;
  s->x = (int16_t)x;
  s->y = (int16_t)y;
}

static void handle_input(Task *t);
static void destroyed(Task *t);

/** CreateTimeAttackLobbyScreen, for ctx.character and the act ctx.currentLevel. */
void create_time_attack_lobby(void) {
  int lang = SAVE_UI_LANGUAGE != 0 ? 1 : 0, character = ctx.character;
  play_song(SONG_TIME_ATTACK_LOBBY);
  memset(e.firstRepeat, 0x14, 10);
  memset(e.nextRepeat, 8, 10);
  create_ui_task();
  e.dispCnt = 0x1140;
  e.bgCnt[0] = 0x1E83;
  ui_gfx_stack_init();
  e.bgScroll[0] = 0;
  e.bgScroll[1] = 0;

  memset(&lobby, 0, sizeof lobby);
  lobby.fade = create_fade(0, 1, 2, 0, 0x100, 0x10);
  create_task(handle_input, &lobby, 0x2000, 0, destroyed);
  for (int i = 0; i < CHOICES; i++) {
    Sprite *s = &lobby.texts[i];
    lobby_sprite(s, (uint16_t)rom_u16(TABLES + ANIMS + (uint32_t)(i * 2 + lang) * 2), vram_malloc(rom_u8(TABLES + SIZES + (uint32_t)i)),
                 (int)rom_u8(TABLES + VARIANTS + (uint32_t)(i * 2 + lang)), 47, i * 16 + 33);
    update_sprite(s, 0);
  }
  lobby_sprite(&lobby.marker, ANIM_MARKER, vram_malloc(4), 0, 33, 25);
  update_sprite(&lobby.marker, 0);
  lobby_sprite(&lobby.figure, (uint16_t)rom_u16(TABLES + FIGURE_ANIMS + (uint32_t)character * 6), vram_malloc(64),
               (int)rom_u8(TABLES + FIGURE_VARIANTS + (uint32_t)character * 3), 0x78, 0x82);
  lobby.figure.frameFlags = 0x2400;
  fade_step(&lobby.fade);
  UiGfx g = { 0 };
  g.uiGfxID = 128; g.unk2B = 0;
  g.tiles = OFFSET_TIME_ATTACK_LOBBY_PICTURE + PICTURE_TILES; g.tilesSize = 0x500;
  g.layout_ = OFFSET_TIME_ATTACK_LOBBY_PICTURE + PICTURE_TILES + 0x300; g.layoutSize = PICTURE_MAP;
  g.palette = OFFSET_TIME_ATTACK_LOBBY_PICTURE; g.paletteSize = 0x200; g.unk28 = 0; g.unk29 = 0; g.unk2A = 0x15;
  load_ui_gfx(&g);
}

// the figure's second animation, the run
static void change_figure(void) {
  Sprite *s = &lobby.figure;
  s->graphics.anim = (uint16_t)rom_u16(TABLES + FIGURE_ANIMS + (uint32_t)ctx.character * 6 + 2);
  s->variant = (uint8_t)rom_u8(TABLES + FIGURE_VARIANTS + (uint32_t)ctx.character * 3 + 1);
  s->prevVariant = 0xFF;
}

// sub_806A5BC: the four texts, the marker beside the chosen one and the character, who goes on to the second animation
// once the first has ended
static void show(void) {
  for (int i = 0; i < CHOICES; i++) display_sprite(&lobby.texts[i]);
  lobby.marker.y = (int16_t)(lobby.choice * 16 + 25);
  display_sprite(&lobby.marker);
  Sprite *s = &lobby.figure;
  s->x = (int16_t)((lobby.x >> 8) + SCREEN_CENTRE);
  if (update_sprite(s, 0) == 0) change_figure();   // the animation has ended
  display_sprite(s);
}

static void leaving(Task *t);

// Task_HandleInput: once it has faded in, Up and Down choose, and A leaves
static void handle_input(Task *t) {
  if (fade_step(&lobby.fade)) {
    if (e.repeated & KEY_DOWN) {
      play_song(SONG_MENU_CURSOR);
      lobby.choice = lobby.choice < CHOICES - 1 ? lobby.choice + 1 : 0;
    } else if (e.repeated & KEY_UP) {
      play_song(SONG_MENU_CURSOR);
      lobby.choice = lobby.choice != 0 ? lobby.choice - 1 : CHOICES - 1;
    }
    if (e.pressed & KEY_A) {
      play_song(SONG_SELECT);
      if (lobby.choice != CHOICES - 1) change_figure();
      lobby.fade.unk4 = 1;
      lobby.fade.unk6 = 0;
      t->main = leaving;
    }
  }
  show();
}

#define TITLE_CLEAR_LINE 28
static void title_clear_lands(int line) {
  if (line != TITLE_CLEAR_LINE) return;
  memset(gba_vram, 0, 64);
  memset(gba_vram + 0xFFC0, 0, 0x80);
}

// Task_806A508: the character runs off to the right, faster and faster; then the fade out, and the choice's screen
// (gUnknown_0868B6C4): the act again, the character select, the course select, or the title screen
static void leaving(Task *t) {
  if (lobby.x < 160 * 0x100 && lobby.choice != TITLE) {
    lobby.speed += RUN_STEP;
    lobby.x += lobby.speed;
  } else if (fade_step(&lobby.fade)) {
    e.dispCnt &= 0x1FFF;
    e.bldCnt = 0;
    e.bldY = 0;
    stop_song(SONG_TIME_ATTACK_LOBBY);
    destroy_task(t);
    switch (lobby.choice) {
      case RETRY: front_time_attack_play(ctx.currentLevel); break;
      case CHARACTER_SELECT: create_character_select(ctx.character); break;
      case COURSE_SELECT: create_course_select(); break;
      default: create_title_screen(1); break;
    }
    return;
  }
  show();
  // CreateTitleScreen's clear of the first layer's first tile and the sprites' first two already shows in the original's
  // picture on the frame before the title screen is made, from line 29 down, where its DMA lands as the picture is drawn
  if (lobby.choice == TITLE && lobby.fade.unk4 == 1 && lobby.fade.unk6 + lobby.fade.unk8 >= 0x2000) {
    e.hblankCallbacks[e.numHblankCallbacks++] = title_clear_lands;
    e.flags |= FLAGS_HBLANK_CALLBACKS;
  }
}

// TaskDestructor_806A698
static void destroyed(Task *t) {
  (void)t;
  for (int i = 0; i < CHOICES; i++) vram_free(lobby.texts[i].graphics.dest);
  vram_free(lobby.marker.graphics.dest);
  vram_free(lobby.figure.graphics.dest);
}
