// Sprites as the engine runs them, on Sonic Advance Dreamport's src/gba/sprite.js, with what Sonic Advance 2 does: a
// sprite keeps the place of its frame in the dimensions table, and a frame's flips are a byte of their own. The scripts
// and frames are the ROM's sprite tables, at 0x080F40D4 (0x0801A51C, GameInit, loads the address).

const TABLES = 0xF40D4;
const OBJ_SIZES = [[8, 8], [16, 16], [32, 32], [64, 64], [16, 8], [32, 8], [32, 16], [64, 32], [8, 16], [8, 32], [16, 32], [32, 64]];
const OBJ_VRAM = 0x10000;
const RUNNING = 1, ANIM_CHANGED = -1, ENDED = 0, ANIM_OVER = 0x4000;
const s16 = v => (v << 16) >> 16;

/** A sprite (struct Sprite), with its tiles `tiles` as a VRAM offset. */
export function createSprite(fields) {
  return { tiles: OBJ_VRAM, anim: 0, variant: 0, prevAnim: 0xFFFF, prevVariant: 0xFF, dimensions: -1, frameFlags: 0, animCursor: 0, qAnimDelay: 0, animSpeed: 0x10, palId: 0, oamFlags: 0, x: 0, y: 0, ...fields };
}

const table = (c, field) => c.rom.u32(TABLES + field * 4) - 0x08000000;
const ANIMATIONS = 0, DIMENSIONS = 1, OAM_DATA = 2, PALETTES = 3, TILES_4BPP = 4, TILES_8BPP = 5;

/** 0x08004558, UpdateSpriteAnimation: 1 while the animation runs, 0 once it has ended. */
export function updateSprite(c, s) {
  const { rom } = c;
  if (s.prevVariant !== s.variant || s.prevAnim !== s.anim) {
    s.prevVariant = s.variant;
    s.prevAnim = s.anim;
    s.animCursor = 0;
    s.qAnimDelay = 0;
    s.frameFlags &= ~ANIM_OVER;
  }
  if (s.frameFlags & ANIM_OVER) return ENDED;
  if (s.qAnimDelay > 0) {
    s.qAnimDelay = s16(s.qAnimDelay - s.animSpeed * 16);
    return RUNNING;
  }
  const scriptOf = () => rom.u32(rom.u32(table(c, ANIMATIONS) + s.anim * 4) - 0x08000000 + s.variant * 4) - 0x08000000;
  let script = scriptOf();
  for (let at = script + s.animCursor * 4; rom.s32(at) < 0; at = script + s.animCursor * 4) {
    const result = command(c, s, at);
    if (result === RUNNING) continue;
    if (result !== ANIM_CHANGED) return result;
    script = scriptOf();
    s.animCursor = 0;
  }
  const at = script + s.animCursor * 4, frame = rom.s32(at + 4);
  s.qAnimDelay = s16(s.qAnimDelay + (rom.s32(at) << 8) - s.animSpeed * 0x10);
  s.dimensions = frame === -1 ? -1 : rom.u32(table(c, DIMENSIONS) + s.anim * 4) - 0x08000000 + frame * 12;
  s.animCursor = (s.animCursor + 2) & 0xFFFF;
  return RUNNING;
}

// the animation commands, by their negative ids (animCmdTable), those this game's screens use so far
function command(c, s, at) {
  const { rom } = c, id = rom.s32(at);
  switch (id) {
    case -1: {   // GetTiles
      s.animCursor += 3;
      const index = rom.s32(at + 4), count = rom.u32(at + 8);
      if (index < 0) c.queueGraphics(table(c, TILES_8BPP) + ((index * 64) >>> 0), s.tiles, (count * 64) & 0xFFFF);
      else c.queueGraphics(table(c, TILES_4BPP) + index * 32, s.tiles, (count * 32) & 0xFFFF);
      return RUNNING;
    }
    case -2: {   // GetPalette
      s.animCursor += 3;
      const from = table(c, PALETTES) + rom.s32(at + 4) * 32, count = rom.u16(at + 8), insert = rom.u16(at + 10);
      for (let i = 0; i < count; i++) c.objPalette[(s.palId * 16 + insert + i) & 0xFF] = rom.u16(from + i * 2);
      c.flags |= 0x2;
      return RUNNING;
    }
    case -3: s.animCursor = (s.animCursor - rom.s32(at + 4)) & 0xFFFF; return RUNNING;   // JumpBack
    case -4: s.frameFlags |= ANIM_OVER; return ENDED;                                    // End
    default: throw new Error(`Animation command ${id} isn't ported yet.`);
  }
}

/** 0x080051E8, DisplaySprite: the sprite's frame into OAM at (x, y), if any of it is on screen. */
export function displaySprite(c, s) {
  if (s.dimensions === -1) return;
  const { rom } = c, d = s.dimensions;
  const flip = rom.u8(d), oamIndex = rom.u8(d + 1), pieces = rom.u16(d + 2), w = rom.u16(d + 4), h = rom.u16(d + 6);
  const x = s.x - rom.s16(d + 8), y = s.y - rom.s16(d + 10);
  if (!(x + w >= 0 && x <= 240 && y + h >= 0 && y <= 160)) return;
  const oamData = rom.u32(table(c, OAM_DATA) + s.anim * 4) - 0x08000000;
  const order = (s.oamFlags & 0x7C0) >> 6, m = c.oamMalloc;
  for (let i = 0; i < pieces; i++) {
    const k = c.allocOam(order);
    if (k < 0) return;
    const src = oamData + (oamIndex + i) * 6;
    let a0 = rom.u16(src), a1 = rom.u16(src + 2), a2 = rom.u16(src + 4);
    let sprX = a1 & 0x1FF, sprY = a0 & 0xFF;
    a1 &= 0xFE00;
    a0 &= 0xFE00;
    a2 = (a2 + (s.palId << 12)) & 0xFFFF;
    const [sw, sh] = OBJ_SIZES[((a0 & 0xC000) >> 12) | ((a1 & 0xC000) >> 14)];
    if (flip & 2) {
      a1 ^= 0x2000;
      sprY = h - sh - sprY;
    }
    if (flip & 1) {
      a1 ^= 0x1000;
      sprX = w - sw - sprX;
    }
    a2 |= (s.frameFlags & 0x3000) >> 2;
    a0 = (a0 + ((y + sprY) & 0xFF)) & 0xFFFF;
    a1 = (a1 + ((x + sprX) & 0x1FF)) & 0xFFFF;
    if (a0 & 0x2000) a2 = (a2 + (a2 & 0x3FF)) & 0xFFFF;
    a2 = (a2 + ((s.tiles - OBJ_VRAM) >> 5)) & 0xFFFF;
    m[k * 4] = a0;
    m[k * 4 + 1] = a1;
    m[k * 4 + 2] = a2;
  }
}
