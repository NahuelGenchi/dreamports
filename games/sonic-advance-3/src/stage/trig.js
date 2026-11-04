// The original's integer trigonometry, as Sonic Advance Dreamport's src/engine/trig.js has it: the sine table is 1.25 turns
// of 1024 steps in Q2.14, each entry truncated toward zero, and ArcTan2 is the BIOS call, after mGBA's reimplementation.

export const SINE = Int16Array.from({ length: 1280 }, (_, i) => Math.trunc(Math.sin(i * 2 * Math.PI / 1024) * 16384));
export const sin8 = angle => SINE[angle & 0x3FF] >> 6;
export const cos8 = angle => SINE[(angle & 0x3FF) + 256] >> 6;

function arcTan(i) {
  const a = -((i * i) >> 14);
  let b = ((0xA9 * a) >> 14) + 0x390;
  b = ((b * a) >> 14) + 0x91C;
  b = ((b * a) >> 14) + 0xFB6;
  b = ((b * a) >> 14) + 0x16AA;
  b = ((b * a) >> 14) + 0x2081;
  b = ((b * a) >> 14) + 0x3651;
  b = ((b * a) >> 14) + 0xA2F9;
  return (i * b) >> 16;
}
const div = (a, b) => Math.trunc(a / b);

/** Angle of (x, y) in 65536 steps per turn, y pointing down. */
export function arcTan2(x, y) {
  let r;
  if (!y) r = x >= 0 ? 0 : 0x8000;
  else if (!x) r = y >= 0 ? 0x4000 : 0xC000;
  else if (y >= 0) {
    if (x >= 0 && x >= y) r = arcTan(div(y << 14, x));
    else if (x < 0 && -x >= y) r = arcTan(div(y << 14, x)) + 0x8000;
    else r = 0x4000 - arcTan(div(x << 14, y));
  } else if (x <= 0 && -x > -y) r = arcTan(div(y << 14, x)) + 0x8000;
  else if (x > 0 && x >= -y) r = arcTan(div(y << 14, x)) + 0x10000;
  else r = 0xC000 - arcTan(div(x << 14, y));
  return r & 0xFFFF;
}
