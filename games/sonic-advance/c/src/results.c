// The act's results (SAT-R decompilation, src/game/sa1/ui/stage_results.c: CreateStageResults, Task_8057888 and the
// four tasks it runs), translated from the JavaScript version's engine/results.js and rom/results.js. They play the
// act-clear jingle, switch the music manager off, and put up a white band with "SONIC GOT THROUGH ACT 1"
// scrolling along it, then the time bonus and the ring bonus, each label's letters and figures growing in one by one.
// From the 182nd frame both bonuses count down 100 a frame into the score, with a tick every fourth frame of the
// stage clock and a chime at the end, when the camera stops and Sonic, off the right of the screen, is stopped too.
// A while later the texts slide away and the screen fades to black, all but the band, and 45 frames into the fade
// the next act starts.
//
// About the recording's frames 6068-6092 and 6216-6240 (top of the screen, x 38 to 49, y 0 to 7): the JavaScript
// engine differed from the original there, and the results do not draw those pixels. They are a firework of the
// background, and the results draw nothing above y 42. The original's Casino Paradise background update
// (StageBgUpdate_Zone3Acts12) subtracts the camera's loop shift from where it puts the sky (x -= cam->unk20,
// y -= cam->unk24, which sub_80232D0 adds to as Sonic passes the loop point) and each firework's task
// (Task_UpdateFireworkAnimation) puts it at its world position less the background's, so the fireworks keep their
// place in the sky after the loop. The JavaScript engine used the camera's position alone and drew them about
// 2 px too far right. The fix is not here but in the act: see the report about `casino_background_update`.

#include "act.h"
#include "objects.h"
#include "results.h"

// the songs and sounds the results play (songs.js)
enum { SONG_ACT_CLEAR = 33, SONG_BOSS_CLEAR = 34, SONG_FINAL_CLEAR = 35, SONG_RESULTS_COUNT = 140, SONG_RESULTS_DONE = 141 };

#define UI_FONT 0
#define UI_RESULT_SONIC 11
#define UI_BAR 16
#define UI_RESULT_TEXT 34
#define TILE 32
#define FINAL_LEVEL_FROM LEVEL_X_ZONE   // IS_FINAL_OR_EXTRA_STAGE: X Zone and the Moon Zone

#define NAME_TILES 48
#define TEXT_TILES 80
#define NAME_COLORS 6
#define BAND_TILES 16
#define LETTER_TILES 24
#define DIGIT_TILES 20
#define DIGIT_FROM_TILE 32   // the HUD's white digits in the font
#define LINE_PALETTE 12
#define FONT_PALETTE 6

// where each piece's tiles lie: the band at a place of its own in the sprites' tiles, which the next act's title card
// draws from too (sub_80550F8), the line in one block from the heap, and the letters and the digits in another
#define BAND_VRAM (OBJ_VRAM + 0x1000)
#define LINE_BLOCK_TILES (NAME_TILES + TEXT_TILES)
#define LETTERS_AT 0
#define DIGITS_AT (LETTERS_AT + LETTER_TILES)
#define FONT_BLOCK_TILES (DIGITS_AT + DIGIT_TILES)

// the texts, after the title card's tables: [offset in the card's table, length]
#define TEXT_RING 0x8C
#define TEXT_TIME 0x97
#define TEXT_BAND 0xA4
#define TEXT_LINE 0xB0
#define LABEL 11                  // a label's glyphs, then five places for the figure, leading zeros blank
#define PLACES 16
#define BLANK (0x2B - 32)
#define LINE_LENGTH 25
#define BAND_LENGTH 12

#define MATRICES_UNTIL 135
#define MATRIX_FIRST 20
#define MATRIX_COUNT 12
#define TALLY_FROM 181
#define FADE_AFTER 240
#define SLIDE_AFTER 230
#define NEXT_ACT_AFTER 45
#define ENDING_AFTER 135
#define STEP 100
#define FADE_FULL 0x2000
#define FADE_SPEED 0x100
#define TOP_TIME_BONUS 80000
#define RING_AFTER 90
#define TIME_AFTER 60
#define BASE_WAIT 75

// the glyph slots a piece draws from
enum { SLOT_BAND, SLOT_LINE, SLOT_LETTERS, SLOT_DIGITS, SLOTS };
enum { PIECE_BAND, PIECE_LINE, PIECE_RING, PIECE_TIME, PIECES };

typedef struct { int shape, size, wide, high, perGlyph, tile, pal; } Slot_;

// a text task's piece (StrcStgResults_34): `x`, `y` and `count` are qUnkA, unkC and unkE, `shift` unk1E,
// `order` its OAM order
typedef struct {
  int x, y, count, order, shift, value, after;
  int text[PLACES];
} Piece;

typedef struct {
  int active, level, wait, longEnd, frame, ring, time, countdown, skipFirst, fading, display;
  int fadeLevel, fadeSpeed, bldY;
  uint32_t vram, fontVram;   // the line's block, and the letters' and digits'
  Slot_ slot[SLOTS];
  int bandText[BAND_LENGTH], lineText[LINE_LENGTH], ringLabel[LABEL], timeLabel[LABEL];
  Piece p[PIECES];
} Results;

static Results r;
static Graphics copies[12];
static int copyCount;
static int countStart;   // the counter tick's song starts on the next sound frame, as the original's MPlayStart does

static void copy_in(uint32_t src, uint32_t dest, uint32_t size) {
  Graphics *g = &copies[copyCount++];
  g->src = src; g->dest = dest; g->size = size & 0xFFFF; g->anim = 0; g->ram = NULL;
  queue_graphics(g);
}

// the CreateStageResults' time bonus by the course time
static int time_bonus(int courseTime) {
#define CT(m, s) (((m) * 60 + (s)) * 60)
  static const int FROM[] = { CT(6, 0), CT(5, 0), CT(4, 0), CT(3, 0), CT(2, 0), CT(1, 30), CT(1, 0), CT(0, 50), CT(0, 30) };
  static const int BONUS[] = { 0, 500, 1000, 2000, 3000, 4000, 5000, 10000, 50000 };
#undef CT
  for (int i = 0; i < 9; i++) if (courseTime >= FROM[i]) return BONUS[i];
  return TOP_TIME_BONUS;
}

// the bonus's figure under its label, as its task rewrites it: sixteen places, the label over the first eleven,
// and the figure's leading zeros (but the last place) blank
static void figure(int *text, const int *label, int value) {
  for (int i = PLACES - 1; i >= 0; i--) { text[i] = value % 10; value /= 10; }
  for (int i = LABEL; i < PLACES - 1 && text[i] == 0; i++) text[i] = BLANK;
  for (int i = 0; i < LABEL; i++) text[i] = label[i];
}

static Slot_ slot_of(int id, uint32_t *tiles, uint32_t *palette) {
  UiSlot l;
  ui_graphics(id, tiles, palette, &l);
  Slot_ s = { l.unk9, l.unk8, l.unkA * 8, l.unkB * 8, (int)l.unk4, 0, 0 };
  return s;
}

// sub_8056FE4: the pieces' tiles into the block of OBJ VRAM CreateStageResults took, and their colours
static void load_graphics(int level, int character) {
  uint32_t fontTiles, fontPalette, barTiles, barPalette, nameTiles, namePalette, textTiles, textPalette;
  r.slot[SLOT_LETTERS] = slot_of(UI_FONT, &fontTiles, &fontPalette);
  r.slot[SLOT_DIGITS] = r.slot[SLOT_LETTERS];
  r.slot[SLOT_BAND] = slot_of(UI_BAR, &barTiles, &barPalette);
  r.slot[SLOT_LINE] = slot_of(UI_RESULT_SONIC + character, &nameTiles, &namePalette);
  slot_of(UI_RESULT_TEXT, &textTiles, &textPalette);
  // the text tiles of the line by level: the first act's, the second act's (0x50 on), X Zone's and the Moon Zone's
  int textAt = level == LEVEL_THE_MOON ? 0xF0 : level == LEVEL_X_ZONE ? 0xA0 : level & 1 ? 0x50 : 0;

  r.vram = vram_malloc(LINE_BLOCK_TILES);
  r.fontVram = vram_malloc(FONT_BLOCK_TILES);
  int fontTile = (int)((r.fontVram - OBJ_VRAM) >> 5);
  r.slot[SLOT_BAND].tile = (int)((BAND_VRAM - OBJ_VRAM) >> 5);
  r.slot[SLOT_LINE].tile = (int)((r.vram - OBJ_VRAM) >> 5);
  r.slot[SLOT_LETTERS].tile = fontTile + LETTERS_AT;
  r.slot[SLOT_DIGITS].tile = fontTile + DIGITS_AT;
  r.slot[SLOT_BAND].pal = FONT_PALETTE; r.slot[SLOT_LETTERS].pal = FONT_PALETTE; r.slot[SLOT_DIGITS].pal = FONT_PALETTE;
  r.slot[SLOT_LINE].pal = LINE_PALETTE;

  copyCount = 0;
  copy_in(barTiles, BAND_VRAM, BAND_TILES * TILE);
  copy_in(nameTiles, r.vram, NAME_TILES * TILE);
  copy_in(textTiles + (uint32_t)textAt * TILE, r.vram + NAME_TILES * TILE, TEXT_TILES * TILE);
  // the font's letters it uses, in the order sub_8056FE4 puts them: R S T U, M N O, B, E, G, I and the blank
  static const int LETTERS[][2] = { { 100, 8 }, { 90, 6 }, { 68, 2 }, { 74, 2 }, { 78, 2 }, { 82, 2 }, { 146, 2 } };
  int to = 0;
  for (int i = 0; i < 7; i++) {
    copy_in(fontTiles + (uint32_t)LETTERS[i][0] * TILE, r.fontVram + (LETTERS_AT + to) * TILE, (uint32_t)LETTERS[i][1] * TILE);
    to += LETTERS[i][1];
  }
  copy_in(fontTiles + DIGIT_FROM_TILE * TILE, r.fontVram + DIGITS_AT * TILE, DIGIT_TILES * TILE);

  // OBJ palette 6 is the font's, palette 12 the line's with the name's first six colours over them
  for (int i = 0; i < 16; i++) e.objPalette[FONT_PALETTE * 16 + i] = (uint16_t)rom_u16(fontPalette + (uint32_t)i * 2);
  for (int i = 0; i < 16; i++) e.objPalette[LINE_PALETTE * 16 + i] = (uint16_t)rom_u16(textPalette + (uint32_t)i * 2);
  for (int i = 0; i < NAME_COLORS; i++) e.objPalette[LINE_PALETTE * 16 + i] = (uint16_t)rom_u16(namePalette + (uint32_t)i * 2);
  e.flags |= FLAGS_UPDATE_OBJ_PALETTES;
}

static void read_text(int *to, uint32_t at, int n) {
  for (int i = 0; i < n; i++) to[i] = (int)rom_u8(OFFSET_TITLE_CARD + at + (uint32_t)i) - 32;
}

void results_start(int level, int rings, int courseTime, int longEnd, int nextFrame) {
  memset(&r, 0, sizeof r);
  countStart = 0;
  r.active = 1;
  r.level = level; r.longEnd = longEnd; r.skipFirst = nextFrame;
  r.ring = STEP * rings;
  r.time = time_bonus(courseTime);
  r.wait = (r.ring > r.time ? r.ring : r.time) / STEP + BASE_WAIT;
  r.countdown = NEXT_ACT_AFTER;
  r.fadeSpeed = FADE_SPEED;
  load_graphics(level, 0);
  read_text(r.bandText, TEXT_BAND, BAND_LENGTH);
  read_text(r.lineText, TEXT_LINE, LINE_LENGTH);
  read_text(r.ringLabel, TEXT_RING, LABEL);
  read_text(r.timeLabel, TEXT_TIME, LABEL);

  Piece *band = &r.p[PIECE_BAND], *line = &r.p[PIECE_LINE], *ring = &r.p[PIECE_RING], *time = &r.p[PIECE_TIME];
  band->x = 240; band->y = 126; band->count = 8; band->order = 1;
  line->x = 256; line->y = 128; line->count = 9; line->order = 0;
  ring->x = 256; ring->y = 102; ring->count = 16; ring->value = r.ring; ring->after = RING_AFTER;
  time->x = 256; time->y = 80; time->count = 16; time->value = r.time; time->after = TIME_AFTER;
  figure(ring->text, r.ringLabel, r.ring);
  figure(time->text, r.timeLabel, r.time);

  // the act-clear jingle: X Zone's, a zone's second act's (after its boss), or an act's
  play_song(level == LEVEL_X_ZONE ? SONG_FINAL_CLEAR : level & 1 ? SONG_BOSS_CLEAR : SONG_ACT_CLEAR);
  music_call(MUSIC_OFF, 0);
}

int results_active(void) { return r.active; }

// one sprite into OAM from its attribute words
static void put_oam(int order, uint16_t a0, uint16_t a1, int pal, int tile) {
  int k = alloc_oam((uint32_t)order);
  if (k < 0) return;
  e.oamMalloc[k * 4] = a0;
  e.oamMalloc[k * 4 + 1] = a1;
  e.oamMalloc[k * 4 + 2] = (uint16_t)((pal << 12) | (tile & 0x3FF));
}

// sub_8052F78 (semi-transparent) and sub_80530CC: `count` sprites of `slot` showing `text` from its `from`th
// glyph, in a row from (x, y). Each keeps where it is within OAM's 9 bits, as the title card's do.
static void put(int slot, const int *text, int from, int x, int y, int count, int order, int semi) {
  const Slot_ *s = &r.slot[slot];
  uint16_t a0 = (uint16_t)((s->shape << 14) + (y & 0xFF) + (semi ? 0x400 : 0));
  for (int i = 0; i < count; i++) {
    uint16_t a1 = (uint16_t)((s->size << 14) + ((x + s->wide * i) & 0x1FF));
    put_oam(order, a0, a1, s->pal, s->tile + text[from + i] * s->perGlyph);
  }
}

// sub_8052E40: one glyph through the rotation hardware, double size, with matrix `matrix` (20 to 31, which
// Task_8057888 squashes to 1/12 to 11/12 of the glyph's height); its box is twice the glyph's size
static void put_affine(int slot, int glyph, int x, int y, int matrix, int order) {
  const Slot_ *s = &r.slot[slot];
  uint16_t a0 = (uint16_t)((s->shape << 14) + (3 << 8) + (y & 0x1FF));
  uint16_t a1 = (uint16_t)((s->size << 14) + (matrix << 9) + x);
  put_oam(order, a0, a1, s->pal, s->tile + glyph * s->perGlyph);
}

// Task_8057B74: the band slides in from the right along the bottom 26 px a frame, rises 6 px a frame to y 42,
// and (on a zone's second act) slides out to the left; semi-transparent once the fade starts
static void band_task(Piece *p, int k) {
  if (k > r.wait + SLIDE_AFTER) {
    if (r.level & 1 || r.level > 11) {
      if (p->x < -32) { p->x = s16(p->x + 32); if (p->count != 0) p->count = s16(p->count - 1); }
      p->x = s16(p->x - 26);
    }
  } else if (k >= 50) { p->count = 9; p->y = 42; }
  else if (k >= 36) p->y = s16(p->y - 6);
  else if (k >= 26) p->x = -16;
  else if (k >= 16) { p->x = s16(p->x - 26); if (p->x < -16) p->x = -16; }
  put(SLOT_BAND, r.bandText, 0, p->x, p->y, p->count, p->order, k > r.wait + FADE_AFTER);
}

// Task_8057C3C: the line comes in from the right 28 px a frame on top of the band, rises with it and scrolls
// left 2 px a frame, a glyph on every 32 px; it leaves to the left 28 px a frame, a sprite fewer every 32 px
static void line_wrap(Piece *p) { p->x = s16(p->x + 32); p->shift = (p->shift + 1) % 8; }
static void line_draw(Piece *p) { put(SLOT_LINE, r.lineText, p->shift, p->x, p->y, p->count, p->order, 0); }
static void line_task(Piece *p, int k) {
  if (k > r.wait + SLIDE_AFTER) {
    p->x = s16(p->x - 28);
    if (p->x < -31) { if (p->count != 0) p->count = s16(p->count - 1); line_wrap(p); }
    line_draw(p);
  } else if (k >= 50) {
    p->y = 44; p->x = s16(p->x - 2);
    if (p->x < -31) line_wrap(p);
    line_draw(p);
  } else if (k >= 36) {
    p->y = s16(p->y - 6); p->x = s16(p->x - 2);
    if (p->x < -31) line_wrap(p);
    line_draw(p);
  } else if (k >= 26) {
    p->x = s16(p->x - 2); p->count = 9;
    if (p->x < -31) line_wrap(p);
    line_draw(p);
  } else if (k >= 16) {
    p->x = s16(p->x - 28);
    if (p->x < 240) {
      p->count = 9 - (p->x >> 5);
      if (p->x < -31) line_wrap(p);
      line_draw(p);
    }
  }
}

// Task_8057D30 (the ring bonus, `y` 102, from frame 90) and Task_805803C (the time bonus, `y` 80, from frame
// 60): two frames apart, each of the label's letters and then the figure's digits grows in through the
// rotation hardware over 12 frames (11 for the time bonus) and stays; the figure follows the count from frame
// 134; once the band is up they leave to the left 28 px a frame
static void bonus_task(Piece *p, int k, int ring) {
  int y = p->y, step = k > p->after ? k - p->after : 0, last = ring ? 12 : 11;
  const int *label = ring ? r.ringLabel : r.timeLabel;
  if (k > 133) figure(p->text, label, p->value);
  int out = k > r.wait + SLIDE_AFTER ? s16((k - SLIDE_AFTER - r.wait) * 28) : 0;
  const int *t = p->text;
  if (step > (ring ? 150 : 180)) {
    int x = s16(50 - out);
    if (x >= -80) put(SLOT_LETTERS, t, 0, x, y, 10, p->order, 0);
    for (int i = LABEL; i < PLACES; i++) {
      int dx = s16(i * 8 - (out - 50));
      if (t[i] != BLANK && dx >= -8) put(SLOT_DIGITS, t, i, dx, y, 1, p->order, 0);
    }
  } else if (step > 44) {
    put(SLOT_LETTERS, t, 0, 50, y, 10, p->order, 0);
    int i = LABEL;
    while (i < PLACES - 1 && t[i] == BLANK) i++;
    put(SLOT_DIGITS, t, i, s16(i * 8 + 50), y, PLACES - i, p->order, 0);
  } else {
    int shown = (step / 2) & 0xFF;
    if (shown > PLACES) shown = PLACES;
    if (shown == 0) return;
    int done = 0;
    for (int i = 0; i < shown; i++) {
      int age = step - i * 2;
      if (age > last) { done++; continue; }
      if (i >= LABEL && t[i] == BLANK) continue;
      int gy = (0x100 - age * 21) / 35 + y - 8;   // the BIOS's Div rounds toward zero, as C's / does
      int matrix = ring && age == 12 ? 31 : age + MATRIX_FIRST;
      put_affine(i < LABEL ? SLOT_LETTERS : SLOT_DIGITS, t[i], i * 8 + 46, gy, matrix, p->order);
    }
    if (done > LABEL) {
      int i = LABEL;
      while (i < PLACES - 1 && t[i] == BLANK) i++;
      put(SLOT_DIGITS, t, i, i * 8 + 50, y, done - i, p->order, 0);
      done = LABEL;
    }
    put(SLOT_LETTERS, t, 0, 50, y, done, p->order, 0);
  }
}

// sub_805423C as the results set it up: window 0 over the whole screen and the brightness decrease on every
// layer, by level / 256 / 2 sixteenths, then the level rises by `speed`
static void fade_out(void) {
  int l = r.fadeLevel >> 8;
  r.bldY = (l > 32 ? 32 : l) >> 1;
  r.fadeLevel += r.fadeSpeed;
  if (r.fadeLevel > FADE_FULL) r.fadeLevel = FADE_FULL;
  r.fading = 1;
}

int results_run(void) {
  if (!r.active) return 0;
  if (r.skipFirst) { r.skipFirst = 0; return 1; }
  // the counter tick's call, from the frame before: the original's m4aSongNumStart stops the song's player at the
  // call and its new track starts on the next sound frame, so the frame it is called in is silent
  if (countStart) { countStart = 0; play_song(SONG_RESULTS_COUNT); }
  int k = r.frame;   // what the pieces see this frame (unk1C)
  r.fading = 0;
  // the matrices the growing glyphs share: 1/12 to 11/12 of the height
  if (k < MATRICES_UNTIL) {
    for (int i = 0; i < MATRIX_COUNT; i++) set_ui_affine(0, 0x100, i != 0 ? (i << 8) / MATRIX_COUNT : 1, i + MATRIX_FIRST);
  }
  int next = 0;
  if (k >= TALLY_FROM) {
    if (r.ring != 0 || r.time != 0) {
      if (r.ring != 0) { r.ring -= STEP; world_add_score(STEP); r.p[PIECE_RING].value = r.ring; }
      if (r.time != 0) { r.time -= STEP; world_add_score(STEP); r.p[PIECE_TIME].value = r.time; }
      if (r.ring == 0 && r.time == 0) {
        if (!(r.level & 1)) act.player.actClear = 0;
        act.cam.speedX = 0; act.cam.speedY = 0;
        r.countdown = r.longEnd ? ENDING_AFTER : NEXT_ACT_AFTER;
        play_song(SONG_RESULTS_DONE);
      } else if (act_stage_time() % 4 == 0) {
        // the last tick is the one the original starts a frame later, with the done chime after it; the ticks before
        // it are heard a frame later too, which the proof's sound window takes in
        if (r.ring <= STEP && r.time <= STEP) {
          gba_sound_stop_player(gba_sound_song_player(SONG_RESULTS_COUNT));
          countStart = 1;
        } else play_song(SONG_RESULTS_COUNT);
      }
    } else {
      // the bonuses counted: the camera stays, and Sonic stops once he is off the right of the screen
      Player *p = &act.player;
      Camera *cam = &act.cam;
      cam->speedX = 0; cam->speedY = 0;
      if ((uint32_t)((int)__builtin_floor(p->x) - (int)__builtin_floor(cam->x) + 64) > 368u) {
        p->xsp = 0; p->gsp = 0;
        // the CPU partner is stopped here too when he is past the screen, but this version has none
      }
      if (k > r.wait + FADE_AFTER) {
        if (r.level < FINAL_LEVEL_FROM) fade_out();   // X Zone's and the Moon's stay on the screen
        if (r.countdown == 0 || --r.countdown == 0) { r.countdown = 0; next = 1; }
      }
    }
  }
  // the frame the next act starts keeps the last frame's sprites: it draws nothing new
  r.display = r.fading || r.bldY;
  if (next) { r.active = 0; r.display = 0; vram_free(r.vram); vram_free(r.fontVram); return 0; }
  r.frame++;
  band_task(&r.p[PIECE_BAND], k);
  line_task(&r.p[PIECE_LINE], k);
  bonus_task(&r.p[PIECE_RING], k, 1);
  bonus_task(&r.p[PIECE_TIME], k, 0);
  return 1;
}

void results_display(void) {
  if (!r.display) return;
  // OBJ and window 0 on, BG1, BG2 and BG3 on, 1D OAM, and BG0 as the stage's background update left it: the results'
  // tasks never write the display, so Ice Mountain's snow stays on through the fade
  e.dispCnt = (uint16_t)(0x3E40 | (e.dispCnt & 0x100));
  e.winRegs[0] = 0x00F0; e.winRegs[2] = 0x00A0;
  e.bldCnt = 0x3FFF; e.bldAlpha = 0x0010; e.bldY = (uint16_t)r.bldY;
}

int results_wait_total(void) {
  return r.wait + 285;
}
