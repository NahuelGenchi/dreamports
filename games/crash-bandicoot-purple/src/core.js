// Crash Bandicoot Purple's engine, rewritten from how the original does it, from its own instructions, as nothing
// else of it is public. Each function here is named by its address in the USA copy.
//
// The main loop (0x0803B8C8) runs every object's update once a frame, works out the colours through the fade,
// waits for the V-blank, then copies the colours and runs the V-blank jobs an object asked for. The first screens
// are a script (0x0802D35C) that plays videos (movie.js) with fades between them.

import { REG } from '../../../kit/gba/video.js';
import { openMovie, decodeFrame } from './movie.js';
import { createWorld, aimCamera, showWorld, moveWorld, drawWorld, screenLeft, screenTop } from './world.js';
import { createSprite, createSprites, playAnimation, stepAnimation, drawSprite, showSprites } from './sprites.js';

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
export function createCore(video, rom, sound, start = null) {
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
  [0x100, 0, 0, 0x100].forEach((v, i) => { video.write(REG.BG2PA + i * 2, v); video.write(REG.BG3PA + i * 2, v); });
  c.main = start === 'hub' ? hubLoop(c) : mainLoop(c);
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

// The first world's hub: 0x080872EC's first world's first level, whose first map is this one (0x08015324, 0x0803371C)
const FIRST_HUB = 0x08087C28;

// What the hub's start shows, from the level's list of actors at 0x08B70934: each one's animation (0x0807768C's first
// for Crash, 0x0800EEB0's for a fruit and 0x08069888's first for Coco), and its place and whether it faces left, as the
// list has them.
const CRASH = { animation: 0x082CBDFC, x: 58, y: 388, flip: false };   // type 1, 0x08021B08
const OTHERS = [
  { animation: 0x082FCED4, x: 225, y: 381, flip: false },  // type 34, 0x0800EEB0
  { animation: 0x08307DB4, x: 195, y: 381, flip: true },   // type 111, 0x0802DA58
];
const AKU_AKU = 0x082FD3CC;   // 0x08000A2C

// The clock the actors' animations go by (0x02007284) at the first picture: how many frames they've run by then, as mGBA
// measures it, and the same for the count Aku Aku floats by (0x0200762C), which the recording's start point sets
const HUB_CLOCK = -1, FLOAT_START = -1;

// 0x08000222: the game's random numbers, from the seed the recording's start point sets at 0x02000000
const RANDOM_SEED = 1;
// How far the song has come by the first picture, as it starts at 0x0803407C while the level loads
const SONG_AHEAD = 3;
function random(c) {
  c.seed = (Math.imul(c.seed, 0x41C64E6D) + 0x3039) | 0;
  return c.seed >>> 17;
}

// 0x0803874C: an actor's place is the middle of its box, wherever its animation draws it from
function createActor(rom, { animation, x, y, flip }) {
  const sprite = createSprite(rom, animation, x << 8, y << 8, flip);
  const a = sprite.animation, offsetX = (a.x * 256) + (a.w << 7), offsetY = (a.y * 256) + (a.h << 7);
  sprite.x += flip ? -offsetX : offsetX;
  sprite.y += offsetY;
  sprite.next = a.delay + 1;
  sprite.box = a;   // 0x08010804 keeps the first animation's box, whichever plays after
  return sprite;
}

// 0x08038668: where a sprite's frame goes on screen, from its place and its animation's box
function drawActor(c, world, sprites, sprite) {
  const { x: boxX, y: boxY, w, h } = sprite.box;
  const offsetX = (boxX * 256) + (w << 7), offsetY = (boxY * 256) + (h << 7);
  const x = sprite.x - screenLeft(world), y = sprite.y - screenTop(world);
  drawSprite(sprites, sprite, (sprite.flipX ? x + offsetX : x - offsetX) >> 8, (sprite.flipY ? y + offsetY : y - offsetY) >> 8, c.colours);
}

// 0x08021E74's end: Crash stands. After 300 frames at the start of his animation he does one of the others at random, and
// goes back when it ends, with a sound partway through the fourth (0x08022B50 chooses and starts it)
const STANDING = [0x082CBDFC, 0x082CBEEC, 0x082CBE8C, 0x082CBEA4];
function updateStanding(c, crash, clock) {
  if (crash.animation.address === STANDING[0]) {
    if (crash.waited > 0x12B && crash.frame === 0) {
      playAnimation(crash, STANDING[random(c) & 3], clock);
      crash.waited = 0;
    } else crash.waited++;
    return;
  }
  // 0x08034238 keeps the sound from starting again while it plays
  if (crash.animation.address === STANDING[3] && crash.frame === 14 && !crash.sounded) {
    c.sound?.playEffect(0x08085D60);
    crash.sounded = true;
  }
  if (crash.ended) {
    crash.sounded = false;
    playAnimation(crash, STANDING[0], clock);
  }
}

// 0x08000B94, in its state 2: Aku Aku floats after where Crash was 8 frames ago, up and down and side to side by the
// sine at 0x08047B2C, and picks another of its four pictures at random every 8 frames
function updateAkuAku(c, aku, crash) {
  const { rom } = c, sine = n => rom.view.getInt16(0x08047B2C - CARTRIDGE + (n & 0xFF) * 2, true);
  aku.history[aku.at] = [crash.x, crash.y];
  aku.at = (aku.at + 1) & 7;
  if ((c.floats & 7) === 0) aku.picture = Math.min(Math.max(aku.picture - 1 + (random(c) % 3), 0), 3);
  aku.sprite.frame = aku.picture;
  const [x0, y0] = aku.history[aku.at];
  const x = x0 + sine(c.floats) * 24, y = y0 + sine(c.floats >> 1) * 12 - 0x1800;
  aku.behind = ((aku.sprite.x - x) < 0) !== crash.flipX;
  aku.sprite.x = x;
  aku.sprite.y = y;
}

// The main loop in the hub, from the first frame the fade has started: the level's update, then the V-blank's work
function* hubLoop(c) {
  const { video, rom } = c;
  const at = FIRST_HUB - CARTRIDGE, world = createWorld(video, rom, FIRST_HUB), sprites = createSprites(video, rom);
  // 0x0801F85C: the level's colours
  for (let i = 0; i < 256; i++) c.colours[i] = rom.u16(rom.u32(at) - CARTRIDGE + i * 2);
  video.write(REG.BLDCNT, 0x3F40);
  video.write(REG.BLDALPHA, 0x0808);
  const crash = Object.assign(createActor(rom, CRASH), { waited: 0 }), others = OTHERS.map(a => createActor(rom, a));
  c.seed = RANDOM_SEED;
  c.floats = FLOAT_START;
  const aku = { sprite: createActor(rom, { animation: AKU_AKU, x: 0, y: 0, flip: false }), history: [], at: 0, picture: 0, behind: false };
  for (let n = 0; n < 8; n++) aku.history[n] = [0, 0];   // 0x08000A2C: nothing yet, so it's off screen for 8 frames
  // 0x08007794: the camera on Crash from the start, 13 pixels ahead of him and 26 above the middle of him
  const aim = () => aimCamera(world, crash.x + 0xD00, crash.y + (crash.animation.h << 7) - 0x1A00);
  aim();
  showWorld(world);
  let clock = HUB_CLOCK;
  for (const sprite of [crash, ...others]) for (let n = 1; n <= clock; n++) stepAnimation(sprite, n);
  // 0x08015324: the level's song, the third word after its entry at 0x0200D2B8
  c.sound?.startSong(0x082706EC, SONG_AHEAD);
  // 0x08015324's 0x0803FD8C: the fade back from white, after 0x0803FC9C's fade to it
  c.fade = { kind: 3, level: 64, target: 0, speed: 4 };
  let settled = false;
  for (;;) {
    clock++;
    c.floats++;
    updateAkuAku(c, aku, crash);   // 0x08024668
    for (const sprite of [crash, ...others]) stepAnimation(sprite, clock);   // 0x08035518
    aim();                // 0x08007914
    if (!settled) { crash.y -= 0x100; settled = true; }   // 0x0800F914: Crash lands on the ground under him
    else updateStanding(c, crash, clock);
    moveWorld(world);     // 0x0802F374
    // 0x08021BD0: Aku Aku behind Crash or in front of him, as it goes round
    const onScreen = aku.behind ? [crash, aku.sprite] : [aku.sprite, crash];
    for (const sprite of [...onScreen, ...others]) drawActor(c, world, sprites, sprite);
    stepFade(c);          // 0x0803FB48
    workOutColours(c);    // 0x0803FBA4
    video.pal.set(c.faded);   // 0x0803FAC4
    video.write(REG.DISPCNT, 0x1F40);   // 0x0803B1D4
    drawWorld(world);     // 0x0802F90C
    showSprites(sprites);
    yield;                // 0x08040E5C
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
