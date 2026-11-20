// The strict reference for the PlayStation 2 kit's drawing, where Play! can't draw exactly (kit/ps2/c/README.md): a
// Dreamport's C is built for this computer with the kit (ps2-gs-native.c) and run for some frames, everything its GS
// was given is replayed by PCSX2's software renderer (../ps2/pcsx2.mjs), and each frame's picture is compared, every
// bit of every pixel, alpha too, as read circuit 1 shows it.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';
import { REPO } from '../lib/paths.mjs';
import { buildNative, cKit } from '../lib/c.mjs';
import { buildPcsx2, replayGsDump } from '../ps2/pcsx2.mjs';

const NATIVE = join(REPO, 'tools', 'test', 'ps2-gs-native.c');
const WIDTH = 640, HEIGHT = 448;

/** A PNG's pixels, four bytes each, RGBA, a picture with no alpha or in grey widened to it with 255 for alpha. */
export function readPng(file) {
  const data = readFileSync(file), parts = [];
  let at = 8, width = 0, height = 0, type = 0;
  while (at < data.length) {
    const length = data.readUInt32BE(at), kind = data.toString('latin1', at + 4, at + 8), body = data.subarray(at + 8, at + 8 + length);
    if (kind === 'IHDR') {
      [width, height, type] = [body.readUInt32BE(0), body.readUInt32BE(4), body[9]];
      if (body[8] !== 8 || body[12]) throw new Error(`${file} isn't an 8-bit picture without interlacing.`);
    }
    if (kind === 'IDAT') parts.push(body);
    at += 12 + length;
  }
  const bytes = { 0: 1, 2: 3, 6: 4 }[type];
  if (!bytes) throw new Error(`${file} is a kind of PNG this doesn't read: ${type}.`);
  const raw = inflateSync(Buffer.concat(parts)), stride = width * bytes, pixels = Buffer.alloc(width * height * 4, 255);
  let above = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bytes ? line[i - bytes] : 0, b = above[i], c = i >= bytes ? above[i - bytes] : 0, p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      line[i] = (line[i] + [0, a, b, (a + b) >> 1, paeth][filter]) & 255;
    }
    for (let x = 0; x < width; x++) for (let k = 0; k < bytes; k++) pixels[(y * width + x) * 4 + k] = line[x * bytes + k];
    above = line;
  }
  return { width, height, pixels };
}

/** Builds the Dreamport whose C is `mainC` for this computer, runs it for `frames` frames in `work`, replays what its GS
 *  got with PCSX2's software renderer, and compares each frame's picture: { same, frames, firstDifference, agrees }, the
 *  first difference with its frame, how many pixels differ, and the first one's place and both colours. `agrees` says
 *  whether PCSX2 saved the very same pictures with the fewest of the processor's instructions it can use as with the
 *  most: what it draws the same both ways doesn't depend on the computer, and only that is an exact reference. For
 *  what varies across a shape, where it isn't one, `near` is how many frames have every channel of every pixel within
 *  one step of PCSX2's, which is as far as PCSX2 is from itself, with `worst` the most any channel differs, `apart` how
 *  many pixels differ at all and `far` how many by more than a step: a pixel one draws and the other doesn't is far.
 *  What the kit shows of each frame, its read circuits merged, is left in `work`'s screen.raw, 640 by 448 words a frame. */
export async function strictCheck(mainC, frames, work, log = console.log) {
  await buildPcsx2(log);
  mkdirSync(work, { recursive: true });
  const kit = cKit('ps2'), program = join(work, 'game'), pictures = join(work, 'pictures.raw'), dump = join(work, 'dump.gs');
  const wrapped = ['gs_write', 'gs_image', 'gs_screen', 'gs_read_image'].map(name => `-Wl,--wrap=${name}`);
  buildNative([...kit.native.filter(file => !file.endsWith('native.c')), NATIVE, mainC, ...wrapped, '-lm'], program, { folders: kit.folders });
  // one frame more than is compared, as the replay saves a frame's picture at the V-blank after it
  const run = spawnSync(program, [String(frames + 1), pictures, dump, join(work, 'screen.raw')], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`The Dreamport didn't run here: ${(run.stderr || run.stdout).trim()}`);
  const out = join(work, 'pcsx2'), saved = replayGsDump(dump, out), ours = readFileSync(pictures);
  const plainer = join(work, 'pcsx2-sse4'), again = replayGsDump(dump, plainer, { instructions: 'sse4' });
  const agrees = again.length === saved.length && saved.every(name => again.includes(name) && readFileSync(join(out, name)).equals(readFileSync(join(plainer, name))));
  const pictureOf = frame => saved.find(name => /_fr0_/.test(name) && !name.includes('_alpha') && Number(name.match(/_f(\d+)_/)[1]) === frame + 1);
  let same = 0, firstDifference = null, near = 0, worst = 0, apart = 0, far = 0;
  const hex = n => `0x${(n >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
  for (let frame = 0; frame < frames; frame++) {
    const name = pictureOf(frame);
    if (!name) {
      firstDifference ??= { frame, pixels: WIDTH * HEIGHT, why: 'PCSX2 saved no picture for it' };
      continue;
    }
    const colours = readPng(join(out, name)), alpha = readPng(join(out, name.replace('.png', '_alpha.png')));
    let differ = 0, first = null, farHere = 0;
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const at = (y * colours.width + x) * 4, theirs = x < colours.width && y < colours.height ? (colours.pixels.readUInt32LE(at) & 0xFFFFFF | alpha.pixels[at] << 24) >>> 0 : null;
        const mine = ours.readUInt32LE(((frame * HEIGHT + y) * WIDTH + x) * 4);
        if (mine !== theirs) {
          differ++;
          // how far apart: the most any of the four channels differs
          let most = 255;
          if (theirs !== null) most = Math.max(...[0, 8, 16, 24].map(shift => Math.abs((mine >>> shift & 255) - (theirs >>> shift & 255))));
          worst = Math.max(worst, most);
          apart++;
          if (most > 1) { farHere++; far++; }
          first ??= { x, y, kit: hex(mine), pcsx2: theirs === null ? 'none' : hex(theirs) };
        }
      }
    }
    if (!farHere) near++;
    if (!differ) same++;
    else firstDifference ??= { frame, pixels: differ, first };
  }
  return { same, near, worst, apart, far, frames, firstDifference, agrees };
}
