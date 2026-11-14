// The true ending, after the Super Egg Robo (SAT-R decompilation, src/game/sa1/ui/extra_stage_results.c:
// CreateExtraStageResults and the tasks it starts), as the JavaScript version's engine/trueending.js has it. The earth
// seen from the moon comes in from white with the Moon's results over it and four twinkles as they end; the three
// layers slide down and the scene fades to black. "A few days later", then the Tornado in the sky with Tails at the
// controls, which turns and flies off; then four pictures, the third turning into the colours of the fourth, with the
// congratulation lines over the last. One main task counts each scene's frames; the sprites' tasks after it read its
// count, and it changes what each of them runs from scene to scene. Then the staff credits (credits.c).

#include "sa.h"
#include "act.h"
#include "results.h"
#include "objects.h"

enum {
  SONG_A_FEW_DAYS_LATER = 39,
  ANIM_TWINKLE = 731, ANIM_SKY_SPARKLE = 732, ANIM_ART_A = 733, ANIM_ART_B = 734, ANIM_TORNADO_FRONT = 735,
  ANIM_TORNADO_SIDE = 736, ANIM_FEW_DAYS_LATER = 783, ANIM_FEW_DAYS_LATER_JAPANESE = 786, ANIM_LINES = 785,
  ANIM_CLOUDS = 790, ANIM_PILOT_FACE = 805, ANIM_TAILS_TURNS = 191,
  // the night scene's three backgrounds and the sky's: each a 256-colour palette, its tiles and its map
  PALETTE_BYTES = 0x200,
  SKY_PALETTE = 0x6B4B10, SKY_TILES = 0x2980, SKY_MAP = 0x1000,
  FRONT_PALETTE = 0x6B8690, FRONT_TILES = 0x57C0,
  BACK_PALETTE = 0x6BEA50, BACK_TILES = 0x1EC0,
  MIDDLE_PALETTE = 0x6C1510, MIDDLE_TILES = 0x3540,
  NIGHT_MAP = 0xA00,
  UIGFX_FROM_BASE = 0x80,
  // the congratulation lines' places, as the normal ending's: where each stops, and the count each starts up from
  OFFSET_LINE_STOPS = 0x6843B4, OFFSET_LINE_STARTS = 0x6843BA,
  // the third picture's colours turn from sprite palette 143 into 144 (gUiPaletteSoundTestBox3 and 4)
  BLEND_FROM_PALETTE = 143, BLEND_TO_PALETTE = 144, BLEND_ROW = 14, BLEND_AFTER = 0xB3, BLEND_FRAMES = 0x80,
  FADE_FRAMES = 0x2000 / 0x80,
  NIGHT_FADE = 0x21C, FEW_DAYS = 600, SKY = 0x336, PICTURE = 400, SKY_DOWN = 0x128, LINES_FROM = 0x14B,
  CLOUDS = 4, LINES = 3, TWINKLE_PLACES = 4,
  PRIORITY_MAIN = 0x2100, PRIORITY_PIECES = 0x2120,
};
#define Q(v) ((v) * 256)
#define I(v) ((v) >> 8)

/** A sprite's task (ExtraStageResults_64): its count and what the main task gives it (unk3C, unk40), its places in 8.8 */
typedef struct {
  Sprite s;
  Transform tf;
  uint32_t count, from;
  int32_t x[TWINKLE_PLACES], y[TWINKLE_PLACES];
  int line;
} Piece;

static struct {
  Fade fade;
  uint32_t count, length;
  Piece sparkle, face, tornado, twinkle, clouds[CLOUDS], caption, lines[LINES];
  Task *tSparkle, *tFace, *tTornado, *tTwinkle, *tClouds[CLOUDS], *tCaption, *tLines[LINES];
} ending;

static void nothing(Task *t) { (void)t; }
static void show(Sprite *s) { update_sprite(s, 0); display_sprite(s); }
static void place(Piece *p) { p->s.x = (int16_t)I(p->x[0]); p->s.y = (int16_t)I(p->y[0]); }

// ---- the sprites' tasks ----

// Task_806806C: the twinkles, one after another for 16 frames each once the results' tally has ended, the second at two
// places at once
static void twinkles(Task *t) {
  Piece *p = t->data;
  if (p->count <= p->from) return;
  uint8_t whole = (uint8_t)((p->count - p->from) / 16), rem = (uint8_t)((p->count - p->from) % 16);
  Sprite *s = &p->s;
  if (whole == 0 || whole == 2) {
    int at = whole == 2 ? 3 : 0;
    if (rem == 0) s->prevVariant = 0xFF;
    s->x = (int16_t)p->x[at]; s->y = (int16_t)p->y[at];
    show(s);
  } else if (whole == 1) {
    if (rem == 0) s->prevVariant = 0xFF;
    s->x = (int16_t)p->x[1]; s->y = (int16_t)p->y[1];
    show(s);
    s->x = (int16_t)p->x[2]; s->y = (int16_t)p->y[2];
    display_sprite(s);
  }
}
// Task_8067F38: a second after the tally's end the night scene's three layers slide down at their own speeds, each to
// its stop
static void slide(Task *t) {
  static const int32_t SPEED[3] = { 85, 96, 192 }, STOP[3] = { 71, 80, 160 };
  Piece *p = t->data;
  if (p->from + 60 > p->count) return;
  for (int i = 0; i < 3; i++) {
    p->y[i] += SPEED[i];
    uint16_t at = (uint16_t)I(p->y[i]);
    e.bgScroll[i * 2 + 1] = at > STOP[i] ? (uint16_t)STOP[i] : at;
  }
}
// Task_806853C: "A few days later", semi-transparent, so the fade to black leaves it alone
static void few_days_later(Task *t) {
  Piece *p = t->data;
  if (p->count < FEW_DAYS) show(&p->s);
}
// Task_8068360: a cloud drifting, round again past each edge
static void drift(Task *t) {
  Piece *p = t->data;
  p->x[0] += p->x[1];
  if (p->x[0] > Q(272)) p->x[0] = -Q(120);
  if (p->x[0] < -Q(120)) p->x[0] = Q(272);
  p->y[0] += p->y[1];
  if (p->y[0] > Q(172)) p->y[0] = -Q(16);
  if (p->y[0] < -Q(16)) p->y[0] = Q(172);
  place(p);
  show(&p->s);
}
// Task_806862C: the sparkle, from three seconds in, down and to the left to its stop
static void sparkle(Task *t) {
  Piece *p = t->data;
  if (p->count <= 180) return;
  p->x[0] -= 0x60;
  if (p->x[0] < -Q(64)) p->x[0] = -Q(64);
  p->y[0] += 0x30;
  if (p->y[0] > Q(32)) p->y[0] = Q(32);
  place(p);
  show(&p->s);
}
// the Tornado's bob: a sine wave to frame 600, then a slowing one
static int32_t bob(uint32_t k) {
  if (k <= 0x257) return SINE[(k & 0xFF) * 4] >> 9;
  return bios_div(SINE[(k - 600) * 4], 0x1A);
}
// Task_8068148: Tails in the cockpit, turning his head at 2 and at 8 seconds; once the Tornado has turned his face stays
// where it is, moved to x 140
static void face(Task *t) {
  Piece *p = t->data;
  uint32_t k = p->count;
  Sprite *s = &p->s;
  if (k == 0x78) { s->graphics.anim = ANIM_TAILS_TURNS; s->variant = 0; s->prevVariant = 0xFF; }
  else if (k == 0x1E0) { s->graphics.anim = ANIM_TAILS_TURNS; s->variant = 1; s->prevVariant = 0xFF; }
  if (k < 663) p->y[0] += bob(k);
  else p->x[0] = 0x8C00;
  place(p);
  show(s);
}
// Task_8068214: the Tornado bobs with Tails, is gone for a moment, and then from the front flies off to the upper right,
// turning and shrinking through the rotation hardware. Its front view never animates after its first frame.
static void tornado(Task *t) {
  Piece *p = t->data;
  uint32_t k = p->count;
  Sprite *s = &p->s;
  Transform *tf = &p->tf;
  if (k <= 0x296) {
    p->y[0] += bob(k);
    place(p);
    show(s);
  } else if (k <= 0x2BB) {
    p->x[0] = 0xB400; p->y[0] = 0xB400;
    if (k == 0x2BB) {
      s->graphics.anim = ANIM_TORNADO_FRONT; s->variant = 0; s->prevVariant = 0xFF;
      s->frameFlags = 0x106B;
      update_sprite(s, 0);
    }
  } else {
    int16_t v = SINE[(0x3BB - k) * 4];
    p->y[0] += bios_div(v, 36);
    p->x[0] += bios_div(v, 18);
    int32_t n = (int32_t)k - 700;
    tf->rotation = (uint16_t)(0x3FF & ~(n * 2));
    tf->qScaleX = tf->qScaleY = (int16_t)(Q(3) / 2 - n * 3);
    tf->x = (int16_t)I(p->x[0]); tf->y = (int16_t)I(p->y[0]);
    place(p);
    transform_sprite(s, tf);
    display_sprite(s);
  }
}
// Task_8068570, Task_80685C8, Task_8067F9C and Task_8068004: a picture in the middle of the screen, set up on its scene's
// first frame. The first two keep the caption's OAM order; the last two are drawn at order 15, behind the lines.
static void picture(Piece *p, int anim, int variant, int behind) {
  Sprite *s = &p->s;
  if (p->count == 0) {
    s->prevVariant = 0xFF;
    s->graphics.dest = OBJ_VRAM + 0x26E0;
    s->graphics.anim = (uint16_t)anim; s->variant = (uint8_t)variant;
    s->x = 120; s->y = 80;
    if (behind) s->oamFlags = 0x3C0;
    s->frameFlags = behind ? 0x2000 : 0;
  }
  show(s);
}
static void picture_a0(Task *t) { picture(t->data, ANIM_ART_A, 0, 0); }
static void picture_a1(Task *t) { picture(t->data, ANIM_ART_A, 1, 0); }
static void picture_b0(Task *t) { picture(t->data, ANIM_ART_B, 0, 1); }
static void picture_b1(Task *t) { picture(t->data, ANIM_ART_B, 1, 1); }
// Task_8066D64: a congratulation line, up from the bottom 3 px a frame to its place
static void line_up(Task *t) {
  Piece *p = t->data;
  uint32_t from = (uint32_t)rom_s16(OFFSET_LINE_STARTS + p->line * 2);
  if (p->count <= from) return;
  int stop = rom_s16(OFFSET_LINE_STOPS + p->line * 2);
  p->s.x = 120;
  p->s.y = (int16_t)(180 - (int)(p->count - from) * 3);
  if (p->s.y < stop) p->s.y = (int16_t)stop;
  show(&p->s);
}

// ---- the main task's scenes ----

static void to_black(void) { ending.fade = create_fade(0, 1, 1, 0, 0x80, 1); }
static void from_black(void) { ending.fade = create_fade(0, 1, 2, 0, 0x80, 1); }

// the stage results of the Moon, as CreateStageResults over the night scene: their main task runs from this frame on
static void results_task(Task *t) { if (!results_run()) destroy_task(t); }

static void to_credits(void) {
  destroy_tasks(0, 0xFFFF);
  clear_queues();
  clear_bg_sprites();
  create_staff_credits();
}

// Task_8067E68: the last picture; the lines' counts come from the main task's, 0x14B on, and 400 frames later the staff
// credits
static void last_scene(Task *t) {
  (void)t;
  uint32_t n = ending.count + 1;
  if (n > PICTURE) { to_credits(); return; }
  if (n == PICTURE - FADE_FRAMES) to_black();
  fade_step(&ending.fade);
  uint32_t lines = ending.count + LINES_FROM;
  ending.count = n;
  ending.caption.count = n;
  for (int i = 0; i < LINES; i++) ending.lines[i].count = lines;
}

// Task_8067C24: the third picture, whose colours 2 to 15 turn from palette 143's into 144's in eight steps from frame
// 0xB3, a step every 16 frames; then the lines and the last picture
static void sepia_scene(Task *t) {
  uint32_t k = ending.count - BLEND_AFTER;
  if (k <= BLEND_FRAMES) {
    uint32_t step = k >> 4, from = sprites.palettes + BLEND_FROM_PALETTE * 32, to = sprites.palettes + BLEND_TO_PALETTE * 32;
    for (int i = 2; i < 16; i++) {
      uint32_t a = rom_u16(from + i * 2), b = rom_u16(to + i * 2), out = 0;
      for (int shift = 0; shift < 15; shift += 5) {
        uint32_t ca = (a >> shift) & 0x1F, cb = (b >> shift) & 0x1F;
        uint32_t c = ca > cb ? ca - ((step * (ca - cb)) >> 3) : ca + ((step * (cb - ca)) >> 3);
        out |= (c & 0x1F) << shift;
      }
      e.objPalette[BLEND_ROW * 16 + i] = (uint16_t)out;
    }
    e.flags |= FLAGS_UPDATE_OBJ_PALETTES;
  }
  uint32_t n = ending.count + 1;
  if (n > PICTURE) {
    n = 0;
    static const uint32_t LINE_TILES[LINES] = { 0x6060, 0x6920, 0x6E20 };
    for (int i = 0; i < LINES; i++) {
      Piece *p = &ending.lines[i];
      p->count = 0; p->line = i;
      vs_sprite(&p->s, ANIM_LINES, OBJ_VRAM + LINE_TILES[i], 0xB4, 0x50, 0, i, 0x1000);
      update_sprite(&p->s, 0);
      ending.tLines[i] = create_task(line_up, p, PRIORITY_PIECES, 0, NULL);
    }
    ending.tCaption->main = picture_b1;
    t->main = last_scene;
  }
  fade_step(&ending.fade);
  ending.count = n;
  ending.caption.count = n;
}

// Task_8067B14 and Task_8067B9C: a picture for 400 frames, in from black and out to it
static void picture_scene(Task *t, TaskMain next, TaskMain caption) {
  uint32_t n = ending.count + 1;
  if (n > PICTURE) {
    ending.count = 0;
    ending.caption.count = 0;
    from_black();
    ending.tCaption->main = caption;
    t->main = next;
    return;
  }
  if (n == PICTURE - FADE_FRAMES) to_black();
  fade_step(&ending.fade);
  ending.count = n;
  ending.caption.count = n;
}
static void picture_a1_scene(Task *t) { picture_scene(t, sepia_scene, picture_b0); }
static void picture_a0_scene(Task *t) { picture_scene(t, picture_a1_scene, picture_a1); }

// sub_80677C4: the sky's graphics, on the sky scene's first frame
static void load_sky(void) {
  ui_gfx_stack_init();
  UiGfx sky = { .uiGfxID = UIGFX_FROM_BASE, .unk2B = 0, .tiles = SKY_PALETTE + PALETTE_BYTES, .tilesSize = SKY_TILES,
    .palette = SKY_PALETTE, .paletteSize = PALETTE_BYTES, .layout_ = SKY_PALETTE + PALETTE_BYTES + SKY_TILES, .layoutSize = SKY_MAP,
    .unk28 = 0, .unk29 = 0, .unk2A = 0x15 };
  load_ui_gfx(&sky);
}

// Task_80679E4: the Tornado in the sky, which scrolls 0x128 lines down; at its end every sprite of it goes, the sky's
// map is cleared from its top (20 rows), and the pictures come in from black
static void sky_scene(Task *t) {
  uint32_t n = ending.count + 1;
  if (n == 1) load_sky();
  e.bgScroll[1] = SKY_DOWN;
  if (n > SKY) {
    ending.count = 0;
    ending.caption.count = 0;
    for (int i = 0; i < CLOUDS; i++) destroy_task(ending.tClouds[i]);
    destroy_task(ending.tFace);
    destroy_task(ending.tSparkle);
    destroy_task(ending.tTornado);
    ending.tCaption->main = picture_a0;
    t->main = picture_a0_scene;
    e.mapFill[0].value = 0;
    e.mapFill[0].rect[0] = 0; e.mapFill[0].rect[1] = 0; e.mapFill[0].rect[2] = 0xFF; e.mapFill[0].rect[3] = 0x14;
    e.bgScroll[1] = 0;
    from_black();
    return;
  }
  if (n == SKY - FADE_FRAMES) to_black();
  fade_step(&ending.fade);
  ending.count = n;
  ending.caption.count = n; ending.face.count = n; ending.sparkle.count = n; ending.tornado.count = n;
}

// sub_8067928: "A few days later" on black, then the sky's layer, its sprites and the fade in from black
static void black_scene(Task *t) {
  uint32_t n = ending.count + 1;
  if (n > FADE_FRAMES + FEW_DAYS) {
    e.dispCnt = 0x1140;
    e.bgCnt[0] = 0x9B83;
    from_black();
    fade_step(&ending.fade);
    n = 0;
    for (int i = 0; i < CLOUDS; i++) ending.tClouds[i]->main = drift;
    ending.tSparkle->main = sparkle;
    ending.tTornado->main = tornado;
    ending.tFace->main = face;
    ending.tCaption->main = nothing;
    t->main = sky_scene;
  }
  ending.count = n;
  ending.caption.count = n;
}

// sub_80538BC: the HUD's digits, face and ring into their fixed places, as the stage loads them, for the results
static void load_hud_graphics(void) {
  uint32_t tiles, palette;
  UiSlot layout;
  ui_graphics(0, &tiles, &palette, &layout);   // UIGFX_ASCII_CHARS
  UiGfx red = { .uiGfxID = 0, .unk2B = 0, .tiles = tiles + 224 * 32, .tilesSize = 22 * 32, .palette = palette,
    .paletteSize = 32, .vramC = OBJ_VRAM + 0xD40, .unk28 = 6, .unk2A = 13, .layout = &layout };
  load_ui_gfx(&red);
  UiGfx white = red;
  white.tiles = tiles + 32 * 32; white.vramC = OBJ_VRAM + 0xA80; white.unk2A = 9;
  load_ui_gfx(&white);
  UiSlot faceLayout, ringLayout;
  ui_graphics(1 + ctx.character, &tiles, &palette, &faceLayout);   // UIGFX_UI_ICON_SONIC + the character
  UiGfx faceIcon = { .uiGfxID = (uint8_t)(1 + ctx.character), .unk2B = 1, .tiles = tiles, .tilesSize = 4 * 32, .palette = palette,
    .paletteSize = 32, .vramC = OBJ_VRAM + 0x800, .unk28 = (uint8_t)ctx.character, .unk2A = 9, .layout = &faceLayout };
  load_ui_gfx(&faceIcon);
  ui_graphics(5, &tiles, &palette, &ringLayout);   // UIGFX_UI_ICON_RING
  UiGfx ring = { .uiGfxID = 5, .unk2B = 3, .tiles = tiles, .tilesSize = 16 * 32, .palette = palette,
    .paletteSize = 32, .vramC = OBJ_VRAM + 0x880, .unk28 = 6, .unk2A = 9, .layout = &ringLayout };
  load_ui_gfx(&ring);
}

// Task_8067824: the night scene. On its 25th frame the HUD's graphics, on its 30th the Moon's results, whose length the
// scene goes by: as the tally ends the twinkles start and "A few days later" plays, and 0x21C frames later it fades to
// black
static void night_scene(Task *t) {
  uint32_t n = ending.count + 1;
  if (n == 25) {
    ui_gfx_stack_init();
    load_hud_graphics();
  } else if (n == 30) {
    save_add_ring_bank(act.ringCount);
    results_start(LEVEL_THE_MOON, act.ringCount, act.courseTime, 1, 0);
    ending.length = (uint32_t)results_wait_total();
    create_task(results_task, NULL, PRIORITY_MAIN, 0, NULL);
  }
  if (n == ending.length) play_song(SONG_A_FEW_DAYS_LATER);
  if (n > FADE_FRAMES + ending.length + NIGHT_FADE) {
    ending.count = 0;
    ending.caption.count = 0;
    destroy_task(ending.tTwinkle);
    ending.tCaption->main = few_days_later;
    t->main = black_scene;
    return;
  }
  if (n == ending.length + NIGHT_FADE) to_black();
  fade_step(&ending.fade);
  ending.count = n;
  ending.caption.count = n; ending.twinkle.count = n;
  ending.caption.from = ending.length; ending.twinkle.from = ending.length;
}

static Task *piece(Piece *p, TaskMain main, int anim, int variant, uint32_t dest, int x, int y, uint16_t oamFlags, uint32_t frameFlags) {
  vs_sprite(&p->s, (uint16_t)anim, OBJ_VRAM + dest, x, y, oamFlags, variant, frameFlags);
  return create_task(main, p, PRIORITY_PIECES, 0, NULL);
}

static void load_night(uint32_t palette, uint32_t tilesSize, int slot, int bg) {
  UiGfx night = { .uiGfxID = UIGFX_FROM_BASE, .unk2B = slot, .tiles = palette + PALETTE_BYTES, .tilesSize = tilesSize,
    .palette = palette, .paletteSize = PALETTE_BYTES, .layout_ = palette + PALETTE_BYTES + tilesSize, .layoutSize = NIGHT_MAP,
    .unk28 = 0, .unk29 = (uint8_t)bg, .unk2A = 0x15 };
  load_ui_gfx(&night);
}

/**
 * CreateExtraStageResults once the save is written: every task goes, and the night scene's layers, the sprites' tasks
 * and the main task take over, coming in from white.
 */
void create_true_ending(void) {
  destroy_tasks(0, 0xFFFF);
  act_tasks_destroy_all();
  act.task = NULL;
  clear_queues();
  clear_bg_sprites();
  create_ui_task();
  ui_gfx_stack_init();
  e.dispCnt = 0x1740;
  e.bgCnt[0] = 0x8583; e.bgCnt[1] = 0x9E86; e.bgCnt[2] = 0x9B89;
  for (int i = 0; i < 6; i++) e.bgScroll[i] = 0;

  memset(&ending, 0, sizeof ending);
  // the sparkle's place, as the original sets it, is 8.8 where the sprite wants pixels; it shows only once its task
  // has moved it
  ending.sparkle.x[0] = Q(160); ending.sparkle.y[0] = -Q(32);
  ending.tSparkle = piece(&ending.sparkle, nothing, ANIM_SKY_SPARKLE, 0, 0x2560, Q(160), -Q(32), 3 << 6, 0x1000);
  ending.face.x[0] = Q(120); ending.face.y[0] = Q(90);
  ending.tFace = piece(&ending.face, nothing, ANIM_PILOT_FACE, 1, 0x440, 120, 80, 3 << 6, 0);
  ending.tornado.x[0] = Q(120); ending.tornado.y[0] = Q(90);
  ending.tTornado = piece(&ending.tornado, nothing, ANIM_TORNADO_SIDE, 0, 0x560, 120, 80, 6 << 6, 0x1000);
  static const int32_t TWINKLES[TWINKLE_PLACES][2] = { { 105, 17 }, { 47, 95 }, { 213, 69 }, { 168, 95 } };
  for (int i = 0; i < TWINKLE_PLACES; i++) { ending.twinkle.x[i] = TWINKLES[i][0]; ending.twinkle.y[i] = TWINKLES[i][1]; }
  ending.tTwinkle = piece(&ending.twinkle, twinkles, ANIM_TWINKLE, 0, 0x20, 120, 80, 15 << 6, 0x2000);
  // each cloud's tiles, where it starts and how fast it drifts to the right
  static const int32_t CLOUD[CLOUDS][4] = { { 0x6060, Q(80), Q(50), 0x80 }, { 0x61A0, Q(40), Q(100), 0x40 },
    { 0x6440, Q(120), Q(120), 0x100 }, { 0x70A0, Q(160), Q(20), 0xC0 } };
  for (int i = 0; i < CLOUDS; i++) {
    Piece *c = &ending.clouds[i];
    c->x[0] = CLOUD[i][1]; c->y[0] = CLOUD[i][2]; c->x[1] = CLOUD[i][3]; c->y[1] = 0;
    ending.tClouds[i] = piece(c, nothing, ANIM_CLOUDS + i, 0, (uint32_t)CLOUD[i][0], 180, 80, 12 << 6, 0x1000);
  }
  int english = SAVE_UI_LANGUAGE != 0;
  ending.tCaption = piece(&ending.caption, slide, english ? ANIM_FEW_DAYS_LATER : ANIM_FEW_DAYS_LATER_JAPANESE, 0, 0xA0, 120, 80, 0, 0x80);
  ending.length = 0x3C;
  create_task(night_scene, NULL, PRIORITY_MAIN, 0, NULL);
  // from white, over the whole screen
  ending.fade = create_fade(0, 1, 8, 0, 0x80, 1);
  fade_show(&ending.fade);

  load_night(BACK_PALETTE, BACK_TILES, 2, 0);
  load_night(FRONT_PALETTE, FRONT_TILES, 0, 2);
  load_night(MIDDLE_PALETTE, MIDDLE_TILES, 1, 1);
  // the next V-blank's copies of the three layers' tiles and maps take more than a frame
  engine_lag(1, 0);
}
