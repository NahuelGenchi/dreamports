// Ghosts'n Goblins Dreamport: the processor's time. The original's tasks take most of a frame, and in a stage more
// than one, so its V-blank interrupt often comes while a task is partway through its work, and what the interrupt
// then finds in work memory, a list of sprites half copied or a list of rows still being added to, is what the picture
// shows. So the game's code says how long each piece of the original's code it stands for takes (costs.h), this file
// keeps the time, and the interrupt runs from here at the moment its time comes, inside whatever the tasks are doing.
//
// The kit runs the game a frame at a time, and a task's turn can run past the end of the kit's frame. What the game
// writes to the hardware is therefore kept here with its time, and given to the kit in the frame it belongs to. The
// buttons are read when that frame comes too, as they aren't known sooner.
//
// Time is counted in the PPU's dots, three to a processor's cycle, from the start of the emulator's first frame, the
// one before the kit's frame 0 (kit/nes/c/README.md).

#include "game.h"

static const uint16_t CYCLES[] = {
#define COST(name, cycles) [name] = cycles,
#include "costs.h"
#undef COST
};

enum { DOTS_A_CYCLE = 3, FIRST_FRAME_DOTS = 89342 };

static uint64_t now;            // the processor's time
static uint64_t frame_starts;   // when the kit's frame that's being run started,
static uint32_t frame;          // and which it is
static uint64_t vblank_at;      // when the PPU next asks for the interrupt,
static uint64_t vblank_frame_starts;  // the start of the frame it's in,
static uint32_t vblank_frame;   // and which frame that is
static uint8_t wanted;          // whether $2000 lets the PPU ask
static uint8_t interrupted;     // whether the interrupt's own code is running

// ---- what's written to the hardware, in the order it's written

enum { WRITE, PPU_LATCH, SPRITES, PADS };
typedef struct { uint64_t at; uint16_t address; uint8_t value, kind; } written;
enum { MOST_WRITTEN = 4096, MOST_SPRITE_LISTS = 4 };
static written list[MOST_WRITTEN];
static uint32_t list_first, list_count;
static uint8_t sprite_lists[MOST_SPRITE_LISTS][256];
static uint8_t sprite_list_next;

static void keep(uint8_t kind, uint16_t address, uint8_t value) {
  if (list_count == MOST_WRITTEN) return;   // more than any frame writes
  list[(list_first + list_count++) % MOST_WRITTEN] = (written){ now, address, value, kind };
}

void hardware_write(uint16_t address, uint8_t value) { keep(WRITE, address, value); }
void hardware_ppu_latch(void) { keep(PPU_LATCH, 0x2002, 0); }
void hardware_read_pads(uint8_t guessed) { keep(PADS, 0x4016, guessed); }

// A write of $4014: the page of sprites as it is at this moment.
void hardware_send_sprites(uint8_t page) {
  for (int i = 0; i < 256; i++) sprite_lists[sprite_list_next][i] = RAM[(page << 8 | i) & 0x7FF];
  keep(SPRITES, 0x4014, sprite_list_next);
  sprite_list_next = (uint8_t)((sprite_list_next + 1) % MOST_SPRITE_LISTS);
}

// Gives the kit what was written before `until`, each at its own time in the kit's frame.
static void deliver(uint64_t until) {
  while (list_count && list[list_first].at < until) {
    written w = list[list_first];
    list_first = (list_first + 1) % MOST_WRITTEN;
    list_count--;
    int64_t dot = (int64_t)(w.at - frame_starts);
    if (dot > nes_now()) nes_spend((int)((dot - nes_now()) / DOTS_A_CYCLE));
    switch (w.kind) {
      case WRITE: nes_write(w.address, w.value); break;
      case PPU_LATCH: nes_read(0x2002); break;
      case SPRITES: for (int i = 0; i < 256; i++) nes_write(0x2004, sprite_lists[w.value][i]); break;
      case PADS: read_pads(w.value); break;
    }
  }
}

// ---- the time

// The PPU asks for the interrupt 353 dots into each frame, when $2000 lets it.
static void vblank_comes(void) {
  vblank_frame_starts += (uint64_t)nes_frame_length((int)vblank_frame);
  vblank_frame++;
  vblank_at = vblank_frame_starts + NES_NMI_DOT;
  if (!wanted) return;
  interrupted = 1;
  time_check('V', 0);
  took(INTERRUPT_TAKEN);
  vblank_interrupt();
  time_check('W', 0);
  interrupted = 0;
}

#ifdef TIME_CHECK
// For the check that compares work memory with the emulator's at each frame's end: a copy of it as the processor's
// time passes the end of each of the kit's frames, the last four kept, as one turn can pass more than one, and counts
// of the cycles each interrupt and each turn took.
uint8_t time_check_memory[4][0x800];
uint32_t time_check_ends;   // how many frames' ends have passed
static uint64_t check_end_at;
uint64_t time_check_now(void) { return now; }
uint32_t time_check_frame(void) { return vblank_frame; }
static void check_frame_end(void) {
  if (!check_end_at) check_end_at = FIRST_FRAME_DOTS + (uint64_t)nes_frame_length(0);
  while (now >= check_end_at) {
    for (int i = 0; i < 0x800; i++) time_check_memory[time_check_ends & 3][i] = RAM[i];
    time_check_ends++;
    check_end_at += (uint64_t)nes_frame_length((int)time_check_ends);
  }
}
#else
static void check_frame_end(void) {}
#endif

void took_times(cost what, uint32_t times) {
  now += (uint64_t)CYCLES[what] * times * DOTS_A_CYCLE;
  check_frame_end();
  while (!interrupted && now >= vblank_at) vblank_comes();
}
void took(cost what) { took_times(what, 1); }

// A piece that was counted before it could be known, as `assumed`, turns out to have been `real`: the time since is put
// right. Only the buttons need it, which the interrupt can read before the kit's frame has brought them.
void took_instead(cost assumed, cost real) { now += ((int64_t)CYCLES[real] - (int64_t)CYCLES[assumed]) * DOTS_A_CYCLE; }

void vblank_interrupt_wanted(uint8_t on) { wanted = on; }

// ---- a loop that waits for V-blank: a few instructions of three cycles each, round and round. The interrupt comes
// after the instruction that's running, and what the loop still has to do once it's back depends on which that was.

static struct { uint64_t pass_starts; uint8_t instructions, next, on, interrupted; } loop;

void loop_begins(uint8_t instructions) {
  loop.on = 1;
  loop.instructions = instructions;
  loop.pass_starts = now;
  loop.next = 0;
  loop.interrupted = 0;
}
uint8_t loop_was_interrupted(void) { return loop.interrupted; }
uint8_t interrupt_runs_ahead(void) { return vblank_frame - 1 > frame; }

// V-blank's time has come while the processor is in the loop.
static void loop_interrupted(void) {
  const uint64_t each = (uint64_t)CYCLES[LOOP_INSTRUCTION] * DOTS_A_CYCLE;
  uint64_t done = vblank_at > loop.pass_starts ? (vblank_at - loop.pass_starts + each - 1) / each : 0;
  now = loop.pass_starts + done * each;
  loop.next = (uint8_t)(done % loop.instructions);
  loop.interrupted = 1;
  vblank_comes();
}

// The loop goes on: what's left of the pass the interrupt came in, and round again.
void loop_goes_on(void) {
  if (!loop.interrupted) return;
  took_times(LOOP_INSTRUCTION, (uint32_t)((loop.instructions - loop.next) % loop.instructions));
  loop.pass_starts = now;
  loop.next = 0;
  loop.interrupted = 0;
}

// The loop is over: what's left of that pass, and one more whose last branch falls through.
void loop_left(void) {
  loop.on = 0;
  took_times(LOOP_INSTRUCTION, (uint32_t)((loop.instructions - loop.next) % loop.instructions) + loop.instructions - 1);
  took(LOOP_LEFT);
}

// ---- the kit's frames

void time_starts(void) {
  now = 0;
  frame = 0;
  frame_starts = FIRST_FRAME_DOTS;
  vblank_frame = 0;
  vblank_frame_starts = FIRST_FRAME_DOTS;
  vblank_at = vblank_frame_starts + NES_NMI_DOT;
  wanted = interrupted = 0;
  list_first = list_count = 0;
  sprite_list_next = 0;
  loop.on = 0;
}

// The start of the kit's frame: its V-blank comes now, unless a task's turn ran into it and it has come already, and what
// it wrote goes to the kit.
void frame_begins(void) {
#ifdef TIME_CHECK
#endif
  if (vblank_frame == frame) {
    if (loop.on) loop_interrupted();
    else {
      if (now < vblank_at) now = vblank_at;
      vblank_comes();
    }
  }
  deliver(frame_starts + (uint64_t)nes_frame_length((int)frame));
}

// Whether the tasks' time has reached the next frame's V-blank, so this frame has no more for them to do.
uint8_t frame_is_over(void) { return vblank_frame > frame + 1 || now >= frame_starts + (uint64_t)nes_frame_length((int)frame) + NES_NMI_DOT; }

void frame_ends(void) {
  uint64_t ends = frame_starts + (uint64_t)nes_frame_length((int)frame);
  deliver(ends);
  frame_starts = ends;
  frame++;
}

// $C00D: the original's start waits in a loop for the PPU's first V-blank, which comes in the kit's frame 1: each pass
// reads $2002 once, and the first pass to read it after V-blank has started is the last.
void start_waited_for_vblank(void) {
  const uint64_t pass = (uint64_t)CYCLES[START_WAIT_PASS] * DOTS_A_CYCLE, read = (uint64_t)CYCLES[START_WAIT_READ] * DOTS_A_CYCLE;
  const uint64_t first = (uint64_t)CYCLES[START_BEFORE_WAIT] * DOTS_A_CYCLE, seen = frame_starts + NES_VBLANK_DOT;
  uint64_t passes = (seen - first - read + pass - 1) / pass;
  now = first + passes * pass + read + (uint64_t)CYCLES[START_WAIT_OVER] * DOTS_A_CYCLE;
}
