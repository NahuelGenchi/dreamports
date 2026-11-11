// Ghosts'n Goblins Dreamport: the game's start, its tasks and its V-blank interrupt, written from the original's code
// in its last bank. The tasks' own code is in the other files (game.h).
//
// The original gives each task its own stack, and a task hands the processor on by calling sub_C336, which saves its
// registers and stack and starts the next task that's ready. Once every task has had a turn, the processor waits at
// $C39C until two V-blanks have passed, and a new round starts. So the game's rules run 30 times a second, and its
// V-blank interrupt, 60 times, does everything the hardware needs: the sprites, the tiles and colours the tasks left
// for it in work memory, the scroll, the buttons and the sound.
//
// Here a task is a function that runs one turn and returns how it waits. What a task's stack held between turns is the
// step it's at (task_step), and nothing of the stacks themselves is kept in work memory.

#include "game.h"

uint8_t task_step[TASK_LAST + 2];
static wait (*const TASK_CODE[])(void) = {
  [TASK_TITLE / 2] = title_task, [TASK_GAME / 2] = game_task, [TASK_VIEW / 2] = view_task, [TASK_ARTHUR / 2] = arthur_task,
  [TASK_OBJECTS / 2] = objects_task, [TASK_SPRITES / 2] = sprites_task, [TASK_TILES / 2] = tiles_task,
};

// whether the game has started, whether V-blank interrupts it, whether the task that's running waits in a loop, and
// whether every task has had its turn and the processor waits for the next round
static uint8_t powered, interrupts, spinning, round_over;
// A round's work takes most of a frame, so when a round starts in a frame where tasks have already run, V-blank comes
// before it's done. In the original that's while the sprites' task fills its list, the longest work there is, as when a
// task has waited in a loop for V-blank, finishes its turn, and the next round starts at once.
static uint8_t worked_this_frame, round_late;
uint8_t round_started_late(void) { return round_late; }

/** Writes $2000 from its copy in work memory, with or without V-blank's interrupt. */
void write_ppu_control(uint8_t value) {
  nes_write(0x2000, value);
  interrupts = value >> 7;
}

// sub_C2BC: starts a task from its first instruction, unless it's running already. The original writes its first
// return address on the task's own stack, whose top the table at $C3BC gives.
void start_task(uint8_t task) {
  RAM[0x28] = task;
  if (TASK_STATE(task) & 0x80) return;
  TASK_STATE(task) |= TASK_READY;
  RAM[0x24] = (uint8_t)(cart(7, (uint16_t)(0xC3BC + task)) - 2);
  RAM[0x25] = 0x01;
  task_step[task] = 0;
}

// sub_C303: stops a task, wherever it is.
void stop_task(uint8_t task) {
  RAM[0x28] = task;
  TASK_STATE(task) = TASK_FREE;
}

// sub_C313: the task that's running sleeps for `frames` V-blanks and one more, and then has its turns again.
wait sleep_task(uint16_t frames) {
  TASK_STATE(TASK_NOW) |= 0x40;
  set_ram16(TASK_SLEEP(TASK_NOW), frames);
  return YIELDS;
}

// $C008: the original's start. It waits for V-blank, clears work memory from $0300 up and the first page, starts the
// sprites', the title's and the tiles' tasks, and turns V-blank's interrupt on.
static void power_on(void) {
  nes_write(0x2000, 0x10);
  nes_write(0x2001, 0x06);
  for (int i = 0x300; i < 0x800; i++) RAM[i] = 0;
  for (int i = 0; i < 0x100; i++) RAM[i] = 0;
  RAM[0x27] = 0x08;       // where the clearing's pointer stops
  RAM[0x8B] = 0x14;       // the two marks a reset looks for, to keep the best score: nothing has it yet
  RAM[0x8C] = 0x22;
  RAM[0xA2] = 1;          // two players' scores on the title screen
  RAM[ROWS] = 0xFF;
  nes_write(0x4015, 0x0F);
  set_ram16(0x56, 0x23C0);         // where V-blank writes the next 32 attributes,
  set_ram16(0x58, ATTRIBUTES);     // and where it takes them from
  RAM[0xA3] = 1;
  start_task(TASK_SPRITES);
  start_task(TASK_TITLE);
  start_task(TASK_TILES);
  BANK_HOME = 1;
  switch_bank(1);
  sound_reset();
  FRAMES_A_ROUND = 2;
  PPU_CONTROL = 0x90;
  write_ppu_control(0x90);
  PPU_MASK = 0x1E;
}

// sub_C278 and sub_C28E: both controllers' buttons, a bit at a time, into $42 and $44, with $43 and $45 the same but
// for the A button, which is left out there while it stays held.
void read_pads(void) {
  nes_write(0x4016, 1);
  nes_write(0x4016, 0);
  for (int pad = 0; pad < 2; pad++) {
    uint8_t held = 0;
    for (int bit = 0; bit < 8; bit++) {
      uint8_t read = nes_read((uint16_t)(0x4016 + pad));
      RAM[0x41] = read;
      held = (uint8_t)(held << 1 | ((read | read >> 1) & 1));  // a controller's own bit, or the expansion port's
      RAM[0x40] = bit < 7 ? held : RAM[0x40];
    }
    uint8_t before = RAM[0x42 + pad * 2];
    RAM[0x41] = before;
    RAM[0x42 + pad * 2] = held;
    RAM[0x43 + pad * 2] = (held & 0x80) && (before & 0x80) ? held & 0x7F : held;
  }
}

// $C0F0: the V-blank interrupt.
static void vblank_interrupt(void) {
  PPU_CONTROL &= 0x7F;
  write_ppu_control(PPU_CONTROL);
  vblank_draws();
  read_pads();
  sound_frame();
  FRAMES_SINCE_ROUND++;
  // $C239: the sleeping tasks' time
  for (uint8_t task = TASK_TITLE; task <= TASK_LAST; task += 2) {
    if (TASK_STATE(task) != TASK_ASLEEP) continue;
    uint16_t left = ram16(TASK_SLEEP(task));
    set_ram16(TASK_SLEEP(task), (uint16_t)(left - 1));
    if (left == 0) TASK_STATE(task) &= 0xBF;
  }
  if (RAM[0x80] == 0) RAM[0x4D]++;   // a count of frames the game reads elsewhere, while $80 lets it run
  PPU_CONTROL |= 0x80;
  write_ppu_control(PPU_CONTROL);
  RAM[0x5A] = PPU_CONTROL;
}

// $C37D: the tasks' turns. The next ready task after the one that ran has its turn, and when none is left the round is
// over: the next starts once enough V-blanks have passed, at once if they already have.
static void run_tasks(void) {
  for (;;) {
    if (round_over) {
      if (FRAMES_SINCE_ROUND < FRAMES_A_ROUND) return;
      FRAMES_SINCE_ROUND = 0;
      round_over = 0;
      round_late = worked_this_frame;
    }
    uint8_t task = TASK_NOW;
    if (!spinning) {
      do task += 2; while (task <= TASK_LAST && TASK_STATE(task) != TASK_READY);
      TASK_NOW = task > TASK_LAST ? 0 : task;
      if (!TASK_NOW) { round_over = 1; continue; }
    }
    worked_this_frame = 1;
    wait how = TASK_CODE[task / 2]();
    spinning = how == SPINS;
    if (spinning) return;
    if (how == ENDS) TASK_STATE(task) = TASK_FREE;
  }
}

// once, with the player's copy in kit_copy and the cartridge in nes_prg
void game_start(void) {
  // the console's work memory as the proof's emulator has it at power-on: the original clears all it uses but the
  // sprites' two pages, which its sprites' task fills before the picture is on
  for (int i = 0; i < 0x800; i++) RAM[i] = 0xFF;
  powered = interrupts = spinning = round_over = worked_this_frame = round_late = 0;
  for (unsigned i = 0; i < sizeof task_step; i++) task_step[i] = 0;
}

// each frame: what the original's processor does from one V-blank to the next
void game_step(uint32_t buttons) {
  (void)buttons;  // the controllers are read through $4016
  worked_this_frame = 0;
  if (!powered) {
    // $C00D: the original waits here for the PPU's first V-blank
    if (!(nes_read(0x2002) & 0x80)) return;
    powered = 1;
    power_on();
    worked_this_frame = round_late = 1;   // the start's own work, before the first round
  } else if (interrupts) {
    vblank_interrupt();
    round_late = 0;
  }
  run_tasks();
}
