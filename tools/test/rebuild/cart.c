// The program the rebuild's test makes a cartridge of (../rebuild.mjs): its functions one after another, each on four
// bytes, as a linker lays them out, so every byte of the cartridge is code, its header, data, the zeros that line up
// a function, or fill. Each comment names where the cartridge has the function, which the test checks.
#include "cart.h"

/** Clamp, 0x080000C0: `value`, kept from 0 to `most`. */
s32 Clamp(s32 value, s32 most) {
  if (value < 0) return 0;
  if (value > most) return most;
  return value;
}

/** Step, 0x080000D0: one dot a frame on, kept on the screen. */
void Step(struct Dot *dot) {
  dot->x = Clamp(dot->x + dot->dx, WIDTH);
  dot->y = Clamp(dot->y + dot->dy, HEIGHT);
}

/** StepAll, 0x08000100: every dot a frame on, then the frame counted. */
void StepAll(void) {
  s32 i;

  for (i = 0; i < DOTS; i++) Step(&gDots[i]);
  gFrame++;
}

/** Stepper, 0x0800012C: what steps the dots, for whoever calls it later. */
void *Stepper(void) {
  return StepAll;
}

/** Speed, 0x08000134: how fast a dot of each kind goes. */
s32 Speed(u32 kind) {
  return gSpeeds[kind & 7];
}
