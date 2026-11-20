# Sources

The kit's GPU draws with psx_gpu, by Gilead Kutnick (Exophase), the GPU PCSX ReARMed draws a game with, so a Dreamport's every pixel comes out as the emulator's `prove` compares it with. These files are from libretro/pcsx_rearmed at 7b0e8f8 (https://github.com/libretro/pcsx_rearmed), the commit `tools/consoles.mjs` fixes:

- `psx_gpu.c`, `psx_gpu.h`, `psx_gpu_parse.c`, `vector_ops.h` and `vector_types.h`, from `plugins/gpu_neon/psx_gpu/`, under the GNU General Public License, version 2 or any later version, as each says. Changed here: one line each of `psx_gpu.c` and `psx_gpu_parse.c` includes a file of this folder by its name, where it named a folder of that project (`compiler_features.h`, `gpu_timing.h`, `gpu.h`).
- `gpu.h`, from `plugins/gpulib/`, under the GNU General Public License, version 2 or later, or the GNU Lesser General Public License, version 2.1 or later, as that project's gpulib says. Changed here: one line includes `compiler_features.h` by its name.

As the kit is under the GNU General Public License, version 3 or later, these are too, here.

The kit's own, written for it, at the names those files include: `common.h`, `compiler_features.h`, `gpu_timing.h`, `psx_gpu_offsets.h`, `psx_gpu_simd.h` and `psx_gpu_4x.c`, small headers of types, declarations and macros, an emulator's timing counted as nothing, and its drawing at four times the console's size left empty; and `../libc/`, the few C library headers psx_gpu takes, which the kit built to WebAssembly has no other of, shared with the sound chip's dfsound. `../draw.c` builds psx_gpu as that project's `plugins/gpu_neon/psx_gpu_if.c` does, with the same settings, and carries gpulib's table of command lengths from its `gpu.c`, under its licence above. It also decides, in its own words, which textured quads the emulator draws as rectangles, as that project's `plugins/gpulib/prim.c` decides it.
