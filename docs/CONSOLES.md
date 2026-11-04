# Other consoles

[Back to README](../README.md) · [The proof tools](../tools/README.md) · [The Dreamport standard](STANDARD.md)

A Dreamport can be of a game on any console, and the proof tools work the same way for each: the same recorded presses in the original and in the Dreamport, every frame compared, picture and sound. This page says what that rests on, how far each console has got, and what a console needs to be added.

## How a console is known

[`kit/consoles.js`](../kit/consoles.js) lists each console: its name, the size of its screen, how long a frame lasts, how many sound samples a second it mixes, the kinds of file a copy comes in, and its buttons. Games read it in the browser, and the tools read it too. [`tools/consoles.mjs`](../tools/consoles.mjs) adds what only the tools need: which emulator runs the original, and which of that emulator's buttons is each of the console's.

A game's `proof/original.json` names its console, and everything follows from that: `rom` tells a copy by what it holds, whichever console it's for, `prove` compares at that console's size, rate and frame time, `capture` opens a window with its buttons, and `new` starts a game on it.

## What runs the original

The Game Boy Advance runs in mGBA, as it always has ([Getting ready](../tools/README.md#getting-ready)). Every other console runs in a libretro core, a small emulator with one way of being driven, through [`tools/libretro/host.c`](../tools/libretro/host.c), a program of the tools' own that gives them the same pictures, sound and memory that mGBA's does.

The first time a game on a console needs its core, the tools fetch it from its makers' source, at a fixed commit, and build it on the contributor's computer, once. So everyone gets the same pictures, and the project publishes no programs of its own. Each runs with the settings that keep it the same for everyone, in `tools/consoles.mjs`, and with nothing saved from one run to the next. A console that needs a BIOS finds one a person has from their own console in `.dreamports/libretro/system/<console>/`, and nothing in the project helps get one.

## How far each console has got

| Console | Emulator | Where it stands |
| :--- | :--- | :--- |
| Game Boy Advance | mGBA | Used for real games |
| A made-up console | [`tools/test/made-up-core.c`](../tools/test/made-up-core.c) | `npm run test:consoles` plays a whole game on it, on every pull request |
| NES, Super Nintendo, Game Boy, Game Boy Color, Mega Drive, PlayStation, Nintendo 64 | FCEUmm, Snes9x, Gambatte, Genesis Plus GX, PCSX ReARMed, Parallel N64 | Chosen and fixed at a commit, and not run yet: their screen, frame and sound numbers in `kit/consoles.js` still have to be checked against the emulators |
| PlayStation 2, PlayStation Portable | None yet | Their emulators draw with a graphics context, which `host.c` doesn't offer yet, and the tools say so |

The first game on a console is what proves it. When a console's numbers are wrong the tools say which, such as an emulator mixing another number of samples a second than `kit/consoles.js` says.

## What's different from the Game Boy Advance

A few things the tools do rest on mGBA, and stay with it for now.

Code ported counts only the port map's names on another console, as a libretro core doesn't say which of the original's functions ran. So its number rises as the Dreamport's code names functions from its code map, and a recording doesn't add to it.

The code map comes from a list, with `codemap --from`, a decompilation's symbols or a disassembler's list of functions, as the tools find functions only in Game Boy Advance code. `read` knows only the Game Boy Advance's instructions, and on another console a disassembler on the person's own computer does that job. What it prints stays there, by the same rules as `read`. `prove --state` compares what the console holds through the kit's video, so on another console it says that it can't, and the picture and sound are still compared.

There's no kit of its own for another console yet. A game starts on what's general in `kit/gba/`, its start screen, input, clock, settings and touch screen, as `npm run dp -- new` writes it, drawing its own picture at its console's size and giving `proof?.listen` how long its frame lasts. What a second game on a console turns out to share becomes that console's kit, `kit/<console>/`. A copy larger than a browser can hold in memory, as a disc can be, would need its own way of being read, which nobody has written.

## Adding a console

Add it to `kit/consoles.js` and to `CORES` in `tools/consoles.mjs`, with a core whose source is at a fixed commit and whose license lets anyone build it, the settings that make it the same on every computer, and what tells a copy of its games in `tools/lib/read-copy.mjs`. Then make a game's first recording and run `prove`, which checks the numbers.
