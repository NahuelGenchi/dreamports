# The Super Nintendo's kit in C

[Back to README](../../../README.md) · [The kits in C](../../c/README.md) · [Other consoles](../../../docs/CONSOLES.md) · [Written in: #1641](https://github.com/NahuelGenchi/dreamports/issues/1641)

A Super Nintendo game in C runs on this kit, on top of what every console's kit in C shares ([`kit/c/`](../../c/README.md)). Its C keeps every value where its original does, at the console's own 24-bit addresses, and reads and writes the console's hardware registers through the kit, as its original's loads and stores do. Like the rest of the kits it's under [GPL-3.0-or-later](../LICENSE), and nothing from any game is in it.

## What's in it

| File | What it does |
| :--- | :--- |
| `snes.h` | What a game includes: where the work memory and the registers are, and the two functions that read and write the hardware |
| `snes.c` | The registers: the work memory's port, the multiply and divide unit, the two flags a read clears, and the rest kept as the last value written |

## Writing a game on it

A game's C keeps its values at the console's addresses: the work memory at `$7E0000`, `SNES_RAM`, which its original also sees at `$0000` to `$1FFF` of the low banks; its save memory and its cartridge's ROM where the cartridge's map puts them. Where its original stores to a register, `$2100` to `$21FF` or `$4000` to `$43FF`, the game calls `snes_write(address, value)`, and where it loads one, `snes_read(address)`, in the same order, so a Dreamport's hardware work is its original's, write for write.

What the registers do so far is what's memory or sums, not picture or sound: a write to `$2180` puts its byte in the work memory where `$2181` to `$2183` point and moves them on, and a read there reads one; a write to `$4203` multiplies it by `$4202` into `$4216` and `$4217`, and one to `$4206` divides `$4204` and `$4205` by it, the quotient into `$4214` and `$4215` and what's left into `$4216` and `$4217`, with the results there at once, as Snes9x has them, the reference the proof tools run the original on; reading `$4210` or `$4211` clears its top bit; and the sound processor's four ports are seen again every four bytes up to `$217F`. Every other register keeps what was last written to it.

## What it doesn't do yet

The picture, DMA and HDMA, and the sound processor with its DSP, which #1641's last step brings, and so `npm run dp -- new` doesn't start a Super Nintendo game on this kit yet.

## How it's checked

The function check builds a game's twins on this kit with `DP_TWIN_CHECK`, so `snes.c` notes each read and write of the hardware in order, and compares the list with the original's, as Snes9x's own 65816 runs it ([The function check on the Super Nintendo](../../../tools/README.md#the-function-check-on-the-super-nintendo)). `npm run test:snes-twin` does that on every pull request with a made-up cartridge of the project's own.
