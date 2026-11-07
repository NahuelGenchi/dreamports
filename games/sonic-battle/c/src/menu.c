// menu.js in C: the main menu, after the title screen. The decompilation's src/unknown_08039dd8.cpp: the initializer
// 0x08039e20, its frame wrapper 0x08039fd0 and the handlers 0x08039fe0, 0x0803a3b8, 0x0803a428, 0x0803a0f8,
// 0x0803a478 and 0x0803a260, with the arrows' 0x08028238, 0x08028270, 0x08028388, 0x080283c0, 0x08027fb8 and
// 0x08028038. It shows the mode select: a background of layers, the preview of each mode's picture fading in over them,
// the animated picture, and the two arrows that move the choice.
//
// The original runs this screen as a list of nodes, each a callback called once a frame in the list's order
// (0x0801f7d0 adds one at the end, 0x0801f89c walks them), and a node added on the way runs in that same frame.

#include "game.h"
#include "menu.h"

#define CARTRIDGE 0x08000000u
#define PALETTE 0x05000000u
#define VRAM 0x06000000u
#define SINE 0x0804DF7Cu

// the cartridge's table of the display registers the initializer writes, and how many
#define REGISTERS 0x0815F02Cu
#define REGISTER_COUNT 16
#define DISPCNT 0x00
#define BG3VOFS 0x1E
#define BLDCNT 0x50
#define BLDALPHA 0x52

// gUnknown_08edd314 and gUnknown_08edd32c: the sprites' tiles and the previews' pictures, by language
static const uint32_t SPRITE_PICTURES[6] = {0x0815FAFC, 0x08160244, 0x08160244, 0x08160244, 0x08160244, 0x08160244};
static const uint32_t PREVIEW_PICTURES[6] = {0x081609E4, 0x081679E4, 0x081679E4, 0x081679E4, 0x081679E4, 0x081679E4};
#define PREVIEW_PALETTES 0x0816E9E4u

// the palette each of the four fades steps toward, and where it is
static const uint32_t FADES[4][2] = {
  {PALETTE, 0x0815F7F8}, {0x050001C0, 0x0815E67C}, {0x050001E0, 0x081326F4}, {0x05000200, 0x081609C4},
};

// the animated picture: eight frames of 12 by 17 entries from 0x0815e69c
#define ANIMATION 0x0815E69Cu
#define ANIMATION_WORDS (12 * 17)
// the sprites' parts, each eight bytes: the main sprite's and the arrows'
#define PARTS 0x0816EACCu
#define PARTS_ARROWS 0x0816EAC4u

#define MENU_SONG 1
#define SOUND_MOVE 401
#define SOUND_MADE 404
// gSongTable: eight bytes for each song, with the number of the player it plays on at the fifth
#define SONG_TABLE 0x08BF7244u
#define SONG_FADE 120
#define CHOICES 7
#define OPTIONS 6

#define MAX_NODES 64
#define MAX_DRAWN 32
static Node nodes[MAX_NODES];
static int node_count;
static Place drawn[4][MAX_DRAWN];
static int drawn_count[4];
static int matrices;
static int selection, choice;

static void startFrameNode(Node *node);
static void scroll(Node *node);
static void animate(Node *node);
static void drawOnly(Node *node);
static void fadeIn(Node *node);
static void loadPreview(Node *node);
static void previewIn(Node *node);
static void menuChoosing(Node *node);
static void previewOut(Node *node);
static void leaving(Node *node);
static void arrowStart(Node *node);
static void arrowSettled(Node *node);
static void arrowSlideLeft(Node *node);
static void arrowSlideRight(Node *node);
static void nothing(Node *node);
static void songAndDisplay(void);
static void displayOn(void);

static inline int16_t sineAt(uint32_t at) { return (int16_t)(gba_rom[at - CARTRIDGE] | (gba_rom[at - CARTRIDGE + 1] << 8)); }
static inline uint16_t rom16(uint32_t at) { return (uint16_t)(gba_rom[at - CARTRIDGE] | (gba_rom[at - CARTRIDGE + 1] << 8)); }
static inline uint8_t rom8(uint32_t at) { return gba_rom[at - CARTRIDGE]; }

/** menu.js's place(): a sprite's parts, where, and what they add. */
Place menuPlace(uint32_t parts, int x, int y, int tile, int attr2) {
  Place p = {parts, x, y, tile, 0, 0, attr2, 0, 0, {0}};
  return p;
}

/** menu.js's record(): a sprite's record in the cartridge, as a place of its own. */
Place menuRecord(uint32_t at) {
  Place p = {
    read32(at), reads16(at + 4), reads16(at + 6), read16(at + 8),
    read8(at + 10), read8(at + 11), read8(at + 12), 0, 0, {0},
  };
  return p;
}

/** 0x0801f7d0: a node added at the end of the list. */
Node *menuAddNode(void (*run)(Node *), Place place, int hasPlace) {
  if (node_count >= MAX_NODES) return &nodes[MAX_NODES - 1];
  Node *node = &nodes[node_count++];
  node->run = run;
  node->place = place;
  node->count = node->to = node->tile = node->timer = 0;
  node->base_x = node->base_y = 0;
  node->left = node->right = 0;
  node->scrolled = 0;
  if (!hasPlace) node->place.parts = 0;
  return node;
}

/** 0x0801fed8: a sprite asks to be drawn this frame. */
void menuDraw(Place position) {
  int group = (position.attr2 & 0x0C) >> 2;
  if (drawn_count[group] < MAX_DRAWN) drawn[group][drawn_count[group]++] = position;
}

/** 0x080200f8, the list's first node: no sprite has asked yet this frame, and no matrix is taken. */
void menuStartFrame(void) {
  for (int g = 0; g < 4; g++) drawn_count[g] = 0;
  matrices = 0;
}

static void startFrameNode(Node *node) { (void)node; menuStartFrame(); }

/** The list emptied, as a screen's first frame does. */
void menuReset(void) {
  node_count = 0;
  menuStartFrame();
}

/** 0x08030d20: the scrolling layer, a line every other frame. */
static void scroll(Node *node) {
  node->count = (node->count - 1);
  queueRegister(BG3VOFS, (uint16_t)((node->count & 0x1FE) >> 1));
}

/** 0x08039dd8: the animated picture's block of the map, a new picture of the eight every four frames. */
static void animate(Node *node) {
  node->timer++;
  if (node->timer > 23) node->timer = 0;
  copyTileBlock(node->to, (uint32_t)(ANIMATION + ((node->timer >> 2) & 7) * ANIMATION_WORDS * 2), 12, 17, node->tile);
}

/** 0x0801f9d8: a sprite that only asks to be drawn. */
static void drawOnly(Node *node) { menuDraw(node->place); }

/** A node that does nothing, as menu.js's leaving leaves an unported mode's screen black. */
static void nothing(Node *node) { (void)node; }

/** 0x0801fd18, with no turn: a sprite matrix that scales by 256 over `scale`, and its number. It writes where the
 *  original does, whose matrix after the first lands two bytes along from the one before and not in its own sprites'. */
static int takeMatrix(int scale) {
  int number = matrices;
  if (number > 31) return 0xFF;
  int cosine = (int)((int32_t)(sineAt(SINE + 0x800 * 2) << 3) / scale);
  int sine = (int)((int32_t)(sineAt(SINE) << 3) / scale);
  uint16_t *out = g.oam_buffer;
  out[number + 3] = (uint16_t)cosine;
  out[number + 7] = (uint16_t)sine;
  out[number + 11] = (uint16_t)-sine;
  out[number + 15] = (uint16_t)cosine;
  matrices++;
  return number;
}

/** 0x0801fda0: the sprites that asked, highest priority first and the newest first within one, into the buffer, with
 *  every sprite after them hidden, for the next V-blank to copy. */
static void drawSprites(void) {
  uint16_t *out = g.oam_buffer;
  int count = 0;
  for (int group = 0; group < 4; group++) {
    for (int i = drawn_count[group] - 1; i >= 0; i--) {
      const Place *position = &drawn[group][i];
      // a sprite's parts are the cartridge's, or a copy of its own (options.js's chosen text)
      const uint8_t *bytes = position->own ? position->own_parts : gba_rom;
      uint32_t p = position->own ? 0 : position->parts - CARTRIDGE;
      for (; count < 128; p += 8) {
        out[count * 4] = (uint16_t)((((bytes[p + 2] + position->attr0) << 8)
          | ((s8((int32_t)bytes[p + 6]) + position->y) & 0xFF)) & 0xFFFF);
        out[count * 4 + 1] = (uint16_t)((((bytes[p + 3] + position->attr1) << 8)
          | ((s8((int32_t)bytes[p + 5]) + position->x) & 0x1FF)) & 0xFFFF);
        out[count * 4 + 2] = (uint16_t)((((bytes[p + 4] + position->attr2) << 8)
          | (position->tile + (bytes[p] | (bytes[p + 1] << 8)))) & 0xFFFF);
        count++;
        if (!bytes[p + 7]) break;
      }
    }
  }
  for (; count < 128; count++) out[count * 4] = 0x200;
  g.oam_buffer_full = 1;
}

/** 0x08039fd0: the frame wrapper. Every node, a node added on the way too, and then the sprites they asked for. */
void menuFrame(void) {
  for (int walking = 0; walking < node_count; walking++) nodes[walking].run(&nodes[walking]);
  drawSprites();
}

/** The blend of a preview as it fades in or out: `state` sixteenths of the picture over the background. */
static uint16_t previewBlend(int state) { return (uint16_t)((0x1000 - (state << 8)) | state); }

/** 0x0803a428: the preview fades in, a step a frame, and the choice can be moved from its first step on. */
static void previewIn(Node *node) {
  node->place.state++;
  if (node->place.state <= 15) queueRegister(BLDALPHA, previewBlend(node->place.state));
  else {
    node->place.state = 16;
    queueRegister(BLDALPHA, 16);
    node->run = menuChoosing;
  }
  menuChoosing(node);
}

/** 0x0803a0f8: A chooses, and left and right move the choice round the seven, the arrow they go past sliding. */
static void menuChoosing(Node *node) {
  uint16_t pressed = g.keys.pressed;
  if (pressed & KEY_A) {
    choice = selection;
    node->run = leaving;
    gba_sound_fade_out(rom8(SONG_TABLE + MENU_SONG * 8 + 4), SONG_FADE >> 4);
    gba_sound_play(SOUND_MADE);
  } else if (pressed & KEY_LEFT) {
    selection = (selection + CHOICES - 1) % CHOICES;
    node->run = previewOut;
    if (node->left) {
      node->left->run = arrowSlideLeft;
      node->left->place.state = 0;
    }
    gba_sound_play(SOUND_MOVE);
  } else if (pressed & KEY_RIGHT) {
    selection = (selection + 1) % CHOICES;
    node->run = previewOut;
    if (node->right) {
      node->right->run = arrowSlideRight;
      node->right->place.state = 0;
    }
    gba_sound_play(SOUND_MOVE);
  }
}

/** 0x0803a478: the preview fades out, and then the new one loads. */
static void previewOut(Node *node) {
  if (node->place.state) {
    node->place.state--;
    queueRegister(BLDALPHA, previewBlend(node->place.state));
  } else {
    queueRegister(BLDALPHA, 0x1000);
    node->run = loadPreview;
  }
}

/** 0x0803a260: every colour fades to black, and then the chosen mode's screen starts: the Mini-games screen and the
 *  options aren't ported in C yet, so the screen stays black. */
static void leaving(Node *node) {
  if (!fadeToBlack(PALETTE, 512)) return;
  if (selection == OPTIONS) g.callback = startOptions;
  else node->run = nothing;
}

/** 0x08028238 and 0x08028270: an arrow takes its place, and draws from the next frame on. */
static void arrowSettle(Node *node) {
  node->place.x = node->base_x - 32;
  node->place.y = node->base_y - 32;
  node->place.attr0 = 0;
  node->place.attr1 = 0;
}

static void arrowSettled(Node *node) {
  arrowSettle(node);
  menuDraw(node->place);
  node->place.state = (node->place.state + 4) & 0xFF;
}

static void arrowStart(Node *node) {
  arrowSettle(node);
  node->run = arrowSettled;
}

/** 0x08027fb8 and 0x08028038's shared steps: the arrow grows for four frames and shrinks back in steps of three. */
static void arrowSlide(Node *node, void (*settled)(Node *), int left) {
  int value;
  if (node->place.state > 15) {
    node->run = settled;
    value = 0;
  } else if (node->place.state > 3) value = 4 - (node->place.state - 4) / 3;
  else value = node->place.state;
  node->place.x = left ? node->base_x - (value + 64) : node->base_x + (value - 64);
  node->place.y = node->base_y - 64;
  node->place.attr0 = 3;
  node->place.attr1 = takeMatrix(value * 16 + 256) * 2;
  menuDraw(node->place);
  node->place.state = (node->place.state + 1) & 0xFF;
}

static void arrowSlideLeft(Node *node) { arrowSlide(node, arrowSettled, 1); }
static void arrowSlideRight(Node *node) { arrowSlide(node, arrowSettled, 0); }

/** 0x0803a3b8: the choice's picture and palette, copied after the next V-blank, and the blend that shows them. */
static void loadPreview(Node *node) {
  queueCopy(0x06007000, (uint32_t)(PREVIEW_PICTURES[g.language] + (selection << 12)), 0x1000);
  queueCopy(0x050001A0, (uint32_t)(PREVIEW_PALETTES + (selection << 5)), 0x20);
  queueRegister(BLDCNT, 0x3F41);
  queueRegister(BLDALPHA, 0x1000);
  node->run = previewIn;
}

/** 0x08039fe0: the four palettes fade in, and once they have, the arrows come and the choice's preview loads. */
static void fadeIn(Node *node) {
  int arrived = 1;
  for (int i = 0; i < 4; i++) if (!fadeToward(FADES[i][0], FADES[i][1], 16)) arrived = 0;
  if (!arrived) return;
  node->left = menuAddNode(arrowStart, menuPlace(PARTS_ARROWS, 0, 0, 0, 4), 1);
  node->left->base_x = 64;
  node->left->base_y = 146;
  node->right = menuAddNode(arrowStart, menuPlace(PARTS_ARROWS, 0, 0, 64, 4), 1);
  node->right->base_x = 176;
  node->right->base_y = 118;
  selection = choice;
  node->run = loadPreview;
}

/** What the original takes before the menu's first frame with a saved name: the name entry's frame, going straight on,
 *  and 0x08039e20's decompressing, which runs past a V-blank. None of it shows, as the screen is black; only how long
 *  it takes does. */
#define FRAMES_BEFORE 2
static int menuWait;

void menuBeforeMenu(void) {
  menuWait++;
  if (menuWait > FRAMES_BEFORE) {
    menuWait = 0;
    showMenu(1);
  }
}

/** 0x0801fbfc: display registers from the cartridge's table at `from`, each its offset in 0x04000000 and its value. */
static void writeRegisters(uint32_t from, int count) {
  for (int i = 0; i < count; i++) gba_write(rom16(from + (uint32_t)i * 4), rom16(from + (uint32_t)i * 4 + 2));
}

/** 0x08039e20's last step: it runs past a V-blank, and the display is queued for the next. */
static void displayOn(void) {
  queueRegister(DISPCNT, 0x1F40);
  g.callback = menuFrame;
}

/** The song starts a frame after the screen is built, as the original's building runs past a V-blank. */
static void songAndDisplay(void) {
  gba_sound_wave_at(31815);   // where the song's start comes in its frame, as mGBA measures it
  gba_sound_play(MENU_SONG);
  displayOn();
}

/**
 * 0x08039e20: the screen's first frame. The registers, the sprites hidden, the palette black, the pictures and maps,
 * the list's nodes, and the display queued on for the next V-blank.
 */
void showMenu(int playSong) {
  menuReset();
  selection = 0;
  writeRegisters(REGISTERS, REGISTER_COUNT);
  g.queue_count = 0;              // 0x0801fb94
  hideSpriteBuffer();             // 0x0801ff30
  for (int i = 0; i < 512; i++) gba_pal[i] = 0;
  decompress(0x0815F06C, VRAM);
  decompress(0x0815C4B4, 0x06008000);
  decompress(0x08132544, 0x0600D240);
  decompress(SPRITE_PICTURES[g.language], 0x06010000);
  for (int i = 0; i < 0x800; i++) gba_vram[(0x0600F800 - VRAM) + i] = 0;
  copyTileBlock(0x0600FA06, 0x0816EAEC, 16, 8, 0xD380);
  for (int i = 0; i < 0x800; i++) gba_vram[(0x0600F000 - VRAM) + i] = 0;
  decompress(0x0815F818, 0x0600E800);
  uint32_t to = 0x0600E000;
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      copyTileBlock(to, 0x081327D4, 8, 8, 0xF292);
      to += 0x10;
    }
    to += 0x1C0;
  }
  menuAddNode(startFrameNode, menuPlace(0, 0, 0, 0, 0), 0);
  menuAddNode(scroll, menuPlace(0, 0, 0, 0, 0), 0);
  {
    Node *node = menuAddNode(animate, menuPlace(0, 0, 0, 0, 0), 0);
    node->to = 0x0600F0A6;
    node->tile = 0xE000;
    node->timer = 0;
  }
  menuAddNode(drawOnly, menuPlace(PARTS, 64, 32, 128, 0), 1);
  menuAddNode(fadeIn, menuPlace(0, 0, 0, 0, 0), 1);
  g.callback = playSong ? songAndDisplay : displayOn;
}
