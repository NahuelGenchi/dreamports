// The twins of the made-up Nintendo DS cartridge of the tools' tests (../made-up-nds-twin.mjs), written as a game's C
// is: each names the function of the original it's the twin of in the comment above it, one of the ARM7's program by
// its key in the code map, and keeps every value where the console keeps it, a place in the console's main memory
// written as its address or named, as the game's proof/addresses.json names its values, which the test writes.
// nds-twin.mjs checks them against the original.

extern const unsigned values[];

/** 0x02000024: the sum of two numbers, in ARM code */
int arm_sum(int a, int b) {
  return a + b;
}

/** 0x0200002C: a number kept from 0 to 100, in ARM code, each of whose two moves waits on a condition */
int arm_clamp(int a) {
  if (a > 100) a = 100;
  if (a < 0) a = 0;
  return a;
}

/** 0x02000040: count bytes of value from to, in ARM code, which gives back where it stopped */
unsigned char *arm_fill(unsigned char *to, unsigned char count, unsigned char value) {
  while (count != 0) {
    *to++ = value;
    count--;
  }
  return to;
}

/** 0x02000058: one of the program's four values, in ARM code */
unsigned arm_lookup(unsigned index) {
  return values[index & 3];
}

/** 0x020000A8: the larger of two numbers, in Thumb code */
int thumb_max(int a, int b) {
  if (a >= b) return a;
  return b;
}

/** 0x020000B0: the sum of two numbers, in Thumb code */
int thumb_add(int a, int b) {
  return a + b;
}

/** 0x020000B4: a number and itself, in Thumb code, by a call */
int thumb_twice(int a) {
  return thumb_add(a, a);
}

/** 0x020000BE: a halfword and a word kept, in Thumb code, which gives back where */
unsigned short *thumb_store(unsigned short *to, unsigned value) {
  to[0] = value;
  *(unsigned *)(to + 2) = value;
  return to;
}

/** 0x020000C4: the number after, in Thumb code, with a path no call takes */
int thumb_path(int a) {
  return a + 1;
}

/** 0x020000D2: a word of the main memory, read where it's seen again, 4 MB up */
unsigned thumb_mirror(void) {
  return *(volatile unsigned *)0x027FFC00;
}

/** 0x020000DC: the original asks the BIOS */
void thumb_bios(void) {
}

/** 0x0200006C: the original writes a register of the hardware's */
unsigned arm_io(unsigned value) {
  return value;
}

/** 0x0200007C: the original asks the system control coprocessor */
unsigned arm_control(void) {
  return 0;
}

/** 0x0238001C@ARM7: one more in a word of the memory, in ARM code on the ARM7, which gives back what it comes to */
unsigned seven_count(unsigned *counter) {
  *counter += 1;
  return *counter;
}

/** 0x0238003A@ARM7: two numbers mixed and doubled, in Thumb code on the ARM7 */
unsigned seven_mix(unsigned a, unsigned b) {
  return (a ^ b) << 1;
}
