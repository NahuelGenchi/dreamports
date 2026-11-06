// Mega Man Dreamport: the game in C, on the NES kit in C (kit/nes/c/).
//
// Each part of it does what the original's code at the address in its comment does, written from what that code does
// on the console. It keeps its variables in the console's work memory where the original keeps them, and reads its
// tiles, screens and colours from the player's copy as it runs. So far it has the power-on and the title screen, which
// waits for Start.
//
// The original times its own code: it waits for V-blank by reading $2002, and loads its tiles with the picture off
// for frames on end, so when each write lands depends on how many of the CPU's cycles the code before it takes. The C
// counts them as the original's instructions take them (the numbers in RUN and TIME), so each write happens at the
// dot of the frame the original's does.

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

// The original CPU's time in this frame, in the PPU's dots: 3 to a cycle.
static int clock;
#define RUN(cycles) (clock += 3 * (cycles))

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

// A store taking `cycles`, which writes in its last.
static void store(int cycles, uint16_t address, uint8_t value) {
  RUN(cycles - 1);
  catch_up();
  nes_write(address, value);
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
    catch_up();
    on = nes_read(0x2002) & 0x80;
  }
  RUN(1);
  return on;
}

// $C39C: switches to the stage's bank of program, and keeps it in $42. The stages from 6 on, and the title screen,
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

// $C3B3: switches back to bank 5, where the main code is.
static void main_bank(void) {
  RUN(3 + 3 + 2);                   // php, pha, lda #5
  RAM(BANK) = 5;
  RUN(3 + 4);                       // sta $42, sta $C005
  bank = 5;
  RUN(4 + 4 + 6);                   // pla, plp, rts
}

// $C7AE: points $04-$05 at the tiles a byte of the tile list names, and switches to their bank: the top six bits are
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

// $D647: writes `count` of the colours at ($35) to the PPU's palette, from the start (or from the sprites' colours,
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

// $D478: hides `count` sprites from `first`, by putting them below the screen.
static void hide_sprites(int first, int count) {
  RUN(6 + 2);                               // jsr, lda #$F8
  for (int y = first; count > 0; count--, y += 4) {
    RAM(SPRITES + (y & 0xFF)) = 0xF8;
    RUN(5 + 2 + 2 + 2 + 2 + 2 + (count > 1 ? 3 : 2));  // sta $0200,y, iny four times, dex, bne
  }
  RUN(6);                                   // rts
}

// $D58D: reads both controllers, the second first, a bit at a time, into $14-$15. A bit counts from either of the
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

// $C01B, up to its wait: keeps the buttons held, and clears $1F for the V-blank interrupt to set.
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

// $922A: quiets channel `channel`, 4 down to 1, by writing 0 to its timer's two registers at `reg`. For the last it
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

// $923F, the sound driver in bank 4, which the interrupt runs each frame. On the title screen nothing plays: each
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

// $D4A8, the V-blank interrupt: with the picture off, copies the sprites to the PPU, sets the scroll and turns the
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
  RUN(513);                                 // the copy holds the CPU
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

// Where start_up() is: it runs on across frames, as the original's code does with the V-blank interrupt off, and each
// step goes on from where the last stopped. 0 before it starts, and -1 once the interrupt runs the frames.
static int resume;
// Moves start_up()'s time on, and ends the step where the frame ends, to go on from here in the next.
#define TIME_AT(at, cycles)                                          \
  do {                                                               \
    RUN(cycles);                                                     \
    while (clock >= nes_frame_length((int)nes_frame())) {            \
      resume = (at) + 1;                                             \
      return;                                                        \
      case (at) + 1:;                                                \
    }                                                                \
  } while (0)
#define TIME(cycles) TIME_AT(__COUNTER__, cycles)
// A store in start_up(), which writes in its last cycle.
#define PUT(cycles, address, value) \
  do {                              \
    TIME((cycles) - 1);             \
    catch_up();                     \
    nes_write(address, value);      \
    TIME(1);                        \
  } while (0)

// From $9000 in bank 5, where the reset goes: waits for the PPU, clears the work memory, loads the title screen's
// tiles, colours and screen, and turns the V-blank interrupt on.
static void start_up(void) {
  static int waits, on, pages, left, rows, x, y;
  static uint16_t from;
  switch (resume) {
    case 0:
      // $9003: waits for two V-blanks, each by reading $2002 until its top bit is on, then until it's off
      for (waits = 2; waits > 0; waits--) {
        for (;;) {
          on = vblank();
          TIME(on ? 2 : 3);                 // bpl
          if (on) break;
        }
        for (;;) {
          on = vblank();
          TIME(on ? 3 : 2);                 // bmi
          if (!on) break;
        }
        TIME(2 + (waits > 1 ? 3 : 2));      // dex, bpl
      }
      // $9012: clears the work memory, the first page and then the other seven
      for (x = 0; x < 0x800; x++) RAM(x) = 0;
      RAM(POINTER + 1) = 8;
      TIME(2 + 2 + 2);                      // txs, lda #0, ldy #0
      TIME(256 * (5 + 2 + 3) - 1);          // sta $0000,y, iny, bne
      TIME(2 + 3);                          // lda #1, sta $05
      TIME(7 * (2 + 256 * (6 + 2 + 3) - 1 + 5 + 3 + 2 + 3) - 1);  // lda #0, sta ($04),y, iny, bne, inc $05, lda, cmp, bne
      RAM(CONTROL) = 0x10;
      RAM(MASK) = 0x06;
      RAM(SAVED_STAGE) = RAM(STAGE);
      RAM(STAGE) = 10;
      TIME(2 + 3 + 2 + 3 + 3 + 3 + 2 + 3);  // $FF = $10, $FE = 6, $AC = $31, $31 = 10

      // $C75B: loads the stage's tiles into the cartridge's tile memory, from the list at $8D20: its first byte is
      // how many runs it has, and each run is where it starts (tiles_at) and how many pages
      TIME(6);                              // jsr $C75B
      stage_bank();
      TIME(3 + 2 + 2);                      // lda $31, cmp #6, bcc
      RAM(COUNT) = rom(0x8D20);
      TIME(4 + 3 + 3 + 2);                  // lda $8D20, bne, sta $0C, lda #0
      PUT(4, 0x2006, 0);
      PUT(4, 0x2006, 0);
      RAM(INDEX) = 0;
      TIME(3);                              // sta $0D
      do {
        stage_bank();
        y = RAM(INDEX);
        TIME(3 + 3 + 2 + 2);                // ldy $0D, lda $31, cmp #6, bcc
        x = rom((uint16_t)(0x8D21 + y));
        pages = rom((uint16_t)(0x8D22 + y));
        TIME(4 + crosses(0x8D21, y) + 4 + crosses(0x8D22, y) + 3);  // lda $8D21,y, ldx $8D22,y, bne
        tiles_at((uint8_t)x);
        for (; pages > 0; pages--) {
          TIME(2);                          // ldy #0
          from = (uint16_t)(RAM(POINTER) | RAM(POINTER + 1) << 8);
          for (y = 0; y < 256; y++) {
            TIME(5);                        // lda ($04),y
            PUT(4, 0x2007, rom((uint16_t)(from + y)));
            TIME(2 + (y < 255 ? 3 : 2));    // iny, bne
          }
          RAM(POINTER + 1)++;
          TIME(5 + 2 + (pages > 1 ? 3 : 2));  // inc $05, dex, bne
        }
        RAM(INDEX) += 2;
        RAM(COUNT)--;
        TIME(5 + 5 + 5 + (RAM(COUNT) ? 3 : 2));  // inc $0D twice, dec $0C, bne
      } while (RAM(COUNT));
      TIME(3);                              // jmp $C3B3
      main_bank();

      // $C483: the stage's colours, from $8CD0 for the title screen: to the PPU, and 48 bytes to $03D0
      TIME(6);                              // jsr $C483
      stage_bank();
      TIME(3 + 2 + 2 + 2);                  // lda $31, cmp #6, bcc, lda #$D0
      RAM(PALETTE) = 0xD0;
      RAM(PALETTE + 1) = 0x8C;
      TIME(3 + 2 + 3 + 3 + 2);              // sta $35, lda #$8C, sta $36, jmp $C49F, lda #$20
      write_colours(0x20);
      TIME(2);                              // ldy #$2F
      from = (uint16_t)(RAM(PALETTE) | RAM(PALETTE + 1) << 8);
      for (y = 0x2F; y >= 0; y--) {
        RAM(COLOURS + y) = rom((uint16_t)(from + y));
        TIME(5 + crosses(from, y) + 5 + 2 + (y > 0 ? 3 : 2));  // lda ($35),y, sta $03D0,y, dey, bpl
      }
      // $C4AE: and the list at $8E9F, whose second byte n says how many: 6n + 1 bytes from it to $0720
      RAM(POINTER) = 0x9F;
      RAM(POINTER + 1) = 0x8E;
      TIME(3 + 2 + 2 + 2 + 3 + 2 + 3 + 3);  // lda $31, cmp #6, bcc, lda #$9F, sta $04, lda #$8E, sta $05, bne
      from = 0x8E9F;
      RAM(0x0720) = (uint8_t)(rom((uint16_t)(from + 1)) << 1);
      y = (uint8_t)(RAM(0x0720) << 1) + RAM(0x0720);
      TIME(2 + 5 + crosses(from, 1) + 2 + 4 + 2 + 2 + 4 + 2 + 2);  // ldy #1, lda ($04),y, asl, sta, asl, clc, adc, tay, iny
      for (y = (uint8_t)(y + 1); y > 0; y--) {
        RAM(0x071F + y) = rom((uint16_t)(from + y));
        TIME(5 + crosses(from, y) + 5 + 2 + (y > 1 ? 3 : 2));  // lda ($04),y, sta $071F,y, dey, bne
      }
      TIME(3);                              // jmp $C3B3
      main_bank();

      // $F956: the title screen. Its background tile everywhere, the attributes from $8EC7, the logo's seven rows of
      // tiles in order, two tiles on their own, and four lines of words from the list at $8EE4
      TIME(6);                              // jsr $F956
      stage_bank();
      TIME(2);                              // lda #$20
      PUT(4, 0x2006, 0x20);
      TIME(2);                              // lda #0
      PUT(4, 0x2006, 0x00);
      TIME(2 + 2 + 3 + 3);                  // ldx #$0E, lda #$7F, ldy $A6, bpl
      for (rows = 15; rows > 0; rows--) {
        TIME(2);                            // ldy #$40
        for (left = 64; left > 0; left--) {
          PUT(4, 0x2007, 0x7F);
          TIME(2 + (left > 1 ? 3 : 2));     // dey, bne
        }
        TIME(2 + (rows > 1 ? 3 : 2));       // dex, bpl
      }
      TIME(3 + 3 + 2);                      // lda $A6, bpl, ldx #7
      for (x = 7; x >= 0; x--) {
        TIME(2);                            // ldy #8
        for (left = 8; left > 0; left--) {
          TIME(4);                          // lda $8EC7,x
          PUT(4, 0x2007, rom((uint16_t)(0x8EC7 + x)));
          TIME(2 + (left > 1 ? 3 : 2));     // dey, bne
        }
        TIME(2 + (x > 0 ? 3 : 2));          // dex, bpl
      }
      TIME(2);                              // ldx #6
      for (y = 0, x = 6; x >= 0; x--) {
        TIME(4);                            // lda $8ECF,x
        PUT(4, 0x2006, rom((uint16_t)(0x8ECF + x)));
        TIME(4);                            // lda $8ED6,x
        PUT(4, 0x2006, rom((uint16_t)(0x8ED6 + x)));
        RAM(COUNT) = (uint8_t)x;
        TIME(3 + 4 + 2);                    // stx $0C, lda $8EDD,x, tax
        for (left = rom((uint16_t)(0x8EDD + x)); left > 0; left--) {
          PUT(4, 0x2007, (uint8_t)y);
          y++;
          TIME(2 + 2 + (left > 1 ? 3 : 2)); // iny, dex, bne
        }
        TIME(3 + 2 + (x > 0 ? 3 : 2));      // ldx $0C, dex, bpl
      }
      TIME(2);                              // lda #$23
      PUT(4, 0x2006, 0x23);
      TIME(2);                              // lda #$DE
      PUT(4, 0x2006, 0xDE);
      TIME(2);                              // lda #$A0
      PUT(4, 0x2007, 0xA0);
      TIME(2);                              // lda #$21
      PUT(4, 0x2006, 0x21);
      TIME(2);                              // lda #$D9
      PUT(4, 0x2006, 0xD9);
      TIME(2);                              // lda #$94
      PUT(4, 0x2007, 0x94);
      TIME(2);                              // lda #$8D
      PUT(4, 0x2007, 0x8D);
      RAM(COUNT) = 4;
      TIME(2 + 2 + 3);                      // inx, lda #4, sta $0C
      for (x = 0; RAM(COUNT) > 0;) {
        TIME(4 + crosses(0x8EE4, x));       // lda $8EE4,x
        PUT(4, 0x2006, rom((uint16_t)(0x8EE4 + x)));
        x++;
        TIME(2 + 4 + crosses(0x8EE4, x));   // inx, lda $8EE4,x
        PUT(4, 0x2006, rom((uint16_t)(0x8EE4 + x)));
        x++;
        TIME(2 + 4 + crosses(0x8EE4, x) + 2);  // inx, ldy $8EE4,x, inx
        left = rom((uint16_t)(0x8EE4 + x));
        x++;
        for (; left > 0; left--) {
          TIME(4 + crosses(0x8EE4, x));     // lda $8EE4,x
          PUT(4, 0x2007, rom((uint16_t)(0x8EE4 + x)));
          x++;
          TIME(2 + 2 + (left > 1 ? 3 : 2)); // inx, dey, bne
        }
        RAM(COUNT)--;
        TIME(5 + (RAM(COUNT) ? 3 : 2));     // dec $0C, bne
      }
      RAM(0xBC) = 0;
      TIME(2 + 3 + 2);                      // ldy #0, sty $BC, ldx #$40
      hide_sprites(0, 64);
      TIME(3 + 2);                          // lda $FF, ora #$80
      RAM(CONTROL) |= 0x80;
      TIME(3);                              // sta $FF
      PUT(4, 0x2000, RAM(CONTROL));
      TIME(3 + 2);                          // lda $A6, bmi
      // $FA0D: the title screen waits a frame at a time, until Start is pressed
      frame_wait();
      resume = -1;
  }
}

void game_start(void) {
  // $C008, the reset, 7 cycles after power-on: the interrupt off, the picture off, and on to $9000 in bank 5
  clock = 21;
  RUN(2 + 2);                               // sei, lda #1
  store(4, 0x2000, 0x01);
  RUN(2);                                   // lda #6
  store(4, 0x2001, 0x06);
  RUN(2 + 4);                               // lda #5, sta $C005
  bank = 5;
  RUN(3 + 2 + 2 + 2);                       // jmp $9000, ldx #$FF, txs, ldx #1
  resume = 0;
}

void game_step(uint32_t buttons) {
  (void)buttons;  // the controllers are read through $4016
  if (resume >= 0) {
    clock -= nes_frame_length((int)nes_frame() - 1);
    start_up();
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
