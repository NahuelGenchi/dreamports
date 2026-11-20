// The sound program of tools/test/made-up-ps2-iop.mjs as a Dreamport in C, on the PlayStation 2's kit in C (kit/ps2/c/).
// Its EE's code, written again: the program goes into the EE's memory as the console's loader puts it, it makes the
// same SIF calls, sending what the program itself holds, waits for the IOP's replies, and draws the flat program's
// square standing still, with a GS LABEL write for each thing the SIF gave it. And its IOP module, written again as a
// twin that the kit's stand-in for the IOP's loader starts: it reads its tone and its click from the module the EE sent,
// writes each SPU2 register as the module does, in its order, sends the click to core 1 by DMA, sets the pad up through
// the SIO2, and has a thread that runs at each V-blank and reads the pad. The test fills in the numbers, which are the program's own (ps2-sound.mjs).

#include "ps2.h"

#define FBW (SCREEN_W / 64)
#define ONE 0x3F800000ull
#define XYZ(x, y, z) ((uint64_t)(uint32_t)((x) << 4 | (y) << 20) | (uint64_t)(z) << 32)

// the sound chip, as the IOP's code writes it
#define SPU2 0xBF900000u
#define CORE1 @CORE1@
#define W(register, value) iop_write16(SPU2 + (register), (uint16_t)(value))
#define READ(register) iop_read16(SPU2 + (register))

static const uint16_t reverb[][2] = @REVERB@;
static const uint16_t voices[][2] = @VOICES@;

// ---------------------------------------------------------------------------------------------------------------------
// The IOP module

// where the module's file is in the IOP's memory, as the EE sent it there, and its tone and click in it
#define MODULE (@IRX_IN_IOP@ + @IRX_BODY@)
#define TONE_SIZE @TONE_SIZE@
#define CLICK_SIZE @CLICK_SIZE@

// the frames since the module's thread first woke
static uint32_t frame;

// a command to the pad through the SIO2, as the module sends it: how long it is each way, the first of the commands,
// then each byte out and each byte back
static uint8_t pad_answer[32];
static void sio2(const uint8_t *command, uint32_t sent, uint32_t answered) {
  iop_write32(0xBF808200, sent << 8 | answered << 18);
  iop_write32(0xBF808268, 0x0C);
  for (uint32_t i = 0; i < sent; i++) iop_write32(0xBF808260, command[i]);
  for (uint32_t i = 0; i < answered; i++) pad_answer[i] = (uint8_t)iop_read32(0xBF808264);
}

static void module_frame(void) {
  // the pad read, and what it says written back two bytes at a time where the sound chip takes no notice
  static const uint8_t pad_read[] = @PAD_READ@;
  sio2(pad_read, sizeof pad_read, @PAD_ASKED@);
  for (int i = 0; i < (@PAD_ANSWER@ - 1) / 2; i++) W(@NOTE@, pad_answer[1 + i * 2] | pad_answer[2 + i * 2] << 8);
  if (frame == 0) {
    W(@ATTR@, @ATTR_PLAYING@);
    W(@VOICE0_VOLR@, @SWEEP_UP@);
    W(@KON_HI@, 7);
    W(CORE1 + @KON_HI@, 1);
  } else {
    W(@VOICE0_PITCH@, @PITCH_START@ + (frame * @PITCH_STEP@) % (@PITCH_END@ - @PITCH_START@));
    uint32_t tone_frame = frame % @TONE_EVERY@;
    if (tone_frame == @TONE_OFF@) W(@KOFF_HI@, 1);
    if (tone_frame == 0) W(@KON_HI@, 1);
    if (frame % @CLICK_EVERY@ == 0) W(CORE1 + @KON_HI@, 1);
    if (frame == @SWEEP_AT@) W(@VOICE1_VOLL@, @SWEEP_DOWN@);
    if (frame == @MASTER_SWEEP_AT@) W(@MVOLR@, @MASTER_SWEEP@);
    if (frame == @MASTER_BACK_AT@) W(@MVOLR@, @MASTER_RIGHT@);
    // what the chip says, written back where it takes no notice
    W(@NOTE@, READ(@ENDX_HI@));
    W(CORE1 + @NOTE@, READ(CORE1 + @ENDX_HI@));
    W(@NOTE@, READ(@IRQINFO@));
  }
  frame++;
}

// its server's function, as the module's: the first word three times over and the call's number added, written over it
static uint32_t answer(uint32_t number, uint32_t buffer, uint32_t size) {
  uint8_t *data = iop_memory() + buffer;
  uint32_t value;
  __builtin_memcpy(&value, data, 4);
  value = value * 3 + number;
  __builtin_memcpy(data, &value, 4);
  return buffer;
}

static int module_start(int argc, char **argv) {
  const uint8_t *tone = iop_memory() + MODULE + @TONE_IN_MODULE@;
  // core 0 on, and the tone into its memory through the data port
  W(@ATTR@, @ATTR_SET_UP@ | 0x10);
  W(@TSA_HI@, @TONE_AT@ >> 17);
  W(@TSA_LO@, @TONE_AT@ >> 1 & 0xFFFF);
  for (int copy = 0; copy < 2; copy++) for (uint32_t i = 0; i < TONE_SIZE; i += 2) W(@STD@, tone[i] | tone[i + 1] << 8);
  W(@ATTR@, @ATTR_SET_UP@);
  for (uint32_t i = 0; i < sizeof reverb / sizeof reverb[0]; i++) W(reverb[i][0], reverb[i][1]);
  W(@IRQA_HI@, @IRQ_AT@ >> 17);
  W(@IRQA_LO@, @IRQ_AT@ >> 1 & 0xFFFF);
  // core 1 on, taking the click by DMA on channel 7, from the module itself
  W(CORE1 + @ATTR@, 0x8000 | 0x20);
  W(CORE1 + @TSA_HI@, @CLICK_AT@ >> 17);
  W(CORE1 + @TSA_LO@, @CLICK_AT@ >> 1 & 0xFFFF);
  iop_write32(0xBF801500, MODULE + @CLICK_IN_MODULE@);
  iop_write32(0xBF801504, 16 | (CLICK_SIZE / 64) << 16);
  iop_write32(0xBF801508, 0x01000201);
  W(CORE1 + @ATTR@, 0x8000);
  for (uint32_t i = 0; i < sizeof voices / sizeof voices[0]; i++) W(voices[i][0], voices[i][1]);
  // the pad set to give the pressure on its buttons
@PAD_SET_UP@
  // its thread, which waits for each V-blank, and its server's
  iop_each_vblank(module_frame);
  sif_register_rpc(@SERVER@, answer, MODULE + @RPC_BUFFER_IN_MODULE@);
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
  iop_module_twin("dp_sound", module_start);

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
  // the module's own server, bound once
  set_word(@SERVER_BIND_TRANSFERS@ + 4, commands);
  sif_set_dma(transfers(@SERVER_BIND_TRANSFERS@), 1);
  wait_for_reply(SERVER_BIND_REPLY_0);
}

// the frames the EE has called the module's server in
static uint32_t calls;

void game_step(uint32_t buttons) {
  // the module's server called with the frame's number, its answer kept
  set_word(@SERVER_ARGUMENTS@, calls++);
  set_word(@SERVER_CALL_TRANSFERS@ + 16 + 4, sif_get_reg(2));
  sif_set_dma(transfers(@SERVER_CALL_TRANSFERS@), 2);
  wait_for_reply(-1);
  labels[ANSWER] = word(@ANSWERED@);

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
