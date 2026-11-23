// The cartridge's own start, in ARM code, as the game's build links it: the jump past its header, the code that sets
// the processor's stacks and hands over to AgbMain, and the interrupt dispatcher the game copies to the fast work
// memory.
// Each twin is its instructions, written by hand from the console's instructions as npm run dp -- read prints them,
// which the tools' assembler gives back byte for byte (match). A Dreamport has none of this to run: its start is the
// kit's and hardware.c's (console_cartridge), and its interrupts are taken by hardware.c's console_intr_main, so each
// twin does nothing there, and the frames that match from the first, by prove, are the proof of that work.

// each is its instructions alone, with nothing the compiler adds before or after them
#ifdef MATCHING
void CartridgeStart(void) __attribute__((naked));
void CartridgeInit(void) __attribute__((naked));
void IntrMainArm(void) __attribute__((naked));
#endif

/** 0x08000000, CartridgeStart: the cartridge's first instruction, a jump past its header to its start. */
void CartridgeStart(void)
{
#ifdef MATCHING
  asm(".arm\n\tb CartridgeInit\n");
#endif
}

/**
 * 0x080000C0, CartridgeInit: the interrupts' stack and then the game's, each in its mode of the processor, the
 * dispatcher's address where the BIOS looks for it, and AgbMain, which never comes back, with the two stacks' places
 * after it.
 */
void CartridgeInit(void)
{
#ifdef MATCHING
  asm(
      "\t.arm\n"
      "\tmov r0, #18\n"
      "\tmsr cpsr_cf, r0\n"
      "\tldr sp, [pc, #40]\n"
      "\tmov r0, #31\n"
      "\tmsr cpsr_cf, r0\n"
      "\tldr sp, [pc, #24]\n"
      "\tldr r1, [pc, #224]\n"
      "\tadd r0, pc, #24\n"
      "\tstr r0, [r1, #0]\n"
      "\tldr r1, [pc, #216]\n"
      "\tmov lr, pc\n"
      "\tbx r1\n"
      "\tb CartridgeInit\n"
      "\t.word 0x03007F00\n"
      "\t.word 0x03007FA0\n");
#endif
}

/**
 * 0x080000FC to 0x0800012C, IntrMainArm: the interrupts that are asked for and on, the link cable's first, as the
 * dispatcher waits for it to end, then the line's and the display's, then each other in turn, the first acknowledged
 * and its handler from the game's table called; with the places CartridgeInit loads after it. The table's own address,
 * the word after those, the code map keeps outside every function.
 */
void IntrMainArm(void)
{
#ifdef MATCHING
  asm(
      "\t.arm\n"
      "\tmov r3, #67108864\n"
      "\tadd r3, r3, #512\n"
      "\tldr r2, [r3, #0]\n"
      "\tand r1, r2, r2, lsr #16\n"
      "\tmov r2, #0\n"
      "\tands r0, r1, #8192\n"
      ".Lintr_main_serial:\n"
      "\tbne .Lintr_main_serial\n"
      "\tands r0, r1, #192\n"
      "\tbne .Lintr_main_found\n"
      "\tadd r2, r2, #4\n"
      "\tands r0, r1, #1\n"
      "\tbne .Lintr_main_found\n"
      "\tadd r2, r2, #4\n"
      "\tands r0, r1, #2\n"
      "\tbne .Lintr_main_found\n"
      "\tadd r2, r2, #4\n"
      "\tands r0, r1, #4\n"
      "\tbne .Lintr_main_found\n"
      "\tadd r2, r2, #4\n"
      "\tands r0, r1, #8\n"
      "\tbne .Lintr_main_found\n"
      "\tadd r2, r2, #4\n"
      "\tands r0, r1, #16\n"
      "\tbne .Lintr_main_found\n"
      "\tadd r2, r2, #4\n"
      "\tands r0, r1, #32\n"
      "\tbne .Lintr_main_found\n"
      "\tadd r2, r2, #4\n"
      "\tands r0, r1, #256\n"
      "\tbne .Lintr_main_found\n"
      "\tadd r2, r2, #4\n"
      "\tands r0, r1, #512\n"
      "\tbne .Lintr_main_found\n"
      "\tadd r2, r2, #4\n"
      "\tands r0, r1, #1024\n"
      "\tbne .Lintr_main_found\n"
      "\tadd r2, r2, #4\n"
      "\tands r0, r1, #2048\n"
      "\tbne .Lintr_main_found\n"
      "\tadd r2, r2, #4\n"
      "\tands r0, r1, #4096\n"
      "\tbne .Lintr_main_found\n"
      "\tadd r2, r2, #4\n"
      "\tands r0, r1, #8192\n"
      ".Lintr_main_found:\n"
      "\tstrh r0, [r3, #2]\n"
      "\tldr r1, [pc, #16]\n"
      "\tadd r1, r1, r2\n"
      "\tldr r0, [r1, #0]\n"
      "\tbx r0\n"
      "\t.word 0x03007FFC\n"
      "\t.word AgbMain\n");
#endif
}
