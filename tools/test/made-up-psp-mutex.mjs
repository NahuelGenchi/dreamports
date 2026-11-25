// A small PlayStation Portable program with nothing from any game in it, written here, that starts as the console's SDK
// has a game start and whose two threads lock a mutex and a lightweight mutex against each other, for the tools' check
// of the kit's (psp-mutex.mjs). Its first thread starts a thread of the best priority that makes a callback, registers
// it as the exit callback and sleeps waiting for callbacks, which never come. Then it makes a mutex, and a lightweight
// one that its thread may lock again, in a work area of its own memory, and a second thread with a better priority than
// its own. The second, over and over, locks the mutex with a timeout of 3,000 microseconds and lets it go, tries the
// lightweight one and lets it go, and waits 10,000 microseconds. Each frame the first locks the mutex, and the
// lightweight one twice, waits 4,000 microseconds every fourth frame while it holds them, so the second's lock runs
// out, and lets go of both. Then it draws bars as wide as what the system answered, through the graphics chip: the time
// as the frame starts, what its lock and its second lightweight lock gave back, the time after it let go, and what the
// second's last lock gave back, what was left of its timeout, and what its try gave back. So the picture shows when
// each thread had each mutex, to the microsecond.

import { pspProgram, here, li, la, call, addiu, andi, or, sh, sw, lw, bne, j, NOP, RA, ZERO, V0, A0, A1, A2, A3, T0, T1, T2, S0, S1, S2, jr } from './made-up-psp.mjs';
import { barsList, barEdge, BARS } from './made-up-psp-sync.mjs';
import { WIDTH, HEIGHT, LINE } from './made-up-psp-ge.mjs';

export { WIDTH, HEIGHT, LINE, BARS, barsList, barEdge };
/** The second thread's timeout for the mutex and its wait, the first's wait while it holds them, all in microseconds. */
export const LOCK_TIMEOUT = 3000, WORKER_DELAY = 10000, HOLD = 4000;
/** The threads' priorities and stacks: the callbacks' thread, as the SDK's samples make it, and the second. */
export const CALLBACKS_PRIORITY = 0x11, CALLBACKS_STACK = 0xFA0, WORKER_PRIORITY = 0x18, WORKER_STACK = 0x4000;
/** The lightweight mutex: one its thread may lock again. */
export const LW_ATTR = 0x200;

// a bar as wide as T1's low eight bits and one more, at the list's `index`th, through T2
const shBar = index => [andi(T1, T1, 0xFF), addiu(T1, T1, 1), ...la(T2, 'bars list'), sh(T1, barEdge(index), T2)];

// the program in stretches, each the instructions between two of the system's functions, whose cycles its Dreamport says
// after doing the same (psp-mutex/main.c)
const STRETCHES = {
  mode: [addiu(A0, ZERO, 0), addiu(A1, ZERO, WIDTH), addiu(A2, ZERO, HEIGHT), ...call('sceDisplaySetMode')],
  framebuffer: [...li(A0, 0x44000000), addiu(A1, ZERO, LINE), addiu(A2, ZERO, 3), addiu(A3, ZERO, 1), ...call('sceDisplaySetFrameBuf')],
  // the SDK's start: a thread for the callbacks
  callbacksThread: [...la(A0, 'callbacks name'), ...la(A1, 'callbacks'), addiu(A2, ZERO, CALLBACKS_PRIORITY), addiu(A3, ZERO, CALLBACKS_STACK), addiu(T0, ZERO, 0), addiu(T1, ZERO, 0), ...call('sceKernelCreateThread')],
  callbacksStart: [or(A0, V0, ZERO), addiu(A1, ZERO, 0), addiu(A2, ZERO, 0), ...call('sceKernelStartThread')],
  mutex: [...la(A0, 'mutex name'), addiu(A1, ZERO, 0), addiu(A2, ZERO, 0), addiu(A3, ZERO, 0), ...call('sceKernelCreateMutex')],
  lightweight: [or(S2, V0, ZERO), ...la(T0, 'ids'), sw(V0, 0, T0), ...la(A0, 'lw area'), ...la(A1, 'lw name'), addiu(A2, ZERO, LW_ATTR), addiu(A3, ZERO, 0), addiu(T0, ZERO, 0), ...call('sceKernelCreateLwMutex')],
  create: [...la(A0, 'worker name'), ...la(A1, 'worker'), addiu(A2, ZERO, WORKER_PRIORITY), ...li(A3, WORKER_STACK), addiu(T0, ZERO, 0), addiu(T1, ZERO, 0), ...call('sceKernelCreateThread')],
  start: [or(A0, V0, ZERO), addiu(A1, ZERO, 0), addiu(A2, ZERO, 0), ...call('sceKernelStartThread')],
  wait: [...call('sceDisplayWaitVblankStart')],
  time: [...call('sceKernelGetSystemTimeLow')],
  // the first bar, the frame's number, and the mutex locked
  lock: [or(T1, V0, ZERO), ...shBar(0), ...la(T0, 'frame number'), sw(S0, 0, T0), or(A0, S2, ZERO), addiu(A1, ZERO, 1), addiu(A2, ZERO, 0), ...call('sceKernelLockMutex')],
  // what that gave back, and the lightweight mutex locked twice
  lightLock: [or(T1, V0, ZERO), ...shBar(1), ...la(A0, 'lw area'), addiu(A1, ZERO, 1), addiu(A2, ZERO, 0), ...call('sceKernelLockLwMutex')],
  lightAgain: [...la(A0, 'lw area'), addiu(A1, ZERO, 1), addiu(A2, ZERO, 0), ...call('sceKernelLockLwMutex')],
  // what the second gave back, and every fourth frame a wait while it holds both
  held: [or(T1, V0, ZERO), ...shBar(2), andi(T1, S0, 3), addiu(T2, ZERO, 3), bne(T1, T2, 'let go'), NOP],
  hold: [...li(A0, HOLD), ...call('sceKernelDelayThread')],
  lightUnlock: [...la(A0, 'lw area'), addiu(A1, ZERO, 2), ...call('sceKernelUnlockLwMutex')],
  unlock: [or(A0, S2, ZERO), addiu(A1, ZERO, 1), ...call('sceKernelUnlockMutex')],
  after: [...call('sceKernelGetSystemTimeLow')],
  // the time, the second's results, and the bars
  bars: [or(T1, V0, ZERO), ...shBar(3), ...la(T0, 'results'), lw(T1, 0, T0), ...shBar(4), ...la(T0, 'timeouts'), lw(T1, 0, T0), ...shBar(5), ...la(T0, 'results'), lw(T1, 4, T0), ...shBar(6),
    ...la(A0, 'bars list'), addiu(A1, ZERO, 0), addiu(A2, ZERO, -1), addiu(A3, ZERO, 0), ...call('sceGeListEnQueue')],
  draw: [addiu(A0, ZERO, 0), ...call('sceGeDrawSync')],
  // the callbacks' thread: its callback, registered as the exit callback, and its sleep
  callback: [...la(A0, 'callback name'), ...la(A1, 'exit callback'), addiu(A2, ZERO, 0), ...call('sceKernelCreateCallback')],
  register: [or(A0, V0, ZERO), ...call('sceKernelRegisterExitCallback')],
  sleep: [...call('sceKernelSleepThreadCB')],
  // the second thread: the mutex locked with its timeout
  workerLock: [...la(T0, 'timeouts'), ...li(T1, LOCK_TIMEOUT), sw(T1, 0, T0), ...la(T0, 'ids'), lw(A0, 0, T0), addiu(A1, ZERO, 1), ...la(A2, 'timeouts'), ...call('sceKernelLockMutex')],
  // what that gave back, and the mutex let go if it was had
  workerLocked: [...la(T0, 'results'), sw(V0, 0, T0), or(S1, V0, ZERO), bne(S1, ZERO, 'try'), NOP],
  workerUnlock: [...la(T0, 'ids'), lw(A0, 0, T0), addiu(A1, ZERO, 1), ...call('sceKernelUnlockMutex')],
  workerTry: [...la(A0, 'lw area'), addiu(A1, ZERO, 1), ...call('sceKernelTryLockLwMutex')],
  // what the try gave back, and the lightweight mutex let go if it was had
  workerTried: [...la(T0, 'results'), sw(V0, 4, T0), bne(V0, ZERO, 'rest'), NOP],
  workerLightUnlock: [...la(A0, 'lw area'), addiu(A1, ZERO, 1), ...call('sceKernelUnlockLwMutex')],
  workerDelay: [...li(A0, WORKER_DELAY), ...call('sceKernelDelayThread')],
};
const count = items => items.filter(item => !item.here).length;
/** The cycles each stretch of the program's own instructions takes. */
export const CYCLES = {
  ...Object.fromEntries(Object.entries(STRETCHES).map(([name, items]) => [name.replace(/[A-Z]/g, c => `_${c}`).toUpperCase(), count(items)])),
  LOOP: 1, NEXT: 3, WORKER_NEXT: 2,
};

/** The program: { elf, at }. */
export function madeUpPspMutex() {
  const code = [
    ...STRETCHES.mode, ...STRETCHES.framebuffer, ...STRETCHES.callbacksThread, ...STRETCHES.callbacksStart,
    ...STRETCHES.mutex, ...STRETCHES.lightweight, ...STRETCHES.create, ...STRETCHES.start,
    addiu(S0, ZERO, 0),
    here('frame'),
    ...STRETCHES.wait, ...STRETCHES.time, ...STRETCHES.lock, ...STRETCHES.lightLock, ...STRETCHES.lightAgain, ...STRETCHES.held, ...STRETCHES.hold,
    here('let go'),
    ...STRETCHES.lightUnlock, ...STRETCHES.unlock, ...STRETCHES.after, ...STRETCHES.bars, ...STRETCHES.draw,
    addiu(S0, S0, 1), j('frame'), NOP,
    here('callbacks'),
    ...STRETCHES.callback, ...STRETCHES.register,
    here('sleeping'),
    ...STRETCHES.sleep,
    j('sleeping'), NOP,
    // the exit callback, which only a player quitting the game would run
    here('exit callback'), jr(RA), addiu(V0, ZERO, 0),
    here('worker'),
    ...STRETCHES.workerLock, ...STRETCHES.workerLocked, ...STRETCHES.workerUnlock,
    here('try'),
    ...STRETCHES.workerTry, ...STRETCHES.workerTried, ...STRETCHES.workerLightUnlock,
    here('rest'),
    ...STRETCHES.workerDelay,
    j('worker'), NOP,
  ];
  return pspProgram({
    code,
    data: {
      'bars list': barsList().words, 'callbacks name': 'update_thread\0', 'callback name': 'Exit Callback\0', 'mutex name': 'mutex\0', 'lw name': 'lwmutex\0', 'worker name': 'worker\0',
      ids: new Uint32Array(1), 'frame number': new Uint32Array(1), timeouts: new Uint32Array(1), results: new Uint32Array(2), 'lw area': new Uint32Array(8),
    },
    imports: ['sceDisplaySetMode', 'sceDisplaySetFrameBuf', 'sceDisplayWaitVblankStart', 'sceKernelGetSystemTimeLow', 'sceKernelCreateThread', 'sceKernelStartThread', 'sceKernelDelayThread',
      'sceKernelCreateCallback', 'sceKernelRegisterExitCallback', 'sceKernelSleepThreadCB', 'sceKernelCreateMutex', 'sceKernelLockMutex', 'sceKernelUnlockMutex', 'sceKernelCreateLwMutex',
      'sceKernelLockLwMutex', 'sceKernelTryLockLwMutex', 'sceKernelUnlockLwMutex', 'sceGeListEnQueue', 'sceGeDrawSync'],
  });
}
