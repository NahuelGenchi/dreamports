# PlayStation 2 kit in C

[Back to the kits in C](../../c/README.md) · [Other consoles](../../../docs/CONSOLES.md) · [The Dreamport standard](../../../docs/STANDARD.md) · [Written in: #618](https://github.com/NahuelGenchi/dreamports/issues/618)

This folder is the PlayStation 2's kit for games written in C, on what [every console's kit in C](../../c/README.md) shares. A game writes the console's graphics chip, the GS, as its original does, and does its float sums as the console's processor, the EE, does them. What it writes each frame is its **draw list**, which is what a 3D game is proven by ([How progress is measured](../../../docs/STANDARD.md#how-progress-is-measured)), and the kit draws that list for the page.

Like the rest of the kits it's under [GPL-3.0-or-later](../LICENSE), and nothing from any game is in it. It's written from how the console is documented to behave.

## What's in it

| File | What it does |
| :--- | :--- |
| `ps2.h` | What a game sees of the console: the GS's registers by name, `gs_write`, `gs_image` and `gs_screen` to write them, `gs_read_image` to read a picture back, `gs_show` to paint the page's picture, and the EE's sums |
| `gs.c` | The GS: its registers, each frame's draw list, and the drawing of the list into its memory, in software, textures and blending too |
| `gs-memory.c` | The GS's memory, laid out in pages, blocks and columns as the chip lays out each format, pictures moved into it, out of it and within it, and the palette buffer |
| `gs-kit.h` | What the GS's files share |
| `gif.c` | The GIF: packets, as a game or a vector unit program builds them, turned into the GS's register writes |
| `ee.c` | The EE's float sums, each cut towards zero, with its division and square root |
| `vu.c` | The vector units' sums, four floats at a time, on the fields an instruction names |
| `ps2.c` | What the page calls to start the game, run its frames, draw them and hear them, and to ask for a frame's draw list |
| `ps2-kit.h` | What those files share, which a game doesn't need |

## Writing a game on it

A game includes `"ps2.h"` and defines the four functions every game in C does ([A game on a console with no kit of its own](../../c/README.md#a-game-on-a-console-with-no-kit-of-its-own)). `npm run dp -- new <game>/c` writes a starting point that shows a blue screen through the GS.

`gs_write(reg, value)` writes one of the GS's registers, as a GIF packet's address and data does: `GS_PRIM`, `GS_RGBAQ`, `GS_XYZ2` and the rest. `gs_image(data, length)` sends it a picture's data. `gs_screen(address, value)` writes half of one of the registers that say what the screen shows, at the address the EE sees it. `game_draw` calls `gs_show()`.

**Pictures read back.** A game that reads a picture back from the GS, as a screenshot or a buffer used as data does, starts the transfer as on the console, BITBLTBUF's source, TRXPOS, TRXREG and TRXDIR = 1, and takes its bytes with `gs_read_image(data, length)`, as VIF1's DMA does once BUSDIR is 1. They come in the console's order, each pixel's bits after the last's, so a 24-bit picture is three bytes a pixel and a 4-bit one two pixels a byte.

**Packets.** A game that builds GIF packets, as nearly every real one does, hands them over as they are: `gif_send(data, bytes)` as a DMA transfer to the GIF does, and `gif_packet(data, most)` for one packet to the tag that ends it, as a vector unit program's XGKICK does. The kit turns each tag's PACKED, REGLIST or IMAGE data into the GS's writes the way the console's GIF does, so the draw list is the same as the original's, down to the Q an ST leaves for the next RGBA and the corners written without drawing.

**Vector unit 1.** On a real game nearly everything drawn comes from programs on vector unit 1: 99.9% of The Sims' writes on a 3D screen (#1282). A Dreamport writes such a program again in C, an instruction a line, with `vu_vector` for its registers and `vu_add`, `vu_madd`, `vu_mulf`, `vu_ftoi` and the rest for its sums, each on the fields its instruction names (`VU_XYZ`, `VU_XYZW`). An instruction that takes one field, Q or I, such as MULAx or MULq, is the `f` form with that float. DIV is `ee_div`, SQRT `ee_sqrt`.

**The draw list.** Everything a game writes in a frame is hashed in the order written, the same way the proof tools hash what the original gives the GS in its emulator ([`tools/libretro/play.patch`](../../../tools/libretro/play.patch)): each register write as its register and its 64 bits, each picture's bytes, and each half written of PMODE, SMODE2, DISPFB and DISPLAY. A game whose `proof/original.json` says `"provenBy": "draw lists"` is compared by that hash, frame for frame, where another game is compared by its picture. So the order matters as much as the values: a game writes what its original writes, when it writes it. The kit also keeps each frame's whole list, up to 16 MB, which `prove` compares with the original's to say which write of a frame differs ([Proving](../../../tools/README.md#proving)). What a game writes in `game_start`, as it sets up its screen, is in no frame's list.

**The EE's sums.** The EE cuts each float result towards zero, where a computer and WebAssembly round to the nearest. A model turned with plain `+` and `*` has a corner a sixteenth of a pixel out within a hundred frames, and its draw list parts from the original's there. So a game does its sums with `ee_add`, `ee_sub` and `ee_mul`, and turns a float into a whole number with `ee_to_int`.

## What it doesn't do yet

The draw list is whole: anything a game writes is in it. What the kit draws of it is most of what a game's screens need, not all of it.

**Its memory.** The GS's 4 MB are kept as the chip keeps them: 8 KB pages, each 32 blocks of 256 bytes, each block 4 columns, with every format's pixels in its own order in each, 32, 24 and 16-bit colours, 32, 24 and 16-bit depths, and 8 and 4-bit indices, alone or in a 32-bit pixel's top byte. So a buffer written in one format and read in another holds what the console's would, as a game's own picture used as a texture, a depth buffer read as colours or a palette in a picture's corner do.

**What it draws.** Sprites and triangles, as lists, strips and fans, in one colour or shaded between their corners, into a framebuffer of 32, 24 or 16 bits, with a depth buffer of 32, 24 or 16 bits, inside the scissor. Pictures move into its memory as a game sends them, out of it and from one place in it to another, in the order TRXPOS's DIR says. Textures are 32, 24 or 16-bit, or 8 or 4-bit with a 32 or 16-bit palette, which TEX0 or TEX2 loads into the palette buffer as its CLD says, from a block or a row, into the place CSA names. A texture is placed by whole texels or by floats over Q, sampled nearest or between the four nearest as TEX1 says, meets its edges in the four ways CLAMP says, and meets the shape's colour by any of the four texture functions, with TEXA giving 24 and 16-bit texels their alpha. Pixels go through the depth test, the alpha test with what's written of one that fails, the test of the framebuffer's alpha, and blending, with PABE, FBA, COLCLAMP and the framebuffer's mask.

**Matched pixel for pixel.** Sprites, flat or textured: at their size, larger, repeating, by floats, with 8 and 4-bit palettes, as a decal, blended, and with the alpha test, into a 16-bit framebuffer. The memory's layout: pictures moved in in nine formats and read as textures in eight, and as pictures read back in eight, three of them depths, palettes of 32 and 16 bits in blocks and in a row, in the buffer's places and loaded by every CLD. A shaded triangle isn't: on the test's 3D program about a tenth of the still triangle's pixels are a step of colour away from the emulator's. A texture sampled between texels isn't either, as the emulator's graphics card weighs them its own way.

**Not drawn yet.** Fog, dithering, smaller copies of a texture (mipmaps), points and lines. **Not checked yet**, as the emulator can't do them exactly: a copy from one place in memory to another, the 16-bit depth's layout, and a picture the GS drew read as a texture in another format or read back, which the emulator keeps on its graphics card. The kit does them by the same layout, which is proven everywhere else.

Sums that overflow aren't done the console's way yet, and RSQRT, the clip test, the flags a sum sets and the units' integer sums aren't in `vu.c` yet. The interface that feeds vector unit 1, the VIF, isn't here: a Dreamport writes the unit's program again and fills its packets itself, so it needs only what the program does, not how its data got there. A SIGNAL written while the GS hasn't been asked about the last holds the console's GIF up, which the kit doesn't. The second processor and the console's sound aren't here either: a game makes its own sound, as on a console with no kit of its own.

## How it's checked

`npm run test:ps2-kit` writes the two small programs of [`tools/test/made-up-ps2.mjs`](../../../tools/test/made-up-ps2.mjs) as Dreamports in C ([`made-up-ps2.c`](../../../tools/test/made-up-ps2.c)) and proves them against the console's real emulator. The one in three dimensions is proven by its draw list, all 300 frames, and one that does a sum with a computer's rounding is found, at frame 81. The one whose square a program on vector unit 1 turns, divides by its depth and kicks to the GS as a PACKED packet is proven by its draw list too, all 300 frames, its Dreamport being that program written again in C with `vu_*` and `gif_packet`, and one that divides with a computer's rounding is found at once. With the 3D Dreamport's one sum done a computer's way, `prove` names the write that differs at frame 81: write 20 of 24, the turning triangle's first corner, a sixteenth of a pixel across from the original's. The textured one sends its textures, palettes and sprites as packets, and its Dreamport sends the same through the kit, so its pictures, proven pixel for pixel on all 300 frames, are the kit's drawing against the emulator's: with the palette's layout broken it differs at once. The flat one is proven by its pictures, pixel for pixel.

`npm run test:ps2-gs` does the same for the programs of [`tools/test/made-up-ps2-gs.mjs`](../../../tools/test/made-up-ps2-gs.mjs), each a list of steps its Dreamport in C does through the kit ([`made-up-ps2-gs.c`](../../../tools/test/made-up-ps2-gs.c)), proven by draw list and by pictures, all 300 frames. The memory programs move pictures in in one format and read them in others, as textures into a 32-bit framebuffer and a 16-bit one, and read 32 by 32 pixels back in eight formats every frame, which go back in as pictures, so the draw list holds every byte read: one whose Dreamport doesn't read back differs at once. They come in two because the emulator widens a 16-bit colour to 32 bits its own way, and so draws a 16-bit colour exactly only into a 16-bit framebuffer.

They aren't part of Check, as the emulator takes minutes to build, and they run on Linux and macOS alone, where the Mac workflow runs them on GitHub's Mac with Apple's chip for pull requests that touch the PlayStation 2's files ([Other consoles](../../../docs/CONSOLES.md#the-playstation-2)).
