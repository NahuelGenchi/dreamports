// The character select, translated from front/charselect.js (SAT-R's src/game/sa1/ui/character_select.c:
// CreateCharacterSelectionScreen and its tasks), from the main menu's Game Start. It fades in from black over 16 frames
// to its music: a backdrop on the second layer, and after it the title and its scrolling strip dropping in from the
// top, the character's name and the two bars around it sliding up, the characters coming in from the right, and the
// arrows on both sides.
//
// From the 34th frame Left and Right turn the row, with the key repeat the main menu set, 16 frames a turn. A picks the
// character in the middle: it strikes its pose, the others leave and the screen fades to black, and the act starts, or
// the course select once the character has cleared a level. B fades the screen out and goes back to the main menu.
//
// CheckCPUPartnerUnlock watches the keys throughout: Up on Sonic, then Right, Down, Right, L, Right, R, Right and A,
// and the ring sound plays as the screen ends, and Tails comes along as the CPU's partner (gTailsEnabled).
//
// In the VS menus (game mode 2 or more) the GBAs choose together over the link (the packets 0x20 to 0x23) and the screen
// goes on to the players' overview (vsoverview.c).

#include "sa.h"

enum { ANIM_CHARACTERS = 722, ANIM_BACKDROP = 723, ANIM_BLOCK = 730 };
// the backdrop's variant by how far the row has turned, in quarters of a turn (gUnknown_08688578)
static const uint8_t BACKDROP_VARIANTS[4] = { 3, 0, 2, 1 };
enum { LEFT = 0, MIDDLE = 1, RIGHT = 2, BLOCK = 3 };
// the UI graphics table's entries: the bars, the arrows, the name's letters, the strip, the title, the strip after a pick
enum { GFX_BARS = 0x27, GFX_ARROWS = 0x28, GFX_NAME = 0x29, GFX_STRIP = 0x2A, GFX_TITLE = 0x2B, GFX_STRIP_PICKED = 0x2C };
// where the name starts, by character (gUnknown_08688570), and how far it shakes as the row turns
static const int16_t NAME_X[4] = { 25, 25, 24, 20 };
static const int16_t NAME_SHAKE[16] = { -31, 27, -23, 19, -15, 11, -7, 3, -3, 7, -11, 15, -19, 23, -27, 31 };
static const int16_t ARROW_X[14] = { 16, 12, 8, 4, 8, 12, 0, 194, 198, 202, 206, 202, 198, 0 };
// which character is in each place at the row's halfway point: turning right and turning left
static const uint8_t ROW_AFTER[2][3] = { { 0, 1, 3 }, { 1, 2, 0 } };
// the frames after a pick before the fade out starts (Task_805AAF8's array, 38 for each character)
enum { PICK_WAIT = 38, PICK_END = 0x38, BACK_CLEAR = 0x10, READY = 0x21 };
enum { SINGLE_PLAYER = 0, TIME_ATTACK = 1 };   // gGameMode
enum { PARTNER_READY = 8, NO_CODE = 0xFF };
// the link's packets while the GBAs choose: still choosing, picked (and waiting for the others), all picked, and the
// parent's answer with each one's character
enum { CHOOSING = 0x20, PICKED = 0x21, ALL_PICKED = 0x22, ANSWER = 0x23 };
// The original lets no two players take the same character: a character another GBA has picked can't be picked, and the
// row turns past it. Every player is Sonic in this build whatever the row says, so the rule is left out, which is this
// screen's one difference from the original, as in the JavaScript version.
#define SAME_CHARACTER_ALLOWED 1
static int multi_player(void) { return ctx.gameMode > TIME_ATTACK; }
// CheckCPUPartnerUnlock's keys, after Up on Sonic
static const uint16_t PARTNER_KEYS[10] = { KEY_RIGHT, KEY_DOWN, KEY_RIGHT, KEY_L, KEY_RIGHT, KEY_R, KEY_RIGHT, KEY_A, 0, 0 };
#define TEXT_ROW " !\"#$%&'"
static const char STRIP_ROW[] = TEXT_ROW TEXT_ROW TEXT_ROW;
static const char STRIP_PICKED_ROW[] = " ! ! ! ! ! ! ! ! ! ! ! !";
#define TITLE_ROW "        "
#define BAR_TOP "!!!!!!!!"
#define BAR_BOTTOM "        "
#define WIN(a, b) ((uint16_t)(((a) << 8) | (b)))

void create_main_menu(int back);
void create_time_attack_menu(void);
void create_course_select(void);

// a line of text (GameOverB), one glyph after another in slot `unk10`
static UiText line(int unkA, int unkC, int unkE, int unk10, int unk12, int unk8) {
  UiText o = { 0 };
  o.unkA = (uint16_t)unkA; o.unkC = (uint16_t)unkC; o.unkE = (uint16_t)unkE; o.unk10 = (uint16_t)unk10;
  o.unk12 = (uint16_t)unk12; o.unk16 = 1; o.unk8 = (uint16_t)unk8;
  return o;
}

typedef struct { UiText o; int32_t frames, angle, shake; } Part;   // the name, the bars and the arrows
typedef struct { UiText o, strip; int32_t frames, cursor, x, speed; } Title;   // unk38, unk30, unk3C, unk40
typedef struct { Sprite sprites[4]; int32_t frames, angle, turning; } Characters;
typedef struct { Sprite s; int32_t angle; } Backdrop;

static Part name, bars, arrows;
static Title title;
static Characters characters;
static Backdrop backdrop;
static struct {
  Fade fade;
  int32_t turn, shown, wanted, turning, wasTurning, turnFrames, frames, code, picked, taken;
  Task *name, *bars, *arrows, *title, *backdrop, *characters;
} screen;

static void nothing(Task *t) { (void)t; }
static void fade_in(Task *t);
static void show_backdrop(Task *t);

static void load(int id, int slot, uint32_t tiles, uint32_t tilesSize, uint32_t vram, int unk2A, uint32_t palette, uint32_t paletteSize, int unk28) {
  UiSlot layout;
  UiGfx g = { 0 };
  ui_graphics(id, &g.tiles, &g.palette, &layout);
  g.tiles += tiles; g.tilesSize = tilesSize; g.palette += palette; g.paletteSize = paletteSize; g.unk28 = (uint8_t)unk28;
  g.vramC = OBJ_VRAM + vram; g.unk2A = (uint8_t)unk2A; g.unk2B = slot; g.layout = &layout;
  load_ui_gfx(&g);
}

static void character(Sprite *s, uint32_t dest, int x, int variant, uint16_t oamFlags, uint16_t anim) {
  sprite_init(s);
  s->graphics.dest = OBJ_VRAM + dest; s->graphics.anim = anim;
  s->x = (int16_t)x; s->y = 110; s->oamFlags = oamFlags; s->prevVariant = 0xFF; s->animSpeed = 0x10; s->variant = (uint8_t)variant;
}

/** CreateCharacterSelectionScreen: `selected` is the character the row starts on. */
void create_character_select(int selected) {
  vs_reset_missing();
  screen.taken = 0;
  create_ui_task();
  ui_gfx_stack_init();
  e.dispCnt = 0x1240;
  e.bgCnt[1] = 0x1907;
  for (int i = 2; i < 6; i++) e.bgScroll[i] = 0;

  screen.fade = create_fade(0, 0, 2, 0, 0x200, 1);
  screen.turn = s16(0x2000 + ((selected & 3) << 8));   // unk28: the row's angle, a quarter of a turn every 0x100
  screen.shown = screen.wanted = 0x20 + (selected & 3);   // unk2A, unk2B
  screen.turning = screen.wasTurning = screen.turnFrames = 0;   // unk2C (1 to the right, 2 to the left), unk2D, unk2E
  screen.frames = 0; screen.code = NO_CODE;   // unk24, unk39
  create_task(fade_in, &screen, 0x2000, 0, NULL);
  name.o = line(0, 0x54, 6, 2, 0, 0x14); name.frames = 0; name.angle = 0; name.shake = 0;
  screen.name = create_task(nothing, &name, 0x2030, 0, NULL);
  bars.o = line(0x100, 0x40, 8, 0, 0xF, 0x5A); bars.frames = 0; bars.angle = screen.turn & 0xFFFF; bars.shake = screen.turn;
  screen.bars = create_task(nothing, &bars, 0x2030, 0, NULL);
  arrows.o = line(0x100, 0x28, 1, 1, 0, 0); arrows.frames = 0;
  screen.arrows = create_task(nothing, &arrows, 0x2040, 0, NULL);
  title.o = line(0, 0x38, 8, 3, 0, 0x78); title.strip = line(0x118, 0x3A, 9, 4, 0, 0x64);
  title.frames = 0; title.cursor = 0; title.x = 0x4600; title.speed = 0;
  screen.title = create_task(nothing, &title, 0x2030, 0, NULL);

  sprite_init(&backdrop.s);
  backdrop.s.graphics.dest = 0x4040; backdrop.s.graphics.anim = ANIM_BACKDROP;
  backdrop.s.frameFlags = 0x8000; backdrop.s.prevVariant = 0xFF; backdrop.s.animSpeed = 0x10;
  backdrop.angle = 0;
  screen.backdrop = create_task(show_backdrop, &backdrop, 0x2020, 0, NULL);
  update_sprite(&backdrop.s, 1);
  display_sprite_background(&backdrop.s);

  load(GFX_BARS, 0, 0, 0x400, 0x20, 0xD, (selected & 3) * 6, 8, 0xF);
  load(GFX_ARROWS, 1, 0, 0x400, 0x420, 0xD, 0, 0x20, 0);
  load(GFX_NAME, 2, (selected & 3) * 0xC00, 0xC00, 0x1120, 9, 0, 0x20, 0);
  load(GFX_TITLE, 3, 0, 0x100, 0x820, 9, 0, 0x20, 0);
  load(GFX_STRIP, 4, 0, 0x800, 0x920, 9, 0, 0x20, 0);

  Sprite *sprites = characters.sprites;
  character(&sprites[MIDDLE], 0x2520, 280, 0, 0x7C0, ANIM_CHARACTERS);
  character(&sprites[LEFT], 0x3920, -50, 6, 0x7C0, ANIM_CHARACTERS);
  character(&sprites[RIGHT], 0x4D20, 290, 2, 0x7C0, ANIM_CHARACTERS);
  character(&sprites[BLOCK], 0x6120, 290, 0, 0x700, ANIM_BLOCK);
  update_sprite(&sprites[BLOCK], 0);
  characters.frames = 0; characters.angle = 0; characters.turning = 0;
  screen.characters = create_task(nothing, &characters, 0x2010, 0, NULL);

  e.mapFill[1].value = 0;
  e.mapFill[1].rect[0] = 0; e.mapFill[1].rect[1] = 0; e.mapFill[1].rect[2] = 0xFF; e.mapFill[1].rect[3] = 0x20;
  play_song_or_continue(SONG_CHARACTER_SELECTION);   // m4aSongNumStartOrContinue
  fade_step(&screen.fade);
}

// the characters' sprites, as a frame of the row shows them
static void show_characters(Sprite *sprites) {
  static const int order[3] = { LEFT, MIDDLE, RIGHT };
  for (int k = 0; k < 3; k++) {
    update_sprite(&sprites[order[k]], 0);
    display_sprite(&sprites[order[k]]);
  }
}

static void choose(Task *t);
static void characters_in(Task *t);
static void bars_in(Task *t);
static void show_arrows(Task *t);
static void name_in(Task *t);
static void title_in(Task *t);

// Task_8059F9C: once it has faded in, the two windows at the sides that the blend makes darker, and everything starts
static void fade_in(Task *t) {
  if (!fade_step(&screen.fade)) return;
  screen.fade = create_fade(0, 1, 1, 0, 0x200, 1);
  e.dispCnt |= 0x6000;
  e.winRegs[0] = WIN(0, 40);
  e.winRegs[2] = WIN(0, 240);
  e.winRegs[1] = WIN(200, 240);
  e.winRegs[3] = WIN(0, 240);
  e.winRegs[4] = 0x3F3F;
  e.winRegs[5] = 0x1F;
  e.bldCnt = 0x1290;
  e.bldAlpha = 0x10;
  e.bldY = 8;
  screen.characters->main = characters_in;
  screen.bars->main = bars_in;
  screen.arrows->main = show_arrows;
  screen.name->main = name_in;
  screen.title->main = title_in;
  t->main = choose;
}

// CheckCPUPartnerUnlock
static void watch_code(uint16_t pressed) {
  if (!pressed) return;
  if (pressed & KEY_UP && ((screen.turn & 0x300) >> 8) == 0) { screen.code = 0; return; }
  if (screen.code == NO_CODE) return;
  screen.code = pressed & PARTNER_KEYS[screen.code] ? screen.code + 1 : NO_CODE;
}

static void start_turn(int way) {
  if (screen.turning) return;
  screen.turning = way;
  screen.turnFrames = 0x10;
  play_song(SONG_SHIFT);
}

static void go_back(Task *t);
static void pick(Task *t);

// the characters the other GBAs have picked, a bit for each (unk2F): any packet after "still choosing" names its character
static int taken_by(void) {
  int taken = 0, connections = vs_connections();
  for (int i = 0; i < PLAYERS_MAX; i++) {
    const uint8_t *packet = link_slot(i);
    if (i != link_id() && connections >> i & 1 && packet && packet_kind(packet) > CHOOSING) taken |= 1 << packet[2];
  }
  return SAME_CHARACTER_ALLOWED ? 0 : taken;
}

static void wait_for_others(Task *t);

// Task_805A060, as one player has it
static void choose(Task *t) {
  int multi = multi_player();
  if (multi) {
    if (vs_link_lost()) return;
    screen.taken = taken_by();
  }
  int wanted = screen.wanted;
  int ready = (uint32_t)screen.frames > READY;
  watch_code(e.pressed);
  int taken = screen.taken & 1 << (wanted & 3);
  if (e.repeated & KEY_B && ready && wanted == screen.shown && !multi) {
    play_song(SONG_RETURN);
    // sub_805B858
    screen.frames = 0;
    e.bldY = 0;
    t->main = go_back;
  } else if (e.repeated & KEY_A && wanted == screen.shown && ready && !taken) {
    play_song(SONG_SELECT);
    if (!multi) pick(t);
    else {
      screen.arrows->flags |= TASK_INACTIVE;
      t->main = wait_for_others;
    }
  } else if (e.repeated & KEY_LEFT && ready) {
    wanted--;
    start_turn(2);
  } else if (e.repeated & KEY_RIGHT && ready) {
    wanted++;
    start_turn(1);
  } else if (wanted > screen.shown) start_turn(1);
  else if (wanted < screen.shown) start_turn(2);
  else if (screen.taken & 1 << (wanted & 3) && ready) {
    // the character in the middle was picked by another GBA: on to the next one, the way the row was going
    if (screen.wasTurning) wanted += screen.wasTurning & 1 ? 1 : -1;
    else start_turn(1);
  }

  screen.wasTurning = screen.turning;
  if (screen.turning && screen.turnFrames) {
    screen.turn = s16(screen.turn + (screen.turning & 1 ? 0x10 : -0x10));
    if (--screen.turnFrames == 0) screen.turning = 0;
  }
  screen.turn &= 0x3FFF;
  screen.wanted = s8(wanted & 0x3F);
  if (screen.shown <= screen.wanted) screen.shown = s8(screen.turn >> 8);
  else screen.shown = s8((screen.turn >> 8) + (screen.turn & 0xFF ? 1 : 0));
  screen.shown &= 0x3F;
  if (screen.shown > 0x24 && screen.wanted > 0x24 && screen.turn > 0x2400) {
    while (screen.shown > 0x24) screen.shown -= 4;
    while (screen.wanted > 0x24) screen.wanted -= 4;
    while (screen.turn > 0x2400) screen.turn -= 0x400;
  } else if (screen.shown < 0x1C && screen.wanted < 0x1C && screen.turn < 0x1C00) {
    while (screen.shown < 0x1C) screen.shown += 4;
    while (screen.wanted < 0x1C) screen.wanted += 4;
    while (screen.turn < 0x1C00) screen.turn += 0x400;
  }
  int angle = screen.turn & 0x3FF;
  name.angle = angle;
  bars.angle = angle;
  characters.angle = angle;
  characters.turning = screen.turning;
  if (screen.backdrop && screen.backdrop->data == &backdrop) backdrop.angle = angle;   // gone after a pick
  title.frames = ++screen.frames;
  if (multi) {
    uint8_t *send = link_send();
    set_kind(send, CHOOSING);
    send[2] = (uint8_t)((angle & 0x300) >> 8);
  }
}

// the character in the middle of the row
static int character_of(void) { return (screen.turn & 0x300) >> 8; }
static void back_to_choosing(Task *t) { screen.arrows->flags &= ~TASK_INACTIVE; t->main = choose; }
static void wait_for_answer(Task *t);

// Task_805A54C: picked; the parent waits for every GBA to say so, and tells them all
static void wait_for_others(Task *t) {
  if (vs_link_lost()) return;
  int id = link_id(), connections = ctx.vsLink.connections, mine = character_of();
  uint8_t *send = link_send();
  if (e.pressed & KEY_B) { back_to_choosing(t); return; }
  if (packet_kind(link_slot(0)) == ALL_PICKED) {
    for (int i = 0; i < PLAYERS_MAX; i++) {
      if (connections >> i & 1) ctx.vsLink.characters[i] = link_slot(i) ? link_slot(i)[2] : 0;
    }
    t->main = wait_for_answer;
    return;
  }
  for (int i = 0; i < PLAYERS_MAX; i++) {
    const uint8_t *packet = link_slot(i);
    // a GBA before this one that picked the same character has it
    if (!SAME_CHARACTER_ALLOWED && connections >> i & 1 && i != id && packet_kind(packet) == PICKED && packet[2] == mine && i < id) back_to_choosing(t);
  }
  if (link_flags() & 0x80) {
    uint8_t picked[4] = { 0 };
    set_kind(send, ALL_PICKED);
    send[2] = (uint8_t)mine;
    for (int i = 0; i < PLAYERS_MAX; i++) {
      if (!(connections >> i & 1)) continue;
      const uint8_t *packet = link_slot(i);
      if (packet_kind(packet) != PICKED || (!SAME_CHARACTER_ALLOWED && ++picked[packet[2] & 3] > 1)) {
        set_kind(send, PICKED);
        break;
      }
    }
  } else {
    set_kind(send, PICKED);
    send[2] = (uint8_t)mine;
  }
}

// Task_805A798: everyone has picked; the parent sends each one's character and how far the characters have got, and the
// GBAs pick together
static void wait_for_answer(Task *t) {
  if (vs_link_lost()) return;
  int flags = link_flags(), connections = ctx.vsLink.connections, mine = character_of();
  uint8_t *send = link_send();
  int parent = packet_kind(link_slot(0));
  if (parent == ANSWER) {
    int furthest = 0;
    for (int i = 0; i < PLAYERS_MAX; i++) {
      if (!(connections >> i & 1)) continue;
      const uint8_t *packet = link_slot(i);
      if (packet && packet[3] > furthest) furthest = packet[3];
      if (!(flags & 0x80)) ctx.vsLink.characters[i] = packet ? packet[2] : 0;
    }
    ctx.vsLink.furthest = (uint8_t)furthest;   // gUnknown_03005140
    pick(t);
    return;
  }
  if (parent == PICKED) {
    set_kind(send, CHOOSING);
    back_to_choosing(t);
    return;
  }
  int unlocked = save_unlocked_level(mine) & 0xFF;
  if (flags & 0x80) {
    set_kind(send, ANSWER);
    send[2] = (uint8_t)mine;
    send[3] = (uint8_t)unlocked;
    for (int i = 1; i < PLAYERS_MAX; i++) {
      if (!(connections >> i & 1)) continue;
      const uint8_t *packet = link_slot(i);
      ctx.vsLink.characters[i] = packet ? packet[2] : 0;
      if (packet_kind(packet) != ALL_PICKED) {
        set_kind(send, ALL_PICKED);
        if (e.pressed & KEY_B) set_kind(send, PICKED);
        break;
      }
    }
  } else {
    set_kind(send, ALL_PICKED);
    send[2] = (uint8_t)mine;
    send[3] = (uint8_t)unlocked;
  }
}

/** The VS menus' character select: every GBA starts on a character of its own (CreateCharacterSelectionScreen((PSEUDO_RANDOM_32() + id) % 4)). */
void create_vs_character_select(void) {
  memset(ctx.vsLink.characters, 0, sizeof ctx.vsLink.characters);
  create_character_select((int)((front_random() + (uint32_t)link_id()) % 4));
}

static void title_picked(Task *t);
static void characters_leave(Task *t);
static void name_picked(Task *t);
static void bars_picked(Task *t);
static void leave(Task *t);

// sub_805A9A4: the character is picked. Its pose takes the middle, the arrows and the backdrop's task go, and the strip
// changes to the picked one's
static void pick(Task *t) {
  screen.picked = (screen.turn & 0x300) >> 8;
  characters.sprites[MIDDLE].variant = (uint8_t)(((screen.turn & 0x300) >> 7) + 1);
  screen.title->main = title_picked;
  screen.characters->main = characters_leave;
  screen.name->main = name_picked;
  screen.bars->main = bars_picked;
  destroy_task(screen.arrows);
  destroy_task(screen.backdrop);
  screen.backdrop = NULL;
  screen.frames = 0;
  title.speed = 0xB4;
  e.bldY = 0;
  load(GFX_STRIP_PICKED, 4, 0, 0x200, 0x920, 9, 0, 0x20, 0);
  t->main = leave;
}

static void to_act(Task *t) { destroy_task(t); front_play(-1); }

// Task_805AAF8: after a while the screen fades to black, and then the act, or the course select. The code's last key
// brings the partner
static void leave(Task *t) {
  if (++screen.frames > PICK_END) {
    if (multi_player()) {
      // the screen shows who each GBA picked (sub_801C9D8)
      Task *tasks[4] = { screen.name, screen.bars, screen.characters, screen.title };
      for (int i = 0; i < 4; i++) destroy_task(tasks[i]);
      destroy_task(t);
      e.dispCnt &= 0xFFF;
      e.bldCnt = 0;
      e.bldY = 0;
      create_vs_overview();
      return;
    }
    // the code's partner is for the single-player game only (gGameMode)
    int partner = ctx.gameMode == SINGLE_PLAYER && screen.code == PARTNER_READY;
    destroy_task(screen.name);
    destroy_task(screen.bars);
    destroy_task(screen.characters);
    destroy_task(screen.title);
    if (partner) play_song(SONG_RING);
    ctx.character = screen.picked;
    ctx.partner = partner;
    if (ctx.gameMode == TIME_ATTACK || save_unlocked_level(ctx.character) != 0) {
      destroy_task(t);
      e.dispCnt &= 0xFFF;
      e.bldCnt = 0;
      e.bldY = 0;
      create_course_select();
      return;
    }
    // Loading the act takes the console past the next V-blank, so it starts a frame later, and the windows and the
    // blend the original turns off here never reach the screen, which stays black.
    play_song(SONG_NEO_GREEN_HILL_1);   // StageInit_ZoneNActM's music, a frame ahead of the act's first picture
    t->main = to_act;
  } else if (screen.frames > PICK_WAIT) fade_step(&screen.fade);
}

// Task_805AC00: B fades it out, the tasks ending partway through with the layers' maps cleared, and the main menu comes
static void go_back(Task *t) {
  screen.frames++;
  screen.fade.unk8 = 0x180;
  screen.fade.unkA = 0x10;
  if (fade_step(&screen.fade)) {
    stop_song(SONG_CHARACTER_SELECTION);
    e.dispCnt &= 0xFFF;
    e.bldCnt = 0;
    e.bldY = 0;
    destroy_task(t);
    if (ctx.gameMode == TIME_ATTACK) create_time_attack_menu();
    else create_main_menu(1);
  } else if (screen.frames == BACK_CLEAR) {
    Task *tasks[6] = { screen.name, screen.bars, screen.characters, screen.title, screen.arrows, screen.backdrop };
    for (int i = 0; i < 6; i++) destroy_task(tasks[i]);
    for (int bg = 0; bg < 3; bg++) {
      e.mapFill[bg].value = 0;
      e.mapFill[bg].rect[0] = 0; e.mapFill[bg].rect[1] = 0; e.mapFill[bg].rect[2] = 0xFF; e.mapFill[bg].rect[3] = 0x14;
    }
  }
}

static void strip_cursor(Title *d) {
  if (d->x < -1984) {
    d->x += 0x800;
    d->cursor = (d->cursor + 1) & 7;
  }
}

static void title_stays(Task *t);

// Task_805ACD8: the title comes in from the right and drops to its place, its strip scrolling under it
static void title_in(Task *t) {
  Title *d = t->data;
  int f = s16(d->frames);
  if (f > 0x20) {
    d->o.unkC = 6;
    d->frames = 0;
    d->x -= 0xB4;
    t->main = title_stays;
  } else if (f > 0xC) {
    int i = f - 0xD;
    d->o.unkC = (uint16_t)(0x38 - (SINE[i * (i / 10 + 0x11)] >> 8));
    d->x -= 0xB4;
  } else if (f > 9) {
    d->o.unkA = 0;
    d->x -= 0xB4;
  } else {
    d->o.unkA = (uint16_t)(0x100 - bios_div(f << 8, 10));
    d->x -= 0x640;
  }
  draw_ui_text(TITLE_ROW, &d->o, 0);
  d->strip.unkE = d->x > 0 ? (uint16_t)(9 - bios_div(d->x >> 6, 32)) : 9;
  if (d->x > 0x3C00) d->strip.unkE = 0;
  strip_cursor(d);
  d->strip.unkA = (uint16_t)(d->x >> 6);
  d->strip.unkC = d->o.unkC;
  draw_ui_text(STRIP_ROW + d->cursor, &d->strip, 0);
}

// sub_805ADF0: the title in its place
static void title_stays(Task *t) {
  Title *d = t->data;
  d->o.unkA = 0;
  draw_ui_text(TITLE_ROW, &d->o, 0);
  d->strip.unkC = 6;
  d->x -= 0xB4;
  d->strip.unkE = d->x > 0 ? (uint16_t)(9 - bios_div(d->x >> 6, 32)) : 9;
  strip_cursor(d);
  d->strip.unkA = (uint16_t)(d->x >> 6);
  draw_ui_text(STRIP_ROW + d->cursor, &d->strip, 0);
}

// Task_805AE84: after a pick, solid, its strip coming to a stop
static void title_picked(Task *t) {
  Title *d = t->data;
  d->o.unkA = 0;
  draw_ui_glyphs(TITLE_ROW, &d->o, 0);
  d->strip.unkC = 6;
  d->x -= d->speed;
  for (int i = 0; i < 3; i++) if (d->speed) d->speed--;
  strip_cursor(d);
  d->strip.unkA = (uint16_t)(d->x >> 6);
  draw_ui_glyphs(STRIP_PICKED_ROW + d->cursor, &d->strip, 0);
}

static void name_shows(Task *t);

// Task_805AF24: the name comes in from the right and slides up to its place
static void name_in(Task *t) {
  Part *d = t->data;
  int f = ++d->frames;
  if (f > 0x21) {
    d->o.unkC = 0x84;
    d->frames = 0;
    t->main = name_shows;
  } else if (f > 13) d->o.unkC = (uint16_t)((SINE[(bios_div(f * 103, 110) - 10) * 17] >> 8) + 0x54);
  else if (f > 0xA) d->o.unkA = (uint16_t)NAME_X[0];
  else d->o.unkA = (uint16_t)(0x100 - bios_div(f << 8, 0xA) + NAME_X[0]);
  draw_ui_text(TEXT_ROW, &d->o, 0);
}

// sub_805AFC4: the name of the character in the middle, which shakes as the row turns, and changes halfway through
static void name_shows(Task *t) {
  Part *d = t->data;
  int low = d->angle % 256;
  if (low != 0) {
    int who = (d->angle & 0x300) >> 8;
    int shake = low < 0x7F ? (0x7F - low) >> 1 : (low - 0x7F) >> 1;
    if (d->shake == 0) {
      who = (who + (low > 128 ? 1 : 0)) & 3;
      ui_gfx_stack_init();
      load(GFX_NAME, 2, who * 0xC00, 0xC00, 0x1120, 9, 0, 0, 0);
    }
    d->shake = shake;
    d->o.unkA = (uint16_t)(NAME_X[who] + NAME_SHAKE[low >> 4]);
  } else d->o.unkA = (uint16_t)NAME_X[(d->angle & 0x300) >> 8];
  draw_ui_text(TEXT_ROW, &d->o, 0);
}

// Task_805B880: after a pick, solid
static void name_picked(Task *t) {
  Part *d = t->data;
  d->frames++;
  draw_ui_glyphs(TEXT_ROW, &d->o, 0);
  d->o.unkA = (uint16_t)NAME_X[(d->angle & 0x300) >> 8];
}

// Task_805B11C: the arrows: they meet from the sides, then bob
static void show_arrows(Task *t) {
  Part *d = t->data;
  int was = d->frames, now = ++d->frames;
  if (now > 0x26) {
    if (now > 0x62) d->frames = was - 0x3B;
    int at = (now % 0x3C) / 10;
    d->o.unkA = (uint16_t)ARROW_X[at];
    draw_ui_text(" ", &d->o, 0);
    d->o.unkA = (uint16_t)ARROW_X[7 + at];
    draw_ui_text("!", &d->o, 0);
  } else if (now > 30) {
    d->o.unkA = (uint16_t)s16((was - 0x1D) * 6 - 0x24);
    draw_ui_text(" ", &d->o, 0);
    d->o.unkA = (uint16_t)s16(0xF0 - (now - 0x1E) * 6);
    draw_ui_text("!", &d->o, 0);
  }
}

static void turn_characters(Task *t);

// Task_805B1E0: the characters come in from the sides, the window at the right opening as they do
static void characters_in(Task *t) {
  Characters *d = t->data;
  Sprite *sprites = d->sprites;
  int who = (d->angle & 0x300) >> 8;
  int was = d->frames++;
  if (d->frames > 0x11) {
    int f = was - 0x10;
    sprites[MIDDLE].x = (int16_t)(256 - bios_div(f << 7, 11));
    sprites[RIGHT].x = (int16_t)(284 - bios_div(f << 5, 11));
    sprites[LEFT].x = (int16_t)(bios_div(f << 5, 11) - 32);
    sprites[MIDDLE].y = 110;
    e.winRegs[1] = f <= 4 ? WIN(240, 240) : (uint16_t)(((240 - (was - 0x15) * 5) << 8) + 240);
  }
  if (d->frames > 28) {
    d->frames = 0;
    e.winRegs[1] = WIN(200, 240);
    t->main = turn_characters;
  }
  sprites[MIDDLE].variant = (uint8_t)(who * 2);
  sprites[RIGHT].variant = (uint8_t)(((who + 1) & 3) * 2);
  sprites[LEFT].variant = (uint8_t)(((who + 3) & 3) * 2);
  show_characters(sprites);
}

// sub_805B324: the row turning: out of the screen on one side, in on the other, in eight frames of the turn's sixteen
static void turn_characters(Task *t) {
  Characters *d = t->data;
  Sprite *sprites = d->sprites;
  int who = (d->angle & 0x300) >> 8;
  int step = (d->angle & 0xFF) >> 4;
  if (d->turning == 0) {
    sprites[LEFT].x = -8;
    sprites[MIDDLE].x = 120;
    sprites[RIGHT].x = 248;
  } else {
    int right = d->turning & 1, way = right ? -1 : 1;
    if (!right) step = 0x10 - step;
    const uint8_t *after = ROW_AFTER[right];
    if (step == 4) {
      sprites[MIDDLE].variant = (uint8_t)(((after[0] + who) & 3) * 2);
      sprites[RIGHT].variant = (uint8_t)(((after[1] + who) & 3) * 2);
      sprites[LEFT].variant = (uint8_t)(((after[2] + who) & 3) * 2);
      for (int i = LEFT; i <= RIGHT; i++) sprites[i].x = (int16_t)(sprites[i].x - way * 128);
    }
    if (step <= 8) for (int i = LEFT; i <= RIGHT; i++) sprites[i].x = (int16_t)(sprites[i].x + way * 16);
  }
  show_characters(sprites);
}

// Task_805B8C0: after a pick, the two at the sides leave
static void characters_leave(Task *t) {
  Characters *d = t->data;
  if (d->frames < 5) {
    d->sprites[LEFT].x = (int16_t)(d->sprites[LEFT].x - 0x14);
    d->sprites[RIGHT].x = (int16_t)(d->sprites[RIGHT].x + 0x14);
  }
  d->frames++;
  show_characters(d->sprites);
}

static void draw_bars(Part *d, int solid) {
  if (solid) draw_ui_glyphs(BAR_TOP, &d->o, 0); else draw_ui_text(BAR_TOP, &d->o, 0);
  d->o.unkC += 0x20;
  if (solid) draw_ui_glyphs(BAR_BOTTOM, &d->o, 0); else draw_ui_text(BAR_BOTTOM, &d->o, 0);
  d->o.unkC -= 0x20;
}

// the colours of the character in the middle, for the bars
static void load_bar_colours(int who) { load(GFX_BARS, 0, 0, 0, 0x20, 0xC, who * 6, 8, 0xF); }

static void bars_show(Task *t);

// Task_805B52C: the two bars come in from the right and slide up to their place
static void bars_in(Task *t) {
  Part *d = t->data;
  int f = ++d->frames;
  if (f > 0x21) {
    d->frames = 0;
    d->o.unkC = 0x70;
    t->main = bars_show;
  } else if (f > 0xD) d->o.unkC = (uint16_t)((SINE[(bios_div(f * 0x67, 0x6E) - 0xA) * 0x11] >> 8) + 0x40);
  else if (f > 0xA) d->o.unkA = 0;
  else {
    d->o.unkA = (uint16_t)(0x100 - bios_div(f << 8, 0xA));
    if (f == 1) load_bar_colours((d->angle & 0x300) >> 8);
  }
  draw_bars(d, 0);
}

// sub_805B694: the bars close up as the row turns, and take the new character's colours halfway through
static void bars_show(Task *t) {
  Part *d = t->data;
  int low = d->angle & 0xFF;
  d->o.unkA = 0;
  if (low != 0) {
    int shake = (low < 0x7F ? 0x7F - low : low - 0x7F) >> 1;
    d->o.unkC = (uint16_t)(168 - shake);
    if (d->shake == 0) load_bar_colours((((d->angle & 0x300) >> 8) + (low > 0x80 ? 1 : 0)) & 3);
    d->shake = shake;
  } else d->o.unkC = 0x70;
  if (d->o.unkC < 0x70) d->o.unkC = 0x70;
  draw_bars(d, 0);
}

// Task_805B930: after a pick, solid
static void bars_picked(Task *t) {
  Part *d = t->data;
  d->frames++;
  d->o.unkA = 0;
  draw_bars(d, 1);
}

// Task_805B984: the backdrop's frame for how far the row has turned, its tiles copied anew each frame
static void show_backdrop(Task *t) {
  Backdrop *d = t->data;
  d->s.prevVariant = 0xFF;
  d->s.graphics.anim = ANIM_BACKDROP;
  d->s.variant = BACKDROP_VARIANTS[(d->angle & 0xFF) >> 6];
  update_sprite(&d->s, 1);
  display_sprite_background(&d->s);
}
