// A PlayStation 2 game's draw lists, read from the file the console's emulator writes them to when asked (the tools'
// patch to Play!, libretro/play.patch): everything the original gave its graphics chip, the GS, frame by frame. Each
// thing is a letter and what was written: 'R' a register and its 64 bits, 'S' an address and half of one of the screen's
// registers, 'I' a picture's length and the hash of its bytes, which never leave the emulator, 'P' the path the register
// writes after it came by, and 'F' the end of a frame. `summaryOf` counts what a game's lists hold, which is what its
// Dreamport's kit has to draw (kit/ps2/c/README.md). Nothing from a game is in what it counts but numbers.

/** The GS's registers by number, as kit/ps2/c/ps2.h names them. */
export const REGISTERS = {
  0x00: 'PRIM', 0x01: 'RGBAQ', 0x02: 'ST', 0x03: 'UV', 0x04: 'XYZF2', 0x05: 'XYZ2', 0x06: 'TEX0_1', 0x07: 'TEX0_2', 0x08: 'CLAMP_1', 0x09: 'CLAMP_2',
  0x0A: 'FOG', 0x0C: 'XYZF3', 0x0D: 'XYZ3', 0x14: 'TEX1_1', 0x15: 'TEX1_2', 0x16: 'TEX2_1', 0x17: 'TEX2_2', 0x18: 'XYOFFSET_1', 0x19: 'XYOFFSET_2',
  0x1A: 'PRMODECONT', 0x1B: 'PRMODE', 0x1C: 'TEXCLUT', 0x22: 'SCANMSK', 0x34: 'MIPTBP1_1', 0x35: 'MIPTBP1_2', 0x36: 'MIPTBP2_1', 0x37: 'MIPTBP2_2',
  0x3B: 'TEXA', 0x3D: 'FOGCOL', 0x3F: 'TEXFLUSH', 0x40: 'SCISSOR_1', 0x41: 'SCISSOR_2', 0x42: 'ALPHA_1', 0x43: 'ALPHA_2', 0x44: 'DIMX', 0x45: 'DTHE',
  0x46: 'COLCLAMP', 0x47: 'TEST_1', 0x48: 'TEST_2', 0x49: 'PABE', 0x4A: 'FBA_1', 0x4B: 'FBA_2', 0x4C: 'FRAME_1', 0x4D: 'FRAME_2', 0x4E: 'ZBUF_1',
  0x4F: 'ZBUF_2', 0x50: 'BITBLTBUF', 0x51: 'TRXPOS', 0x52: 'TRXREG', 0x53: 'TRXDIR', 0x54: 'HWREG', 0x60: 'SIGNAL', 0x61: 'FINISH', 0x62: 'LABEL',
};
const SCREEN = { 0x00: 'PMODE', 0x20: 'SMODE2', 0x70: 'DISPFB1', 0x80: 'DISPLAY1', 0x90: 'DISPFB2', 0xA0: 'DISPLAY2' };
/** The console's pixel formats, by the number a register gives. */
export const FORMATS = {
  0x00: '32-bit', 0x01: '24-bit', 0x02: '16-bit', 0x0A: '16-bit (S)', 0x13: '8-bit with a palette', 0x14: '4-bit with a palette', 0x1B: '8-bit in the alpha',
  0x24: '4-bit in the alpha, high', 0x2C: '4-bit in the alpha, low', 0x30: '32-bit depth', 0x31: '24-bit depth', 0x32: '16-bit depth', 0x3A: '16-bit depth (S)',
};
const SHAPES = ['points', 'lines', 'line strips', 'triangles', 'triangle strips', 'triangle fans', 'sprites', 'nothing'];
const CORNERS = [1, 2, 2, 3, 3, 3, 2, 0], NEXT = [1, 2, 1, 3, 1, 1, 2, 0];
const PATHS = { 1: 'from vector unit 1', 2: 'from the main processor, through the vector unit\'s interface', 3: 'from the main processor, through the GIF' };
const TESTS = ['never', 'always', 'as near or nearer', 'nearer'];
const ALPHA_TESTS = ['never', 'always', 'less', 'less or equal', 'equal', 'greater or equal', 'greater', 'not equal'];
const TEXTURE_FUNCTIONS = ['modulate', 'decal', 'highlight', 'highlight 2'];
const FILTERS = ['nearest', 'linear', 'nearest, nearest mip', 'nearest, linear mip', 'linear, nearest mip', 'linear, linear mip'];
const DIRECTIONS = ['to the GS', 'back from the GS', 'within the GS', 'none'];

/** Each thing in a dump, in order: { kind, register, value } for a register, { kind, address, value }, { kind, length,
 *  hash }, { kind, path } and { kind: 'F' }. */
export function* thingsIn(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 0; at < bytes.length;) {
    const kind = String.fromCharCode(bytes[at++]);
    if (kind === 'R') { yield { kind, register: bytes[at], value: view.getBigUint64(at + 1, true) }; at += 9; }
    else if (kind === 'S') { yield { kind, address: view.getUint32(at, true), value: view.getUint32(at + 4, true) }; at += 8; }
    else if (kind === 'I') { yield { kind, length: view.getUint32(at, true), hash: view.getUint32(at + 4, true) }; at += 8; }
    else if (kind === 'P') { yield { kind, path: bytes[at] }; at += 1; }
    else if (kind === 'F') yield { kind };
    else throw new Error(`The draw lists' file has something that isn't one: ${JSON.stringify(kind)} at byte ${at - 1}.`);
  }
}

const bump = (counts, key, by = 1) => { counts[key] = (counts[key] ?? 0) + by; };
const bits = (value, from, length) => Number(value >> BigInt(from) & ((1n << BigInt(length)) - 1n));

/** What the lists in a dump hold, over the frames from `from` to `to`: counts by name, ready to print. */
export function summaryOf(bytes, { from = 0, to = Infinity } = {}) {
  const found = {
    frames: 0, writes: 0, most: 0, registers: {}, paths: {}, shapes: {}, drawn: {}, textures: {}, textureSizes: {}, palettes: {}, textureFunctions: {}, filters: {},
    mips: {}, clamps: {}, blends: {}, depthTests: {}, alphaTests: {}, targets: {}, depths: {}, transfers: {}, transferFormats: {}, pictures: 0, pictureBytes: 0,
    screen: {}, other: {},
  };
  const held = new Map();   // each register's last value
  const reg = number => held.get(number) ?? 0n;
  let frame = 0, inFrame = 0, path = 0, corners = 0, kind = 7;
  const wanted = () => frame >= from && frame <= to;
  const prim = () => (reg(0x1A) & 1n ? reg(0x00) : (reg(0x00) & 7n) | (reg(0x1B) & ~7n));
  // a shape drawn: what kind it is, how, and what it's drawn with, from the registers as they stand
  const shape = () => {
    const p = prim(), context = bits(p, 9, 1), textured = bits(p, 4, 1);
    bump(found.shapes, SHAPES[kind]);
    const how = [bits(p, 3, 1) ? 'shaded between corners' : 'one colour', textured && 'textured', bits(p, 5, 1) && 'fogged', bits(p, 6, 1) && 'blended', bits(p, 7, 1) && 'antialiased'].filter(Boolean);
    for (const way of how) bump(found.drawn, way);
    if (textured) {
      bump(found.drawn, bits(p, 8, 1) ? 'texture places as whole texels (UV)' : 'texture places as floats (ST)');
      const tex0 = reg(0x06 + context), tex1 = reg(0x14 + context), clamp = reg(0x08 + context);
      const format = bits(tex0, 20, 6);
      bump(found.textures, FORMATS[format] ?? `format 0x${format.toString(16)}`);
      bump(found.textureSizes, `${1 << bits(tex0, 26, 4)} by ${1 << bits(tex0, 30, 4)}`);
      if (format === 0x13 || format === 0x14 || format === 0x1B || format === 0x24 || format === 0x2C) bump(found.palettes, `${FORMATS[bits(tex0, 51, 4)] ?? 'another format'}, ${bits(tex0, 55, 1) ? 'in a row (CSM2)' : 'in a block (CSM1)'}`);
      bump(found.textureFunctions, `${TEXTURE_FUNCTIONS[bits(tex0, 35, 2)]}${bits(tex0, 34, 1) ? ', with the texture\'s alpha' : ''}`);
      bump(found.filters, `larger: ${FILTERS[bits(tex1, 5, 1)]}; smaller: ${FILTERS[bits(tex1, 6, 3)] ?? 'another'}`);
      bump(found.mips, `${bits(tex1, 2, 3)} smaller copies`);
      bump(found.clamps, `across: ${['repeat', 'clamp', 'clamp to a region', 'repeat a region'][bits(clamp, 0, 2)]}; down: ${['repeat', 'clamp', 'clamp to a region', 'repeat a region'][bits(clamp, 2, 2)]}`);
    }
    if (bits(p, 6, 1)) {
      const alpha = reg(0x42 + context), names = ['source', 'framebuffer', 'zero', 'zero'], by = ['source alpha', 'framebuffer alpha', 'a fixed alpha', 'a fixed alpha'];
      bump(found.blends, `(${names[bits(alpha, 0, 2)]} - ${names[bits(alpha, 2, 2)]}) × ${by[bits(alpha, 4, 2)]} + ${names[bits(alpha, 6, 2)]}`);
    }
    const test = reg(0x47 + context), frameReg = reg(0x4C + context), zbuf = reg(0x4E + context);
    bump(found.depthTests, bits(test, 16, 1) ? `${TESTS[bits(test, 17, 2)]}${bits(zbuf, 32, 1) ? ', no depth written' : ''}` : 'off');
    if (bits(test, 0, 1)) bump(found.alphaTests, `${ALPHA_TESTS[bits(test, 1, 3)]}, failing: ${['keep', 'colour only', 'depth only', 'colour without alpha'][bits(test, 12, 2)]}`);
    if (bits(test, 14, 1)) bump(found.alphaTests, 'by the framebuffer\'s alpha');
    bump(found.targets, `${FORMATS[bits(frameReg, 24, 6)] ?? 'another format'}, ${bits(frameReg, 16, 6) * 64} wide${bits(frameReg, 32, 32) ? ', some bits masked' : ''}`);
    bump(found.depths, FORMATS[0x30 | bits(zbuf, 24, 4)] ?? 'another format');
  };
  for (const thing of thingsIn(bytes)) {
    if (thing.kind === 'F') {
      if (wanted()) { found.frames++; found.most = Math.max(found.most, inFrame); }
      frame++;
      inFrame = 0;
      continue;
    }
    if (thing.kind === 'P') { path = thing.path; continue; }
    inFrame++;
    if (wanted()) found.writes++;
    if (thing.kind === 'S') {
      if (wanted()) bump(found.screen, SCREEN[thing.address & 0xF0] ?? 'another');
      continue;
    }
    if (thing.kind === 'I') {
      if (wanted()) { found.pictures++; found.pictureBytes += thing.length; }
      continue;
    }
    const { register, value } = thing;
    held.set(register, value);
    if (wanted()) {
      bump(found.registers, REGISTERS[register] ?? `0x${register.toString(16)}`);
      bump(found.paths, PATHS[path] ?? 'unknown');
    }
    if (register === 0x00) { corners = 0; kind = bits(prim(), 0, 3); }
    else if (register === 0x04 || register === 0x05 || register === 0x0C || register === 0x0D) {
      kind = bits(prim(), 0, 3);
      if (++corners >= CORNERS[kind] && CORNERS[kind]) {
        if (wanted() && register < 0x0C) shape();
        corners = CORNERS[kind] - NEXT[kind];
      }
    } else if (register === 0x53 && wanted()) {
      bump(found.transfers, DIRECTIONS[bits(value, 0, 2)]);
      const buffers = reg(0x50);
      bump(found.transferFormats, FORMATS[bits(buffers, 56, 6)] ?? `format 0x${bits(buffers, 56, 6).toString(16)}`);
    } else if (wanted()) {
      if (register === 0x0A || register === 0x3D) bump(found.other, 'fog set');
      if (register === 0x45 && value & 1n) bump(found.other, 'dithering on');
      if (register === 0x49 && value & 1n) bump(found.other, 'blending pixel by pixel (PABE)');
      if ((register === 0x4A || register === 0x4B) && value & 1n) bump(found.other, 'alpha forced on (FBA)');
      if (register === 0x22 && value & 3n) bump(found.other, 'lines skipped (SCANMSK)');
      if (register === 0x60 || register === 0x61 || register === 0x62) bump(found.other, 'signals to the game (SIGNAL, FINISH, LABEL)');
    }
  }
  return found;
}
