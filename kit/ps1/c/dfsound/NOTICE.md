# Sources

The kit's sound chip is mixed by dfsound, by Pete Bernert, with Chris Moeller's Gaussian table and later work by Gražvydas "notaz" Ignotas, the SPU PCSX ReARMed mixes a game's sound with, so a Dreamport's every sample comes out as the emulator `prove` compares it with makes it. These files are from libretro/pcsx_rearmed at 7b0e8f8 (https://github.com/libretro/pcsx_rearmed), the commit `tools/consoles.mjs` fixes, from `plugins/dfsound/`, under the GNU General Public License, version 2 or any later version, as each says:

- `spu.c`, `registers.c`, `dma.c`, `adsr.c`, `reverb.c`, which also names portions by SPU2-X, gigaherz and the PCSX2 Development Team, `xa.c`, `gauss_i.h`, `externals.h`, `registers.h`, `spu.h` and `stdafx.h`. Changed here: one line of `xa.c` includes `psemu_plugin_defs.h` by its name, where it named a folder of that project, and every file ends its lines as this repository does.

As the kit is under the GNU General Public License, version 3 or later, these are too, here.

The kit's own, written for it, at the names those files include: `out.h`, where the chip gives its samples; `spu_config.h`, its settings; `psemuxa.h`, a declaration of the CD's XA sound that nothing of the chip calls; and `psemu_plugin_defs.h`, the few types dfsound takes from that project's `include/psemu_plugin_defs.h`, a decoded sector of the CD's XA sound and the chip's saved state, by their names and in their layout. `../sound.c` builds `registers.c`, `dma.c` and `spu.c` as one, gives the chip its memory and the settings the tools' emulator has, and puts the chip as the emulator's BIOS leaves it when it starts a game, as that project's `libpcsxcore/psxbios.c` does (`psxBiosSetupBootState`, under the GNU General Public License, version 2 or later, as it says).
