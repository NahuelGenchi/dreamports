# The Nintendo 64's kit in C

[Back to README](../../../README.md) · [The kits in C](../../c/README.md) · [Other consoles](../../../docs/CONSOLES.md) · [Written in: #1644](https://github.com/NahuelGenchi/dreamports/issues/1644)

A Nintendo 64 game in C runs on this kit, on top of what every console's kit in C shares ([`kit/c/`](../../c/README.md)). It reads and writes the console as its original does, at the same addresses: its memory, RDRAM, and the registers of the chips around the processor. The kit does what those chips do with them. The RSP runs the microcode the game gives it, the very bytes the game copies from the player's cartridge, the RDP draws the commands it's sent into RDRAM, and the video interface shows the part of RDRAM it's told to. Like the rest of the kits it's under [GPL-3.0-or-later](../LICENSE), and nothing from any game is in it.

## What's in it

| File | What it does |
| :--- | :--- |
| `n64.h` | What a game includes: RDRAM, the registers by name, `n64_read32` and `n64_write32` to reach them, and the four functions every game defines |
| `n64.c` | The console's memory as its processor reaches it, the interrupts its chips raise, the cartridge read through the peripheral interface, and what the page calls |
| `rsp.c` | The RSP: its registers, its DMA, and its scalar unit running microcode from its instruction memory |
| `vu.c` | The RSP's vector unit: its registers, its accumulator and flags, every one of its sums, and its loads and stores |
| `rdp.c` | The RDP: its command list, and the rectangles it fills |
| `vi.c` | The video interface: the picture the page shows |
| `n64-kit.h` | What the kit's own files share |

## Writing a game on it

A game defines `game_start()`, run once, `game_step(buttons)`, run every frame, `game_draw()`, which calls `n64_show()`, and `game_sound()`, as on every console ([the kits in C](../../c/README.md)). Where its original stores a word at an address, the game calls `n64_write32(address, word)`, and where it loads one, `n64_read32(address)`, with the same addresses, cached, uncached or physical, and `n64_write16`, `n64_write8` and their reads do the same for half-words and bytes of memory. So a Dreamport's work with the console's chips is its original's, word for word. `n64_rdram` is RDRAM itself, each number highest byte first, as the console keeps it.

The chips finish at once. A task the RSP is started on runs whole as SP_STATUS lets it go, a list sent to the RDP is drawn as DPC_END is written, and a DMA is done when its length is: each raises its interrupt as it ends, in MI_INTR, so a wait for one is a read that finds it done. `game_step` starts as the video interface's interrupt does, which is raised for it. `npm run dp -- new <game>/c` writes a game that sets up a screen of 320 by 240 and has the RDP fill it.

## A twin on it

A function of a game made a function at a time is a twin: the same C is proven against the original by the function check and plays in the game. The check's build has `n64_read32`, `n64_write32` and the others as the processor's own loads and stores at the address, with no chip behind them, and its pass over the built module sends each to where the console has that address, highest byte first, as it does a twin that names an address itself ([The function check on the Nintendo 64](../../../tools/README.md#the-function-check-on-the-nintendo-64)). So a twin written with the kit's reads and writes leaves in the check's memory what its original leaves, a register's last value included, and in the game the chips do their work with the same calls. `npm run test:n64-parts` proves four such twins and plays them ([#1932](https://github.com/NahuelGenchi/dreamports/issues/1932)).

## What the chips do so far

- **The RSP** runs any microcode: every instruction of its scalar unit, with their delay slots, its DMA both ways, its status, signals and semaphore, and every instruction of its vector unit, loads and stores of every size among them. It does what cxd4 does, the RSP the proof tools' emulator runs, sum for sum: where cxd4 and the console's documentation part, as for VABS of -32768 or loads and stores with an element the console doesn't expect, cxd4's way is kept, so a proof can compare the two.
- **The RDP** reads its commands from RDRAM or from the RSP's data memory, and draws rectangles in fill mode into colour images of 8, 16 and 32 bits, inside the scissor, on exactly the pixels angrylion's RDP gives them.
- **The video interface** shows 16-bit and 32-bit pictures at any size and place its registers give, resampled across and down when they ask for it, with gamma and gamma dithering, at the size angrylion's makes, 640 by 240.
- **The peripheral interface** copies the player's cartridge into RDRAM.

## What it doesn't do yet

- The RDP's triangles, textured rectangles and every other mode than fill: a command for one is taken with its words and nothing is drawn, so `prove` finds the first frame that has one. A fill rectangle followed straight away by a new fill colour with no sync between is drawn whole in its own colour, where angrylion models the new colour landing in its last rows.
- The video interface's anti-aliasing that reads the coverage the RDP keeps, its divot and dither filters, and interlaced screens.
- Sound through the audio interface, the controllers and the save chips through the serial interface, and the timing of the chips: the kit's are done at once.
- A game's own processor code that waits for a chip from inside a function, which a game written the stricter way will need (`kit_wait_frame`, [the kits in C](../../c/README.md)).

## How it's checked

`npm run test:n64-kit` builds the console's emulator, Parallel N64, with angrylion's RDP and cxd4's RSP, and runs a small program of the project's own on it, written in the assembly the tools assemble (`tools/test/made-up-n64.mjs`). Each frame it gives the RSP two microcodes of its own. The first makes the RDP's commands for a square two pixels on from the last and adds the frame's shade to its colour with the vector unit, and the RDP fills the background and the square. The second is the vector unit's check: from numbers that change every frame it runs every one of the unit's sums with elements of every kind, its divides and moves, and its loads and stores of every size, keeps the accumulator and the flags after them, and sends all the results into eight rows of the picture with the RSP's own DMA, a second time with each half-word turned round by a bit, so every bit of every result is on the screen. Its Dreamport in C (`tools/test/n64-kit/main.c`) runs on this kit with the same microcodes, copied from the same cartridge. `prove` finds all 300 frames the same, every pixel and the sound, silence. Without the check, the rows it fills differ at the first frame, and so does the square a shade off and what `new` writes. It runs on every pull request.
