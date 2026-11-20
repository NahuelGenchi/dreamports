// A program of tools/test/made-up-ps2-rpc.mjs as a Dreamport in C, on the PlayStation 2's kit in C (kit/ps2/c/): the
// program goes into the EE's memory as the console's loader puts it, from the disc or from the copy itself, and its
// code is written again here: the same SIF calls, sending what the program itself holds, each of the IOP's replies
// waited for, and each frame the flat program's square standing still with a GS LABEL write for each thing it keeps.
// The test fills in the tables, which are the program's own (ps2-disc.mjs, ps2-cards.mjs).

#include "ps2.h"

#define FBW (SCREEN_W / 64)
#define ONE 0x3F800000ull
#define XYZ(x, y, z) ((uint64_t)(uint32_t)((x) << 4 | (y) << 20) | (uint64_t)(z) << 32)

static const uint32_t binds[] = @BINDS@;
// a call: whether it's made every frame, where its transfers are, the argument that follows the frame, and what's kept
static const struct { int each; uint32_t transfers, follows, base, mask; int kept; uint32_t keep[8][2]; } calls[] = @CALLS@;
static uint32_t labels[@LABELS@];

static uint32_t word(uint32_t address) {
  uint32_t value;
  __builtin_memcpy(&value, ee_memory() + address, 4);
  return value;
}
static void set_word(uint32_t address, uint32_t value) { __builtin_memcpy(ee_memory() + address, &value, 4); }
static const sif_transfer *transfers(uint32_t address) { return (const sif_transfer *)(ee_memory() + address); }

// SifSetDma, the last transfer to the IOP's command buffer, then the IOP's reply waited for as the EE's time passes
static void send(uint32_t at, uint32_t count, uint32_t commands) {
  set_word(at + (count - 1) * 16 + 4, commands);
  sif_set_dma(transfers(at), count);
}
// The EE's time to the end of the emulator's slice, a wait that reaches the V-blank going on in the next frame, as the
// program's own does
static void slice(void) {
  uint64_t before = ps2_ee_time();
  ps2_time_to_slice();
  if (ps2_ee_time() == before) kit_wait_frame();
}
// The IOP's reply waited for, as the emulator runs the program's wait: what the IOP answers at once is there as the
// system call that sent it ends, and a reply that comes later comes at a slice's end by an interrupt, after which the
// emulator's EE, which it takes to be idle in the program's loop, sits the next slice out
static void wait_for_reply(void) {
  int slices = 0;
  ps2_time_pass(1);
  for (; word(@REPLY@ + 8) != 0x80000008; slices++) slice();
  if (slices) slice();
  set_word(@REPLY@ + 8, 0);
  sif_set_dchain(1);
}
static void make(unsigned n, uint32_t frame, uint32_t commands) {
  if (calls[n].follows) set_word(calls[n].follows, calls[n].base + (frame & calls[n].mask));
  send(calls[n].transfers, 2, commands);
  wait_for_reply();
  for (int k = 0; k < calls[n].kept; k++) labels[calls[n].keep[k][1]] = word(calls[n].keep[k][0]);
}

static void program(void) {
  // the program, where the console's loader puts it: from the disc's sectors, or the copy when that's the program
  static uint8_t file[@ELF_SECTORS@ * 2048];
  if (@ELF_SECTORS@ > 1) ps2_disc_sectors(@ELF_AT@, @ELF_SECTORS@, file);
  else __builtin_memcpy(file, kit_copy, kit_copy_size < sizeof file ? kit_copy_size : sizeof file);
  uint32_t at, size;
  __builtin_memcpy(&at, file + 56, 4);
  __builtin_memcpy(&size, file + 68, 4);
  __builtin_memcpy(ee_memory() + @LOAD_AT@, file + at, size);

  gs_screen(GS_PMODE, 0xFF25);
  gs_screen(GS_PMODE + 4, 0);
  gs_screen(GS_SMODE2, 1);
  gs_screen(GS_SMODE2 + 4, 0);
  gs_screen(GS_DISPFB1, FBW << 9);
  gs_screen(GS_DISPFB1 + 4, 0);
  gs_screen(GS_DISPLAY1, 656 | 36 << 12 | 3 << 23);
  gs_screen(GS_DISPLAY1 + 4, (SCREEN_W * 4 - 1) | (SCREEN_H - 1) << 12);

  uint32_t commands = sif_get_reg(2);
  send(@INIT_TRANSFERS@, 1, commands);
  for (unsigned n = 0; n < sizeof binds / sizeof binds[0]; n++) {
    send(binds[n], 1, commands);
    wait_for_reply();
  }
  for (unsigned n = 0; n < sizeof calls / sizeof calls[0]; n++) if (!calls[n].each) make(n, 0, commands);
  for (uint32_t frame = 0;; frame++) {
    kit_wait_frame();
    for (unsigned n = 0; n < sizeof calls / sizeof calls[0]; n++) if (calls[n].each) make(n, frame, commands);
    gs_write(GS_FRAME_1, (uint64_t)FBW << 16);
    gs_write(GS_SCISSOR_1, (uint64_t)(SCREEN_W - 1) << 16 | (uint64_t)(SCREEN_H - 1) << 48);
    gs_write(GS_XYOFFSET_1, 0);
    gs_write(GS_TEST_1, 0x30000);
    gs_write(GS_ZBUF_1, 1ull << 32);
    gs_write(GS_PRMODECONT, 1);
    gs_write(GS_PRIM, 6);
    gs_write(GS_RGBAQ, @BACKGROUND@ | ONE << 32);
    gs_write(GS_XYZ2, XYZ(0, 0, 0));
    gs_write(GS_XYZ2, XYZ(SCREEN_W, SCREEN_H, 0));
    gs_write(GS_RGBAQ, @SQUARE@ | ONE << 32);
    gs_write(GS_XYZ2, XYZ(0, @SQUARE_Y@, 0));
    gs_write(GS_XYZ2, XYZ(@SQUARE_SIZE@, @SQUARE_Y@ + @SQUARE_SIZE@, 0));
    for (unsigned i = 0; i < @LABELS@; i++) gs_write(GS_LABEL, labels[i]);
  }
}

// the game waits for the screen, and for its disc, from inside its own code, so it runs under kit_run
void game_start(void) { kit_run(program); }
void game_step(uint32_t buttons) { kit_run(program); }

void game_draw(void) { gs_show(); }

void game_sound(float *left, float *right, int count) {}
