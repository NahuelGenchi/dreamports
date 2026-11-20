// npm run test:ps1-kit: the PlayStation's kit in C (kit/ps1/c/) and `prove` on the PlayStation. A small program of the
// project's own (made-up-ps1.mjs, madeUpGpuExe) runs on the console's real emulator, PCSX ReARMed, and its Dreamport in
// C (ps1-kit/main.c) on the kit, in a game of its own that the test removes after, so no game's copy is needed: every
// frame of 300 has to be the same, pixel for pixel, and so does the sound, silence. Then what `new` writes in C, and the
// Dreamport with its square a shade off, are each found at their first frame. Then a second program of its own
// (madeUpDrawExe) draws what a 3D game is made of, polygons, lines, textures, shading, dithering, mixing, a texture
// window and the mask bit, moving each frame, and its Dreamport in C (ps1-kit/draw.c) has to be the same in every frame
// of 300, and found at its first frame once a corner of one triangle is a pixel off. A third (madeUpSoundExe) plays the
// sound chip: sounds moved into its memory by DMA and by hand, six voices with their envelopes, noise, a pitch moved
// by another voice's and the reverb, keyed on and off over the frames. Its Dreamport in C (ps1-kit/sound.c) has to
// sound the same in all 300, and be found by its sound where it leaves the voice of noise unkeyed. A fourth
// (madeUpPadExe) reads the pad through SIO0 a byte at a time and draws what came back, proven with a recording that
// holds each button in turn: its Dreamport in C (ps1-kit/pad.c) has to be the same in all 300 frames, and be found at
// the first button held when it reads the second port, where nothing is held. A fifth (madeUpClockExe) takes
// interrupts with a handler of its own, from two root counters and the V-blank, and draws how many it has counted: its
// Dreamport in C (ps1-kit/clock.c) has to be the same in all 300 frames, and be found at once when counter 0's target
// is 5,000 cycles longer, so it interrupts once less before the first V-blank. A sixth (madeUpCdExe) boots from a disc
// of the test's own, a BIN and its .cue (madeUpCdDisc), gives the CD drive a script of commands, one or two a frame,
// and logs and draws every interrupt and answer, each sector's first bytes taken one at a time and the sum of its words
// moved by DMA: its Dreamport in C (ps1-kit/cd.c), reading the same disc, has to be the same in all 300 frames, and be
// found where its first sector shows when it reads from one sector on, or at single speed. A seventh (the same program,
// with cdSoundScript) boots from a disc with an XA file of 8 channels, each its own tones, and a track of audio
// (madeUpCdSoundDisc): it streams two of the channels, swaps left and right with the drive's volumes and back, and plays
// the track with its reports, muted and heard again. Its Dreamport has to sound the same in all 300 frames, and be found
// by its sound streaming another channel, swapping two frames late, and muting two frames late. Then a build that says the
// kit's ps1.c never waits, as psx_gpu and dfsound don't, is refused, with the way one of its functions waits.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder, resultFolder } from '../lib/paths.mjs';
import { buildWasm, cKit } from '../lib/c.mjs';
import { startingEntry, startingFiles } from '../lib/new-game.mjs';
import { CD, CD_SOUND, CLOCK, GPU, PAD, SOUND, cdScript, cdSoundScript, cdTime, drawList, madeUpCdDisc, madeUpCdSoundDisc, madeUpClockExe, madeUpDrawExe, madeUpGpuExe, madeUpPadExe, madeUpSoundExe, padRecording, soundList } from './made-up-ps1.mjs';

const GAME = 'test-ps1-kit', VERSION = `${GAME}/c`;
const DRAWING = 'test-ps1-kit-draw', DRAWN = `${DRAWING}/c`;
const SOUNDING = 'test-ps1-kit-sound', SOUNDED = `${SOUNDING}/c`;
const PADDING = 'test-ps1-kit-pad', PADDED = `${PADDING}/c`;
const TIMING = 'test-ps1-kit-clock', TIMED = `${TIMING}/c`;
const READING = 'test-ps1-kit-cd', READ = `${READING}/c`;
const LISTENING = 'test-ps1-kit-cd-sound', HEARD = `${LISTENING}/c`;
const WORK = join(LOCAL, 'test-ps1-kit');
const COPIES = join(LOCAL, 'copies.json');
const MEDIA = join(REPO, 'public', 'media');
const FRAMES = 300;

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
const dp = (...args) => {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 26 });
  return { status, out: stdout + stderr };
};
const report = (version = VERSION, recording = 'still') => {
  const file = join(resultFolder(version, recording), 'report.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
};
const tracked = () => spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: REPO, encoding: 'utf8' }).stdout;

function tidy() {
  const kept = existsSync(MEDIA) ? readdirSync(MEDIA).filter(file => file.startsWith(GAME)).map(file => join(MEDIA, file)) : [];
  for (const game of [GAME, DRAWING, SOUNDING, PADDING, TIMING, READING, LISTENING]) for (const path of [gameFolder(game), join(LOCAL, 'results', game), join(LOCAL, 'captures', game), join(REPO, '.github', 'readme', 'progress', `${game}.svg`)]) rmSync(path, { recursive: true, force: true });
  for (const path of [WORK, ...kept]) rmSync(path, { recursive: true, force: true });
}

// the Dreamport in C, with the program's numbers, and `changes`, each [what's there, what goes there instead]
function writeGame(changes = []) {
  let code = readFileSync(join(REPO, 'tools', 'test', 'ps1-kit', 'main.c'), 'utf8').replace(/@([A-Z_]+)@/g, (_, key) => `0x${GPU[key].toString(16).toUpperCase()}`);
  for (const [from, to] of changes) code = code.replace(from, to);
  writeFileSync(join(gameFolder(VERSION), 'src', 'main.c'), code);
}

// a game of the test's own in games/, with the program `exe` as its copy, or a disc, { bin, cue }, and `more` in its
// original.json, which rom knows, its code map, its first files in JavaScript and in C, and a recording of 300 frames
// with nothing held
async function makeGame(game, version, exe, name, more = {}) {
  let copy = join(WORK, `${game}.exe`);
  if (Buffer.isBuffer(exe)) writeFileSync(copy, exe);
  else {
    writeFileSync(join(WORK, `${game}.bin`), exe.bin);
    writeFileSync(copy = join(WORK, `${game}.cue`), exe.cue);
  }
  const bytes = Buffer.isBuffer(exe) ? exe : exe.bin;
  const original = { console: 'ps1', name, title: game, code: '', sha1: createHash('sha1').update(bytes).digest('hex'), ...more };
  mkdirSync(join(proofFolder(game), 'recordings'), { recursive: true });
  writeFileSync(join(proofFolder(game), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
  let run = dp('rom', copy);
  check(run.status === 0 && run.out.includes(game), `rom knows ${game}'s copy`);
  run = dp('codemap', game);
  check(run.status === 0, `its code map is found in the copy: ${run.out.trim().split('\n').at(-1)}`);
  const files = { ...startingFiles(game, original), 'entry.md': startingEntry(game, original, { issue: 1, lead: 'nobody', added: '2026-01-01' }) };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(gameFolder(game), file, '..'), { recursive: true });
    writeFileSync(join(gameFolder(game), file), text);
  }
  for (const [file, text] of Object.entries(startingFiles(game, original, { language: 'c' }))) {
    mkdirSync(join(gameFolder(version), file, '..'), { recursive: true });
    writeFileSync(join(gameFolder(version), file), text);
  }
  writeFileSync(join(proofFolder(game), 'recordings', 'still.json'), `${JSON.stringify({ about: 'Nothing held.', frames: FRAMES, held: [[0, []]] }, null, 2)}\n`);
}

// the drawing program's Dreamport in C, with its words, and `changes` as writeGame takes them
function writeDrawing(changes = []) {
  const { setup, frame } = drawList(), words = list => list.map(word => `0x${word.toString(16).toUpperCase()}`).join(', ');
  let code = readFileSync(join(REPO, 'tools', 'test', 'ps1-kit', 'draw.c'), 'utf8').replace('@SETUP@', words(setup)).replace('@FRAME@', words(frame));
  for (const [from, to] of changes) code = code.replace(from, to);
  writeFileSync(join(gameFolder(DRAWN), 'src', 'main.c'), code);
}

// the sound program's Dreamport in C, with its sounds, its script and its numbers, and `changes` as writeGame takes them
function writeSound(changes = []) {
  const { loops, click, script } = soundList(), words = list => list.map(word => `0x${word.toString(16).toUpperCase()}`).join(', ');
  let code = readFileSync(join(REPO, 'tools', 'test', 'ps1-kit', 'sound.c'), 'utf8').replace('@LOOPS@', words(loops)).replace('@CLICK@', words(click)).replace('@SCRIPT@', words(script))
    .replace(/@([A-Z_]+)@/g, (_, key) => `0x${SOUND[key].toString(16).toUpperCase()}`);
  for (const [from, to] of changes) code = code.replace(from, to);
  writeFileSync(join(gameFolder(SOUNDED), 'src', 'main.c'), code);
}

// the pad program's Dreamport in C, reading the port `select` says, 0x1003 the first and 0x3003 the second
function writePad(select = 0x1003) {
  const code = readFileSync(join(REPO, 'tools', 'test', 'ps1-kit', 'pad.c'), 'utf8').replace('@PORT@', `0x${select.toString(16).toUpperCase()}`)
    .replace(/@([A-Z_]+)@/g, (_, key) => `0x${PAD[key].toString(16).toUpperCase()}`);
  writeFileSync(join(gameFolder(PADDED), 'src', 'main.c'), code);
}

// the clock program's Dreamport in C, with counter 0's target `target`
function writeClock(target = CLOCK.TARGET_0) {
  const hex = value => `0x${value.toString(16).toUpperCase()}`;
  const code = readFileSync(join(REPO, 'tools', 'test', 'ps1-kit', 'clock.c'), 'utf8').replace('@TARGET_0@', hex(target)).replace('@TARGET_2@', hex(CLOCK.TARGET_2))
    .replace('@BACKGROUND@', hex(CLOCK.BACKGROUND)).replace(/@BAR_(\d)@/g, (_, n) => hex(CLOCK.BARS[n]));
  writeFileSync(join(gameFolder(TIMED), 'src', 'main.c'), code);
}

// the CD program's Dreamport in C, in `version`, with its script, `script`, and numbers; the parameters of what its
// script gives at frame `frame`, if it's given, put as `parameters` instead, or what it gives there put at frame `to`
function writeCd({ version = READ, script = cdScript(), frame = -1, parameters = [], to = null } = {}) {
  const hex = value => `0x${value.toString(16).toUpperCase()}`;
  script = [...script];
  for (let at = 0; at < script.length; at += 8) {
    if ((script[at] | script[at + 1] << 8) !== frame) continue;
    script.splice(at + 4, parameters.length, ...parameters);
    if (to !== null) [script[at], script[at + 1]] = [to & 0xFF, to >> 8];
  }
  const code = readFileSync(join(REPO, 'tools', 'test', 'ps1-kit', 'cd.c'), 'utf8').replace('@SCRIPT@', script.map(hex).join(', '))
    .replace(/@([A-Z_]+)@/g, (_, key) => hex(CD[key]));
  writeFileSync(join(gameFolder(version), 'src', 'main.c'), code);
}

async function main() {
  const before = tracked(), copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
  tidy();
  mkdirSync(WORK, { recursive: true });
  try {
    await makeGame(GAME, VERSION, await madeUpGpuExe(), 'Test PlayStation Kit (World)');
    let run;

    console.log('What new writes in C, on the PlayStation\'s kit:');
    run = dp('prove', VERSION, 'still');
    check(run.status !== 0 && report().firstDifference?.frame === 0, `the whole screen filled blue isn't the program's picture, and differs at once: ${JSON.stringify(report().firstDifference)}`);

    console.log('The program\'s Dreamport in C:');
    writeGame();
    run = dp('prove', VERSION, 'still');
    if (run.status !== 0) console.log(run.out.split('\n').slice(-15).join('\n'));
    check(run.status === 0 && report().frames === FRAMES && !report().firstDifference, `all ${FRAMES} frames the same as the emulator's, pictures and sound: ${run.out.trim().split('\n').at(-1)}`);

    console.log('With its square a shade off:');
    writeGame([[`0x60000000 | 0x${GPU.SQUARE.toString(16).toUpperCase()}`, `0x60000000 | 0x${(GPU.SQUARE + 0x08).toString(16).toUpperCase()}`]]);
    run = dp('prove', VERSION, 'still');
    check(run.status !== 0 && report().firstDifference?.frame === 0, `the first frame differs, at the square: ${JSON.stringify(report().firstDifference)}`);

    console.log('Polygons, lines and textures, moving each frame:');
    await makeGame(DRAWING, DRAWN, await madeUpDrawExe(), 'Test PlayStation Drawing (World)');
    writeDrawing();
    run = dp('prove', DRAWN, 'still');
    if (run.status !== 0) console.log(run.out.split('\n').slice(-15).join('\n'));
    check(run.status === 0 && report(DRAWN).frames === FRAMES && !report(DRAWN).firstDifference, `all ${FRAMES} frames the same as the emulator's, pictures and sound: ${run.out.trim().split('\n').at(-1)}`);
    const corner = `0x${(0x20000000 | 200 | 40 << 8 | 40 << 16).toString(16).toUpperCase()}, 0xA000A`;
    writeDrawing([[corner, `${corner.slice(0, -1)}B`]]);
    run = dp('prove', DRAWN, 'still');
    check(run.status !== 0 && report(DRAWN).firstDifference?.frame === 0, `with one triangle's corner a pixel off, the first frame differs: ${JSON.stringify(report(DRAWN).firstDifference)}`);

    console.log('The sound chip, voices keyed on and off over the frames:');
    await makeGame(SOUNDING, SOUNDED, await madeUpSoundExe(), 'Test PlayStation Sound (World)');
    writeSound();
    run = dp('prove', SOUNDED, 'still');
    if (run.status !== 0) console.log(run.out.split('\n').slice(-15).join('\n'));
    check(run.status === 0 && report(SOUNDED).frames === FRAMES && !report(SOUNDED).firstDifference && report(SOUNDED).sound?.heard, `all ${FRAMES} frames the same as the emulator's, pictures and sound, and sound heard: ${run.out.trim().split('\n').at(-1)}`);
    // the voice of noise keyed on at frame 100 with nothing, which the chip takes as no key at all: a note moved even an
    // octave stays within what `prove`'s bands of pitch let through, as each hears its neighbours
    writeSound([['0x641D88, 0x8,', '0x641D88, 0x0,']]);
    run = dp('prove', SOUNDED, 'still');
    const heard = report(SOUNDED).sound?.firstDifference;
    check(run.status !== 0 && !report(SOUNDED).firstPictureDifference && heard?.frame >= 98 && heard?.frame <= 102, `with the voice of noise never keyed on, its sound differs where the noise starts: ${JSON.stringify(heard)}`);

    console.log('The pads, each button held in turn:');
    // it reads the pad just after the V-blank, in the frame the emulator gives it that frame's buttons
    await makeGame(PADDING, PADDED, await madeUpPadExe(), 'Test PlayStation Pad (World)', { keysAfterVBlank: true });
    writeFileSync(join(proofFolder(PADDING), 'recordings', 'buttons.json'), `${JSON.stringify(padRecording(FRAMES), null, 2)}\n`);
    writePad();
    run = dp('prove', PADDED, 'buttons');
    if (run.status !== 0) console.log(run.out.split('\n').slice(-15).join('\n'));
    check(run.status === 0 && report(PADDED, 'buttons').frames === FRAMES && !report(PADDED, 'buttons').firstDifference, `all ${FRAMES} frames the same as the emulator's, every button: ${run.out.trim().split('\n').at(-1)}`);
    writePad(0x3003);
    run = dp('prove', PADDED, 'buttons');
    const first = report(PADDED, 'buttons').firstDifference;
    check(run.status !== 0 && first?.frame >= 5 && first?.frame <= 8, `reading the second port, where nothing is held, it differs at the first button held: ${JSON.stringify(first)}`);

    console.log('The clock: root counters and the V-blank, taken as interrupts:');
    await makeGame(TIMING, TIMED, await madeUpClockExe(), 'Test PlayStation Clock (World)');
    writeClock();
    run = dp('prove', TIMED, 'still');
    if (run.status !== 0) console.log(run.out.split('\n').slice(-15).join('\n'));
    check(run.status === 0 && report(TIMED).frames === FRAMES && !report(TIMED).firstDifference, `all ${FRAMES} frames the same as the emulator's: ${run.out.trim().split('\n').at(-1)}`);
    writeClock(CLOCK.TARGET_0 + 5000);
    run = dp('prove', TIMED, 'still');
    check(run.status !== 0 && report(TIMED).firstDifference?.frame === 0, `with counter 0's target 5,000 cycles longer, it differs at once: ${JSON.stringify(report(TIMED).firstDifference)}`);

    console.log('The CD drive: commands, answers and sectors from a disc of the test\'s own:');
    await makeGame(READING, READ, await madeUpCdDisc(READING), 'Test PlayStation CD (World)');
    writeCd();
    run = dp('prove', READ, 'still');
    if (run.status !== 0) console.log(run.out.split('\n').slice(-15).join('\n'));
    check(run.status === 0 && report(READ).frames === FRAMES && !report(READ).firstDifference, `all ${FRAMES} frames the same as the emulator's: ${run.out.trim().split('\n').at(-1)}`);
    // the first sector read, at double speed, comes 44,000 cycles into frame 16, after the drive's seek and the half a
    // sector's time it reads its subchannel ahead, and its sum shows in that frame's picture
    writeCd({ frame: 13, parameters: cdTime(CD.DATA_AT + 1) });
    run = dp('prove', READ, 'still');
    check(run.status !== 0 && report(READ).firstDifference?.frame === 16, `reading from one sector on, it differs at frame 16, where the first sector's sum shows: ${JSON.stringify(report(READ).firstDifference)}`);
    writeCd({ frame: 12, parameters: [0x00] });
    run = dp('prove', READ, 'still');
    check(run.status !== 0 && report(READ).firstDifference?.frame === 16, `reading at single speed, it differs at frame 16 too, where the first sector hasn't come yet: ${JSON.stringify(report(READ).firstDifference)}`);

    console.log('The CD\'s own sound: XA sound streamed, and a track of audio played:');
    await makeGame(LISTENING, HEARD, await madeUpCdSoundDisc(LISTENING), 'Test PlayStation CD Sound (World)');
    const listen = (changes = {}) => {
      writeCd({ version: HEARD, script: cdSoundScript(), ...changes });
      const ran = dp('prove', HEARD, 'still');
      return { ran, found: report(HEARD) };
    };
    let sound = listen();
    if (sound.ran.status !== 0) console.log(sound.ran.out.split('\n').slice(-15).join('\n'));
    check(sound.ran.status === 0 && sound.found.frames === FRAMES && !sound.found.firstDifference && sound.found.sound?.heard, `all ${FRAMES} frames the same as the emulator's, pictures and sound, and sound heard: ${sound.ran.out.trim().split('\n').at(-1)}`);
    // each a sound that differs where it starts, as `prove` hears it: a channel of the XA file's of other tones, the
    // drive's volumes that swap left and right two frames late, and the track of audio muted two frames late, as
    // `prove` takes a sound one frame early or late as the same
    sound = listen({ frame: 2, parameters: [0x01, 0x01] });
    check(sound.ran.status !== 0 && sound.found.sound?.firstDifference?.frame === 7, `streaming XA channel 1 instead of 0, its sound differs where the stream starts: ${JSON.stringify(sound.found.sound?.firstDifference)}`);
    sound = listen({ frame: 60, to: 62 });
    check(sound.ran.status !== 0 && sound.found.sound?.firstDifference?.frame === 59, `swapping left and right two frames late, its sound differs where the swap is heard: ${JSON.stringify(sound.found.sound?.firstDifference)}`);
    sound = listen({ frame: 150, to: 152 });
    check(sound.ran.status !== 0 && sound.found.sound?.firstDifference?.frame === 151, `muting the track of audio two frames late, its sound differs there: ${JSON.stringify(sound.found.sound?.firstDifference)}`);

    console.log('What the kit says never waits, checked:');
    // ps1.c runs the game's frames, which wait, so a kit that said it never waits can't be built
    const kit = cKit('ps1'), sources = [join(gameFolder(READ), 'src', 'main.c'), ...kit.sources];
    let refused = null;
    try {
      await buildWasm(sources, join(WORK, 'never-waits.wasm'), { ...kit, neverWait: [...kit.neverWait, join(REPO, 'kit', 'ps1', 'c', 'ps1.c')] });
    } catch (error) {
      refused = error.message;
    }
    check(/kit\/ps1\/c\/ps1\.c is among the kit's sources that never wait/.test(refused) && /→ asyncify\.start_unwind\.$/.test(refused), `with ps1.c said to never wait, the build is refused, with the way one of its functions waits: ${refused}`);
  } finally {
    tidy();
    if (copies) writeFileSync(COPIES, copies);
    else rmSync(COPIES, { force: true });
  }
  check(!existsSync(gameFolder(GAME)), 'nothing is left behind');
  check(tracked() === before, 'nothing the repository tracks has changed');
  if (failures.length) {
    console.log(`\n${failures.length} failed.`);
    process.exit(1);
  }
  console.log('\nThe PlayStation\'s kit draws, sounds, reads its pads and its CD, hears the CD\'s own sound and keeps the console\'s time as the console does, every frame.');
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
