# Sources

The kit's CD drive is PCSX ReARMed's own, so a Dreamport's drive answers every command, raises every interrupt and gives every sector at the cycle the emulator `prove` compares it with gives them. These files are from libretro/pcsx_rearmed at 7b0e8f8 (https://github.com/libretro/pcsx_rearmed), the commit `tools/consoles.mjs` fixes, from `libpcsxcore/`, under the GNU General Public License, version 2 or any later version, as each says:

- `cdrom.c` and `cdrom.h`, the drive, by Ryan Schultz, the PCSX-df Team and the PCSX team, with later work by that project.
- `decode_xa.c`, its XA decoder, by the same.

Changed here: their lines that include the emulator's own headers, `cdrom_bits.h`, `cdrom-async.h`, `misc.h`, `ppf.h`, `psxdma.h`, `psxevents.h`, `arm_features.h`, `psxcommon.h`, `decode_xa.h`, `r3000a.h`, `plugins.h`, `psxmem.h`, `psxhw.h` and `psemu_plugin_defs.h`, include the kit's one header, `pcsx.h`, in their place.

As the kit is under the GNU General Public License, version 3 or later, these are too, here.

The kit's own, written for it: `pcsx.h`, what those files take from the rest of the emulator, by the same names: its types, its settings, its processor's cycle and events, the hardware registers the drive writes, its disc reader, its sound chip's side of the CD's sound, and the drive's commands, interrupts, mode, status and errors as the console has them (psx-spx, CDROM Controller). `../cd.c` builds `decode_xa.c` and `cdrom.c` as one with itself and gives them those, from the kit's clock, the player's disc and its sound chip, and puts the drive and the disc as the emulator leaves them when it starts a game, as that project's `libpcsxcore/misc.c` (`CheckCdrom`, `LoadCdromMainExe`), `cdriso.c`, `psxhw.c` and `psxbios.c` (`psxBiosCnfLoaded`, `psxBiosSetupBootState`) do, under the same licence.
