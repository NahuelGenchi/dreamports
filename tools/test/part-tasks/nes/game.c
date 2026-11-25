// A Dreamport in C, on the NES kit in C (kit/nes/c/), of the small NES program ../../made-up-nes.mjs writes for the
// test of a game whose parts are its tasks (madeUpParts): its power-on, and a V-blank that shows the last frame, reads
// the buttons and calls four small functions. Each of those has its twin here, with its contract beside it, which the
// function check proves. What the kit calls, game_start and game_step, do the rest of what the program does, a frame
// at a time. @MOVE@ and the rest are filled in from the program as it was put together (../nes.mjs).

#include "nes.h"

#define RAM nes_ram
enum { SCROLL = @SCROLL@, BUTTONS = @BUTTONS@, X_AT = @X@, Y_AT = @Y@, BACKDROP = @BACKDROP@, MODE = @MODE@, SECRETS = @SECRETS@ };
#define START_X @START_X@
#define START_Y @START_Y@
#define START_BACKDROP @START_BACKDROP@
#define PRESSED_BACKDROP @PRESSED_BACKDROP@
#define SPRITE @SPRITE@
#define TIMER @TIMER@
#define PALETTE_AT @PALETTE_AT@
// the program's first frame of play, after its power-on
#define PLAYS_FROM 5

/** @MOVE@: the arrows move the sprite, a pixel a frame, and where it is goes to the sprites' page. */
// dp:twin @MOVE@ move()
void move(void) {
  uint8_t held = RAM[BUTTONS];
  if (held & 0x01) RAM[X_AT]++;
  if (held & 0x02) RAM[X_AT]--;
  if (held & 0x04) RAM[Y_AT]++;
  if (held & 0x08) RAM[Y_AT]--;
  RAM[0x200] = RAM[Y_AT];
  RAM[0x203] = RAM[X_AT];
}

/** @TITLE@: Start begins the play, and turns the backdrop red for good. */
// dp:twin @TITLE@ title()
void title(void) {
  if (RAM[BUTTONS] & 0x10) {
    RAM[MODE] = 1;
    RAM[BACKDROP] = PRESSED_BACKDROP;
  }
}

/** @PLAY@: the background scrolls. */
// dp:twin @PLAY@ play()
void play(void) {
  RAM[SCROLL]++;
}

/** @SECRET@: counts a secret. */
// dp:twin @SECRET@ secret()
void secret(void) {
  RAM[SECRETS]++;
}

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
  RAM[X_AT] = START_X;
  RAM[Y_AT] = START_Y;
  RAM[BACKDROP] = START_BACKDROP;
  RAM[0x200] = START_Y;
  RAM[0x201] = SPRITE;
  RAM[0x202] = 0;
  RAM[0x203] = START_X;
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
  nes_write(0x4017, 0x40);
  nes_write(0x2000, 0);
  nes_write(0x2001, 0);
  nes_write(0x4010, 0);
}

void game_step(uint32_t buttons) {
  uint32_t frame = nes_frame();
  if (frame == 1) {
    for (int i = 0; i < 256; i++) {
      RAM[i] = 0;
      RAM[0x200 + i] = 0xFF;
    }
  } else if (frame == 2) set_up();
  else if (frame == 3) show();
  if (frame < 4) return;
  if (frame >= PLAYS_FROM) {
    // what its V-blank works out with the buttons it reads, by the functions it calls. It reads them as the controller
    // sends them, A first, each shifted in from the right, so A ends in the highest bit and Right in the lowest
    uint8_t read = 0;
    for (int i = 0; i < 8; i++) read = (uint8_t)(read << 1 | (buttons >> i & 1));
    RAM[BUTTONS] = read;
    move();
    if (RAM[MODE] == 0) title();
    else play();
    if ((RAM[BUTTONS] & 0xC0) == 0xC0) secret();
  }
  // and what its next V-blank shows of it
  nes_write(0x4014, 2);
  set_address(0x3F00);
  nes_write(0x2007, RAM[BACKDROP]);
  nes_write(0x2000, 0x80);
  nes_write(0x2005, RAM[SCROLL]);
  nes_write(0x2005, 0);
}
