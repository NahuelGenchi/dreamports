// When things happen within a frame on the Super Nintendo, as Snes9x times them, the reference the proof tools run the
// original on: in the main clock's cycles from a line's start, 1364 to a line, 262 lines to a frame, its lines shown
// from line 1 to 224 and V-blank from line 225. This file alone holds those numbers; the picture unit (ppu.c) draws its
// lines at the times it gives, and the game's interrupt handler, game_irq, runs at the line and dot its timers say.
//
// A game's step, its handler for the interrupt at V-blank, NMI, runs as V-blank starts, at line 225. Its handler for the
// timers' interrupt, IRQ, runs where $4200's bits 4 and 5 and the timers at $4207 to $420A put it: at a dot of every
// line, at the start of one line, or at a dot of one line, as Snes9x works out the cycle, and only while the game has
// let IRQs in, as its original's CLI does (snes_interrupts). Everything the handler writes happens at that moment: so
// on the console a write lands a line later when the handler takes so long it passes the point where Snes9x draws the
// line before, cycle 512, and the kit has no way to count its instructions' cycles.

#include "snes-kit.h"

// the cycles of a line, where on line 0 HDMA starts, where Snes9x draws the line before, where HDMA writes for the
// line, where H-blank starts and ends, how long after the timers' dot their interrupt comes, and a dot's cycles
enum {
  LINE_CYCLES = 1364, LINES = 262, HDMA_INIT = 20, DRAW = 512, HDMA_LINE = 1106, HBLANK_START = 1096, HBLANK_END = 4,
  IRQ_AFTER = 14, DOT = 4, VBLANK = SNES_HEIGHT + SNES_FIRST_LINE, NMI_AT = 12,
};

// the line and the cycle the console is at, as far as the kit knows: V-blank's first line outside the frame's lines
static int now_line = VBLANK, now_cycle;
// whether IRQs are let in, as the processor's I flag says: not as it starts
static int irqs_in;

/** A game with no handler for the timers' interrupt has one that does nothing. */
__attribute__((weak)) void game_irq(void) {}

void snes_interrupts(int on) { irqs_in = on; }

// the cycle on line `line` where the timers' interrupt comes, or -1 where it doesn't, from $4200 and $4207 to $420A
static int irq_cycle(int line) {
  const uint8_t *cpu = SNES_CPU_REGISTERS;
  int h = cpu[0x200] & 0x10, v = cpu[0x200] & 0x20;
  int htime = cpu[0x207] | (cpu[0x208] & 1) << 8, vtime = cpu[0x209] | (cpu[0x20A] & 1) << 8;
  int at = htime * DOT + IRQ_AFTER - (htime ? 0 : DOT) + (htime > 322 ? DOT / 2 : 0) + (htime > 326 ? DOT / 2 : 0);
  if (at >= LINE_CYCLES) at = -1;
  if (v && vtime >= LINES) return -1;
  if (h && !v) return at;
  if (v && !h) return line == vtime ? IRQ_AFTER - DOT : -1;
  if (h && v) return line == vtime ? at : -1;
  return -1;
}

void timing_at(int line, int cycle) {
  now_line = line;
  now_cycle = cycle;
}

int timing_line(void) { return now_line; }

void timing_run(int line, int from, int to) {
  for (;;) {
    int at = irq_cycle(line);
    if (at < from || at >= to) break;
    timing_at(line, at);
    // TIMEUP's flag, which the handler reads to clear
    SNES_CPU_REGISTERS[0x211] |= 0x80;
    if (irqs_in) game_irq();
    // the handler may set the timers again, to a later dot of the same line
    from = at + 1;
  }
  timing_at(line, to);
}

void timing_nmi(void) { timing_at(VBLANK, NMI_AT); }

void timing_vblank(void) {
  timing_at(VBLANK, 0);
  for (int line = VBLANK; line < LINES; line++) timing_run(line, 0, LINE_CYCLES);
}

void timing_line_run(int line, void (*draw)(int row), void (*hdma_init)(void), void (*hdma)(void)) {
  timing_run(line, 0, HDMA_INIT);
  if (!line) hdma_init();
  timing_run(line, HDMA_INIT, DRAW);
  if (line >= SNES_FIRST_LINE) draw(line - SNES_FIRST_LINE);
  timing_run(line, DRAW, HDMA_LINE);
  hdma();
  timing_run(line, HDMA_LINE, LINE_CYCLES);
}

uint8_t timing_4212(void) {
  // auto-joypad's reading for the first three lines of V-blank, H-blank, and V-blank
  uint8_t value = now_line >= VBLANK && now_line < VBLANK + 3 ? 1 : 0;
  if (now_cycle < HBLANK_END || now_cycle >= HBLANK_START) value |= 0x40;
  if (now_line >= VBLANK) value |= 0x80;
  return value;
}
