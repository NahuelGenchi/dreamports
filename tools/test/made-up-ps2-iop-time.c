// The timed program of tools/test/made-up-ps2-iop.mjs as a Dreamport in C, on the PlayStation 2's kit in C
// (kit/ps2/c/). Its EE's code, written again: the program goes into the EE's memory as the console's loader puts it, it
// makes the same SIF calls to load its module, sending what the program itself holds, waits for the IOP's replies, and
// draws the flat program's square standing still, with a GS LABEL write for each thing the SIF gave it. And its IOP
// module, written again as a twin that the kit's stand-in for the IOP's loader starts, whose thread runs at each
// V-blank, writes the sound chip as the module does, and says how many of the IOP's ticks the module's code took
// between its writes (iop_time_pass), so each write comes in the slice, the block of samples and the frame where the
// module's does. The test fills in the numbers, which are the program's own (ps2-iop-time.mjs).

#include "ps2.h"

#define FBW (SCREEN_W / 64)
#define ONE 0x3F800000ull
#define XYZ(x, y, z) ((uint64_t)(uint32_t)((x) << 4 | (y) << 20) | (uint64_t)(z) << 32)

// the sound chip, as the IOP's code writes it
#define SPU2 0xBF900000u
#define W(register, value) iop_write16(SPU2 + (register), (uint16_t)(value))

// ---------------------------------------------------------------------------------------------------------------------
// The IOP module

#define SHORT_WAIT @SHORT_WAIT@
#define LONG_WAIT @LONG_WAIT@
#define TIMED_EVERY @TIMED_EVERY@
#define TIMED_AT @TIMED_AT@

// the frames since the module's thread first woke
static uint32_t frame;

// Its thread, after each V-blank. The module's code is counted as the emulator counts it, a tick an instruction: the
// short wait's loop, three instructions a time round, after the write and the loop's count set; then the write, the
// frame's place among every TIMED_EVERY found by taking TIMED_EVERY away while it's at least that, six instructions a
// time and three more, and whether it's TIMED_AT, three; and on that frame the long wait's count set, two, and its loop.
static void module_frame(void) {
  W(@NOTE@, frame | @MARK_0@);
  iop_time_pass(2 + 3 * SHORT_WAIT);
  W(@NOTE@, frame | @MARK_1@);
  if (frame % TIMED_EVERY == TIMED_AT) {
    iop_time_pass(2 + 1 + 6 * (frame / TIMED_EVERY) + 3 + 3 + 2 + 3 * @LONG_WAIT_TAKEN@);
    W(@NOTE@, frame | @MARK_2@);
  }
  frame++;
}

static int module_start(int argc, char **argv) {
  iop_each_vblank(module_frame);
  return 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// The EE

// what the SIF gave the program, in the order its LABEL writes carry them
enum { @LABEL_ENUM@, LABELS };
static uint32_t labels[LABELS];

static uint32_t word(uint32_t address) {
  uint32_t value;
  __builtin_memcpy(&value, ee_memory() + address, 4);
  return value;
}
static void set_word(uint32_t address, uint32_t value) { __builtin_memcpy(ee_memory() + address, &value, 4); }
static const sif_transfer *transfers(uint32_t address) { return (const sif_transfer *)(ee_memory() + address); }

// waiting for the IOP's reply, as the EE's time passes, keeping its words, then saying it was taken
static void wait_for_reply(int first) {
  while (word(@REPLY@ + 8) != @SIF_REND@) ps2_time_to_slice();
  if (first >= 0) for (int i = 0; i < 12; i++) labels[first + i] = word(@REPLY@ + i * 4);
  set_word(@REPLY@ + 8, 0);
  sif_set_dchain(1);
}

void game_start(void) {
  // the program, where the console's loader puts it
  uint32_t at, size;
  __builtin_memcpy(&at, kit_copy + 56, 4);
  __builtin_memcpy(&size, kit_copy + 68, 4);
  __builtin_memcpy(ee_memory() + @LOAD_AT@, kit_copy + at, size);
  iop_module_twin("dp_timed", module_start);
  // the module's thread says how much of the IOP's time its code takes
@KEEP_TIME@

  gs_screen(GS_PMODE, 0xFF25);
  gs_screen(GS_PMODE + 4, 0);
  gs_screen(GS_SMODE2, 1);
  gs_screen(GS_SMODE2 + 4, 0);
  gs_screen(GS_DISPFB1, FBW << 9);
  gs_screen(GS_DISPFB1 + 4, 0);
  gs_screen(GS_DISPLAY1, 656 | 36 << 12 | 3 << 23);
  gs_screen(GS_DISPLAY1 + 4, (SCREEN_W * 4 - 1) | (SCREEN_H - 1) << 12);

  static const uint32_t registers[] = { 1, 3, 4, 0x80000000, 0x80000002 };
  for (int i = 0; i < 5; i++) labels[REGISTER_1 + i] = sif_get_reg(registers[i]);
  uint32_t commands = labels[REGISTER_2] = sif_get_reg(2);
  set_word(@INIT_TRANSFERS@ + 4, commands);
  labels[INIT_ID] = sif_set_dma(transfers(@INIT_TRANSFERS@), 1);
  uint32_t id = labels[IRX_ID] = sif_set_dma(transfers(@IRX_TRANSFERS@), 1);
  labels[IRX_STATUS] = sif_dma_stat(id);
  set_word(@BIND_TRANSFERS@ + 4, commands);
  labels[BIND_ID] = sif_set_dma(transfers(@BIND_TRANSFERS@), 1);
  wait_for_reply(BIND_REPLY_0);
  set_word(@CALL_TRANSFERS@ + 16 + 4, commands);
  id = labels[CALL_ID] = sif_set_dma(transfers(@CALL_TRANSFERS@), 2);
  wait_for_reply(CALL_REPLY_0);
  labels[CALL_STATUS] = sif_dma_stat(id);
  labels[RECEIVED_0] = word(@RECEIVED@);
  labels[RECEIVED_1] = word(@RECEIVED@ + 4);
}

void game_step(uint32_t buttons) {
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
  for (int i = 0; i < LABELS; i++) gs_write(GS_LABEL, labels[i]);
}

void game_draw(void) { gs_show(); }

void game_sound(float *left, float *right, int count) {}
