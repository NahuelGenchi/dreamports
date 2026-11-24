# The GameCube's kit in C

[Back to README](../../../README.md) · [The kits in C](../../c/README.md) · [Other consoles](../../../docs/CONSOLES.md#the-gamecube) · [Written in: #1951](https://github.com/NahuelGenchi/dreamports/issues/1951)

A GameCube game in C runs on this kit, on top of what every console's kit in C shares ([`kit/c/`](../../c/README.md)). It reads and writes the console as its original does, at the same addresses: its memory and the registers of the chips around its processor. The kit does what those chips do with them, as Dolphin, the console's reference in the proof tools, does with its settings and the tools' change to it ([The GameCube](../../../docs/CONSOLES.md#the-gamecube)). Like the rest of the kits it's under [GPL-3.0-or-later](../../c/LICENSE), and nothing from any game is in it.

## What's in it

| File | What it does |
| :--- | :--- |
| `gamecube.h` | What a game includes: the console's memory, the registers by name, `gc_read32`, `gc_write32` and their kin to reach them, `gc_show` and `gc_sound`, and the four functions every game defines |
| `gamecube.c` | The console's memory as its processor reaches it, through the cache and round it, the chips' registers, and what the page calls |
| `vi.c` | The video interface: its registers, and the field it shows each frame |
| `audio.c` | The audio interface and the sound processor's audio DMA: the samples a game hands the interface, heard as the tools hear the reference |
| `si.c` | The serial interface: the first controller's answer to the polls |
| `floats.c` | The processor's single-precision sums, as the reference works them out to the bit |
| `gamecube-kit.h` | What the kit's own files share |

## Writing a game on it

A game defines `game_start()`, run once, `game_step(buttons)`, run every frame, `game_draw()`, which calls `gc_show()`, and `game_sound()`, which calls `gc_sound()`, as on every console ([the kits in C](../../c/README.md)). Where its original stores a word at an address, the game calls `gc_write32(address, word)`, and where it loads one, `gc_read32(address)`, with the same addresses, and `gc_write16`, `gc_write8` and their reads do the same for half-words and bytes. `gc_ram` is the console's 24 MB of memory, each number highest byte first, as the console keeps it: 0x80000000 to the processor through its cache, and 0xC0000000 round it. The chips' registers are at 0xCC000000 and up, by the names `gamecube.h` gives them. `npm run dp -- new <game>/c` writes a game that sets the video interface up for 640 by 480 and fills its framebuffer blue.

A frame is a field: the console sends a television 60 a second, each every other line of the picture. `game_step` runs what the original does in one, from when its wait for the screen ends to its next one, and the field is shown from memory as the step ends.

## What the chips do so far

- **Memory.** All 24 MB, through the cache and round it alike: the kit keeps no cache, so a write through the cache is in memory at once, where on the console and in the reference it stays in the cache until the game flushes it or the cache needs the room. A game that hands memory to a chip flushes it first, as the console needs, and then the two agree.
- **The video interface** keeps its registers, and each frame shows a field of the framebuffer its registers point at: the top field's lines from the top address, the bottom field's from the bottom one, as wide as the picture's register says and as many lines as its timing register's, a line's stride apart. Each word of the framebuffer is two pixels, their brightness and the colour differences they share, Y, Cb, Y and Cr, and red, green and blue are made from them as the reference makes them, in single floats by the sums of ITU-R BT.601, cut toward zero. A disc boots a frame sooner than a program given alone, so on a disc the game's first frame shows the bottom field, and a program's the top one, and they alternate from there. A field with no framebuffer, or none of its size, leaves the last picture there, as the reference shows nothing new. Where the beam is isn't counted: a read of it gives the first line.
- **Sound.** The sound processor's audio DMA takes the samples a game keeps in memory 32 bytes at a time, 8 pairs, each the right side's and then the left's, round and round the blocks the game gives it, with the registers of the start, the length and the blocks left as the reference has them, or 8 pairs of silence while it's off. The audio interface plays them at its rate, the slower, 32,028.5 a second, as it starts, or the faster, 48,042.7, when its control register says so, and `gc_sound` gives them at the kit's 48,000, on a straight line between each two, as the tools hear the reference.
- **Floats.** `gc_adds`, `gc_subs`, `gc_muls`, `gc_divs` and `gc_madds` give a sum, a difference, a product, a quotient and a multiply-add of singles as the processor does in the reference ([#1996](https://github.com/NahuelGenchi/dreamports/issues/1996)): a product's second operand rounded to 25 bits first, a multiply-add rounded once, and a NaN kept as its bits say, the first operand that is one, made quiet, where WebAssembly promises no NaN's bits. `gc_tointz` makes a double a whole number toward zero as `fctiwz` does, the largest or the smallest for what is past them or not a number. A game's twin calls them where its original's code does those sums, as on a pair of paired singles, one of each.
- **The first controller.** The serial interface answers for a standard controller in the first port, polled every frame, in the mode the reference starts it in: its buttons and 0x0080 in the first word with the main stick across and down, and the C stick and the triggers in the second. A stick a recording holds over is all the way, 0x01 or 0xFF, on both axes for a diagonal, and a trigger is at 0xFF pressed to its click, with its button's bit, or short of it, without, as the reference gives them.

## What it doesn't do yet

- The graphics chip, GX: its FIFO, its vertex formats, its TEV stages, its embedded framebuffer and the copy of it to memory. A game that draws with it draws nothing here yet.
- The sound processor's own programs, and sound a game streams from its disc.
- The disc's drive, the memory cards, the other three controller ports, a command sent with the serial interface's communication register, and the processor interface's interrupts and timers.
- The processor's caches, and its float sums beyond those of `floats.c`: a double's multiply and multiply-add, an estimate of a reciprocal or a square root, and a paired single's load or store that scales whole numbers by its GQR.
- A game's own code that waits for a chip from inside a function (`kit_wait_frame`, [the kits in C](../../c/README.md)).

## How it's checked

`npm run test:gamecube-kit` boots the made-up program of the tools' tests from its disc in the reference ([`made-up-gamecube.mjs`](../../../tools/test/made-up-gamecube.mjs)). It draws each field's lines in their own colour, the first controller's two words as blocks of light and dark, and a square that moves, and plays a tone louder on the left. Its Dreamport in C ([`gamecube-kit/main.c`](../../../tools/test/gamecube-kit/main.c)) runs on this kit, and `prove` finds every frame of a recording that presses every button, both sticks in every direction and both triggers the same as the reference's, picture and sound. With a field's colours the other way round, a controller's bit read as another's, or the tone's right side silent, it finds the first frame that differs. The GameCube workflow runs it on Linux, a Mac and Windows.
