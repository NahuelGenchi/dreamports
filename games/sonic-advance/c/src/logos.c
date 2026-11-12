// The SEGA and Sonic Team logos, translated from front/logos.js (SAT-R's src/game/sa1/menus/title_screen.c:
// CreateSegaLogo and the tasks after it). SEGA's logo wipes in from the bottom over 160 frames, a line more each frame
// (the lines below it are the logo, the lines above it its first line stretched), holds for 120 frames and wipes out
// the same way. Then Sonic Team's logo opens out from its middle: its top and bottom 40 lines show at once, and its
// middle 80 lines start split apart, every other line shifted the other way, closing in 2 pixels a frame. With SEGA's
// ring sound it holds for 122 frames, then fades to white over 33, and the intro starts. A or Start while it fades
// goes to the title screen instead.

#include "sa.h"

enum { TM_PRESENTED_BY_SEGA = 86, TM_CREATED_BY_SONIC_TEAM = 87 };
enum { WIPE = 160, SEGA_HOLD = 120, SONIC_TEAM_HOLD = 120, FADE_STEP = 0x80, FADE_END = 0x1000 };

static struct { int unk0, qFade; Background bg; } logo;

// CreateSegaLogo and CreateSonicTeamLogo: layer 2 alone (map block 30, tiles from 0) with the logo's 20 × 10 tiles at
// (5, 5), the map filled with tile 0 first
static void show_logo(uint16_t tilemapId, TaskMain main) {
  e.bldCnt = 0; e.bldY = 0;
  e.dispCnt = 0x40;
  e.bgCnt[2] = 0x5E01;
  e.bgScroll[4] = 0; e.bgScroll[5] = 0;
  memset(gba_vram, 0, 64);
  e.mapFill[2].value = 0;
  e.mapFill[2].rect[0] = 0; e.mapFill[2].rect[1] = 0; e.mapFill[2].rect[2] = 0xFF; e.mapFill[2].rect[3] = 0x40;
  logo.unk0 = 0; logo.qFade = 0;
  background_init(&logo.bg);
  logo.bg.layoutVram = 30 * 0x800; logo.bg.tilemapId = tilemapId; logo.bg.unk22 = 5; logo.bg.unk24 = 5;
  logo.bg.targetTilesX = 20; logo.bg.targetTilesY = 10; logo.bg.flags = 2;
  create_task(main, &logo, 0x2000, 0, NULL);
  draw_background(&logo.bg);
}

static void sega_wipe_in(Task *t);
static void sega_start(Task *t) { t->main = sega_wipe_in; t->main(t); }

/** CreateSegaLogo. */
void create_sega_logo(void) {
  e.flags |= FLAGS_NO_RESET;
  show_logo(TM_PRESENTED_BY_SEGA, sega_start);
}

static void sega_hold(Task *t);
static void sega_wipe_out(Task *t);
static void sonic_team_open(Task *t);
static void sonic_team_hold(Task *t);
static void sonic_team_fade(Task *t);
static void to_title(Task *t);

// Task_SegaLogoInit: the logo's lines from the bottom of the screen up, and above them its first line
static void sega_wipe_in(Task *t) {
  e.dispCnt |= 0x400;
  logo.unk0++;
  int h = e.bgScroll[4], v = e.bgScroll[5];
  scroll_lines(2, 0, WIPE - logo.unk0, h, v + WIPE - logo.unk0);
  fill_lines(2, WIPE - logo.unk0, WIPE, h, v);
  if (logo.unk0 == WIPE) { t->main = sega_hold; logo.unk0 = 0; }
}

// sub_800D3E0: the logo as it is for 120 frames; nothing writes its lines' scroll now, and the H-blank copy is off, so
// they all show the layer's own
static void sega_hold(Task *t) {
  if (++logo.unk0 == SEGA_HOLD) { t->main = sega_wipe_out; logo.unk0 = 0; }
}

static void sonic_team_start(Task *t) { t->main = sonic_team_open; t->main(t); }

// Task_800D11C: the reverse, the logo's last line stretched up from the bottom
static void sega_wipe_out(Task *t) {
  logo.unk0++;
  int h = e.bgScroll[4], v = e.bgScroll[5];
  fill_lines(2, 0, WIPE - logo.unk0, h, v);
  scroll_lines(2, WIPE - logo.unk0, WIPE, h, v + WIPE - logo.unk0);
  if (logo.unk0 == WIPE) {
    e.flags &= ~FLAGS_NO_RESET;
    // SwitchToSonicTeamLogo
    e.flags &= ~FLAGS_HBLANK_COPY;
    destroy_task(t);
    show_logo(TM_CREATED_BY_SONIC_TEAM, sonic_team_start);
  }
}

// Task_800D268: the top and bottom 40 lines as they are, the middle 80 split, closing 2 pixels a frame; once the split
// is under 80 pixels, the middle lines from line 64 - unk0 on (as a byte) show as they are too
static void sonic_team_open(Task *t) {
  e.dispCnt |= 0x400;
  logo.unk0 += 2;
  if (logo.unk0 < 280) {
    int h = e.bgScroll[4], v = e.bgScroll[5];
    fill_lines(2, 0, 40, h, v);
    fill_lines(2, 120, 160, h, v);
    if (logo.unk0 < 200) shear_lines(2, 40, 120, 280 - logo.unk0, -1, h, v);
    else {
      shear_lines(2, 40, 64 - logo.unk0, 280 - logo.unk0, -1, h, v);
      fill_lines(2, 64 - logo.unk0, 120, h, v);
    }
  } else {
    play_song(SONG_SEGA_RING);
    e.flags &= ~FLAGS_HBLANK_COPY;
    t->main = sonic_team_hold;
    logo.unk0 = 0;
  }
}

// Task_800D450: 122 frames, then the fade to white starts
static void sonic_team_hold(Task *t) {
  if (logo.unk0++ > SONIC_TEAM_HOLD) {
    logo.qFade = 0;
    t->main = sonic_team_fade;
    e.bldCnt = 0xFF;
    e.bldY = 0;
  }
}

// sub_800D364: brighter by a 32nd a frame; A or Start goes to the title screen (Task_800D4B0). Its last frame sets the
// brightness to 16 as an 8.8 number, which the register reads as 0, so that frame isn't brightened.
static void sonic_team_fade(Task *t) {
  if (e.pressed & (KEY_A | KEY_START)) {
    // CreateTitleScreen clears its first two tiles at once; the rest of the screen it starts next frame
    memset(gba_vram, 0, 64);
    t->main = to_title;
    return;
  }
  logo.qFade += FADE_STEP;
  if (logo.qFade > FADE_END) {
    e.bldY = FADE_END;
    destroy_task(t);
    create_intro();
    return;
  }
  e.bldY = (uint16_t)(logo.qFade >> 8);
}

// Task_800D4B0
static void to_title(Task *t) {
  e.flags &= ~(FLAGS_NO_RESET | FLAGS_HBLANK_COPY);
  destroy_task(t);
  create_title_screen(1);
}
