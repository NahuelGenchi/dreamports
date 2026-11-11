// Ghosts'n Goblins Dreamport: what the game's files share. The game keeps its variables where the original keeps them,
// in the console's work memory (nes_ram), so each one here is named by what it holds, with the original's address.
//
// The original runs up to eight tasks, each with its own stack, and a V-blank interrupt that does all the drawing and
// the sound. A task runs until it hands the processor on, and a round of the tasks starts every other frame. Here a
// task is a function that runs until its original would hand the processor on, and says how it waits (main.c).

#ifndef GHOSTS_N_GOBLINS_H
#define GHOSTS_N_GOBLINS_H

#include "nes.h"

#define RAM nes_ram

// ---- the cartridge: eight banks of program, one of them switched in at $8000, and the last always at $C000

/** The byte at `address` with `bank` switched in at $8000, or the last bank's from $C000 up. */
static inline uint8_t cart(uint8_t bank, uint16_t address) {
  return address >= 0xC000 ? nes_prg[nes_prg_size - 0x4000 + (address - 0xC000)] : nes_prg[(uint32_t)bank * 0x4000 + (address - 0x8000)];
}
#define BANK_NOW RAM[0xC7]    // the bank switched in at $8000
#define BANK_HOME RAM[0xC8]   // the bank a routine that switches puts back: the stage's own
/** The byte at `address` as the processor reads it: work memory, or the cartridge with the bank that's switched in.
 *  Between the two nothing answers on this cartridge, and the proof's emulator reads 0 there, as the original does when
 *  it looks up the stage's map before the stage's first screen. */
static inline uint8_t peek(uint16_t address) {
  if (address < 0x2000) return RAM[address & 0x7FF];
  return address < 0x8000 ? 0 : cart(BANK_NOW, address);
}
/** A 16-bit number at `address`, low byte first. */
static inline uint16_t peek16(uint16_t address) { return (uint16_t)(peek(address) | peek((uint16_t)(address + 1)) << 8); }
static inline uint16_t ram16(uint16_t address) { return (uint16_t)(RAM[address] | RAM[address + 1] << 8); }
static inline void set_ram16(uint16_t address, uint16_t value) { RAM[address] = (uint8_t)value; RAM[address + 1] = (uint8_t)(value >> 8); }
/** Switches `bank` in at $8000, as the original's store to the cartridge does. */
static inline void switch_bank(uint8_t bank) { BANK_NOW = bank; }

// ---- the processor's time (time.c, costs.h)

typedef enum {
#define COST(name, cycles) name,
#include "costs.h"
#undef COST
} cost;
/** The original's code took this long. V-blank's interrupt runs from here when its time comes. */
void took(cost what);
void took_times(cost what, uint32_t times);
void took_instead(cost assumed, cost real);
// what the game writes to the hardware, kept with its time until the kit's frame it belongs to
void hardware_write(uint16_t address, uint8_t value);
void hardware_ppu_latch(void);              // a read of $2002, which makes the next write of $2006 the first of two
void hardware_send_sprites(uint8_t page);   // a write of $4014
void hardware_read_pads(void);              // sub_C278's reads, which happen when the frame comes
void vblank_interrupt_wanted(uint8_t on);
// a loop that waits for V-blank
void loop_begins(uint8_t instructions);
uint8_t loop_was_interrupted(void);
uint8_t interrupt_runs_ahead(void);         // whether the interrupt that's running is a later frame's than the kit's
void loop_goes_on(void);
void loop_left(void);
// For the check that counts what each interrupt and each turn took against the original's (time.c): it's told when one
// begins and ends, and the game itself is built without it.
#ifdef TIME_CHECK
void time_check(char what, uint8_t which);
#else
#define time_check(what, which) ((void)0)
#endif
// the kit's frames
void time_starts(void);
void start_waited_for_vblank(void);
void frame_begins(void);
uint8_t frame_is_over(void);
void frame_ends(void);

// ---- the tasks (main.c)

// the tasks' numbers, which are also where each one's state is kept from $02
enum { TASK_TITLE = 0x02, TASK_GAME = 0x04, TASK_VIEW = 0x06, TASK_ARTHUR = 0x08, TASK_OBJECTS = 0x0A, TASK_SPRITES = 0x0C, TASK_TILES = 0x0E, TASK_LAST = 0x10 };
#define TASK_NOW RAM[0x00]             // the task that's running, or 0 between rounds
#define TASK_STATE(task) RAM[0x02 + (task)]
enum { TASK_READY = 0x80, TASK_ASLEEP = 0xC0, TASK_FREE = 0x00 };
#define TASK_SLEEP(task) (0x12 + (task))  // how many V-blanks more a sleeping task sleeps, 16 bits
#define FRAMES_SINCE_ROUND RAM[0x4E]   // counted by V-blank, and cleared as a round starts
#define FRAMES_A_ROUND RAM[0xCD]       // a round of the tasks starts once that many V-blanks have passed: 2

// how a task, or a routine of one that takes more than a turn, leaves the processor
typedef enum {
  DONE,    // it didn't: the routine is over, and its caller goes on
  YIELDS,  // sub_C336: the next task runs, and this one goes on in the next round
  SPINS,   // it waits in a loop for V-blank to count a frame, so nothing else runs until then
  ENDS,    // sub_C2FA: the task is over
  SLEEPS,  // sub_C313: the next task runs, and this one once its sleep is over
} wait;

/** Writes $2000, and keeps whether V-blank interrupts. */
void write_ppu_control(uint8_t value);
void vblank_interrupt(void);     // $C0F0
void start_task(uint8_t task);  // sub_C2BC
void stop_task(uint8_t task);   // sub_C303
void stop_game_tasks(void);     // sub_CAD6: the view's, Arthur's and the objects'
wait sleep_task(uint16_t frames);  // sub_C313, which a task returns
/** The step a task's own routine is at, kept for it between turns, and 0 when it's started. */
extern uint8_t task_step[TASK_LAST + 2];

// each task's code, in the file that says what it does
wait title_task(void);    // $C3DC
wait game_task(void);     // $C8C4
wait view_task(void);     // $E68C
wait arthur_task(void);   // $DA71
wait objects_task(void);  // $F367
wait sprites_task(void);  // $F34F
wait tiles_task(void);    // $E569

// ---- the picture (screen.c): what V-blank writes to the PPU is asked for through work memory

#define PPU_CONTROL RAM[0x38]    // what V-blank writes to $2000
#define PPU_MASK RAM[0x39]       // and to $2001: the picture's on with bits 3 and 4
#define SCROLL_X RAM[0x3D]
#define SCROLL_Y RAM[0x3E]
#define ROWS_BUSY RAM[0x4F]      // on while a task adds rows to the list, so V-blank leaves the list alone
#define ROWS_END RAM[0x31]       // where the next row goes in the list at $0720
#define ROWS 0x0720              // the rows to write: for each, the PPU's address, high byte first, a count and that many bytes; $FF ends it
#define COLUMN_READY RAM[0x50]   // on when the column at $07D8 is to be written, down the screen
#define COLUMN 0x07D8
#define WIDE_ROWS_READY RAM[0x51]  // and the rows at $07A6
#define WIDE_ROWS 0x07A6
#define ATTRIBUTES 0x0400        // both name tables' colour attributes, 64 bytes each, which V-blank writes 32 at a time

/** sub_EECF: adds `rows` rows of `count` bytes, from `from`, to the list V-blank writes, the first at the PPU's `to` and each next one 32 further on. */
void queue_rows(uint16_t from, uint16_t to, uint8_t rows, uint8_t count);
void queue_palette(uint16_t from);        // sub_EEBF: all 32 colours
void queue_background_palette(uint16_t from);  // sub_EEBA: the first 16
wait picture_off(void);                   // sub_F171
void picture_on(void);                    // sub_F17A
/** sub_C62C: the picture off, the title's colours, an empty screen, no objects, and the picture on again. A task calls it each turn until it's DONE. */
wait fresh_screen(uint8_t *step);
/** sub_CA2E and $CA37: a name table's 30 rows are cleared two a frame. `begin` sets it up, and then each frame `queue`
 *  leaves two rows for V-blank, which the task waits for, and `done` says whether those were the last. */
void clear_rows_begin(uint8_t second_table);
void clear_rows_queue(void);
int clear_rows_done(void);
/** sub_C0D9: copies `groups` groups of 128 bytes from the cartridge at `from` to the PPU's tiles at `to`, a group a frame. */
wait load_tiles(uint8_t *step, uint16_t from, uint16_t to, uint8_t groups);
void vblank_draws(void);                  // $C0F0 to $C21D: what V-blank writes to the PPU

// ---- the objects (objects.c): up to 25, each a field in every one of these lists

#define OBJECTS 25
#define OBJECT_FLAGS 0x04F0     // bit 7: it's drawn
#define OBJECT_SCREEN_Y 0x0509
#define OBJECT_SHAPE 0x0522
#define OBJECT_COLOURS 0x053B
#define OBJECT_SCREEN_X 0x0554
#define OBJECT_Y_SCREEN 0x056D  // which screen of the stage it's on, down
#define OBJECT_X_SCREEN 0x0583  // and across
#define OBJECT_Y 0x0599
#define OBJECT_X 0x05AF
#define OBJECT_Y_PART 0x05C5    // 256ths of a pixel
#define OBJECT_X_PART 0x05DB
#define OBJECT_HEADING 0x05F1
#define OBJECT_COUNT 0x0607
#define OBJECT_STATE 0x061D
#define OBJECT_KIND 0x0631
#define OBJECT_FLAG_SHOWN 0x80
void place_on_screen(uint8_t object);  // sub_F181
void show_object(uint8_t object);      // sub_F321
void hide_object(uint8_t object);      // sub_F346
int object_in_view(uint8_t object);    // sub_F0A3
/** sub_E3E3: whether the block 11 pixels below an object's place is solid, so it's on the ground. */
int on_the_ground(uint8_t object);
/** sub_DA18: the first of the 16 objects after Arthur that isn't in use, or NO_OBJECT. */
uint8_t free_object(void);
enum { NO_OBJECT = 0x11 };
/** sub_F708: an object is gone. */
void remove_object(uint8_t object);
/** sub_F68E: whether Arthur touches an object, whose half width and half height are in $26 and $27. */
int arthur_touches(uint8_t object);
/** sub_F611: whether one of Arthur's weapons touches an enemy, whose half width and half height are in $26 and $27. */
int weapon_touches(uint8_t weapon, uint8_t enemy);
enum { FIRST_WEAPON = 0x11, WEAPONS = 3, LANCE = 0x23, DAGGER = 0x24, TORCH = 0x25, AXE = 0x26, CROSS = 0x27 };  // the weapons' objects and kinds
#define WEAPON_HELD RAM[0x053A]   // the shape of the weapon Arthur has, which the top of the picture shows
/** sub_F5F9: the first of Arthur's weapons that's flying, hasn't hit anything and touches an enemy, or 0 (enemies.c). */
uint8_t weapon_that_touches(uint8_t enemy);
/** $EB75 and $EB84, kinds $23 and $24: a lance's or a dagger's turn (weapons.c). */
void weapon(uint8_t object);
/** sub_D8FC: adds what's in $26 and $27 to the score, tens and hundreds. `x` and `y` are the processor's registers, which it keeps. */
void add_score(uint8_t x, uint8_t y);
/** sub_D902: the same with thousands and ten thousands, from $24 and $25. */
void add_score_with_thousands(uint8_t x, uint8_t y);
/** $F7BE, kind 0: a zombie's turn (enemies.c). */
void zombie(uint8_t object);
/** Bank 4's $BBEE, kind $12: the pot a zombie carries (enemies.c). */
void pot(uint8_t object);
/** bank 2's $8416: the zombies that come out of the ground. `x` is the processor's X register, which it leaves changed. */
void zombies_come(uint8_t *x);
/** sub_F03E: moves an object by `speed` the way it's heading, one of 16 ways. */
void move_object(uint8_t object, uint8_t speed);
/** $EA55: the block of the stage at the place in $77 and $73, down, and $78 and $74, across. A block from $C6 up is solid. */
uint8_t block_at_stage_place(void);
enum { BLOCK_SOLID = 0xC6 };
#define TILES_FIRST_LIST RAM[0xD5]  // the set of tiles the tiles' task sends first, or $FF for none: $D6 to $D9 are its place
#define SCENE_PLAYING RAM[0xE0]     // on while the opening scene plays
#define PAD_NOW RAM[0xCC]           // the buttons of the player whose turn it is, as the game's task copies them each round

// ---- the buttons, as V-blank reads them: A, B, Select, Start, Up, Down, Left, Right from bit 7 down
#define PAD_1 RAM[0x42]
enum { PAD_START = 0x10, PAD_SELECT = 0x20, PAD_A = 0x80, PAD_B = 0x40, PAD_LEFT = 0x02, PAD_RIGHT = 0x01 };
void read_pads(uint8_t ran_ahead);  // sub_C278, when the kit's frame comes: `ran_ahead` if its time was counted before that

// ---- the sound (sound.c)
void sound_reset(void);        // sub_ED72
void sound_registers_off(void);  // sub_ED97
void sound_play(uint8_t number);  // sub_ED51
void sound_frame(void);        // sub_ED94, each V-blank

#endif
