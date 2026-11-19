// npm run test:sound-console: the GBA kit as the sound hardware of a game that runs the console's sound engine
// itself (gba_sound_console, kit/gba/c/sound.c), with a program of the project's own (sound-console/game.c). What comes
// out has to be what the registers and the FIFOs' samples make: FIFO A's level on both sides while it has samples,
// silence in a frame with none, a square wave once one is started, and silence with the sound switched off.

import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL } from '../lib/paths.mjs';
import { buildWasm, cKit } from '../lib/c.mjs';
import { madeUpGame } from './made-up-game.mjs';

const HERE = fileURLToPath(new URL('./sound-console/', import.meta.url));
const WORK = join(LOCAL, 'tmp', 'sound-console-test');
// the proof tools' rate, and how many samples a frame of the console is at it
const RATE = 65536, FRAME = Math.round(RATE * 280896 / 16777216);

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failed++;
};

mkdirSync(WORK, { recursive: true });
const kit = cKit('gba'), out = join(WORK, 'game.wasm');
await buildWasm([join(HERE, 'game.c'), ...kit.sources], out, kit);
const imports = { env: new Proxy({}, { get: (_, name) => () => { throw new Error(`called ${String(name)}`); } }), dreamports: { save_read() {}, save_write() {} } };
const { instance } = await WebAssembly.instantiate(readFileSync(out), imports);
const game = instance.exports, { rom } = madeUpGame({ size: 0x1000 });
new Uint8Array(game.memory.buffer, game.dp_rom(rom.length), rom.length).set(rom);
game.dp_start();
game.dp_sound_output(RATE, 1);
const max = game.dp_sound_render_max();
// a frame of the game, then that frame's sound, as the proof tools take it: the left side and the right
const frame = () => {
  game.dp_step(0);
  const left = [], right = [];
  for (let done = 0; done < FRAME;) {
    const count = Math.min(max, FRAME - done), at = game.dp_sound_render(count) >> 2, samples = new Float32Array(game.memory.buffer);
    for (let i = 0; i < count; i++) { left.push(samples[at + i]); right.push(samples[at + max + i]); }
    done += count;
  }
  return { left, right };
};
const all = (side, value) => side.every(sample => Math.abs(sample - value) < 1e-6);
const swing = side => Math.max(...side) - Math.min(...side);

console.log('The GBA kit as the sound hardware of a game that runs the sound engine itself:');
const fifo = frame();
// 64 at full volume is 256 of the DAC's 512
check(all(fifo.left, 0.5) && all(fifo.right, 0.5), `FIFO A's samples come out on both sides at their level: ${fifo.left[10]}, ${fifo.right[10]}`);
const none = frame();
// (a frame is 1,097 and a quarter samples at this rate, so a frame's first samples can still be the one before's)
check(all(none.left.slice(8), 0) && all(none.right.slice(8), 0), 'a frame the game gives no samples for is silent');
const square = frame();
check(swing(square.left) > 0.1 && swing(square.right) > 0.1, `a square wave the game starts through the chip's registers sounds: a swing of ${swing(square.left).toFixed(3)}`);
const off = frame();
check(swing(off.left.slice(8)) === 0 && swing(off.right.slice(8)) === 0, 'and with the sound switched off it stops');

if (failed) {
  console.log(`${failed} failed.`);
  process.exit(1);
}
console.log('The kit plays what the game\'s own engine gives it.');
