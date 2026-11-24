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
// its `target` with, into `folder`, with `cmakeOn` the settings for one kind of computer. `graphics` says it draws with
// OpenGL, in the context host.c gives it, on Linux and macOS so far. `patch` is a change of the project's own the tools
// make to its source before building it. `withoutSubmodules` are the libraries its source keeps as submodules that the
// tools leave out, and `data` its own files that it reads as it runs, each with where it looks for it, `folderOn` where one kind of computer's build leaves the emulator when that's
// elsewhere, and `leaves` that the tools' program ends the moment its work is written, without the emulator's own
// ending, which can fail (libretro/host.c). `ran` says it tells the tools of every instruction it runs, as FCEUmm and Snes9x
// do with the tools' changes to them (libretro/fceumm.patch, libretro/snes9x.patch, libretro/ran.h), or 'blocks' that it tells them of each block of
// instructions it runs, as Play! does with the tools' (libretro/play.patch, libretro/ran-ps2.h), or 'starts' that it tells them where
// the processor is before each instruction and nothing of the instruction, as Parallel N64 does with the tools'
// (libretro/parallel-n64.patch), which says which functions ran in each frame and no more. `holds` says it tells
// them where it keeps the console's memory and its memory cards, as Play! does with the same change (libretro/held.h). `options` are the settings that keep it the same for everyone.
// `make` may set how its own C is built: Parallel N64's makers build it with -Ofast, which lets the compiler drop a sum's
// rounding and a check for a number that isn't one, so the tools build it as IEEE 754 asks, as the console's own
// floating-point unit works (../n64/original.mjs).
// `gameChoosesRate` says its games choose their own sound's rate, so the tools hear it at the kit's. `needs` says why a
// console can't run yet, in the words the tools say it (docs/CONSOLES.md)
const CORES = {
  nes: { source: libretro('libretro-fceumm'), commit: 'e0f3086a8104f8fbbe49a2615b10401504a9533f', make: ['-f', 'Makefile.libretro'], built: 'fceumm_libretro', patch: 'tools/libretro/fceumm.patch', ran: true, options: { fceumm_overscan_h_left: '0', fceumm_overscan_h_right: '0', fceumm_overscan_v_top: '0', fceumm_overscan_v_bottom: '0', fceumm_hdpacks: 'disabled', fceumm_sndrate_hint: '48KHz' }, pad: { ...BASICS, A: 'A', B: 'B' } },
  snes: { source: libretro('snes9x'), commit: 'fae2fea08f74180759ef540ee94259213f503480', folder: 'libretro', built: 'snes9x_libretro', patch: 'tools/libretro/snes9x.patch', ran: true, pad: { ...BASICS, ...SAME(['A', 'B', 'X', 'Y', 'L', 'R']) } },
  gb: { source: libretro('gambatte-libretro'), commit: '77f2567d718b8973d02caa2daa8dce4953faf811', built: 'gambatte_libretro', options: { gambatte_gb_colorization: 'disabled', gambatte_gb_internal_palette: 'GB - DMG', gambatte_gb_bootloader: 'disabled' }, pad: { ...BASICS, A: 'A', B: 'B' } },
  md: { source: libretro('Genesis-Plus-GX'), commit: 'f27655b592ef43f317272d79883bcaa10d3ac8ad', make: ['-f', 'Makefile.libretro'], built: 'genesis_plus_gx_libretro', pad: { UP: 'UP', DOWN: 'DOWN', LEFT: 'LEFT', RIGHT: 'RIGHT', START: 'START', A: 'Y', B: 'B', C: 'A', X: 'L', Y: 'X', Z: 'R', MODE: 'SELECT' } },
  ps1: { source: libretro('pcsx_rearmed'), commit: '7b0e8f8fadfbce3d170d195b9d9eecaabfa08c8e', make: ['-f', 'Makefile.libretro'], built: 'pcsx_rearmed_libretro', submodules: true, patch: 'tools/libretro/pcsx.patch', options: { pcsx_rearmed_drc: 'disabled', pcsx_rearmed_gpu_thread_rendering: 'disabled', pcsx_rearmed_bios: 'HLE', pcsx_rearmed_dithering: 'enabled', pcsx_rearmed_spu_interpolation: 'gaussian', pcsx_rearmed_spu_reverb: 'enabled', pcsx_rearmed_spu_thread: 'disabled', pcsx_rearmed_fractional_framerate: 'enabled', pcsx_rearmed_cd_turbo: 'disabled', pcsx_rearmed_show_bios_bootlogo: 'disabled', pcsx_rearmed_region: 'auto', pcsx_rearmed_noxadecoding: 'enabled', pcsx_rearmed_nocdaudio: 'enabled' }, pad: SONY },
  // its libretro.c includes OpenGL's headers whatever it's built with, though nothing of them is linked
  n64: { source: libretro('parallel-n64'), commit: '2d90e20fa140b104d810bc0ea289f6f382e5086a', make: ['HAVE_PARALLEL=0', 'HAVE_THR_AL=1', 'HAVE_OPENGL=0', 'WITH_DYNAREC=', 'CPUOPTS=-O2 -DNDEBUG -ffp-contract=off -fno-fast-math'], built: 'parallel_n64_libretro', patch: 'tools/libretro/parallel-n64.patch', ran: 'starts', headers: { linux: [{ header: '/usr/include/GL/gl.h', install: 'sudo apt install libgl-dev' }] }, gameChoosesRate: true, options: { 'parallel-n64-gfxplugin': 'angrylion', 'parallel-n64-rspplugin': 'cxd4', 'parallel-n64-cpucore': 'cached_interpreter', 'parallel-n64-angrylion-multithread': 'off', 'parallel-n64-alt-map': 'disabled' }, pad: { UP: 'UP', DOWN: 'DOWN', LEFT: 'LEFT', RIGHT: 'RIGHT', START: 'START', ...STICK, A: 'B', B: 'Y', Z: 'L2', L: 'L', R: 'R', C_UP: 'RSTICK_UP', C_DOWN: 'RSTICK_DOWN', C_LEFT: 'RSTICK_LEFT', C_RIGHT: 'RSTICK_RIGHT' } },
  ps2: { source: 'https://github.com/jpd002/Play-.git', commit: '1f27232772e484bfb79364b751b84f41f4c87481', submodules: true, cmake: ['-DBUILD_LIBRETRO_CORE=ON', '-DBUILD_PLAY=OFF', '-DBUILD_TESTS=OFF'], cmakeOn: { linux: ['-DUSE_GLES=ON'] }, target: 'play_libretro', folder: 'build/Source/ui_libretro', built: 'play_libretro', patch: 'tools/libretro/play.patch', copies: { 'kit/ps2/c/spu2.c': 'Source/iop/dreamports/spu2.c' }, ran: 'blocks', holds: true, graphics: true, options: { play_res_multi: '1x', play_presentation_mode: 'Fit Screen', play_bilinear_filtering: 'false' }, pad: SONY },
  // Dolphin, GPL-2.0-or-later, in its libretro front, with a change of the tools' own that lets its software renderer run
  // with no window (libretro/dolphin.patch): its interpreter for the processor, with the processor's caches, its software
  // renderer, which draws on the processor in whole numbers, and the sound processor's own programs run an instruction
  // at a time, all on one thread, a field of the picture to a frame, and the samples its audio interface takes, at the
  // interface's own rate, which the tools hear at the kit's (docs/CONSOLES.md)
  gamecube: { source: libretro('dolphin'), commit: 'e0f0bfec5003270c6252a51d1eae6e6bbec6c3ed', submodules: true, cmake: ['-DLIBRETRO=ON', '-DENABLE_LTO=OFF', '-DENABLE_VULKAN=OFF', '-DUSE_MGBA=OFF'], cmakeOn: { linux: ['-DENABLE_X11=OFF', '-DENABLE_EGL=OFF', '-DENABLE_HWDB=OFF'] }, target: 'dolphin_libretro', folder: 'build', folderOn: { win32: 'build/Binaries' }, built: 'dolphin_libretro', patch: 'tools/libretro/dolphin.patch', leaves: true, gameChoosesRate: true, withoutSubmodules: ['Externals/Qt', 'Externals/FFmpeg-bin', 'Externals/gtest', 'Externals/libadrenotools'], data: { 'Data/Sys/GC': 'dolphin-emu/Sys/GC' }, options: { dolphin_cpu_core: '0', dolphin_cpu_clock_rate: '1.00', dolphin_emulation_speed: '0.0', dolphin_main_cpu_thread: 'disabled', dolphin_fastmem: 'disabled', dolphin_fastmem_arena: 'disabled', dolphin_main_accurate_cpu_cache: 'enabled', dolphin_main_mmu: 'enabled', dolphin_cheats_enabled: 'disabled', dolphin_cheats_import: 'disabled', dolphin_skip_gc_bios: 'enabled', dolphin_fast_disc_speed: 'disabled', dolphin_rush_presentation: 'disabled', dolphin_early_presentation: 'disabled', dolphin_dsp_hle: 'disabled', dolphin_dsp_jit: 'disabled', dolphin_call_back_audio_method: '0', dolphin_renderer: 'Software', dolphin_efb_scale: '1', dolphin_crop_overscan: 'disabled', dolphin_texture_cache_accuracy: '0', dolphin_fast_depth_calculation: 'disabled', dolphin_force_true_color: 'disabled', dolphin_disable_copy_filter: 'disabled', dolphin_efb_access_enable: 'enabled', dolphin_bbox_enabled: 'enabled', dolphin_force_progressive: 'disabled', dolphin_efb_to_texture: 'disabled', dolphin_xfb_to_texture_enable: 'disabled', dolphin_defer_efb_copies: 'disabled', dolphin_immediate_xfb: 'disabled', dolphin_skip_dupe_frames: 'disabled', dolphin_early_xfb_output: 'enabled', dolphin_efb_scaled_copy: 'disabled', dolphin_efb_emulate_format_changes: 'enabled', dolphin_vi_skip: 'disabled', dolphin_fast_texture_sampling: 'disabled', dolphin_osd_enabled: 'disabled', dolphin_default_mouse_bindings_enabled: 'disabled' }, pad: { UP: 'UP', DOWN: 'DOWN', LEFT: 'LEFT', RIGHT: 'RIGHT', START: 'START', ...STICK, A: 'A', B: 'B', X: 'X', Y: 'Y', Z: 'R', L: 'L2', R: 'R2', L_ANALOG: 'L3', R_ANALOG: 'R3', C_UP: 'RSTICK_UP', C_DOWN: 'RSTICK_DOWN', C_LEFT: 'RSTICK_LEFT', C_RIGHT: 'RSTICK_RIGHT' } },
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
