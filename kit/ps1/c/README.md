# The PlayStation's kit in C

[Back to README](../../../README.md) · [The kits in C](../../c/README.md) · [Other consoles](../../../docs/CONSOLES.md) · [Written in: #1558](https://github.com/NahuelGenchi/dreamports/issues/1558)

A PlayStation game in C runs on this kit, on top of what every console's kit in C shares ([`kit/c/`](../../c/README.md)). It writes the console's graphics chip, the GPU, as its original does, a word at a time to its two ports, and the kit draws what it's told into the GPU's own video memory and shows the part the GPU is told to show. Like the rest of the kits it's under [GPL-3.0-or-later](../LICENSE), and nothing from any game is in it.

## What's in it

| File | What it does |
| :--- | :--- |
| `ps1.h` | What a game includes: the GPU's ports and video memory, and the four functions every game defines |
| `gpu.c` | The GPU: GP0's drawing commands and pictures moved into video memory, GP1's screen, and the picture the page shows |
| `ps1.c` | What the page calls to start a game, run its frames, draw them and hear them |
| `ps1-kit.h` | What the kit's own files share |

## Writing a game on it

A game defines `game_start()`, run once, `game_step(buttons)`, run every frame, `game_draw()`, which calls `gpu_show()`, and `game_sound()`, as on every console ([the kits in C](../../c/README.md)). Where its original writes a word to GP0, at `0x1F801810`, the game calls `gpu_gp0(word)`, and where it writes GP1, at `0x1F801814`, `gpu_gp1(word)`, with the same words: so a Dreamport's GPU work is its original's, word for word. `gpu_status()` gives what a read of GP1 gives, and `gpu_vram` is the GPU's 1 MB of video memory, 1024 by 512 pixels of 15-bit colour, red lowest. `npm run dp -- new <game>/c` writes a game that sets up a screen of 320 by 240 and fills it.

## What the GPU draws so far

- **GP0**: a rectangle of video memory filled (`02`); flat rectangles of their own size and of 1, 8 and 16 pixels square (`60` to `7F`, untextured), with the console's four ways of mixing a colour with what's under it (`E1`); the drawing area they stay inside (`E3`, `E4`) and the offset they're moved by (`E5`); the mask bit, set and checked (`E6`); and pictures moved into video memory (`A0`) and within it (`80`).
- **GP1**: reset, the display on and off, where in video memory the screen starts, its mode, 256, 320, 368, 512 or 640 across, and as many lines as its vertical range, twice them when it interlaces 480.

## What it doesn't do yet

Polygons, lines and textures: a command for one is taken, its words are gathered, and nothing is drawn, so `prove` finds the first frame that has one. The screen in 24-bit colour, the sound chip, the pads, the CD drive, the memory cards and the geometry processor aren't here yet either, and neither is a game's own program reading what it drew back out of video memory.

## How it's checked

`npm run test:ps1-kit` builds the console's real emulator, PCSX ReARMed, runs a small program of the project's own on it, a background and a square moving two pixels a frame, written in the assembly the tools assemble (`tools/test/made-up-ps1.mjs`), and runs its Dreamport in C on this kit (`tools/test/ps1-kit/main.c`). `prove` finds all 300 frames the same, every pixel and the sound, silence. The square a shade off differs at the first frame, and so does what `new` writes. It runs on every pull request.
