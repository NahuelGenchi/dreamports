// A Dreamport in C, on the NES kit in C (kit/nes/c/), of the small NES program made-up-nes.mjs writes, which
// real-console.mjs proves on the real emulator, every frame, picture and sound. It does what the program does, a frame at
// a time, writing the PPU and the APU as the program's code does, with its tiles and colours read from the player's copy.
// @PLAYS_FROM@ and the rest are filled in from made-up-nes.mjs.

#include "nes.h"

enum { SCROLL = @SCROLL@, X = @X@, Y = @Y@, BACKDROP = @BACKDROP@ };
#define START_X @START_X@
#define START_Y @START_Y@
#define START_BACKDROP @START_BACKDROP@
#define PRESSED_BACKDROP @PRESSED_BACKDROP@
#define SPRITE @SPRITE@
#define TIMER @TIMER@
#define PALETTE_AT @PALETTE_AT@
// the program's first frame of play, after its power-on
#define PLAYS_FROM 5

static int moved = @MOVED@;

static void set_address(uint16_t address) {
  nes_write(0x2006, (uint8_t)(address >> 8));
  nes_write(0x2006, (uint8_t)address);
}

// what its power-on does once V-blank has come twice: the colours, the background, its work memory and the sound
static void set_up(void) {
  set_address(0x3F00);
  for (int i = 0; i < 32; i++) nes_write(0x2007, nes_prg_byte((uint16_t)(0xC000 + PALETTE_AT - 16 + i)));
  set_address(0x2000);
  for (int row = 0; row < 30; row++)
    for (int column = 0; column < 32; column++) nes_write(0x2007, (uint8_t)((column + row) & 3));
  for (int i = 0; i < 64; i++) nes_write(0x2007, 0xE4);
  nes_ram[X] = START_X;
  nes_ram[Y] = START_Y;
  nes_ram[BACKDROP] = START_BACKDROP;
  nes_ram[0x200] = START_Y;
  nes_ram[0x201] = SPRITE;
  nes_ram[0x202] = 0;
  nes_ram[0x203] = START_X;
  nes_write(0x4015, 0x05);
  nes_write(0x4000, 0xB0);
  nes_write(0x4001, 0x08);
  nes_write(0x4002, TIMER);
  nes_write(0x4003, 0);
  nes_write(0x4008, 0x80);
  nes_write(0x400A, TIMER);
  nes_write(0x400B, 0);
}

static void show(void) {
  nes_write(0x2005, 0);
  nes_write(0x2005, 0);
  nes_write(0x2000, 0x80);
  nes_write(0x2001, 0x1E);
}

void game_start(void) {
  int32_t later = kit_start_number("scroll", -1);
  nes_write(0x4017, 0x40);
  nes_write(0x2000, 0);
  nes_write(0x2001, 0);
  nes_write(0x4010, 0);
  if (later >= 0) {
    // a start point: the program as it is once it plays, with its scroll there
    nes_start_at(PLAYS_FROM);
    for (int i = 0; i < 256; i++) nes_ram[0x200 + i] = 0xFF;
    set_up();
    show();
    nes_ram[SCROLL] = (uint8_t)later;
  }
}

void game_step(uint32_t buttons) {
  uint32_t frame = nes_frame();
  if (frame == 1) {
    for (int i = 0; i < 256; i++) {
      nes_ram[i] = 0;
      nes_ram[0x200 + i] = 0xFF;
    }
  } else if (frame == 2) set_up();
  else if (frame == 3) show();
  if (frame < 4) return;
  if (frame >= PLAYS_FROM) {
    // what its V-blank works out with the buttons it reads: the sprite, the backdrop, the scroll and the sound
    nes_ram[0x11] = (uint8_t)buttons;
    if (buttons & BUTTON_RIGHT) nes_ram[X] = (uint8_t)(nes_ram[X] + moved);
    if (buttons & BUTTON_LEFT) nes_ram[X]--;
    if (buttons & BUTTON_DOWN) nes_ram[Y]++;
    if (buttons & BUTTON_UP) nes_ram[Y]--;
    nes_ram[0x200] = nes_ram[Y];
    nes_ram[0x203] = nes_ram[X];
    nes_ram[BACKDROP] = (buttons & BUTTON_START) ? PRESSED_BACKDROP : START_BACKDROP;
    if (!(buttons & BUTTON_SELECT)) nes_ram[SCROLL]++;
    nes_write(0x4000, (buttons & BUTTON_A) ? 0xBF : 0xB0);
    nes_write(0x4008, (buttons & BUTTON_B) ? 0xFF : 0x80);
  }
  // and what its next V-blank shows of it
  nes_write(0x4014, 2);
  set_address(0x3F00);
  nes_write(0x2007, nes_ram[BACKDROP]);
  nes_write(0x2000, 0x80);
  nes_write(0x2005, nes_ram[SCROLL]);
  nes_write(0x2005, 0);
}
