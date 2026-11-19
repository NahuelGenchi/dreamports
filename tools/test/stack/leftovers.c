// A program of the project's own for npm run test:stack: functions that leave values on the console's stack, and one
// that reads a struct it never fills, so what it copies is what they left there. Each function is at the address its
// comment names in the made-up cartridge.

struct Box { int a, b, c, d; };

// where the console keeps them, as the made-up cartridge places them: no file defines them
extern int gKept, gOther, gInner, gDone;
extern int gOut[4];

void Inner(void);
void Push(void);
void Copy(struct Box *box);

/** Inner, 0x08000280: a leaf, which pushes nothing. */
void Inner(void) { gInner++; }

/** Push, 0x08000240: keeps an address of its own across its call, so it saves its caller's register first. */
void Push(void) {
  int *other = &gOther;
  Inner();
  *other = 2;
}

/** Keep, 0x08000200: keeps gKept's address across its call, in the register Push saves. */
void Keep(void) {
  int *kept = &gKept;
  Push();
  *kept = 1;
}

/** Copy, 0x08000300: the box's four words, as they are. */
void Copy(struct Box *box) {
  gOut[0] = box->a;
  gOut[1] = box->b;
  gOut[2] = box->c;
  gOut[3] = box->d;
}

/** Read, 0x080002C0: a box on its stack with one word set, where Keep and Push left theirs. */
void Read(void) {
  struct Box box;
  box.a = 5;
  Copy(&box);
}

/** Main, 0x08000340: Keep, then Read, at the same depth. */
void Main(void) {
  int *done = &gDone;
  Keep();
  Read();
  *done = 1;
}
