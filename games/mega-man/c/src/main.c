// Mega Man Dreamport: the game in C, on the NES kit in C (kit/nes/c/).
//
// Each part of it does what the original's code at the address in its comment does, written from what that code does on
// the console. Each names the original's function as the port map reads it: sub_ and the address, for one in the last
// bank, which is always at $C000, or sub_, the bank switched in at $8000 as two digits, _ and the address. It keeps its
// variables in the console's work memory where the original keeps them, and reads its tiles, screens and colours from
// the player's copy as it runs. So far it has the power-on and the title screen, which waits for Start.
//
// The original times its own code: it waits for V-blank by reading $2002, and loads its tiles with the picture off
// for frames on end, so when each write lands depends on how many of the CPU's cycles the code before it takes. The C
// counts them as the original's instructions take them (the numbers in RUN), so each write happens at the dot of the
// frame the original's does.

#include "nes.h"

// The original's variables in work memory
#define POINTER 0x04      // $04-$05: where a copy reads from
#define COUNT 0x0C        // how many are left of what a loop does
#define INDEX 0x0D        // where in a list a loop is
#define HELD 0x14         // $14-$15: each controller's buttons held, A in bit 0 and Start in bit 3
#define BEFORE 0x16       // $16-$17: those held the frame before
#define PRESSED 0x18      // $18-$19: those pressed this frame
#define SCROLL_X 0x1A
#define NAME_TABLE 0x1B   // which name table the screen starts in
#define SCROLL_Y 0x1E
#define FRAME_DONE 0x1F   // set by the V-blank interrupt, which the main loop waits for
#define FRAMES 0x23       // counts the frames
#define STAGE 0x31        // the stage, or 10 for the title screen
#define PALETTE 0x35      // $35-$36: where the stage's colours are
#define BANK 0x42         // the program bank the main code wants, which the interrupt puts back
#define RANDOM 0x46
#define SAVED_STAGE 0xAC
#define MASK 0xFE         // what the original last wrote to $2001
#define CONTROL 0xFF      // and to $2000
#define SPRITES 0x0200    // the 64 sprites, which the interrupt copies to the PPU each frame
#define COLOURS 0x03D0    // a copy of the stage's colours
#define CHANNELS 0x0500   // the sound driver's four channels, 31 bytes each

#define RAM(address) nes_ram[address]

// With the V-blank interrupt off, start_up() runs straight across frames, touching only work memory and the PPU.
// game_start() runs it once as plain C to record each PPU access at its frame and dot, and game_step() replays each
// frame's accesses until the interrupt takes over.
#define MAX_BOOT_OPS 16384
#define VBLANK_CLEAR_DOT 7161

typedef struct {
  int32_t dot;
  uint8_t frame;
  uint8_t reg;
  uint8_t value;
  uint8_t is_read;
} BootOp;

static BootOp boot_ops[MAX_BOOT_OPS];
static int boot_count, boot_at, boot_frame, boot_end_frame, boot_end_clock;
static int boot_recording, boot_vblank_ready, booting;

// The original CPU's time in this frame, in the PPU's dots: 3 to a cycle.
static int clock;

static void run(int cycles) {
  clock += 3 * cycles;
  if (boot_recording) {
    int length = nes_frame_length(boot_frame);
    while (clock >= length) {
      clock -= length;
      boot_frame++;
      boot_vblank_ready = boot_frame >= 1;
      length = nes_frame_length(boot_frame);
    }
    if (clock >= VBLANK_CLEAR_DOT) boot_vblank_ready = 0;
  }
}

#define RUN(cycles) run(cycles)

static void record_boot_op(uint16_t address, uint8_t value, uint8_t is_read) {
  if (boot_count >= MAX_BOOT_OPS) return;
  boot_ops[boot_count].dot = clock;
  boot_ops[boot_count].frame = (uint8_t)boot_frame;
  boot_ops[boot_count].reg = (uint8_t)(address & 7);
  boot_ops[boot_count].value = value;
  boot_ops[boot_count].is_read = is_read;
  boot_count++;
}

// The 16 KB of program at $8000-$BFFF: the cartridge switches it with a write, and keeps its last at $C000-$FFFF.
static int bank;

static uint8_t rom(uint16_t address) {
  uint32_t which = address >= 0xC000 ? nes_prg_size / 0x4000 - 1 : (uint32_t)bank;
  return nes_prg[which * 0x4000 + (address & 0x3FFF)];
}

// Whether reading `index` on from `base` crosses into the next page, which takes the CPU a cycle more.
static int crosses(uint16_t base, int index) { return (base & 0xFF) + index > 0xFF; }

// The kit's frame moves on to the original's time. A write the original makes before the step starts, at the top of
// a frame where it was still busy with the last, happens as the step starts: with the picture off, nothing shows it.
static void catch_up(void) {
  int now = nes_now();
  if (clock > now) nes_spend((clock - now + 2) / 3);
}

// A store taking `cycles`, which writes in its last. Writing $4014 copies the sprites and halts the CPU for 513 cycles.
static void store(int cycles, uint16_t address, uint8_t value) {
  RUN(cycles - 1);
  if (boot_recording) {
    record_boot_op(address, value, 0);
  } else {
    catch_up();
    nes_write(address, value);
    if (address == 0x4014) RUN(513);
  }
  RUN(1);
}

// A load taking `cycles`, which reads in its last.
static uint8_t load(int cycles, uint16_t address) {
  RUN(cycles - 1);
  catch_up();
  uint8_t value = nes_read(address);
  RUN(1);
  return value;
}

// $2002's V-blank flag, read by the original's loop that waits for it. It can't have gone on before its dot.
static int vblank(void) {
  RUN(3);
  int on = 0;
  if (clock >= NES_VBLANK_DOT) {
    if (boot_recording) {
      if (boot_vblank_ready) {
        record_boot_op(0x2002, 0, 1);
        boot_vblank_ready = 0;
        on = 0x80;
      }
    } else {
      catch_up();
      on = nes_read(0x2002) & 0x80;
    }
  }
  RUN(1);
  return on;
}

// sub_C39C: switches to the stage's bank of program, and keeps it in $42. The stages from 6 on, and the title screen,
// use bank n - 6.
static void stage_bank(void) {
  RUN(6 + 3 + 3 + 2 + 3 + 3 + 2);   // jsr, php, pha, txa, pha, lda $31, cmp #6
  int which = RAM(STAGE);
  if (which < 6) RUN(3);            // bcc
  else {
    RUN(2 + 2);                     // bcc, sbc #6
    which -= 6;
  }
  RAM(BANK) = (uint8_t)which;
  RUN(2 + 3 + 5);                   // tax, sta $42, sta $C000,x
  bank = which;
  RUN(4 + 2 + 4 + 4 + 6);           // pla, tax, pla, plp, rts
}

// sub_C3B3: switches back to bank 5, where the main code is.
static void main_bank(void) {
  RUN(3 + 3 + 2);                   // php, pha, lda #5
  RAM(BANK) = 5;
  RUN(3 + 4);                       // sta $42, sta $C005
  bank = 5;
  RUN(4 + 4 + 6);                   // pla, plp, rts
}

// sub_C7AE: points $04-$05 at the tiles a byte of the tile list names, and switches to their bank: the top six bits are
// the page in $8000-$BFFF, the bottom two the bank.
static void tiles_at(uint8_t where) {
  RUN(6 + 3 + 2 + 2 + 2 + 2);       // jsr, pha, and #$FC, lsr, lsr, ora #$80
  RAM(POINTER + 1) = (uint8_t)(((where & 0xFC) >> 2) | 0x80);
  RUN(3 + 2);                       // sta $05, lda #0
  RAM(POINTER) = 0;
  RUN(3 + 4 + 2 + 2);               // sta $04, pla, and #3, tay
  RAM(BANK) = where & 3;
  RUN(3 + 5);                       // sta $42, sta $C000,y
  bank = where & 3;
  RUN(6);                           // rts
}

// sub_D647: writes `count` of the colours at ($35) to the PPU's palette, from the start (or from the sprites' colours,
// with bit 3 set), and points the PPU back at $3F00 and then $0000.
static void write_colours(uint8_t count) {
  RUN(6 + 3 + 2 + 2 + 2);                   // jsr, pha, and #$F0, tax, lda #$3F
  int left = count & 0xF0;
  store(4, 0x2006, 0x3F);
  RUN(4 + 2 + 2);                           // pla, asl, and #$10
  store(4, 0x2006, (uint8_t)((count << 1) & 0x10));
  RUN(2);                                   // ldy #0
  uint16_t from = (uint16_t)(RAM(PALETTE) | RAM(PALETTE + 1) << 8);
  for (int i = 0; left > 0; i++, left--) {
    RUN(5);                                 // lda ($35),y
    store(4, 0x2007, rom((uint16_t)(from + i)));
    RUN(2 + 2 + (left > 1 ? 3 : 2));        // iny, dex, bne
  }
  RUN(2);                                   // lda #$3F
  store(4, 0x2006, 0x3F);
  store(4, 0x2006, 0);
  store(4, 0x2006, 0);
  store(4, 0x2006, 0);
  RAM(0x34) = 0;
  RUN(3 + 6);                               // stx $34, rts
}

// sub_D478: hides `count` sprites from `first`, by putting them below the screen.
static void hide_sprites(int first, int count) {
  RUN(6 + 2);                               // jsr, lda #$F8
  for (int y = first; count > 0; count--, y += 4) {
    RAM(SPRITES + (y & 0xFF)) = 0xF8;
    RUN(5 + 2 + 2 + 2 + 2 + 2 + (count > 1 ? 3 : 2));  // sta $0200,y, iny four times, dex, bne
  }
  RUN(6);                                   // rts
}

// sub_D58D: reads both controllers, the second first, a bit at a time, into $14-$15. A bit counts from either of the
// two lines a Famicom's expansion port adds.
static void read_controllers(void) {
  RUN(6 + 2);                               // jsr, ldx #1
  store(4, 0x4016, 1);
  RUN(2);                                   // dex
  store(4, 0x4016, 0);
  RUN(2);                                   // inx
  for (int x = 1; x >= 0; x--) {
    RUN(2);                                 // ldy #8
    for (int y = 8; y > 0; y--) {
      uint8_t value = load(4, (uint16_t)(0x4016 + x));
      RAM(PRESSED) = value;
      RUN(3 + 2 + 3 + 2);                   // sta $18, lsr, ora $18, lsr
      int bit = (value | value >> 1) & 1;
      RAM(HELD + x) = (uint8_t)(RAM(HELD + x) >> 1 | bit << 7);
      RUN(6 + 2 + (y > 1 ? 3 : 2));         // ror $14,x, dey, bne
    }
    RUN(2 + (x > 0 ? 3 : 2));               // dex, bpl
  }
  RUN(6);                                   // rts
}

// sub_C01B, up to its wait: keeps the buttons held, and clears $1F for the V-blank interrupt to set.
static void frame_wait(void) {
  RUN(6 + 3 + 2);                           // jsr, lda $95, bne
  RAM(BEFORE) = RAM(HELD);
  RAM(BEFORE + 1) = RAM(HELD + 1);
  RUN(3 + 3 + 3 + 3);                       // lda $14, sta $16, lda $15, sta $17
  RAM(FRAME_DONE) = 0;
  RUN(2 + 3);                               // lda #0, sta $1F
}

// $C02B on: once the interrupt has set $1F, reads the controllers and works out which buttons were just pressed.
static void frame_waited(void) {
  RUN(3 + 2);                               // lda $1F, beq
  RUN(3 + 3);                               // lda $68, beq
  RUN(3 + 2 + 2 + 3 + 2 + 3);               // lda $95, bne, tya, pha, txa, pha
  read_controllers();
  RUN(4 + 2 + 4 + 2);                       // pla, tax, pla, tay
  for (int pad = 0; pad < 2; pad++) {
    RAM(PRESSED + pad) = (RAM(HELD + pad) ^ RAM(BEFORE + pad)) & RAM(HELD + pad);
    RUN(3 + 3 + 3 + 3);                     // lda, eor, and, sta
  }
  RUN(6);                                   // rts
}

// sub_04_922A: quiets channel `channel`, 4 down to 1, by writing 0 to its timer's two registers at `reg`. For the last it
// turns the pulses and the triangle on at $4015 instead.
static void quiet(int channel, uint16_t reg) {
  RUN(6 + 2);                               // jsr, cpy #1
  if (channel == 1) {
    RUN(3 + 2);                             // beq, lda #7
    store(4, 0x4015, 0x07);
  } else {
    RUN(2 + 2);                             // beq, lda #0
    store(5, reg, 0);
    RUN(2);                                 // inx
    store(5, (uint16_t)(reg + 1), 0);
    RUN(2);                                 // dex
  }
  RUN(6);                                   // rts
}

// sub_04_923F, the sound driver in bank 4, which the interrupt runs each frame. On the title screen nothing plays: each
// channel's two timers count on, and it's kept quiet. Gives the carry its last shift leaves, which the interrupt's
// random number takes.
static int sound(void) {
  RUN(3);                                   // jmp $923F
  RAM(0xEA)++;
  RUN(5 + 3 + 3);                           // inc $EA, lda $E4, beq
  RAM(0xEC) = 0;
  RAM(0xED) = CHANNELS >> 8;
  RAM(0xEB) = 0;
  RAM(0xEE) = 4;
  RUN(2 + 2 + 3 + 3 + 2 + 3 + 2 + 3);       // ldx #0, ldy #5, stx $EC, sty $ED, lda #0, sta $EB, lda #4, sta $EE
  for (;;) {
    uint16_t channel = (uint16_t)(RAM(0xEC) | RAM(0xED) << 8);
    RAM(channel + 0x18)++;
    RUN(2 + 2 + 2 + 5 + 6);                 // lda #1, ldy #$18, clc, adc ($EC),y, sta ($EC),y
    RAM(channel + 0x1D)++;
    RUN(2 + 2 + 2 + 5 + 6);                 // the same at $1D
    RUN(3 + 2 + 3);                         // lda $EF, lsr, bcc
    RUN(3 + 2 + 3);                         // lda $41, lsr, bcc
    RUN(2 + 5 + 2 + 5 + 3);                 // ldy #0, lda ($EC),y, iny, ora ($EC),y, beq: it plays nothing
    RUN(3 + 2 + 2 + 3 + 2 + 2 + 3);         // lda $EF, lsr, bcs, ldx $EB, inx, inx, ldy $EE
    quiet(RAM(0xEE), (uint16_t)(0x4000 + RAM(0xEB) + 2));
    RAM(0xEF) >>= 1;
    RUN(5 + 3);                             // lsr $EF, bcc
    RAM(0xEE)--;
    if (RAM(0xEE) == 0) {
      RUN(5 + 3);                           // dec $EE, beq
      break;
    }
    RUN(5 + 2);                             // dec $EE, beq
    RAM(0xEB) += 4;
    int sum = RAM(0xEC) + 0x1F;
    RAM(0xEC) = (uint8_t)sum;
    RAM(0xED) = (uint8_t)(RAM(0xED) + (sum >> 8));
    RUN(2 + 2 + 3 + 3 + 2 + 2 + 3 + 3 + 2 + 3 + 3 + 3);  // $EB += 4, $EC-$ED += 31, jmp $9256
  }
  RUN(3 + 2 + 3 + 3 + 3);                   // lda $E8, and #$7F, beq, lda $F2, beq
  int carry = 0;
  for (int i = 0; i < 4; i++) {
    carry = RAM(0xEF) & 1;
    RAM(0xEF) >>= 1;
    RUN(5);                                 // lsr $EF
  }
  RUN(6);                                   // rts
  return carry;
}

// sub_D4A8, the V-blank interrupt: with the picture off, copies the sprites to the PPU, sets the scroll and turns the
// picture on, sets $1F for the main loop, runs the sound driver and makes the next random number.
static void vblank_interrupt(void) {
  RUN(3 + 2 + 3 + 2 + 3 + 3 + 3);           // pha, txa, pha, tya, pha, lda $1F, beq: the main loop had finished
  RUN(6 + 3 + 2);                           // jsr $D495, lda $FF, and #$7F
  RAM(CONTROL) &= 0x7F;
  RUN(3);                                   // sta $FF
  store(4, 0x2000, RAM(CONTROL));
  RUN(3 + 2);                               // lda $FE, and #$E7
  RAM(MASK) &= 0xE7;
  RUN(3);                                   // sta $FE
  store(4, 0x2001, RAM(MASK));
  RUN(6);                                   // rts
  load(4, 0x2002);
  RUN(2);                                   // lda #0
  store(4, 0x2003, 0);
  RUN(2);                                   // lda #2
  store(4, 0x4014, SPRITES >> 8);
  RUN(6 + 3 + 2 + 3 + 3 + 2);               // jsr $D673, lda $1C, bne, jmp $D6FD, lda $FF, and #$FB
  RAM(CONTROL) &= 0xFB;
  RUN(3);                                   // sta $FF
  store(4, 0x2000, RAM(CONTROL));
  RUN(6);                                   // rts
  RUN(3 + 3 + 3 + 3);                       // lda $37, beq, lda $5E, beq
  RUN(3 + 3 + 3 + 3 + 3 + 3);               // lda $1B, pha, lda $1A, pha, lda $B4, beq
  RUN(3 + 2);                               // lda $FF, and #$FC
  RAM(CONTROL) &= 0xFC;
  RUN(3 + 3 + 2 + 3);                       // sta $FF, lda $1B, and #1, ora $FF
  uint8_t control = (uint8_t)((RAM(NAME_TABLE) & 1) | RAM(CONTROL));
  store(4, 0x2000, control);
  RUN(3);                                   // pha
  load(4, 0x2002);
  RUN(2 + 3 + 3);                           // ldx #4, lda $47, beq
  RUN(2 + 3 + 4);                           // clc, lda $1A, adc $D583,x
  store(4, 0x2005, (uint8_t)(RAM(SCROLL_X) + rom(0xD583 + 4)));
  RUN(2 + 3 + 4);                           // clc, lda $1E, adc $D588,x
  store(4, 0x2005, (uint8_t)(RAM(SCROLL_Y) + rom(0xD588 + 4)));
  RUN(3 + 2);                               // lda $FE, ora #$1E
  RAM(MASK) |= 0x1E;
  RUN(3);                                   // sta $FE
  store(4, 0x2001, RAM(MASK));
  RUN(4 + 2);                               // pla, ora #$80
  RAM(CONTROL) = control | 0x80;
  RUN(3);                                   // sta $FF
  store(4, 0x2000, RAM(CONTROL));
  RUN(4 + 3 + 4 + 3);                       // pla, sta $1A, pla, sta $1B
  RAM(FRAME_DONE) = 1;
  RAM(FRAMES)++;
  RUN(2 + 3 + 5 + 2 + 4);                   // lda #1, sta $1F, inc $23, lda #4, sta $C004
  bank = 4;
  RUN(6);                                   // jsr $9000
  int carry = sound();
  RUN(3 + 3 + 3 + 2 + 5);                   // ldx $45, beq, lda $42, tax, sta $C000,x
  bank = RAM(BANK);
  RUN(3 + 3 + 3);                           // lda $0D, eor $46, adc $23
  RAM(RANDOM) = (uint8_t)(((RAM(INDEX) ^ RAM(RANDOM)) + RAM(FRAMES) + carry) & 0xFF) >> 1;
  RUN(2 + 3 + 4 + 2 + 4 + 2 + 4 + 6);       // lsr, sta $46, pla, tay, pla, tax, pla, rti
}

// $9003: waits for two V-blanks, each by reading $2002 until its top bit is on, then until it's off.
static void wait_vblanks(void) {
  for (int waits = 2; waits > 0; waits--) {
    for (;;) {
      int on = vblank();
      RUN(on ? 2 : 3);                      // bpl
      if (on) break;
    }
    for (;;) {
      int on = vblank();
      RUN(on ? 3 : 2);                      // bmi
      if (!on) break;
    }
    RUN(2 + (waits > 1 ? 3 : 2));           // dex, bpl
  }
}

// $9012: clears the work memory, the first page and then the other seven, and sets the initial PPU shadows and stage.
static void clear_work_memory(void) {
  for (int x = 0; x < 0x800; x++) RAM(x) = 0;
  RAM(POINTER + 1) = 8;
  RUN(2 + 2 + 2);                           // txs, lda #0, ldy #0
  RUN(256 * (5 + 2 + 3) - 1);               // sta $0000,y, iny, bne
  RUN(2 + 3);                               // lda #1, sta $05
  RUN(7 * (2 + 256 * (6 + 2 + 3) - 1 + 5 + 3 + 2 + 3) - 1);  // lda #0, sta ($04),y, iny, bne, inc $05, lda, cmp, bne
  RAM(CONTROL) = 0x10;
  RAM(MASK) = 0x06;
  RAM(SAVED_STAGE) = RAM(STAGE);
  RAM(STAGE) = 10;
  RUN(2 + 3 + 2 + 3 + 3 + 3 + 2 + 3);       // $FF = $10, $FE = 6, $AC = $31, $31 = 10
}

// sub_C75B: loads the stage's tiles into the cartridge's tile memory, from the list at $8D20: its first byte is how
// many runs it has, and each run is where it starts (tiles_at) and how many pages.
static void load_stage_tiles(void) {
  RUN(6);                                   // jsr $C75B
  stage_bank();
  RUN(3 + 2 + 2);                           // lda $31, cmp #6, bcc
  RAM(COUNT) = rom(0x8D20);
  RUN(4 + 3 + 3 + 2);                       // lda $8D20, bne, sta $0C, lda #0
  store(4, 0x2006, 0);
  store(4, 0x2006, 0);
  RAM(INDEX) = 0;
  RUN(3);                                   // sta $0D
  do {
    stage_bank();
    int y = RAM(INDEX);
    RUN(3 + 3 + 2 + 2);                     // ldy $0D, lda $31, cmp #6, bcc
    int x = rom((uint16_t)(0x8D21 + y));
    int pages = rom((uint16_t)(0x8D22 + y));
    RUN(4 + crosses(0x8D21, y) + 4 + crosses(0x8D22, y) + 3);  // lda $8D21,y, ldx $8D22,y, bne
    tiles_at((uint8_t)x);
    for (; pages > 0; pages--) {
      RUN(2);                               // ldy #0
      uint16_t from = (uint16_t)(RAM(POINTER) | RAM(POINTER + 1) << 8);
      for (int i = 0; i < 256; i++) {
        RUN(5);                             // lda ($04),y
        store(4, 0x2007, rom((uint16_t)(from + i)));
        RUN(2 + (i < 255 ? 3 : 2));         // iny, bne
      }
      RAM(POINTER + 1)++;
      RUN(5 + 2 + (pages > 1 ? 3 : 2));     // inc $05, dex, bne
    }
    RAM(INDEX) += 2;
    RAM(COUNT)--;
    RUN(5 + 5 + 5 + (RAM(COUNT) ? 3 : 2));  // inc $0D twice, dec $0C, bne
  } while (RAM(COUNT));
  RUN(3);                                   // jmp $C3B3
  main_bank();
}

// sub_C483: the stage's colours, from $8CD0 for the title screen: to the PPU, and 48 bytes to $03D0, then the list at
// $8E9F, whose second byte n says how many: 6n + 1 bytes from it to $0720.
static void load_stage_colours(void) {
  RUN(6);                                   // jsr $C483
  stage_bank();
  RUN(3 + 2 + 2 + 2);                       // lda $31, cmp #6, bcc, lda #$D0
  RAM(PALETTE) = 0xD0;
  RAM(PALETTE + 1) = 0x8C;
  RUN(3 + 2 + 3 + 3 + 2);                   // sta $35, lda #$8C, sta $36, jmp $C49F, lda #$20
  write_colours(0x20);
  RUN(2);                                   // ldy #$2F
  uint16_t from = (uint16_t)(RAM(PALETTE) | RAM(PALETTE + 1) << 8);
  for (int y = 0x2F; y >= 0; y--) {
    RAM(COLOURS + y) = rom((uint16_t)(from + y));
    RUN(5 + crosses(from, y) + 5 + 2 + (y > 0 ? 3 : 2));  // lda ($35),y, sta $03D0,y, dey, bpl
  }
  RAM(POINTER) = 0x9F;
  RAM(POINTER + 1) = 0x8E;
  RUN(3 + 2 + 2 + 2 + 3 + 2 + 3 + 3);       // lda $31, cmp #6, bcc, lda #$9F, sta $04, lda #$8E, sta $05, bne
  from = 0x8E9F;
  RAM(0x0720) = (uint8_t)(rom((uint16_t)(from + 1)) << 1);
  int count = (uint8_t)(RAM(0x0720) << 1) + RAM(0x0720);
  RUN(2 + 5 + crosses(from, 1) + 2 + 4 + 2 + 2 + 4 + 2 + 2);  // ldy #1, lda ($04),y, asl, sta, asl, clc, adc, tay, iny
  for (int y = (uint8_t)(count + 1); y > 0; y--) {
    RAM(0x071F + y) = rom((uint16_t)(from + y));
    RUN(5 + crosses(from, y) + 5 + 2 + (y > 1 ? 3 : 2));  // lda ($04),y, sta $071F,y, dey, bne
  }
  RUN(3);                                   // jmp $C3B3
  main_bank();
}

// sub_F956: the title screen. Its background tile everywhere, the attributes from $8EC7, the logo's seven rows of tiles
// in order, two tiles on their own, and four lines of words from the list at $8EE4.
static void draw_title_screen(void) {
  RUN(6);                                   // jsr $F956
  stage_bank();
  RUN(2);                                   // lda #$20
  store(4, 0x2006, 0x20);
  RUN(2);                                   // lda #0
  store(4, 0x2006, 0x00);
  RUN(2 + 2 + 3 + 3);                       // ldx #$0E, lda #$7F, ldy $A6, bpl
  for (int rows = 15; rows > 0; rows--) {
    RUN(2);                                 // ldy #$40
    for (int left = 64; left > 0; left--) {
      store(4, 0x2007, 0x7F);
      RUN(2 + (left > 1 ? 3 : 2));          // dey, bne
    }
    RUN(2 + (rows > 1 ? 3 : 2));            // dex, bpl
  }
  RUN(3 + 3 + 2);                           // lda $A6, bpl, ldx #7
  for (int x = 7; x >= 0; x--) {
    RUN(2);                                 // ldy #8
    for (int left = 8; left > 0; left--) {
      RUN(4);                               // lda $8EC7,x
      store(4, 0x2007, rom((uint16_t)(0x8EC7 + x)));
      RUN(2 + (left > 1 ? 3 : 2));          // dey, bne
    }
    RUN(2 + (x > 0 ? 3 : 2));               // dex, bpl
  }
  RUN(2);                                   // ldx #6
  for (int tile = 0, x = 6; x >= 0; x--) {
    RUN(4);                                 // lda $8ECF,x
    store(4, 0x2006, rom((uint16_t)(0x8ECF + x)));
    RUN(4);                                 // lda $8ED6,x
    store(4, 0x2006, rom((uint16_t)(0x8ED6 + x)));
    RAM(COUNT) = (uint8_t)x;
    RUN(3 + 4 + 2);                         // stx $0C, lda $8EDD,x, tax
    for (int left = rom((uint16_t)(0x8EDD + x)); left > 0; left--) {
      store(4, 0x2007, (uint8_t)tile);
      tile++;
      RUN(2 + 2 + (left > 1 ? 3 : 2));      // iny, dex, bne
    }
    RUN(3 + 2 + (x > 0 ? 3 : 2));           // ldx $0C, dex, bpl
  }
  RUN(2);                                   // lda #$23
  store(4, 0x2006, 0x23);
  RUN(2);                                   // lda #$DE
  store(4, 0x2006, 0xDE);
  RUN(2);                                   // lda #$A0
  store(4, 0x2007, 0xA0);
  RUN(2);                                   // lda #$21
  store(4, 0x2006, 0x21);
  RUN(2);                                   // lda #$D9
  store(4, 0x2006, 0xD9);
  RUN(2);                                   // lda #$94
  store(4, 0x2007, 0x94);
  RUN(2);                                   // lda #$8D
  store(4, 0x2007, 0x8D);
  RAM(COUNT) = 4;
  RUN(2 + 2 + 3);                           // inx, lda #4, sta $0C
  for (int x = 0; RAM(COUNT) > 0;) {
    RUN(4 + crosses(0x8EE4, x));            // lda $8EE4,x
    store(4, 0x2006, rom((uint16_t)(0x8EE4 + x)));
    x++;
    RUN(2 + 4 + crosses(0x8EE4, x));        // inx, lda $8EE4,x
    store(4, 0x2006, rom((uint16_t)(0x8EE4 + x)));
    x++;
    RUN(2 + 4 + crosses(0x8EE4, x) + 2);    // inx, ldy $8EE4,x, inx
    int left = rom((uint16_t)(0x8EE4 + x));
    x++;
    for (; left > 0; left--) {
      RUN(4 + crosses(0x8EE4, x));          // lda $8EE4,x
      store(4, 0x2007, rom((uint16_t)(0x8EE4 + x)));
      x++;
      RUN(2 + 2 + (left > 1 ? 3 : 2));      // inx, dey, bne
    }
    RAM(COUNT)--;
    RUN(5 + (RAM(COUNT) ? 3 : 2));          // dec $0C, bne
  }
  RAM(0xBC) = 0;
  RUN(2 + 3 + 2);                           // ldy #0, sty $BC, ldx #$40
  hide_sprites(0, 64);
  RUN(3 + 2);                               // lda $FF, ora #$80
  RAM(CONTROL) |= 0x80;
  RUN(3);                                   // sta $FF
  store(4, 0x2000, RAM(CONTROL));
  RUN(3 + 2);                               // lda $A6, bmi
}

// sub_05_9000, where the reset goes, in bank 5: waits for the PPU, clears the work memory, loads the title screen's
// tiles, colours and screen, turns the V-blank interrupt on, and begins waiting at $FA0D.
static void start_up(void) {
  wait_vblanks();
  clear_work_memory();
  load_stage_tiles();
  load_stage_colours();
  draw_title_screen();
  frame_wait();
}

void game_start(void) {
  // sub_C008, the reset, 7 cycles after power-on: the interrupt off, the picture off, and on to $9000 in bank 5
  boot_recording = 0;
  boot_count = 0;
  boot_at = 0;
  boot_frame = 0;
  boot_vblank_ready = 0;
  clock = 21;
  RUN(2 + 2);                               // sei, lda #1
  store(4, 0x2000, 0x01);
  RUN(2);                                   // lda #6
  store(4, 0x2001, 0x06);
  RUN(2 + 4);                               // lda #5, sta $C005
  bank = 5;
  RUN(3 + 2 + 2 + 2);                       // jmp $9000, ldx #$FF, txs, ldx #1
  clock -= nes_frame_length(-1);
  boot_recording = 1;
  start_up();
  boot_recording = 0;
  boot_end_frame = boot_frame;
  boot_end_clock = clock;
  booting = 1;
}

void game_step(uint32_t buttons) {
  (void)buttons;  // the controllers are read through $4016
  if (booting) {
    int current = (int)nes_frame();
    while (boot_at < boot_count && boot_ops[boot_at].frame == (uint8_t)current) {
      const BootOp *op = &boot_ops[boot_at++];
      clock = op->dot;
      catch_up();
      uint16_t address = (uint16_t)(0x2000 | op->reg);
      if (op->is_read) nes_read(address);
      else nes_write(address, op->value);
    }
    if (current >= boot_end_frame) {
      clock = boot_end_clock;
      booting = 0;
    }
    return;
  }
  // a frame of the title screen. The main loop waits at $C02B with lda $1F and beq, 9 dots each, and the interrupt
  // comes in once the one it's in when the PPU asks is done
  clock -= nes_frame_length((int)nes_frame() - 1);
  int waited = 0;
  for (; clock < NES_NMI_DOT; waited++) RUN(3);
  RUN(7);
  vblank_interrupt();
  // back from it, a beq it came in before goes round once more
  if (waited & 1) RUN(3);
  frame_waited();
  // $FA10: Start, alone, leaves the title screen, which the next part ports. Until then the title waits.
  RUN(3 + 2 + 3);                           // lda $14, cmp #8, bne
  frame_wait();
}
