// What the proof tools know of each console, on top of what the kits know (kit/consoles.js): what runs the original.
// The Game Boy Advance runs in mGBA (tools/gba/). Every other console runs in a libretro core, a small emulator with one
// way of being driven, through tools/libretro/host.c, built from its makers' source at a fixed commit, so every
// contributor gets the same pictures (docs/CONSOLES.md). `pad` says which of libretro's buttons each console's button is.

import { CONSOLES } from '../kit/consoles.js';

// libretro's buttons, by the bit tools/libretro/host.c gives each, and the sticks' directions after them
const RETRO = { B: 0, Y: 1, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7, A: 8, X: 9, L: 10, R: 11, L2: 12, R2: 13, L3: 14, R3: 15, STICK_LEFT: 16, STICK_RIGHT: 17, STICK_UP: 18, STICK_DOWN: 19, RSTICK_LEFT: 20, RSTICK_RIGHT: 21, RSTICK_UP: 22, RSTICK_DOWN: 23 };
const SAME = names => Object.fromEntries(names.map(name => [name, name]));
const BASICS = SAME(['UP', 'DOWN', 'LEFT', 'RIGHT', 'SELECT', 'START']);
const STICK = SAME(['STICK_LEFT', 'STICK_RIGHT', 'STICK_UP', 'STICK_DOWN']);
const SONY = { ...BASICS, ...STICK, CROSS: 'B', CIRCLE: 'A', SQUARE: 'Y', TRIANGLE: 'X', L1: 'L', R1: 'R', L2: 'L2', R2: 'R2', L3: 'L3', R3: 'R3' };

const libretro = name => `https://github.com/libretro/${name}.git`;
// `source` at `commit`, `make` being what builds it in its `folder`, leaving `built`, or `cmake` the settings CMake builds
// its `target` with, into `folder`, with `cmakeOn` the settings for one kind of computer, as `makeOn` is for `make`. `graphics` says it draws with
// OpenGL, in the context host.c gives it, on Linux and macOS so far. `patch` is a change of the project's own the tools
// make to its source before building it. `ran` says it tells the tools of every instruction it runs, as FCEUmm and Snes9x
// do with the tools' changes to them (libretro/fceumm.patch, libretro/snes9x.patch, libretro/ran.h), or 'sm83' that it tells them of each instruction of the Game Boy's processor, which has no registers in common with
// those two, as Gambatte does with the tools' change (libretro/gambatte.patch), or 'blocks' that it tells them of each block of
// instructions it runs, as Play! does with the tools' (libretro/play.patch, libretro/ran-ps2.h), or 'functions' that it
// says itself which of the code map's functions ran in a frame, as melonDS does with the tools' front (nds/melonds/). `holds` says it tells
// them where it keeps the console's memory and its memory cards, as Play! does with the same change (libretro/held.h). `options` are the settings that keep it the same for everyone.
// `make` may set how its own C is built: Parallel N64's makers build it with -Ofast, which lets the compiler drop a sum's
// rounding and a check for a number that isn't one, so the tools build it as IEEE 754 asks, as the console's own
// floating-point unit works (../n64/original.mjs).
// `gameChoosesRate` says its games choose their own sound's rate, so the tools hear it at the kit's. `needs` says why a
// console can't run yet, in the words the tools say it (docs/CONSOLES.md)
// The Nintendo DS's is melonDS, its makers' own source with a front of the tools' own built into it (nds/melonds/), as
// melonDS's libretro cores are other people's ports of older versions of it.
const CORES = {
  nes: { source: libretro('libretro-fceumm'), commit: 'e0f3086a8104f8fbbe49a2615b10401504a9533f', make: ['-f', 'Makefile.libretro'], makeOn: { win32: ['platform=win'] }, built: 'fceumm_libretro', patch: 'tools/libretro/fceumm.patch', ran: true, options: { fceumm_overscan_h_left: '0', fceumm_overscan_h_right: '0', fceumm_overscan_v_top: '0', fceumm_overscan_v_bottom: '0', fceumm_hdpacks: 'disabled', fceumm_sndrate_hint: '48KHz' }, pad: { ...BASICS, A: 'A', B: 'B' } },
  snes: { source: libretro('snes9x'), commit: 'fae2fea08f74180759ef540ee94259213f503480', folder: 'libretro', built: 'snes9x_libretro', patch: 'tools/libretro/snes9x.patch', ran: true, pad: { ...BASICS, ...SAME(['A', 'B', 'X', 'Y', 'L', 'R']) } },
  gb: { source: libretro('gambatte-libretro'), commit: '77f2567d718b8973d02caa2daa8dce4953faf811', built: 'gambatte_libretro', makeOn: { win32: ['platform=win'] }, patch: 'tools/libretro/gambatte.patch', ran: 'sm83', options: { gambatte_gb_colorization: 'disabled', gambatte_gb_internal_palette: 'GB - DMG', gambatte_gb_bootloader: 'disabled', gambatte_gbc_color_correction: 'disabled', gambatte_up_down_allowed: 'enabled' }, pad: { ...BASICS, A: 'A', B: 'B' } },
  md: { source: libretro('Genesis-Plus-GX'), commit: 'f27655b592ef43f317272d79883bcaa10d3ac8ad', make: ['-f', 'Makefile.libretro'], built: 'genesis_plus_gx_libretro', pad: { UP: 'UP', DOWN: 'DOWN', LEFT: 'LEFT', RIGHT: 'RIGHT', START: 'START', A: 'Y', B: 'B', C: 'A', X: 'L', Y: 'X', Z: 'R', MODE: 'SELECT' } },
  ps1: { source: libretro('pcsx_rearmed'), commit: '7b0e8f8fadfbce3d170d195b9d9eecaabfa08c8e', make: ['-f', 'Makefile.libretro'], makeOn: { win32: ['platform=win'] }, built: 'pcsx_rearmed_libretro', submodules: true, patch: 'tools/libretro/pcsx.patch', options: { pcsx_rearmed_drc: 'disabled', pcsx_rearmed_gpu_thread_rendering: 'disabled', pcsx_rearmed_bios: 'HLE', pcsx_rearmed_dithering: 'enabled', pcsx_rearmed_spu_interpolation: 'gaussian', pcsx_rearmed_spu_reverb: 'enabled', pcsx_rearmed_spu_thread: 'disabled', pcsx_rearmed_fractional_framerate: 'enabled', pcsx_rearmed_cd_turbo: 'disabled', pcsx_rearmed_show_bios_bootlogo: 'disabled', pcsx_rearmed_region: 'auto', pcsx_rearmed_noxadecoding: 'enabled', pcsx_rearmed_nocdaudio: 'enabled' }, pad: SONY },
  // its libretro.c includes OpenGL's headers whatever it's built with, though nothing of them is linked
  n64: { source: libretro('parallel-n64'), commit: '2d90e20fa140b104d810bc0ea289f6f382e5086a', make: ['HAVE_PARALLEL=0', 'HAVE_THR_AL=1', 'HAVE_OPENGL=0', 'WITH_DYNAREC=', 'CPUOPTS=-O2 -DNDEBUG -ffp-contract=off -fno-fast-math'], built: 'parallel_n64_libretro', headers: { linux: [{ header: '/usr/include/GL/gl.h', install: 'sudo apt install libgl-dev' }] }, gameChoosesRate: true, options: { 'parallel-n64-gfxplugin': 'angrylion', 'parallel-n64-rspplugin': 'cxd4', 'parallel-n64-cpucore': 'cached_interpreter', 'parallel-n64-angrylion-multithread': 'off', 'parallel-n64-alt-map': 'disabled' }, pad: { UP: 'UP', DOWN: 'DOWN', LEFT: 'LEFT', RIGHT: 'RIGHT', START: 'START', ...STICK, A: 'B', B: 'Y', Z: 'L2', L: 'L', R: 'R', C_UP: 'RSTICK_UP', C_DOWN: 'RSTICK_DOWN', C_LEFT: 'RSTICK_LEFT', C_RIGHT: 'RSTICK_RIGHT' } },
  ps2: { source: 'https://github.com/jpd002/Play-.git', commit: '1f27232772e484bfb79364b751b84f41f4c87481', submodules: true, cmake: ['-DBUILD_LIBRETRO_CORE=ON', '-DBUILD_PLAY=OFF', '-DBUILD_TESTS=OFF'], cmakeOn: { linux: ['-DUSE_GLES=ON'] }, target: 'play_libretro', folder: 'build/Source/ui_libretro', built: 'play_libretro', patch: 'tools/libretro/play.patch', copies: { 'kit/ps2/c/spu2.c': 'Source/iop/dreamports/spu2.c' }, ran: 'blocks', holds: true, graphics: true, options: { play_res_multi: '1x', play_presentation_mode: 'Fit Screen', play_bilinear_filtering: 'false' }, pad: SONY },
  nds: { source: 'https://github.com/melonDS-emu/melonDS.git', commit: 'ff972523f8a70e877dd054439876c3c8c6b79197', cmake: ['-DBUILD_QT_SDL=OFF', '-DENABLE_JIT=OFF', '-DENABLE_OGLRENDERER=OFF', '-DENABLE_GDBSTUB=OFF', '-DENABLE_LTO_RELEASE=OFF'], target: 'melonds_dreamports_libretro', folder: 'build', built: 'melonds_dreamports_libretro', patch: 'tools/libretro/melonds.patch', ran: 'functions', copies: { 'tools/nds/melonds/libretro.cpp': 'dreamports/libretro.cpp', 'tools/nds/melonds/CMakeLists.txt': 'dreamports/CMakeLists.txt' }, pad: { ...BASICS, ...SAME(['A', 'B', 'X', 'Y', 'L', 'R']) } },
  psp: { needs: 'no emulator has been chosen for it yet', pad: { UP: 'UP', DOWN: 'DOWN', LEFT: 'LEFT', RIGHT: 'RIGHT', SELECT: 'SELECT', START: 'START', ...STICK, CROSS: 'B', CIRCLE: 'A', SQUARE: 'Y', TRIANGLE: 'X', L: 'L', R: 'R' } },
  'made-up': { local: 'tools/test/made-up-core.c', built: 'made_up_core', commit: 'local', gameChoosesRate: true, pad: { UP: 'UP', DOWN: 'DOWN', LEFT: 'LEFT', RIGHT: 'RIGHT', START: 'START', A: 'A', B: 'B' } },
};
CORES.gbc = CORES.gb;

// A touch as a recording keeps it beside the buttons, "TOUCH@x,y", the pixel of the console's touched screen
const TOUCH = /^TOUCH@(\d{1,3}),(\d{1,3})$/;

/** The bits host.c takes for a touch at a pixel of the touched screen: bit 15 for the touch, then across and down. */
export const touchBits = (x, y) => ((1 << 15) | (x << 16) | (y << 24)) >>> 0;

// The bit of each button, which on a console with a touched screen also gives a touch's bits by its name, so whatever
// turns a recording's buttons into what the emulator is given takes a touch as one more button
function keysWithTouch(keys, [, , width, height]) {
  return new Proxy(keys, {
    has(target, name) { return this.get(target, name) !== undefined; },
    get(target, name) {
      const touch = typeof name === 'string' ? TOUCH.exec(name) : null;
      if (!touch) return target[name];
      const x = Number(touch[1]), y = Number(touch[2]);
      return x < width && y < height ? touchBits(x, y) : undefined;
    },
  });
}

/** A console by its id: its fields from kit/consoles.js, with `core`, what runs it, or null for mGBA, and `keys`, the bit of each of its buttons, or null for mGBA. */
export function consoleOf(id) {
  const machine = CONSOLES[id];
  if (!machine) throw new Error(`The tools don't know a console called ${id}: they know ${Object.keys(CONSOLES).join(', ')} (kit/consoles.js).`);
  const core = CORES[id] ?? null;
  const keys = core ? Object.fromEntries(Object.entries(core.pad).map(([name, retro]) => [name, 2 ** RETRO[retro]])) : null;
  return { id, ...machine, core, keys: keys && machine.touch !== undefined ? keysWithTouch(keys, machine.screens[machine.touch]) : keys };
}

export { CONSOLES };
