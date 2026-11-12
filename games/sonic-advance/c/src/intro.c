// The intro, translated from front/intro.js (SAT-R's src/game/sa1/ui/intro_animation.c), after the logos. A Chaos
// Emerald falls down a backdrop of green streaks, slowing, with two rings of sparkles turning around it, while the
// backdrop fades in; Dr. Eggman rises into view under it, it drops into his hands and he grins, and two spotlights
// sweep across him. Then Sonic, Tails, Knuckles and Amy each get 414 frames: their silhouette over a picture of their
// own, a white flash to the character, their name's letters sliding in one at a time, and a fade to white. After Amy
// the title screen starts, without its music's start; A, B or Start at any point go to it with its music.

#include "sa.h"

#define SKIP (KEY_A | KEY_B | KEY_START)
#define UIGFX_OPTIONS 0x80
enum { ANIM_SILHOUETTES = 769, ANIM_EMERALD = 774, ANIM_SPARKLE = 775 };
#define EMERALD_X 120
#define EMERALD_Y (-36)
#define CHARACTER_FRAMES 414

// The intro's graphics, as offsets from its first colours (gUnknown_086A5D34 in the European ROM the decompilation is
// of): the first scene's colours and the streaks behind it, Dr. Eggman, Eggman grinning, his hands, then the backdrop
// behind every character, its colours (a row per character) and each character's picture. The sizes are the original's.
enum {
  GFX_STREAKS_PALETTE = 0x0, GFX_STREAKS_TILES = 0x200, GFX_STREAKS_MAP = 0x3100,
  GFX_EGGMAN_TILES = 0x3B00, GFX_EGGMAN_MAP = 0x6340, GFX_GRIN_TILES = 0x6E00, GFX_GRIN_MAP = 0x97C0,
  GFX_HANDS_TILES = 0xA280, GFX_HANDS_MAP = 0xB6C0,
  GFX_BACKDROP_PALETTES = 0xBD80, GFX_BACKDROP_TILES = 0xBF80, GFX_BACKDROP_MAP = 0xC4C0,
};
static const uint32_t GFX_CHARACTERS[4][3] = {   // tiles, tilesSize, map
  { 0xCEC0, 0x1E00, 0xECC0 }, { 0xF6C0, 0x1B80, 0x11240 }, { 0x11C40, 0x1880, 0x134C0 }, { 0x13EC0, 0x1840, 0x15700 },
};
// The intro's tables (gUnknown_0868B27C on): where each character's letters stop, then their letters as
// { anim, variant, vram }, then each character's two animations, the silhouette's flash and the character.
#define TABLES_STOPS 0x0
static const uint32_t TABLES_LETTERS[4][2] = { { 0x10, 6 }, { 0x58, 6 }, { 0xA0, 9 }, { 0x10C, 4 } };
#define TABLES_CHARACTER_ANIMS 0x13C

// IntroSprite: a sprite and its counters
typedef struct { int32_t unk30, unk32, unk34, qUnk38, qUnk3C, qUnk40, k; Sprite s; } IntroSprite;

static IntroSprite emerald, sparkles[2][8], letters[9];
typedef struct { int k; uint16_t unkB4; Sprite sprites[3]; } Character;
static Character characters[4];
static struct {
  Fade fade;
  Task *taskC, *beams[2], *characters[4];
  Beam beamData[2];
  int32_t unk4C, unk4E, unk50, unk52;
} intro;

static void intro_sprite(IntroSprite *p, uint16_t anim, uint32_t dest) {
  memset(p, 0, sizeof *p);
  sprite_init(&p->s);
  p->s.graphics.anim = anim;
  p->s.graphics.dest = dest;
}

static void emerald_task(Task *t);
static void sparkle_outer_task(Task *t);
static void sparkle_inner_task(Task *t);
static void intro_fall(Task *t);
static void intro_spotlights(Task *t);
static void character_turn(Task *t);
static void to_title_silent(Task *t);
static void to_title_with_music(Task *t);
static void no_destructor(Task *t) { (void)t; }

// the eight sparkles of a ring, a task each from `priority` up in steps of 2
static void create_sparkles(int inner, TaskMain main, uint16_t priority) {
  for (int i = 0; i < 8; i++) {
    IntroSprite *p = &sparkles[inner][i];
    int unk30 = inner ? i * 6 : 0x2F - i * 6;
    intro_sprite(p, ANIM_SPARKLE, inner ? 0x10BE0 + i * 0x80 : 0x103E0 + i * 0x80);
    p->unk30 = unk30; p->unk32 = i; p->unk34 = unk30; p->qUnk38 = -36 << 8; p->qUnk3C = -36 << 8; p->qUnk40 = 0x240;
    p->s.variant = (uint8_t)inner;
    p->s.x = (int16_t)(EMERALD_X + bios_div(SINE[i << 6], 650));
    p->s.y = EMERALD_Y;
    p->s.oamFlags = inner ? 0x180 : 0;
    p->s.frameFlags = 0x1000;
    create_task(main, p, priority | (i * 2), 0, NULL);
    update_sprite(&p->s, 0);
  }
}

/** CreateIntroAnimation. */
void create_intro(void) {
  destroy_tasks(0, 0xFFFF);
  clear_queues();
  create_ui_task();
  ui_gfx_stack_init();
  e.dispCnt = 0x1040;
  e.bgCnt[0] = 0x9D86; e.bgCnt[1] = 0x1B8B; e.bgCnt[2] = 0x9880;
  for (int i = 0; i < 6; i++) e.bgScroll[i] = 0;

  intro_sprite(&emerald, ANIM_EMERALD, 0x10020);
  emerald.qUnk38 = -36 << 8; emerald.qUnk3C = -36 << 8; emerald.qUnk40 = 0x240;
  emerald.s.x = EMERALD_X; emerald.s.y = EMERALD_Y; emerald.s.oamFlags = 3 << 6; emerald.s.frameFlags = 0x1000;
  intro.taskC = create_task(emerald_task, &emerald, 0x2120, 0, NULL);
  update_sprite(&emerald.s, 0);
  create_sparkles(0, sparkle_outer_task, 0x6800);

  intro.fade = create_fade(0, 1, 2, 0, 0x80, 1);
  intro.beams[0] = intro.beams[1] = NULL;
  for (int k = 0; k < 4; k++) intro.characters[k] = NULL;
  intro.unk4C = 0; intro.unk4E = 1; intro.unk50 = 0; intro.unk52 = 0;
  create_task(intro_fall, &intro, 0x2100, 0, no_destructor);
  fade_step(&intro.fade);
  play_song(SONG_INTRO);
}

// loads one of the intro's pictures into a layer (sub_80528AC)
static void load(int layer, int what, uint32_t tiles, uint32_t tilesSize, uint32_t map, uint32_t mapSize, uint32_t palette, uint32_t paletteSize) {
  UiGfx gfx = { 0 };
  gfx.uiGfxID = UIGFX_OPTIONS;
  gfx.tiles = OFFSET_INTRO_GRAPHICS + tiles; gfx.tilesSize = tilesSize;
  gfx.layout_ = OFFSET_INTRO_GRAPHICS + map; gfx.layoutSize = mapSize;
  gfx.palette = OFFSET_INTRO_GRAPHICS + palette; gfx.paletteSize = paletteSize;
  gfx.unk28 = 0; gfx.unk29 = (uint8_t)layer; gfx.unk2A = (uint8_t)what; gfx.unk2B = -1;
  load_ui_gfx(&gfx);
}

// sub_8063E8C: what the fall adds on its first frames: the second ring of sparkles, then the streaks, Eggman and his
// hands, one a frame, and Eggman grinning 310 frames in
static void fall_step(int n) {
  if (n == 0) create_sparkles(1, sparkle_inner_task, 0x6801);
  else if (n == 1) {
    e.dispCnt = 0x1240;
    load(1, 0x15, GFX_STREAKS_TILES, 0x2F00, GFX_STREAKS_MAP, 0x800, GFX_STREAKS_PALETTE, 0x200);
  } else if (n == 2) {
    e.dispCnt = 0x1340;
    load(0, 0x11, GFX_EGGMAN_TILES, 0x2840, GFX_EGGMAN_MAP, 0x8C0, 0, 0);
  } else if (n == 3) {
    e.dispCnt = 0x1740;
    load(2, 0x11, GFX_HANDS_TILES, 0x1440, GFX_HANDS_MAP, 0x6C0, 0, 0);
  } else if (n == 310) load(0, 0x11, GFX_GRIN_TILES, 0x2840, GFX_GRIN_MAP, 0x8C0, 0, 0);
}

// sub_8063B8C and the next three: a character's background. The backdrop goes behind, with the character's row of its
// colours (Sonic's loads all 16 rows, which the others' pictures use too), and the picture in front; the original
// names each picture's own colours too, but doesn't load them.
static void load_character(int k) {
  ui_gfx_stack_init();
  load(1, k == 0 ? 0x15 : 0x14, GFX_BACKDROP_TILES, 0x540, GFX_BACKDROP_MAP, 0x800, GFX_BACKDROP_PALETTES + k * 0x20, k == 0 ? 0x200 : 0x20);
  load(0, 0x11, GFX_CHARACTERS[k][0], GFX_CHARACTERS[k][1], GFX_CHARACTERS[k][2], 0x800, 0, 0);
}

// Task_80640C8: the fall, 321 frames. Eggman's and his hands' 32 colours fade in from black from frame 152 on, he
// rises 2 lines a frame from frame 182 until he is 100 lines up (his hands following once he is past 80), and the
// streaks scroll 10 lines a frame.
static void intro_fall(Task *t) {
  ((IntroSprite *)intro.taskC->data)->unk30 = u16(intro.unk4C);
  if (e.pressed & SKIP) { t->main = to_title_with_music; return; }
  if (intro.unk4C > 0x97) {
    int k = (int)((uint32_t)((intro.unk4C - 0x98) << 15) >> 16);
    if (k > 40) k = 40;
    for (int i = 0; i < 32; i++) {
      uint32_t c = rom_u16(OFFSET_INTRO_GRAPHICS + GFX_STREAKS_PALETTE + i * 2);
      int r = bios_div((c & 0x1F) * k, 40) & 0x1F, g = bios_div(((c >> 5) & 0x1F) * k, 40) & 0x1F, b = bios_div(((c >> 10) & 0x1F) * k, 40) & 0x1F;
      e.bgPalette[i] = (uint16_t)(r | (g << 5) | (b << 10));
      e.flags |= 0x1;
    }
  }
  if (intro.unk4C > 0xB5) {
    int y = s16(e.bgScroll[1] + 2);
    e.bgScroll[1] = (uint16_t)(y < 100 ? y : 100);
    if (e.bgScroll[1] > 80) e.bgScroll[5] = (uint16_t)(e.bgScroll[1] - 0x50);
  }
  e.bgScroll[3] += 10;
  fall_step(u16(intro.unk4C));
  if (intro.unk4C > 0x13F) { intro.unk4C = 0; t->main = intro_spotlights; }
  else fade_step(&intro.fade);
  intro.unk4C = s16(intro.unk4C + 1);
}

static void create_character(int k);

// sub_8064244: the sparkles go, a pair every 4 frames; from frame 60 the screen darkens a little; the spotlights come
// on at frame 225 and sweep across Eggman, the rest darker, and at frame 506 Sonic's turn starts
static void intro_spotlights(Task *t) {
  uint32_t n = (uint32_t)intro.unk4C;
  if (e.pressed & SKIP) { t->main = to_title_with_music; return; }
  if (n < 0x60) destroy_tasks(0x6800, (uint16_t)((n >> 2) + 0x6802));
  if (n == 0x3C) { intro.fade = create_fade(0, 1, 1, 0, 0x40, 1); fade_show(&intro.fade); }
  e.bgScroll[3] += 10;
  intro.unk4C = s16(intro.unk4C + 1);
  if (intro.unk4C >= 506) {
    destroy_task(intro.taskC); intro.taskC = NULL;
    e.bgScroll[2] = 0; e.bgScroll[3] = 0;
    intro.unk50 = 0x4000; intro.unk52 = 0; intro.unk4C = 0;
    for (int i = 0; i < 2; i++) { destroy_task(intro.beams[i]); intro.beams[i] = NULL; }
    e.bldCnt = 0; e.bldY = 0;
    e.dispCnt = 0x1340;
    e.bgCnt[0] = 0x1D86; e.bgCnt[1] = 0x1883;
    create_character(0);
    t->main = character_turn;
    return;
  }
  if (intro.unk4C > 0xE0) {
    if (intro.unk4C == 0xE1) {
      for (int i = 0; i < 2; i++) {
        intro.beams[i] = create_spotlight_beam(&intro.beamData[i]);
        Beam *b = &intro.beamData[i];
        b->unk6 = 120; b->unk8 = 250; b->unk0 = 0; b->unk2 = 0; b->unk4 = 0; b->bg = 2 + i; b->unkB = 6;
      }
      e.dispCnt |= 0x6000;
      e.winRegs[4] = 0x1F1F; e.winRegs[5] = 0x3F;
      e.bldCnt = 0x3FDF; e.bldY = 8;
      return;
    }
    int k = intro.unk4C - 0xE1;
    for (int i = 0; i < 2; i++) {
      Beam *b = &intro.beamData[i];
      b->unk0 = s16((0x18 - (k % 25)) * 6 + i * 0x370);
      if (k <= 0x3F && k % 6 == 0) b->unkB = (b->unkB + 1) & 0xFF;
    }
  } else if (n >= 30 && n < 120) fade_step(&intro.fade);
}

// Each character's turn: how their picture scrolls (8.8 a frame), and where it starts for the next character
static const int16_t TURNS[4][2] = { { -0x20, 0x20 }, { 0x20, -0x20 }, { 0, 0x20 }, { -0x20, -0x20 } };
static const int32_t STARTS[4][2] = { { 0x4000, 0 }, { 0xE000, 0x6000 }, { 0xE000, 0x1000 }, { 0x3000, 0x5000 } };

// sub_80645E4, sub_80648D4, sub_8064BB4 and sub_8064E84: a character's turn. Frame 1 loads its background; the screen
// is black until frame 30, white for 12 frames, then fades back in over 32, and from frame 353 it fades to white; at
// frame 414 the next character's turn starts, or after Amy's the title screen.
static void character_turn(Task *t) {
  int k = 0;
  while (k < 4 && !intro.characters[k]) k++;
  ((Character *)intro.characters[k]->data)->unkB4 = u16(intro.unk4C);
  intro.unk50 = u16(intro.unk50 + TURNS[k][0]); intro.unk52 = u16(intro.unk52 + TURNS[k][1]);
  e.bgScroll[0] = (uint16_t)(intro.unk50 >> 8); e.bgScroll[1] = (uint16_t)(intro.unk52 >> 8);
  if (e.pressed & SKIP) { t->main = to_title_with_music; return; }
  uint32_t n = (uint32_t)intro.unk4C;
  if (n < 30) {
    if (n == 1) load_character(k);
    if (k == 0) intro.fade = create_fade(0, 1, 2, 0, 0, 1);
    fade_show(&intro.fade);
  } else if (n < 42) { intro.fade = create_fade(0, 1, 8, 0, 0x100, 1); fade_show(&intro.fade); }
  else if (n < 0x16A) fade_step(&intro.fade);
  intro.unk4C = s16(intro.unk4C + 1);
  if (intro.unk4C >= CHARACTER_FRAMES) {
    if (k == 3) { t->main = to_title_silent; fade_step(&intro.fade); return; }
    destroy_tasks(0x6820, 0x6821);
    destroy_task(intro.characters[k]); intro.characters[k] = NULL;
    intro.unk50 = STARTS[k + 1][0]; intro.unk52 = STARTS[k + 1][1];
    intro.unk4C = 0;
    intro.fade = create_fade(0, 1, 2, 0, 0, 1);
    fade_show(&intro.fade);
    create_character(k + 1);
  } else if (intro.unk4C > 0x160) {
    if (intro.unk4C == 0x161) { intro.fade.unk4 = 4; intro.fade.unk6 = 0; intro.fade.unk8 = 0x180; }
    fade_step(&intro.fade);
  }
}

// Each character's sprites: its task's priority, its sprites' tiles (only the first is ever drawn), where it stands
// and its order, and its letters' flags. When they are made, Sonic's and Amy's sprites are all animated and Tails's
// and Knuckles's first only, which is drawn too, as is Amy's; Tails's letters are drawn then too. Knuckles's and
// Amy's letters keep the colours loaded before them.
typedef struct { uint16_t priority; int count; uint32_t dests[3]; int16_t x, y; uint16_t oamFlags; uint32_t letterFlags; int animateAll, draw, drawLetters; } CharacterInfo;
static const CharacterInfo CHARACTERS[4] = {
  { 0x2210, 2, { 0x11440, 0x14000 }, 0xB4, 0x82, 0x3C0, 0x80, 1, 0, 0 },
  { 0x2280, 3, { 0x10400, 0x11980, 0x13280 }, 48, 108, 0x300, 0x80, 0, 1, 1 },
  { 0x2230, 3, { 0x10080, 0x11980, 0x13280 }, 48, 130, 0x3C0, 0x40080, 0, 1, 0 },
  { 0x2230, 2, { 0x11440, 0x16400 }, 180, 108, 0x180, 0x40080, 1, 1, 0 },
};
static void render_sonic(Task *t);
static void render_tails(Task *t);
static void render_knuckles(Task *t);
static void render_amy(Task *t);
static const TaskMain RENDER[4] = { render_sonic, render_tails, render_knuckles, render_amy };
static const int LETTER_ENDS[4] = { 0x161, 353, 353, 0x161 };
static void letter_task(Task *t);

static void create_character(int k) {
  const CharacterInfo *c = &CHARACTERS[k];
  Character *data = &characters[k];
  memset(data, 0, sizeof *data);
  data->k = k;
  intro.characters[k] = create_task(RENDER[k], data, c->priority, 0, NULL);
  for (int i = 0; i < c->count; i++) {
    Sprite *s = &data->sprites[i];
    sprite_init(s);
    s->graphics.dest = c->dests[i]; s->graphics.anim = ANIM_SILHOUETTES;
    s->variant = (uint8_t)k; s->x = c->x; s->y = c->y; s->oamFlags = c->oamFlags; s->frameFlags = 0x80;
    if (c->animateAll || i == 0) update_sprite(s, 0);
    if (i == 0 && c->draw) display_sprite(s);
  }
  uint32_t at = TABLES_LETTERS[k][0], count = TABLES_LETTERS[k][1];
  int stopX = rom_s16(OFFSET_INTRO_TABLES + TABLES_STOPS + k * 4);
  for (uint32_t i = 0; i < count; i++) {
    uint32_t entry = OFFSET_INTRO_TABLES + at + i * 12;
    IntroSprite *letter = &letters[i];
    intro_sprite(letter, (uint16_t)rom_u32(entry), rom_u32(entry + 8) - 0x06000000);
    letter->unk34 = (int32_t)i; letter->qUnk3C = stopX + 0x118; letter->k = k;
    letter->s.variant = (uint8_t)rom_u32(entry + 4); letter->s.x = 280; letter->s.y = 70;
    letter->s.oamFlags = 0x180; letter->s.frameFlags = c->letterFlags;
    create_task(letter_task, letter, 0x6820, 0, NULL);
    update_sprite(&letter->s, 0);
    if (c->drawLetters) display_sprite(&letter->s);
  }
}

// a character's two animations from the tables, which take over from the silhouette one after the other
static void set_anim(Sprite *s, int k, int second) {
  uint32_t at = OFFSET_INTRO_TABLES + TABLES_CHARACTER_ANIMS + k * 8 + (second ? 4 : 0);
  s->prevVariant = 0xFF;
  s->graphics.anim = (uint16_t)rom_u16(at);
  s->variant = (uint8_t)rom_u16(at + 2);
}

// Task_RenderSonic: the silhouette until frame 30, then Sonic's first animation, from frame 190 his second; he is
// semi-transparent, so the fades leave him alone, until frame 354, and the fade to white covers him too
static void render_sonic(Task *t) {
  Character *d = t->data;
  int n = s16(d->unkB4);
  Sprite *s = &d->sprites[0];
  if (n == 0x1E) { set_anim(s, 0, 0); update_sprite(s, 0); }
  if (n > 0) {
    if (n > 0x161) { s->frameFlags = 0; update_sprite(s, 0); }
    else if (n > 0xBD) { if (n == 0xBE) set_anim(s, 0, 1); update_sprite(s, 0); }
    display_sprite(s);
  }
}

// Task_IntroRenderTails: as Sonic's, but the silhouette animates until frame 30, when its tiles move
static void render_tails(Task *t) {
  Character *d = t->data;
  int n = s16(d->unkB4);
  Sprite *s = &d->sprites[0];
  if (n == 0x1E) { s->graphics.dest = 0x10080; set_anim(s, 1, 0); update_sprite(s, 0); }
  if (n >= 0) {
    if (n <= 0x1D) update_sprite(s, 0);
    if (n > 0x161) { s->frameFlags = 0; update_sprite(s, 0); }
    else if (n > 0xBD) { if (n == 0xBE) set_anim(s, 1, 1); update_sprite(s, 0); }
    display_sprite(s);
  }
}

// Task_IntroRenderKnuckles: his second animation from frame 235, and animated every frame
static void render_knuckles(Task *t) {
  Character *d = t->data;
  int n = s16(d->unkB4);
  Sprite *s = &d->sprites[0];
  s->graphics.dest = 0x10080;
  if (n == 0x1E) set_anim(s, 2, 0);
  if (n >= 0) {
    if (n > 0x161) { s->frameFlags = 0; update_sprite(s, 0); }
    else if (n == 0xEB) set_anim(s, 2, 1);
    update_sprite(s, 0);
    display_sprite(s);
  }
}

// Task_IntroRenderAmy: her second animation from frame 165, and nothing after frame 410
static void render_amy(Task *t) {
  Character *d = t->data;
  int n = s16(d->unkB4);
  Sprite *s = &d->sprites[0];
  if (n > 410) return;
  if (d->unkB4 == 0x161) s->frameFlags = 0;
  if (n == 0x1E) { set_anim(s, 3, 0); update_sprite(s, 0); }
  if (n >= 0) {
    if (n > 353) { s->frameFlags = 0; update_sprite(s, 0); }
    else if (n > 164) { if (n == 165) set_anim(s, 3, 1); update_sprite(s, 0); }
    display_sprite(s);
  }
}

// Task_806562C, sub_80656A4, sub_806571C and sub_8065794: from frame 91 the letters slide in from the right 16 pixels
// a frame, each 15 frames after the one before, to where the name stops
static void letter_task(Task *t) {
  IntroSprite *l = t->data;
  int k = l->k;
  l->unk30 = u16(l->unk30 + 1);
  int n = s16(l->unk30);
  if (k == 3 && n > 410) return;
  if (l->unk30 == LETTER_ENDS[k]) l->s.frameFlags = 0;
  if (n <= 90) return;
  n -= 90;
  if (l->unk34 * 15 < n) {
    int stop = rom_s16(OFFSET_INTRO_TABLES + TABLES_STOPS + k * 4);
    l->qUnk3C -= 0x10;
    if (l->qUnk3C < stop) l->qUnk3C = stop;
    l->s.x = s16(l->qUnk3C);
    l->s.y = (int16_t)rom_s16(OFFSET_INTRO_TABLES + TABLES_STOPS + k * 4 + 2);
    update_sprite(&l->s, 0);
    display_sprite(&l->s);
  }
}

// Task_IntroChaosEmeraldUpdate: falls at 2.25 lines a frame, slowing to a stop by frame 90; from frame 234 on it falls
// at 1.25, into Eggman's hands and on to line 180
static void emerald_task(Task *t) {
  IntroSprite *m = t->data;
  int n = s16(m->unk30);
  if (n < 90 || n > 233) m->qUnk3C += m->qUnk40;
  if (n < 90) { m->qUnk40 -= 6; if (m->qUnk40 < 0) m->qUnk40 = 0; }
  if (n == 233) m->qUnk40 = 0x140;
  if (m->qUnk3C > 180 << 8) m->qUnk3C = 180 << 8;
  m->s.y = s16(m->qUnk3C >> 8);
  update_sprite(&m->s, 0);
  display_sprite(&m->s);
}

// Task_8065058 and Task_806515C: a sparkle falls with the emerald, and every 47 frames starts again from the emerald's
// height and drifts up, circling it; the outer ring's sparkles stop at line 180, the inner's at 212. Every other one is
// drawn behind the emerald.
static void sparkle_task(Task *t, int inner) {
  IntroSprite *p = t->data;
  Sprite *s = &p->s;
  p->unk30 = u16(p->unk30 + 1);
  int n = s16(p->unk30);
  if (n < 90 || n >= 234) p->qUnk3C += p->qUnk40;
  if (n < 90) { p->qUnk40 -= 6; if (p->qUnk40 < 0) p->qUnk40 = 0; }
  if (n == 0xE9) p->qUnk40 = 0x140;
  int bottom = (inner ? 212 : 180) << 8;
  if (p->qUnk3C > bottom) p->qUnk3C = bottom;
  if (p->unk34 == 0) { s->prevVariant = 0xFF; p->unk34 = 0x2F; p->qUnk38 = p->qUnk3C; }
  p->qUnk38 -= bios_div(SINE[inner ? p->unk34 * 6 : (0x100 - p->unk34 * 6) & 0xFF], 24);
  int swing = bios_div(SINE[(p->unk34 * 12 + (n << 5)) & 0x3FF], 650);
  s->x = s16(inner ? 120 - swing : swing + 120);
  s->y = s16(p->qUnk38 >> 8);
  p->unk34 -= 1;
  s->oamFlags = p->unk32 & 1 ? 0 : 6 << 6;
  update_sprite(s, 0);
  display_sprite(s);
}
static void sparkle_outer_task(Task *t) { sparkle_task(t, 0); }
static void sparkle_inner_task(Task *t) { sparkle_task(t, 1); }

// IntroOpenTitlescreenSilent and IntroOpenTitlescreenPlayMusic
static void to_title(int playMusic) {
  destroy_tasks(0, 0xFFFF);
  clear_queues();
  if (playMusic) stop_song(SONG_INTRO);
  for (int i = 0; i < 6; i++) e.bgScroll[i] = 0;
  create_title_screen(playMusic);
}
static void to_title_silent(Task *t) { (void)t; to_title(0); }
static void to_title_with_music(Task *t) { (void)t; to_title(1); }
