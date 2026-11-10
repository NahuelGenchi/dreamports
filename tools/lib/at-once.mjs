// How many recordings `prove` plays at the same time. Each one keeps a page of the browser busy and, while its
// original runs, the reference emulator, and holds memory for both. So the answer comes from what this computer has
// free as prove starts, never from a number someone set: another prove running here at the same time, as a second
// person's or agent's would, leaves less room, and each gets fewer. Nothing is shared between them, so none waits
// for another.

import { readFileSync } from 'node:fs';
import os from 'node:os';

/** The most at once. Past it the longest recording sets the time, and more pages only take memory: Sonic Advance in
 *  C's 72 recordings took 110 seconds with 8 and 91 with 12, on a computer with 28 threads. */
export const MOST = 8;
// what one recording being played takes, as measured on that game, the largest there is: a core and a half, between
// its page, its thread of the tool and its original, and 360 MB of memory, with some to spare
const CORES_EACH = 1.5, BYTES_EACH = 500e6;
// left alone for whatever else is running
const BYTES_KEPT = 1e9;

/**
 * How many to play at once, of `wanted` recordings, on a computer with `cores`, of which `load` are busy, and `free`
 * bytes of memory. `asked`, from --at-once, is taken as it is. Always at least one.
 */
export function roomFor({ cores, load, free, wanted, asked }) {
  if (asked !== undefined) {
    if (!/^[1-9]\d*$/.test(String(asked))) throw new Error('--at-once takes how many recordings to play at the same time, such as 4.');
    return Math.max(1, Math.min(Number(asked), wanted));
  }
  const byCores = Math.floor(Math.max(0, cores - load) / CORES_EACH);
  const byMemory = Math.floor((free - BYTES_KEPT) / BYTES_EACH);
  return Math.max(1, Math.min(MOST, wanted, byCores, byMemory));
}

// the memory programs can still have: on Linux what the kernel says is available, which counts what it would give
// back from its own caches, and elsewhere what's free
function freeMemory() {
  try {
    const kilobytes = /^MemAvailable:\s+(\d+) kB$/m.exec(readFileSync('/proc/meminfo', 'utf8'))?.[1];
    if (kilobytes) return Number(kilobytes) * 1024;
  } catch {
    // not Linux
  }
  return os.freemem();
}

/** How many of `wanted` recordings to play at once on this computer, as it is now. */
export const atOnce = ({ wanted, asked }) => roomFor({ cores: os.availableParallelism(), load: os.loadavg()[0], free: freeMemory(), wanted, asked });
