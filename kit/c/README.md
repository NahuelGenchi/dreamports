# The kits in C

[Back to README](../../README.md) · [Other consoles](../../docs/CONSOLES.md) · [The Dreamport standard](../../docs/STANDARD.md) · [Written in: #613](https://github.com/NahuelGenchi/dreamports/issues/613)

This folder is what every console's kit in C shares, so a game can be written in C on any console in [`kit/consoles.js`](../consoles.js). A game in C runs in the browser with nothing to install: it's built to WebAssembly, and its page is the one every console's games share, with the same start screen, settings, controller drawn on touch screens and proof mode. The same C also builds for a computer, with no browser.

A console with a kit in C of its own builds on this one, as the Game Boy Advance's does in [`kit/gba/c/`](../gba/c/README.md), which draws and plays as the console's hardware does. A game on any other console stands on this alone, and draws its own picture at its own size, and makes its own sound, as a JavaScript game on such a console does ([Other consoles](../../docs/CONSOLES.md)).

Like the rest of the kits it's under [GPL-3.0-or-later](LICENSE), and nothing from any game is in it.

## What's in it

| File | What it does |
| :--- | :--- |
| `kit.h`, `kit.c` | The player's copy, the save memory, the words of the page's address, memory for the game and the picture the page shows, and what the page calls to give the game the copy and the words |
| `page.h` | What a kit uses to meet the page, which a game doesn't need |
| `libc.c` | The few C library functions the compiler calls on its own, as WebAssembly has no C library |
| `game.js` | The page's side: it loads the game's WebAssembly, hands it the copy, the save memory and the words, and plays sound on an audio thread of its own. A console's kit builds on it, and `loadGame` runs a game on a console with none |
| `console.c` | A game on a console with no kit in C of its own: what the page calls to start it, run its frames, draw them and hear them |
| `worklet.js` | That game's sound on its audio thread: the samples each frame made, played as they come |
| `native.c` | That game on a computer: it plays a list of button presses, with the words of a start point if it's given them, and writes every frame, and its sound if asked, for tests |

## A game on a console with no kit of its own

A game includes `"console.h"`, which the build writes from `kit/consoles.js`, so the two always agree, and nothing of it is kept in the repository. It holds the console's screen as `SCREEN_W` and `SCREEN_H`, its frame as `CONSOLE_FRAME_TICKS` ticks of a clock of `CONSOLE_CLOCK` a second, its sound's rate as `CONSOLE_SOUND_RATE`, and its buttons as bits, `BUTTON_A` and the rest, one for each in `kit/consoles.js`, in its order.

It defines four functions. `game_start()` runs once, with the player's copy in `kit_copy`, `kit_copy_size` bytes. `game_step(buttons)` runs every frame, with the buttons held. `game_draw()` draws the last frame the page ran, into `kit_screen(width, height)`, which gives the picture's words at the size the game shows now, red in the lowest byte and 0xFF above blue, as an ImageData holds them. A game that changes its size partway, as its original does, gives `kit_screen` the new size. `game_sound(left, right, count)` fills `count` samples of what plays next, each -1 to 1, which start as silence. The proof tools hear the samples a frame's time holds after each frame, at the console's rate, and a player hears the same samples, on an audio thread that plays them as they come.

`kit_save(size)` gives the save memory with what the browser kept of it, and `kit_save_write()` keeps it, when the original writes it. `kit_start_point(name)` and `kit_start_number(name, absent)` read the words of the page's address, and so a recording's [start point](../../tools/README.md#start-points), as the page's `URLSearchParams` and `Number` read them. `kit_alloc(size)` gives memory that lasts as long as the page.

Its folder, `games/<game>/c/`, holds its page and its code, with its C in `src/`: `src/main.c` and any other `.c` files there. `src/main.js` is the page's script, which is the JavaScript starting point's with `loadGame()` from `game.js` in place of the game's own code, and it runs `src/game.wasm`. `npm run dp -- new <game>/c` writes that starting point on any console, from `startingFiles(game, original, { language: 'c' })` in [`tools/lib/new-game.mjs`](../../tools/lib/new-game.mjs), whose `main.c` paints the screen blue at the game's size, and green while a button is held, as the JavaScript one does.

## How it's built

`buildGame(folder)` in [`tools/lib/c.mjs`](../../tools/lib/c.mjs) builds `src/game.wasm` from the game's C and its console's kit, which it takes from the console the game's `proof/original.json` names: this folder, with the console's own kit on top where it has one. It uses Clang and its linker built as WebAssembly themselves, from npm ([`@yowasp/clang`](https://yowasp.org)), so `npm ci` is all it needs, the same on every computer. `buildNative()` builds the same C for the computer it runs on, with that computer's C compiler, the one the proof tools already need. `game.wasm` isn't kept in the repository: the site builds it as it copies the games, `share` as it makes a preview, and the proof tools before they open one.

## How it's checked

`npm run test:game` tries the starting point in C on every console in `kit/consoles.js`, in a real browser: the start screen, the keys, a controller, the settings and the touch screen. `npm run test:consoles` writes a game in C for the made-up console, which does what the JavaScript one does, and proves it against the console's emulator as it proves the JavaScript one, every frame, picture and sound, from power-on and from a start point. `npm run test:c-kit` builds the same game for the computer and as WebAssembly, and fails on any frame or sample that differs, besides what it checks of the Game Boy Advance's kit.
