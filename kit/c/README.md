# The kits in C

[Back to README](../../README.md) · [Other consoles](../../docs/CONSOLES.md) · [The Dreamport standard](../../docs/STANDARD.md) · [Written in: #613](https://github.com/NahuelGenchi/dreamports/issues/613)

This folder is what every console's kit in C shares, so a game can be written in C on any console in [`kit/consoles.js`](../consoles.js). A game in C runs in the browser with nothing to install: it's built to WebAssembly, and its page is the one every console's games share, with the same start screen, settings, controller drawn on touch screens and proof mode. The same C also builds for a computer, with no browser.

A console with a kit in C of its own builds on this one, as the Game Boy Advance's does in [`kit/gba/c/`](../gba/c/README.md) and the NES's in [`kit/nes/c/`](../nes/c/README.md), which draw and play as the console's hardware does, and the PlayStation 2's in [`kit/ps2/c/`](../ps2/c/README.md), which draws as its graphics chip is written. A game on any other console stands on this alone, and draws its own picture at its own size, and makes its own sound, as a JavaScript game on such a console does ([Other consoles](../../docs/CONSOLES.md)).

Like the rest of the kits it's under [GPL-3.0-or-later](LICENSE), and nothing from any game is in it.

## What's in it

| File | What it does |
| :--- | :--- |
| `kit.h`, `kit.c` | The player's copy, the save memory, the words of the page's address, memory for the game and the picture the page shows, and what the page calls to give the game the copy and the words |
| `page.h` | What a kit uses to meet the page, which a game doesn't need |
| `libc.c` | The few C library functions the compiler calls on its own, as WebAssembly has no C library |
| `pause.c` | `kit_wait_frame()` and `kit_run()`: ending a frame from anywhere in a game's C and going on from there in the next, for a game that waits for the screen from inside its functions as its original does ([the same-memory build](../../tools/README.md#the-same-memory-build)), and `kit_pause()`, pausing partway through a frame until the page has what the game waits for. A game that doesn't call them has none of it |
| `disc.h`, `disc.c` | The player's disc, read as the console's drive reads it, a few sectors at a time, on a console whose games come on discs ([The player's disc](#the-players-disc)) |
| `game.js` | The page's side: it loads the game's WebAssembly, hands it the copy, the save memory and the words, and plays sound on an audio thread of its own. A console's kit builds on it, and `loadGame` runs a game on a console with none |
| `console.c` | A game on a console with no kit in C of its own: what the page calls to start it, run its frames, draw them and hear them |
| `worklet.js` | That game's sound on its audio thread: the samples each frame made, played as they come |
| `native.c` | That game on a computer: it plays a list of button presses, with the words of a start point if it's given them, and writes every frame, and its sound if asked, for tests |

## A game on a console with no kit of its own

A game includes `"console.h"`, which the build writes from `kit/consoles.js`, so the two always agree, and nothing of it is kept in the repository. It holds the console's screen as `SCREEN_W` and `SCREEN_H`, its frame as `CONSOLE_FRAME_TICKS` ticks of a clock of `CONSOLE_CLOCK` a second, its sound's rate as `CONSOLE_SOUND_RATE`, and its buttons as bits, `BUTTON_A` and the rest, one for each in `kit/consoles.js`, in its order.

It defines four functions. `game_start()` runs once, with the player's copy in `kit_copy`, `kit_copy_size` bytes. `game_step(buttons)` runs every frame, with the buttons held. `game_draw()` draws the last frame the page ran, into `kit_screen(width, height)`, which gives the picture's words at the size the game shows now, red in the lowest byte and 0xFF above blue, as an ImageData holds them. A game that changes its size partway, as its original does, gives `kit_screen` the new size. `game_sound(left, right, count)` fills `count` samples of what plays next, each -1 to 1, which start as silence. The proof tools hear the samples a frame's time holds after each frame, at the console's rate, and a player hears the same samples, on an audio thread that plays them as they come.

`kit_save(size)` gives the save memory with what the browser kept of it, or 0xFF in every byte the first time, as a cartridge never written holds, and `kit_save_write()` keeps it, when the original writes it. `kit_start_point(name)` and `kit_start_number(name, absent)` read the words of the page's address, and so a recording's [start point](../../tools/README.md#start-points), as the page's `URLSearchParams` and `Number` read them. `kit_alloc(size)` gives memory that lasts as long as the page.

Its folder, `games/<game>/c/`, holds its page and its code, with its C in `src/`: `src/main.c` and any other `.c` files there. `src/main.js` is the page's script, which is the JavaScript starting point's with `loadGame()` from `game.js` in place of the game's own code, and it runs `src/game.wasm`. `npm run dp -- new <game>/c` writes that starting point on any console, from `startingFiles(game, original, { language: 'c' })` in [`tools/lib/new-game.mjs`](../../tools/lib/new-game.mjs), whose `main.c` paints the screen blue at the game's size, and green while a button is held, as the JavaScript one does.

## The player's disc

A console whose games come on discs, the PlayStation, the PlayStation 2 and the PlayStation Portable (`disc` in `kit/consoles.js`), has `disc.c` in its kit as well, and a game reads its disc through `"disc.h"` as the console's drive gives it, however large it is. The page never holds the disc: it reads its sectors from the player's file as the game asks for them ([`kit/copy/`](../copy/README.md)), whether it's an ISO, a BIN and its `.cue`, a CHD or a CSO, and the kit keeps the last 4 MB of them.

`kit_disc_read(lba, count, from, size, to)` copies `count` sectors from `lba`, `size` bytes of each from byte `from` of the whole sector as the drive reads it: 2352 bytes on a CD, its sync at 0, its header at 12, a Mode 2 sector's subheader at 16 and data at 24, a Mode 1 sector's data at 16, and 2048 bytes on a DVD. What an ISO leaves out of a CD's sectors, their sync, header, subheader, EDC and ECC, is made again as the disc holds them. `kit_disc_kind()`, `kit_disc_sectors()`, `kit_disc_layer_break()` and `kit_disc_track(number)` give the disc's layout and table of contents, `kit_disc_q(lba, q)` the subchannel Q a CD's drive reads beside a sector, and `kit_disc_ahead(lba, count)` says the drive was told to seek there, so the page fetches those sectors between frames.

How long the console's drive takes to seek and read, in the console's time, is the console's kit's to count: `kit_disc_read` gives the bytes at once, as far as the game can tell. When the page hasn't fetched them yet, the game pauses partway through its frame with `kit_pause()`, the page fetches them, and calls the frame again, which goes on from where it paused, so nothing the game sees depends on how fast the player's computer reads. That pause is the same Asyncify wait as `kit_wait_frame()`, so a disc is read from code that runs under `kit_run()`, which returns 0 when it paused partway: `game_step` then returns at once, doing nothing it does after a frame, and a console's kit does its own work before and after the frame only when `kit_frame_paused()` says the frame isn't paused. A game that reads a disc runs as WebAssembly only, as one that waits from inside a function does.

## How it's built

`buildGame(folder)` in [`tools/lib/c.mjs`](../../tools/lib/c.mjs) builds `src/game.wasm` from the game's C and its console's kit, which it takes from the console the game's `proof/original.json` names: this folder, with the console's own kit on top where it has one. It uses Clang and its linker built as WebAssembly themselves, from npm ([`@yowasp/clang`](https://yowasp.org)), so `npm ci` is all it needs, the same on every computer. `buildNative()` builds the same C for the computer it runs on, with that computer's C compiler, the one the proof tools already need. `game.wasm` isn't kept in the repository: the site builds it as it copies the games, `share` as it makes a preview, and the proof tools before they open one. A build inside the repository's folder is left as it is while nothing it comes from has changed: the game's C, the kit's, how the compiler is asked and which compiler it is, which `.dreamports/c/built.json` remembers on that computer.

## Shared libraries

Code that many games of a console share without having written it, such as its maker's libraries, is written once as twins in a folder of its own, `lib/<name>/` in a console's kit in C, or `kit/c/lib/<name>/` for C that several consoles' games share. A game takes one through its `proof/libraries.json`, and its build links the library's C with its own ([Shared libraries](../../tools/README.md#shared-libraries)). The kit's own sources never include a library, so a game that takes none is built as before.

## How it's checked

`npm run test:game` tries the starting point in C on every console in `kit/consoles.js`, in a real browser: the start screen, the keys, a controller, the settings and the touch screen. `npm run test:consoles` writes a game in C for the made-up console, which does what the JavaScript one does, and proves it against the console's emulator as it proves the JavaScript one, every frame, picture and sound, from power-on and from a start point. `npm run test:c-kit` builds the same game for the computer and as WebAssembly, and fails on any frame or sample that differs, besides what it checks of the Game Boy Advance's kit.
