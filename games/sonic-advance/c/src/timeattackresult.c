// The Time Attack result, translated from front/timeattackresult.js (SAT-R's src/game/sa1/ui/time_attack_results.c:
// CreateTimeAttackResult and its task), put up over the act in place of the act's results when the character reaches
// the goal: bands of the act's colours sliding in, the time of the run in the UI font, TIME, and, once the run is the
// best on the course, NEW RECORD with its own jingle. It lasts 330 frames (600 with a record), the last 60 of them
// fading the screen out, and then the game goes on as after the act's results (GoToNextLevel), to the lobby.

#include "sa.h"

enum { UIGFX_TIMER_DIGITS = 32, UIGFX_BAND = 16, UIGFX_LEVEL_TEXT = 34, UIGFX_CHARACTER = 11 };
// by the act's number: tiles of the level text's graphics to skip (the boss's, 80 tiles in, for the second act)
enum { BOSS_TEXT_TILES = 80, TILE_SIZE = 32 };
// the animation of the two sprites (the USA ROM numbers it two lower than the decompilation's European one), with NEW
// RECORD and TIME as its variants
enum { ANIM_RESULT = 882, NEW_RECORD = 4, TIME = 3 };
enum { SONG_NEW_RECORD = 0x131, SONG_RESULT = 0x132 };
enum { FRAMES = 330, FADE_FROM = 270, RECORD_FRAMES = 600, RECORD_FADE_FROM = 540, SHOW_FROM = 60 };
// the band's pattern, in the glyphs of the level text's font
static const char PATTERN[] = {
  0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27,
  0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x00,
};

static struct {
  int active, best, frame, scroll, skipFirst;   // unkCC, unkBC, unkC0
  int fading;                                   // the fade's registers this frame, to put over the act's display
  uint16_t dispCnt, bldCnt, bldAlpha, bldY, winRegs[6];
  uint32_t vram;
  char time[8];
  Fade fade;
  UiText bands, pattern, digits;
  Sprite record, label;
} result;

static void load(int id, int slot, uint32_t tilesFrom, uint32_t tilesSize, uint32_t paletteSize, int row, uint32_t vram) {
  UiSlot layout;
  UiGfx g = { 0 };
  ui_graphics(id, &g.tiles, &g.palette, &layout);
  g.uiGfxID = (uint8_t)id; g.unk2B = slot; g.layout = &layout;
  g.tiles += tilesFrom; g.tilesSize = tilesSize; g.paletteSize = paletteSize; g.unk28 = (uint8_t)row; g.vramC = vram;
  g.unk2A = 13;
  load_ui_gfx(&g);
}

// sub_8069994: the digits' tiles at `vram`, the band's, the level text's and the character's
static void load_graphics(int level, uint32_t vram) {
  ui_gfx_stack_init();
  load(UIGFX_TIMER_DIGITS, 15, 0, 0x580, 0x20, 6, vram);
  load(UIGFX_BAND, 16, 0, 0x200, 0x20, 12, OBJ_VRAM + 0x1000);
  load(UIGFX_LEVEL_TEXT, 2, level & 1 ? BOSS_TEXT_TILES * TILE_SIZE : 0, 0xA00, 0x20, 11, OBJ_VRAM + 0x1800);
  load(UIGFX_CHARACTER + ctx.character, 2, 0, 0x600, 0xC, 11, OBJ_VRAM + 0x1200);
}

static void result_sprite(Sprite *s, uint32_t dest, int variant, int x, int y, uint16_t oamFlags, uint32_t frameFlags) {
  sprite_init(s);
  s->graphics.anim = ANIM_RESULT;
  s->graphics.dest = dest;
  s->prevVariant = 0xFF;
  s->animSpeed = 0x10;
  s->variant = (uint8_t)variant;
  s->x = (int16_t)x; s->y = (int16_t)y;
  s->oamFlags = oamFlags; s->frameFlags = frameFlags;
}

/**
 * CreateTimeAttackResult for a run of `record` frames on `level`: the record registered in the save, its jingle, and
 * the music manager off. Its task first runs this frame, or with `nextFrame` on the next.
 */
void time_attack_result_start(int level, uint32_t record, int nextFrame) {
  memset(&result, 0, sizeof result);
  create_ui_task();
  result.vram = vram_malloc(44);
  load_graphics(level, result.vram);
  result.active = 1;
  result.skipFirst = nextFrame;
  result.best = save_register_time_record(ctx.character, level, record);
  play_song(result.best ? SONG_NEW_RECORD : SONG_RESULT);
  music_call(MUSIC_OFF, 0);
  result_sprite(&result.record, vram_malloc(24), NEW_RECORD, 120, 120, 0, 0);
  result_sprite(&result.label, vram_malloc(8), TIME, 40, 88, 0x480, 0x2000);
  update_sprite(&result.record, 0);
  update_sprite(&result.label, 0);
  result.bands = (UiText){ .unk8 = 0x18, .unkA = 0xF0, .unkC = 0x8C, .unkE = 8, .unk10 = 0x10, .unk12 = 0xC, .unk16 = 1 };
  result.pattern = (UiText){ .unk8 = 0, .unkA = 0xF0, .unkC = 0x8C, .unkE = 9, .unk10 = 2, .unk12 = 0xB, .unk16 = 1 };
  result.digits = (UiText){ .unk8 = 0, .unkA = 0x50, .unkC = 0x50, .unkE = 7, .unk10 = 0xF, .unk12 = 6, .unk16 = 1 };
  result.fade = create_fade(0, 1, 1, 0, 0x100, 0x10);
  time_codes(record, result.time);
}

int time_attack_result_active(void) { return result.active; }

// sub_8069FDC: the band comes in from the right, then drops up to its place
static void slide(void) {
  UiText *o = &result.bands;
  int frame = result.frame;
  if (frame > 30 && frame < 40) {
    o->unkC = (uint16_t)(o->unkC - 0xC);
    if ((int16_t)o->unkC <= 0x13) o->unkC = 0x14;
  } else if (frame < 21 && frame > 10) {
    o->unkA = (uint16_t)(o->unkA - 0x18);
    if ((int16_t)o->unkA < 0) o->unkA = 0;
  }
}

// sub_8069EE4: the sprites and the lines of text, semi-transparent (and so darkened with the rest) while it fades
static void show(int fading) {
  int solid = !fading;
  if (result.frame > SHOW_FROM) {
    if (result.best) display_sprite(&result.record);
    display_sprite(&result.label);
    draw_ui_text(result.time, &result.digits, solid);
  }
  uint16_t y = result.bands.unkC;
  draw_ui_text("        ", &result.bands, solid);
  UiText *o = &result.pattern;
  o->unkC = (uint16_t)(y + 2);
  o->unkA = (uint16_t)(o->unkA - 2);
  if ((int16_t)o->unkA < -0x1F) {
    o->unkA = (uint16_t)(o->unkA + 0x20);
    result.scroll = (result.scroll + 1) % 8;
  }
  draw_ui_text(PATTERN + result.scroll, o, solid);
}

/** Task_8069E50 for one frame. Returns 0 on the frame it ends, when the act goes on as after its results. */
int time_attack_result_run(void) {
  if (!result.active) return 0;
  if (result.skipFirst) { result.skipFirst = 0; return 1; }
  result.frame++;
  int last = result.best ? RECORD_FRAMES : FRAMES, fadeFrom = result.best ? RECORD_FADE_FROM : FADE_FROM;
  if (result.frame > last) {
    e.dispCnt &= 0x1FFF;
    e.bldCnt = 0;
    e.bldY = 0;
    time_attack_result_stop();
    return 0;
  }
  int fading = 0;
  if (result.frame > fadeFrom) {
    fade_step(&result.fade);
    fading = 1;
    result.dispCnt = e.dispCnt; result.bldCnt = e.bldCnt; result.bldAlpha = e.bldAlpha; result.bldY = e.bldY;
    memcpy(result.winRegs, e.winRegs, sizeof result.winRegs);
  }
  result.fading = fading;
  slide();
  show(fading);
  return 1;
}

/** The fade out, set over the act's display once the frame is drawn (as results_display). */
void time_attack_result_display(void) {
  if (!result.active || !result.fading) return;
  e.dispCnt = (uint16_t)((e.dispCnt & 0x1FFF) | (result.dispCnt & 0xE000));
  e.bldCnt = result.bldCnt; e.bldAlpha = result.bldAlpha; e.bldY = result.bldY;
  memcpy(e.winRegs, result.winRegs, sizeof result.winRegs);
}

/** TaskDestructor_806A124 */
void time_attack_result_stop(void) {
  if (!result.active) return;
  result.active = 0;
  vram_free(result.record.graphics.dest);
  vram_free(result.label.graphics.dest);
  vram_free(result.vram);
}
