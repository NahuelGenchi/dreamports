// npm run test:clock: the GBA kit's clock (kit/gba/c/clock.c) measured against the reference emulator, with a program
// of the project's own (clock/power-on.s), so it needs nobody's copy of any game. The program is assembled by the
// tools' own assembler into a made-up cartridge, and clock-check (tools/gba/clock-check.c) runs it in mGBA and the
// clock beside it, an instruction at a time: every instruction has to start at the same time by the clock as in the
// emulator, and every frame has to end after the same instruction, or the same step of the BIOS's own code. The
// program keeps the console busy across its frames' ends as a game's power-on does, so the test also has to find a
// frame that ends while a DMA holds the processor, and one that ends inside the BIOS's CpuSet.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL } from '../lib/paths.mjs';
import { CLOCK, build, isBuilt, isClockBuilt } from '../gba/build.mjs';
import { assemble } from '../gba/thumb.mjs';
import { madeUpGame } from './made-up-game.mjs';

const HERE = fileURLToPath(new URL('./clock/', import.meta.url));
const WORK = join(LOCAL, 'tmp', 'clock-test');
// where the program starts in the cartridge, after its header and the start that jumps to it, and how many frames
const MAIN = 0x200, FRAMES = 8;
// the first frame's end, as the emulator's display reaches its V-blank after power-on (clock.c)
const FIRST_FRAME_END = 117 + 224 + (160 - 127) * 1232;

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failed++;
};

if (!isBuilt() || !isClockBuilt()) build();
mkdirSync(WORK, { recursive: true });

// the cartridge: the made-up game's header, an ARM start that jumps to the program in Thumb, and the program. It's
// 512 KB, as mGBA takes one of 256 KB or less for a program sent over the link cable, which runs from the work memory
const { rom } = madeUpGame({ size: 0x80000 });
[0xE59F0000, 0xE12FFF10, 0x08000000 + MAIN + 1].forEach((word, i) => rom.writeUInt32LE(word, 0xC0 + 4 * i));   // ldr r0, [pc]; bx r0
const { sections } = assemble(readFileSync(join(HERE, 'power-on.s'), 'utf8'));
Buffer.from(sections['.text'].bytes).copy(rom, MAIN);
const cartridge = join(WORK, 'cartridge.gba');
writeFileSync(cartridge, rom);

console.log('The kit\'s clock beside the reference emulator, on a made-up program\'s power-on:');
const ran = spawnSync(CLOCK, [cartridge, String(FRAMES)], { encoding: 'utf8' });
const lines = ran.stdout.trim().split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
const frames = lines.filter(line => 'frame' in line), total = lines.find(line => 'compared' in line);
check(total && total.compared > 0 && total.differ === 0, `every instruction starts at the same time by the clock as in the emulator: ${total ? `${total.compared} compared, ${total.differ} differ${total.differ ? `, the first at 0x${total.first.pc.toString(16)}, ${total.first.clock} by the clock and ${total.first.emulator} in the emulator` : ''}` : ran.stderr}`);
check(frames.length >= 4 && frames.every(f => f.clock === f.emulator), `and each of its ${frames.length} frames ends after the same instruction: ${frames.map(f => `${f.emulator}${f.clock === f.emulator ? '' : ` (clock ${f.clock})`}`).join(', ')}`);
check(frames[0] && frames[0].emulator - FIRST_FRAME_END > 1000, `frame 0 ends after a DMA that holds the processor past its end, ${frames[0] ? frames[0].emulator - FIRST_FRAME_END : '?'} cycles`);
check(frames.some(f => f.pc < 0x4000), `and a frame ends inside the BIOS's CpuSet: frame ${frames.findIndex(f => f.pc < 0x4000)}`);
check(ran.status === 0, `clock-check says the same (it exits with ${ran.status})`);

// a frame the clock isn't told of, as a game leaves between the stretches it times: it goes on from the emulator's
// time after it, and has to keep the emulator's time from there, the timer and the sound's DMA brought up to it
// (a frame of the program's last loop: the clock times a whole CpuSet as it's called, so one can't be left out of it)
const SKIPPED = 5;
const again = spawnSync(CLOCK, [cartridge, String(FRAMES), String(SKIPPED)], { encoding: 'utf8' });
const after = again.stdout.trim().split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
const sum = after.find(line => 'compared' in line), ends = after.filter(line => 'frame' in line && line.frame > SKIPPED);
check(sum && sum.compared > 0 && sum.compared < total.compared && sum.differ === 0, `with frame ${SKIPPED} left untimed and the clock resumed after it, every instruction it's told of still starts at the emulator's time: ${sum ? `${sum.compared} compared, ${sum.differ} differ${sum.differ ? `, the first at 0x${sum.first.pc.toString(16)}, ${sum.first.clock} by the clock and ${sum.first.emulator} in the emulator` : ''}` : again.stderr}`);

if (failed) {
  console.log(`${failed} failed.`);
  process.exit(1);
}
console.log('The kit\'s clock keeps the emulator\'s time.');
