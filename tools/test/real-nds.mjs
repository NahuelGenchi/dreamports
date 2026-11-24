// npm run test:real-nds: the Nintendo DS's reference emulator, melonDS, built as it's built on a contributor's computer,
// at the commit tools/consoles.mjs fixes, with the tools' own front (../nds/melonds/), and driven a frame at a time by a
// small program written here (made-up-nds.mjs), so no game's copy is needed. It checks what the console's entry in
// kit/consoles.js says against what the emulator does, that a recording's buttons and touches reach the program on the
// frame they're given, that the program's two screens and its sound come out as the program makes them, and that every
// frame's picture and every sample is the same in each run and on every computer, by a hash kept here.

import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL } from '../lib/paths.mjs';
import { expand, readRecording, writeRecording } from '../lib/recording.mjs';
import { readAnyCopy } from '../lib/read-copy.mjs';
import { consoleOf } from '../consoles.mjs';
import { CONSOLES } from '../../kit/consoles.js';
import { libretroReference } from '../libretro/reference.mjs';
import { readNdsHeader } from '../nds/header.mjs';
import { ARM7, ARM9, PITCH, SHARED, madeUpNds } from './made-up-nds.mjs';

const WORK = join(LOCAL, 'test-real-nds');
// every frame's picture and every sample of the recording below, as this test first heard them, on Windows
const SAME_EVERYWHERE = '82db3813fdd5827d7279ba03c84eb6a83bb1e6d3';

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};

// the console's ten buttons as its own register has them, a bit each, which the program puts in the upper screen's colour
const REGISTER = { A: 1, B: 2, SELECT: 4, START: 8, RIGHT: 16, LEFT: 32, UP: 64, DOWN: 128, R: 256, L: 512 };
// and X and Y, which only the ARM7 reads, as the program puts them in the lower screen's
const OTHER = { X: 1, Y: 2 };
const TOUCH = /^TOUCH@(\d+),(\d+)$/;

async function main() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const { rom, sha1 } = madeUpNds();
  const copy = join(WORK, 'program.nds');
  writeFileSync(copy, rom);

  console.log('A made-up cartridge\'s header');
  const header = readNdsHeader(rom);
  check(header.title === 'MADE UP DS' && header.code === 'MDUE' && header.region === 'USA', `its title, code and region: ${header.title}, ${header.code}, ${header.region}`);
  check(header.arm9.offset === ARM9.offset && header.arm9.address === ARM9.address && header.arm9.entry === ARM9.address && header.arm9.size > 0
    && header.arm7.offset === ARM7.offset && header.arm7.address === ARM7.address && header.arm7.size > 0,
  `where its ARM9 and ARM7 programs are, in the copy and in memory: 0x${header.arm9.offset.toString(16)} to 0x${header.arm9.address.toString(16)}, 0x${header.arm7.offset.toString(16)} to 0x${header.arm7.address.toString(16)}`);
  check(header.files.names.size === 0 && header.files.places.size === 0 && header.overlays.arm9.size === 0, 'and that it has no files and no overlays');
  const told = await readAnyCopy(copy);
  check(told?.console === 'nds' && told.title === 'MADE UP DS' && told.code === 'MDUE' && told.sha1 === sha1, `the tools tell the copy by its header: ${told?.console}, ${told?.title}`);
  const spoiled = Buffer.from(rom);
  spoiled[0] ^= 1;
  const untold = join(WORK, 'spoiled.nds');
  writeFileSync(untold, spoiled);
  check(await readAnyCopy(untold) === null, 'and not one whose header\'s checksum doesn\'t add up');

  console.log('The program in melonDS');
  const machine = consoleOf('nds'), reference = libretroReference(machine), KEY = reference.KEY;
  await reference.ensureOriginal(console.log);
  check(KEY['TOUCH@255,191'] !== undefined && KEY['TOUCH@256,0'] === undefined && KEY['TOUCH@0,192'] === undefined, 'a touch is a pixel of the lower screen, and nothing outside it');

  // a recording as the tools keep one, with each button and two touches, written and read back
  const names = ['A', 'B', 'SELECT', 'START', 'RIGHT', 'LEFT', 'UP', 'DOWN', 'R', 'L', 'X', 'Y'];
  const held = [[0, []], ...names.map((name, i) => [20 + i * 10, [name]]), [140, ['A', 'RIGHT', 'Y']], [150, []], [160, ['TOUCH@200,150']], [170, ['B', 'TOUCH@10,191']], [180, ['TOUCH@0,0']], [190, ['TOUCH@255,191']], [200, []], [210, ['A']], [240, []]];
  const file = join(WORK, 'recording.json'), FRAMES = 260;
  writeRecording(file, { about: 'Each button, some together, four touches, and a note.', frames: FRAMES, held });
  const recording = readRecording(file), lists = expand(recording.held, FRAMES);
  check(JSON.stringify(recording.held) === JSON.stringify(held.map(([frame, list]) => [frame, [...list].sort()])), 'a recording keeps where the screen is touched beside the buttons, as TOUCH@x,y');
  const buttons = lists.map(list => list.reduce((mask, b) => mask | (KEY[b] ?? 0), 0));

  const reads = [];
  for (const frame of [165, 175, 185, 195, 205]) for (const [name, address] of Object.entries(SHARED)) reads.push({ frame, name, address, bytes: 4 });
  const pictures = Array.from({ length: FRAMES }, (_, frame) => frame);
  const play = () => reference.runOriginal({ copy, frames: FRAMES, buttons, sound: true, pictures, reads });
  const first = await play();

  const { rate, fps, sizes } = first.outside, { screen, screens, frame: [ticks, clock], sound } = CONSOLES.nds;
  check(rate === sound && sound === clock / 1024, `it mixes a pair of samples every 1,024 ticks of its clock, as kit/consoles.js says: ${rate} a second`);
  check(Math.abs(fps - clock / ticks) < 1e-4, `a frame lasts ${ticks} ticks: ${fps} frames a second`);
  check(sizes.length === 1 && sizes[0][1] === screen[0] && sizes[0][2] === screen[1] && screens.length === 2 && screens.every(([, , width, height]) => width === 256 && height === 192),
    `its picture is two screens of 256 by 192, one above the other: ${sizes[0][1]} by ${sizes[0][2]}`);

  // what the program shows: each screen is one colour, the upper from the count of frames and the ten buttons of the
  // frame before, the lower from X and Y of the frame before, or from where the pen was two frames before, as the
  // ARM7 takes most of a frame to ask the touch screen's chip
  const [, top, width, height] = screens[1], lower = top * width;
  let plain = 0, upperRight = 0, lowerRight = 0;
  const wrong = [];
  for (let frame = 1; frame < FRAMES; frame++) {
    const picture = first.pictures.get(frame), before = lists[frame - 1], twoBefore = lists[Math.max(0, frame - 2)];
    const one = (from, to) => { for (let p = from + 1; p < to; p++) if (picture[p] !== picture[from]) return false; return true; };
    if (one(0, lower) && one(lower, lower + width * height)) plain++;
    const pressed = before.reduce((bits, name) => bits | (REGISTER[name] ?? 0), 0);
    if (picture[0] === ((frame & 31) | pressed << 5)) upperRight++;
    else wrong.push(`upper at ${frame}: ${picture[0].toString(16)}`);
    // the frame a touch starts or ends on, the ARM9 reads what the ARM7 left it a frame earlier or later
    const touch = twoBefore.map(name => TOUCH.exec(name)).find(Boolean), touchBefore = before.some(name => TOUCH.test(name));
    if (!!touch !== touchBefore) { lowerRight++; continue; }
    const expected = touch ? 0x4000 | (Number(touch[1]) * 16 >> 7) | (Number(touch[2]) * 16 >> 7) << 5 : before.reduce((bits, name) => bits | (OTHER[name] ?? 0), 0) << 10;
    if (picture[lower] === expected) lowerRight++;
    else wrong.push(`lower at ${frame}: ${picture[lower].toString(16)} for ${expected.toString(16)}`);
  }
  check(plain === FRAMES - 1, `each screen is one colour on every frame: ${plain} of ${FRAMES - 1}`);
  check(upperRight === FRAMES - 1, `the upper screen counts the frames and shows each of the ten buttons the frame after it's held: ${upperRight} of ${FRAMES - 1}${wrong.length ? `, ${wrong.slice(0, 3).join('; ')}` : ''}`);
  check(lowerRight === FRAMES - 1, `the lower screen shows X and Y, which the ARM7 reads, and where it's touched: ${lowerRight} of ${FRAMES - 1}`);

  const read = Object.fromEntries(reads.map(({ frame, name }, i) => [`${name}@${frame}`, first.outside.reads[i]]));
  const pen = frame => `${read[`x@${frame}`]},${read[`y@${frame}`]}`;
  check(pen(165) === '3200,2400' && pen(175) === '160,3056' && pen(185) === '0,0' && pen(195) === '4080,3056', `the touch screen's chip gives each touch's pixel, times 16: ${[165, 175, 185, 195].map(pen).join(' ')}`);
  check((read['keys@195'] & 64) === 0 && (read['keys@205'] & 64) === 64 && read['frames@205'] === 206, 'the pen is down while the screen is touched and up after, and the program has counted every frame');

  // the square wave while A is held, and nothing before it
  const heard = (from, to) => { const all = []; for (let frame = from; frame < to; frame++) all.push(...first.sound.read(frame)); return all; };
  const quiet = heard(60, 140), note = heard(215, 235);
  let crossings = 0;
  for (let i = 2; i < note.length; i += 2) if ((note[i] < 0) !== (note[i - 2] < 0)) crossings++;
  const seconds = note.length / 2 / sound, pitch = crossings / 2 / seconds;
  check(quiet.every(sample => sample === 0), 'no sound while A isn\'t held');
  check(note.every(sample => sample === 255 || sample === -256) && Math.abs(pitch - PITCH) < 3, `a square wave as loud as the mixer goes while it is, at the pitch its timer gives: ${pitch.toFixed(1)} Hz for ${PITCH.toFixed(1)}`);
  let samples = 0;
  for (let frame = 0; frame < FRAMES; frame++) samples += first.sound.read(frame).length / 2;
  check(Math.abs(samples - FRAMES * sound * ticks / clock) < 2, `every frame has the samples it lasts: ${samples} in ${FRAMES} frames`);

  const digestOf = run => {
    const hash = createHash('sha1').update(Buffer.from(run.hashes.buffer));
    for (let frame = 0; frame < FRAMES; frame++) hash.update(Buffer.from(Int16Array.from(run.sound.read(frame)).buffer));
    return hash.digest('hex');
  };
  const digest = digestOf(first);
  first.sound.close();
  const second = await play(), again = digestOf(second);
  second.sound.close();
  check(digest === again && new Set(first.hashes).size > 100, 'a second run gives the same pictures and the same samples');
  check(digest === SAME_EVERYWHERE, `and they're the ones kept here, the same on every computer: ${digest}`);
}

try {
  await main();
} finally {
  rmSync(WORK, { recursive: true, force: true });
}

if (failures.length) {
  console.log(`\n${failures.length} failed.`);
  process.exit(1);
}
console.log('\nAll passed.');
process.exit(0);
