// 0x0802D4CC, UpdateScreenFade: a whole-screen fade through the blend registers, inside window 0. It brightens or darkens
// a sixteenth a frame until `brightness` reaches the end of its range, which is when it answers true.

const END = 32 * 256;

/** The fade's values: to the screen's colours with `lighten` false, from them with `lighten` true. */
export const createFade = ({ lighten = false, speed = 0x100, bldCnt = 0xFF } = {}) => ({ lighten, brightness: 0, speed, bldCnt, bldAlpha: 0 });

export function updateFade(c, fade) {
  c.dispCnt |= 0x2000;
  c.winRegs[0] = 240;
  c.winRegs[2] = 160;
  c.winRegs[4] |= 0x3F;
  c.winRegs[5] |= 0x1F;
  c.bldCnt = fade.bldCnt;
  c.bldAlpha = fade.bldAlpha;
  const y = fade.lighten ? fade.brightness >> 8 : 32 - (fade.brightness >> 8);
  c.bldY = Math.min(y, 32) >> 1;
  fade.brightness += fade.speed;
  if (fade.brightness < END) return false;
  fade.brightness = END;
  return true;
}
