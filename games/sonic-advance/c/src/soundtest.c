// The sound test, translated from front/soundtest.js (SAT-R's src/game/sa1/ui/sound_test.c: CreateSoundTest and its tasks),
// from the Options menu's SOUND TEST. It fades in from black over 32 frames while whatever was playing fades out: a
// chequered background scrolling up and to the left a pixel a frame, SOUND TEST in its corner, the song's number on a star
// between two bobbing arrows, Amy on a stand, and A PLAY B EXIT along the bottom. Amy waves until the 119th frame, then
// stands.
//
// Left and Right choose among 39 songs, or 42 once the Moon Zone has been cleared (the save's unk424), wrapping round;
// held, they repeat 20 frames after the press and every 9 after that. From the 121st frame A plays the song: the players'
// songs fade out over 16 frames, Amy dances to it, the star pulses, and EXIT turns to STOP. An A after the fade-in and
// before the 121st frame plays it at once too. B while a song plays fades it out, and B is then ignored for 10 frames; a
// song ending, or stopped, makes Amy blow a kiss for 120 frames. B with nothing playing fades out to black over 43 frames,
// Amy waving goodbye, and the Options menu comes back, its cursor on PLAYER DATA.
//
// What the screen does depends on whether the four music players are playing, which it reads each frame. The sound plays
// where the page's audio runs, so the screen reads the kit's own silent copy of the engine on the game's side
// (gba_sound_player_status), which gets the same calls and runs a frame as each of the game's frames ends, as SoundMain
// runs at the top of the next one (EngineMainLoop).

#include "sa.h"

void create_options_menu(void);

enum { ANIM_AMY_BYE = 853, ANIM_AMY_IDLE = 854, ANIM_AMY_SHAKE = 855, ANIM_AMY_KISS = 856 };
// the arrows (variant 2), and STOP (0) or EXIT (1); A PLAY B; SOUND TEST; the corner; the stand's left half; the star
enum { ANIM_WORDS = 870, ANIM_PLAY = 873, ANIM_TITLE = 871, ANIM_CORNER = 874, ANIM_STAND = 875, ANIM_STAR = 876 };
enum { ARROWS = 2, STOP = 0, EXIT = 1, SONGS = 39, ALL_SONGS = 42, PLAYERS = 4 };   // BGM, SE1, SE2, SE3
enum { BYE, IDLE, SHAKE, KISS };   // Amy's states (unk10D): waving, standing, dancing, blowing a kiss
enum { BACKGROUND_GFX = 0x3D, DIGITS_GFX = 0, SAVE_MOON_CLEARED = 0x424 };
// gUnknown_0868B0CC: how far the arrows are out, by the frame's eighth
static const uint8_t BOB[8] = { 0, 1, 2, 3, 4, 3, 2, 1 };
static const uint32_t STAR_FLAGS[4] = { 0x3067, 0x3068, 0x3069, 0x307B };

// SoundTestState: the frame (unk24), the song chosen (unk28), whether one plays (unk29), the players playing (unk2A) and
// B's rest (unk2C); and its subtasks, which read the frame, the song and whether one plays from it, as it runs before them
// (the original copies them to each: unk108, unk10C, unk10D)
static struct {
  Fade fade;
  int frame, song, playing, players, rest;
  Task *number, *amyTask, *wordsTask, *starTask, *stillTask, *arrowsTask;
  Sprite amy, stars[4], arrows, words, still[4];
  int amyState, amyCount, angle;
  UiText digits;
} test;

static void run_sound_test(Task *t);
static void amy_task(Task *t);
static void star_task(Task *t);
static void arrows_task(Task *t);
static void words_task(Task *t);
static void number_task(Task *t);
static void still_task(Task *t);

static void sprite_at(Sprite *s, uint16_t anim, uint32_t dest, int x, int y, uint16_t oamFlags, int variant, uint32_t frameFlags) {
  vs_sprite(s, anim, OBJ_VRAM + dest, x, y, oamFlags, variant, frameFlags);
}

// sub_805E9B4: the background's tiles, colours and map into layer 0, and the digits' glyphs (UI graphics 0 from tile 32)
// and colours into sprite VRAM and palette row 15, for slot 0
static void load_graphics(void) {
  ui_gfx_stack_init();
  UiSlot bgLayout, digitsLayout;
  uint32_t bgTiles, bgPalette, digitsTiles, digitsPalette;
  ui_graphics(BACKGROUND_GFX, &bgTiles, &bgPalette, &bgLayout);
  UiGfx b = { 0 };
  b.uiGfxID = BACKGROUND_GFX; b.unk2B = 1; b.layout = &bgLayout; b.unk28 = 0; b.unk29 = 0; b.unk2A = 0x15;
  b.tiles = bgTiles; b.tilesSize = 0x800; b.palette = bgPalette; b.paletteSize = 0x20;
  b.layout_ = OFFSET_SOUND_TEST_BACKGROUND; b.layoutSize = 0x800;
  load_ui_gfx(&b);
  ui_graphics(DIGITS_GFX, &digitsTiles, &digitsPalette, &digitsLayout);
  UiGfx d = { 0 };
  d.uiGfxID = DIGITS_GFX; d.unk2B = 0; d.layout = &digitsLayout; d.unk28 = 15; d.unk2A = 0xD; d.vramC = OBJ_VRAM + 0x3480;
  d.tiles = digitsTiles + 0x400; d.tilesSize = 0x280; d.palette = digitsPalette; d.paletteSize = 0x20;
  load_ui_gfx(&d);
}

/** CreateSoundTest. */
void create_sound_test(void) {
  memset(e.firstRepeat, 20, 10);
  memset(e.nextRepeat, 8, 10);
  create_ui_task();
  e.dispCnt = 0x1140;
  e.bgCnt[0] = 0x1E07;
  e.bgScroll[0] = 0;
  e.bgScroll[1] = 0;

  memset(&test, 0, sizeof test);
  test.fade = create_fade(0, 1, 2, 0, 0x100, 1);
  create_task(run_sound_test, &test, 0x2000, 0, NULL);

  test.amyState = BYE; test.amyCount = 60;
  sprite_at(&test.amy, ANIM_AMY_SHAKE, 0x20, 180, 120, 0, 0, 0x2000);
  test.amyTask = create_task(amy_task, &test, 0x2020, 0, NULL);
  update_sprite(&test.amy, 0);

  // DoSpriteTransformAndDisplay as the original has it, TransformSprite before the sprite has a frame: it reads the frame's
  // size from whatever an earlier screen left in the sprite's memory, which on the way from the Options menu puts the four
  // quarters far off the screen, so only their rotation counts on this frame, a black one, and none of them is drawn
  const Transform first = { 0xC8, 0x101, 0x101, 0, 0 };
  for (int i = 0; i < 4; i++) {
    sprite_at(&test.stars[i], ANIM_STAR, 0xC80, 76, 92, 0x480, 0, STAR_FLAGS[i]);
    rotate_sprite(&test.stars[i], &first);
    update_sprite(&test.stars[i], 0);
  }
  test.starTask = create_task(star_task, &test, 0x2020, 0, NULL);

  sprite_at(&test.arrows, ANIM_WORDS, 0x1C80, 100, 93, 0, ARROWS, 0);
  test.arrowsTask = create_task(arrows_task, &test, 0x2020, 0, NULL);
  update_sprite(&test.arrows, 0);
  display_sprite(&test.arrows);

  sprite_at(&test.words, ANIM_WORDS, 0x2040, 98, 136, 0x100, 0, 0x2000);
  test.wordsTask = create_task(words_task, &test, 0x2020, 0, NULL);
  update_sprite(&test.words, 0);

  // GameOverB: one glyph at y 82, from the digits' slot (0), in palette row 15, at OAM order 8
  test.digits = (UiText){ .unk8 = 0x40, .unkC = 0x52, .unkE = 1, .unk10 = 0, .unk12 = 15, .unk16 = 1 };
  test.number = create_task(number_task, &test, 0x2040, 0, NULL);

  sprite_at(&test.still[0], ANIM_CORNER, 0x2600, 0, 0, 0x140, 0, 0x2000);
  sprite_at(&test.still[1], ANIM_PLAY, 0x3200, 26, 136, 0x140, 0, 0x2000);
  sprite_at(&test.still[2], ANIM_TITLE, 0x1CC0, 17, 24, 0x80, 0, 0x2000);
  sprite_at(&test.still[3], ANIM_STAND, 0x2380, 180, 144, 0x100, 0, 0x2000);
  test.stillTask = create_task(still_task, &test, 0x2020, 0, NULL);
  for (int i = 0; i < 4; i++) update_sprite(&test.still[i], 0);

  for (int p = 0; p < PLAYERS; p++) fade_out_sound(p, 1);
  fade_show(&test.fade);
  load_graphics();
}

// sub_805FF0C: Amy to a state, 120 frames on its count
static void set_amy(int state) {
  test.amyState = state;
  test.amyCount = 120;
}

// Task_TransitionOptionsMenu: the windows and the fade off, and the Options menu
static void to_options(Task *t) {
  e.dispCnt &= (uint16_t)~0xE000;
  e.bldCnt = 0;
  e.bldY = 0;
  destroy_task(t);
  create_options_menu();
}

// Task_SoundTestInit
static void run_sound_test(Task *t) {
  Fade *fade = &test.fade;
  int frame = test.frame + 1;
  if (fade->unk4 == 1 && fade->unk6 > 0x1FFF) {
    Task *subs[6] = { test.number, test.amyTask, test.wordsTask, test.starTask, test.stillTask, test.arrowsTask };
    for (int i = 0; i < 6; i++) destroy_task(subs[i]);
    t->main = to_options;
    return;
  }
  e.bgScroll[0] = (uint16_t)((e.bgScroll[0] + 1) & 0xFF);
  e.bgScroll[1] = (uint16_t)((e.bgScroll[1] + 1) & 0xFF);
  int count = save.bytes[SAVE_MOON_CLEARED] ? ALL_SONGS : SONGS;
  if (e.repeated & KEY_LEFT) test.song = test.song == 0 ? count - 1 : test.song - 1;
  else if (e.repeated & KEY_RIGHT) test.song = (test.song + 1) % count;
  if (frame == 2) for (int p = 0; p < PLAYERS; p++) gba_sound_continue_player(p);

  int a = e.pressed & KEY_A, b = e.pressed & KEY_B;
  // sub_805FD54: an A once the fade-in is over skips to the 121st frame, Amy dancing from the start of it
  if (fade_step(fade) && a && frame <= 120 && !b) {
    frame = 121;
    set_amy(SHAKE);
    test.amy.prevVariant = 0xFF;
    test.amy.graphics.anim = ANIM_AMY_SHAKE;
    test.amy.variant = 0;
    update_sprite(&test.amy, 0);
  }
  if (frame > 1 && a && fade->unk4 != 1 && frame > 120 && !b) {
    for (int p = 0; p < PLAYERS; p++) fade_out_sound(p, 1);
    play_song(rom_u16(OFFSET_SOUND_TEST_SONGS + (uint32_t)test.song * 2));
    set_amy(SHAKE);
  } else {
    for (int p = 0; p < PLAYERS; p++) {
      int bit = 1 << p;
      if (gba_sound_player_status(p) & 0xFFFF) test.players |= bit;
      else {
        if ((test.players & bit) && frame > 100 && fade->unk4 != 1) set_amy(KISS);
        test.players &= ~bit;
      }
    }
  }
  if (test.players != 0 && fade->unk4 != 1) {
    if (frame > 120) {
      set_amy(SHAKE);
      test.playing = 1;
    }
  } else test.playing = 0;

  int rest = 1;
  if (b) {
    if (fade->unk4 != 1 && !test.playing && !test.rest && frame > 120 && !a) {
      play_song(SONG_RETURN);
      fade->unk4 = 1;
      fade->unk6 = (int16_t)(0x2000 - (uint16_t)fade->unk6);
      fade->unk8 = 0xC0;
      set_amy(BYE);
    }
    // the players playing fade out: BGM and SE1 as such, and SE2 or SE3 as SE3
    if (fade->unk4 != 1 && test.playing && !test.rest) {
      for (int p = 0; p < PLAYERS; p++) {
        if (!(test.players & (1 << p))) continue;
        test.rest = 10;
        fade_out_sound(p < 2 ? p : 3, 1);
      }
      rest = 0;
    }
  }
  if (rest && test.rest) test.rest--;
  test.frame = frame;
}

static void pose(int x, int anim, int variant) {
  test.amy.x = (int16_t)x;
  test.amy.y = 120;
  test.amy.graphics.anim = (uint16_t)anim;
  test.amy.variant = (uint8_t)variant;
}

// sub_805F950: Amy waves until the 119th frame, then stands; dancing, she moves left, then to the right facing left, then
// back to the middle for the last of every 250 frames; a kiss lasts 120 frames
static void amy_task(Task *t) {
  (void)t;
  Sprite *s = &test.amy;
  int frame = test.frame;
  if (test.amyState == BYE || frame < 120) {
    pose(180, ANIM_AMY_BYE, 0);
    if (frame == 119) {
      s->prevVariant = 0xFF;
      test.amyState = IDLE;
      s->graphics.anim = ANIM_AMY_IDLE;
    }
    s->frameFlags &= ~SPRITE_X_FLIP;
  } else if (test.amyState == IDLE) {
    pose(180, ANIM_AMY_IDLE, 0);
    s->frameFlags &= ~SPRITE_X_FLIP;
  } else if (test.amyState == SHAKE) {
    int m = frame % 250;
    if (m <= 119) {
      pose(164, ANIM_AMY_SHAKE, 0);
      s->frameFlags &= ~SPRITE_X_FLIP;
    } else if (m > 124 && m < 245) {
      pose(196, ANIM_AMY_SHAKE, 0);
      s->frameFlags |= SPRITE_X_FLIP;
    } else {
      pose(180, ANIM_AMY_SHAKE, 1);
      test.amyCount = 5;
    }
  } else if (test.amyState == KISS) {
    pose(180, ANIM_AMY_KISS, 0);
    test.amyCount = (test.amyCount - 1) & 0xFFFF;
    if (test.amyCount == 0) {
      s->prevVariant = 0xFF;
      test.amyState = IDLE;
      s->graphics.anim = ANIM_AMY_IDLE;
    }
    s->frameFlags &= ~SPRITE_X_FLIP;
  }
  update_sprite(s, 0);
  display_sprite(s);
}

// sub_805FAD4: the star, four quarters of it turned through the rotation hardware, swelling and shrinking with the sine of
// its angle while a song plays, and once more after, until the angle comes round to 4
static void star_task(Task *t) {
  (void)t;
  if (test.playing) test.angle = (test.angle + 0x10) & 0x3FF;
  else if (test.angle != 4) {
    int end = test.angle < 0x200 ? 0x200 : 0x3FF;
    test.angle += 0x10;
    if (test.angle > end) test.angle = 4;
  }
  int16_t scale = (int16_t)((SINE[test.angle] >> 8) + 0x100);
  for (int i = 0; i < 4; i++) {
    Sprite *s = &test.stars[i];
    s->x = 76;
    s->y = 92;
    Transform tf = { (uint16_t)(i * 0x100), scale, scale, 76, 92 };
    transform_sprite(s, &tf);
    display_sprite(s);
  }
}

// Task_805FEAC: the arrows either side of the number, a pixel further out every 8 frames and back
static void arrows_task(Task *t) {
  (void)t;
  Sprite *s = &test.arrows;
  int out = BOB[(test.frame >> 3) % 8];
  s->frameFlags &= ~SPRITE_X_FLIP;
  s->x = (int16_t)(out + 102);
  display_sprite(s);
  s->frameFlags |= SPRITE_X_FLIP;
  s->x = (int16_t)(52 - out);
  display_sprite(s);
}

// sub_805FDE4: STOP once a song has played for 24 frames of the screen, else EXIT
static void words_task(Task *t) {
  (void)t;
  Sprite *s = &test.words;
  s->prevVariant = 0xFF;
  s->variant = test.playing && test.frame > 24 ? STOP : EXIT;
  update_sprite(s, 0);
  display_sprite(s);
}

// sub_805FC88: the song's number from 1, its digits 10 px apart and centred on the star, one glyph at a time
static void digit(int d) {
  char c = (char)(d + 0x20);
  draw_ui_glyphs(&c, &test.digits, 0);
}
static void number_task(Task *t) {
  (void)t;
  UiText *o = &test.digits;
  int n = (test.song + 1) & 0xFF, left = 0;
  o->unkC = 0x52;
  if (n > 99) {
    o->unkA = 0x40;
    digit(n / 100);
  } else left = n >= 10 ? 5 : 10;
  if (n > 9) {
    o->unkA = (uint16_t)(74 - left);
    digit((n % 100) / 10);
  }
  o->unkA = (uint16_t)(84 - left);
  digit(n % 10);
}

// sub_805FE48: the corner, SOUND TEST, A PLAY B and the stand, its left half and then the same flipped
static void still_task(Task *t) {
  (void)t;
  for (int i = 0; i < 3; i++) display_sprite(&test.still[i]);
  Sprite *stand = &test.still[3];
  stand->frameFlags &= ~SPRITE_X_FLIP;
  display_sprite(stand);
  stand->frameFlags |= SPRITE_X_FLIP;
  display_sprite(stand);
}
