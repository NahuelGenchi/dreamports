// npm run dp -- draws <copy> [--frames <n>] [--from <presses.json>] [--between <first>-<last>]
//
// What a PlayStation 2 game's draw lists hold: it plays the original from your copy, from power-on, with nothing held or
// with a list of presses ({ "held": [[frame, ["START"]], …] }, as a recording has them), and counts what the game gave the
// console's graphics chip in those frames: which registers, the shapes and how they're drawn, the textures and their
// formats, and which of the console's paths they came by. That's what the console's kit has to draw for a Dreamport of
// it (kit/ps2/c/README.md). It prints counts only: nothing from the copy is kept.

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LOCAL } from './lib/paths.mjs';
import { readAnyCopy } from './lib/read-copy.mjs';
import { referenceOf } from './lib/reference.mjs';
import { expand } from './lib/recording.mjs';
import { summaryOf } from './lib/draw-lists.mjs';

const USAGE = 'Usage: npm run dp -- draws <copy> [--frames <n>] [--from <presses.json>] [--between <first>-<last>]';
const count = n => n.toLocaleString('en-US');

function table(title, counts, total = null) {
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return;
  console.log(`\n${title}`);
  const width = Math.max(...rows.map(([, n]) => count(n).length));
  for (const [name, n] of rows) console.log(`  ${count(n).padStart(width)}  ${name}${total ? `  (${(100 * n / total).toFixed(n / total < 0.01 ? 2 : 0)}%)` : ''}`);
}

export async function run(args) {
  let copyPath = null, frames = 600, from = null, between = [1, Infinity];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--frames') frames = Number(args[++i]);
    else if (args[i] === '--from') from = args[++i];
    else if (args[i] === '--between') between = String(args[++i]).split('-').map(Number);
    else if (!copyPath) copyPath = args[i];
    else throw new Error(USAGE);
  }
  if (!copyPath || !Number.isInteger(frames) || frames < 1 || between.length !== 2 || between.some(Number.isNaN)) throw new Error(USAGE);
  if (!existsSync(copyPath)) throw new Error(`There's no file at ${copyPath}.`);
  const copy = await readAnyCopy(copyPath);
  if (copy?.console !== 'ps2') throw new Error(`${copyPath} isn't a PlayStation 2 game the tools can tell, and only that console's emulator keeps draw lists so far.`);
  const reference = await referenceOf({ console: 'ps2' });
  const presses = from ? JSON.parse(readFileSync(from, 'utf8')) : { held: [[0, []]] };
  frames = presses.frames ?? frames;
  const masks = expand(presses.held, frames).map(list => list.reduce((mask, button) => {
    if (!reference.KEY[button]) throw new Error(`${button} isn't one of the console's buttons: it has ${Object.keys(reference.KEY).join(', ')}.`);
    return mask | reference.KEY[button];
  }, 0));
  reference.ensureOriginal(console.log);
  const folder = join(LOCAL, 'tmp'), dump = join(folder, `draw-lists-${process.pid}.bin`);
  mkdirSync(folder, { recursive: true });
  console.log(`Playing ${frames} frames of ${copy.title}${copy.code ? ` (${copy.code})` : ''}…`);
  let found;
  try {
    process.env.DP_DRAW_DUMP = dump;
    await reference.runOriginal({ copy: resolve(copyPath), frames, buttons: masks });
    found = summaryOf(readFileSync(dump), { from: between[0], to: between[1] });
  } finally {
    delete process.env.DP_DRAW_DUMP;
    rmSync(dump, { force: true });
  }
  const shapes = Object.values(found.shapes).reduce((a, b) => a + b, 0);
  console.log(`\nOver ${count(found.frames)} frames, from frame ${between[0]}: ${count(found.writes)} things given to the GS, ${count(Math.round(found.writes / Math.max(1, found.frames)))} a frame and ${count(found.most)} at most, drawing ${count(shapes)} shapes.`);
  table('Register writes, by the path they came by', found.paths, Object.values(found.paths).reduce((a, b) => a + b, 0));
  table('Shapes', found.shapes, shapes);
  table('How they\'re drawn (a shape can be several)', found.drawn, shapes);
  table('Their textures\' formats', found.textures);
  table('Their textures\' palettes', found.palettes);
  table('Their textures\' sizes', found.textureSizes);
  table('How a texture meets the shape\'s colour', found.textureFunctions);
  table('Texture filters', found.filters);
  table('Smaller copies of a texture (mipmaps)', found.mips);
  table('Texture edges', found.clamps);
  table('Blending', found.blends);
  table('Depth tests', found.depthTests);
  table('Alpha tests', found.alphaTests);
  table('What they\'re drawn into', found.targets);
  table('Depth buffers', found.depths);
  table('Pictures moved', found.transfers);
  table('Their formats', found.transferFormats);
  if (found.pictures) console.log(`\n${count(found.pictures)} pieces of picture data sent, ${count(found.pictureBytes)} bytes.`);
  table('What the screen shows, register halves written', found.screen);
  table('Besides', found.other);
  table('Every register written', found.registers);
  return 0;
}
