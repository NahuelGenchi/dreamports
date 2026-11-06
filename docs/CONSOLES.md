# Other consoles

[Back to README](../README.md) · [The proof tools](../tools/README.md) · [The Dreamport standard](STANDARD.md)

A Dreamport can be of a game on any console, and the proof tools work the same way for each: the same recorded presses in the original and in the Dreamport, every frame compared, picture and sound. This page says what that rests on, how far each console has got, and what a console needs to be added.

## How a console is known

[`kit/consoles.js`](../kit/consoles.js) lists each console: its name, the size of its screen, how long a frame lasts, how many sound samples a second it mixes, the kinds of file a copy comes in, and its buttons. Games read it in the browser, and the tools read it too. [`tools/consoles.mjs`](../tools/consoles.mjs) adds what only the tools need: which emulator runs the original, and which of that emulator's buttons is each of the console's.

A game's `proof/original.json` names its console, and everything follows from that: `rom` tells a copy by what it holds, whichever console it's for, `prove` compares at that console's rate and frame time, and at the game's screen, `capture` opens a window with its buttons, and `new` starts a game on it.

A game that chooses its own screen says so in the same file, as `"screen": [256, 224]`, or as a list when it changes partway, `"screen": [[320, 224], [256, 224]]`, the size it starts at first. With none it's the console's size in `kit/consoles.js`. A Game Boy Advance game has no say, as its screen never changes.

## What runs the original

The Game Boy Advance runs in mGBA, as it always has ([Getting ready](../tools/README.md#getting-ready)). Every other console runs in a libretro core, a small emulator with one way of being driven, through [`tools/libretro/host.c`](../tools/libretro/host.c), a program of the tools' own that gives them the same pictures, sound and memory that mGBA's does.

The first time a game on a console needs its core, the tools fetch it from its makers' source, at a fixed commit, and build it on the contributor's computer, once. So everyone gets the same pictures, and the project publishes no programs of its own. Each runs with the settings that keep it the same for everyone, in `tools/consoles.mjs`, and with nothing saved from one run to the next. A console that can't start without a BIOS would find one a person has from their own console in `.dreamports/libretro/system/<console>/`, and nothing in the project helps get one. Gambatte and PCSX ReARMed are set to go without, so that a person's BIOS doesn't change what they show. A made-up file there does change Gambatte's frames when that setting is off. PCSX ReARMed's setting comes from reading its source, as no real BIOS has been tried.

## How far each console has got

| Console | Emulator | Where it stands |
| :--- | :--- | :--- |
| Game Boy Advance | mGBA | Used for real games |
| A made-up console | [`tools/test/made-up-core.c`](../tools/test/made-up-core.c) | `npm run test:consoles` plays a whole game on it, on every pull request |
| NES | FCEUmm | `npm run test:real-console` builds the real emulator and proves a small program of the project's own on it, every frame of picture and sound, from presses written out and from a recording made with `play`, the same each time, on every pull request. [Mega Man Dreamport](../games/mega-man/) in C, on the NES's kit in C, proves its title screen on the owner's copy, every frame, picture and sound |
| Super Nintendo, Game Boy, Game Boy Color, Mega Drive, PlayStation, Nintendo 64 | Snes9x, Gambatte, Genesis Plus GX, PCSX ReARMed, Parallel N64 | Each built and run with a small program, twice, the same both times, its numbers checked against `kit/consoles.js`. `prove` hasn't compared anything on them yet |
| PlayStation 2, PlayStation Portable | None yet | Their emulators draw with a graphics context, which `host.c` doesn't offer yet, and the tools say so |

The first game on a console is what proves it. When a console's numbers are wrong the tools say which, such as an emulator mixing another number of samples a second than `kit/consoles.js` says, or running at another speed.

## What the real emulators showed

These are the numbers each emulator gave for a small program, once it had set up its screen.

| Console | Frames a second | Sound samples a second | Screen | Save state | Work memory |
| :--- | :--- | :--- | :--- | :--- | :--- |
| NES | 60.0998 | 48,000 | 256 by 240 | 14 KB | 2 KB |
| Game Boy, Game Boy Color | 59.7275 | 32,768 | 160 by 144 | 27 KB | 8 KB |
| Super Nintendo | 60.0988 | 32,040 | 256 by 224 | 823 KB | 128 KB |
| Mega Drive | 59.9227 | 44,100 | 320 by 224 | 1 MB | 64 KB |
| PlayStation | 60 | 44,100 | 320 by 240 | 4.5 MB | 2 MB |
| Nintendo 64 | 60.02 | The game's choice, heard at 44,100 | 640 by 240 | 17 MB | 8 MB |

**Screens.** An emulator may not show the whole screen unless told to, as FCEUmm cuts the NES's to 224 lines, which is why it has settings for that. A game can also choose its own size: a Mega Drive game can use 256 or 320 across, a PlayStation game many sizes, and a Nintendo 64 game can show twice the lines. Such a game lists its sizes in its `proof/original.json`. Each frame is compared at the size it has, so it can change partway, and the same pixels in another shape are another picture. `prove` stops when the original shows a size the game doesn't list, and gives the line to write, leaving out frames only the original has, as nothing compares them. When the Dreamport's picture is another size than the original's, `prove` says at which frame. The stills and clips `prove` makes have room for the largest width and height listed, with a smaller picture filled with black on the right and below. A capture is cut to the size its moment shows, so no band of black reaches a game's card, and `capture` stops only at a picture too large for what the game lists, which would lose its edges. Genesis Plus GX showed a small program at 256 by 224 and then 320 by 224 as it chose, with 256 by 192 on its very first frame, which nothing compares. So far only the made-up console has proved a game at its own size.

**Names and regions.** FCEUmm reads a copy's region from words anywhere in its path, so `Games (a)/program (E).nes` ran as a European copy, at 50 frames a second. The tools now give an emulator the copy under a plain name of their own, except a disc's `.cue`, which names its tracks from where it is. A copy that really is for another region's consoles stops with a sentence saying so, as `prove` knows a region only by a frame's length.

**Sound.** A real console's sound isn't a clean wave. The NES's waves only ever go up from zero, and FCEUmm's filter then makes a thump in the lowest bands when a note stops, loud enough for `prove` to notice, so a Dreamport has to make that sound too. A Nintendo 64 game chooses its own rate, so `host.c` follows the emulator's notice of it and hears the sound at the kit's rate, on a straight line between samples. `prove` compares loudness by bands, so that's near enough, though the highest band loses a little.

**Frames.** On FCEUmm a game's frame shows in the next one, as `prove` assumes, and so does its sound. The others ran only a program that does nothing to show it.

**Save states and work memory.** Nothing in the tools uses a save state, and `prove --state` says it can't compare on these consoles, so their sizes don't matter yet. A start point writes to work memory as the emulator keeps it. Going by their source, Genesis Plus GX keeps it in pairs of bytes swapped and Parallel N64 in fours, so a whole word lands as it should and a lone byte needs its address changed. Only the NES has tried a start point.

**Buttons.** The NES's were pressed in a recording. The Mega Drive's and Nintendo 64's agree with their emulators' source, and the rest are still only as chosen.

**Building.** Each builds with a compiler and `make` alone. Parallel N64 is built with no recompiler and no OpenGL, so it needs no assembler or graphics libraries, and runs on its interpreter.

## What's different from the Game Boy Advance

A few things the tools do rest on mGBA, and stay with it for now.

Code ported counts only the port map's names on another console, as a libretro core doesn't say which of the original's functions ran. So its number rises as the Dreamport's code names functions from its code map, and a recording doesn't add to it.

The tools find the functions themselves in Game Boy Advance and NES code. On any other console the code map comes from a list, with `codemap --from`, a decompilation's symbols or a disassembler's list of functions. `read` knows only the Game Boy Advance's instructions, and on another console a disassembler on the person's own computer does that job. What it prints stays there, by the same rules as `read`. `prove --state` compares what the console holds through the kit's video, so on another console it says that it can't, and the picture and sound are still compared.

**NES addresses.** An NES game's program is in banks of 16 KB. On the cartridges the tools read, NROM, MMC1, UNROM and CNROM, the last bank is always at $C000-$FFFF, and the cartridge switches any of the others in at $8000-$BFFF, so an address there means nothing until the bank is known. The code map numbers each function by its offset in the program, past the file's 16-byte header: bank n's $8000 is n × 0x4000, so $923F in bank 4 is `0001123F`, and $C39C in the last of Mega Man's 8 banks is `0001C39C`. A game's code names a function as a label with its bank: `sub_04_923F` is $923F with bank 4 switched in, the bank in two hexadecimal digits, and `sub_C39C`, with no bank, is in the last one. A program of 32 KB or less never switches, so a label there needs no bank anywhere. The port map works out how many banks there are from the code map, as the last always has code. A list for `codemap --from` gives each address as an offset in the program or as such a label.

[`tools/nes/functions.mjs`](../tools/nes/functions.mjs) finds the functions by following the code from the three vectors at the end of the last bank, through every call, branch and jump. Code in a switched bank sees itself at $8000. Code in the last bank sees what its caller left there, or what it switched in itself, by writing a number it loaded to the cartridge or by calling a routine that writes the number it's given. An address at $8000 reached with no bank known is taken in the one bank where it reads as code, if that bank has code already. It also follows the three ways NES games jump through a table: a list of addresses after a JSR to a routine that pulls its own return address off the stack and reads the list, two tables of low and high bytes pushed before an RTS, and a pointer built from a table for JMP ($xx). Last, it takes what reads as code between the functions of a bank that has some. On Mega Man (USA) it found 483 functions in 27,489 bytes, in banks 4 to 7, where a plain walk from the vectors found about 15 KB. Nothing has checked it against a disassembly of the game, so it can still miss code only a table it doesn't follow leads to.

In JavaScript there's no kit of its own for another console yet. A game starts on what's general in `kit/gba/`, its start screen, input, clock, settings and touch screen, as `npm run dp -- new` writes it, drawing its own picture at the game's size, which `createGame` can change by giving `size`, and giving `proof?.listen` how long its frame lasts. What a second game on a console turns out to share becomes that console's kit, `kit/<console>/`. A game in C on another console starts on what every console's kit in C shares, [`kit/c/`](../kit/c/README.md), the same way: `npm run dp -- new <game>/c` writes it, drawing its own picture at the game's size and making its own sound at the console's rate, with the console's buttons as bits in `console.h`, which the build writes from `kit/consoles.js`. On the NES it starts on the NES's kit in C, [`kit/nes/c/`](../kit/nes/c/README.md), the console's picture and sound hardware, and draws and plays by writing that hardware as its original does. A copy larger than a browser can hold in memory, as a disc can be, would need its own way of being read, which nobody has written.

## Adding a console

Add it to `kit/consoles.js` and to `CORES` in `tools/consoles.mjs`, with a core whose source is at a fixed commit and whose license lets anyone build it, the settings that make it the same on every computer, and what tells a copy of its games in `tools/lib/read-copy.mjs`. Then make a game's first recording and run `prove`, which checks the numbers.
