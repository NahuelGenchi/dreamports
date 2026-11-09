// The result screen's opening in C: 0x0802b980, the screen's setup, 0x0802c1d4, its frame, 0x0802c37c, which starts
// the character panels, and 0x0802c56c, which fades its palette in. The fight's end hands over here after its fade; the
// recording that proves it ends as the screen has faded in, so the panels and the screen's later frames are later work.
//
// The screen's first frames show its background alone: BG3's map of 0x081327d4's boxes over 0x08132544's tiles, with
// BG3 scrolled by 0x08030d20, and the colours faded from black to 0x081326f4's, 0x08132714's or 0x08132734's by
// 0x0802c56c, which the main menu's choice picks.

#include "game.h"
#include "menu.h"

#define CARTRIDGE 0x08000000u
#define PALETTE 0x05000000u
#define VRAM 0x06000000u
#define DISPCNT 0x00
#define BG3HOFS 0x1C
#define BG3VOFS 0x1E

// the display registers 0x0801fbfc writes, each its offset in 0x04000000 and its value
#define REGISTERS 0x0811C244u
#define REGISTER_COUNT 16
// the main menu's choice, which picks the screen's tiles, its scrolling layer and its palette
#define MENU_CHOICE 0x03005264u
// the work RAM the screen keeps: the players' order, how many there are, the winner and the ranks
#define ORDER 0x03005278u
#define PLAYERS 0x0300527Cu
#define LINKED 0x0300138Cu
#define LANGUAGE 0x03002110u
#define CHARACTERS 0x03001620u
#define CHOICE_ROWS 0x03001D0Cu
// where each character's palette row is, in the choice screen's records
#define CHOICE_BYTES 252
// the three palettes the screen fades to, by menu choice, and the sprites' target
#define TARGET_STORY 0x081326F4u
#define TARGET_BATTLE 0x08132714u
#define TARGET_CHALLENGE 0x08132734u
#define TARGET_SPRITES 0x0811C2A4u
// the boxes' tiles, their map's source, and the screen's tiles, sprites and font
#define BOX_TILES 0x081327D4u
#define SCREEN_TILES 0x08132544u
#define SCREEN_SPRITES 0x0811C3A4u
#define SCREEN_FONT_ENGLISH 0x0811D818u
#define SCREEN_FONT_OTHER 0x0811D9BCu
#define BOX_MAP 0x0600D000u

static inline uint16_t rom16(uint32_t at) { return (uint16_t)(gba_rom[at - CARTRIDGE] | (gba_rom[at - CARTRIDGE + 1] << 8)); }

/** 0x0801fbfc: display registers from the cartridge's table at `from`, each its offset in 0x04000000 and its value. */
static void writeRegisters(uint32_t from, int count) {
  for (int i = 0; i < count; i++) gba_write(rom16(from + (uint32_t)i * 4), rom16(from + (uint32_t)i * 4 + 2));
}

/** 0x08021000: a source's tiles into a map at `to`, `width` by `rows` entries, each one plus `offset`. */
static void copyTiles(uint32_t to, uint32_t from, int width, int rows, int offset) {
  uint16_t *out = (uint16_t *)(gba_vram + (to - VRAM));
  uint32_t at = from - CARTRIDGE;
  for (int y = 0; y < rows; y++) {
    for (int x = 0; x < width; x++, out++) {
      *out = (uint16_t)(offset + (gba_rom[at] | (gba_rom[at + 1] << 8)));
      at += 2;
    }
    out += 32 - width;
  }
}

/** The sprites hidden in OAM now, as 0x08017ed0 leaves them after a screen has none. */
static void hideSpritesNow(void) {
  for (int i = 0; i < 32; i++) {
    uint16_t pattern[16] = {0x200, 0, 0, 0x100, 0x200, 0, 0, 0, 0x200, 0, 0, 0, 0x200, 0, 0, 0x100};
    for (int n = 0; n < 16; n++) gba_oam[i * 16 + n] = pattern[n];
  }
}

static void clearVram(uint32_t from, uint32_t bytes) {
  for (uint32_t i = 0; i < bytes; i++) gba_vram[(from - VRAM) + i] = 0;
}

/** 0x08030d20: the screen's background, a line every other frame, the layer the main menu's choice picks. */
static void resultScroll(Node *node) {
  // the list's first frame comes one after the screen's first, as 0x0802b980's setup runs past a V-blank
  if (node->timer < 1) {
    node->timer++;
    return;
  }
  node->count = node->count - 1;
  uint16_t line = (uint16_t)((node->count & 0x1FE) >> 1);
  uint32_t choice = read32(MENU_CHOICE);
  if (choice == 0 || choice == 2) gba_write(BG3HOFS, line);
  else gba_write(BG3VOFS, line);
}

static void resultPalette(Node *node);
static void resultFaded(Node *node) { (void)node; }

/** 0x0802c37c: the character panels' first task. They are off-screen for the frames this recording proves, so the
 *  screen's palette fade starts here and their own tasks wait for later work. */
static void resultPanels(Node *node) { node->run = resultPalette; }

/** 0x0802c56c: the colours step from black to the screen's palette, and the sprites' follow theirs. */
static void resultPalette(Node *node) {
  uint32_t choice = read32(MENU_CHOICE);
  uint32_t target = choice == 0 ? TARGET_STORY : choice == 2 ? TARGET_CHALLENGE : TARGET_BATTLE;
  int done = fadeToward(PALETTE, target, 16);
  if (!fadeToward(0x05000200, TARGET_SPRITES, 128)) done = 0;
  node->count++;
  if (done) {
    node->count = 0;
    node->run = resultFaded;
  }
}

// The original's setup runs past the V-blanks the black screen hides, and its song starts after it, on the sound
// engine's next frame: the list's first frame and the song come this many frames after the setup's.
static int result_delay = 2;
static int result_song = 2;

/** 0x0802c1d4: the screen's frame, its list of tasks run and their sprites drawn. */
void resultWait(void) {
  if (result_song > 0 && --result_song == 0) gba_sound_play(3);
  if (result_delay > 0) {
    result_delay--;
    menuStartFrame();
    return;
  }
  menuFrame();
}

/** 0x0802b980: the result screen's setup, its layers, its background and its tasks. The song it starts follows a
 *  frame later, in resultWait, as the setup runs past the V-blanks the black screen hides. */
void resultScreen(void) {
  // the players' order and ranks, as 0x0802b980 sets them before it draws their panels
  int players = 0;
  for (int i = 0; i < 4; i++) {
    write8(ORDER + i, (uint8_t)i);
    write8(0x030052A4 + i, (uint8_t)i);
    if (read8(CHARACTERS + 20 + i) != 255) players++;
  }
  write8(PLAYERS, (uint8_t)players);
  write8(0x030052A0, 2);
  writeRegisters(REGISTERS, REGISTER_COUNT);
  g.queue_count = 0;               // 0x0801fb94
  hideSpriteBuffer();              // 0x0801ff30
  hideSpritesNow();                // the fight's sprites go with the screen it replaces, not a frame later
  menuReset();                     // 0x0801f780
  for (int i = 0; i < 512; i++) gba_pal[i] = 0;
  clearVram(0x06000000, 32);
  uint32_t choice = read32(MENU_CHOICE);
  decompress(choice == 0 || choice == 2 ? 0x081323D4u : SCREEN_TILES, 0x06000020);
  decompress(SCREEN_SPRITES, 0x06010000);
  decompress(read8(LANGUAGE + 119) == 0 ? SCREEN_FONT_ENGLISH : SCREEN_FONT_OTHER, 0x06015020);
  // the players' palettes, in the sprites' palettes the panels use
  for (int i = 0; i < 4; i++) {
    uint32_t from = CHOICE_ROWS + (uint32_t)read8(ORDER + i) * CHOICE_BYTES;
    for (int n = 0; n < 16; n++) write16(0x05000300u + (uint32_t)i * 0x20u + (uint32_t)n * 2, read16(from + (uint32_t)n * 2));
  }
  clearVram(0x0600F800, 0x400);
  clearVram(0x0600E800, 0x400);
  clearVram(0x0600E000, 0x400);
  for (int y = 0; y < 4; y++) {
    uint32_t to = BOX_MAP + (uint32_t)y * 0x200;
    for (int x = 0; x < 4; x++) copyTiles(to + (uint32_t)x * 0x10, BOX_TILES, 8, 8, 1);
  }
  menuAddNode(resultScroll, menuPlace(0, 0, 0, 0, 0), 0);
  menuAddNode(resultPanels, menuPlace(0, 0, 0, 0, 0), 0);
  clearPushes();
  gba_write(DISPCNT, 0x1840);
  gba_write(BG3VOFS, 255);
  g.callback = resultWait;
  write16(0x03001B10 + 2, 0);
  write16(0x03001B10 + 4, 0);
  write16(0x03001B10 + 6, 0);
  // 0x08018444, partly: the link's palette and the state a new screen clears
  write8(LINKED, 1);
  write8(0x03003290, 0);
  for (int i = 0; i < 8; i++) write16(0x03001B10 + (uint32_t)i * 2, 0);
  for (int i = 0; i < 4; i++) for (int n = 0; n < 8; n++) write16(0x030016F0 + (uint32_t)i * 16 + (uint32_t)n * 2, 0);
  write32(0x03001730, 0);
  write8(0x030017C4, 0);
  write8(0x03001380, 0xFF);
  // 0x08018678, partly: the palette the screen shows
  for (int i = 0; i < 8; i++) write16(0x05000060 + (uint32_t)i * 2, read16(0x03003BF0 + (uint32_t)i * 2));
  for (int i = 0; i < 4; i++) write16(0x03005270 + (uint32_t)i * 2, 256);
  write32(0x03005258, 0);
}
