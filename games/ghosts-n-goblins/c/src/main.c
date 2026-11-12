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

// whether the game has started, whether the task that's running waits in a loop for V-blank, and whether every task
// has had its turn and the processor waits, in the loop at $C39C, for the next round
static uint8_t powered, spinning, round_over;

/** Writes $2000 from its copy in work memory, with or without V-blank's interrupt. */
void write_ppu_control(uint8_t value) {
  hardware_write(0x2000, value);
  vblank_interrupt_wanted(value >> 7);
}

// sub_C2BC: starts a task from its first instruction, unless it's running already. The original writes its first
// return address on the task's own stack, whose top the table at $C3BC gives.
void start_task(uint8_t task) {
  RAM[0x28] = task;
  if (TASK_STATE(task) & 0x80) { took(TASK_ALREADY_RUNNING); return; }
  TASK_STATE(task) |= TASK_READY;
  RAM[0x24] = (uint8_t)(cart(7, (uint16_t)(0xC3BC + task)) - 2);
  RAM[0x25] = 0x01;
  task_step[task] = 0;
  took(TASK_STARTED);
}

// sub_C303: stops a task, wherever it is.
void stop_task(uint8_t task) {
  RAM[0x28] = task;
  TASK_STATE(task) = TASK_FREE;
  took(TASK_STOPPED);
}

void stop_game_tasks(void) {
  took(GAME_TASKS_STOP_BEGINS);
  for (uint8_t task = TASK_VIEW; task != TASK_SPRITES; task += 2) {
    took(CALLS);
    stop_task(task);
    took(GAME_TASK_STOPPED);
    took(task + 2 != TASK_SPRITES ? GOES_ROUND : GOES_ON);
  }
  took(RETURNS);
}

// sub_C313: the task that's running sleeps for `frames` V-blanks and one more, and then has its turns again.
wait sleep_task(uint16_t frames) {
  TASK_STATE(TASK_NOW) |= 0x40;
  set_ram16(TASK_SLEEP(TASK_NOW), frames);
  return SLEEPS;
}

// $C008: the original's start. It waits for V-blank, clears work memory from $0300 up and the first page, starts the
// sprites', the title's and the tiles' tasks, and turns V-blank's interrupt on.
static void power_on(void) {
  start_waited_for_vblank();
  took(START_TO_CONTROL);
  hardware_write(0x2000, 0x10);
  took(START_TO_MASK);
  hardware_write(0x2001, 0x06);
  for (int i = 0x300; i < 0x800; i++) RAM[i] = 0;
  for (int i = 0; i < 0x100; i++) RAM[i] = 0;
  RAM[0x27] = 0x08;       // where the clearing's pointer stops
  RAM[0x8B] = 0x14;       // the two marks a reset looks for, to keep the best score: nothing has it yet
  RAM[0x8C] = 0x22;
  RAM[0xA2] = 1;          // two players' scores on the title screen
  RAM[ROWS] = 0xFF;
  took(START_CLEARS_MEMORY);
  took(START_TO_SOUND_ON);
  hardware_write(0x4015, 0x0F);
  set_ram16(0x56, 0x23C0);         // where V-blank writes the next 32 attributes,
  set_ram16(0x58, ATTRIBUTES);     // and where it takes them from
  RAM[0xA3] = 1;
  took(START_SETTINGS);
  static const uint8_t FIRST_TASKS[] = { TASK_SPRITES, TASK_TITLE, TASK_TILES };
  for (unsigned i = 0; i < sizeof FIRST_TASKS; i++) {
    took(START_TASK_CALLED);
    start_task(FIRST_TASKS[i]);
  }
  BANK_HOME = 1;
  switch_bank(1);
  took(START_MORE_SETTINGS);
  sound_reset();
  FRAMES_A_ROUND = 2;
  PPU_CONTROL = 0x90;
  took(START_TO_INTERRUPTS_ON);
  write_ppu_control(0x90);
  PPU_MASK = 0x1E;
  took(START_TO_TURNS);
}

// sub_C278 and sub_C28E: both controllers' buttons, a bit at a time, into $42 and $44, with $43 and $45 the same but
// for the A button, which is left out there while it stays held. It runs when the kit's frame comes (time.c), and
// pads_take_time says how long the original's takes, which depends on the A buttons.
// Which of sub_C2A1's three ends a controller's read takes, by its A button now and when last read.
static cost pad_end(uint8_t was_held, uint8_t held) { return !held ? PAD_A_NOT_HELD : was_held ? PAD_A_STILL_HELD : PAD_A_NEWLY_HELD; }

void read_pads(uint8_t ran_ahead) {
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
    if (ran_ahead) took_instead(pad_end(before & 0x80, before & 0x80), pad_end(before & 0x80, held & 0x80));
    RAM[0x41] = before;
    RAM[0x42 + pad * 2] = held;
    RAM[0x43 + pad * 2] = (held & 0x80) && (before & 0x80) ? held & 0x7F : held;
  }
}

// How long sub_C278 takes, which depends on each A button, now and when last read. When the interrupt runs ahead of the
// kit's frame, this frame's buttons aren't known yet: A is taken as it was, and read_pads puts the time right.
static void pads_take_time(void) {
  took(PADS_BEGIN);
  for (int pad = 0; pad < 2; pad++) {
    uint8_t was_held = RAM[0x42 + pad * 2] & 0x80;
    uint8_t held = interrupt_runs_ahead() ? was_held : (nes_buttons() >> (pad * 8)) & BUTTON_A;
    took(PAD_BEGINS);
    took_times(PAD_BIT, 8);
    took_times(GOES_ROUND, 7);
    took(GOES_ON);
    took(PAD_KEPT);
    took(pad_end(was_held, held));
    if (pad == 0) took(PADS_SECOND);
  }
}

// $C0F0: the V-blank interrupt.
void vblank_interrupt(void) {
  PPU_CONTROL &= 0x7F;
  took(VBLANK_TO_CONTROL);
  hardware_write(0x2000, PPU_CONTROL);
  vblank_draws();
  took(VBLANK_TO_PADS);
  hardware_read_pads();
  pads_take_time();
  took(VBLANK_TO_SOUND);
  time_check('S', 0);
  sound_frame();
  time_check('E', 0);
  took(VBLANK_AFTER_SOUND);
  FRAMES_SINCE_ROUND++;
  // $C239: the sleeping tasks' time
  for (uint8_t task = TASK_TITLE; task <= TASK_LAST; task += 2) {
    took(VBLANK_TASK_LOOKED_AT);
    if (TASK_STATE(task) != TASK_ASLEEP) took(VBLANK_TASK_AWAKE);
    else {
      uint16_t left = ram16(TASK_SLEEP(task));
      set_ram16(TASK_SLEEP(task), (uint16_t)(left - 1));
      if (left == 0) TASK_STATE(task) &= 0xBF;
      took(left == 0 ? VBLANK_TASK_WAKES : VBLANK_TASK_SLEEPS_ON);
    }
    took(task < TASK_LAST ? VBLANK_NEXT_TASK : VBLANK_TASKS_DONE);
  }
  took(VBLANK_TO_FRAME_COUNT);
  if (RAM[0x80] == 0) RAM[0x4D]++;   // a count of frames the game reads elsewhere, while $80 lets it run
  took(RAM[0x80] == 0 ? VBLANK_FRAME_COUNTED : VBLANK_FRAME_NOT_COUNTED);
  PPU_CONTROL |= 0x80;
  took(VBLANK_TO_INTERRUPTS_ON);
  hardware_write(0x2000, PPU_CONTROL);
  RAM[0x5A] = PPU_CONTROL;
  took(VBLANK_LEAVES);
}

// $C37D: the tasks' turns. The next ready task after the one that ran has its turn, and when none is left the round is
// over: the processor waits in a loop of three instructions until enough V-blanks have passed, or not at all if they
// already have. A turn can run past the end of the kit's frame, and the next task's then waits for the next frame.
static void run_tasks(void) {
  while (!frame_is_over()) {
    if (round_over) {
      if (FRAMES_SINCE_ROUND < FRAMES_A_ROUND) {
        loop_goes_on();
        return;
      }
      loop_left();
      FRAMES_SINCE_ROUND = 0;
      round_over = 0;
      took(TURNS_ROUND_STARTS);
    }
    uint8_t task = TASK_NOW;
    if (spinning) {
      // the task that's running waits in its own loop of two instructions for V-blank
      if (!loop_was_interrupted()) return;
      loop_left();
    } else {
      // which task is next
      uint8_t found = 0;
      if (task == TASK_LAST) took(TURNS_NO_TASK_AFTER);
      else {
        took(TURNS_LOOK);
        while (!found) {
          task += 2;
          took(TURNS_CANDIDATE);
          found = TASK_STATE(task) == TASK_READY;
          if (found) { took(TURNS_IS_READY); break; }
          took(TURNS_IS_NOT);
          if (task == TASK_LAST) { took(TURNS_NONE_LEFT); break; }
          took(TURNS_NEXT);
        }
      }
      if (!found) {
        TASK_NOW = 0;
        round_over = 1;
        took(TURNS_ROUND_OVER);
        loop_begins(3);
        continue;
      }
      TASK_NOW = task;
      took(TURN_GIVEN);
    }
    time_check('t', task);
    wait how = TASK_CODE[task / 2]();
    time_check(how == SPINS ? 'p' : how == ENDS ? 'e' : how == SLEEPS ? 's' : 'y', task);
    spinning = how == SPINS;
    if (spinning) loop_begins(2);
    else if (how == ENDS) {
      TASK_STATE(task) = TASK_FREE;
      took(TASK_ENDS);
    } else took(how == SLEEPS ? TASK_SLEEPS : TASK_YIELDS);
  }
}

// once, with the player's copy in kit_copy and the cartridge in nes_prg
void game_start(void) {
  // the console's work memory as the proof's emulator has it at power-on: the original clears all it uses but the
  // sprites' two pages, which its sprites' task fills before the picture is on
  for (int i = 0; i < 0x800; i++) RAM[i] = 0xFF;
  powered = spinning = round_over = 0;
  for (unsigned i = 0; i < sizeof task_step; i++) task_step[i] = 0;
  time_starts();
}

// each frame: what the original's processor does in it, with V-blank's interrupt first unless it has come already
void game_step(uint32_t buttons) {
  (void)buttons;  // the controllers are read through $4016
  frame_begins();
  if (!powered && nes_frame() == 1) {
    // the PPU's first V-blank, which the original's start waits for, is in the kit's frame 1 (kit/nes/c/README.md)
    powered = 1;
    power_on();
  }
  if (powered) run_tasks();
  frame_ends();
}
