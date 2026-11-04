// Crash Bandicoot Purple's engine, rewritten from how the original does it, from its own instructions, as nothing
// else of it is public. Each function here is named by its address in the USA copy.
//
// The main loop (0x0803B8C8) runs every object's update once a frame, works out the colours through the fade,
// waits for the V-blank, then copies the colours and runs the V-blank jobs an object asked for. The first screens
// are a script (0x0802D35C) that plays videos (movie.js) with fades between them.

import { REG } from '../../../kit/gba/video.js';
import { openMovie, decodeFrame } from './movie.js';

const CARTRIDGE = 0x08000000, PAGE = 0xA000;

// The frames from power-on to the first frame the player sees, with the screen white (forced blank) all along. None
// of it shows; only how long it takes does, which is the console's timing, as mGBA measures it.
const START_UP_FRAMES = 27;

// the script of the first screens, the table 0x0803C120 builds at 0x02009224, as the cartridge's own commands: each
// is three words, whose kind (5 the script's own, 3 the display's), what to do and its argument
const LOGOS = [
  0x0807620C, 0x08076218, 'sound', 0x08076224, 0x08076230, 0x0807623C,
  0x08076248, 0x08076224, 0x08076230, 0x0807623C,
  0x08076254, 0x08076224, 0x08076260, 0x08076280, 0x0807628C, 0x08076230, 0x0807623C, 'end',
];

// The frames the console takes to unpack a video's first frame, by the video's address, while the screen stays as it
// is: the console's timing, as mGBA measures it, as start-up's is.
const LOAD_FRAMES = { 0x08986718: 2, 0x08987108: 1 };

// The frames of a video, by its address, that take the console past the V-blank to unpack, so the main loop loses a
// frame there and shows them a frame late: the console's timing again, as mGBA measures it.
const SLOW_FRAMES = { 0x08987108: [4, 5, 6, 7, 18, 19] };

/** The core's state on `video` (createVideo), reading the cartridge from `rom`, with the game's `sound` (sound/gax.js). */
export function createCore(video, rom, sound) {
  const c = {
    video, rom, sound,
    // 0x0200AF4C: the colours the objects ask for, before the fade, and 0x0200B350 after it
    colours: new Uint16Array(512), faded: new Uint16Array(512),
    // 0x0200B750 to 0x0200B75C: the fade's kind (1 to black, 3 to white), where it is out of 64, where it's going, and
    // how far it goes a frame
    fade: { kind: 0, level: 0, target: 0, speed: 0 },
    // 0x02000D90: the V-blanks counted
    vblanks: 0,
    // 0x020071EC: what the V-blank does this time
    jobs: [],
    // the display object (0x0800DE44): the video, how many frames were asked for and shown, when the next one is due,
    // in milliseconds, its colours, and the frames played
    movie: null, wanted: 0, asked: 0, due: 0, movieColours: new Uint16Array(256), played: 0, paused: false,
    // the script (0x0802D718): its commands, the next one, and how many frames the last has waited
    script: LOGOS.map(entry => command(rom, entry)), pc: 0, waited: 0, done: false,
    main: null,
  };
  // the console after its start-up program: the screen white (forced blank) until the game shows it
  video.write(REG.DISPCNT, 0x80);
  [0x100, 0, 0, 0x100].forEach((v, i) => video.write(REG.BG2PA + i * 2, v));
  c.main = mainLoop(c);
  return c;
}

// a command of the script: the cartridge's three words at `entry`, or the two that 0x0803C120 writes itself
function command(rom, entry) {
  if (entry === 'sound') return [5, 12, rom.u32(0x08076D54 - CARTRIDGE)];
  if (entry === 'end') return [5, 6, 0];
  const at = entry - CARTRIDGE;
  return [rom.u32(at), rom.u32(at + 4), rom.u32(at + 8)];
}

/** One frame: the V-blank's count, then the main loop, up to its next wait for a V-blank. */
export function step(c, held) {
  c.vblanks++;
  c.main.next();
}

// 0x0803B8C8: the main loop, which waits for the V-blank where it yields
function* mainLoop(c) {
  for (let n = 0; n < START_UP_FRAMES; n++) yield;
  // 0x0801686C: a fade to white before a screen, which ends while the screen is still blank
  c.fade = { kind: 3, level: 64, target: 64, speed: 4 };
  for (;;) {
    if (updateDisplay(c)) yield;
    yield* updateScript(c);
    stepFade(c);          // 0x0803FB48
    workOutColours(c);    // 0x0803FBA4
    yield;                // 0x08040E5C
    c.video.pal.set(c.faded);      // 0x0803FAC4
    c.video.write(REG.DISPCNT, 0x404);   // 0x0803B1D4
    for (const job of c.jobs) job(c);   // 0x0801EE68
    c.jobs.length = 0;
  }
}

// 0x0803FB48: the fade a step nearer where it's going, and over once it's back at nothing
function stepFade(c) {
  const f = c.fade;
  if (f.kind === 0) return;
  if (f.level < f.target) f.level = Math.min(f.level + f.speed, f.target);
  else if (f.level > f.target) f.level = Math.max(f.level - f.speed, f.target);
  if (f.level === 0) f.kind = 0;
}

// 0x0803FBA4: the colours through the fade: 0x03000840 toward black and 0x030008C0 toward white, a channel at a time
function workOutColours(c) {
  const { kind, level } = c.fade;
  if (kind === 0) { c.faded.set(c.colours); return; }
  for (let i = 0; i < 512; i++) {
    const v = c.colours[i];
    let out = 0;
    for (let shift = 0; shift <= 10; shift += 5) {
      const ch = (v >> shift) & 0x1F;
      out |= (kind === 1 ? ch - ((ch * level) >>> 6) : ch + (((31 - ch) * level) >>> 6)) << shift;
    }
    c.faded[i] = out;
  }
}

// 0x0803FD3C: a fade to black that the main loop waits for
function* fadeToBlack(c, speed) {
  c.fade.target = 64;
  c.fade.speed = speed;
  c.fade.kind = 1;
  while (c.fade.level !== 64) {
    stepFade(c);
    workOutColours(c);
    yield;
    c.video.pal.set(c.faded);
  }
}

// 0x08000254 of the count of V-blanks: the time in milliseconds
const now = c => Math.trunc((c.vblanks * 1000) / 60);

// 0x0800D46C: a video in the display object, with its first frame drawn in the hidden page
function loadMovie(c, address) {
  const movie = openMovie(c.rom, address);
  c.movie = movie;
  movie.slow = SLOW_FRAMES[address] ?? [];
  c.movieColours.fill(0);
  decodeFrame(movie, c.video.vram, c.movieColours);
  movie.at = movie.second;
  movie.loop = movie.at;
  movie.frame = 1;
  c.played = 0;
  c.paused = false;
  c.wanted = 1;   // [+16]
  c.asked = 0;    // [+20]
}

// 0x0800DD7C: the display object's update. Once the next frame is due it asks the V-blank to show it, and once that's
// asked it draws the one after, in the hidden page. True when that takes past the V-blank
function updateDisplay(c) {
  if (!c.movie) return false;
  let slow = false;
  const waiting = c.paused || c.due > now(c);   // 0x0800DB28
  if (!waiting && c.asked !== c.wanted) {
    slow = c.movie.slow.includes(c.wanted);
    c.jobs.push(showMovieFrame);
    c.asked = c.wanted;
  }
  if (c.wanted === c.asked) {
    nextMovieFrame(c);
    c.wanted++;
  }
  return slow;
}

// 0x0800D574: the next frame, or back to the second after the last
function nextMovieFrame(c) {
  const { movie } = c;
  c.due += movie.speed;
  if (movie.frame < movie.frames) movie.frame++;
  else if (movie.frame === movie.frames) { movie.frame++; c.played++; }
  else { movie.at = movie.loop; movie.frame = 2; }
  decodeFrame(movie, c.video.vram, c.movieColours);
}

// 0x0800DCA8: the V-blank's job: the video's colours for the next frame's fade, and the hidden page shown
function showMovieFrame(c) {
  c.colours.set(c.movieColours);
  const { vram } = c.video, { height } = c.movie;
  vram.copyWithin(0, PAGE, PAGE + height * 240);
}

// 0x0802D35C: the script's commands, up to one that waits, which runs again next frame
function* updateScript(c) {
  while (!c.done) {
    const at = c.pc++;
    yield* runCommand(c, c.script[at]);
    if (c.done) return;
    if (c.pc === at) { c.waited++; return; }
    c.waited = 0;
  }
}

// 0x0802D3E8 for the script's own commands, and 0x0800DC0C for the display's
function* runCommand(c, [kind, what, argument]) {
  if (kind === 3) {
    if (what === 0) {
      loadMovie(c, argument);
      for (let n = LOAD_FRAMES[argument] ?? 0; n > 0; n--) yield;
      c.due = now(c);   // once the first frame is drawn
    }
    else if (what === 1) c.paused = true;   // 0x0800D9A4
  } else if (what === 8) {
    if (c.waited < argument) c.pc--;
  } else if (what === 9) {
    // 0x0802D55C: on until the video has shown as many frames as the condition says: its words are what to ask the
    // display, how to compare and with what
    const at = argument - CARTRIDGE, value = c.rom.u32(at + 16);
    if (!(c.asked >= value)) c.pc--;
  } else if (what === 13) {
    yield* fadeToBlack(c, argument);
  } else if (what === 15) {
    // 0x0803FD8C: the fade back to nothing, without waiting
    c.fade.target = 0;
    c.fade.speed = argument;
  } else if (what === 6) {
    c.done = true;
  } else if (what === 11) {
    c.sound?.playEffect(argument);   // 0x080342A4
  } else if (what === 12) {
    c.sound?.startSong(argument);    // 0x0803407C
  }
  // 1 names the script
}
