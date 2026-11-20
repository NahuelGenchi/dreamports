// A program of the project's own for npm run test:stack: functions that leave values on the console's stack, and one
// that reads a struct it never fills, so what it copies is what they left there. Each function is at the address its
// comment names in the made-up cartridge.

struct Box { int a, b, c, d; };

// where the console keeps them, as the made-up cartridge places them: no file defines them
extern int gKept, gOther, gInner, gDone;
extern int gOut[4];
extern int gMore, gFirst, gSecond, gThrough, gSeen, gSeed, gLocal, gPass, gWrap, gHanded;
// memory the console has far from where a Dreamport keeps it, as a save's flash is
extern char gFar[];
// what each of the later functions left on the stack, as Look finds it
struct Left { int word[6]; };
extern int gThroughLeft[6], gFarLeft[6], gLocalLeft[6], gPassLeft[6], gHandLeft[6];

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

/** Deep, 0x08000380: keeps two addresses across its call, so it saves two of its caller's registers. */
void Deep(void) {
  int *first = &gFirst;
  int *second = &gSecond;
  Inner();
  *first = 1;
  *second = 2;
}

/** Through, 0x080003C0: calls the function it's handed, through a pointer, keeping an address across the call. */
void Through(void (*function)(void)) {
  int *through = &gThrough;
  function();
  *through = 3;
}

/** Far, 0x08000400: keeps a pointer it's handed across its call, in a register Deep saves. */
void Far(char *far) {
  Deep();
  if (far) gSeen++;
}

// a sum written by a macro, as a game reads a register through one
#define SUM(a, b) ((a) + (b))

/** Local, 0x08000440: keeps a value it worked out from memory across its call, in a register Deep saves, assigned
 *  through a function-like macro. */
void Local(void) {
  int local;
  local = SUM(gSeed, gSeen);
  Deep();
  gLocal = local;
}

/** Pass, 0x08000480: keeps an address of its own across its call, and leaves the rest of its caller's registers. */
void Pass(void) {
  int *pass = &gPass;
  Deep();
  *pass = 4;
}

/** Wrap, 0x080004C0: Pass a call further down than anything else goes. */
void Wrap(void) {
  Pass();
  gWrap++;
}

/** Take, 0x08000600: six words, as they are. */
void Take(struct Left *left, int *out) {
  int i;
  for (i = 0; i < 6; i++) out[i] = left->word[i];
}

/** Look, 0x08000640: six words of its stack with one set, where the function before it left its own. */
void Look(int *out) {
  struct Left left;
  left.word[0] = 5;
  Take(&left, out);
}

/** Hand, 0x08000700: the twin of a routine the cartridge has in assembly (routines.s), whose frame isn't the one the
 *  console's compiler gives this C. */
void Hand(int *out) {
  Inner();
  *out = 7;
}

/** Again, 0x08000800: Keep, then Read over what Keep's calls left, keeping an address of its own across both, another
 *  than Main keeps, as one call of the function check makes them (../../gba/twin.mjs). */
void Again(void) {
  int *wrap = &gWrap;
  Keep();
  Read();
  *wrap = 2;
}

/** Main, 0x08000740: Keep, then Read, at the same depth, and then each of the rest, with two addresses kept across
 *  them all. */
void Main(void) {
  int *done = &gDone;
  int *more = &gMore;
  gSeed = 7;
  Keep();
  Read();
  Through(Deep);
  Look(gThroughLeft);
  Far(gFar);
  Look(gFarLeft);
  Local();
  Look(gLocalLeft);
  Wrap();
  Look(gPassLeft);
  Hand(&gHanded);
  Look(gHandLeft);
  *done = 1;
  *more = 1;
}
