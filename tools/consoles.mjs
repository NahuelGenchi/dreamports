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
// its `target` with, into `folder`. `graphics` says it draws with OpenGL, in the context host.c gives it, on Linux alone so
// far. `patch` is a change of the project's own the tools make to its source before building it. `options` are the
// settings that keep it the same for everyone. `gameChoosesRate` says its games choose their own sound's rate, so the
// tools hear it at the kit's. `needs` says why a console can't run yet, in the words the tools say it (docs/CONSOLES.md)
const CORES = {
  nes: { source: libretro('libretro-fceumm'), commit: 'e0f3086a8104f8fbbe49a2615b10401504a9533f', make: ['-f', 'Makefile.libretro'], built: 'fceumm_libretro', options: { fceumm_overscan_h_left: '0', fceumm_overscan_h_right: '0', fceumm_overscan_v_top: '0', fceumm_overscan_v_bottom: '0', fceumm_hdpacks: 'disabled', fceumm_sndrate_hint: '48KHz' }, pad: { ...BASICS, A: 'A', B: 'B' } },
  snes: { source: libretro('snes9x'), commit: 'fae2fea08f74180759ef540ee94259213f503480', folder: 'libretro', built: 'snes9x_libretro', pad: { ...BASICS, ...SAME(['A', 'B', 'X', 'Y', 'L', 'R']) } },
  gb: { source: libretro('gambatte-libretro'), commit: '77f2567d718b8973d02caa2daa8dce4953faf811', built: 'gambatte_libretro', options: { gambatte_gb_colorization: 'disabled', gambatte_gb_internal_palette: 'GB - DMG', gambatte_gb_bootloader: 'disabled' }, pad: { ...BASICS, A: 'A', B: 'B' } },
  md: { source: libretro('Genesis-Plus-GX'), commit: 'f27655b592ef43f317272d79883bcaa10d3ac8ad', make: ['-f', 'Makefile.libretro'], built: 'genesis_plus_gx_libretro', pad: { UP: 'UP', DOWN: 'DOWN', LEFT: 'LEFT', RIGHT: 'RIGHT', START: 'START', A: 'Y', B: 'B', C: 'A', X: 'L', Y: 'X', Z: 'R', MODE: 'SELECT' } },
  ps1: { source: libretro('pcsx_rearmed'), commit: '7b0e8f8fadfbce3d170d195b9d9eecaabfa08c8e', make: ['-f', 'Makefile.libretro'], built: 'pcsx_rearmed_libretro', submodules: true, options: { pcsx_rearmed_drc: 'disabled', pcsx_rearmed_gpu_thread_rendering: 'disabled', pcsx_rearmed_bios: 'HLE' }, pad: SONY },
  n64: { source: libretro('parallel-n64'), commit: '2d90e20fa140b104d810bc0ea289f6f382e5086a', make: ['HAVE_PARALLEL=0', 'HAVE_THR_AL=1', 'HAVE_OPENGL=0', 'WITH_DYNAREC='], built: 'parallel_n64_libretro', gameChoosesRate: true, options: { 'parallel-n64-gfxplugin': 'angrylion', 'parallel-n64-rspplugin': 'cxd4', 'parallel-n64-cpucore': 'cached_interpreter', 'parallel-n64-angrylion-multithread': 'off', 'parallel-n64-alt-map': 'disabled' }, pad: { UP: 'UP', DOWN: 'DOWN', LEFT: 'LEFT', RIGHT: 'RIGHT', START: 'START', ...STICK, A: 'B', B: 'Y', Z: 'L2', L: 'L', R: 'R', C_UP: 'RSTICK_UP', C_DOWN: 'RSTICK_DOWN', C_LEFT: 'RSTICK_LEFT', C_RIGHT: 'RSTICK_RIGHT' } },
  ps2: { source: 'https://github.com/jpd002/Play-.git', commit: '1f27232772e484bfb79364b751b84f41f4c87481', submodules: true, cmake: ['-DBUILD_LIBRETRO_CORE=ON', '-DBUILD_PLAY=OFF', '-DBUILD_TESTS=OFF', '-DUSE_GLES=ON'], target: 'play_libretro', folder: 'build/Source/ui_libretro', built: 'play_libretro', patch: 'tools/libretro/play.patch', graphics: true, options: { play_res_multi: '1x', play_presentation_mode: 'Fit Screen', play_bilinear_filtering: 'false' }, pad: SONY },
  psp: { needs: 'no emulator has been chosen for it yet', pad: { UP: 'UP', DOWN: 'DOWN', LEFT: 'LEFT', RIGHT: 'RIGHT', SELECT: 'SELECT', START: 'START', ...STICK, CROSS: 'B', CIRCLE: 'A', SQUARE: 'Y', TRIANGLE: 'X', L: 'L', R: 'R' } },
  'made-up': { local: 'tools/test/made-up-core.c', built: 'made_up_core', commit: 'local', gameChoosesRate: true, pad: { UP: 'UP', DOWN: 'DOWN', LEFT: 'LEFT', RIGHT: 'RIGHT', START: 'START', A: 'A', B: 'B' } },
};
CORES.gbc = CORES.gb;

/** A console by its id: its fields from kit/consoles.js, with `core`, what runs it, or null for mGBA, and `keys`, the bit of each of its buttons, or null for mGBA. */
export function consoleOf(id) {
  const machine = CONSOLES[id];
  if (!machine) throw new Error(`The tools don't know a console called ${id}: they know ${Object.keys(CONSOLES).join(', ')} (kit/consoles.js).`);
  const core = CORES[id] ?? null;
  return { id, ...machine, core, keys: core ? Object.fromEntries(Object.entries(core.pad).map(([name, retro]) => [name, 2 ** RETRO[retro]])) : null };
}

export { CONSOLES };
