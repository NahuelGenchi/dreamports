// Crash Bandicoot Purple's engine, rewritten from how the original does it, from its own instructions, as nothing
// else of it is public. Each function here is named by its address in the USA copy.
//
// The main loop (0x0803B8C8) runs every object's update once a frame, works out the colours through the fade,
// waits for the V-blank, then copies the colours and runs the V-blank jobs an object asked for. The first screens
// are a script (0x0802D35C) that plays videos (movie.js) with fades between them.

import { REG } from '../../../kit/gba/video.js';
import { KEY } from '../../../kit/gba/input.js';
import { openMovie, decodeFrame } from './movie.js';
import { createWorld, aimCamera, showWorld, moveWorld, drawWorld, screenLeft, screenTop } from './world.js';
import { createSprite, createSprites, playAnimation, stepAnimation, drawSprite, drawLetter, colourSlot, showSprites } from './sprites.js';

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
const LOAD_FRAMES = { 0x08986718: 2, 0x08987108: 1, 0x08992068: 2, 0x08994A34: 4, 0x089971EC: 5, 0x0899A748: 5 };

// The bytes of a video's frame from which it takes the console past the V-blank to unpack, so the main loop loses a frame
// there and shows the frame before it a frame late: the console's timing again, as mGBA measures it.
const SLOW_FRAME_BYTES = 3380;

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
    // the script (0x0802D718): the lists it's in, innermost last, each with its next command, and how many frames the last
    // has waited
    stack: [{ list: LOGOS.map(entry => command(rom, entry)), pc: 0 }], waited: 0, done: false,
    // the screen's text (0x080365B0): its font, the page shown and the next one, and the screen's sprites, if it has any
    text: { font: null, shown: 0, next: 0 }, sprites: null,
    main: null,
    // 0x02006EA4: the buttons held, and those pressed since the last frame
    held: 0, pressed: 0,
    // what the H-blank does after each line, once a screen has asked for it (0x08040E3C)
    hblank: null,
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
  c.pressed = held & ~c.held;
  c.held = held;
  c.main.next();
}

// 0x0803B8C8: the main loop, which waits for the V-blank where it yields
function* mainLoop(c) {
  for (let n = 0; n < START_UP_FRAMES; n++) yield;
  // 0x0801686C: a fade to white before a screen, which ends while the screen is still blank
  c.fade = { kind: 3, level: 64, target: 64, speed: 4 };
  for (;;) {
    if (c.done) {
      // 0x08014B54, as the script's end leaves the game in state 20, with the screen as it is while the level loads
      for (let n = 0; n < TITLE_LOAD_FRAMES; n++) yield;
      // Each screen says where it goes on to. B goes back, to the title from the load save game screen and to that from the menu
      let screen = 'title';
      while (screen !== 'game' && screen !== 'code' && screen !== 'story') {
        if (screen === 'title') {
          yield* titleLoop(c);
          screen = 'save';
        } else if (screen === 'save') {
          screen = yield* loadSaveLoop(c);
          if (screen === 'title') for (let n = 0; n < TITLE_LOAD_FRAMES; n++) yield;
        } else screen = yield* mainMenuLoop(c);
      }
      if (screen === 'story') yield* storyOpening(c);
      // what comes after isn't ported, so the screen stays as it is
      for (;;) yield;
    }
    for (let n = updateDisplay(c); n > 0; n--) yield;
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

// The frames the console takes to load the title screen's level: the console's timing, as mGBA measures it, as
// start-up's is.
const TITLE_LOAD_FRAMES = 4;

// The title screen, level 0x08087350's second word: its two layers, with the streaks of the upper one moving a different
// speed on each line, and the title object 0x08036D68 over them
const TITLE = 0x08087360;

// 0x0800C34C: the three animations of the logo, in the order 0x0800C580 draws them, and where it draws them from (0x0806909C)
const LOGO = [0x082AF0B0, 0x082AF0C8, 0x082AF0E0], LOGO_X = 0x78, LOGO_Y = 0x50;

// 0x0800C494: the sound each of them makes on one of its frames, again on every update it's on that frame, unless the second
// sound named is the last a channel was given (0x08034238), with the last of them first as it goes through them
const LOGO_SOUNDS = [[[22, 0x08085D6C, 0x08085D60]], [[12, 0x08085ED4, 0x08085ED4]], [[4, 0x0808624C, 0x0808624C], [10, 0x08085D60, 0x08085D6C]]];

// 0x0801C83C: the sound of a press on a menu
const MENU_SOUND = 0x08085E5C;

// The title object's list at 0x02007D64 as 0x0801C24C reads it: one line of text, on this line of the screen, in the
// font 0x020074AC, whose words are its letters, their widths, its tiles and its colours, with the table of words at
// 0x0806F208 giving the text. 0x0801CAD4 gives it the colours of the font 0x0200741C for 16 frames, then 0x020074AC's
const TEXT = 0x0806F208, TEXT_Y = 0x8C, TEXT_FONT = 0x08B54948, TEXT_TILES = 0x08B54B48, TEXT_COLOURS = [0x08B547A0, 0x08B54740];

// 0x08001C04: how fast each band of lines moves, as the table at 0x08069B34 has them: a line's speed until a line past the band's last
function lineSpeeds(rom) {
  const speeds = new Int16Array(160);
  let at = 0x08069B34 - CARTRIDGE;
  for (let line = 0; line < 160; line++) {
    speeds[line] = rom.view.getInt32(at + 4, true);
    if (line === rom.u32(at)) at += 8;
  }
  return speeds;
}

// 0x0802AF14: the letters of a text and their width, leaving out the 4 it starts with (0x0802AD48)
function readText(rom, address) {
  const letters = [];
  let at = rom.u32(rom.u32(address - CARTRIDGE) - CARTRIDGE) - CARTRIDGE + 1;
  for (let ch = rom.u8(at); ch; ch = rom.u8(++at)) letters.push({ glyph: ch === 32 ? null : rom.u8(TEXT_FONT - CARTRIDGE + ch), width: rom.u8(TEXT_FONT - CARTRIDGE + 0x100 + ch) });
  return letters;
}

// The level behind the title and the load save game screen, with its colours and first picture and its streaks one
// update ahead, and the fade back from white started (0x080155E4, 0x080156F0)
function createBackdrop(c) {
  const { video, rom } = c;
  const world = createWorld(video, rom, TITLE), sprites = createSprites(video, rom);
  // 0x0801F85C: the level's colours
  for (let i = 0; i < 256; i++) c.colours[i] = rom.u16(rom.u32(TITLE - CARTRIDGE) - CARTRIDGE + i * 2);
  video.write(REG.BLDCNT, 0x3F40);
  video.write(REG.BLDALPHA, 0x0808);
  aimCamera(world, 0, 0);
  showWorld(world, 1);
  // 0x08001B18: each line's scroll, which the H-blank's DMA copies line by line (0x08001A98)
  const speeds = lineSpeeds(rom), lines = new Uint16Array(160);
  c.hblank = y => video.write(REG.BG0HOFS, lines[y] & 0x1FF);
  const streak = () => { for (let line = 0; line < 160; line++) lines[line] += speeds[line]; };
  streak();   // the update before the first picture
  // 0x0803FD8C: the fade back from white
  c.fade = { kind: 3, level: 64, target: 0, speed: 4 };
  return { world, sprites, streak };
}

// A frame of a screen on the level, once its objects have asked for their sprites: the fade, then the V-blank's work
function showBackdrop(c, { world, sprites }) {
  stepFade(c);            // 0x0803FB48
  workOutColours(c);      // 0x0803FBA4
  c.video.pal.set(c.faded);   // 0x0803FAC4
  c.video.write(REG.DISPCNT, 0x1940);   // 0x0803B1D4
  drawWorld(world);       // 0x0802F90C
  showSprites(sprites);
}

// 0x0803FC9C: the fade to white that the main loop waits for, before the next screen
function* fadeToWhite(c) {
  c.fade.target = 64;
  c.fade.speed = 4;
  c.fade.kind = 3;
  while (c.fade.level !== 64) {
    stepFade(c);
    workOutColours(c);
    c.video.pal.set(c.faded);
    yield;
  }
}

// 0x08015084's title: the level's update, the title's update, the V-blank's work
function* titleLoop(c) {
  const { rom } = c;
  const backdrop = createBackdrop(c), { world, sprites, streak } = backdrop;
  // 0x08019254: its animations, at priority 0, once the text has its colours, with each one's next frame a frame after its
  // delay would say, as the clock (0x02007284) doesn't move on the frame the level loads: the console's timing, as mGBA measures it
  sprites.nextSlot = 14;
  const logo = LOGO.map(address => {
    const sprite = Object.assign(createSprite(rom, address, 0, 0), { priority: 0 });
    sprite.next = sprite.animation.delay + 2;
    return sprite;
  });
  const letters = readText(rom, TEXT);
  const textX = LOGO_X - (letters.reduce((sum, { width }) => sum + width, 0) >> 1);
  let clock = 0, count = 0, leaving = false;
  for (;;) {
    clock++;
    // 0x08036D2C with 0x0801C598: Start or A goes on (0x08069198's state 21), with a sound. The update right after a V-blank
    // shows in the lines of the next picture and in the rest of the picture after it, so the press already stops the lines
    if (c.pressed & (KEY.START | KEY.A)) leaving = true;
    else streak();        // 0x08001B18
    moveWorld(world);     // 0x0802F374
    for (let n = logo.length - 1; n >= 0; n--) {   // 0x0800C494
      const sprite = logo[n];
      for (const [frame, sound, unless] of LOGO_SOUNDS[n]) if (frame === sprite.frame) c.sound?.playEffect(sound, unless);
      stepAnimation(sprite, clock);
    }
    if (leaving) c.sound?.playEffect(MENU_SOUND);   // 0x0801C9AC's 0x08036D2C, after those
    // 0x0801CAD4's colours, and 0x080362F4's letters, then 0x0800C580's animations
    const colours = TEXT_COLOURS[(count >> 4) & 1];
    for (let i = 0; i < 16; i++) c.colours[256 + 15 * 16 + i] = rom.u16(colours - CARTRIDGE + i * 2);
    count++;
    let x = textX;
    for (const { glyph, width } of letters) {
      if (glyph !== null) drawLetter(sprites, TEXT_TILES - CARTRIDGE + glyph * 0x40, x, TEXT_Y, 15);
      x += width;
    }
    for (const sprite of logo) drawSprite(sprites, sprite, LOGO_X, LOGO_Y, c.colours);
    showBackdrop(c, backdrop);
    yield;                // 0x08040E5C
    if (leaving) break;
  }
  // 0x080156F0's 0x0803FC9C: the fade to white that the main loop waits for, before the load save game screen
  yield* fadeToWhite(c);
}

// The fonts, the structures at 0x020074AC, 0x0200741C, 0x020073EC, 0x0200750C and 0x0200753C: a font's letters, their widths,
// its tiles and its colours, in the cartridge, and how many tiles a letter takes and what shape they make on the console
const fontOf = (letters, pictures, colours, attributes) => ({ letters, widths: letters + 0x100, pictures, colours, ...attributes });
const LETTERS = { shape: 0x9000, size: 0, tiles: 2 };
const YELLOW = fontOf(0x08B54948, 0x08B54B48, 0x08B54740, LETTERS);
const BLUE = fontOf(0x08B54948, 0x08B54B48, 0x08B547A0, LETTERS);
const GREY = fontOf(0x08B54948, 0x08B54B48, 0x08B547C0, LETTERS);
const HEADING = fontOf(0x08B51540, 0x08B51740, 0x08B51338, { shape: 0x1000, size: 0x4000, tiles: 4 });
const SMALL = fontOf(0x08B50458, 0x08B50658, 0x08B50250, { shape: 0x1000, size: 0, tiles: 1 });
const STORY_LETTERS = { shape: 0x1000, size: 0, tiles: 1, height: 0x0B };
// the fonts of a scene's script, by the structures it names them by: 0x0200735C, 0x0200732C and 0x0200750C
const SCENE_FONTS = {
  0x0200735C: fontOf(0x08B57478, 0x08B57678, 0x08B57270, STORY_LETTERS),
  0x0200732C: fontOf(0x08B57478, 0x08B57678, 0x08B57290, STORY_LETTERS),
  0x0200750C: { ...HEADING, height: 0x10 },
};

// 0x0802AF14 with 0x0802AD48 and 0x0800E1A8: a line of a text from the table of words, by the words at `entry`: 3 and 4 in it
// mean left and in the middle of the screen, as a screen's text starts with its own (0x080697F0, 0x0806ACE8), and any other
// byte under 13 draws nothing
function drawText(c, sprites, font, entry, x, y, align = 3) {
  const { rom } = c;
  const letters = [];
  for (let at = rom.u32(rom.u32(entry - CARTRIDGE) - CARTRIDGE) - CARTRIDGE, ch = rom.u8(at); ch; ch = rom.u8(++at)) {
    if (ch === 3 || ch === 4) align = ch;
    else if (ch >= 13) letters.push(ch);
  }
  const widthOf = ch => rom.u8(font.widths - CARTRIDGE + ch);
  if (align === 4) x -= letters.reduce((sum, ch) => sum + widthOf(ch), 0) >> 1;
  const slot = colourSlot(sprites, font.colours - CARTRIDGE, c.colours);
  const size = font.tiles * 32;
  for (const ch of letters) {
    if (ch !== 32) drawLetter(sprites, font.pictures - CARTRIDGE + rom.u8(font.letters - CARTRIDGE + ch) * size, x, y, slot, font);
    x += widthOf(ch);
  }
}

// The load save game screen's list at 0x02007BC0, as 0x0801C24C reads it: where its lines start and how far apart they are,
// the words of its heading, its Erase Game, its New Game and its two hints with where they go, and Aku Aku, who points at a line
const SAVE_X = 18, SAVE_Y = 0x30, SAVE_GAP = 0x1A, SAVES = 3;
const LOAD_HEADING = 0x0806F20C, LOAD_HEADING_Y = 0x0C, ERASE_GAME = 0x0806F21C, NEW_GAME = 0x0806F220;
const HINTS = [[0x0806F9A8, 4, 0x94], [0x0806F9AC, 0xAC, 0x94]];
const POINTER = 0x08307EA4, POINTER_X = 10;

// The frames the console takes to load the screen, with the screen white: the console's timing, as mGBA measures it, as start-up's is
const SAVE_LOAD_FRAMES = 4;

// The frames 0x0801BE8C takes to write a new game's save, with the picture as it is: the console's timing again
const SAVE_WRITE_FRAMES = 11;

// The same for Story Mode on the main menu, as that line's save is there already: the console's timing again
const SAVE_AGAIN_FRAMES = 2;

// The menus' song (0x02007C60 in the screen's list), which 0x0801BE8C stops to write and starts again from its start
const MENU_SONG = 0x08278CC0;

// 0x0801C854 and 0x0801C824: the sounds of moving on a menu and of going back
const MOVE_SOUND = 0x08085D30, BACK_SOUND = 0x08085EA4;

// 0x08016A78's 0x080163D4: a game's save is written, with 0x0801BE8C stopping the song meanwhile and starting it again, and with 0x08001BA0
// stopping the H-blank's DMA too, so the whole of the streaks' layer keeps the scroll of the last line, until 0x08001B84
function* writeSave(c, frames) {
  c.sound?.stopSong();
  const moveLines = c.hblank;
  c.hblank = null;
  moveLines(159);
  for (let n = 1; n < frames; n++) yield;
  c.sound?.startSong(MENU_SONG);
  yield;
  c.hblank = moveLines;
}

// 0x080156F0's 0x0802C79C with 0x0802C8F8, and 0x08030548, which takes Erase Game away while no save holds a game (0x0801CA34),
// as none does: this Dreamport keeps no saves yet (0x0801C0D0), so each line says New Game. The result is where it goes on to
function* loadSaveLoop(c) {
  const { rom } = c;
  for (let n = 0; n < SAVE_LOAD_FRAMES; n++) yield;
  const backdrop = createBackdrop(c), { world, sprites, streak } = backdrop;
  // 0x08035654: Aku Aku, whose next frame comes a frame later as the logo's does
  const pointer = Object.assign(createSprite(rom, POINTER, 0, 0), { priority: 0 });
  pointer.next = pointer.animation.delay + 2;
  let selected = 0, clock = 0, leaving = null;
  for (;;) {
    clock++;
    // 0x0801C598: what the buttons do, with the lines stopping at once as they do on the title. A goes on (0x080692D0's states 8 to
    // 10), and B back (0x0806918C's state 20). Up and down skip Erase Game, as nothing can pick it (0x0801C6D0, 0x0801C784)
    let move = 0;
    if (c.pressed & KEY.A) { c.sound?.playEffect(MENU_SOUND); leaving = 'menu'; }
    else if (c.pressed & KEY.B) { c.sound?.playEffect(BACK_SOUND); leaving = 'title'; }
    else if (c.pressed & KEY.UP) move = SAVES - 1;
    else if (c.pressed & KEY.DOWN) move = 1;
    if (move) { c.sound?.playEffect(MOVE_SOUND); selected = (selected + move) % SAVES; }
    if (!leaving) streak();   // 0x08001B18
    moveWorld(world);     // 0x0802F374
    stepAnimation(pointer, clock);   // 0x0802CB28's 0x0801EF38 with 0x08035518
    // 0x0802C8F8: each line, then the list's Erase Game, the heading, Aku Aku at the line (0x0801C648 and 0x080355E8) and the hints
    for (let n = 0; n < SAVES; n++) drawText(c, sprites, n === selected ? BLUE : YELLOW, NEW_GAME, SAVE_X, SAVE_Y + n * SAVE_GAP);
    drawText(c, sprites, GREY, ERASE_GAME, 0x78, SAVE_Y + SAVES * SAVE_GAP);
    drawText(c, sprites, HEADING, LOAD_HEADING, 0x78, LOAD_HEADING_Y, 4);
    drawSprite(sprites, pointer, POINTER_X, SAVE_Y + selected * SAVE_GAP, c.colours);
    for (const [entry, x, y] of HINTS) drawText(c, sprites, SMALL, entry, x, y);
    showBackdrop(c, backdrop);
    yield;                // 0x08040E5C
    if (leaving) break;
  }
  if (leaving === 'menu') yield* writeSave(c, SAVE_WRITE_FRAMES);
  yield* fadeToWhite(c);  // 0x08015668's and 0x080155E4's 0x0803FC9C
  return leaving;
}

// The main menu's list at 0x02007CB0, as 0x0801C24C reads it (0x08075E30 on): where its lines start and how far apart they are,
// the words of Story Mode, Party Mode, Trading and Credits, and Aku Aku, 10 pixels to the left of the line he points at
const MENU_X = 0x28, MENU_Y = 0x48, MENU_GAP = 0x0E, MENU_LINES = [0x0806F228, 0x0806F22C, 0x0806F230, 0x0806F234], MENU_POINTER_X = -10;

// 0x0800C34C without the logo: its two animations, in the order 0x0800C580 draws them, from the same place as the logo's
const MENU_PICTURES = [0x082AF050, 0x082AF038];
const CODE_SOUND = 0x08085E80;

// 0x0801C19C: the main menu. The line picked shows the colours of the font 0x0200741C for 16 frames, then 0x020074AC's, counting from when it was
// picked (0x0801CA60, 0x0801CAD4). The result is where it goes on to
function* mainMenuLoop(c) {
  const { rom } = c;
  for (let n = 0; n < SAVE_LOAD_FRAMES; n++) yield;
  const backdrop = createBackdrop(c), { world, sprites, streak } = backdrop;
  const starting = address => {
    const sprite = Object.assign(createSprite(rom, address, 0, 0), { priority: 0 });
    sprite.next = sprite.animation.delay + 2;
    return sprite;
  };
  const pictures = MENU_PICTURES.map(starting), pointer = starting(POINTER);
  let selected = 0, count = 0, clock = 0, leaving = null;
  for (;;) {
    clock++;
    // 0x0800C494's animations, then 0x0801C9AC's lines and Aku Aku, then 0x0801C598's buttons. Up and down go round (0x0801C6D0, 0x0801C784)
    for (const sprite of pictures) stepAnimation(sprite, clock);
    stepAnimation(pointer, clock);
    const font = (count & 16) ? YELLOW : BLUE;
    count++;
    let move = 0;
    // 0x0801C148: L and R held, with nothing else, go to the screen for a code (0x080691D4's state 30), with a sound of their own
    if (c.held === (KEY.L | KEY.R)) { c.sound?.playEffect(CODE_SOUND); leaving = 'code'; }
    else if (c.pressed & KEY.A) { c.sound?.playEffect(MENU_SOUND); leaving = 'game'; }
    else if (c.pressed & KEY.B) { c.sound?.playEffect(BACK_SOUND); leaving = 'save'; }
    else if (c.pressed & KEY.UP) move = MENU_LINES.length - 1;
    else if (c.pressed & KEY.DOWN) move = 1;
    if (move) {
      c.sound?.playEffect(MOVE_SOUND);
      selected = (selected + move) % MENU_LINES.length;
      count = 0;
    }
    if (!leaving) streak();   // 0x08001B18
    moveWorld(world);     // 0x0802F374
    MENU_LINES.forEach((entry, n) => drawText(c, sprites, n !== selected ? YELLOW : move ? BLUE : font, entry, MENU_X, MENU_Y + n * MENU_GAP));
    drawSprite(sprites, pointer, MENU_X + MENU_POINTER_X, MENU_Y + selected * MENU_GAP, c.colours);
    for (const sprite of pictures) drawSprite(sprites, sprite, LOGO_X, LOGO_Y, c.colours);   // 0x0800C580
    showBackdrop(c, backdrop);
    yield;                // 0x08040E5C
    if (leaving) break;
  }
  // 0x080692B8's state 16, for Story Mode, writes the save first; the other lines' states go straight to the fade
  const story = leaving === 'game' && selected === 0;
  if (story) yield* writeSave(c, SAVE_AGAIN_FRAMES);
  yield* fadeToWhite(c);  // 0x08015668's 0x0803FC9C
  return story ? 'story' : leaving;
}

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

// 0x020071D8: where a scene's text goes, and 0x082AEB28 with 0x0806981C the arrow that says there's more
const SCENE_TEXT = { x: 0, y: 0x7C, w: 0xE2, h: 0x24 };
const MORE_ARROW = 0x082AEB28, MORE_X = 0xEA, MORE_Y = 0x94;

// The frames the console takes to load the scene, with the screen white: the console's timing, as mGBA measures it, as start-up's is
const SCENE_LOAD_FRAMES = 4;

// 0x0801CEBC: a scene with a story's text: the video, the script, the text and the arrow, on mode 4, whose sprites' tiles start at 512
// (0x08037C54), and 0x08015ED0's fade back from white
function* storyOpening(c) {
  const { video, rom } = c;
  for (let n = 0; n < SCENE_LOAD_FRAMES; n++) yield;
  c.scene = true;
  c.hblank = null;
  c.movie = null;
  c.stack = [{ list: STORY_OPENING, pc: 0 }];
  c.waited = 0;
  c.done = false;
  const sprites = createSprites(video, rom, 0x200);
  const arrow = Object.assign(createSprite(rom, MORE_ARROW, 0, 0), { priority: 0 });
  arrow.next = arrow.animation.delay + 2;
  c.fade.target = 0;
  c.fade.speed = 4;   // 0x0803FD8C
  let clock = 0;
  while (!c.done) {
    for (let n = updateDisplay(c); n > 0; n--) yield;
    yield* updateScript(c);
    if (c.done) break;
    stepAnimation(arrow, ++clock);   // 0x08035518
    // 0x080364E8's text, then 0x080355E8's arrow
    if (c.text.shown) layoutPage(c, sprites, c.text.shown);
    drawSprite(sprites, arrow, MORE_X, MORE_Y, c.colours);
    stepFade(c);          // 0x0803FB48
    workOutColours(c);    // 0x0803FBA4
    // the V-blank's work, in the picture of the buttons that frame, as the update comes right after the V-blank before
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

// 0x0803FC9C from a script, whose frames go as a fade to black's do
function* fadeToWhiteInScript(c, speed) {
  c.fade.target = 64;
  c.fade.speed = speed;
  c.fade.kind = 3;
  while (c.fade.level !== 64) {
    stepFade(c);
    workOutColours(c);
    c.video.pal.set(c.faded);
    yield;
  }
}

// 0x08000254 of the count of V-blanks: the time in milliseconds
const now = c => Math.trunc((c.vblanks * 1000) / 60);

// 0x0800D46C: a video in the display object, with its first frame drawn in the hidden page
function loadMovie(c, address) {
  // in a scene, the first V-blank after a video opens shows the hidden page once already, as mGBA measures it, though its colours come a frame later
  if (c.scene && c.movie) c.jobs.push(showMovieFrame);
  const movie = openMovie(c.rom, address);
  c.movie = movie;
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
    const { movie } = c, next = movie.frame > movie.frames ? movie.loop : movie.at;
    slow = movie.view.getUint32(next, true) >= SLOW_FRAME_BYTES ? 1 : 0;
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
    if (c.stack.at(-1) === list && list.pc === at) { c.waited++; return; }
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
  else if (kind === 4 && what === 1) asked = c.pressed;
  else if (kind === 7 && what === 5) asked = c.rom.u8(c.text.next - CARTRIDGE) === 0 ? 1 : 0;
  return [asked > value, asked < value, asked === value, asked !== value, (asked & value) === value][how];
}

// 0x0802D3E8 for the script's own commands, 0x0800DC0C for the display's and 0x08036400 for the text's
function* runCommand(c, [kind, what, argument], list) {
  if (kind === 3) {
    if (what === 0) {
      loadMovie(c, argument);
      for (let n = LOAD_FRAMES[argument] ?? 0; n > 0; n--) yield;
      c.due = now(c);   // once the first frame is drawn
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
    c.sound?.playEffect(argument);   // 0x080342A4
  } else if (what === 12) {
    c.sound?.startSong(argument);    // 0x0803407C
  }
  // 1 names the script
}
