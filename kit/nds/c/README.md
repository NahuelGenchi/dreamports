# Nintendo DS kit in C

[Back to the kits in C](../../c/README.md) · [Other consoles](../../../docs/CONSOLES.md#the-nintendo-ds) · [The Dreamport standard](../../../docs/STANDARD.md)

This folder is the Nintendo DS's kit for games written in C, on what [every console's kit in C](../../c/README.md) shares. It's the console's two processors' programs running side by side by the console's clock, its main memory, its two screens' display, its buttons, its touch screen and its sound, written from how [melonDS](https://github.com/melonDS-emu/melonDS), the tools' reference emulator, has them.

Like the rest of the kits it's under [GPL-3.0-or-later](../LICENSE), and nothing from any game is in it. melonDS is under the same licence, and its sound's tables and the order of its sums are followed here as melonDS has them.

## What's in it

| File | What it does |
| :--- | :--- |
| `nds.h` | What a game sees of the console: its two programs, the main memory, each processor's reads and writes of the hardware, and time |
| `nds.c` | The two programs side by side, the main memory, the display, the buttons, the serial bus to the touch screen's chip, and what the page calls |
| `sound.c` | The sound: sixteen channels of 8-bit, 16-bit and ADPCM samples, square waves and noise, and the mixer, with its bias and its cut to 10 bits |
| `nds-kit.h` | What the kit's own files share, which a game doesn't need |

## A game in C

A game includes `"nds.h"` and defines its two programs, as its cartridge has one for each processor: `game_arm9()`, most of a game, and `game_arm7()`, which reads the touch screen and plays the sound. Each is written as its original runs. It never comes back, and waits for the screen with `nds9_wait_vblank` or `nds7_wait_vblank` where the original waits for the V-blank, giving how long after it starts the original's loop sees it.

Each reads and writes the hardware and the memory the two share through its own processor's functions, `nds9_read16`, `nds7_write32` and the rest, as the original's loads and stores do. Each has a time of its own, in ticks of the console's 33,513,982 Hz clock, which `nds9_spend` and `nds7_spend` move on by the cycles the original's code takes between two reads or writes, the ARM9's two to a tick. Before either reads or writes, the one that's behind runs first, up to the other's time, so a value one writes is there for the other's read only when the console's would be. The kit doesn't time a game's code itself: it's the game that says how long its original takes, as the NES's kit asks with `nes_spend`, and the proof tools check it on every frame.

A frame of the proof tools runs from one V-blank's start to the next's, as what a frame shows and plays follows from what the programs wrote in the V-blank before it ([The Nintendo DS](../../../docs/CONSOLES.md#the-nintendo-ds)). The two programs start at tick 0, as the reference emulator starts a game's programs directly, and run until each first waits.

`npm run dp -- new <game>/c` on a Nintendo DS game writes the starting point on this kit, from `tools/libretro/new-game/c/nds.c.template`: both screens blue, and green while A is held.

## What it does

**The display.** Each engine, A and B, is on the screen the power register's top bit puts it on, as melonDS draws them: white when its display is off or blanked, black for A and white for B when the power register turns the engine off, and both screens black when the screens are off. With its display on, an engine shows its backdrop, the first of its colours, as its registers hold it once the V-blank's writes are done. The display's status gives the V-blank's flag from line 192 to 261 and the H-blank's from 1,584 ticks into a line, with the line in the register after it.

**The buttons and the touch screen.** Both processors read the ten buttons, and the ARM7 X, Y and the pen, at `0x04000136`. The ARM7 asks the touch screen's chip over the serial bus, a byte at a time, each transfer taking as long as its speed says, and the chip measures the pixel the page was touched at, as the pixel times 16.

**The sound.** Sixteen channels, each 8-bit, 16-bit or ADPCM samples from the main memory, read ahead 32 bytes at a time as the console's sound DMA does, and channels 8 to 13 a square wave of any of its 8 duties and 14 and 15 noise, each with its volume, divider and place between left and right. The mixer adds them up every 1,024 ticks from tick 1,024 on, takes the master volume, adds the bias, and keeps 10 bits of each sample, as the console's speakers get. The ARM7's power register mutes it.

## Not yet

The kit stops the game, so it never shows or plays what the console wouldn't, where a game turns on what isn't here yet: backgrounds, sprites, windows, blending, 3D, the master brightness, the video memory and its banks, a display of the video memory or of the main memory, the sound's capture units and the mixer's other ways of taking channels 1 and 3, and a write to anything else of the hardware. Not there at all yet: the memory the two processors share at `0x03000000` and the ARM7's own, the processors' message queue and their sync register, the timers, the interrupts and DMA, the cartridge and its save memory, the real-time clock, the BIOS's functions, the microphone and the lid. Each comes as a game needs it, proven against melonDS with a program of the project's own.

## How it's checked

`npm run test:real-nds` proves a Dreamport in C of a small Nintendo DS program of the project's own on this kit ([`tools/test/made-up-nds.c`](../../../tools/test/made-up-nds.c)), its two programs written again, against melonDS: every frame of both screens and the sound, with buttons and touches from a recording, and finds one that reads a touch in the wrong place.
