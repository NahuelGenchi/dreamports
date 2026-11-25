/* A program of the project's own for the PlayStation 2's test of a game whose tasks are its parts (../ps2-parts.mjs): a
   square that crosses a screen of one colour, made up here, with nothing of any game in it. The same file is the
   program, built by SN Systems' compiler and laid out as an ELF by the test, and the twins of its functions in the
   game's version in C. The test fills in each function's address where the @ signs are. */

#include "program.h"

/* Move, @MOVE@: the square's place across a frame on, two along, back at the left past 255 */
int Move(int x) {
  return (x + 2) & 0xFF;
}

/* Turn, @TURN@: the place across as it's shown once the square has turned, counted from the right */
int Turn(int x) {
  return 255 - x;
}

#ifdef MATCHING
/* What the console's build writes the hardware by: the GS's registers, the GIF's DMA channel and the DMA controller's. */
#define REGISTER(address) (*(volatile unsigned int *)(address))
static unsigned int packet[] __attribute__((aligned(16))) = PACKET;
#else
/* And the game's version, through the kit. */
#include "ps2.h"
#endif

/* Start, @START@: once the stack is set, the program. It sets the screen, and then for ever waits for the V-blank,
   moves the square and sends the GS its packet, the square turned from frame TURNS_AT on. Move never gives 256, so its
   loop goes round for ever, written so the compiler can't tell: after a loop it knows is endless the compiler leaves
   the function's end, which nothing reaches, and the code map takes such code for a function of its own. The
   console's build writes the hardware and never comes back; the game's version sets the screen through the kit and
   comes back, as the kit runs a game a frame at a time, and what each frame does is the game's step (main.c). */
void Start(void) {
#ifdef MATCHING
  int x = 0, frame = 0, shown;
  /* SetGsCrt: interlaced, NTSC, in fields */
  __asm__ __volatile__("li $3, 2\n\tli $4, 1\n\tli $5, 2\n\tmove $6, $0\n\tsyscall" : : : "$3", "$4", "$5", "$6");
  /* the screen: circuit 1 alone, showing the framebuffer at 0, 640 by 448, and the DMA controller on */
  REGISTER(0x12000000) = 0xFF25;
  REGISTER(0x12000004) = 0;
  REGISTER(0x12000020) = 1;
  REGISTER(0x12000024) = 0;
  REGISTER(0x12000070) = 10 << 9;
  REGISTER(0x12000074) = 0;
  REGISTER(0x12000080) = 656 | 36 << 12 | 3 << 23;
  REGISTER(0x12000084) = 2559 | 447 << 12;
  REGISTER(0x1000E000) = 1;
  do {
    /* the V-blank's start, from the GS's CSR */
    REGISTER(0x12001000) = 8;
    while (!(REGISTER(0x12001000) & 8)) {
    }
    x = Move(x);
    shown = frame >= TURNS_AT ? Turn(x) : x;
    packet[SQUARE] = CORNER(shown);
    packet[SQUARE + 4] = FAR_CORNER(shown);
    /* the packet through the GIF's channel: where it is, how many quadwords, and started */
    REGISTER(0x1000A010) = (unsigned int)packet;
    REGISTER(0x1000A020) = sizeof packet / 16;
    REGISTER(0x1000A000) = 0x101;
    while (REGISTER(0x1000A000) & 0x100) {
    }
    frame++;
  } while (x != 256);
#else
  gs_screen(GS_PMODE, 0xFF25);
  gs_screen(GS_PMODE + 4, 0);
  gs_screen(GS_SMODE2, 1);
  gs_screen(GS_SMODE2 + 4, 0);
  gs_screen(GS_DISPFB1, 10 << 9);
  gs_screen(GS_DISPFB1 + 4, 0);
  gs_screen(GS_DISPLAY1, 656 | 36 << 12 | 3 << 23);
  gs_screen(GS_DISPLAY1 + 4, 2559 | 447 << 12);
#endif
}

/* Boot, @BOOT@: where the console starts the program, which the console's loader gives no stack: it sets one at the
   top of main memory and calls Start, which never comes back. The game's version calls Start. */
void Boot(void) {
#ifdef MATCHING
  __asm__ __volatile__("lui $29, 0x0200\n\tjal Start\n\tnop");
#else
  Start();
#endif
}
