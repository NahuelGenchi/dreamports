// The twin of the made-up second EE program's function (module.mjs), named by its key: its address and its program.

extern int D_00300040;

/** 0x00300000@OTHER.ELF: the sum of two and the program's own value */
int other_sum(int a, int b) {
  return a + b + D_00300040;
}
