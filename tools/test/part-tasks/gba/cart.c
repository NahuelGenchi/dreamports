// The program: a title whose backdrop pulses until Start, a flash, and then a block the arrows move. Built as it is for
// the cartridge and for a Dreamport, and each function's comment names where the cartridge has it, which is where the
// test's few lines of a linker put it (../../same-memory/cartridge.mjs). ../gba.mjs says which of them the program runs
// in each part of its recording, which is what the test holds the tools to.
#include "cart.h"

#ifdef MATCHING
// the title's backdrop, a step every eight frames: the cartridge's own data, which the Dreamport reads from the
// player's copy, at the address the cartridge has it
const u16 gWave[8] = { 0x4000, 0x4402, 0x4804, 0x4C06, 0x5008, 0x4C06, 0x4804, 0x4402 };
#endif

/** AgbMain, 0x08000100: the program, as the console starts it. It waits for the screen, sets up, and then runs once a
 *  frame for ever. */
void AgbMain(void) {
  WaitFrame();
  Init();
  for (;;) {
    Frame();
    WaitFrame();
  }
}

/** WaitFrame, 0x08000140: waits for the screen to finish its frame, from wherever the program calls it. */
void WaitFrame(void) {
  WAIT_FOR_SCREEN();
}

/** Init, 0x08000180: once. What the program keeps, the block's tile, the colours, the sprites and the display. */
void Init(void) {
  s32 i;

  gFrame = 0;
  gKeys = 0;
  gMode = 0;
  gX = 116;
  gY = 76;
  gAfter = 0;
  gSecrets = 0;
  // sprite tile 1, 16 colours a tile: a block
  for (i = 0; i < 16; i++) ((u16 *)(VRAM + 0x10000))[16 + i] = 0x1111;
  COLOURS[0] = gWave[0];
  COLOURS[256 + 1] = 0x7FE0;
  for (i = 0; i < 128; i++) OAM[i * 4] = 0x200;
  REGISTER(DISPCNT, 0x1040);
}

/** Frame, 0x08000240: every frame. The buttons, the title or the play, and the block where it is. */
void Frame(void) {
  u16 keys = KEYS();

  gKeys = keys;
  if (gMode == 0) Title();
  else Play();
  if ((keys & (KEY_L | KEY_R)) == (KEY_L | KEY_R)) Secret();
  Draw();
  gFrame++;
}

/** Title, 0x080002C0: the backdrop pulses. Start flashes the screen and begins the play, and keeps for later the
 *  function a bonus would run, which this program never gets to. */
void Title(void) {
  COLOURS[0] = gWave[(gFrame >> 3) & 7];
  if (gKeys & KEY_START) {
    Flash();
    gMode = 1;
    gAfter = (u32)CODE(Bonus);
  }
}

/** Flash, 0x08000340: sixteen frames of a backdrop going from black to white, written as a loop that waits for each
 *  frame, as a fade often is. Nothing else of the program runs until it's over. */
void Flash(void) {
  s32 i;

  for (i = 0; i < 16; i++) {
    COLOURS[0] = i * 0x0842;
    WaitFrame();
  }
}

/** Play, 0x08000380: a plain backdrop, and the block goes where the arrows say. */
void Play(void) {
  COLOURS[0] = 0x4000;
  Move();
}

/** Move, 0x080003C0: the arrows, a pixel a frame. */
void Move(void) {
  if (gKeys & KEY_RIGHT) gX++;
  if (gKeys & KEY_LEFT) gX--;
  if (gKeys & KEY_DOWN) gY++;
  if (gKeys & KEY_UP) gY--;
}

/** Draw, 0x08000440: the block, as the first sprite. */
void Draw(void) {
  OAM[0] = gY & 0xFF;
  OAM[1] = gX & 0x1FF;
  OAM[2] = 1;
}

/** Secret, 0x08000480: L and R together count a secret and turn the backdrop white. */
void Secret(void) {
  gSecrets++;
  COLOURS[0] = 0x7FFF;
}

/** Bonus, 0x080004C0: back to the title after a flash. Title keeps its address, and nothing calls it. */
void Bonus(void) {
  Flash();
  gMode = 0;
}
