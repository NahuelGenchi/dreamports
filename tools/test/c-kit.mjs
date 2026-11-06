// npm run test:c-kit: tries the Game Boy Advance kit in C (kit/gba/c/) against the JavaScript kit it was written from.
// It draws hundreds of made-up scenes, every mode, layer, window, colour effect and kind of sprite, with H-blanks that
// change registers and colours between lines, with the C as WebAssembly and built for this computer, and with
// kit/gba/video.js, and fails on any pixel that differs. Then it builds a new game's starting point in C and runs it
// with a made-up cartridge (made-up-game.mjs), built for this computer and in a real browser, where the proof tools
// play it a frame at a time as they play the JavaScript starting point, and fails on any frame whose picture or video
// hardware differs. It needs nothing from any game and no account, so it runs on any pull request.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, gameFolder } from '../lib/paths.mjs';
import { serveRepository } from '../lib/server.mjs';
import { openChrome, until } from '../lib/chrome.mjs';
import { openDreamport } from '../lib/dreamport.mjs';
import { startingFiles } from '../lib/new-game.mjs';
import { createVideo, color555 } from '../../kit/gba/video.js';
import { C_KIT, KIT_SOURCES, NATIVE_MAIN, buildGame, buildNative, buildWasm } from '../gba/c.mjs';
import { madeUpGame } from './made-up-game.mjs';

const SCENES = Number(process.env.SCENES || 400);
const SEED = Number(process.env.SEED || 0x5EED);
const W = 240, H = 160, IO_BYTES = 0x58;
const HERE = fileURLToPath(new URL('./c-kit/', import.meta.url));
const exe = name => join(work, process.platform === 'win32' ? `${name}.exe` : name);
const work = join(LOCAL, 'tmp', 'c-kit');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};

// the same made-up scenes every run, from a seed
function random(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = n => Math.floor(next() * n);
  return { next, int, chance: p => next() < p, pick: list => list[int(list.length)] };
}

// a scene as video.c's test reads it (c-kit/scene.c), and as video.js is given it
function makeScene(r, n) {
  const io = new Uint16Array(IO_BYTES >> 1), pal = new Uint16Array(512), oam = new Uint16Array(512), vram = new Uint8Array(0x18000);
  const reg = (at, value) => { io[at >> 1] = value & 0xFFFF; };
  const any = () => r.int(0x10000);
  const mode = r.pick([0, 0, 0, 1, 1, 2, 2, 4, 3, 5]);
  // the layers on, the sprites mostly on, the windows now and then, and now and then a forced blank
  let dispcnt = mode | (r.int(16) << 8) | (r.chance(0.85) ? 0x1000 : 0) | (r.chance(0.5) ? 0x40 : 0) | (r.chance(0.2) ? 0x20 : 0)
    | (r.chance(0.5) ? 0x10 : 0) | (r.chance(0.3) ? 0x2000 : 0) | (r.chance(0.3) ? 0x4000 : 0) | (r.chance(0.05) ? 0x8000 : 0);
  if (r.chance(0.02)) dispcnt |= 0x80;
  reg(0x00, dispcnt);
  for (let b = 0; b < 4; b++) reg(0x08 + b * 2, any());
  for (let k = 0x10; k < 0x20; k += 2) reg(k, r.chance(0.3) ? r.int(16) : any());
  for (const base of [0x20, 0x30]) {
    // rotations near none, or anything
    const near = r.chance(0.6);
    const p = () => near ? (r.int(64) - 32) & 0xFFFF : any();
    reg(base, near ? 256 + r.int(128) - 64 : any()); reg(base + 2, p()); reg(base + 4, p()); reg(base + 6, near ? 256 + r.int(128) - 64 : any());
    // reference points mostly near the screen, where a picture shows, else anywhere
    for (const k of [8, 12]) {
      const point = r.chance(0.7) ? (r.int(384) - 64) * 256 + r.int(256) : r.int(0x10000000);
      reg(base + k, point & 0xFFFF); reg(base + k + 2, (point >>> 16) & 0xFFFF);
    }
  }
  for (let k = 0x40; k < 0x48; k += 2) reg(k, r.chance(0.7) ? (r.int(256) << 8) | r.int(256) : any());
  reg(0x48, any()); reg(0x4A, any()); reg(0x4C, any());
  reg(0x50, any()); reg(0x52, r.chance(0.1) ? 0x0010 : r.chance(0.7) ? (r.int(17) << 8) | r.int(17) : any()); reg(0x54, r.int(32));
  for (let i = 0; i < 512; i++) pal[i] = any() & 0x7FFF | (r.chance(0.1) ? 0x8000 : 0);
  // sprites mostly where they show, some of them rotated, with rotations near none or anything
  for (let i = 0; i < 128; i++) {
    const y = r.chance(0.8) ? r.int(176) : r.int(256), x = r.chance(0.8) ? (r.int(300) - 40) & 0x1FF : r.int(512);
    const affine = r.chance(0.3), double = affine && r.chance(0.4), hidden = !affine && r.chance(0.1);
    const a = y | (affine ? 0x100 : 0) | (double || hidden ? 0x200 : 0) | (r.pick([0, 0, 0, 1, 1, 2, 3]) << 10) | (r.chance(0.1) ? 0x1000 : 0)
      | (r.chance(0.3) ? 0x2000 : 0) | (r.int(4) << 14);
    const b = x | (affine ? r.int(32) << 9 : (r.int(4) << 12)) | (r.int(4) << 14);
    oam[i * 4] = a; oam[i * 4 + 1] = b; oam[i * 4 + 2] = any();
    oam[i * 4 + 3] = r.chance(0.6) ? (256 + r.int(256) - 128) & 0xFFFF : any();
  }
  // VRAM with clear pixels among the rest, as a scene's tiles have them
  const clear = r.next() * 0.6;
  for (let i = 0; i < vram.length; i++) vram[i] = r.chance(clear) ? 0 : r.int(256);
  // the H-blanks' writes: scrolls, rotations, windows, effects and colours, on lines anywhere
  const writes = [];
  const count = r.chance(0.3) ? 0 : r.int(60);
  for (let i = 0; i < count; i++) {
    const line = r.int(H);
    if (r.chance(0.2)) writes.push({ line, colour: true, at: r.int(512), value: any() & 0x7FFF });
    else writes.push({ line, colour: false, at: r.pick([0x00, 0x08, 0x0A, 0x0C, 0x0E, 0x10, 0x12, 0x14, 0x16, 0x18, 0x1A, 0x1C, 0x1E, 0x20, 0x22, 0x24, 0x26, 0x28, 0x2A, 0x2C, 0x2E, 0x30, 0x36, 0x38, 0x3A, 0x40, 0x42, 0x44, 0x46, 0x48, 0x4A, 0x50, 0x52, 0x54]), value: any() });
  }
  const underlay = r.chance(0.1) ? Uint32Array.from({ length: W * H }, () => r.int(0x1000000) | 0xFF000000) : null;
  return { n, io, pal, oam, vram, writes, underlay };
}

function sceneBytes(s) {
  const head = IO_BYTES + 1024 + 1024 + 0x18000, writes = 4 + s.writes.length * 6;
  const padded = (head + writes + 3) & ~3, size = padded + 4 + (s.underlay ? W * H * 4 : 0);
  const out = Buffer.alloc(size);
  Buffer.from(s.io.buffer).copy(out, 0);
  Buffer.from(s.pal.buffer).copy(out, IO_BYTES);
  Buffer.from(s.oam.buffer).copy(out, IO_BYTES + 1024);
  Buffer.from(s.vram.buffer).copy(out, IO_BYTES + 2048);
  out.writeUInt32LE(s.writes.length, head);
  s.writes.forEach((w, i) => {
    const at = head + 4 + i * 6;
    out[at] = w.line; out[at + 1] = w.colour ? 1 : 0; out.writeUInt16LE(w.at, at + 2); out.writeUInt16LE(w.value, at + 4);
  });
  out[padded] = s.underlay ? 1 : 0;
  if (s.underlay) Buffer.from(s.underlay.buffer).copy(out, padded + 4);
  return out;
}

// what video.js draws of a scene
function drawJs(s) {
  const video = createVideo();
  for (let at = 0; at < IO_BYTES; at += 2) video.write(at, s.io[at >> 1]);
  video.pal.set(s.pal); video.oam.set(s.oam); video.vram.set(s.vram);
  video.underlay = s.underlay;
  const out = new Uint32Array(W * H);
  video.drawFrame(out, y => {
    let colours = false;
    for (const w of s.writes) {
      if (w.line !== y) continue;
      if (w.colour) { video.pal[w.at] = w.value; colours = true; } else video.write(w.at, w.value);
    }
    if (colours) video.updateColors();
  });
  return out;
}

// the first scene each way of drawing it differs on, and where
function compare(what, frames, expected) {
  for (let n = 0; n < expected.length; n++) {
    const ours = frames(n), theirs = expected[n];
    let differ = 0, first = -1;
    for (let i = 0; i < W * H; i++) if (ours[i] !== theirs[i]) { differ++; if (first < 0) first = i; }
    if (differ) {
      check(false, `${what}: scene ${n} differs at ${differ} pixel${differ > 1 ? 's' : ''}, first at x ${first % W}, y ${Math.floor(first / W)} (0x${(ours[first] >>> 0).toString(16)} for 0x${(theirs[first] >>> 0).toString(16)}); SEED=${SEED} SCENES=${n + 1} draws it`);
      return;
    }
  }
  check(true, `${what}: all ${expected.length} scenes drawn exactly as video.js draws them`);
}

console.log('The C kit\'s drawing');
const r = random(SEED);
const scenes = Array.from({ length: SCENES }, (_, n) => makeScene(r, n));
const expected = scenes.map(drawJs);
const file = join(work, 'scenes.bin');
writeFileSync(file, Buffer.concat(scenes.map(sceneBytes)));

// built for this computer
const native = buildNative([join(HERE, 'scene.c'), join(C_KIT, 'video.c')], exe('scene'));
execFileSync(native, [file, join(work, 'native.out')]);
const nativeFrames = readFileSync(join(work, 'native.out'));
compare('built for this computer', n => new Uint32Array(nativeFrames.buffer, nativeFrames.byteOffset + n * W * H * 4, W * H), expected);

// as WebAssembly
const wasm = await buildWasm([join(HERE, 'scene.c'), join(C_KIT, 'video.c'), join(C_KIT, 'libc.c')], join(work, 'scene.wasm'));
const { instance } = await WebAssembly.instantiate(readFileSync(wasm), {});
const memory = instance.exports.memory;
const input = instance.exports.input();
const bytes = scenes.map(sceneBytes);
const wasmFrames = bytes.map(b => {
  new Uint8Array(memory.buffer, input, b.length).set(b);
  return new Uint32Array(memory.buffer, instance.exports.draw(), W * H).slice();
});
compare('as WebAssembly', n => wasmFrames[n], expected);

// a new game's starting point in JavaScript, and its version in C in the game's c/, with a second game in C that keeps
// a save, in folders of their own that the test removes after
console.log('A new game\'s starting point in C');
const JS_GAME = 'made-up-game', C_GAME = 'made-up-game/c', SAVES = 'made-up-saves/c';
const FOLDERS = [JS_GAME, 'made-up-saves'];
for (const game of FOLDERS) {
  if (existsSync(gameFolder(game))) throw new Error(`games/${game}/ is already there, and this test makes and removes a folder of that name.`);
}
// as big as a real cartridge, as a copy that makes the game's memory grow is what a real game has
const { rom, sha1 } = madeUpGame({ size: 8 << 20 });
const original = { console: 'gba', name: 'Made Up Game (USA)', title: 'MADE UP GAME', code: 'MADE', sha1 };
const copy = join(work, 'made-up.gba');
writeFileSync(copy, rom);
// the buttons held at each frame, by their names in the starting point's layout and as KEYINPUT's bits
const NAMES = ['up', 'down', 'left', 'right', 'a', 'b', 'l', 'r', 'start', 'select'];
const BITS = { a: 0x1, b: 0x2, select: 0x4, start: 0x8, right: 0x10, left: 0x20, up: 0x40, down: 0x80, r: 0x100, l: 0x200 };
const presses = random(SEED + 1);
const frames = Array.from({ length: 240 }, () => presses.chance(0.4) ? [] : NAMES.filter(() => presses.chance(0.2)));
const BLUE = color555(0x7C00), GREEN = color555(0x03E0);
let server = null, page = null;
try {
  for (const [game, language] of [[JS_GAME, 'js'], [C_GAME, 'c'], [SAVES, 'c']]) {
    for (const [path, text] of Object.entries(startingFiles(game.split('/')[0], original, { language }))) {
      mkdirSync(dirname(join(gameFolder(game), path)), { recursive: true });
      writeFileSync(join(gameFolder(game), path), text);
    }
  }
  await buildGame(gameFolder(C_GAME));
  check(true, 'it builds to WebAssembly');
  // a game that counts its starts in its save memory
  writeFileSync(join(gameFolder(SAVES), 'src', 'main.c'), readFileSync(join(HERE, 'saves.c')));
  await buildGame(gameFolder(SAVES));
  const red = count => color555(count) & 0xFF;

  // built for this computer: the backdrop blue, and green while a button is held
  const program = buildNative([join(gameFolder(C_GAME), 'src', 'main.c'), ...KIT_SOURCES.filter(f => !f.endsWith('libc.c')), NATIVE_MAIN], exe('game'));
  writeFileSync(join(work, 'buttons'), frames.map(held => held.reduce((bits, b) => bits | BITS[b], 0)).join('\n') + '\n');
  execFileSync(program, [copy, join(work, 'buttons'), join(work, 'game.out')]);
  const out = readFileSync(join(work, 'game.out'));
  const wrong = frames.findIndex((held, n) => {
    const words = new Uint32Array(out.buffer, out.byteOffset + n * W * H * 4, W * H), want = (held.length ? GREEN : BLUE) | 0xFF000000;
    return words.some(w => (w >>> 0) !== (want >>> 0));
  });
  check(out.length === frames.length * W * H * 4 && wrong < 0, `built for this computer, it plays all ${frames.length} frames as it should${wrong < 0 ? '' : `, but not frame ${wrong}`}`);

  const counter = buildNative([join(gameFolder(SAVES), 'src', 'main.c'), ...KIT_SOURCES.filter(f => !f.endsWith('libc.c')), NATIVE_MAIN], exe('saves'));
  writeFileSync(join(work, 'one'), '0\n');
  const counts = [1, 2].map(() => {
    execFileSync(counter, [copy, join(work, 'one'), join(work, 'saves.out')]);
    return readFileSync(join(work, 'saves.out'))[0];
  });
  check(counts[0] === red(1) && counts[1] === red(2), 'built for this computer, its save memory is kept in a file from one run to the next');

  // in the browser, a frame at a time as the proof tools play it: each frame's picture, and what the video hardware
  // holds, as the proof tools compare them with the original's (lib/in-page.js)
  server = await serveRepository();
  page = await openChrome({ profile: join(LOCAL, 'chrome', 'test-c-kit'), headless: true });
  const played = {};
  for (const game of [JS_GAME, C_GAME]) {
    await openDreamport(page, server, game, copy, { query: '?proof' });
    played[game] = await page.evaluate(`(async () => {
      const digest = async parts => {
        const all = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
        let at = 0;
        for (const p of parts) { all.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), at); at += p.byteLength; }
        return [...new Uint8Array(await crypto.subtle.digest('SHA-256', all))].map(b => b.toString(16).padStart(2, '0')).join('');
      };
      const out = [];
      for (const held of ${JSON.stringify(frames)}) {
        const picture = await dreamportsProof.step({ held });
        const v = dreamportsProof.video;
        out.push({ picture: await digest([picture.data]), state: v ? await digest([v.io, v.pal, v.oam, v.vram]) : null });
      }
      return out;
    })()`);
  }
  // and the save memory, kept in the browser from one visit to the next
  const shows = async count => {
    await openDreamport(page, server, SAVES, copy);
    return until(page, `(() => { const s = document.getElementById('screen'); return !document.getElementById('stage').hidden && s.width && s.getContext('2d').getImageData(0, 0, 1, 1).data[0] === ${red(count)}; })()`, `the backdrop to show ${count}`, 5000).then(() => true, () => false);
  };
  check(await shows(1) && await shows(2), 'in the browser, its save memory is kept from one visit to the next');
  const [js, c] = [played[JS_GAME], played[C_GAME]];
  const first = js.findIndex((f, n) => f.picture !== c[n]?.picture);
  check(first < 0, `under the proof tools its ${frames.length} frames show the same pictures as the JavaScript starting point's${first < 0 ? '' : `, but not frame ${first}`}`);
  const firstState = js.findIndex((f, n) => !f.state || f.state !== c[n]?.state);
  check(firstState < 0, `and its video hardware holds the same at every frame${firstState < 0 ? '' : `, but not at frame ${firstState}`}`);
  if (page.errors.length) check(false, `the pages reported no errors: ${page.errors.join(' | ')}`);
  else check(true, 'the pages reported no errors');
} finally {
  await page?.close();
  await server?.close();
  for (const game of FOLDERS) rmSync(gameFolder(game), { recursive: true, force: true });
}

rmSync(work, { recursive: true, force: true });
if (failures.length) {
  console.error(`\n${failures.length} check${failures.length === 1 ? '' : 's'} failed.`);
  process.exitCode = 1;
} else console.log('\nEvery check passed.');
