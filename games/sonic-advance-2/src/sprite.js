// Sprites as the engine runs them, on Sonic Advance Dreamport's src/gba/sprite.js, with what Sonic Advance 2 does: a
// sprite keeps the place of its frame in the dimensions table, and a frame's flips are a byte of their own. The scripts
// and frames are the ROM's sprite tables, at 0x080F40D4 (0x0801A51C, GameInit, loads the address).

const TABLES = 0xF40D4;
const OBJ_SIZES = [[8, 8], [16, 16], [32, 32], [64, 64], [16, 8], [32, 8], [32, 16], [64, 32], [8, 16], [8, 32], [16, 32], [32, 64]];
const OBJ_VRAM = 0x10000;
const RUNNING = 1, ANIM_CHANGED = -1, ENDED = 0;
/** In a sprite's `frameFlags`, once its animation has ended. */
export const ANIM_OVER = 0x4000;
const s16 = v => (v << 16) >> 16;
/** What a sprite's `frameFlags` say. */
export const SPRITE = { ROT_SCALE: 0x1F, ROT_SCALE_ENABLE: 0x20, DOUBLE_SIZE: 0x40, OBJ_MODE: 0x180, X_FLIP: 0x400, Y_FLIP: 0x800, PRIORITY: 0x3000 };

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
      const palette = s.backgroundColours ? c.bgPalette : c.objPalette;
      for (let i = 0; i < count; i++) palette[(s.palId * 16 + insert + i) & 0xFF] = rom.u16(from + i * 2);
      c.flags |= s.backgroundColours ? 0x1 : 0x2;
      return RUNNING;
    }
    case -3: s.animCursor = (s.animCursor - rom.s32(at + 4)) & 0xFFFF; return RUNNING;   // JumpBack
    case -4: s.frameFlags |= ANIM_OVER; return ENDED;                                    // End
    case -5: s.animCursor += 2; c.playSong(rom.u16(at + 4)); return RUNNING;             // PlaySoundEffect
    case -6: {                                                                           // AddHitbox, all zeros taking it away
      s.animCursor += 3;
      const [left, top, right, bottom] = [8, 9, 10, 11].map(i => (rom.u8(at + i) << 24) >> 24);
      // a sprite that's turned has its box turned with it
      const box = { left: s.frameFlags & SPRITE.X_FLIP ? -right : left, top: s.frameFlags & SPRITE.Y_FLIP ? -bottom : top, right: s.frameFlags & SPRITE.X_FLIP ? -left : right, bottom: s.frameFlags & SPRITE.Y_FLIP ? -top : bottom };
      (s.boxes ??= [])[rom.u32(at + 4) % 16] = box;   // which stays as it was, for what reads it with the box switched off
      (s.hitboxes ??= [])[rom.u32(at + 4) % 16] = left === 0 && top === 0 && right === 0 && bottom === 0 ? null : box;
      return RUNNING;
    }
    case -7: s.animCursor += 2; s.x = s16(s.x + rom.s16(at + 4)); s.y = s16(s.y + rom.s16(at + 6)); return RUNNING;
    case -8: s.animCursor += 3; return RUNNING;
    case -9:                                                                             // SetIdAndVariant
      s.animCursor += 2;
      s.anim = rom.u16(at + 4);
      s.prevVariant = 0xFF;
      s.variant = rom.u16(at + 6) & 0xFF;
      return ANIM_CHANGED;
    case -10: s.animCursor += 4; return RUNNING;
    case -11: s.animCursor += 2; s.frameFlags = (s.frameFlags & ~SPRITE.PRIORITY) | (rom.u32(at + 4) << 12); return RUNNING;
    case -12: s.animCursor += 2; s.oamFlags = (rom.u32(at + 4) << 6) & 0xFFFF; return RUNNING;
    default: throw new Error(`Animation command ${id} isn't known.`);
  }
}

/** 0x080051E8, DisplaySprite: the sprite's frame into OAM at (x, y), if any of it is on screen. */
export function displaySprite(c, s) {
  if (s.dimensions === -1) return;
  const { rom } = c, d = s.dimensions, ff = s.frameFlags;
  const flip = rom.u8(d), oamIndex = rom.u8(d + 1), pieces = rom.u16(d + 2);
  let w = rom.u16(d + 4), h = rom.u16(d + 6), x = s.x, y = s.y;
  const turns = ff & SPRITE.ROT_SCALE_ENABLE, doubled = turns && ff & SPRITE.DOUBLE_SIZE;
  if (doubled) {
    x -= w >> 1;
    y -= h >> 1;
    w *= 2;
    h *= 2;
  } else if (!turns) {
    y -= ff & SPRITE.Y_FLIP ? h - rom.s16(d + 10) : rom.s16(d + 10);
    x -= ff & SPRITE.X_FLIP ? w - rom.s16(d + 8) : rom.s16(d + 8);
  }
  if (!(x + w >= 0 && x <= 240 && y + h >= 0 && y <= 160)) return;
  const oamData = rom.u32(table(c, OAM_DATA) + s.anim * 4) - 0x08000000;
  const order = (s.oamFlags & 0x7C0) >> 6, m = c.oamMalloc;
  for (let i = 0; i < pieces; i++) {
    const k = c.allocOam(order);
    if (k < 0) return;
    if (i === 0) s.oamBaseIndex = k;
    const src = oamData + (oamIndex + i) * 6;
    let a0 = rom.u16(src), a1 = rom.u16(src + 2), a2 = rom.u16(src + 4);
    let sprX = a1 & 0x1FF, sprY = a0 & 0xFF;
    a1 &= 0xFE00;
    a0 &= 0xFE00;
    a2 = (a2 + (s.palId << 12)) & 0xFFFF;
    if (turns) {
      a0 |= doubled ? 0x300 : 0x100;
      a1 |= (ff & SPRITE.ROT_SCALE) << 9;
    } else {
      const [sw, sh] = OBJ_SIZES[((a0 & 0xC000) >> 12) | ((a1 & 0xC000) >> 14)];
      if (((flip >> 1) ^ (ff >> 11)) & 1) {
        a1 ^= 0x2000;
        sprY = h - sh - sprY;
      }
      if (((ff >> 10) & 1) !== (flip & 1)) {
        a1 ^= 0x1000;
        sprX = w - sw - sprX;
      }
    }
    a0 |= (ff & SPRITE.OBJ_MODE) * 8;
    a2 |= (ff & SPRITE.PRIORITY) >> 2;
    a0 = (a0 + ((y + sprY) & 0xFF)) & 0xFFFF;
    a1 = (a1 + ((x + sprX) & 0x1FF)) & 0xFFFF;
    if (a0 & 0x2000) a2 = (a2 + (a2 & 0x3FF)) & 0xFFFF;
    a2 = (a2 + ((s.tiles - OBJ_VRAM) >> 5)) & 0xFFFF;
    m[k * 4] = a0;
    m[k * 4 + 1] = a1;
    m[k * 4 + 2] = a2;
  }
}

const inverse = scale => Math.trunc(0x10000 / scale);

/** TransformSprite: `turn`'s rotation and scale into the sprite's affine slot in OAM, and where to draw it so that its anchor stays at (turn.x, turn.y). */
export function transformSprite(c, s, turn, sine) {
  if (s.dimensions === -1) return;
  const { rom } = c, d = s.dimensions, slot = (s.frameFlags & SPRITE.ROT_SCALE) * 16 + 3, angle = turn.rotation & 0x3FF;
  const cos = sine[angle + 256] >> 6, sin = sine[angle] >> 6;
  [(cos * inverse(turn.scaleX)) >> 8, (sin * inverse(turn.scaleX)) >> 8, (-sin * inverse(turn.scaleY)) >> 8, (cos * inverse(turn.scaleY)) >> 8]
    .forEach((value, i) => { c.oamBuffer[slot + i * 4] = value & 0xFFFF; });
  const sizeX = Math.abs(turn.scaleX), sizeY = Math.abs(turn.scaleY), w = rom.u16(d + 4), h = rom.u16(d + 6);
  // the anchor, from the frame's middle, turned and scaled as the picture is
  const fromMiddleX = (turn.scaleX > 0 ? rom.s16(d + 8) : w - rom.s16(d + 8)) - (w >> 1);
  const fromMiddleY = (turn.scaleY > 0 ? rom.s16(d + 10) : h - rom.s16(d + 10)) - (h >> 1);
  s.x = turn.x - ((((cos * sizeX) >> 8) * fromMiddleX + ((-sin * sizeX) >> 8) * fromMiddleY + ((w >> 1) << 8)) >> 8);
  s.y = turn.y - ((((sin * sizeY) >> 8) * fromMiddleX + ((cos * sizeY) >> 8) * fromMiddleY + ((h >> 1) << 8)) >> 8);
}
