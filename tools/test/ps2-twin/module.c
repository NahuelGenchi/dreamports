// The twins of the made-up module's functions (module.mjs), for the function check's test of a disc's other programs
// (../ps2-twin-programs.mjs): each names its function by the code map's key, its address from the module's start and
// the module. The module's values are named by labels with their addresses from its start.

extern int D_00000100;
extern int (*D_00000104[2])(int);
int sysclib_12(int value);

/** 0x00000000@MADE_UP.IRX: the sum of three */
int add3(int a, int b, int c) {
  return a + b + c;
}

/** 0x0000000C@MADE_UP.IRX: sets the counter, and gives back what it was */
int store(int value) {
  int was = D_00000100;
  D_00000100 = value;
  return was;
}

/** 0x0000001C@MADE_UP.IRX: the sum of five, the fifth from the stack */
int five(int a, int b, int c, int d, int e) {
  return a + b + c + d + e;
}

/** 0x00000034@MADE_UP.IRX: a 64-bit sum, which the IOP's compiler passes in two words each */
long long wide(long long a, long long b) {
  return a + b;
}

/** 0x00000048@MADE_UP.IRX: add3 of a number, itself and nothing */
int twice(int a) {
  return add3(a, a, 0);
}

/** 0x00000068@MADE_UP.IRX: reached through the table */
int one(int a) {
  return a + 1;
}

/** 0x00000070@MADE_UP.IRX: reached through the table */
int two(int a) {
  return a + 2;
}

/** 0x00000078@MADE_UP.IRX: calls the function the module's table has for n's lowest bit */
int pick(int n) {
  return D_00000104[n & 1](n);
}

/** 0x000000A8@MADE_UP.IRX: the SPU2's first register */
void voice(int value) {
  *(volatile unsigned short *)0xBF900000 = (unsigned short)value;
}

/** 0x000000B4@MADE_UP.IRX: asks another module, which the check sets aside */
int ask(int value) {
  return sysclib_12(value);
}
