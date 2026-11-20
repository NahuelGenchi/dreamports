// A function of the function check's test (../twin.mjs) that goes through a list of pointers to structs, in a file of
// its own so the other tests' program stays as it is. The list is empty in the memory the test calls it from, its
// pointers 0, so only a call given a struct made up where one points takes its paths: the check makes one up, laid
// out as this C has it (../../gba/twin-shapes.mjs).
#include "program.h"

/** How wide and how tall a shape is. */
struct Size {
  u16 width;
  u16 height;
};

/** A shape: what kind it is, how many times it counts, and its size. */
struct Shape {
  u8 kind;
  u8 times;
  s16 x;
  const struct Size *size;
};

extern struct Shape *gShapes[];
extern u8 gShapeCount;
extern u32 gTotal;

/** Tally, 0x08000E00: each shape on the list adds its width times its height to the total, as many times as it
 *  counts, or a shape of the third kind its width alone, and the list emptied. */
void Tally(void) {
  u32 i;
  for (i = 0; i < gShapeCount; i++) {
    const struct Shape *shape = gShapes[i];
    if (shape->kind == 3) gTotal += shape->size->width;
    else gTotal += shape->size->width * shape->size->height * shape->times;
  }
  gShapeCount = 0;
}
