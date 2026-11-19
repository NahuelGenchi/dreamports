// The sound program of tools/test/made-up-ps2-iop.mjs as a Dreamport in C, on the PlayStation 2's kit in C (kit/ps2/c/):
// its EE's picture, the flat program's square standing still, and its IOP module written again with the kit's IOP,
// each SPU2 register written as the module writes it, in its order, so its sound list is the module's. The click goes
// to core 1 by DMA from the IOP's memory, as the module sends it from its own. The test fills in the numbers, which are
// the program's own (ps2-sound.mjs).

#include "ps2.h"

#define FBW (SCREEN_W / 64)
#define ONE 0x3F800000ull
#define XYZ(x, y, z) ((uint64_t)(uint32_t)((x) << 4 | (y) << 20) | (uint64_t)(z) << 32)

// the sound chip, as the IOP's code writes it
#define SPU2 0xBF900000u
#define CORE1 @CORE1@
#define W(register, value) iop_write16(SPU2 + (register), (uint16_t)(value))
#define READ(register) iop_read16(SPU2 + (register))

static const uint8_t tone[] = @TONE@;
static const uint8_t click[] = @CLICK@;
static const uint16_t reverb[][2] = @REVERB@;
static const uint16_t voices[][2] = @VOICES@;
// where the click waits in the IOP's memory for its DMA
#define CLICK_IN_IOP 0x100000

// the frames since the module's thread first woke
static uint32_t frame;

void game_start(void) {
  gs_screen(GS_PMODE, 0xFF25);
  gs_screen(GS_PMODE + 4, 0);
  gs_screen(GS_SMODE2, 1);
  gs_screen(GS_SMODE2 + 4, 0);
  gs_screen(GS_DISPFB1, FBW << 9);
  gs_screen(GS_DISPFB1 + 4, 0);
  gs_screen(GS_DISPLAY1, 656 | 36 << 12 | 3 << 23);
  gs_screen(GS_DISPLAY1 + 4, (SCREEN_W * 4 - 1) | (SCREEN_H - 1) << 12);

  // the module's start: core 0 on, and the tone into its memory through the data port
  W(@ATTR@, @ATTR_SET_UP@ | 0x10);
  W(@TSA_HI@, @TONE_AT@ >> 17);
  W(@TSA_LO@, @TONE_AT@ >> 1 & 0xFFFF);
  for (uint32_t i = 0; i < sizeof tone; i += 2) W(@STD@, tone[i] | tone[i + 1] << 8);
  W(@ATTR@, @ATTR_SET_UP@);
  for (uint32_t i = 0; i < sizeof reverb / sizeof reverb[0]; i++) W(reverb[i][0], reverb[i][1]);
  W(@IRQA_HI@, @IRQ_AT@ >> 17);
  W(@IRQA_LO@, @IRQ_AT@ >> 1 & 0xFFFF);
  // core 1 on, taking the click by DMA on channel 7
  W(CORE1 + @ATTR@, 0x8000 | 0x20);
  W(CORE1 + @TSA_HI@, @CLICK_AT@ >> 17);
  W(CORE1 + @TSA_LO@, @CLICK_AT@ >> 1 & 0xFFFF);
  __builtin_memcpy(iop_memory() + CLICK_IN_IOP, click, sizeof click);
  iop_write32(0xBF801500, CLICK_IN_IOP);
  iop_write32(0xBF801504, 16 | (sizeof click / 64) << 16);
  iop_write32(0xBF801508, 0x01000201);
  W(CORE1 + @ATTR@, 0x8000);
  for (uint32_t i = 0; i < sizeof voices / sizeof voices[0]; i++) W(voices[i][0], voices[i][1]);
}

// what the module's thread does each V-blank
static void module_frame(void) {
  if (frame == 0) {
    W(@ATTR@, @ATTR_PLAYING@);
    W(@VOICE0_VOLR@, @SWEEP_UP@);
    W(@KON_HI@, 3);
    W(CORE1 + @KON_HI@, 1);
  } else {
    W(@VOICE0_PITCH@, @PITCH_START@ + (frame * @PITCH_STEP@) % (@PITCH_END@ - @PITCH_START@));
    uint32_t tone_frame = frame % @TONE_EVERY@;
    if (tone_frame == @TONE_OFF@) W(@KOFF_HI@, 1);
    if (tone_frame == 0) W(@KON_HI@, 1);
    if (frame % @CLICK_EVERY@ == 0) W(CORE1 + @KON_HI@, 1);
    if (frame == @SWEEP_AT@) W(@VOICE1_VOLL@, @SWEEP_DOWN@);
    // what the chip says, written back where it takes no notice
    W(@MMIX@, READ(@ENDX_HI@));
    W(CORE1 + @MMIX@, READ(CORE1 + @ENDX_HI@));
    W(@MMIX@, READ(@IRQINFO@));
  }
  frame++;
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
  module_frame();
}

void game_draw(void) { gs_show(); }

void game_sound(float *left, float *right, int count) {}
