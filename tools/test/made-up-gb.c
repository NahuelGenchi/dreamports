// A Dreamport in C, on the Game Boy kit in C (kit/gbc/c/), of the small program made-up-gb.mjs writes, for the Game Boy
// or for the Game Boy Color, which real-gb.mjs proves on the real emulator, every frame, picture and sound. It does what
// the program's processor does, a write at a time, each at the cycle the program makes it: the T_ numbers are the cycles
// from one of the program's marks to the next, and the rest of what's between @ signs is filled in from made-up-gb.mjs
// too.

#include "gb.h"

@NUMBERS@

#define R(address) gb_wram[(address) - 0xC000]

static int moved = @MOVED@;

// a store: the time up to it, and the write
static void w(int cycles, uint16_t address, uint8_t value) {
  gb_spend(cycles);
  gb_write(address, value);
}

// what the program does at power-on, with the screen off: its tiles, its two maps, its colours, the sound, the timer
// and its work memory, and then the screen on
static void power_on(void) {
  // the two instructions at $0100, which jump to it
  gb_spend(20);
  w(T_screenOff, 0xFF40, 0x00);
  for (int i = 0; i < 0x200; i++) gb_wram[i] = 0;
  R(COLOUR) = (uint8_t)gb_colour;
  for (int i = 0; i < DMA_SIZE; i++) gb_write((uint16_t)(0xFF80 + i), gb_read((uint16_t)(DMA_AT + i)));
  w(T_bank2, 0x2000, 2);
  for (int i = 0; i < TILES_SIZE; i++) gb_write((uint16_t)(0x8000 + i), gb_read((uint16_t)(0x4000 + i)));
  for (int row = 0; row < 32; row++)
    for (int column = 0; column < 32; column++) gb_write((uint16_t)(0x9800 + row * 32 + column), (uint8_t)((column + row) & 3));
  for (int i = 0; i < 0x400; i++) gb_write((uint16_t)(0x9C00 + i), 4);
  w(T_bank3, 0x2000, 3);
  if (gb_colour) {
    gb_write(0xFF4F, 1);
    for (int row = 0; row < 32; row++)
      for (int column = 0; column < 32; column++) gb_write((uint16_t)(0x9800 + row * 32 + column), (uint8_t)((column + row) & 7));
    for (int i = 0; i < 0x400; i++) gb_write((uint16_t)(0x9C00 + i), 7);
    gb_write(0xFF4F, 0);
    gb_write(0xFF68, 0x80);
    for (int i = 0; i < 64; i++) gb_write(0xFF69, gb_read((uint16_t)(0x4000 + i)));
    gb_write(0xFF6A, 0x80);
    for (int i = 0; i < 64; i++) gb_write(0xFF6B, gb_read((uint16_t)(0x4040 + i)));
  } else {
    gb_write(0xFF47, START_BGP);
    gb_write(0xFF48, START_OBP0);
    gb_write(0xFF49, START_OBP1);
  }
  gb_spend(T_soundOn);
  w(T_nr52, 0xFF26, 0x80);
  w(T_nr50, 0xFF24, 0x77);
  w(T_nr51, 0xFF25, 0xFF);
  for (int i = 0; i < 16; i++) gb_write((uint16_t)(0xFF30 + i), gb_read((uint16_t)(0x4080 + i)));
  // the cartridge's own memory: how many times the console was switched on
  gb_write(0x0000, 0x0A);
  uint8_t times = (uint8_t)(gb_read(0xA000) + 1);
  gb_write(0xA000, times);
  gb_sram_write();
  R(SAVED) = times;
  R(X) = START_X;
  R(Y) = START_Y;
  R(OAM + 0) = START_Y + 16;
  R(OAM + 1) = START_X + 8;
  R(OAM + 2) = 5;
  R(OAM + 3) = 0;
  R(OAM + 4) = START_OTHER_Y + 16;
  R(OAM + 5) = START_OTHER_X + 8;
  R(OAM + 6) = 6;
  R(OAM + 7) = 0xB1;
  gb_write(0xFF43, 0);
  gb_write(0xFF42, 0);
  gb_write(0xFF4A, START_WY);
  gb_write(0xFF4B, 7);
  gb_write(0xFF45, START_LYC);
  gb_write(0xFF41, 0x40);
  gb_spend(T_timerOn);
  w(T_tma, 0xFF06, START_TMA);
  w(T_tac, 0xFF07, 0x04);
  gb_write(0xFF0F, 0);
  w(T_interruptsOn, 0xFFFF, 0x07);
  w(T_screenOn, 0xFF40, LCDC);
  gb_spend(T_waits);
}

// a button's block: the time to it, then what it does if `on`, or the jump past it
#define SKIPPED_HELD 36
#define SKIPPED_PRESSED 24

// as each picture ends: the sprites, the scroll, the buttons, and what the buttons change
static void vblank(void) {
  gb_spend(T_dma);
  // the routine in the high memory that has the hardware copy the sprites, and waits while it does
  gb_spend(24 + 8 + 8);
  gb_write(0xFF46, OAM >> 8);
  gb_spend(4 + 8 + 0x28 * 16 - 4 + 16);
  R(NEXT) = R(SCROLL);
  w(T_scx, 0xFF43, R(SCROLL));
  w(T_scy, 0xFF42, R(SCROLL) >> 1);
  gb_spend(T_statRead);
  R(OTHER) = gb_read(0xFF41);
  gb_spend(T_pad);
  gb_write(0xFF00, 0x20);
  gb_read(0xFF00);
  uint8_t arrows = (uint8_t)(~gb_read(0xFF00) & 0x0F);
  gb_write(0xFF00, 0x10);
  gb_read(0xFF00);
  uint8_t now = (uint8_t)(arrows << 4 | (~gb_read(0xFF00) & 0x0F));
  gb_write(0xFF00, 0x30);
  uint8_t pressed = (uint8_t)(~R(BUTTONS) & now);
  R(BEFORE) = R(BUTTONS);
  R(BUTTONS) = now;
  gb_spend(T_rightAsked);
  if (now & 0x10) { R(X) = (uint8_t)(R(X) + moved); gb_spend(T_rightDone); } else gb_spend(SKIPPED_HELD);
  gb_spend(T_leftAsked);
  if (now & 0x20) { R(X)--; gb_spend(T_leftDone); } else gb_spend(SKIPPED_HELD);
  gb_spend(T_upAsked);
  if (now & 0x40) { R(Y)--; gb_spend(T_upDone); } else gb_spend(SKIPPED_HELD);
  gb_spend(T_downAsked);
  if (now & 0x80) { R(Y)++; gb_spend(T_downDone); } else gb_spend(SKIPPED_HELD);
  R(OAM + 0) = (uint8_t)(R(Y) + 16);
  R(OAM + 1) = (uint8_t)(R(X) + 8);
  R(FRAME)++;
  w(T_bank, 0x2000, (R(FRAME) >> 4) & 3);
  R(BANKED) = gb_read(0x4000 + BANKED_AT);
  R(OAM + 6) = R(BANKED);
  R(SCROLL)++;
  R(SPLIT) = (uint8_t)-R(SCROLL);
  gb_spend(T_aAsked);
  if (pressed & 0x01) {
    w(T_nr10, 0xFF10, 0x16);
    w(T_nr11, 0xFF11, 0x80);
    w(T_nr12, 0xFF12, 0xF3);
    w(T_nr13, 0xFF13, 0x83);
    w(T_nr14, 0xFF14, 0x86);
    gb_spend(T_aDone);
  } else gb_spend(SKIPPED_PRESSED);
  gb_spend(T_bAsked);
  if (pressed & 0x02) {
    w(T_nr21, 0xFF16, 0x70);
    w(T_nr22, 0xFF17, 0xA4);
    w(T_nr23, 0xFF18, 0x06);
    w(T_nr24, 0xFF19, 0xC7);
    gb_spend(T_bDone);
  } else gb_spend(SKIPPED_PRESSED);
  gb_spend(T_selectAsked);
  if (pressed & 0x04) {
    w(T_nr41, 0xFF20, 0x00);
    w(T_nr42, 0xFF21, 0xF2);
    w(T_nr43, 0xFF22, 0x53);
    w(T_nr44, 0xFF23, 0x80);
    gb_spend(T_selectDone);
  } else gb_spend(SKIPPED_PRESSED);
  gb_spend(T_startAsked);
  if (pressed & 0x08) {
    R(FLIPPED) ^= 1;
    R(WAVE) ^= 1;
    gb_spend(T_waveAsked);
    if (R(WAVE)) {
      w(T_nr30, 0xFF1A, 0x80);
      w(T_nr32, 0xFF1C, 0x20);
      w(T_nr33, 0xFF1D, 0xD6);
      w(T_nr34, 0xFF1E, 0x86);
      gb_spend(T_waveOnEnds + 12);
    } else {
      w(12 + T_nr30off, 0xFF1A, 0x00);
      gb_spend(T_waveDone);
    }
    gb_spend(T_coloursAsked);
    if (R(COLOUR)) {
      w(T_bcps, 0xFF68, 0x80);
      gb_spend(T_whichColour);
      if (R(FLIPPED)) {
        w(T_flipLow, 0xFF69, FLIPPED_COLOUR & 0xFF);
        w(T_flipHigh, 0xFF69, FLIPPED_COLOUR >> 8);
        gb_spend(T_flipEnds + 12);
      } else {
        w(12 + T_plainLow, 0xFF69, PLAIN_COLOUR & 0xFF);
        w(T_plainHigh, 0xFF69, PLAIN_COLOUR >> 8);
        gb_spend(T_plainEnds + 12);
      }
    } else {
      uint8_t shades = (uint8_t)~gb_read(0xFF47);
      w(12 + T_bgp, 0xFF47, shades);
      gb_spend(T_flipDone);
    }
  } else gb_spend(SKIPPED_PRESSED);
  gb_spend(T_vblankEnds + T_vblankEnded);
}

// twice a picture, at the line LYC names: the scroll it was left, first thing. Two lines before the split it leaves
// the split's scroll for next time and switches the timer's interrupt off, and at the split it switches it back on
static void split(void) {
  w(T_split, 0xFF43, R(NEXT));
  gb_spend(T_stageAsked);
  if (!R(STAGE)) {
    R(STAGE) = 1;
    R(NEXT) = R(SPLIT);
    w(T_timerOff, 0xFFFF, 0x03);
    w(T_lycSplit, 0xFF45, SPLIT_AT);
    gb_spend(T_firstEnds + 16);
  } else {
    R(STAGE) = 0;
    w(12 + T_timerBack, 0xFFFF, 0x07);
    w(T_lycFirst, 0xFF45, START_LYC);
    gb_spend(T_secondEnds + 16);
  }
}

// the timer: it counts, and while B is held it gives the second channel the next of four pitches
static void timer(void) {
  R(TICKS)++;
  gb_spend(T_timerAsked);
  if (R(BUTTONS) & 0x02) {
    w(T_pitch, 0xFF18, gb_read((uint16_t)(PITCHES_AT + (R(TICKS) & 3))));
    gb_spend(T_timerEnds);
  } else gb_spend(SKIPPED_HELD);
  gb_spend(T_timerEnded);
}

// an interrupt's code, from the jump at its own address to its return
static void handle(int which) {
  gb_spend(16);
  if (which == GB_VBLANK) vblank();
  else if (which == GB_STAT) split();
  else timer();
}

// Where the program is as a frame ends, which the next frame goes on from: waiting in its HALT, just back from an
// interrupt's code to the jump after the HALT, or past that jump and about to HALT again.
enum { HALTED, RETURNED, JUMPED };
static int at;

// the program's loop: it waits for an interrupt, and jumps back to wait again
static void run(void) {
  for (;;) {
    int which;
    if (at == HALTED) {
      which = gb_halt();
      if (!which) return;
      handle(which);
      at = RETURNED;
    }
    // an interrupt that is waiting is taken as soon as the last one's code has returned
    while ((which = gb_interrupt()) > 0) handle(which);
    if (which < 0) return;
    if (at == RETURNED) {
      gb_spend(12);
      at = JUMPED;
    } else at = HALTED;
  }
}

void game_start(void) {
  int32_t later = kit_start_number("scroll", -1);
  at = HALTED;
  power_on();
  if (later >= 0) {
    // a start point: the program as it is once it plays, with its scroll there
    gb_play_ahead(PLAYS_FROM);
    R(SCROLL) = (uint8_t)later;
  } else run();
}

void game_step(uint32_t buttons) {
  (void)buttons;
  run();
}
