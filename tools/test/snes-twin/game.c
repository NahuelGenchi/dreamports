// Twins of the made-up Super Nintendo cartridge's functions (../made-up-snes.mjs), for the function check's test
// (../snes-twin.mjs): each a function of C the tools wrote from the original's instructions, with its contract beside
// it, which says what of the 65816's registers and flags it's given and gives back (../../snes/contracts.mjs). Each
// keeps its values where the original does, at the console's own addresses, and reads and writes the hardware through
// the kit, as the original's loads and stores do.

#include "snes.h"

// a byte and a word at one of the console's 24-bit addresses, which the build folds to where the console has it
#define BYTE(address) (*(volatile uint8_t *)(uintptr_t)(address))
#define WORD(address) (*(volatile uint16_t *)(uintptr_t)(address))
// the table of values in the cartridge's ROM
#define VALUES 0x0080F8

// dp:twin sub_008060 a16i16 sum(&A, X, D) if D < 0x1FFE
void sum(uint16_t *a, uint16_t x, uint16_t d) {
  WORD(d) = x;
  *a = (uint16_t)(*a + WORD(d));
}

// dp:twin sub_008066 a8i16 fill(A, &X, &Y, DB) if (DB == 0x7E || DB == 0x7F) && Y < 0x400
void fill(uint16_t a, uint16_t *x, uint16_t *y, uint8_t db) {
  while (*y != 0) {
    BYTE((uint32_t)db << 16 | *x) = (uint8_t)a;
    *x = (uint16_t)(*x + 1);
    *y = (uint16_t)(*y - 1);
  }
}

// dp:twin sub_008073 a16i16 lookup(&X) -> A if X < 0x1000
uint16_t lookup(uint16_t *x) {
  *x = (uint16_t)(*x << 1);
  return WORD(VALUES + *x);
}

// dp:twin sub_00807B a16i16 twice(&A, &X, D) if D < 0x1FFE
void twice(uint16_t *a, uint16_t *x, uint16_t d) {
  *x = *a;
  sum(a, *x, d);
}

// dp:twin sub_008080 a16i16>a8i16 leaves8()
void leaves8(void) {
}

// dp:twin sub_008085 a8i8 wait()
void wait(void) {
}

// dp:twin sub_008088 a8i8 hardware(&A) if (DB & 0x40) == 0
void hardware(uint16_t *a) {
  snes_write(0x2100, 0x0F);
  snes_write(0x4202, 6);
  snes_write(0x4203, 7);
  *a = (uint16_t)((*a & 0xFF00) | snes_read(0x4216));
}

// dp:twin sub_00809F a8i8 port(&A) if (DB & 0x40) == 0
void port(uint16_t *a) {
  snes_write(0x2181, 0x00);
  snes_write(0x2182, 0x01);
  snes_write(0x2183, 0x00);
  snes_write(0x2180, 0xAB);
  snes_write(0x2180, 0xAB);
  *a = (uint16_t)((*a & 0xFF00) | 0xAB);
}

// dp:twin sub_0080BD a8i8 jumpout()
void jumpout(void) {
}

// dp:twin sub_0080C0 a8i8 bank(&A, DB)
void bank(uint16_t *a, uint8_t db) {
  *a = (uint16_t)((*a & 0xFF00) | BYTE((uint32_t)db << 16 | 0x1234));
}

// dp:twin sub_0080C4 a8i8 direct(&A, D) if (uint16_t)(D + 0x10) < 0x2000 || (uint16_t)(D + 0x10) >= 0x8000
void direct(uint16_t *a, uint16_t d) {
  *a = (uint16_t)((*a & 0xFF00) | BYTE((uint16_t)(d + 0x10)));
}

// dp:twin sub_0080C7 a16i16 move(&A, &X, &Y, &DB)
void move(uint16_t *a, uint16_t *x, uint16_t *y, uint8_t *db) {
  for (int i = 0; i < 4; i++) BYTE(0x7E3000 + i) = BYTE(0x7E2000 + i);
  *a = 0xFFFF;
  *x = 0x2004;
  *y = 0x3004;
  *db = 0x7E;
}

// dp:twin sub_0080D4 a8i8 save(&A)
void save(uint16_t *a) {
  BYTE(0x700010) = 0x5A;
  *a = (uint16_t)((*a & 0xFF00) | 0x5A);
}

// dp:twin sub_0080DB a8i8 tick(D) if D < 0x1FE0
void tick(uint16_t d) {
  BYTE((uint16_t)(d + 0x20)) += 1;
}

// dp:twin sub_0080DE a16i16 pick(X) -> A if X == 0 || X == 2 || X == 4
uint16_t pick(uint16_t x) {
  switch (x) {
  case 0: return 10;
  case 2: return 20;
  default: return 30;
  }
}

// dp:twin sub_00810A a16i16 shine() -> A
uint16_t shine(void) {
  return 1;
}

// dp:twin sub_00810E a8i8 hidden(&A, DB) if (DB & 0x40) == 0 || DB == 0x7E || DB == 0x7F
void hidden(uint16_t *a, uint8_t db) {
  BYTE((uint32_t)db << 16 | 0x0400) = 0x12;
  *a = (uint16_t)((*a & 0xFF00) | 0x12);
}

// What every game defines, which the check never calls.
void game_start(void) {}
void game_step(uint32_t buttons) { (void)buttons; }
void game_draw(void) {}
void game_sound(float *left, float *right, int count) { (void)left; (void)right; (void)count; }
