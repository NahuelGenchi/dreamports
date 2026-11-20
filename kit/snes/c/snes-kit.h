// What the Super Nintendo kit's own files share (snes.c, ppu.c, dma.c, apu.c, dsp.c, frame.c), which a game doesn't
// need.

#ifndef DREAMPORTS_SNES_KIT_H
#define DREAMPORTS_SNES_KIT_H

#include "snes.h"
#include "kit.h"

// how wide and how tall the console's picture is, 239 lines tall with overscan, and the line the first one shown is:
// the console doesn't show line 0
enum { SNES_WIDTH = 256, SNES_HEIGHT = 224, SNES_HEIGHT_EXTENDED = 239, SNES_FIRST_LINE = 1 };

/** Puts the picture unit as the console starts it: the screen off, its memories cleared. */
void ppu_power(void);
/** A write to a register of the picture unit, $2100 to $2133. */
void ppu_write(uint16_t address, uint8_t value);
/** A read of the picture unit's registers: $2134 to $2136, mode 7's product of its matrix's A and B's top byte;
 *  $2137 to $213F, the counters, the sprites' table, video memory, the colours and the two status bytes; and those that
 *  are only written, which give what was last read from the first of its two chips. */
uint8_t ppu_read(uint16_t address);
/** Latches the dot and the line the console is at for $213C and $213D, as reading $2137 does while $4201's top bit is
 *  set, or `always`, as $4201's top bit going off does. */
void ppu_latch(int always);
/** The line V-blank started on in the last frame, 225, or 240 with overscan. */
int ppu_vblank_line(void);
/** The frame's lines as they are now, 224, or 239 with overscan. */
int ppu_lines(void);
/** Whether the frame drawn last lasts a line more, 263, as Snes9x has an interlaced frame whose field started odd. */
int ppu_long_frame(void);
/** Whether Snes9x makes line 240 of this frame a dot short: when it isn't interlaced and its field is odd. */
int ppu_short_line(void);
/** Draws the frame's lines, as the registers are, into the picture Snes9x keeps from frame to frame. */
void ppu_frame(void);
/** Draws on from the line V-blank started on to the last the frame has now, as Snes9x does when overscan comes on
 *  after line 225, with no HDMA, which V-blank stopped, and starts V-blank again after them. */
void ppu_rest(void);
/** The frame as shown: its words, `width` by `height`, 512 words to a row, as the page shows them. */
uint32_t *ppu_picture(int *width, int *height);
/** What the console does to the picture unit as V-blank starts, after the frame's last line. */
void ppu_vblank(void);

/** Moves memory by DMA on each channel `channels` has a bit for, as a write to $420B does, one after another. */
void dma_start(uint8_t channels);
/** Starts HDMA on the channels $420C turns on, as line 0 of a frame starts. */
void hdma_start(void);
/** HDMA's writes for one line, as its H-blank comes, which show from the next line down. */
void hdma_line(void);
/** A write to a channel's $43xA, its lines left. */
void hdma_lines_written(int c, uint8_t value);

/** Puts the sound side as the console starts it: its memory cleared, its timers off, the sound chip reset, and the
 *  start-up program waiting for the main processor. */
void apu_power(void);
/** A write by the main processor to one of the four ports, $2140 to $2143, 0 to 3 here. */
void apu_port_write(int port, uint8_t value);
/** A read by the main processor of one of the four ports: what the sound processor last wrote there. */
uint8_t apu_port_read(int port);
/** Runs the sound side on for `cycles` of the main clock: its program's turns as its timers count, and the sound chip. */
void apu_run(uint32_t cycles);
/** The sound chip's next sample, left and right, as it makes one every 32 of the sound processor's cycles. */
void apu_sample(int16_t left, int16_t right);
/** Takes `count` of the samples made so far, oldest first, into `left` and `right`, each -1 to 1; silence for any
 *  not made yet. */
void apu_samples(float *left, float *right, int count);

/** Resets the sound chip, which plays from the sound processor's memory `ram`. */
void dsp_power(uint8_t *ram);
/** Runs the sound chip for `cycles` of the sound processor's. */
void dsp_run(uint32_t cycles);
/** The sound chip's register at `address`, $00 to $7F, as the sound processor reads it at $F3. */
uint8_t dsp_read(uint8_t address);
/** A write to the sound chip's register at `address`, as the sound processor writes $F3. */
void dsp_write(uint8_t address, uint8_t value);

/** Sets where the console is: a line, 0 to 261, and a cycle of the main clock from its start. */
void timing_at(int line, int cycle);
/** The line the console is on. */
int timing_line(void);
/** The cycle of the main clock the console is at on its line. */
int timing_cycle(void);
/** Runs the game's IRQ handler for each time the timers' interrupt comes on `line` from cycle `from` up to `to`. */
void timing_run(int line, int from, int to);
/** The moment of V-blank's interrupt, NMI, where a game's step runs: line 225, as Snes9x times it. */
void timing_nmi(void);
/** V-blank's lines after the frame's, from 225, with the IRQs that come on them. */
void timing_vblank(void);
/** One line of the frame, its events at their times: HDMA's start on line 0, `draw` of the row before at cycle 512,
 *  HDMA's writes in H-blank, and the IRQs between. */
void timing_line_run(int line, void (*draw)(int row), void (*hdma_init)(void), void (*hdma)(void));
/** How long a step lasts in the main clock's cycles: from V-blank's start on line `from` to its next start on line
 *  `to`, in the same frame when `again`, as overscan coming on after line 225 makes it, or else a frame on, through
 *  the frame's 262 or 263 lines and its line 240, a dot short on every other frame, as Snes9x times them. */
uint32_t timing_step(int from, int to, int again);
/** $4212 as read now: V-blank, H-blank and auto-joypad's reading. */
uint8_t timing_4212(void);
/** A write to $420C partway down the frame: the channels that haven't ended run from the next line. */
void hdma_enable_written(uint8_t value);

/** Reads the cartridge's header from the player's copy, as the console's wiring sees it. */
void cartridge_load(void);
/** A write to a 24-bit address of the console's own memories, as DMA from the hardware writes it: the work memory and the
 *  save memory, wherever the map shows them; anything else isn't written. */
void snes_bus_write(uint32_t address, uint8_t value);

#endif
