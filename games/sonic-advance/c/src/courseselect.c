// The course select, translated from front/courseselect.js (SAT-R's src/game/sa1/ui/course_select.c), after Game Start
// once the character has progress in the save: its acts down the left, as far as they have got, and the zones they
// belong to down the right, over a picture. The screen fades in from black over 16 frames to its own song while both
// lists slide in from below, the picture's bands with them, 63 frames in all, which A cuts short. Up and Down choose an
// act, with the key repeat, and don't wrap round; the lists scroll two rows at a time to keep it in view. A fades out
// with the choice blinking and starts that act, and B goes back.
//
// With a start point, which leaves out the character select, B goes back to the main menu, where the character select
// would go back to (CreateMainMenu(1)). Time Attack's card and records, and the link play's way through this screen,
// aren't in C yet: every press here starts the act through front_play, which stops where the acts begin.

#include "sa.h"
#include "act.h"

enum { ANIM_ACTS = 724, ANIM_ARROW_UP = 745, ANIM_VS_MENU_WAIT = 905 };
// gUnknown_0868B10C: the acts' 15 sets of tiles, in sprite VRAM
#define ACT_TILES_AT 0x20
#define COURSE_ACT_TILES 0x3C0
// gUnknown_0868B1C0's animations: the zones' names
static const uint16_t ZONES[8] = { 725, 726, 727, 742, 743, 744, 729, 728 };
#define ZONE_TILES_AT 0x3860
#define ZONE_TILES 0x480
#define ARROW_TILES_AT 0x6400
#define WAIT_TILES_AT (ARROW_TILES_AT + 0xC0)
// the scroll at which the last row is in view, by how many rows there are (gUnknown_0868B220)
static const uint8_t LAST_SCROLL[16] = { 20, 20, 20, 20, 20, 20, 20, 36, 60, 84, 108, 132, 156, 180, 204, 228 };
// the picture, one thing after the other (offsets.courseSelectBackground, sub_8061894): the front layer's tiles and
// map, the colours, then the back layer's tiles and map
enum {
  BACKGROUND_FRONT_TILES = 0, BACKGROUND_FRONT_TILES_SIZE = 0xE00,
  BACKGROUND_FRONT_LAYOUT = 0xD40, BACKGROUND_FRONT_LAYOUT_SIZE = 0x500,
  BACKGROUND_PALETTE = 0x1240, BACKGROUND_PALETTE_SIZE = 0x200,
  BACKGROUND_TILES = 0x1440, BACKGROUND_TILES_SIZE = 0x1180,
  BACKGROUND_LAYOUT = 0x25C0, BACKGROUND_LAYOUT_SIZE = 0x1000,
};
// the colours of the UI graphics entry the screen loads over sprite palette row 3 as it starts
#define ROW_3_GFX 62
#define SLIDE_END 0x3F   // the slide's last frame, when the picture's map doubles to its full height
enum { CHOSEN = 1, BACK = 2 };   // unk57
enum { X_ZONE = 12, THE_MOON = 13 };
#define MAX_ROWS 16

static struct {
  int rows, records, frame, ending, shown, scroll, scrollTo, level;   // unk4C, unk50, unk52, and the slide's frame
  Fade fade;
  Task *tasks[3];   // the arrows, the acts and the zones
  Sprite arrow, acts[MAX_ROWS], zones[8];
} screen;

static void slide_in(Task *t);
static void idle(Task *t);
static void choose_act(Task *t);
static void leave_choose(Task *t, int ending, int song);
static void fade_out(Task *t);
static void show_arrows(Task *t);
static void slide_acts(Task *t);
static void show_acts(Task *t);
static void slide_zones(Task *t);
static void show_zones(Task *t);
static void watch_start_point(Task *t);

// A start point at an act opens it at the page frame the recording names, while the original plays the course
// select and the act's title card in onlyInOriginal. It leaves the course select running until then, so the sprite
// palettes the screen loaded are the ones the act keeps.
static void watch_start_point(Task *t) {
  int level = (int)gba_start_number("level", -1);
  if (level < 0 || gba_start_number("power", 0) != 2) return;
  // only a start point that names its frame; the normal course select picks the act when A is pressed
  if (gba_start_number("at", -1) < 0) return;
  if (front_frame() < (uint32_t)gba_start_number("at", 0)) return;
  destroy_tasks(0x2000, 0x3000);
  act_active = 1;
  act_start(level, (int)gba_start_number("card", -1), (int)gba_start_number("pre", 0));
  act_frame_now();
  destroy_task(t);
}

// a sprite of the screen's: its animation from the start, at normal speed
static void screen_sprite(Sprite *s, uint16_t anim, uint32_t dest) {
  sprite_init(s);
  s->graphics.dest = dest;
  s->graphics.anim = anim;
  s->prevVariant = 0xFF;
  s->animSpeed = 0x10;
}

// how many rows the character has (the first of them is never shown, so one more than they can choose). The records'
// thirteen rows aren't in C yet, as Time Attack isn't.
static int course_rows(void) {
  int unlocked = save_unlocked_level(ctx.character);
  int rows = (unlocked + 2) & 0xFF;
  if (rows == 0) rows = 1;
  if (ctx.character == 0) {
    if (rows > 15) rows = 15;
    else if (unlocked == 13) rows = 14;
  } else if (rows > 14) rows = 14;
  if (ctx.gameMode != GAME_MODE_SINGLE_PLAYER && rows > 13) rows = 13;   // Time Attack has no Moon Zone
  return rows;
}

// sub_8061894: the picture's two layers, from the screen's own stack
static void load_background(uint32_t at) {
  ui_gfx_stack_init();
  UiSlot noLayout = { 0 };
  UiGfx front = { 0 };
  front.uiGfxID = 0x80; front.unk2B = 1; front.layout = &noLayout; front.unk29 = 1; front.unk2A = 0x11;
  front.tiles = at + BACKGROUND_FRONT_TILES; front.tilesSize = BACKGROUND_FRONT_TILES_SIZE;
  front.layout_ = at + BACKGROUND_FRONT_LAYOUT; front.layoutSize = BACKGROUND_FRONT_LAYOUT_SIZE;
  load_ui_gfx(&front);
  UiGfx back = { 0 };
  back.uiGfxID = 0x80; back.unk2B = 0; back.layout = &noLayout; back.unk28 = 0; back.unk29 = 0; back.unk2A = 0x15;
  back.tiles = at + BACKGROUND_TILES; back.tilesSize = BACKGROUND_TILES_SIZE;
  back.palette = at + BACKGROUND_PALETTE; back.paletteSize = BACKGROUND_PALETTE_SIZE;
  back.layout_ = at + BACKGROUND_LAYOUT; back.layoutSize = BACKGROUND_LAYOUT_SIZE;
  load_ui_gfx(&back);
}

// the colours of sprite palette row 3 (0x08061E50 for its first frames, CreateCourseSelect for Time Attack)
static void load_row3(void) {
  UiSlot layout;
  UiGfx g = { 0 };
  ui_graphics(ROW_3_GFX, &g.tiles, &g.palette, &layout);
  g.uiGfxID = ROW_3_GFX; g.unk2B = 0; g.layout = &layout;
  g.unk28 = 3; g.unk2A = 0xC; g.vramC = OBJ_VRAM + 0x20; g.tilesSize = 0x20; g.paletteSize = 0x20;
  load_ui_gfx(&g);
}

// theMoonOpens, as the game asks it of the save, for the level being played: the extra stage opens for Sonic alone,
// with all seven Chaos Emeralds, once every character has cleared X Zone, from X Zone on, and never when the Moon has
// been beaten and the game is on X Zone from the course select
static int moon_opens(void) {
  return ctx.character == 0 && ctx.currentLevel >= X_ZONE && SAVE_CHAOS_EMERALDS == ALL_EMERALDS
    && save_unlocked_level(0) > X_ZONE && save_unlocked_level(1) > X_ZONE
    && save_unlocked_level(2) > X_ZONE && save_unlocked_level(3) > X_ZONE
    && !(save_unlocked_level(0) == MOON_BEATEN && ctx.startLevel == X_ZONE);
}

// the scroll a step nearer what it's going to, a fifth of the way
static void move_scroll(void) {
  screen.scroll = (int)((uint32_t)(screen.scroll + bios_div((screen.scrollTo - screen.scroll) * 2, 10)) & 0xFFFF);
}

/** CreateCourseSelect, 0x08061914. The records' rows and the Time Attack card aren't in C yet. */
void create_course_select(void) {
  int rows = course_rows();
  play_song(SONG_COURSE_SELECTION);
  create_ui_task();
  ui_gfx_stack_init();
  e.dispCnt = 0x1340;
  e.bgCnt[0] = 0x1D83;
  e.bgCnt[1] = 0x1886;
  for (int i = 0; i < 4; i++) e.bgScroll[i] = 0;
  // the widescreen view (e.wideBars) isn't drawn in C yet
  load_background(OFFSET_COURSE_SELECT_BACKGROUND);

  memset(&screen, 0, sizeof screen);
  screen.rows = rows;
  screen.records = 0;
  screen.frame = 0; screen.ending = 0; screen.shown = 0;
  screen.scroll = 0x14; screen.scrollTo = 0x14; screen.level = 1;
  screen.fade = create_fade(0, 1, 2, 0, 0x200, 1);
  Task *main = create_task(slide_in, &screen, 0x2000, 0, NULL);
  screen_sprite(&screen.arrow, ANIM_ARROW_UP, OBJ_VRAM + ARROW_TILES_AT);
  screen.tasks[0] = create_task(show_arrows, &screen, 0x2030, 0, NULL);
  update_sprite(&screen.arrow, 0);
  // only link play shows it, but its first frame's tiles and colours load all the same
  Sprite wait;
  screen_sprite(&wait, ANIM_VS_MENU_WAIT, OBJ_VRAM + WAIT_TILES_AT);
  wait.x = 120; wait.y = 80; wait.oamFlags = 0x80; wait.frameFlags = 0x2000;
  update_sprite(&wait, 0);
  for (int i = 0; i < rows; i++) {
    screen_sprite(&screen.acts[i], ANIM_ACTS, OBJ_VRAM + ACT_TILES_AT + i * COURSE_ACT_TILES);
    screen.acts[i].variant = (uint8_t)i; screen.acts[i].oamFlags = 0x480; screen.acts[i].frameFlags = 0x2000;
    update_sprite(&screen.acts[i], 0);
  }
  screen.tasks[1] = create_task(slide_acts, &screen, 0x2030, 0, NULL);
  for (int i = 0; i < 8; i++) {
    screen_sprite(&screen.zones[i], ZONES[i], OBJ_VRAM + ZONE_TILES_AT + i * ZONE_TILES);
    screen.zones[i].oamFlags = 0x480; screen.zones[i].frameFlags = 0x2000;
    update_sprite(&screen.zones[i], 0);
  }
  screen.tasks[2] = create_task(slide_zones, &screen, 0x2030, 0, NULL);
  create_task(watch_start_point, NULL, 0x1FFF, 0, NULL);
  fade_step(&screen.fade);
  (void)main;
}

// a start point at an act opens it at the A that would have chosen it, while the original plays its title card
static int take_start_point(Task *t) {
  int level = (int)gba_start_number("level", -1);
  if (!(e.pressed & KEY_A) || level != ACT_LEVEL_CASINO_PARADISE_2 || gba_start_number("power", 0) != 2) return 0;
  if (front_frame() < (uint32_t)gba_start_number("at", 0)) return 0;
  destroy_tasks(0x2001, 0x3000);
  t->main = idle;
  act_active = 1;
  act_start(level, (int)gba_start_number("card", -1), (int)gba_start_number("pre", 0));
  act_frame_now();
  return 1;
}

// Task_CourseSelectInit, 0x08061E50: the colours, and the picture's bands apart by what's left of the slide: 12 lines
// at the scroll, and then bands of 24 lines, each below a gap of 64 - frame lines that show the map's first rows
static void slide_in(Task *t) {
  if (take_start_point(t)) return;
  int frame = screen.frame + 1;
  screen.scrollTo = frame == SLIDE_END && screen.rows == 1 ? 0 : 0x14;
  screen.scroll = 0x14;
  if (frame <= 10) load_row3();
  screen.frame = frame;
  move_scroll();
  fade_step(&screen.fade);
  set_hblank_copy(REG_BG0HOFS, 4);
  int line = 0;
#define PUT(v) do { put16(e.primary + line * 4, 0); put16(e.primary + line * 4 + 2, (uint32_t)(v)); line++; } while (0)
  for (int i = 0; i < 12; i++) PUT(0x14);
  for (int band = 0; line < 160; band++) {
    for (int i = 0; i < 64 - frame && line < 160; i++) PUT((-line) & 0x1FF);
    int y = (band * 24 - line + 32) & 0xFF;
    for (int i = 0; i < 24 && line < 160; i++) PUT(y);
  }
#undef PUT
  if (frame == SLIDE_END || (e.pressed & KEY_A)) {
    e.bgScroll[1] = 0x14;
    screen.frame = SLIDE_END;
    e.bgCnt[0] = 0x9D83;
    e.flags &= ~FLAGS_HBLANK_COPY;
    t->main = choose_act;
  }
}

// Task_8062140: Up and Down choose, and the lists scroll two rows at a time to keep the choice in view. A on the
// first frame after the slide only stops the song.
static void idle(Task *t) { (void)t; }
static void choose_act(Task *t) {
  if (take_start_point(t)) return;
  int frame = screen.frame + 1;
  if (screen.rows > 1) {
    if (e.repeated & KEY_DOWN) {
      if (screen.level < screen.rows - 1) { play_song(SONG_MENU_CURSOR); screen.level++; }
    } else if (e.repeated & KEY_UP) {
      if (screen.level > 1) { play_song(SONG_MENU_CURSOR); screen.level--; }
    }
  }
  if (screen.level > bios_div(screen.scrollTo, 24) + 5) {
    // the last row before the Moon Zone's stops short, as nothing comes after it unless the Moon has opened
    if (!moon_opens() && screen.rows > 13 && screen.level == 13) screen.scrollTo = (screen.level - 5) * 24 - 8;
    else screen.scrollTo = (((screen.level - 5) & 0x1E) + 1) * 24 - 8;
  } else if (screen.level <= bios_div(screen.scrollTo, 24)) {
    int to = screen.level * 24 - 8;
    screen.scrollTo = to > 16 ? ((screen.level & ~1) - 1) * 24 - 8 : to;
  }
  screen.frame = frame;
  move_scroll();
  screen.shown = screen.ending;
  fade_step(&screen.fade);
  if (screen.fade.unk6 > 0x1800 && screen.fade.unk4 == 2) {
    if (e.pressed & KEY_A) {
      // the song goes on into Time Attack's records of the act
      if (ctx.gameMode != GAME_MODE_TIME_ATTACK) stop_song(SONG_COURSE_SELECTION);
      if (frame > 64) leave_choose(t, CHOSEN, SONG_SELECT);
    } else if (e.pressed & KEY_B) {
      stop_song(SONG_COURSE_SELECTION);
      leave_choose(t, BACK, SONG_RETURN);
    }
  }
  e.bgScroll[1] = (uint16_t)screen.scroll;
}

// the fade turned round from where it is
static void leave_choose(Task *t, int ending, int song) {
  screen.ending = ending;
  t->main = fade_out;
  play_song(song);
  screen.fade.unk4 = 1;
  screen.fade.unk6 = s16(0x2000 - screen.fade.unk6);
}

// Task_8062540: out to black; then the act chosen, whose level is one less than its row, or back
static void fade_out(Task *t) {
  screen.frame++;
  if (screen.rows == 1) screen.scrollTo = 0;
  move_scroll();
  screen.shown = screen.ending;
  fade_step(&screen.fade);
  if (screen.fade.unk6 > 0x1800 && screen.fade.unk4 == 1) {
    e.dispCnt &= 0x1FFF;
    e.bldCnt = 0;
    e.bldY = 0;
    e.bgCnt[0] = 0x9D03;
    e.bgCnt[1] = 0x1806;
    for (int i = 0; i < 3; i++) destroy_task(screen.tasks[i]);
    destroy_task(t);
    if (screen.ending == CHOSEN) front_play(screen.level - 1);
    else if (ctx.select) create_character_select(0);
    else create_main_menu(1);
    return;
  }
  e.bgScroll[1] = (uint16_t)screen.scroll;
}

// Task_8062E18: the arrow at the top, once the list has scrolled, and flipped at the bottom while there's more below
static void show_arrows(Task *t) {
  (void)t;
  Sprite *s = &screen.arrow;
  if (screen.scroll != 0x14) {
    s->frameFlags &= ~SPRITE_Y_FLIP;
    s->x = 48;
    s->y = 24;
    update_sprite(s, 0);
    display_sprite(s);
    if (screen.rows > 6 && screen.scroll < LAST_SCROLL[screen.rows - 1]) {
      s->frameFlags |= SPRITE_Y_FLIP;
      s->x = 48;
      s->y = 136;
      display_sprite(s);
    }
  } else if (screen.rows > 7 && screen.scroll < LAST_SCROLL[screen.rows - 1]) {
    s->frameFlags |= SPRITE_Y_FLIP;
    s->x = 48;
    s->y = 136;
    update_sprite(s, 0);
    display_sprite(s);
  }
}

// Task_8062A80: the acts, each further apart by what's left of the slide
static void slide_acts(Task *t) {
  for (int i = 1; i < screen.rows; i++) {
    Sprite *s = &screen.acts[i];
    s->palId = i == screen.level ? 1 : 0;
    s->x = i == screen.level ? 0x4C : 0x48;
    s->y = (int16_t)((i - 1) * 24 + i * (64 - screen.frame) + 16);
    s->frameFlags |= SPRITE_KEEP_PALETTE;
    update_sprite(s, 0);
    display_sprite(s);
  }
  if (screen.frame == SLIDE_END) t->main = show_acts;
}

// Task_8062B38: the eight rows in view, the chosen one further right in its lit colours, blinking once chosen
static void show_acts(Task *t) {
  (void)t;
  int i = (bios_div(screen.scroll, 24) - 1) & 0xFF;
  for (int n = 0; n < 8; n++, i = (i + 1) & 0xFF) {
    if (i == 0 || i > screen.rows - 1) continue;
    Sprite *s = &screen.acts[i];
    if (i == screen.level) {
      s->palId = screen.shown == CHOSEN ? screen.frame & 1 : 1;
      s->x = 0x4C;
    } else {
      s->x = 0x48;
      s->palId = 0;
    }
    s->y = s16(i * 24 - (screen.scroll - 12));
    update_sprite(s, 0);
    display_sprite(s);
  }
}

// Task_8062C28: the zones' names, further apart by twice what's left of the slide, each once its first act is there
static void slide_zones(Task *t) {
  for (int i = 1; i < 6; i++) {
    Sprite *s = &screen.zones[i - 1];
    s->palId = 0;
    s->x = 212;
    s->y = (int16_t)((i - 1) * 48 + i * ((64 - screen.frame) << 1) + 0x21);
    if (screen.rows > (i - 1) * 2 + 1) {
      update_sprite(s, 0);
      display_sprite(s);
    }
  }
  if (screen.frame == SLIDE_END) t->main = show_zones;
}

// Task_8062CB4: the zones in view; the last two, a row each, sit closer, and the Moon Zone's shows beside the
// fifteenth row alone
static void show_zones(Task *t) {
  (void)t;
  int scrolled = screen.scroll > 0x2F;
  int i = (bios_div(screen.scroll, 48) - (scrolled ? 1 : 0)) & 0xFF;
  for (int n = 0; n < (scrolled ? 6 : 5); n++, i = (i + 1) & 0xFF) {
    if (i >= 8) continue;
    Sprite *s = &screen.zones[i];
    s->x = 212;
    s->palId = 0;
    int y = i * 0x30 - (screen.scroll - 0x37);
    if (i == 6) y -= 12;
    if (i == 7) y -= 36;
    s->y = s16(y);
    if (screen.rows > i * 2 + 1 || (i == 7 && ctx.character == 0 && screen.rows == 15)) {
      update_sprite(s, 0);
      display_sprite(s);
    }
  }
}
