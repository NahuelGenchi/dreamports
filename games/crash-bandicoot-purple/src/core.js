// Crash Bandicoot Purple's engine, rewritten from how the original does it, from its own instructions, as nothing
// else of it is public. Each function here is named by its address in the USA copy.
//
// The main loop (0x0803B8C8) runs every object's update once a frame, works out the colours through the fade,
// waits for the V-blank, then copies the colours and runs the V-blank jobs an object asked for. The first screens
// are a script (0x0802D35C) that plays videos (movie.js) with fades between them, and the title screen comes after.

import { REG } from '../../../kit/gba/video.js';
import { openMovie, decodeFrame } from './movie.js';
import { createWorld, aimCamera, showWorld, moveWorld, drawWorld, screenLeft, screenTop } from './world.js';
import { readCollision } from './collision.js';
import { createCrash, updateCrash, cameraLook } from './crash.js';
import { createSprite, createSprites, playAnimation, stepAnimation, drawSprite, drawText, drawLetter, colourSlot, showSprites } from './sprites.js';

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
// is: the console's timing, as mGBA measures it, as start-up's is. Those in LOAD_FRAMES_AFTER come after the video's clock has started
// and the commands that follow it have run.
const LOAD_FRAMES_AFTER = { 0x08992068: 1, 0x089EB9FC: 1, 0x08A01F88: 2, 0x08A09758: 2 };
const LOAD_FRAMES = { 0x08986718: 2, 0x08987108: 1, 0x08992068: 6, 0x08994A34: 4, 0x089971EC: 5, 0x0899A748: 5, 0x089C763C: 7, 0x089E821C: 5, 0x089EB9FC: 6, 0x089FA13C: 9, 0x08A01F88: 6, 0x08A09758: 7, 0x08A14FE8: 7, 0x08A1A954: 6 };

// The frames of a video that take the console past the V-blank to unpack, so the main loop loses a frame there and shows the one
// before them a frame late, by the video's address and as runs of how many it has asked for, with a frame in two runs losing two: the
// console's timing again, as mGBA measures it. How long these take depends on the sound too, so a video can be slow for a while and not after.
const SLOW_FRAMES = {
  0x08987108: [[4, 7], [18, 19]],
  0x0899A748: [[35, 65]],
  0x089C763C: [[1, 93]],
  0x089EB9FC: [[1, 2], [1, 2], [7, 11]],
  0x089FA13C: [[1, 47], [49, 56], [58, 65], [67, 73], [77, 82], [85, 91], [95, 100]],
  0x08A01F88: [[1, 2], [2, 2]],
  0x08A09758: [[2, 7]],
  0x08A14FE8: [[1, 1]],
};

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
    // the script (0x0802D718): the lists it's in, innermost last, each with its next command, and how many frames the last
    // has waited
    stack: [{ list: LOGOS.map(entry => command(rom, entry)), pc: 0 }], waited: 0, done: false,
    // the screen's text (0x080365B0): its font, the page shown and the next one
    text: { font: null, shown: 0, next: 0 },
    // the frames left of a video's load, once the commands that follow it have run
    stall: 0,
    main: null,
    // 0x02006EA4: the buttons held and just pressed
    held: 0, pressed: 0,
    // 0x02000E58 and what 0x08034238 looks at: the last two sounds, and which goes next
    lastSounds: [0, 0], nextSound: 0,
    hblank: null,
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
  c.pressed = held & ~c.held;   // 0x08019750
  c.held = held;
  c.main.next();
}

/** What a frame does between its lines, as the console's DMA does at each one's end. */
export function hblank(c, y) { c.hblank?.(y); }

// 0x0803B8C8: the main loop, which waits for the V-blank where it yields
function* mainLoop(c) {
  for (let n = 0; n < START_UP_FRAMES; n++) yield;
  // 0x0801686C: a fade to white before a screen, which ends while the screen is still blank
  c.fade = { kind: 3, level: 64, target: 64, speed: 4 };
  for (;;) {
    for (let n = updateDisplay(c); n > 0; n--) yield;
    yield* updateScript(c);
    if (c.done) break;
    stepFade(c);          // 0x0803FB48
    workOutColours(c);    // 0x0803FBA4
    yield;                // 0x08040E5C
    c.video.pal.set(c.faded);      // 0x0803FAC4
    c.video.write(REG.DISPCNT, 0x404);   // 0x0803B1D4
    for (const job of c.jobs) job(c);   // 0x0801EE68
    c.jobs.length = 0;
  }
  for (let n = TITLE_LOAD_FRAMES; n > 0; n--) yield;
  yield* titleLoop(c);
}

// The title screen, the second word of 0x08087350, which 0x080155E4 makes when the first screens end
const TITLE_MAPS = 0x08087350;
// The frames between the script's end and the title's first picture, with the screen black: the console's timing, as
// mGBA measures it, as start-up's is. How far the animations' clock (0x02007284) has come by that picture, and how many
// frames the screen stays white after the fade, once A or Start has been pressed
const TITLE_LOAD_FRAMES = 5, TITLE_CLOCK = -1, WHITE_FRAMES = 4;
// 0x0800C34C's animations of the game's name, from the last drawn to the first, and when each makes a sound (0x0800C494)
const NAME = [0x082AF0E0, 0x082AF0C8, 0x082AF0B0];
const NAME_SOUNDS = [
  [[4, 0x0808624C, 0x0808624C], [10, 0x08085D60, 0x08085D6C]],
  [[12, 0x08085ED4, 0x08085ED4]],
  [[22, 0x08085D6C, 0x08085D60]],
];
// The middle of the screen, which 0x0800C580 draws them from
const NAME_PLACE = 0x0806909C;
// 0x0200741C and 0x020074AC, the tables 0x0803C120 builds: the game's letters in the two colours Press Start blinks in,
// with where each letter's picture is, how wide it is and the tiles it takes
const LETTERS = { map: 0x08B54948 - CARTRIDGE, widths: 0x08B54A48 - CARTRIDGE, tiles: 0x08B54B48 - CARTRIDGE, size: 0x40, count: 2 };
const LIT = 0x08B547A0 - CARTRIDGE, DIM = 0x08B54740 - CARTRIDGE;
// 0x08036D68's list at 0x02007D64: its line of text, and how far down the screen
const PRESS_START = 0x0806F208, TEXT_Y = 140;
// 0x0802CBBC's list for 0x08001C04: how fast each band of the first layer's lines moves
const STREAKS = 0x08069B34;
// 0x0801C83C: the sound of a button on this screen
const BUTTON_SOUND = 0x08085E5C;
const KEY_A = 1, KEY_START = 8;

// 0x0802AF14 and 0x0802AD48: a line of text, whose first character, 4, centres it in 0x08036348's box, as wide as the screen
function pressStart(rom) {
  const out = [];
  let at = rom.u32(rom.u32(PRESS_START - CARTRIDGE) - CARTRIDGE) - CARTRIDGE;
  if (rom.u8(at) === 4) at++;
  for (; rom.u8(at); at++) out.push(rom.u8(at));
  let width = 0;
  for (const char of out) width += rom.u8(LETTERS.widths + char);
  return { text: out, x: 120 - Math.trunc(width / 2) };
}

// 0x08034238: whether a sound is among the last two, and 0x080342A4, which keeps it there
function soundPlaying(c, address) {
  return c.lastSounds.includes(c.rom.u32(address - CARTRIDGE));
}
function playSound(c, address) {
  c.lastSounds[c.nextSound] = c.rom.u32(address - CARTRIDGE);
  c.nextSound ^= 1;
  c.sound?.playEffect(address);
}

// The main loop on the title screen, until A or Start fades it to white. In the original they go on to the load save
// screen and the main menu, which aren't ported yet, so here they go straight to the story's opening scene
function* titleLoop(c) {
  const { video, rom } = c, title = rom.u32(TITLE_MAPS - CARTRIDGE + 4), at = title - CARTRIDGE;
  const nameX = rom.u32(NAME_PLACE - CARTRIDGE), nameY = rom.u32(NAME_PLACE - CARTRIDGE + 4);
  c.movie = null;
  const world = createWorld(video, rom, title), sprites = createSprites(video, rom);
  // 0x0802CBBC: the level's colours
  c.colours.fill(0);
  for (let i = 0; i < 256; i++) c.colours[i] = rom.u16(rom.u32(at) - CARTRIDGE + i * 2);
  video.write(REG.BLDCNT, 0x3F40);
  video.write(REG.BLDALPHA, 0x0808);
  [0x100, 0, 0, 0x100].forEach((v, i) => video.write(REG.BG3PA + i * 2, v));
  aimCamera(world, 0, 0);
  showWorld(world, 1);   // 0x0802F8A0
  // 0x08001C04: where each of the lines of the first layer is, and how fast it moves
  const lines = new Uint16Array(160), speeds = new Int32Array(160);
  for (let y = 0, from = STREAKS - CARTRIDGE; y < 160; y++) {
    speeds[y] = rom.view.getInt32(from + 4, true);
    if (rom.u32(from) === y) from += 8;
  }
  // the frame before the first picture, which 0x080155E4's frame runs too
  for (let y = 0; y < 160; y++) lines[y] += speeds[y];
  let lastLine = lines[159];
  c.hblank = y => video.write(REG.BG0HOFS, lines[y]);   // 0x08001A98
  const { text, x: textX } = pressStart(rom);
  const name = NAME.map(address => {
    const sprite = createSprite(rom, address, nameX << 8, nameY << 8);
    sprite.next = sprite.animation.delay + 1;
    return sprite;
  });
  let clock = TITLE_CLOCK, blink = 0, leaving = 0, white = 0;
  // 0x080155E4's 0x0803FD8C: the fade back from white, after 0x0803FC9C's fade to it
  c.fade = { kind: 3, level: 64, target: 0, speed: 4 };
  for (;;) {
    clock++;
    moveWorld(world);     // 0x0802F374
    // 0x08036D2C and 0x0801C598: A and Start make their sound and stop the lines, and the fade starts a frame later
    if (!leaving && (c.pressed & (KEY_A | KEY_START))) {
      playSound(c, BUTTON_SOUND);
      leaving = 1;
    } else if (leaving === 1) {
      c.fade = { kind: 3, level: c.fade.level, target: 64, speed: 4 };   // 0x0803FC9C
      leaving = 2;
    }
    if (!leaving) for (let y = 0; y < 160; y++) lines[y] += speeds[y];   // 0x08001B18
    name.forEach((sprite, n) => {   // 0x0800C494
      for (const [frame, sound, unless] of NAME_SOUNDS[n]) {
        if (sprite.frame === frame && !soundPlaying(c, unless)) playSound(c, sound);
      }
      stepAnimation(sprite, clock);
    });
    const colours = (blink & 16) ? DIM : LIT;   // 0x0801CAD4
    if (!leaving) blink++;
    stepFade(c);          // 0x0803FB48
    // 0x0800C580: the line of text, then the name from the last animation to the first
    drawText(sprites, { ...LETTERS, colours }, text, textX, TEXT_Y, c.colours);
    for (const n of [2, 1, 0]) drawSprite(sprites, name[n], nameX, nameY, c.colours);
    workOutColours(c);    // 0x0803FBA4
    video.pal.set(c.faded);   // 0x0803FAC4
    video.write(REG.DISPCNT, 0x1940);   // 0x0803B1D4
    video.write(REG.BG0HOFS, lastLine);
    lastLine = lines[159];
    drawWorld(world);     // 0x0802F90C
    showSprites(sprites);
    yield;                // 0x08040E5C
    if (leaving && c.fade.level === 64 && ++white > WHITE_FRAMES) break;
  }
  c.hblank = null;
  yield* storyOpening(c);
  for (let n = HUB_LOAD_FRAMES; n > 0; n--) yield;
  // the hub, and again from the start each time Crash falls off the map
  for (let again = false; ; again = true) yield* hubLoop(c, again);
}

// 0x08000222: the game's random numbers, from a seed at 0x02000000
function random(c) {
  c.seed = (Math.imul(c.seed, 0x41C64E6D) + 0x3039) | 0;
  return c.seed >>> 17;
}

// The first world's hub: 0x080872EC's first world's first level, whose first map 0x08015324 makes from this list
const HUB_MAPS = 0x08087380;
// The kinds of actor in a level's list: Crash, a fruit and Coco, and how each starts: the animation a fruit is made with,
// and for the other two the first of their lists of animations
const KIND_CRASH = 1, KIND_FRUIT = 34, KIND_COCO = 111;
const CRASH_ANIMATIONS = 0x0807768C, FRUIT_ANIMATION = 0x082FCED4, COCO_ANIMATIONS = 0x08069888;

// 0x08013968: the actors a level's definition lists at 24, each its kind, its place and what it starts with
function readActors(rom, def) {
  const list = rom.u32(def - CARTRIDGE + 24) - CARTRIDGE, actors = [];
  const records = rom.u32(list + 4) - CARTRIDGE, offsets = rom.u32(list + 8) - CARTRIDGE, data = rom.u32(list + 12) - CARTRIDGE;
  for (let n = 0, count = rom.u16(list); n < count; n++) {
    const at = records + n * 8, start = data + rom.u16(offsets + rom.u16(at + 6) * 2);
    actors.push({ kind: rom.u16(at), x: rom.u16(at + 2), y: rom.u16(at + 4), start });
  }
  return actors;
}

const AKU_AKU = 0x082FD3CC, AKU_AKU_LEAVING = 0x082FD39C, SOUND_AKU_AKU_LEAVING = 0x08085E98;   // 0x08000A2C, 0x080010A0

// The clock the actors' animations go by (0x02007284) at the first picture: how many frames they've run by then, as mGBA
// measures it, where the count Aku Aku floats by (0x0200762C) starts, and the random seed (0x02000000). 0x08015324 seeds it from that count
// as the level loads, which depends on the screens before it, and those aren't all ported, so this is what the count comes to in
// the recordings that reach the hub
const HUB_CLOCK = -1, FLOAT_START = 0, RANDOM_SEED = 0xF33;
// How many frames the screen stays white when the hub starts again after a fall: the console's timing, as mGBA measures it
const HUB_WHITE_FRAMES = 12;
// 0x0800EFD0's count starts again with the level, and by the first picture it has this far to go, and how many of those
// white frames in the song starts again: the console's timing again, as mGBA measures it
const FLOAT_AGAIN = 1, SONG_AGAIN_WHITE = 10;
// How far the song has come by the first picture, as it starts at 0x0803407C while the level loads
const SONG_AHEAD = 3;
// the third word after the level's entry at 0x0200D2B8
const HUB_SONG = 0x082706EC;

// 0x0803874C: an actor's place is the middle of its box, wherever its animation draws it from
function createActor(rom, { animation, x, y, flip }) {
  const sprite = createSprite(rom, animation, x << 8, y << 8, flip);
  const a = sprite.animation, offsetX = (a.x * 256) + (a.w << 7), offsetY = (a.y * 256) + (a.h << 7);
  sprite.x += flip ? -offsetX : offsetX;
  sprite.y += offsetY;
  sprite.next = a.delay + 1;
  sprite.box = a;
  sprite.priority = 1;   // 0x08019190
  return sprite;
}

// 0x08038520's 0x08038F74 and 0x08004A48: whether the box of the frame it's showing is on screen
function onScreen(c, world, sprite) {
  const { rom } = c, { animation: a, box } = sprite;
  const frame = rom.u32(a.sheet + 4) - CARTRIDGE + rom.u16(a.list + sprite.frame * 2) * 44 + 8;
  const w = rom.u8(frame + 4) << 8, h = rom.u8(frame + 5) << 8;
  let x = sprite.x + (rom.view.getInt16(frame, true) * 256) - ((box.x * 256) + (box.w << 7));
  const y = sprite.y + (rom.view.getInt16(frame + 2, true) * 256) - ((box.y * 256) + (box.h << 7));
  if (sprite.flipX) x = sprite.x * 2 - (x + w);
  const { left, top } = c.screen;   // 0x0803AB4C, which is the last frame's until the actors have all run
  return left < x + w && x < left + 0xF000 && top < y + h && y < top + 0xA000;
}

// 0x08038668: where a sprite's frame goes on screen, from its place and its box
function drawActor(c, world, sprites, sprite) {
  if (!onScreen(c, world, sprite)) return;
  const { x: boxX, y: boxY, w, h } = sprite.box;
  const offsetX = (boxX * 256) + (w << 7), offsetY = (boxY * 256) + (h << 7);
  const x = sprite.x - screenLeft(world), y = sprite.y - screenTop(world);
  drawSprite(sprites, sprite, (sprite.flipX ? x + offsetX : x - offsetX) >> 8, (sprite.flipY ? y + offsetY : y - offsetY) >> 8, c.colours);
}

// 0x08000B94, in its state 2: Aku Aku floats after where Crash was 8 frames ago, up and down and side to side by the
// sine at 0x08047B2C, and picks another of its four pictures at random every 8 frames
function updateAkuAku(c, aku, crash, clock) {
  const { rom } = c;
  if (aku.gone) return;
  // 0x08000B94's state 1 and 0x080010A0: it flies off where it is, and is gone once its animation ends
  if (aku.leaving) {
    stepAnimation(aku.sprite, clock);
    if (aku.sprite.ended) aku.gone = true;
    return;
  }
  const sine = n => rom.view.getInt16(0x08047B2C - CARTRIDGE + (n & 0xFF) * 2, true);
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

// 0x08007914 with 0x08007B4C and 0x0800807C: the camera follows Crash, looking ahead of him by no more than so much more a
// frame, and moving by no more than so much a frame
function followCrash(camera, crash) {
  // once he's fallen off the map (0x0800811C) the camera goes on to where it was going, and looks no further
  if (!crash.fell) {
    const want = cameraLook(crash), { sprite } = crash;
    camera.lookX += Math.max(-0x115, Math.min(0x115, want.x - camera.lookX));
    camera.lookY += Math.max(-181, Math.min(181, want.y - camera.lookY));
    camera.toX = sprite.x + camera.lookX;
    camera.toY = sprite.y + (sprite.box.h << 7) + camera.lookY;
  }
  camera.x += Math.max(-0x500, Math.min(0x500, camera.toX - camera.x));
  camera.y += Math.max(-0x700, Math.min(0x700, camera.toY - camera.y));
}

// The frames after the story's opening scene while the hub loads, with the screen black, as mGBA measures them
const HUB_LOAD_FRAMES = 13;

// The main loop in the hub, from the first frame the fade has started: the level's update, then the V-blank's work, until
// Crash has fallen off the map and the screen has faded to white
function* hubLoop(c, again) {
  const { video, rom } = c;
  const hub = rom.u32(HUB_MAPS - CARTRIDGE + 4), at = hub - CARTRIDGE;
  const world = createWorld(video, rom, hub), sprites = createSprites(video, rom);
  // 0x0801F85C: the level's colours
  c.colours.fill(0);
  for (let i = 0; i < 256; i++) c.colours[i] = rom.u16(rom.u32(at) - CARTRIDGE + i * 2);
  video.write(REG.BLDCNT, 0x3F40);
  video.write(REG.BLDALPHA, 0x0808);
  const actors = readActors(rom, hub);
  // Crash where the list says he starts for the way he comes in, here the first, as the word at 12 of what he
  // starts with says, and Coco and the fruit where it puts them, each facing left if the first bit of that says so
  const place = (animation, { x, y }, flip) => createActor(rom, { animation, x, y, flip });
  const crashActor = actors.find(a => a.kind === KIND_CRASH && rom.u32(a.start + 12) === 0);
  const crashSprite = place(rom.u32(CRASH_ANIMATIONS - CARTRIDGE), crashActor, (rom.u8(crashActor.start) & 1) !== 0);
  const others = [
    ...actors.filter(a => a.kind === KIND_FRUIT).map(a => place(FRUIT_ANIMATION, a, false)),
    ...actors.filter(a => a.kind === KIND_COCO).map(a => place(rom.u32(COCO_ANIMATIONS - CARTRIDGE), a, (rom.u8(a.start) & 1) !== 0)),
  ];
  if (!again) c.seed = RANDOM_SEED;
  c.floats = again ? FLOAT_AGAIN : FLOAT_START;
  c.random = () => random(c);
  c.playSound = address => playSound(c, address);
  c.soundPlaying = address => soundPlaying(c, address);
  // 0x0803817C
  const crash = createCrash(c, crashSprite, readCollision(rom, rom.u32(at + 20)));
  const aku = { sprite: createActor(rom, { animation: AKU_AKU, x: 0, y: 0, flip: false }), history: [], at: 0, picture: 0, behind: false, leaving: false, gone: false };
  for (let n = 0; n < 8; n++) aku.history[n] = [0, 0];   // 0x08000A2C: nothing yet, so it's off screen for 8 frames
  // 0x08007794: the camera on Crash from the start
  const look = cameraLook(crash), camera = {
    lookX: look.x, lookY: look.y,
    x: crashSprite.x + look.x, y: crashSprite.y + (crashSprite.box.h << 7) + look.y,
  };
  camera.toX = camera.x;
  camera.toY = camera.y;
  aimCamera(world, camera.x, camera.y);
  showWorld(world);
  c.screen = { left: screenLeft(world), top: screenTop(world) };
  let clock = HUB_CLOCK;
  // 0x08015324: the level's song
  if (!again) c.sound?.startSong(HUB_SONG, SONG_AHEAD);
  // 0x08015324's 0x0803FD8C: the fade back from white, after 0x0803FC9C's fade to it
  c.fade = { kind: 3, level: 64, target: 0, speed: 4 };
  let white = -1;
  for (;;) {
    clock++;
    c.floats++;
    followCrash(camera, crash);
    aimCamera(world, camera.x, camera.y);
    moveWorld(world);     // 0x0802F374
    updateAkuAku(c, aku, crashSprite, clock);   // 0x08024668
    updateCrash(c, crash, clock);
    if (crash.fell && !aku.leaving && !aku.gone) {
      aku.leaving = true;
      playAnimation(aku.sprite, AKU_AKU_LEAVING, clock);
      playSound(c, SOUND_AKU_AKU_LEAVING);
    }
    // the event 0x08024330 sends: a fade to white, and the level again from the start
    if (crash.over && white < 0) {
      c.fade = { kind: 3, level: c.fade.level, target: 64, speed: 4 };
      white = 0;
    }
    for (const sprite of others) stepAnimation(sprite, clock);   // 0x08035518
    // 0x08021BD0: Aku Aku behind Crash or in front of him, as it goes round
    const first = aku.gone ? [crashSprite] : aku.behind ? [crashSprite, aku.sprite] : [aku.sprite, crashSprite];
    for (const sprite of [...first, ...others]) drawActor(c, world, sprites, sprite);
    c.screen = { left: screenLeft(world), top: screenTop(world) };
    stepFade(c);          // 0x0803FB48
    workOutColours(c);    // 0x0803FBA4
    video.pal.set(c.faded);   // 0x0803FAC4
    video.write(REG.DISPCNT, 0x1F40);   // 0x0803B1D4
    drawWorld(world);     // 0x0802F90C
    showSprites(sprites);
    yield;                // 0x08040E5C
    if (white >= 0 && c.fade.level === 64) {
      white++;
      // the song stops while the screen is white, and starts again from its beginning
      if (white === SONG_AGAIN_WHITE) {
        c.sound?.stopSong();
        c.sound?.startSong(HUB_SONG);
      }
      if (white > HUB_WHITE_FRAMES) return;
    }
  }
}

// The fonts of a scene's script, by the structures it names them by, 0x0200735C, 0x0200732C and 0x0200750C: a font's letters, their widths, its tiles and
// its colours, in the cartridge, how far apart its lines are, and how many tiles a letter takes and what shape they make on the console
const fontOf = (letters, pictures, colours, attributes) => ({ letters, widths: letters + 0x100, pictures, colours, ...attributes });
const STORY_LETTERS = { shape: 0x1000, size: 0, tiles: 1, height: 0x0B };
const SCENE_FONTS = {
  0x0200735C: fontOf(0x08B57478, 0x08B57678, 0x08B57270, STORY_LETTERS),
  0x0200732C: fontOf(0x08B57478, 0x08B57678, 0x08B57290, STORY_LETTERS),
  0x0200750C: fontOf(0x08B51540, 0x08B51740, 0x08B51338, { shape: 0x1000, size: 0x4000, tiles: 4, height: 0x10 }),
};

// The first scene's script, 0x02000EC4's first, which the level's list at 0x0200D2B8 names as the first world's opening (0x08015ED0),
// as 0x0803C120 builds it at 0x0200A508 from the cartridge's own commands and the songs at 0x08076D64 and 0x08076D6C
const WAIT_FOR_PAGES = 0x08076CF0;
const STORY_OPENING = [
  [5, 1, 0x080762A4], [5, 12, 0x08271E04],
  [7, 1, 0x0200735C], [7, 2, 0x0806FA54], [3, 0, 0x08992068], [5, 2, WAIT_FOR_PAGES], [5, 13, 4], [7, 2, 0x0806F1E0], [5, 15, 4],
  [7, 1, 0x0200732C], [7, 2, 0x0806F324], [3, 0, 0x08994A34], [5, 2, WAIT_FOR_PAGES], [5, 13, 4], [5, 15, 4],
  [7, 1, 0x0200735C], [7, 2, 0x0806FA58], [3, 0, 0x089971EC], [5, 2, WAIT_FOR_PAGES], [5, 13, 4], [5, 15, 4],
  [3, 0, 0x0899A748], [7, 2, 0x0806FA5C], [5, 2, WAIT_FOR_PAGES], [5, 14, 4], [5, 12, 0x08273030], [5, 15, 4],
  [7, 1, 0x0200735C], [7, 2, 0x0806F328], [3, 0, 0x089C763C], [5, 2, WAIT_FOR_PAGES], [5, 13, 4], [5, 15, 4],
  [7, 1, 0x0200732C], [7, 2, 0x0806F32C], [3, 0, 0x089E821C], [5, 2, WAIT_FOR_PAGES], [5, 15, 4],
  [3, 0, 0x089EB9FC], [5, 9, 0x08076394], [3, 0, 0x089FA13C], [7, 1, 0x0200735C], [7, 2, 0x0806F330], [5, 2, WAIT_FOR_PAGES],
  [7, 1, 0x0200750C], [7, 2, 0x0806F334], [3, 0, 0x08A01F88], [5, 9, 0x080763F0], [3, 1, 0], [5, 10, 0x08076410],
  [3, 0, 0x08A09758], [5, 11, 0x08085D48], [5, 9, 0x08076448],
  [7, 1, 0x0200735C], [7, 2, 0x0806F338], [3, 0, 0x08A14FE8], [5, 2, WAIT_FOR_PAGES], [5, 13, 4], [5, 15, 4],
  [7, 1, 0x0200732C], [7, 2, 0x0806F33C], [3, 0, 0x08A1A954], [5, 2, WAIT_FOR_PAGES], [5, 13, 4], [5, 6, 0],
];

// 0x08016A78's 0x08034214: the music's volume a game gives it from the game's data at 0x02006DE0, its [148], which a new game has at this
const GAME_MUSIC_VOLUME = 128;

// 0x020071D8: where a scene's text goes, and 0x082AEB28 with 0x0806981C the arrow that says there's more
const SCENE_TEXT = { x: 0, y: 0x7C, w: 0xE2, h: 0x24 };
const MORE_ARROW = 0x082AEB28, MORE_X = 0xEA, MORE_Y = 0x94;

// 0x0801CEBC: a scene with a story's text: the video, the script, the text and the arrow, on mode 4, whose sprites' tiles start at 512
// (0x08037C54), and 0x08015ED0's fade back from white
function* storyOpening(c) {
  const { video, rom } = c;
  c.sound?.setMusicVolume(GAME_MUSIC_VOLUME);
  // from here the V-blank's work comes in the picture of that frame's buttons, as an update comes right after the V-blank before
  c.scene = true;
  c.read = c.held;
  c.hblank = null;
  c.movie = null;
  c.stack = [{ list: STORY_OPENING, pc: 0 }];
  c.waited = 0;
  c.done = false;
  c.text = { font: null, shown: 0, next: 0 };
  const sprites = createSprites(video, rom, 0x200);
  const arrow = Object.assign(createSprite(rom, MORE_ARROW, 0, 0), { priority: 0 });
  arrow.next = arrow.animation.delay + 2;
  c.fade.target = 0;
  c.fade.speed = 4;   // 0x0803FD8C
  let clock = 0;
  while (!c.done) {
    // 0x08019750: the buttons as they are when an update starts, which one that runs past the V-blank doesn't read again
    c.keys = c.held & ~c.read;
    c.read = c.held;
    for (let n = updateDisplay(c); n > 0; n--) yield;
    yield* updateScript(c);
    if (c.done) break;
    stepAnimation(arrow, ++clock);   // 0x08035518
    // 0x080364E8's text, then 0x080355E8's arrow
    if (c.text.shown) layoutPage(c, sprites, c.text.shown);
    drawSprite(sprites, arrow, MORE_X, MORE_Y, c.colours);
    stepFade(c);          // 0x0803FB48
    workOutColours(c);    // 0x0803FBA4
    video.pal.set(c.faded);        // 0x0803FAC4
    video.write(REG.DISPCNT, 0x1444);   // 0x0803B1D4
    for (const job of c.jobs) job(c);   // 0x0801EE68
    c.jobs.length = 0;
    showSprites(sprites);
    sprites.slots.clear();
    sprites.nextSlot = 15;
    yield;                // 0x08040E5C
  }
}

// 0x0802AE1C and 0x0802AF14, which walk a page alike: its lines from `at`, each as far as fits in the text's box and back to its last
// space, with the second drawing them. The result is where the next page starts. Bytes under 13 aren't letters: 3, 4 and 5 align what
// comes after left, in the middle and right, 10 ends a line and 12 the page
function layoutPage(c, sprites, at) {
  const { rom } = c, { font } = c.text, box = SCENE_TEXT, bottom = box.y + box.h;
  const widthOf = ch => rom.u8(font.widths - CARTRIDGE + ch);
  const isControl = ch => ch >= 1 && ch <= 12 && ch !== 8 && ch !== 9;
  const slot = sprites && colourSlot(sprites, font.colours - CARTRIDGE, c.colours), size = font.tiles * 32;
  let y = box.y, align = 0;
  while (rom.u8(at - CARTRIDGE) && y + font.height < bottom) {
    let end = at - CARTRIDGE, width = 0, space = 0, atSpace = 0;
    for (;; end++) {
      const ch = rom.u8(end);
      if (ch === 0 || ch === 10 || ch === 12) break;
      if (ch === 32) { space = end; atSpace = width; }
      if (ch === 3) align = 0;
      else if (ch === 4) align = 2;
      else if (ch === 5) align = 1;
      if (isControl(ch)) continue;
      width += widthOf(ch);
      if (width >= box.w) {
        if (space) { end = space; width = atSpace; }
        break;
      }
    }
    if (sprites) {
      let x = align === 1 ? box.x + box.w - width : align === 2 ? box.x + (box.w >> 1) - (width >> 1) : box.x;
      for (let from = at - CARTRIDGE; from < end; from++) {
        const ch = rom.u8(from);
        if (isControl(ch)) continue;
        if (ch !== 32 && x + widthOf(ch) > 0 && x <= 239) {
          drawLetter(sprites, font.pictures - CARTRIDGE + rom.u8(font.letters - CARTRIDGE + ch) * size, x, y, slot, font);
        }
        x += widthOf(ch);
      }
    }
    const ch = rom.u8(end);
    if (ch === 0) return end + CARTRIDGE;
    y = ch === 12 ? bottom : y + font.height;
    at = end + 1 + CARTRIDGE;
  }
  return at;
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
    if (c.scene) c.video.pal.set(c.faded);
    yield;
    if (!c.scene) c.video.pal.set(c.faded);
  }
}

// 0x0803FC9C from a script, whose first frame shows a frame after a fade to black's does
function* fadeToWhiteInScript(c, speed) {
  c.fade.target = 64;
  c.fade.speed = speed;
  c.fade.kind = 3;
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
// asked it draws the one after, in the hidden page. The result is the frames that takes past the V-blank
function updateDisplay(c) {
  if (!c.movie) return 0;
  let slow = 0;
  const waiting = c.paused || c.due > now(c);   // 0x0800DB28
  if (!waiting && c.asked !== c.wanted) {
    slow = c.movie.slow.filter(([first, last]) => first <= c.wanted && c.wanted <= last).length;
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
    const list = c.stack.at(-1), at = list.pc++;
    yield* runCommand(c, commandAt(c.rom, list.list, at), list);
    if (c.done) return;
    if (c.stack.at(-1) === list && list.pc === at) {
      c.waited++;
      for (; c.stall > 0; c.stall--) yield;
      return;
    }
    c.waited = 0;
  }
}

// a command of a list: one of the game's own, or from the cartridge when the script gives its address
function commandAt(rom, list, n) {
  if (Array.isArray(list)) return list[n];
  const at = list - CARTRIDGE + n * 12;
  return [rom.u32(at), rom.u32(at + 4), rom.u32(at + 8)];
}

// 0x0802D55C: what a condition asks, of the display (0x0800DC0C), the buttons (0x0802D2E4) or the text (0x08036400), against its value
function test(c, address) {
  const at = address - CARTRIDGE, kind = c.rom.u32(at), what = c.rom.u32(at + 4), how = c.rom.u32(at + 12), value = c.rom.u32(at + 16);
  let asked = 0;
  if (kind === 3 && what === 4) asked = c.asked;
  else if (kind === 4 && what === 1) asked = c.keys;
  else if (kind === 7 && what === 5) asked = c.rom.u8(c.text.next - CARTRIDGE) === 0 ? 1 : 0;
  return [asked > value, asked < value, asked === value, asked !== value, (asked & value) === value][how];
}

// 0x0802D3E8 for the script's own commands, 0x0800DC0C for the display's and 0x08036400 for the text's
function* runCommand(c, [kind, what, argument], list) {
  if (kind === 3) {
    if (what === 0) {
      loadMovie(c, argument);
      const after = LOAD_FRAMES_AFTER[argument] ?? 0;
      for (let n = (LOAD_FRAMES[argument] ?? 0) - after; n > 0; n--) yield;
      c.due = now(c);   // once the first frame is drawn
      c.stall = after;
    }
    else if (what === 1) { c.paused = true; c.pausedAt = c.vblanks; }   // 0x0800D9A4
    else if (what === 2) { c.paused = false; c.due += Math.trunc(((c.vblanks - c.pausedAt) * 1000) / 60); }   // 0x0800D96C
  } else if (kind === 7) {
    const { text } = c;
    if (what === 1) text.font = SCENE_FONTS[argument];   // 0x0802B2C4
    else if (what === 2 || what === 3) {   // 0x08036530, and its own lines for the next page
      if (what === 2) text.next = c.rom.u32(c.rom.u32(argument - CARTRIDGE) - CARTRIDGE);   // 0x0803B8C0
      text.shown = text.next;
      text.next = layoutPage(c, null, text.next);
    }
    else if (what === 4) text.shown = 0;
  } else if (what === 2) {
    c.stack.push({ list: argument, pc: 0 });   // 0x0802D648
  } else if (what === 3) {
    if (!test(c, argument)) list.pc++;
  } else if (what === 5) {
    list.pc = 0;
  } else if (what === 8) {
    if (c.waited < argument) list.pc--;
  } else if (what === 9) {
    if (test(c, argument)) list.pc--;   // on while the condition holds
  } else if (what === 10) {
    if (!test(c, argument)) list.pc--;  // on until it does
  } else if (what === 13) {
    yield* fadeToBlack(c, argument);
  } else if (what === 14) {
    yield* fadeToWhiteInScript(c, argument);
  } else if (what === 15) {
    // 0x0803FD8C: the fade back to nothing, without waiting
    c.fade.target = 0;
    c.fade.speed = argument;
  } else if (what === 6) {
    // 0x0802D634: back to the list that called this one, and over when there's none
    c.stack.pop();
    if (!c.stack.length) c.done = true;
  } else if (what === 11) {
    playSound(c, argument);   // 0x080342A4
  } else if (what === 12) {
    c.sound?.startSong(argument);    // 0x0803407C
  }
  // 1 names the script
}
