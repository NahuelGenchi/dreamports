# Game Boy Advance kit in C

[Back to the kit](../README.md) · [The Dreamport standard](../../../docs/STANDARD.md) · [Written in: #595](https://github.com/NahuelGenchi/dreamports/issues/595)

This folder is the [Game Boy Advance kit](../README.md) for games written in C. It holds the same hardware layer as the JavaScript kit, and draws every frame to the same pixel, so a game can move between the two languages with nothing else changing. A game in C still runs in the browser with nothing to install: it's built to WebAssembly, and its page is the JavaScript kit's, with the same start screen, settings, controller drawn on touch screens, achievements and proof mode. The same C also builds for a computer, with no browser.

Like the rest of the kit it's under [GPL-3.0-or-later](../LICENSE), and nothing from any game is in it.

## What's in it

| File | What it does |
| :--- | :--- |
| `gba.h` | What a game sees of the console: VRAM, the colours, OAM and the display registers, the buttons, the player's copy, the save memory and memory of its own |
| `video.c` | The video hardware's drawing, written from [`video.js`](../video.js) a function at a time, so it draws as mGBA does too |
| `kit.c` | The player's copy, the save memory, memory for the game, and what the page calls to run it |
| `libc.c` | The few C library functions the compiler calls on its own, as WebAssembly has no C library |
| `game.js` | The page's side: it loads the game's WebAssembly, hands it the copy and the buttons, and gives the page the `video` and `step` a JavaScript game gives it |
| `native.c` | The game on a computer: it plays a list of button presses and writes every frame, for tests |

The widescreen view, the mosaic and the OBJ window aren't drawn in C yet, and the sound isn't in C yet ([#604](https://github.com/NahuelGenchi/dreamports/issues/604)). A game that needs one adds it here and to the JavaScript kit alike.

## A game in C

A game defines two functions. `game_start()` runs once, with the player's copy in `gba_rom`, and `game_step(keys)` runs every frame, with the buttons held as the console's KEYINPUT bits, a bit set for each button down. Each frame it writes the video hardware, `gba_vram`, `gba_pal`, `gba_oam` and the registers through `gba_write`, as the original does, and the kit draws the frame once the step is over. `gba_on_hblank()` gives the kit a function to run after each line, for a game that changes registers between lines. `gba_save(size)` gives the cartridge's save memory with what the browser kept of it, and `gba_save_write()` keeps it, when the original writes it.

Its folder is a game's folder like any other, with its C in `src/`: `src/main.c` and any other `.c` files there, which include the kit as `"gba.h"`. `src/main.js` is the page's script, which is the JavaScript starting point's with `loadGame()` from `game.js` in place of the game's own code, and it runs `src/game.wasm`. `startingFiles(game, original, { language: 'c' })` in [`tools/lib/new-game.mjs`](../../../tools/lib/new-game.mjs) writes that starting point, whose `main.c` paints the backdrop blue, and green while a button is held, as the JavaScript one does.

`buildGame(folder)` in [`tools/gba/c.mjs`](../../../tools/gba/c.mjs) builds `src/game.wasm` from the game's C and the kit's. It uses Clang and its linker built as WebAssembly themselves, from npm ([`@yowasp/clang`](https://yowasp.org)), so `npm ci` is all it needs, the same on every computer. `buildNative()` builds the same C for the computer it runs on, with that computer's C compiler, the one the proof tools already need. `game.wasm` isn't kept in the repository. How a game's C version sits beside its JavaScript one, and how dreamports.net builds it, are [#596](https://github.com/NahuelGenchi/dreamports/issues/596)'s.

## How it's checked

`npm run test:c-kit` draws 400 made-up scenes, with every mode, layer, window, colour effect and kind of sprite, and H-blanks that change registers and colours between lines, with `video.c` built for the computer and as WebAssembly, and with `video.js`, and fails on any pixel that differs. `SEED` and `SCENES` choose other scenes, and a failure names the scene to draw again. Then it builds the C starting point and plays 240 frames of made-up presses, on the computer and in Chrome a frame at a time as the proof tools play a game, and fails on any frame whose picture or video hardware differs from the JavaScript starting point's. It also checks that the save memory lasts from one run, and one visit, to the next. `npm run test:game` tries the C starting point's page as it tries the JavaScript one's: the start screen, the keys, a controller, the settings and the touch screen.
