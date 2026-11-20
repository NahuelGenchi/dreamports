# The Super Nintendo's kit in C

[Back to README](../../../README.md) · [The kits in C](../../c/README.md) · [Other consoles](../../../docs/CONSOLES.md) · [Written in: #1641](https://github.com/NahuelGenchi/dreamports/issues/1641)

A Super Nintendo game in C runs on this kit, on top of what every console's kit in C shares ([`kit/c/`](../../c/README.md)). Its C keeps every value where its original does, at the console's own 24-bit addresses, and reads and writes the console's hardware registers through the kit, as its original's loads and stores do. Like the rest of the kits it's under [GPL-3.0-or-later](../LICENSE), and nothing from any game is in it.

## What's in it

| File | What it does |
| :--- | :--- |
| `snes.h` | What a game includes: where the work memory and the registers are, the two functions that read and write the hardware, the picture's memories, the cartridge, and the four functions every game defines |
| `snes.c` | The registers: the work memory's port, the multiply and divide unit, the two flags a read clears, and the rest kept as the last value written; and the cartridge, LoROM or HiROM, with its save memory, as DMA reads it |
| `ppu.c` | The picture unit: its registers and memories, and each frame's lines drawn from them |
| `dma.c` | DMA, as a write to `$420B` starts it |
| `frame.c` | What the page calls to start a game, run its frames, draw them and hear them |
| `snes-kit.h` | What the kit's own files share |

## Writing a game on it

A game's C keeps its values at the console's addresses: the work memory at `$7E0000`, `SNES_RAM`, which its original also sees at `$0000` to `$1FFF` of the low banks; its save memory and its cartridge's ROM where the cartridge's map puts them. Where its original stores to a register, `$2100` to `$21FF` or `$4000` to `$43FF`, the game calls `snes_write(address, value)`, and where it loads one, `snes_read(address)`, in the same order, so a Dreamport's hardware work is its original's, write for write.

Beside drawing, the registers do what the console does with memory and sums: a write to `$2180` puts its byte in the work memory where `$2181` to `$2183` point and moves them on, and a read there reads one; a write to `$4203` multiplies it by `$4202` into `$4216` and `$4217`, and one to `$4206` divides `$4204` and `$4205` by it, the quotient into `$4214` and `$4215` and what's left into `$4216` and `$4217`, with the results there at once, as Snes9x has them, the reference the proof tools run the original on; reading `$4210` or `$4211` clears its top bit; and the sound processor's four ports are seen again every four bytes up to `$217F`. Every other register keeps what was last written to it. A game keeps its own values above the console's 16 MB, as its build links it, so the console's addresses below are free for its C. `npm run dp -- new <game>/c` writes a game on this kit that shows the backdrop in blue.

## What it draws so far

Each frame the kit runs the game's step, what its original does from a V-blank to the next, and then draws the frame's 224 lines from the registers as the step left them, from line 1, as the console shows no line 0. So far it draws the screen off and on and its sixteen brightnesses, each colour's 5 bits times the brightness over 15, rounded, as Snes9x has it; the backgrounds of modes 0 and 1, with tiles of 8 or 16 pixels, maps of 32 or 64 tiles across and down, each tile's palette, flips and priority, mode 1's third background in front when `$2105` says, and each background's scrolling, with the byte the scroll registers share; which of them the main screen shows; video memory written through its port, with its address turned round and moved on as `$2115` says; and the colours through theirs. DMA moves bytes between the console's memories and the picture's and the sound's registers, in all eight of its patterns, either way. A game's step's writes all happen before the frame's lines are drawn.

## What it doesn't do yet

The other modes, sprites, windows, colour maths and the sub screen, mosaic, HDMA, writes partway down the screen, and the sound processor with its DSP, which #1641's last step brings, and so a frame of anything else differs, which `prove` finds.

## How it's checked

`npm run test:snes-kit` proves it on every pull request with a program of the project's own, a cartridge that fills video memory, the colours and two maps by DMA, shows two backgrounds of mode 1, scrolls them both ways and steps the brightness through every value, run in Snes9x, the console's reference emulator, and the same program in C on the kit: every frame of 300 is the same, pixel for pixel, and the sound, silence. A Dreamport of it with its third background behind, its scroll a pixel off or its brightness a step off is each found at its first frame.

The function check builds a game's twins on this kit with `DP_TWIN_CHECK`, so `snes.c` notes each read and write of the hardware in order, and compares the list with the original's, as Snes9x's own 65816 runs it ([The function check on the Super Nintendo](../../../tools/README.md#the-function-check-on-the-super-nintendo)), and keeps the picture's registers and DMA's as memory, as the original's side does. `npm run test:snes-twin` does that on every pull request with a made-up cartridge of the project's own.
