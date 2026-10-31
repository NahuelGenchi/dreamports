// The engine and the sound hardware on one clock: a GBA frame (280896 CPU cycles) runs the engine once, the
// DirectSound samples it mixes play during the next frame (176 a frame at 10512 Hz), and the hardware mix is
// sampled every 256 cycles and averaged down to the output rate.

import { createM4A, HALF } from './m4a.js';
import { createApu, CPU_HZ, TICK } from './apu.js';

const FRAME_CYCLES = 280896;
const FULL_SCALE = 512;   // the 10-bit DAC swings ±512 around the bias
const DC_POLE = 0.9995;   // the output's coupling capacitor, as a one-pole high-pass
const PAUSE = 0x80000000;

// without a music manager of the game's own, each frame runs the calls queued for it, in order
const runCalls = engine => ({ frame(calls) { for (const [name, args] of calls) engine[name](...args); } });

/**
 * @param {Uint8Array} rom
 * @param {{songTable: number, playerTable: number, players: number, mode: object}} layout (tables.js)
 * @param {number} rate output sample rate in Hz
 * @param {(engine: object) => {frame(calls: Array): void}} manager makes what runs each frame's queued calls on
 *   `engine`: by default each call as it is; a game whose music manager decides what plays gives its own
 */
export function createSynth(rom, layout, rate, manager = runCalls) {
  const apu = createApu();
  const engine = createM4A(rom, layout, apu);
  const queue = [], calls = manager(engine);
  const n = engine.samples, SAMPLE_CYCLES = FRAME_CYCLES / n;   // 1596 cycles per DirectSound sample at 10512 Hz
  let playing = new Int8Array(2 * n), pending = new Int8Array(2 * n);
  let cycle = 0, frameStart = 0, nextFrame = 0;
  let curL = 0, curR = 0, frac = 1;
  let inL = 0, inR = 0, outL = 0, outR = 0;
  const ticksPerSample = CPU_HZ / TICK / rate;

  function frame() {
    [playing, pending] = [pending, playing];
    calls.frame(queue.splice(0));
    const base = engine.frame(), pcm = engine.info.pcm;
    pending.set(pcm.subarray(base, base + n), 0);
    pending.set(pcm.subarray(HALF + base, HALF + base + n), n);
  }

  // the cycle counts start again from 0 with each frame, so they stay small whole numbers: a growing one would
  // become a new object at every step on the audio thread
  function tick() {
    if (cycle >= nextFrame) { cycle -= nextFrame; frameStart = 0; nextFrame = FRAME_CYCLES; frame(); }
    const i = Math.floor((cycle - frameStart) / SAMPLE_CYCLES);
    apu.run(TICK);
    const out = apu.mix(playing[i], playing[n + i]);
    curL = out[0]; curR = out[1];
    cycle += TICK;
  }

  return {
    engine,
    /** Queues an engine call (songStart, pitchControl, …), or one for the game's music manager, for the start
     *  of the next frame. */
    call(name, ...args) { queue.push([name, args]); },
    /** Fills `left` and `right` with the next samples, in [-1, 1] times `gain`. */
    render(left, right, gain = 1, dcBlock = true) {
      // the running fractions in local variables while the block is made: kept outside the function, each new
      // value would be a new object
      let f = frac, iL = inL, iR = inR, oL = outL, oR = outR;
      for (let j = 0; j < left.length; j++) {
        let need = ticksPerSample, l = 0, r = 0;
        while (need > 1e-9) {
          if (f >= 1) { tick(); f -= 1; }
          const take = Math.min(1 - f, need);
          l += curL * take; r += curR * take;
          f += take; need -= take;
        }
        l /= ticksPerSample * FULL_SCALE; r /= ticksPerSample * FULL_SCALE;
        if (dcBlock) {
          oL = l - iL + DC_POLE * oL; iL = l;
          oR = r - iR + DC_POLE * oR; iR = r;
          l = oL; r = oR;
        }
        left[j] = l * gain; right[j] = r * gain;
      }
      frac = f; inL = iL; inR = iR; outL = oL; outR = oR;
    },
  };
}

/**
 * How many frames song `song` plays on music player `player` before it ends, counted as a task watching the
 * player's status from the frame after it starts sees it, such as one that waits for a jingle to end.
 */
export function songFrames(rom, layout, player, song, limit = 60 * 60) {
  const engine = createM4A(rom, layout, createApu()), P = engine.players[player];
  engine.playerStart(player, song);
  for (let n = 1; n < limit; n++) {
    engine.frame();
    if ((P.status & PAUSE) || (P.status & 0xFFFF) === 0) return n;
  }
  return limit;
}
