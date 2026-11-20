// Small PlayStation 2 programs with nothing from any game in them, written here, for what the GS can be asked to do
// (kit/ps2/c/gs.c), each run on the console's real emulator and as a Dreamport in C on the kit (ps2-gs.mjs). Each is a
// list of steps, the same for both: what goes into the console's memory with the program, what it does as it starts, and
// what it does each frame, the frames taking turns. A step sends a packet to the GIF, reads a picture back from the GS
// into a packet's place, writes half of one of the GS's privileged registers, reads one into a packet's place, waits
// for one of its bits, or gives the GS's interrupt a handler. The EE program does each step as a
// game does, by DMA and by storing to the register, and the Dreamport does the same steps through the kit
// (made-up-ps2-gs.c), so the two give the GS the same things in the same order.
//
// The first, madeUpPs2Layout, is about the GS's memory: pictures moved in in one format and read in another, as
// textures and as pictures read back, so every format's own order of its pixels is tried, palettes in their blocks,
// in a row and in each of the palette buffer's places, and when CLD loads one. The emulator keeps its memory as the
// chip does and reads textures and pictures back from it exactly, but widens a 16-bit texel to 32 bits its own way, so
// it comes in two: one that draws into a 32-bit framebuffer what has no 16-bit colours, and one that draws into a
// 16-bit framebuffer what has.

import { ZERO, T0, T1, T2, T3, lui, ori, addiu, andi, lw, sw, li, here, beq, bne, j, NOP, GS, GIF_DMA, VIF1_DMA, MADR, QWC, WIDTH, HEIGHT, FBW, setUp, waitForVBlank, elfOf } from './made-up-ps2.mjs';

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
/** Where each picture goes on the screen: as high as it can go, the leftmost of the places as high, `gap` pixels apart. */
function placer(gap = 1) {
  const top = Array(WIDTH).fill(0);
  return (w, h) => {
    let best = null;
    for (let x = 0; x + w <= WIDTH; x++) {
      const y = Math.max(...top.slice(x, x + w));
      if (!best || y < best[1]) best = [x, y];
    }
    if (!best || best[1] + h > HEIGHT) throw new Error(`no room on the screen for ${w} by ${h}`);
    for (let x = best[0]; x < Math.min(WIDTH, best[0] + w + gap); x++) top[x] = best[1] + h + gap;
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
  const { start, frames, ...more } = build(place);
  const made = elfOf(at => code(at, shownFormat, start, frames), blob);
  return { ...made, ...more, blob, start, frames, shownFormat };
}

const GS_BUSDIR = 0x12001040, VIF1_STAT = 0x10003C00, FDR = 0x00800000;
export const GS_CSR = GS + 0x1000, GS_IMR = GS + 0x1010, GS_SIGLBLID = GS + 0x1080;
const V0 = 2, V1 = 3, A0 = 4, A1 = 5, A2 = 6, A3 = 7, T4 = 12, SP = 29, RA = 31, SYSCALL = 0x0C;
const addu = (rd, rs, rt) => (rs << 21 | rt << 16 | rd << 11 | 0x21) >>> 0, jr = rs => (rs << 21 | 8) >>> 0;
const move = (rd, rs) => addu(rd, rs, ZERO);
// where the kernel puts the arguments it gives a program as it starts it, the file's own name on that computer among
// them: well away from the program's own bytes, which are the same on every computer
const ARGUMENTS = 0x01000000;
/** The GS interrupt's handler, as the console's kernel calls it with its argument in A1, the address of a word: it
 *  clears SIGNAL in CSR when it's set, and adds 1 to the word for it. */
const HANDLER = [
  lui(T0, GS >>> 16), ori(T0, T0, 0x1000), lw(T1, 0, T0), andi(T1, T1, 1), sw(T1, 0, T0),
  lw(T0, 0, A1), addu(T0, T0, T1), sw(T0, 0, A1), addiu(V0, ZERO, 0), jr(RA), NOP,
];
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
  if (step.peek !== undefined) return [...li(T0, step.peek), lw(T1, 0, T0), ...li(T2, blobAt + step.at * 4), sw(T1, 0, T2)];
  if (step.wait !== undefined) {
    return [...li(T0, step.wait), here(name), lw(T1, 0, T0), andi(T1, T1, step.mask), (step.clear ? bne : beq)(T1, ZERO, name), NOP];
  }
  if (step.handler !== undefined) {
    // AddIntcHandler(INTC_GS, handler, 0, the word), then EnableIntc(INTC_GS)
    return [
      addiu(V1, ZERO, 0x10), addiu(A0, ZERO, 0), ...li(A1, blobAt + step.handler * 4), addiu(A2, ZERO, 0), ...li(A3, blobAt + step.counter * 4), SYSCALL,
      addiu(V1, ZERO, 0x14), addiu(A0, ZERO, 0), SYSCALL,
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
    // SetupThread, as a program's start does, which makes it the kernel's main thread, with a stack at the top of memory:
    // the kernel's handling of an interrupt needs one
    addiu(A0, ZERO, 0), addiu(A1, ZERO, -1), addiu(A2, ZERO, 0), ...li(A3, ARGUMENTS), addiu(T4, ZERO, 0), addiu(V1, ZERO, 0x3C), SYSCALL, move(SP, V0),
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
const screen = (address, value) => ({ screen: address, value: value >>> 0 });
const peek = (address, at) => ({ peek: address, at });

// ---- The modes program

/** PRMODE and the masks. Each frame it draws a textured sprite with PRMODECONT off, PRMODE asking for a texture, texels
 *  by UV and context 2, whose scissor, offset and texture differ from context 1's; two sprites with FBMSK keeping whole
 *  channels of what's under them; and three sprites over a 32-bit depth buffer, the middle one with ZMSK, so the third
 *  passes the depth test where the second didn't write its depth. */
export function madeUpPs2Modes() {
  return program(place => {
    // the texture past the depth buffer, which takes pages 140 to 279
    const texture = { block: 300 * 32, width: 1, format: PSM.CT32 };
    const texels = Array.from({ length: 256 }, (_, n) => (0x80000000 | (n & 15) * 16 | (n >> 4) * 16 << 8 | ((n & 15) ^ (n >> 4)) * 16 << 16) >>> 0);
    const upload16 = upload(texture, 0, 0, 16, 16, texels);
    const DEPTH = 140, rect = (x0, y0, x1, y1, z = 0) => [write(0x05, XY(x0, y0), z), write(0x05, XY(x1, y1), z)];
    const drawn = [
      ...startFrame(0, PSM.CT32, 0x80402010),
      // context 2: a scissor of its own, its places offset by (32, 16), and the texture
      write(0x4D, FBW << 16), write(0x41, 100 | 299 << 16, 50 | 149 << 16), write(0x19, 32 << 4, 16 << 4), write(0x48, 0x30000), write(0x4F, 0, 1),
      ...[tex0(texture, 16, 16)].map(([low, high]) => [low, high, 0x07, 0]), write(0x15, 0), write(0x09, 0),
      write(0x1A, 0), write(0x1B, 1 << 4 | 1 << 8 | 1 << 9), write(0x00, 6), write(0x01, 0x80808080, 0x3F800000),
      write(0x03, UV(0, 0)), write(0x05, XY(80, 30)), write(0x03, UV(240, 140)), write(0x05, XY(320, 170)),
      write(0x1A, 1), write(0x00, 6),
      // FBMSK: green kept, then red and blue kept, from what's under
      write(0x01, 0x80F0F0F0, 0x3F800000), write(0x4C, FBW << 16, 0x0000FF00), ...rect(340, 30, 440, 130),
      write(0x4C, FBW << 16, 0x00FF00FF), ...rect(400, 90, 500, 190), write(0x4C, FBW << 16),
      // a 32-bit depth buffer after the framebuffer, cleared to 0 with every colour bit masked
      write(0x4E, DEPTH), write(0x4C, FBW << 16, 0xFFFFFFFF), ...rect(0, 200, 640, 448, 0), write(0x4C, FBW << 16),
      // a pixel passes when it's as near or nearer: the second sprite doesn't write its depth, so the third passes over it
      write(0x47, 0x50000), write(0x01, 0x802020F0, 0x3F800000), ...rect(40, 220, 240, 420, 0x10000000),
      write(0x4E, DEPTH, 1), write(0x01, 0x8020F020, 0x3F800000), ...rect(140, 260, 340, 380, 0x30000000),
      write(0x4E, DEPTH), write(0x01, 0x80F02020, 0x3F800000), ...rect(100, 300, 400, 440, 0x20000000),
      write(0x47, 0x30000), write(0x4E, 0, 1),
    ];
    const frame = writes(drawn, true);
    return { start: [gif(place(upload16), upload16)], frames: [[gif(place(frame), frame)]] };
  });
}

// ---- The buffers program

/** What only the strict reference can judge, as the emulator keeps what the GS draws on its graphics card: a picture
 *  the GS drew, with its depths, read as a texture in other formats; pictures copied from one place in memory to
 *  another, onto themselves in each of TRXPOS's four orders and into another layout; the 16-bit depths' layouts; and,
 *  with `readsBack`, the drawn picture read back, which the emulator can't do, so that one is the strict reference's
 *  alone and its draw list isn't the emulator's. */
export function madeUpPs2Buffers(readsBack = false) {
  return program(place => {
    const start = [], frame = [], sendOnce = list => start.push(gif(place(list), list));
    const source = at(270, PSM.CT32), z16 = at(271, PSM.Z16), z16s = at(272, PSM.Z16S);
    const p8 = palette(0, PSM.CT32), p4 = palette(4, PSM.CT32);
    sendOnce(upload(source, 0, 0, 64, 64, pattern(64 * 64, 32, 41)));
    sendOnce(upload(z16, 0, 0, 64, 64, pattern(64 * 64, 16, 42)));
    sendOnce(upload(z16s, 0, 0, 64, 64, pattern(64 * 64, 16, 43)));
    sendOnce(upload(p8, 0, 0, 16, 16, squareOrder(Array.from({ length: 256 }, (_, i) => entry32(i, 44)))));
    sendOnce(upload(p4, 0, 0, 8, 2, Array.from({ length: 16 }, (_, i) => entry32(i, 45))));
    // the picture the GS draws: 128 by 64 at page 150, with 16-bit depths at page 156, a texture and flat sprites over it
    const drawn = { block: 150 * 32, width: 2, format: PSM.CT32 }, depths = { block: 156 * 32, width: 2, format: PSM.Z16S };
    const flat = (colour, x0, y0, x1, y1, z) => [write(0x01, colour, 0x3F800000), write(0x05, XY(x0, y0), z), write(0x05, XY(x1, y1), z)];
    const list = [
      write(0x4C, 150 | 2 << 16), write(0x40, 127 << 16, 63 << 16), write(0x18, 0), write(0x4E, 156 | 0xA << 24), write(0x1A, 1), write(0x47, 0x30000),
      write(0x3B, 0x80, 0x80), write(0x14, 0), write(0x08, 0), write(0x3F, 0),
      write(0x00, 6), ...flat(0x80C08040, 0, 0, 128, 64, 0x1111),
      tex0(source, 64, 64), write(0x00, 6 | 1 << 4 | 1 << 8), write(0x01, 0x80808080, 0x3F800000),
      write(0x03, UV(0, 0)), write(0x05, XY(8, 4), 0x7777), write(0x03, UV(64, 48)), write(0x05, XY(72, 52), 0x7777),
      write(0x00, 6), ...flat(0x4020E0A0, 60, 20, 120, 60, 0xCCCC), ...flat(0xFF1060F0, 90, 2, 126, 30, 0xFFFF),
    ];
    // copies: the picture into four places, then each onto itself, moved along, in one of TRXPOS's orders, the picture
    // into the 32-bit depths' layout, and 16-bit depths into the other 16-bit layout
    const copy = (from, to, sx, sy, dx, dy, w, h, order = 0) => [
      write(0x50, from.block | from.width << 16 | from.format << 24, to.block | to.width << 16 | to.format << 24),
      write(0x51, sx | sy << 16, dx | dy << 16 | order << 27), size(w, h), write(0x53, 2),
    ];
    const copies = [0, 1, 2, 3].map(order => ({ block: (160 + order * 4) * 32, width: 2, format: PSM.CT32 }));
    copies.forEach((to, order) => list.push(...copy(drawn, to, 0, 0, 0, 0, 128, 64), ...copy(to, to, 0, 0, 16, 8, 96, 48, order)));
    // the same with the destination before the source, in each order, and with it more than a page on, across and down
    const before = [0, 1, 2, 3].map(order => ({ block: (192 + order * 4) * 32, width: 2, format: PSM.CT32 }));
    before.forEach((to, order) => list.push(...copy(drawn, to, 0, 0, 0, 0, 128, 64), ...copy(to, to, 16, 8, 0, 0, 96, 48, order)));
    const far = [[70, 0], [0, 34], [70, 34]].map((_, n) => ({ block: (232 + n * 8) * 32, width: 2, format: PSM.CT32 }));
    far.forEach((to, n) => list.push(...copy(drawn, to, 0, 0, 0, 0, 128, 64), ...copy(to, to, 0, 0, [70, 0, 70][n], [0, 34, 34][n], 58, 30)));
    const asDepths = { block: 180 * 32, width: 2, format: PSM.Z32 }, otherLayout = { block: 184 * 32, width: 1, format: PSM.CT16S };
    list.push(...copy(drawn, asDepths, 0, 0, 0, 0, 128, 64), ...copy({ ...z16, format: PSM.CT16 }, otherLayout, 0, 0, 0, 0, 64, 64), write(0x3F, 0));
    const first = writes(list, true);
    frame.push(gif(place(first), first));
    const back = { block: 260 * 32, width: 1, format: PSM.CT32 };
    if (readsBack) {
      // 64 by 32 of the drawn picture read back, and moved in again beside it
      const out = readOut(drawn, 40, 16, 64, 32), again = upload(back, 0, 0, 64, 32, Array(64 * 32).fill(0)), where = place(again);
      frame.push(gif(place(out), out), { read: where + UPLOAD_DATA, qwords: qwordsOf(PSM.CT32, 64, 32) }, gif(where, again));
    }
    // the screen: each of them as a texture, side by side
    const room = placer(0), shown = [];
    const show = (texture, w, h, options, tw = w, th = h) => {
      const [x, y] = room(w, h);
      shown.push(tex0(texture, tw, th, options), ...sprite(x, y, w, h));
      return [x, y];
    };
    const as = (buffer, format, width = buffer.width) => ({ block: buffer.block, width, format });
    show(drawn, 128, 64);
    show(as(drawn, PSM.T8, 4), 128, 128, { palette: p8, cld: 1 }, 256, 128);
    show(as(drawn, PSM.T4, 4), 128, 128, { palette: p4, cld: 1 }, 256, 256);
    show(as(drawn, PSM.CT16), 128, 128);
    show(as(drawn, PSM.CT16S), 128, 64, undefined, 128, 128);
    show(as(drawn, PSM.T8H), 128, 64, { palette: p8, cld: 1 });
    show(as(drawn, PSM.Z32), 128, 64);
    show(as(depths, PSM.Z16S), 128, 64);
    show(as(depths, PSM.CT16S), 128, 64);
    show(as(depths, PSM.CT16), 128, 64);
    for (const to of [...copies, ...before, ...far]) show(to, 128, 64);
    show(as(asDepths, PSM.CT32), 128, 64);
    show(otherLayout, 64, 64);
    show(as(otherLayout, PSM.CT16), 64, 64);
    show(z16, 64, 64);
    show(as(z16, PSM.CT16), 64, 64);
    show(z16s, 64, 64);
    show(as(z16s, PSM.T8, 2), 128, 64, { palette: p8, cld: 1 });
    const places = {};
    if (readsBack) {
      places.back = show(back, 64, 32);
      // and the same 64 by 32 of the picture itself, to be the same as what was read
      const [x, y] = room(64, 32);
      shown.push(tex0(drawn, 128, 64), write(0x03, UV(40, 16)), write(0x05, XY(x, y)), write(0x03, UV(104, 48)), write(0x05, XY(x + 64, y + 32)));
      places.itself = [x, y];
    }
    const second = writes([...startFrame(0, PSM.CT32, 0x80402010), ...shown], true);
    frame.push(gif(place(second), second));
    return { start, frames: [frame], places };
  });
}

// ---- The effects program

/** Fog, dithering and points, into a framebuffer of `depth` bits, 32 or 16. Fog: flat sprites from no fog to all of
 *  it, a textured one in every colour, and sprites whose fog is FOG's and the last XYZF's. Dithering, which only a
 *  16-bit framebuffer shows: a textured sprite in every colour with DIMX's sixteen numbers all different, kept in
 *  range by COLCLAMP and not, and blended past a byte's range, both ways. Points: 256 of them at every sixteenth of a
 *  pixel across and down, some textured, some in the fog. */
export function madeUpPs2Effects(depth) {
  return program(place => {
    const texture = at(270, PSM.CT32), upload64 = upload(texture, 0, 0, 64, 64, pattern(64 * 64, 32, 51));
    const withFog = (x, y, fog, z = 0) => write(0x04, XY(x, y), (z | fog << 24) >>> 0), plain = (x, y) => write(0x05, XY(x, y));
    const textured = (x, y, last) => [write(0x03, UV(0, 0)), last(x, y), write(0x03, UV(64, 64)), last(x + 64, y + 64)];
    const list = [
      ...startFrame(0, depth === 16 ? PSM.CT16 : PSM.CT32, 0x80402010), tex0(texture, 64, 64), write(0x3D, 0x00C04020),
      // fog: flat sprites, their fog from none to all
      write(0x00, 6 | 1 << 5), write(0x01, 0x8020F0A0, 0x3F800000),
      ...[0, 1, 64, 128, 200, 255].flatMap((fog, n) => [withFog(8 + n * 40, 8, fog), withFog(40 + n * 40, 40, fog)]),
      // FOG's fog, then an XYZF's that the sprite after it keeps
      write(0x0A, 0, 90 << 24), plain(248, 8), plain(280, 40), withFog(288, 8, 30), withFog(320, 40, 30), plain(328, 8), plain(360, 40),
      // a textured sprite in the fog
      write(0x00, 6 | 1 << 4 | 1 << 5 | 1 << 8), write(0x01, 0x80808080, 0x3F800000), ...textured(8, 48, (x, y) => withFog(x, y, 100)),
      // dithering: DIMX's numbers 0 to 7, as -4 to 3, in two orders, with COLCLAMP on and off
      write(0x00, 6 | 1 << 4 | 1 << 8), write(0x45, 1), write(0x44, 0x67452301, 0x10325476),
      write(0x46, 1), ...textured(80, 48, plain), write(0x46, 0), ...textured(152, 48, plain),
      // and blended, the sprite's colour added to what's there, past a byte's range
      write(0x00, 6 | 1 << 4 | 1 << 6 | 1 << 8), write(0x42, 0x68, 0x80),
      write(0x46, 1), ...textured(224, 48, plain), write(0x46, 0), ...textured(296, 48, plain), write(0x46, 1), write(0x45, 0),
      // points: at every sixteenth of a pixel across and down, their colours from their places
      write(0x00, 0),
      ...Array.from({ length: 256 }, (_, n) => [write(0x01, (0x80000000 | (n * 37 & 255) | (n * 91 & 255) << 8 | (n * 53 & 255) << 16) >>> 0, 0x3F800000), write(0x05, ((8 * 16 + (n & 15) * 49) | (128 * 16 + (n >> 4) * 49) << 16) >>> 0)]).flat(),
      // in the fog, and textured, a texel each
      write(0x00, 0 | 1 << 5),
      ...Array.from({ length: 64 }, (_, n) => [write(0x01, 0x80F0F0F0, 0x3F800000), write(0x04, ((80 * 16 + (n & 7) * 35) | (128 * 16 + (n >> 3) * 35) << 16) >>> 0, n * 4 << 24)]).flat(),
      write(0x00, 0 | 1 << 4 | 1 << 8), write(0x01, 0x80808080, 0x3F800000),
      ...Array.from({ length: 256 }, (_, n) => [write(0x03, ((n & 15) * 67 | (n >> 4) * 67 << 16) >>> 0), write(0x05, ((120 * 16 + (n & 15) * 33) | (128 * 16 + (n >> 4) * 33) << 16) >>> 0)]).flat(),
    ];
    const frame = writes(list, true);
    return { start: [gif(place(upload64), upload64)], frames: [[gif(place(frame), frame)]] };
  }, depth === 16 ? PSM.CT16 : PSM.CT32);
}

// ---- The shapes program

/** What varies across a shape, which no free GS draws exactly, so its proof is the same pixels covered as the strict
 *  reference and every channel within a step of it (kit/ps2/c/README.md): lines and line strips every way round, in
 *  one colour and shaded, textured and in the fog; triangles in lists, strips and fans, shaded, textured by whole
 *  texels and by floats over Q, in the fog and under the depth test; and the same lines and triangles antialiased,
 *  blended and not. Nothing here crosses anything else in depth, where the strict reference itself changes its mind. */
export function madeUpPs2Shapes(antialiased = false) {
  return program(place => {
    // a texture whose neighbouring texels are a step of colour apart, so a place on the border of two is within a step
    // whichever it takes
    const smooth = Array.from({ length: 64 * 64 }, (_, n) => (0x80000000 | (64 + (n & 63)) | (64 + (n >> 6)) << 8 | (128 + (((n & 63) + (n >> 6)) >> 1)) << 16) >>> 0);
    const texture = at(270, PSM.CT32), upload64 = upload(texture, 0, 0, 64, 64, smooth);
    const aa = antialiased ? 1 << 7 : 0, one = 0x3F800000, bits = float => new Uint32Array(new Float32Array([float]).buffer)[0];
    const corner = (x16, y16, colour, z = 0, fog = 255) => [write(0x01, colour, one), write(0x04, (x16 | y16 << 16) >>> 0, (z | fog << 24) >>> 0)];
    const colours = [0x80F04020, 0x8020F040, 0x804020F0, 0x80F0F020, 0x8020F0F0, 0x80F020F0];
    const list = [...startFrame(0, PSM.CT32, 0x80402010), tex0(texture, 64, 64), write(0x3D, 0x00204060), write(0x42, 0x44)];
    // lines from a middle to sixteen places round it, at sixteenths of a pixel, in one colour, then shaded, then blended
    const star = (cx, cy, prim) => {
      list.push(write(0x00, prim));
      for (let n = 0; n < 16; n++) {
        const angle = n * Math.PI / 8 + 0.1, x = Math.round((cx + Math.cos(angle) * 44) * 16) + n, y = Math.round((cy + Math.sin(angle) * 44) * 16) + 3 * n;
        list.push(...corner(cx * 16 + 5, cy * 16 + 9, colours[n % 6], 0, 255), ...corner(x, y, colours[(n + 2) % 6], 0, 60));
      }
    };
    star(50, 50, 1 | aa);
    star(150, 50, 1 | 1 << 3 | aa);
    star(250, 50, 1 | 1 << 3 | 1 << 5 | aa);
    star(350, 50, 1 | 1 << 3 | 1 << 6 | aa);
    // a line strip, and lines flat, upright and a pixel long
    list.push(write(0x00, 2 | 1 << 3 | aa));
    for (let n = 0; n < 12; n++) list.push(...corner((410 + n * 18) * 16 + n * 3, (20 + (n % 3) * 30) * 16 + n * 5, colours[n % 6]));
    list.push(write(0x00, 1 | aa));
    for (let n = 0; n < 8; n++) list.push(...corner(410 * 16 + n * 2, (100 + n * 3) * 16 + n * 2, colours[n % 6]), ...corner(470 * 16 + n * 2, (100 + n * 3) * 16 + n * 2, colours[n % 6]));
    for (let n = 0; n < 8; n++) list.push(...corner((490 + n * 3) * 16 + n * 2, 100 * 16 + n * 2, colours[n % 6]), ...corner((490 + n * 3) * 16 + n * 2, 126 * 16 + n * 2, colours[n % 6]));
    for (let n = 0; n < 16; n++) list.push(...corner((530 + n * 4) * 16 + n, 100 * 16 + n, colours[n % 6]), ...corner((530 + n * 4) * 16 + n + 16, 100 * 16 + n + (n & 1 ? 16 : 0), colours[n % 6]));
    // triangles: a list, shaded and flat, a strip and a fan, at sixteenths of a pixel
    const tri = (x, y, n) => [[x + 3, y + 5], [x + 70 + n, y + 20 + 2 * n], [x + 20 + 3 * n, y + 75 + n]];
    list.push(write(0x00, 3 | 1 << 3 | aa));
    for (let n = 0; n < 3; n++) tri(10 + n * 90, 110, n).forEach(([x, y], i) => list.push(...corner(x * 16 + n * 5 + i, y * 16 + n * 3 + i, colours[(n + i) % 6])));
    list.push(write(0x00, 3 | aa));
    for (let n = 0; n < 2; n++) tri(280 + n * 90, 140, n + 3).forEach(([x, y], i) => list.push(...corner(x * 16 + i, y * 16 + 7, colours[(n + i + 3) % 6])));
    list.push(write(0x00, 4 | 1 << 3 | aa));
    for (let n = 0; n < 8; n++) list.push(...corner((20 + n * 30) * 16 + n, (200 + (n & 1) * 50) * 16 + n * 2, colours[n % 6]));
    list.push(write(0x00, 5 | 1 << 3 | aa));
    list.push(...corner(360 * 16, 240 * 16, 0x80F0F0F0));
    for (let n = 0; n < 7; n++) list.push(...corner(Math.round((360 + Math.cos(n * 0.5) * 60) * 16), Math.round((240 + Math.sin(n * 0.5) * 40) * 16), colours[n % 6]));
    // in the fog, each corner its own, and blended by its alpha
    list.push(write(0x00, 3 | 1 << 3 | 1 << 5 | aa));
    tri(450, 200, 2).forEach(([x, y], i) => list.push(...corner(x * 16, y * 16, colours[i], 0, [255, 128, 0][i])));
    list.push(write(0x00, 3 | 1 << 3 | 1 << 6 | aa));
    tri(540, 200, 4).forEach(([x, y], i) => list.push(...corner(x * 16, y * 16, [0x40F04020, 0x4020F040, 0x404020F0][i])));
    // textured by whole texels, and by floats over Q with Q different at each corner
    list.push(write(0x00, 3 | 1 << 3 | 1 << 4 | 1 << 8 | aa), write(0x01, 0x80808080, one));
    [[20, 290, 4, 4], [140, 300, 60, 6], [40, 400, 8, 60]].forEach(([x, y, u, v]) => list.push(write(0x03, UV(u, v)), write(0x05, XY(x, y))));
    list.push(write(0x00, 3 | 1 << 3 | 1 << 4 | aa));
    [[180, 290, 0.1, 0.1, 1], [300, 300, 0.9, 0.15, 0.5], [200, 400, 0.2, 0.9, 2]].forEach(([x, y, s, t, q]) => list.push(write(0x02, bits(s * q), bits(t * q)), write(0x01, 0x80808080, bits(q)), write(0x05, XY(x, y))));
    // and under the depth test, a triangle behind one drawn before it, their depths between their corners' and apart
    list.push(write(0x4E, 140), write(0x47, 0x30000), write(0x00, 6), write(0x01, 0x80402010, one), write(0x05, XY(330, 290), 0), write(0x05, XY(640, 448), 0), write(0x47, 0x50000));
    list.push(write(0x00, 3 | 1 << 3 | aa));
    [[340, 300, 0x40000], [470, 310, 0x50000], [360, 420, 0x60000]].forEach(([x, y, z], i) => list.push(write(0x01, colours[i], one), write(0x05, XY(x, y), z)));
    [[380, 300, 0x10000], [520, 330, 0x20000], [400, 430, 0x30000]].forEach(([x, y, z], i) => list.push(write(0x01, colours[i + 3], one), write(0x05, XY(x, y), z)));
    list.push(write(0x47, 0x30000), write(0x4E, 0, 1));
    const frame = writes(list, true);
    return { start: [gif(place(upload64), upload64)], frames: [[gif(place(frame), frame)]] };
  });
}

// ---- The filters program

/** A texture sampled between its texels, and its smaller copies. Sprites drawn four times their texture's size with
 *  MMAG linear, by whole texels and by floats; then the texture and three smaller copies of it, each in its own
 *  colours, drawn with the level of detail fixed by K, with each of MMIN's four ways of using the copies; and
 *  triangles whose level comes from Q. With `rough`, the texture is every colour, texel by texel, and only what's
 *  placed by whole texels is drawn, the sprites, which the strict reference draws exactly: a place worked out in floats
 *  can fall either side of the border of two texels, which only a smooth texture forgives. */
export function madeUpPs2Filters(rough = false) {
  return program(place => {
    const start = [], levels = [0, 1, 2, 3].map(level => ({ ...at(270 + level * 2, PSM.CT32), size: 64 >> level }));
    for (const [level, { size, ...buffer }] of levels.entries()) {
      // each copy leans to a colour of its own, and is a step from texel to texel, or with `rough` every colour
      const texels = Array.from({ length: size * size }, (_, n) => rough ? mixed(n + level * 0x10000 + 0x700000) | 0x80000000 : (0x80000000 | (40 + level * 50 + (n % size)) | (60 + Math.floor(n / size)) << 8 | (200 - level * 40) << 16)) ;
      const packet = upload(buffer, 0, 0, size, size, texels.map(v => v >>> 0));
      start.push(gif(place(packet), packet));
    }
    const smaller = [levels[1].block | 1 << 14 | (levels[2].block & 0xFFF) << 20, levels[2].block >> 12 | 1 << 2 | levels[3].block << 8 | 1 << 22];
    const tex1 = ({ lcm = 0, most = 0, larger = 0, smaller: way = 0, l = 0, k = 0 }) => write(0x14, lcm | most << 2 | larger << 5 | way << 6 | l << 19, Math.round(k * 16) & 0xFFF);
    const bits = float => new Uint32Array(new Float32Array([float]).buffer)[0], one = 0x3F800000;
    const list = [...startFrame(0, PSM.CT32, 0x80402010), tex0(levels[0], 64, 64), write(0x34, smaller[0] >>> 0, smaller[1] >>> 0)];
    // four times its size, between texels: by whole texels, from a sixteenth of a texel in, and by floats
    list.push(tex1({ larger: 1 }), write(0x03, UV(0, 0) + 1 + (3 << 16)), write(0x05, XY(8, 8)), write(0x03, UV(24, 24)), write(0x05, XY(104, 104)));
    if (!rough) list.push(write(0x00, 6 | 1 << 4), write(0x01, 0x80808080, one), write(0x02, bits(0.25), bits(0.25)), write(0x05, XY(112, 8)), write(0x02, bits(0.75), bits(0.625)), write(0x05, XY(208, 104)));
    // the copies: K from a half to three, down the screen, and MMIN's four ways across
    list.push(write(0x00, 6 | 1 << 4 | 1 << 8));
    // The two ways that mix two copies get whole levels alone here: between two, with the level fixed, the strict
    // reference mixes red and green and leaves blue, which can't be right, and paraLLEl-GS takes the larger copy alone
    [2, 3, 4, 5].forEach((way, column) => (way & 1 ? [1, 2] : [0.5, 1, 1.5, 2, 2.5, 3]).forEach((k, row) => {
      list.push(tex1({ lcm: 1, most: 3, smaller: way, k }), ...sprite(216 + column * 66, 8 + row * 66, 64, 64));
    }));
    // and with fewer copies allowed than K asks for, and K below nothing, where MMAG decides
    list.push(tex1({ lcm: 1, most: 1, smaller: 5, k: 2.5 }), ...sprite(480, 8, 64, 64), tex1({ lcm: 1, most: 3, larger: 1, smaller: 2, k: -1 }), ...sprite(480, 74, 64, 64));
    // triangles whose level comes from Q: a half, so one level down, with K a half more, mixing two copies, then K
    // alone rounding to the next, then L doubling Q's part
    list.push(write(0x00, 3 | 1 << 4));
    (rough ? [] : [[5, 0, 0.5], [2, 0, 0.75], [4, 1, -0.25]]).forEach(([way, l, k], n) => {
      list.push(tex1({ most: 3, smaller: way, l, k }));
      [[8, 0.1, 0.1], [100, 0.9, 0.2], [20, 0.2, 0.9]].forEach(([x, s, t], i) => list.push(write(0x02, bits(s * 0.5), bits(t * 0.5)), write(0x01, 0x80808080, bits(0.5)), write(0x05, XY(x + n * 100, [210, 230, 330][i] + 80))));
    });
    list.push(tex1({}));
    const frame = writes(list, true);
    return { start, frames: [[gif(place(frame), frame)]] };
  });
}

// ---- The screens program

/** What the screen shows: both read circuits, PMODE's merge and BGCOLOR, DISPLAY's rectangle, and an interlaced screen
 *  in frame mode. Circuit 1 shows a buffer of four flat colours, each with its own alpha, and circuit 2 another of two,
 *  and each frame in turn sets the screen up another way: the ways are SCREENS, with what a pixel shows in each. */
const FIRST = [[0x40F04020, 0x8020F040], [0x004020F0, 0xFFF0F020]], SECOND = [0x8020A0E0, 0x80E0A020], BORDER = 0x00603090;
const SPLIT_X = 300, SPLIT_Y = 100, SECOND_Y = 200;
const firstAt = (x, y) => FIRST[y < SPLIT_Y ? 0 : 1][x < SPLIT_X ? 0 : 1], secondAt = (x, y) => SECOND[y < SECOND_Y ? 0 : 1];
const over = (front, alpha, behind) => [0, 8, 16].reduce((out, shift) => out | Math.floor(((front >>> shift & 255) * alpha + (behind >>> shift & 255) * (255 - alpha)) / 255) << shift, 0) >>> 0;
const ownAlpha = colour => Math.min((colour >>> 24) * 2, 255);
/** Each way the screen is set up: PMODE, and what else differs from the usual, with the colour a pixel shows. */
export const SCREENS = [
  { about: 'circuit 1 alone', pmode: 1 | 1 << 5 | 0xFF << 8, shows: (x, y) => firstAt(x, y) & 0xFFFFFF },
  { about: 'circuit 2 alone', pmode: 2 | 1 << 5 | 0xFF << 8, shows: (x, y) => secondAt(x, y) & 0xFFFFFF },
  { about: 'circuit 1 over circuit 2 by ALP', pmode: 3 | 1 << 5 | 0x60 << 8, shows: (x, y) => over(firstAt(x, y), 0x60, secondAt(x, y)) },
  { about: 'circuit 1 over circuit 2 by its own alpha', pmode: 3 | 0x60 << 8, shows: (x, y) => over(firstAt(x, y), ownAlpha(firstAt(x, y)), secondAt(x, y)) },
  { about: 'circuit 1 over the border colour by ALP', pmode: 3 | 1 << 5 | 1 << 7 | 0x60 << 8, shows: (x, y) => over(firstAt(x, y), 0x60, BORDER) },
  {
    about: 'circuit 1 in a rectangle of its own over circuit 2', pmode: 3 | 1 << 5 | 0x60 << 8, rectangle: [160, 112, 320, 224],
    shows: (x, y) => x >= 160 && x < 480 && y >= 112 && y < 336 ? over(firstAt(x - 160, y - 112), 0x60, secondAt(x, y)) : secondAt(x, y) & 0xFFFFFF,
  },
  { about: 'circuit 1 alone in a rectangle, the border round it', pmode: 1 | 1 << 5 | 0xFF << 8, rectangle: [160, 112, 320, 224], alone: true, shows: (x, y) => x < 320 && y < 224 ? firstAt(x, y) & 0xFFFFFF : BORDER },
  { about: 'interlaced in frame mode, each line of the buffer on two', pmode: 1 | 1 << 5 | 0xFF << 8, smode2: 3, shows: (x, y) => firstAt(x, y >> 1) & 0xFFFFFF },
];
export function madeUpPs2Screens() {
  return program(place => {
    const flat = (colour, x0, y0, x1, y1) => [write(0x01, colour, 0x3F800000), write(0x05, XY(x0, y0)), write(0x05, XY(x1, y1))];
    const drawn = writes([
      ...startFrame(0, PSM.CT32, 0), write(0x00, 6),
      ...flat(FIRST[0][0], 0, 0, SPLIT_X, SPLIT_Y), ...flat(FIRST[0][1], SPLIT_X, 0, WIDTH, SPLIT_Y), ...flat(FIRST[1][0], 0, SPLIT_Y, SPLIT_X, HEIGHT), ...flat(FIRST[1][1], SPLIT_X, SPLIT_Y, WIDTH, HEIGHT),
      write(0x4C, 140 | FBW << 16), ...flat(SECOND[0], 0, 0, WIDTH, SECOND_Y), ...flat(SECOND[1], 0, SECOND_Y, WIDTH, HEIGHT),
    ], true), frame = gif(place(drawn), drawn);
    // DISPLAY: where its rectangle starts, in the screen's clock, four to a pixel across, and its size
    const display = ([x, y, w, h]) => [(656 + x * 4 | (36 + y) << 12 | 3 << 23) >>> 0, (w * 4 - 1 | (h - 1) << 12) >>> 0];
    const set = (address, [low, high]) => [{ screen: address, value: low >>> 0 }, { screen: address + 4, value: high >>> 0 }];
    const frames = SCREENS.map(({ pmode, rectangle, smode2 = 1 }) => [
      ...set(GS + 0x00, [pmode, 0]), ...set(GS + 0x20, [smode2, 0]), ...set(GS + 0x80, display(rectangle ?? [0, 0, WIDTH, HEIGHT])),
      ...set(GS + 0x90, [140 | FBW << 9, 0]), ...set(GS + 0xA0, display([0, 0, WIDTH, HEIGHT])), ...set(GS + 0xE0, [BORDER, 0]), frame,
    ]);
    return { start: [], frames };
  });
}

// ---- The masks program

/** SCANMSK and FBMSK bit by bit, which Play! doesn't do exactly, for the strict reference to judge: sprites kept off
 *  even lines, off odd lines and with SCANMSK's other value, and two that keep some bits of each channel. */
export function madeUpPs2Masks() {
  return program(place => {
    const rect = (colour, x0, y0, x1, y1) => [write(0x01, colour, 0x3F800000), write(0x05, XY(x0, y0)), write(0x05, XY(x1, y1))];
    const drawn = [
      ...startFrame(0, PSM.CT32, 0x80402010), write(0x00, 6),
      write(0x22, 2), ...rect(0x80F0F0F0, 20, 20, 220, 220), write(0x22, 3), ...rect(0x8020F0F0, 120, 120, 320, 320),
      write(0x22, 1), ...rect(0x80F020F0, 260, 20, 360, 120), write(0x22, 0),
      write(0x4C, FBW << 16, 0x0F3C55AA), ...rect(0xFFFFFFFF, 400, 20, 600, 220),
      write(0x4C, FBW << 16, 0xF0C3AA55), ...rect(0x00000000, 450, 150, 620, 300), write(0x4C, FBW << 16),
    ];
    const frame = writes(drawn, true);
    return { start: [], frames: [[gif(place(frame), frame)]] };
  });
}

// ---- The events program

/** The GS's status, CSR, with what SIGNAL, FINISH and LABEL leave in it and in SIGLBLID, IMR, and the GS's interrupt.
 *  As it starts it reads IMR, unmasks SIGNAL alone and gives the interrupt a handler that clears SIGNAL and counts it.
 *  Each frame it sends SIGNAL, LABEL and FINISH, waits for FINISH and for the handler, reads CSR, SIGLBLID and IMR,
 *  clears FINISH and reads CSR again, and draws a sprite for each value read, in its colour, and one for the count,
 *  which the handler keeps in its sprite's colour: so every value read is in the frame's draw list and its picture. */
export function madeUpPs2Events() {
  return program(place => {
    const handler = place(HANDLER);
    const send = place(writes([write(0x60, 0xBEEF, 0xFFFF), write(0x62, 0x12340000, 0xFFFF0000), write(0x61, 0)], true));
    const values = ['csr', 'sigid', 'lblid', 'imr', 'csrAfter', 'imrBefore', 'imrBeforeHigh', 'count'];
    const room = placer(), sprites = values.map(() => {
      const [x, y] = room(64, 64);
      return [write(0x01, 0, 0x3F800000), write(0x05, XY(x, y)), write(0x05, XY(x + 64, y + 64))];
    });
    const drawn = [...startFrame(0, PSM.CT32, 0x80402010), write(0x00, 6), ...sprites.flat()];
    const frame = place(writes(drawn, true));
    // where each sprite's colour is: after the tag, its first write
    const colour = Object.fromEntries(values.map((name, i) => [name, frame + 4 + (drawn.length - sprites.flat().length + i * 3) * 4]));
    return {
      start: [peek(GS_IMR, colour.imrBefore), peek(GS_IMR + 4, colour.imrBeforeHigh), screen(GS_IMR, 0x7E00), { handler, counter: colour.count }],
      frames: [[
        { gif: send, qwords: 4 }, { wait: GS_CSR, mask: 2 }, { wait: GS_CSR, mask: 1, clear: true },
        peek(GS_CSR, colour.csr), peek(GS_SIGLBLID, colour.sigid), peek(GS_SIGLBLID + 4, colour.lblid), peek(GS_IMR, colour.imr),
        screen(GS_CSR, 2), peek(GS_CSR, colour.csrAfter), { gif: frame, qwords: (drawn.length + 1) },
      ]],
    };
  });
}

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
