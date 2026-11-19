// Small PlayStation 2 programs with nothing from any game in them, written here, for what the GS can be asked to do
// (kit/ps2/c/gs.c), each run on the console's real emulator and as a Dreamport in C on the kit (ps2-gs.mjs). Each is a
// list of steps, the same for both: what goes into the console's memory with the program, what it does as it starts, and
// what it does each frame, the frames taking turns. A step sends a packet to the GIF, reads a picture back from the GS
// into a packet's place, or writes half of one of the GS's privileged registers. The EE program does each step as a
// game does, by DMA and by storing to the register, and the Dreamport does the same steps through the kit
// (made-up-ps2-gs.c), so the two give the GS the same things in the same order.
//
// The first, madeUpPs2Layout, is about the GS's memory: pictures moved in in one format and read in another, as
// textures and as pictures read back, so every format's own order of its pixels is tried, palettes in their blocks,
// in a row and in each of the palette buffer's places, and when CLD loads one. The emulator keeps its memory as the
// chip does and reads textures and pictures back from it exactly, but widens a 16-bit texel to 32 bits its own way, so
// it comes in two: one that draws into a 32-bit framebuffer what has no 16-bit colours, and one that draws into a
// 16-bit framebuffer what has.

import { ZERO, T0, T1, T2, T3, addiu, andi, lw, sw, li, here, beq, bne, j, NOP, GIF_DMA, VIF1_DMA, MADR, QWC, WIDTH, HEIGHT, FBW, setUp, waitForVBlank, elfOf } from './made-up-ps2.mjs';

// ---- Packets for the GIF, as 32-bit words

const writesTag = (count, ends = false) => [count | (ends ? 0x8000 : 0), 0x10000000, 0xE, 0];
const imageTag = (qwords, ends = false) => [qwords | (ends ? 0x8000 : 0), 0x08000000, 0, 0];
const write = (register, low, high = 0) => [low >>> 0, high >>> 0, register, 0];
const writes = (list, ends = false) => [...writesTag(list.length, ends), ...list.flat()];
const padded = data => [...data, ...Array((4 - data.length % 4) % 4).fill(0)];

/** The GS's formats, as its registers give them. */
export const PSM = { CT32: 0x00, CT24: 0x01, CT16: 0x02, CT16S: 0x0A, T8: 0x13, T4: 0x14, T8H: 0x1B, T4HL: 0x24, T4HH: 0x2C, Z32: 0x30, Z24: 0x31, Z16: 0x32, Z16S: 0x3A };
const BITS = { [PSM.CT24]: 24, [PSM.Z24]: 24, [PSM.CT16]: 16, [PSM.CT16S]: 16, [PSM.Z16]: 16, [PSM.Z16S]: 16, [PSM.T8]: 8, [PSM.T8H]: 8, [PSM.T4]: 4, [PSM.T4HL]: 4, [PSM.T4HH]: 4 };
const bitsOf = format => BITS[format] ?? 32;
// how many 64-pixel columns a page is across: two for the 8 and 4-bit formats, whose pages are 128 pixels wide
const pageColumns = format => format === PSM.T8 || format === PSM.T4 ? 2 : 1;
/** How many 16-byte pieces a picture of `w` by `h` pixels takes in a transfer. */
export const qwordsOf = (format, w, h) => Math.ceil(w * h * bitsOf(format) / 128);

// BITBLTBUF's destination or source, TRXPOS's place for it, TRXREG's size and TRXDIR
const to = ({ block, width, format }) => write(0x50, 0, block | width << 16 | format << 24);
const from = ({ block, width, format }) => write(0x50, block | width << 16 | format << 24, 0);
const size = (w, h) => write(0x52, w, h);

/** Pixels packed as a transfer has them, each one's bits after the last's, from the lowest bit of the first byte. */
export function pack(format, pixels) {
  const bits = bitsOf(format), bytes = new Uint8Array(Math.ceil(pixels.length * bits / 8));
  let held = 0n, count = 0, at = 0;
  for (const pixel of pixels) {
    held |= BigInt(pixel >>> 0) << BigInt(count);
    count += bits;
    while (count >= 8) { bytes[at++] = Number(held & 0xFFn); held >>= 8n; count -= 8; }
  }
  if (count) bytes[at] = Number(held & 0xFFn);
  const words = Array.from({ length: Math.ceil(bytes.length / 4) }, (_, i) => (bytes[i * 4] | (bytes[i * 4 + 1] ?? 0) << 8 | (bytes[i * 4 + 2] ?? 0) << 16 | (bytes[i * 4 + 3] ?? 0) << 24) >>> 0);
  return padded(words);
}

/** A packet that moves a picture of `w` by `h` pixels into the GS's memory, to `buffer` at (x, y), and where in it the
 *  picture's data starts, in words. */
export function upload(buffer, x, y, w, h, pixels) {
  const data = pack(buffer.format, pixels);
  return [...writes([to(buffer), write(0x51, 0, x | y << 16), size(w, h), write(0x53, 0)]), ...imageTag(data.length / 4, true), ...data];
}
const UPLOAD_DATA = 24;
/** A packet that starts moving one out of it, from `buffer` at (x, y). */
export const readOut = (buffer, x, y, w, h) => writes([from(buffer), write(0x51, x | y << 16, 0), size(w, h), write(0x53, 1)], true);

// ---- Drawing

const XY = (x, y) => (x << 4 | y << 20) >>> 0;
const UV = (u, v) => (u << 4 | v << 20) >>> 0;
const log2 = n => Math.ceil(Math.log2(n));
/** TEX0: a texture in `buffer`, `w` by `h` texels at most, its palette in `palette`, as decal, so a pixel is its texel. */
function tex0(buffer, w, h, { palette, csm = 0, csa = 0, cld = 0 } = {}) {
  const tw = log2(w), th = log2(h);
  const low = buffer.block | buffer.width << 14 | buffer.format << 20 | tw << 26 | (th & 3) << 30;
  const high = th >> 2 | 1 << 2 | 1 << 3 | (palette?.block ?? 0) << 5 | (palette?.format ?? 0) << 19 | csm << 23 | csa << 24 | cld << 29;
  return write(0x06, low, high);
}
/** A sprite at (x, y) showing the texture's texels from (0, 0) at their size, one pixel each. */
const sprite = (x, y, w, h) => [write(0x03, UV(0, 0)), write(0x05, XY(x, y)), write(0x03, UV(w, h)), write(0x05, XY(x + w, y + h))];
/** Where each picture goes on the screen: as high as it can go, the leftmost of the places as high, a pixel apart. */
function placer() {
  const top = Array(WIDTH).fill(0);
  return (w, h) => {
    let best = null;
    for (let x = 0; x + w <= WIDTH; x++) {
      const y = Math.max(...top.slice(x, x + w));
      if (!best || y < best[1]) best = [x, y];
    }
    if (!best || best[1] + h > HEIGHT) throw new Error(`no room on the screen for ${w} by ${h}`);
    for (let x = best[0]; x < Math.min(WIDTH, best[0] + w + 1); x++) top[x] = best[1] + h + 1;
    return best;
  };
}
/** The writes that start a frame: drawing into `frame` (a page and a format), cleared to `background`. */
const startFrame = (page, format, background) => [
  write(0x4C, page | FBW << 16 | format << 24), write(0x40, (WIDTH - 1) << 16, (HEIGHT - 1) << 16), write(0x18, 0), write(0x4E, 0, 1),
  write(0x1A, 1), write(0x47, 0x30000), write(0x3B, 0x80, 0x80), write(0x14, 0), write(0x08, 0), write(0x3F, 0),
  write(0x00, 6), write(0x01, background, 0x3F800000), write(0x05, XY(0, 0)), write(0x05, XY(WIDTH, HEIGHT)),
  write(0x00, 6 | 1 << 4 | 1 << 8), write(0x01, 0x80808080, 0x3F800000),
];

// ---- A program as steps, and the EE program that does them

/** A program's memory, steps and ELF file, its screen showing the framebuffer at 0 in `shownFormat`. `build` gets
 *  `place(words)`, which puts words in the program's memory on a 16-byte boundary and gives where, in words from its
 *  start. */
function program(build, shownFormat = PSM.CT32) {
  const blob = [];
  const place = list => {
    const at = blob.length;
    blob.push(...padded(list));
    return at;
  };
  const { start, frames } = build(place);
  const made = elfOf(at => code(at, shownFormat, start, frames), blob);
  return { ...made, blob, start, frames, shownFormat };
}

const GS_BUSDIR = 0x12001040, VIF1_STAT = 0x10003C00, FDR = 0x00800000;
// a DMA transfer of `qwords` from or to the address in T2, on the channel at `channel`, waiting until it's done
const dma = (channel, qwords, chcr, name) => [
  ...li(T0, channel), sw(T2, MADR, T0), ...li(T1, qwords), sw(T1, QWC, T0), addiu(T1, ZERO, chcr), sw(T1, 0, T0),
  here(name), lw(T3, 0, T0), andi(T3, T3, 0x100), bne(T3, ZERO, name), NOP,
];
let names = 0;
function stepCode(blobAt, step) {
  const name = `step${names++}`;
  if (step.gif !== undefined) return [...li(T2, blobAt + step.gif * 4), ...dma(GIF_DMA, step.qwords, 0x101, name)];
  if (step.read !== undefined) {
    // as a game reads a picture back: the bus turned round, VIF1's FIFO towards memory, and VIF1's DMA into memory
    return [
      ...li(T0, GS_BUSDIR), addiu(T1, ZERO, 1), sw(T1, 0, T0), ...li(T0, VIF1_STAT), ...li(T1, FDR), sw(T1, 0, T0),
      ...li(T2, blobAt + step.read * 4), ...dma(VIF1_DMA, step.qwords, 0x100, name),
      ...li(T0, VIF1_STAT), sw(ZERO, 0, T0), ...li(T0, GS_BUSDIR), sw(ZERO, 0, T0),
    ];
  }
  return [...li(T0, step.screen), ...li(T1, step.value), sw(T1, 0, T0)];
}
function code(blobAt, shownFormat, start, frames) {
  names = 0;
  const S2 = 18;
  const turns = frames.flatMap((steps, i) => [
    here(`turn${i}`), ...steps.flatMap(step => stepCode(blobAt, step)), j('next'), NOP,
  ]);
  return [
    ...setUp(blobAt, shownFormat), ...start.flatMap(step => stepCode(blobAt, step)), addiu(S2, ZERO, 0),
    here('frame'),
    ...waitForVBlank,
    ...frames.flatMap((_, i) => [addiu(T1, ZERO, i), beq(S2, T1, `turn${i}`), NOP]),
    ...turns,
    here('next'),
    addiu(S2, S2, 1), addiu(T1, ZERO, frames.length), bne(S2, T1, 'frame'), NOP, addiu(S2, ZERO, 0), j('frame'), NOP,
  ];
}
const gif = (at, list) => ({ gif: at, qwords: list.length / 4 });

// ---- The memory program

// a number for each pixel, different in every bit from its neighbours'
const mixed = n => {
  let v = Math.imul(n + 0x3C6EF372, 0x9E3779B1) >>> 0;
  v = Math.imul(v ^ v >>> 15, 0x85EBCA77) >>> 0;
  return (v ^ v >>> 13) >>> 0;
};
const pattern = (count, bits, seed) => Array.from({ length: count }, (_, n) => bits === 32 ? mixed(n + seed * 0x10000) : mixed(n + seed * 0x10000) & (1 << bits) - 1);
// a palette entry, each channel and the alpha from its index
const entry32 = (i, seed) => (mixed(i * 3 + seed) | 0x80000000) >>> 0;
const entry16 = (i, seed) => mixed(i * 5 + seed) & 0xFFFF;
// a palette of 256 in a 16 by 16 square, entries 8 to 15 and 16 to 23 changing places in every 32, as CSM1 keeps it
const squareOrder = entries => Array.from({ length: 256 }, (_, j) => entries[(j & ~0x18) | (j & 8) << 1 | (j & 16) >> 1]);

/** Where each picture is in the GS's memory, in pages past the two framebuffers, as a 32 or 16-bit buffer one page
 *  across, or an 8 or 4-bit one, whose pages are twice as wide. */
const PAGE = 210, BLOCK = PAGE * 32;
const at = (page, format) => ({ block: page * 32, width: pageColumns(format), format });
export const AREAS = {
  a: at(PAGE, PSM.CT32), b: at(PAGE + 2, PSM.T8), c: at(PAGE + 4, PSM.T4), d: at(PAGE + 5, PSM.CT16), e: at(PAGE + 6, PSM.CT16S),
  f: at(PAGE + 7, PSM.CT32), g: at(PAGE + 8, PSM.CT32),
};
const view = (area, format) => ({ block: area.block, width: pageColumns(format), format });
// the palettes, each in blocks of its own, from the page after the pictures, a palette in a row two pages on, and the
// pictures read back and moved in again after that, a page each
const PALETTES = BLOCK + 9 * 32, ROW = BLOCK + 12 * 32, READ_BACK = BLOCK + 18 * 32;
const palette = (n, format) => ({ block: PALETTES + n * 4, width: 1, format });

/** The memory program drawing into a framebuffer of `depth` bits, 32 or 16. */
export function madeUpPs2Layout(depth) {
  return program(place => {
    const start = [], frame = [];
    const sendOnce = list => start.push(gif(place(list), list));
    // the pictures, each in its own format
    sendOnce(upload(AREAS.a, 0, 0, 64, 64, pattern(64 * 64, 32, 1)));
    sendOnce(upload(AREAS.b, 0, 0, 128, 128, pattern(128 * 128, 8, 2)));
    sendOnce(upload(AREAS.c, 0, 0, 128, 128, pattern(128 * 128, 4, 3)));
    sendOnce(upload(AREAS.d, 0, 0, 64, 64, pattern(64 * 64, 16, 4)));
    sendOnce(upload(AREAS.e, 0, 0, 64, 64, pattern(64 * 64, 16, 5)));
    // a 24-bit picture over a 32-bit one, whose top bytes stay
    sendOnce(upload(AREAS.f, 0, 0, 64, 32, pattern(64 * 32, 32, 6)));
    sendOnce(upload({ ...AREAS.f, format: PSM.CT24 }, 0, 0, 64, 32, pattern(64 * 32, 24, 7)));
    // and 8 and 4 bits into a 32-bit picture's top byte, its top half and its low half of it
    sendOnce(upload(AREAS.g, 0, 0, 64, 32, pattern(64 * 32, 32, 8)));
    sendOnce(upload({ ...AREAS.g, format: PSM.T8H }, 0, 0, 32, 32, pattern(32 * 32, 8, 9)));
    sendOnce(upload({ ...AREAS.g, format: PSM.T4HL }, 32, 0, 32, 16, pattern(32 * 16, 4, 10)));
    sendOnce(upload({ ...AREAS.g, format: PSM.T4HH }, 32, 16, 32, 16, pattern(32 * 16, 4, 11)));
    // palettes: 256 of 32 bits and of 16 bits in their squares, 16 of each for 4-bit textures, and 256 of 16 bits in a row
    const p8 = palette(0, PSM.CT32), p8s = palette(1, PSM.CT16), p8ss = palette(2, PSM.CT16S);
    sendOnce(upload(p8, 0, 0, 16, 16, squareOrder(Array.from({ length: 256 }, (_, i) => entry32(i, 1)))));
    sendOnce(upload(p8s, 0, 0, 16, 16, squareOrder(Array.from({ length: 256 }, (_, i) => entry16(i, 2)))));
    sendOnce(upload(p8ss, 0, 0, 16, 16, squareOrder(Array.from({ length: 256 }, (_, i) => entry16(i, 3)))));
    const p4 = n => palette(4 + n, n < 4 ? PSM.CT32 : PSM.CT16);
    for (let n = 0; n < 8; n++) sendOnce(upload(p4(n), 0, 0, 8, 2, Array.from({ length: 16 }, (_, i) => n < 4 ? entry32(i, 10 + n) : entry16(i, 10 + n))));
    const row = { block: ROW, width: 5, format: PSM.CT16 };
    sendOnce(upload(row, 16, 3, 256, 1, Array.from({ length: 256 }, (_, i) => entry16(i, 20))));

    if (depth === 16) return { start, frames: [[...frame, ...frame16(place, { p8s, p8ss, p4, row })]] };

    // read back, every frame, 32 by 32 pixels of the 32-bit picture in each format, and moved in again as 32-bit
    // pictures to draw: what's read is in the frame's draw list, as the data of the next picture
    const reads = [PSM.CT32, PSM.CT24, PSM.CT16, PSM.T8, PSM.T8H, PSM.Z32, PSM.Z24, PSM.Z16S].map((format, n) => {
      const qwords = qwordsOf(format, 32, 32), w = 32, h = qwords * 4 / w, target = { block: READ_BACK + n * 32, width: 1, format: PSM.CT32 };
      return { format, qwords, w, h, target };
    });
    for (const read of reads) {
      const out = readOut(view(AREAS.a, read.format), 16, 8, 32, 32);
      frame.push(gif(place(out), out));
      const back = upload(read.target, 0, 0, read.w, read.h, Array(read.w * read.h).fill(0));
      const where = place(back);
      frame.push({ read: where + UPLOAD_DATA, qwords: read.qwords }, gif(where, back));
    }

    // the 32-bit frame: every view with no 16-bit colours in it
    const room = placer(), drawn = [];
    const show = (texture, w, h, options) => {
      const [x, y] = room(w, h);
      drawn.push(tex0(texture, w, h, options), ...sprite(x, y, w, h));
    };
    show(view(AREAS.a, PSM.CT32), 64, 64);
    show(view(AREAS.a, PSM.T8), 128, 128, { palette: p8, cld: 1 });
    show(view(AREAS.a, PSM.T4), 128, 256, { palette: p4(0), cld: 1 });
    for (const format of [PSM.T8H, PSM.T4HL, PSM.T4HH]) show(view(AREAS.a, format), 64, 64, { palette: format === PSM.T8H ? p8 : p4(1), cld: 1 });
    show(view(AREAS.b, PSM.CT32), 64, 64);
    show(view(AREAS.b, PSM.T4), 128, 256, { palette: p4(2), cld: 1 });
    show(view(AREAS.c, PSM.T8), 128, 64, { palette: p8, cld: 1 });
    show(view(AREAS.c, PSM.CT32), 64, 32);
    show(view(AREAS.d, PSM.CT32), 64, 32);
    show(view(AREAS.d, PSM.T8), 128, 64, { palette: p8, cld: 1 });
    show(view(AREAS.d, PSM.T4), 128, 128, { palette: p4(3), cld: 1 });
    show(view(AREAS.e, PSM.T8), 128, 64, { palette: p8, cld: 1 });
    show(view(AREAS.f, PSM.CT32), 64, 32);
    show(view(AREAS.f, PSM.T8H), 64, 32, { palette: p8, cld: 1 });
    show(view(AREAS.g, PSM.CT32), 64, 32);
    show(view(AREAS.g, PSM.T8H), 64, 32, { palette: p8, cld: 1 });
    show(view(AREAS.g, PSM.T4HL), 64, 32, { palette: p4(1), cld: 1 });
    show(view(AREAS.g, PSM.T4HH), 64, 32, { palette: p4(2), cld: 1 });
    // 4-bit palettes of 32 bits in the buffer's places 2 and 5, both loaded first, then each used without a load
    drawn.push(tex0(view(AREAS.c, PSM.T4), 1, 1, { palette: p4(1), csa: 2, cld: 1 }), tex0(view(AREAS.c, PSM.T4), 1, 1, { palette: p4(3), csa: 5, cld: 1 }));
    show(view(AREAS.c, PSM.T4), 128, 64, { palette: p4(1), csa: 2 });
    show(view(AREAS.c, PSM.T4), 128, 64, { palette: p4(3), csa: 5 });
    for (const read of reads) show(read.target, read.w, read.h);
    const frame32 = writes([...startFrame(0, PSM.CT32, 0x80402010), ...drawn], true);
    frame.push(gif(place(frame32), frame32));
    return { start, frames: [frame] };
  }, depth === 16 ? PSM.CT16 : PSM.CT32);
}

// the 16-bit framebuffer's frame: every view with 16-bit colours in it
function frame16(place, { p8s, p8ss, p4, row }) {
  const room16 = placer(), drawn16 = [];
  const show16 = (texture, w, h, options) => {
    const [x, y] = room16(w, h);
    drawn16.push(tex0(texture, w, h, options), ...sprite(x, y, w, h));
  };
  show16(view(AREAS.a, PSM.CT16), 64, 128);
  show16(view(AREAS.a, PSM.CT16S), 64, 128);
  show16(view(AREAS.d, PSM.CT16), 64, 64);
  show16(view(AREAS.d, PSM.CT16S), 64, 64);
  show16(view(AREAS.e, PSM.CT16S), 64, 64);
  show16(view(AREAS.e, PSM.CT16), 64, 64);
  show16(view(AREAS.b, PSM.CT16), 64, 128);
  show16(view(AREAS.a, PSM.T8), 128, 128, { palette: p8s, cld: 1 });
  show16(view(AREAS.a, PSM.T8), 128, 128, { palette: p8ss, cld: 1 });
  // the palette in a row, where TEXCLUT says: in a buffer 5 columns of 64 across, from 16 pixels in, on its fourth line
  drawn16.push(write(0x1C, 5 | 1 << 6 | 3 << 12));
  show16(view(AREAS.b, PSM.T8), 128, 128, { palette: row, csm: 1, cld: 1 });
  // 4-bit palettes of 16 bits in the buffer's places 7 and 30
  drawn16.push(tex0(view(AREAS.c, PSM.T4), 1, 1, { palette: p4(4), csa: 7, cld: 1 }), tex0(view(AREAS.c, PSM.T4), 1, 1, { palette: p4(5), csa: 30, cld: 1 }));
  show16(view(AREAS.c, PSM.T4), 128, 64, { palette: p4(4), csa: 7 });
  show16(view(AREAS.c, PSM.T4), 128, 64, { palette: p4(5), csa: 30 });
  // CLD: 2 loads and keeps the place as CBP0; 4 then loads only if the palette has moved, so after the palette's
  // memory changes it draws with the old one, until 1 loads it again. 3 and 5 do the same with CBP1
  const moving = p4(6), before = Array.from({ length: 16 }, (_, i) => entry16(i, 30)), after = Array.from({ length: 16 }, (_, i) => entry16(i, 31));
  for (const [keep, check] of [[2, 4], [3, 5]]) {
    drawn16.push(upload(moving, 0, 0, 8, 2, before), write(0x3F, 0));
    show16(view(AREAS.c, PSM.T4), 64, 32, { palette: moving, cld: keep });
    drawn16.push(upload(moving, 0, 0, 8, 2, after), write(0x3F, 0));
    show16(view(AREAS.c, PSM.T4), 64, 32, { palette: moving, cld: check });
    show16(view(AREAS.c, PSM.T4), 64, 32, { palette: moving, cld: 1 });
  }
  const packet = [...writes(startFrame(0, PSM.CT16, 0x80102040)), ...packets(drawn16)];
  return [gif(place(packet), packet)];
}

// a frame's things in order as packets: the register writes between pictures under tags of their own, and each picture
// as it is, the last tag ending the packet
function packets(list) {
  const out = [];
  let pending = [];
  const flush = () => {
    if (pending.length) out.push(...writes(pending));
    pending = [];
  };
  for (const item of list) {
    if (item.length === 4) pending.push(item);
    else { flush(); out.push(...item); }
  }
  if (pending.length) out.push(...writes(pending, true));
  return out;
}
