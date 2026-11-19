# The player's copy, in pieces

[Back to README](../../README.md) · [Other consoles](../../docs/CONSOLES.md) · [The tools](../../tools/README.md) · [Written in: #615](https://github.com/NahuelGenchi/dreamports/issues/615)

This folder reads a player's copy of a disc a few sectors at a time, as the game asks for them, so a disc of several gigabytes, as a PlayStation 2 game's is, never has to be in a browser's memory, or a computer's. The page reads it from the file the player chose, which stays on their device, and the tools read it from the file on their computer, with the same code. Nothing here unpacks a copy into another file.

Like the rest of the kits it's under [GPL-3.0-or-later](LICENSE), and nothing from any game is in it. It's written from each format's description; nothing of the programs that make or read them is copied.

## What's in it

| File | What it does |
| :--- | :--- |
| `disc.js` | `openDisc(source)`: a disc, from an ISO, a BIN with or without its `.cue`, a CHD, a CSO or a ZSO. Each gives the same disc: its tracks, its sectors as the console's drive reads them, the data on them, and the copy's bytes as the image it was made from holds them, for its SHA-1 |
| `iso9660.js` | The files on a disc, by name, and which console it's for, from its `SYSTEM.CNF` or `UMD_DATA.BIN` |
| `cd.js` | A CD's sectors as a drive reads them whole, 2352 bytes: the sync, header, subheader, EDC and ECC that a copy keeping only data, as an ISO does, leaves out, made again |
| `chd.js` | MAME's CHD, versions 3, 4 and 5, a hunk at a time, with every codec chdman uses: zlib, LZMA, Huffman, FLAC, and their CD forms. zstd is read where Node can undo it, the tools, and not in a browser |
| `cso.js` | CSO, versions 1 and 2, and ZSO, a block at a time |
| `lzma.js`, `flac.js`, `huffman.js`, `inflate.js` | The decoders those need, in plain JavaScript, so a browser needs nothing else |
| `source.js` | A File or Blob read in pieces, keeping the last few it read |
| `page.js` | A disc on a Dreamport's page: `openCopy(file, others)` opens the File the player chose, with a `.cue`'s tracks from the files chosen with it, and `sha1Of(files)` works out which version it is on a thread of its own, and keeps the answer in the browser for that file |
| `hash-worker.js`, `sha1.js` | That thread, and SHA-1 a piece at a time, as the browser's own hashes only what it has whole |

## How it's used

A source is `{ name, size, read(at, length) }`, where `read` resolves to the bytes from `at`. `blobSource(file)` makes one from the File a player chose or dropped, and the tools make one from a file on the computer (`fileSource` in [`tools/lib/read-copy.mjs`](../../tools/lib/read-copy.mjs)). `openDisc(source, { open })` resolves to the disc, or to null when the file isn't one, `open(name)` giving a `.cue`'s tracks from beside it.

A disc's sectors are counted as its drive counts them, from 0 at 00:02:00 on a CD. `disc.read(lba, count)` gives them as the drive reads them, 2352 bytes each on a CD and 2048 on a DVD or a UMD, and `disc.data(lba, count)` the 2048 bytes of data of each. `disc.tracks` are each track's number, its type (`mode1`, `mode2` or `audio`), its first sector, its pregap and its length, and `disc.layerBreak` is where a DVD's second layer starts. `disc.image()` gives the copy's bytes as the image it was made from keeps them: the ISO for a CSO or a CHD of a DVD, and each track's BIN for a CHD of a CD, sound the right way round, so the same disc has the same SHA-1 whichever file it's in.

## On a Dreamport's page

A console whose games come on discs (`disc` in [`kit/consoles.js`](../consoles.js)) gets a start screen whose row for the copy takes a disc's File as it is, never reading it whole ([`rom-setup.js`](../gba/ui/rom-setup.js)'s `pieces`), and a game in C gets its sectors through [`kit/c/disc.h`](../c/README.md#the-players-disc): after each call the page makes, it reads the sectors the game asked for and hands them over, and a frame that needs one it doesn't have yet pauses until it's there. A game in JavaScript reads them itself, with `await disc.read(lba, count)` or `await disc.data(lba, count)`. Which version a copy is shows a moment after it's chosen, once a thread of its own has read the whole disc, and the game can start before that.

A disc over 256 MB, or one in several files, isn't kept in the browser between visits, as a ROM is: copying gigabytes into the browser's storage would fill the device for nothing, so the player adds it again on their next visit ([#1606](https://github.com/NahuelGenchi/dreamports/issues/1606)).

## How it's checked

`node --test tools/test/copies.test.mjs`, part of `npm run check`, makes a disc of the project's own, with nothing from any game in it ([`made-up-disc.mjs`](../../tools/test/made-up-disc.mjs)), in every kind of file, each CHD codec tried at least once, and checks that each gives the same console, the same SHA-1, the same files and the same sectors, a CD's made again exactly as a BIN keeps them. It also reads a file 4 GB into a disc of 5 GB, which takes no room as the file system keeps its gaps as nothing.

On 19 November 2026 two more checks ran on one computer, which aren't part of the tests as they need programs and a copy that aren't in the repository. libchdr, the BSD-licensed reader most emulators use, read the made-up CHDs, versions 4 and 5, every hunk's CRC passing, to the same bytes as `chd.js`. And the LZMA SDK's encoder, set as chdman sets it, compressed 40 MB of a real game's disc in 2,126 pieces, which `lzma.js` undid to the same bytes.

`npm run test:big-copy` plays a made-up PlayStation 2 disc of 5 GB, kept by the file system as nothing but its few written sectors, on a Dreamport in C ([`big-copy.c`](../../tools/test/big-copy.c)), given to the page through its file input as a player gives it, in Chrome, in Firefox and in WebKit, the engine Safari is built on, where WebKitGTK is installed, on Linux. Each frame reads a sector far from the last, one past 4 GB in and one at the very end, and shows its colour; a sector the page hasn't fetched pauses the frame until it has. On 19 November 2026, in Chrome 157, Firefox 160 and WebKitGTK 2.52, every frame showed its sector's colour, the version check read all 5 GB on its own thread and found the version, and the browsers' processes grew by 69 MB in Chrome and 52 MB in Firefox while the game read the disc. A CSO and a CHD of a smaller disc played the same way, through the browsers' own decoders. A Mac's Safari hasn't been tried.
