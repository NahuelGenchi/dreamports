// The program: a scrolling background, three sprites each moved by its own function, a backdrop that answers the
// buttons, and a function copied to the fast work memory and called there each frame. Built as it is for the cartridge and for a Dreamport, and each function's comment names where the
// cartridge has it, which is where the test's few lines of a linker put it (../same-memory.mjs).
#include "cart.h"

#ifdef MATCHING
// the backdrop's colours, a step every eight frames: the cartridge's own data, which the Dreamport reads from the
// player's copy, at the address the cartridge has it
const u16 gWave[8] = { 0x4000, 0x4402, 0x4804, 0x4C06, 0x5008, 0x4C06, 0x4804, 0x4402 };
#endif

/** AgbMain, 0x08000100: the program, as the console starts it. It waits for the screen, sets up, and then runs once a
 *  frame for ever. */
void AgbMain(void) {
  WaitFrame();
  CartInit();
  for (;;) {
    CartFrame();
    WaitFrame();
  }
}

/** Flash, 0x08000140: sixteen frames of a backdrop going from black to white, written as a loop that waits for each
 *  frame, as a fade often is. Nothing else of the program runs until it's over. */
static void Flash(void) {
  s32 i;
  for (i = 0; i < 16; i++) {
    COLOURS[0] = i * 0x0842;
    WaitFrame();
  }
}

/** AddObj, 0x08000180: puts a sprite first in the list. */
static struct Obj *AddObj(struct Obj *obj, void (*update)(struct Obj *), s32 x, s32 y, s32 dx, s32 dy, u32 tile) {
  obj->next = gFirst;
  obj->update = update;
  obj->x = x;
  obj->y = y;
  obj->dx = dx;
  obj->dy = dy;
  obj->tile = tile;
  obj->timer = 0;
  gFirst = obj;
  return obj;
}

/** CartInit, 0x08000200: once. The tiles, the colours, the background's map, the three sprites and the display. */
void CartInit(void) {
  s32 i, x, y;

  gFrame = 0;
  gKeys = 0;
  gScroll = 0;
  gFirst = NULL;
  gColours = gWave;
  gPresses = 0;

  // background tiles 1 and 2, 16 colours a tile: stripes one way and the other
  for (i = 0; i < 16; i++) {
    ((u16 *)VRAM)[16 + i] = (i & 2) ? 0x1111 : 0x2222;
    ((u16 *)VRAM)[32 + i] = 0x3312;
  }
  // sprite tiles 1 and 2: a block and a frame
  for (y = 0; y < 8; y++) {
    for (x = 0; x < 2; x++) {
      ((u16 *)(VRAM + 0x10000))[16 + y * 2 + x] = 0x1111;
      ((u16 *)(VRAM + 0x10000))[32 + y * 2 + x] = (y == 0 || y == 7) ? 0x2222 : (x == 0 ? 0x0002 : 0x2000);
    }
  }
  COLOURS[0] = 0x4000;
  COLOURS[1] = 0x7FFF;
  COLOURS[2] = 0x03E0;
  COLOURS[3] = 0x001F;
  COLOURS[256 + 1] = 0x7FE0;
  COLOURS[256 + 2] = 0x7C1F;

  for (y = 0; y < 32; y++)
    for (x = 0; x < 32; x++) ((u16 *)(VRAM + 0xF800))[y * 32 + x] = ((x ^ y) & 1) ? 1 : 2;

  for (i = 0; i < 128; i++) OAM[i * 4] = 0x200;

  AddObj(&gObjs[0], CODE(ObjBounce), 20, 30, 2, 1, 1);
  AddObj(&gObjs[1], CODE(ObjKeys), 116, 76, 0, 0, 2);
  AddObj(&gObjs[2], CODE(ObjBlink), 200, 120, -1, 0, 1);

  gTwice = 0;

  REGISTER(BG0CNT, 31 << 8);
  REGISTER(DISPCNT, 0x1140);
}

/** CartFrame, 0x08000400: every frame. The buttons, the scroll, each sprite's own function, and where the sprites are
 *  drawn. */
void CartFrame(void) {
  struct Obj *obj;
  u16 *oam = OAM;
  u16 keys = KEYS();

  if ((keys & KEY_A) && !(gKeys & KEY_A)) gPresses++;
  gKeys = keys;
  if (!(keys & KEY_SELECT)) gScroll++;
  REGISTER(BG0HOFS, gScroll);
  REGISTER(BG0VOFS, gScroll >> 1);
  COLOURS[0] = (keys & KEY_A) ? 0x001F : gColours[(gFrame >> 3) & 7];

  // Video memory takes 16 bits at a time: a single byte written to it lands in both halves of its halfword, as this
  // one does in a tile of the background, and is lost among the sprites' tiles, as the next one is.
  VRAM_BYTE(0x20 + ((gFrame >> 2) & 31), gFrame >> 4);
  VRAM_BYTE(0x10020 + (gFrame & 31), 0x33);

  for (obj = gFirst; obj != NULL; obj = obj->next) {
    CALL(obj->update)(obj);
    oam[0] = obj->y & 0xFF;
    oam[1] = obj->x & 0x1FF;
    oam[2] = obj->tile;
    oam += 4;
  }
  gTrail[gFrame & 0xFF] = gObjs[0].x;
  RunTwice();
  gFrame++;
}

/** ObjBounce, 0x08000540: bounces off the screen's edges. */
void ObjBounce(struct Obj *obj) {
  obj->x += obj->dx;
  obj->y += obj->dy;
  if (obj->x < 0 || obj->x > 232) {
    obj->dx = -obj->dx;
    obj->x += obj->dx * 2;
  }
  if (obj->y < 0 || obj->y > 152) {
    obj->dy = -obj->dy;
    obj->y += obj->dy * 2;
  }
}

/** ObjKeys, 0x080005A0: goes where the buttons say, and to the middle with Start, after a flash that holds everything
 *  still. */
void ObjKeys(struct Obj *obj) {
  if (gKeys & KEY_RIGHT) obj->x++;
  if (gKeys & KEY_LEFT) obj->x--;
  if (gKeys & KEY_DOWN) obj->y++;
  if (gKeys & KEY_UP) obj->y--;
  if (gKeys & KEY_START) {
    obj->x = 116;
    obj->y = 76;
    Flash();
  }
}

/** ObjBlink, 0x08000620: changes its tile every 16 frames, drifts left, and while B is held takes the next sprite out
 *  of the list, or puts the list's first sprite back after itself. */
void ObjBlink(struct Obj *obj) {
  obj->timer++;
  if ((obj->timer & 15) == 0) obj->tile ^= 3;
  obj->x += obj->dx;
  if (obj->x < -8) obj->x = 240;
  if (gKeys & KEY_B) obj->next = NULL;
  else if (obj->next == NULL && obj != &gObjs[0]) obj->next = &gObjs[1];
}

/** Twice, 0x08000800: twice what it's given. The program runs it from its copy in the fast work memory. */
s32 Twice(s32 x) { return x * 2; }

/** RunTwice, 0x08000840: Twice's two instructions copied to the fast work memory, as a game copies code it can't run
 *  from the cartridge, and the copy run there with the frame. */
void RunTwice(void) {
  s32 (*twice)(s32);

  gCode[0] = ((const u16 *)((u32)CODE(Twice) & ~1))[0];
  gCode[1] = ((const u16 *)((u32)CODE(Twice) & ~1))[1];
  twice = (s32(*)(s32))((u32)gCode + 1);
  gTwice = CALL(twice)(gFrame);
}
