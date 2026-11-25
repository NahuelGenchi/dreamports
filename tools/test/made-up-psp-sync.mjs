// A small PlayStation Portable program with nothing from any game in it, written here, whose two threads wait for each
// other on the system's semaphore and event flag, for the tools' check of the kit's (psp-sync.mjs). Its first thread
// makes a semaphore and an event flag, and a second thread with a better priority, which waits for the semaphore with a
// timeout of 20,000 microseconds, a little more than a frame. Each frame the first signals the semaphore, but every
// eighth frame, so the second's wait runs out then; the second, woken, sets the event flag, but every fourth frame; and
// the first waits for the flag with a timeout of 3,000 microseconds, which runs out when it isn't set. Then the first
// draws bars as wide as what the system answered, through the graphics chip: the time as the frame starts, what the
// first's wait gave back and what was left of its timeout, the time after it, what the second's last wait gave back
// and what was left of its timeout, and the pattern the first's wait found. So the picture shows when each thread was
// woken, to the microsecond.

import { pspProgram, here, li, la, call, addiu, andi, or, sh, sw, lw, beq, j, NOP, ZERO, V0, A0, A1, A2, A3, T0, T1, T2, S0, S1, S2, S3 } from './made-up-psp.mjs';
import { list, vertex, VTYPE, BACKGROUND, BAR, BAR_HEIGHT, WIDTH, HEIGHT, LINE } from './made-up-psp-ge.mjs';

export { WIDTH, HEIGHT, LINE, BACKGROUND, BAR };
/** The bars: how many, the line of the first, and how far apart. */
export const BARS = 7, FIRST_BAR = 8, BAR_STEP = 8;
/** The timeouts, in microseconds: the second thread's for the semaphore and the first's for the flag. */
export const SEMA_TIMEOUT = 20000, FLAG_TIMEOUT = 3000;
/** The second thread's priority, better than the first's 32, and how its stack's size. */
export const WORKER_PRIORITY = 0x18, WORKER_STACK = 0x4000;
/** The event flag's wait: any of its bits, cleared once they match. */
export const HOW = 0x01 | 0x20;

/** The list of bars, with the screen cleared first. */
export function barsList() {
  return list([
    [0x14, 0], [0x10, 0], [0x9C, 0], [0x9D, LINE], [0xD2, 3],
    [0xD4, 0], [0xD5, (WIDTH - 1) | (HEIGHT - 1) << 10], [0x16, (WIDTH - 1) | (HEIGHT - 1) << 10],
    [0x12, VTYPE],
    [0xD3, 1 | 0x100 | 0x200], [0x01, { at: 'clear' }], [0x04, 6 << 16 | 2], [0xD3, 0],
    [0x01, { at: 'bars' }], [0x04, 6 << 16 | BARS * 2],
    [0x0F, 0], [0x0C, 0],
  ], [
    ['clear', Buffer.concat([vertex(BACKGROUND, 0, 0), vertex(BACKGROUND, WIDTH, HEIGHT)])],
    ['bars', Buffer.concat(Array.from({ length: BARS }, (_, i) => [vertex(BAR, 0, FIRST_BAR + i * BAR_STEP), vertex(BAR, 1, FIRST_BAR + i * BAR_STEP + BAR_HEIGHT)]).flat())],
  ]);
}
/** Where, in the list, each bar's right edge is. */
export const barEdge = index => barsList().at.bars + (index * 2 + 1) * 12 + 4;

// a bar as wide as T1's low eight bits and one more, at the list's `index`th, through T2
const bar = index => [andi(T1, T1, 0xFF), addiu(T1, T1, 1), ...la(T2, 'bars list'), sh(T1, barEdge(index), T2)];

// the program in stretches, each the instructions between two of the system's functions, whose cycles its Dreamport says
// after doing the same (psp-sync/main.c)
const STRETCHES = {
  mode: [addiu(A0, ZERO, 0), addiu(A1, ZERO, WIDTH), addiu(A2, ZERO, HEIGHT), ...call('sceDisplaySetMode')],
  framebuffer: [...li(A0, 0x44000000), addiu(A1, ZERO, LINE), addiu(A2, ZERO, 3), addiu(A3, ZERO, 1), ...call('sceDisplaySetFrameBuf')],
  sema: [...la(A0, 'sema name'), addiu(A1, ZERO, 0), addiu(A2, ZERO, 0), addiu(A3, ZERO, 4), addiu(T0, ZERO, 0), ...call('sceKernelCreateSema')],
  flag: [or(S2, V0, ZERO), ...la(T0, 'ids'), sw(V0, 0, T0), ...la(A0, 'flag name'), addiu(A1, ZERO, 0), addiu(A2, ZERO, 0), addiu(A3, ZERO, 0), ...call('sceKernelCreateEventFlag')],
  create: [or(S3, V0, ZERO), ...la(T0, 'ids'), sw(V0, 4, T0), ...la(A0, 'worker name'), ...la(A1, 'worker'), addiu(A2, ZERO, WORKER_PRIORITY), ...li(A3, WORKER_STACK), addiu(T0, ZERO, 0), addiu(T1, ZERO, 0), ...call('sceKernelCreateThread')],
  start: [or(A0, V0, ZERO), addiu(A1, ZERO, 0), addiu(A2, ZERO, 0), ...call('sceKernelStartThread')],
  wait: [...call('sceDisplayWaitVblankStart')],
  time: [...call('sceKernelGetSystemTimeLow')],
  // the first bar, the frame's number where the second thread reads it, and the semaphore signalled but every eighth frame
  first: [or(T1, V0, ZERO), ...bar(0), ...la(T0, 'frame number'), sw(S0, 0, T0), andi(T1, S0, 7), addiu(T2, ZERO, 7), beq(T1, T2, 'unsignalled'), NOP],
  signal: [or(A0, S2, ZERO), addiu(A1, ZERO, 1), ...call('sceKernelSignalSema')],
  // the first's wait for the flag, with its timeout
  flagWait: [...la(T0, 'timeouts'), ...li(T1, FLAG_TIMEOUT), sw(T1, 0, T0), or(A0, S3, ZERO), addiu(A1, ZERO, 1), addiu(A2, ZERO, HOW), ...la(A3, 'out'), ...la(T0, 'timeouts'), ...call('sceKernelWaitEventFlag')],
  // what it gave back and what was left of its timeout, and the time
  waited: [or(S1, V0, ZERO), or(T1, V0, ZERO), ...bar(1), ...la(T0, 'timeouts'), lw(T1, 0, T0), ...bar(2), ...call('sceKernelGetSystemTimeLow')],
  // the time, what the second's last wait gave back and what was left of its timeout, and the pattern found, then the bars
  bars: [or(T1, V0, ZERO), ...bar(3), ...la(T0, 'worker result'), lw(T1, 0, T0), ...bar(4), ...la(T0, 'timeouts'), lw(T1, 4, T0), ...bar(5), ...la(T0, 'out'), lw(T1, 0, T0), ...bar(6),
    ...la(A0, 'bars list'), addiu(A1, ZERO, 0), addiu(A2, ZERO, -1), addiu(A3, ZERO, 0), ...call('sceGeListEnQueue')],
  draw: [addiu(A0, ZERO, 0), ...call('sceGeDrawSync')],
  // the second thread: its wait for the semaphore, with its timeout
  workerWait: [...la(T0, 'timeouts'), ...li(T1, SEMA_TIMEOUT), sw(T1, 4, T0), ...la(T0, 'ids'), lw(A0, 0, T0), addiu(A1, ZERO, 1), ...la(A2, 'timeouts'), addiu(A2, A2, 4), ...call('sceKernelWaitSema')],
  // what it gave back, and the flag set but every fourth frame
  workerWoken: [...la(T0, 'worker result'), sw(V0, 0, T0), ...la(T0, 'frame number'), lw(T1, 0, T0), andi(T1, T1, 3), addiu(T2, ZERO, 3), beq(T1, T2, 'worker'), NOP],
  workerSet: [...la(T0, 'ids'), lw(A0, 4, T0), addiu(A1, ZERO, 1), ...call('sceKernelSetEventFlag')],
};
const count = items => items.filter(item => !item.here).length;
/** The cycles each stretch of the program's own instructions takes. */
export const CYCLES = {
  ...Object.fromEntries(Object.entries(STRETCHES).map(([name, items]) => [name.replace(/[A-Z]/g, c => `_${c}`).toUpperCase(), count(items)])),
  LOOP: 1, NEXT: 3, WORKER_NEXT: 2,
};

/** The program: { elf, at }. */
export function madeUpPspSync() {
  const code = [
    ...STRETCHES.mode, ...STRETCHES.framebuffer, ...STRETCHES.sema, ...STRETCHES.flag, ...STRETCHES.create, ...STRETCHES.start,
    addiu(S0, ZERO, 0),
    here('frame'),
    ...STRETCHES.wait, ...STRETCHES.time, ...STRETCHES.first, ...STRETCHES.signal,
    here('unsignalled'),
    ...STRETCHES.flagWait, ...STRETCHES.waited, ...STRETCHES.bars, ...STRETCHES.draw,
    // the next frame
    addiu(S0, S0, 1), j('frame'), NOP,
    here('worker'),
    ...STRETCHES.workerWait, ...STRETCHES.workerWoken, ...STRETCHES.workerSet,
    j('worker'), NOP,
  ];
  return pspProgram({
    code,
    data: {
      'bars list': barsList().words, 'sema name': 'sema\0', 'flag name': 'flag\0', 'worker name': 'worker\0',
      ids: new Uint32Array(2), 'frame number': new Uint32Array(1), timeouts: new Uint32Array(2), out: new Uint32Array(1), 'worker result': new Uint32Array(1),
    },
    imports: ['sceDisplaySetMode', 'sceDisplaySetFrameBuf', 'sceDisplayWaitVblankStart', 'sceKernelGetSystemTimeLow', 'sceKernelCreateSema', 'sceKernelSignalSema', 'sceKernelWaitSema',
      'sceKernelCreateEventFlag', 'sceKernelSetEventFlag', 'sceKernelWaitEventFlag', 'sceKernelCreateThread', 'sceKernelStartThread', 'sceGeListEnQueue', 'sceGeDrawSync'],
  });
}
