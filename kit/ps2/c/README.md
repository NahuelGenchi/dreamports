# PlayStation 2 kit in C

[Back to the kits in C](../../c/README.md) · [Other consoles](../../../docs/CONSOLES.md) · [The Dreamport standard](../../../docs/STANDARD.md) · [Written in: #618](https://github.com/NahuelGenchi/dreamports/issues/618)

This folder is the PlayStation 2's kit for games written in C, on what [every console's kit in C](../../c/README.md) shares. A game writes the console's graphics chip, the GS, as its original does, and does its float sums as the console's processor, the EE, does them. What it writes each frame is its **draw list**, which is what a 3D game is proven by ([How progress is measured](../../../docs/STANDARD.md#how-progress-is-measured)), and the kit draws that list for the page.

Like the rest of the kits it's under [GPL-3.0-or-later](../LICENSE), and nothing from any game is in it. It's written from how the console is documented to behave.

## What's in it

| File | What it does |
| :--- | :--- |
| `ps2.h` | What a game sees of the console: the GS's registers by name, `gs_write`, `gs_image` and `gs_screen` to write them, `gs_show` to paint the page's picture, and the EE's sums |
| `gs.c` | The GS: its registers, each frame's draw list, and the drawing of the list into its own memory, in software |
| `ee.c` | The EE's float sums, each cut towards zero |
| `ps2.c` | What the page calls to start the game, run its frames, draw them and hear them, and to ask for a frame's draw list |
| `ps2-kit.h` | What those files share, which a game doesn't need |

## Writing a game on it

A game includes `"ps2.h"` and defines the four functions every game in C does ([A game on a console with no kit of its own](../../c/README.md#a-game-on-a-console-with-no-kit-of-its-own)). `npm run dp -- new <game>/c` writes a starting point that shows a blue screen through the GS.

`gs_write(reg, value)` writes one of the GS's registers, as a GIF packet's address and data does: `GS_PRIM`, `GS_RGBAQ`, `GS_XYZ2` and the rest. `gs_image(data, length)` sends it a picture's data. `gs_screen(address, value)` writes half of one of the registers that say what the screen shows, at the address the EE sees it. `game_draw` calls `gs_show()`.

**The draw list.** Everything a game writes in a frame is hashed in the order written, the same way the proof tools hash what the original gives the GS in its emulator ([`tools/libretro/play.patch`](../../../tools/libretro/play.patch)): each register write as its register and its 64 bits, each picture's bytes, and each half written of PMODE, SMODE2, DISPFB and DISPLAY. A game whose `proof/original.json` says `"provenBy": "draw lists"` is compared by that hash, frame for frame, where another game is compared by its picture. So the order matters as much as the values: a game writes what its original writes, when it writes it. What a game writes in `game_start`, as it sets up its screen, is in no frame's list.

**The EE's sums.** The EE cuts each float result towards zero, where a computer and WebAssembly round to the nearest. A model turned with plain `+` and `*` has a corner a sixteenth of a pixel out within a hundred frames, and its draw list parts from the original's there. So a game does its sums with `ee_add`, `ee_sub` and `ee_mul`, and turns a float into a whole number with `ee_to_int`.

## What it doesn't do yet

The draw list is whole: anything a game writes is in it. What the kit draws of it is not. It draws sprites and triangles, as lists, strips and fans, in one colour or shaded between their corners, into a 32-bit framebuffer, inside the scissor, with the depth test and a 32-bit depth buffer. It doesn't yet draw textures, so a textured shape comes out in its corners' colours, nor blending, fog, the other pixel formats, points or lines. A sprite is drawn as the emulator draws it, pixel for pixel. A shaded triangle isn't: on the test's 3D program about a tenth of the still triangle's pixels are a step of colour away from the emulator's.

The EE's divisions and square roots, its sums that overflow, and the tiny floats it has none of aren't done its way yet. The second processor's sums, the vector units', and the console's sound aren't here either: a game makes its own sound, as on a console with no kit of its own.

## How it's checked

`npm run test:ps2-kit` writes the two small programs of [`tools/test/made-up-ps2.mjs`](../../../tools/test/made-up-ps2.mjs) as Dreamports in C ([`made-up-ps2.c`](../../../tools/test/made-up-ps2.c)) and proves them against the console's real emulator. The one in three dimensions is proven by its draw list, all 300 frames, and one that does a sum with a computer's rounding is found, at frame 81. The flat one is proven by its pictures, pixel for pixel. It isn't run on every pull request, as the emulator takes minutes to build, and it runs on Linux alone ([Other consoles](../../../docs/CONSOLES.md#the-playstation-2)).
