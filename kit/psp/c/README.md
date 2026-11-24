# PlayStation Portable kit in C

[Back to the kits in C](../../c/README.md) · [Other consoles](../../../docs/CONSOLES.md) · [The Dreamport standard](../../../docs/STANDARD.md) · [Written in: #1926](https://github.com/NahuelGenchi/dreamports/issues/1926)

This folder is the PlayStation Portable's kit for games written in C, on what [every console's kit in C](../../c/README.md) shares. A game keeps the console's memory at the console's own addresses, runs in the console's threads and time, and asks the system for what its original asks, by the same names. The kit answers as the console's emulator in the proof tools does, PPSSPP ([Other consoles](../../../docs/CONSOLES.md#the-playstation-portable)), down to the cycle a thread is woken on.

Like the rest of the kits it's under [GPL-3.0-or-later](../../c/LICENSE), and nothing from any game is in it. It's written from how the console is documented to behave and from how PPSSPP, under the GPL too, answers a program.

## What's in it

| File | What it does |
| :--- | :--- |
| `psp.h` | What a game sees of the console: its memory by address, its time, and the system's functions by their names, for threads, the screen, the buttons and the sound channels |
| `memory.c` | The scratchpad, the video memory and the main memory, each where the processor sees it |
| `kernel.c` | The console's time, what's due at a time, and its threads: made, started, put to wait and woken in the order the system keeps them |
| `display.c` | The screen: its frames and V-blanks, the framebuffer a game names in each of the four pixel formats, and the waits for a V-blank |
| `ctrl.c` | The buttons and the stick, sampled as each V-blank ends into a ring of 64 samples a game peeks at or reads |
| `audio.c` | The eight sound channels, mixed 64 samples at a time, and each frame's sound list |
| `psp.c` | What the page calls to start the game, run its frames, draw them and hear them |
| `psp-kit.h` | What those files share, which a game doesn't need |

## Writing a game on it

A game includes `"psp.h"` and defines the four functions every game in C does ([A game on a console with no kit of its own](../../c/README.md#a-game-on-a-console-with-no-kit-of-its-own)). `npm run dp -- new <game>/c` writes a starting point that paints the screen blue, and green while a button is held.

**`game_start` is the program's first thread.** It runs as the original's does from its start, asks the system for what the original asks, waits where the original waits, and needn't come back. A frame of the page is a frame of the console, from one V-blank's start to the next, in which whichever of the game's threads has its turn runs. `game_step` isn't called on this console. `game_draw` calls `psp_show()`. So a game on this kit runs as WebAssembly only, as any game that waits from inside a function does.

**The console's first frame**, from power-on to its first V-blank, runs as the game starts, and the page's first frame is the console's second: the proof tools compare a Dreamport's frame with the original's next one. The console samples its buttons as each V-blank ends, from what the emulator was given as the frame started, so a PlayStation Portable game's `proof/original.json` says `"keysAfterVBlank": true`, or its original reads each press a frame before its Dreamport does.

**Memory.** As WebAssembly the console's memory is at the console's own addresses in the game's memory: the scratchpad's 16 KB from `0x00010000`, the video memory's 2 MB from `0x04000000` and the main memory's 64 MB from `0x08000000`, with a game's own values above them all. `psp_memory(address)` gives where an address is, whichever mirror it's in, the uncached one at `0x4xxxxxxx` or the kernel's at `0x8xxxxxxx`, and `psp_read32`, `psp_write32` and their kin read and write there. Where the system takes an address, as for a framebuffer, a block of samples or the pad's sample, a game gives the console's.

**Time.** The console's time is counted in the processor's cycles, 222 million a second. The emulator counts one for each instruction the original runs, and two for one of the vector unit's. The kit's own answers take the cycles the emulator takes for them: the two instructions every call of the system goes through, what a call is known to cost, such as 32,000 for making a thread, and 1,200 or 2,700 for changing the thread that runs. A game's own C takes none unless it says so, with `psp_time_pass(cycles)`: the instructions its original ran since the game last said so or last asked the system for something. That's right while its original's work is short beside a frame, and where it isn't, what's due meanwhile, a V-blank, a block of sound mixed, a better thread woken, happens partway through, as it does under the original. `psp_time()` is the time now.

**Threads.** `sceKernelCreateThread` takes the thread's function, a C function, and `sceKernelStartThread` starts it. The thread with the best priority, the lowest number, that is ready runs; among equals the one ready first; and a thread that runs keeps running until a better one is ready or it waits. A thread waits in `sceKernelSleepThread`, `sceKernelDelayThread`, the screen's waits, a read of the pad with no sample yet, and a block of sound handed to a channel that still has some. Each thread has a stack of its own and stops wherever it waits, by the same pass that lets a game wait for the screen from inside a function ([`kit/c/pause.c`](../../c/pause.c)). The numbers the system gives threads start where the emulator's do for a program run from its file.

**The screen.** `sceDisplaySetMode` waits for a V-blank, as the system's does. `sceDisplaySetFrameBuf` names the framebuffer, its line's length and its format, 16 bits as 565, 5551 or 4444, or 32 bits, shown at once or from the next V-blank. A game paints it by writing the console's memory, or through the graphics chip once the kit has it. `sceDisplayWaitVblankStart`, `sceDisplayWaitVblank`, `sceDisplayGetVcount` and `sceDisplayIsVblank` are the system's. `psp_show()` paints the page's picture from what the screen shows, each colour's 4, 5 or 6 bits widened to 8 as the emulator widens them.

**The buttons and the stick.** `sceCtrlPeekBufferPositive` and its kin write the pad's samples at the address they're given, 16 bytes each: the time it was taken in microseconds, the buttons as the console's own bits (`PSP_CTRL_CROSS` and the rest), and the stick. The proof tools hold the stick all the way over or not at all, so it reads 0, 128 or 255 each way, and only once a game has asked for it with `sceCtrlSetSamplingMode(1)`.

**Sound.** A game reserves a channel, `sceAudioChReserve`, and hands it blocks of 16-bit samples from the console's memory, `sceAudioOutputBlocking` and its kin, each with its two volumes. The console takes 64 samples from every channel 44,100 times a second and adds them up. A thread that hands a block to a channel that still has some waits until what was there has gone, so a thread that plays one block after another keeps the console's pace.

**The sound list.** Everything a game gives the channels in a frame is hashed in the order given, the same way the proof tools hash what the original gives them in its emulator ([`tools/libretro/ppsspp.patch`](../../../tools/libretro/ppsspp.patch)): each block handed over as its channel, its volumes, its format, how many samples and their bytes, and each block of 64 the console mixes. A PlayStation Portable game's sound is proven by its sound list and by every sample the kit mixes being the original's ([How sound is compared](../../../tools/README.md#how-sound-is-compared)). The mixed blocks are what makes the time a block is handed over part of the list.

## What it doesn't do yet

The graphics chip's display lists, the Allegrex's own instructions, its floating-point unit and its vector unit, and the system's functions by their numbers are still to come ([#1926](https://github.com/NahuelGenchi/dreamports/issues/1926)). Of the system's functions there are the ones above and no others: no semaphores, event flags, mutexes, message boxes, callbacks or interrupts, no files, no memory blocks, no modules loaded after the first, no sound decoders and no network. A thread's stack isn't in the console's memory, so a game that reads its own stack's address, or what the system leaves on it, doesn't find the original's. The sound channel for a rate of a game's choice (`sceAudioSRC`) and the second output aren't there. A memory of 32 MB, as a game from a disc has, isn't told apart from the 64 MB a program run from its file gets, which only what the system places from the top of the memory would show.

What comes due while a game's own code runs comes one cycle after its time, as it does in the emulator after an instruction that isn't a branch. Under the original it comes two after when the instruction that reaches it is a branch, which runs with the one after it: a twin can't know which, and it shows only where a game asks the time to the microsecond on that cycle.

## How it's checked

`npm run test:psp-kit` writes the small program of [`tools/test/made-up-psp.mjs`](../../../tools/test/made-up-psp.mjs) as a Dreamport in C ([`psp-kit/main.c`](../../../tools/test/psp-kit/main.c)) and proves it against the console's real emulator. The program paints its framebuffer, moves a square, plays a square wave from a second thread a block at a time, and shows what the system answers as bars: the number the system gave its thread, the buttons, the stick, and the system's time in microseconds twice a frame, which is a different width as soon as anything is 222 cycles early or late. Its Dreamport says how many cycles each stretch of the program's instructions took. All 300 frames have to be the same, pixel for pixel, with every sample the console mixes and everything given to the channels in the frame it was given. What `new` writes, a square a shade off, a first block of sound handed over 64 samples' time late and a thread a microsecond late are each found, the last two by nothing but the kit's time. A second recording holds each button and each way of the stick in turn: all 300 frames match, and a Dreamport that doesn't see one button, or never reads how far down the stick is, is found at the first frame it's held.

It isn't part of Check, as the emulator takes a long while to build. The PlayStation Portable's workflow runs it on Linux, on a Mac with Apple's chip and on Windows, for pull requests that touch the console's files ([Other consoles](../../../docs/CONSOLES.md#the-playstation-portable)).
