# The proof tools

[Back to README](../README.md) · [Contribution workflow](../CONTRIBUTING.md) · [The Dreamport standard](../docs/STANDARD.md) · [Written in: #77](https://github.com/NahuelGenchi/dreamports/issues/77)

The proof tools show that each step of a Dreamport plays like the original game, so its progress is measured instead of guessed. They play the same button presses in the original and in the Dreamport, compare every frame, work out the game's [%](../docs/STANDARD.md#how-progress-is-measured) and make short clips of both side by side. They run on your own computer, with your own copy of the game, and everything they take from the game stays there.

You start each one from a terminal in the repository's folder, with `npm run dp -- <tool>`. `npm run dp` on its own lists them.

| Tool | What it does |
| :--- | :--- |
| `setup` | Builds the reference emulator the original runs in |
| `rom` | Checks a copy of a game, says which game and which version it is, and remembers where it is |
| `play` | Opens a game in a browser with your copy, and with `--record` keeps what you play as a recording |
| `prove` | Plays each recording in the original and in the Dreamport, compares every frame, and updates the % |
| `codemap` | Makes the code map: every function in the original, with its address and size |
| `share` | Publishes a preview of a game on GitHub Pages from your own fork, and with `--post` posts in the game's progress thread |

For now they work with Game Boy Advance games, and they have only been tried on Linux.

## What you need

You need Node.js and the repository's packages, as [running the site on your computer](../CONTRIBUTING.md#run-the-site-on-your-computer) explains, and Google Chrome, Chromium or Microsoft Edge. `share` also needs the [GitHub CLI](https://cli.github.com), signed in with `gh auth login`. If the tools don't find your browser, set `CHROME` to where it is. To build the reference emulator you also need git, CMake and a C compiler: on Debian or Ubuntu, `sudo apt install git cmake build-essential` installs them. On Windows, run the tools inside WSL (Windows Subsystem for Linux).

And you need your own copy of the game, made from your own cartridge: the version the Dreamport is built from, such as the USA version.

## Getting ready

`npm run dp -- setup` downloads the source code of [mGBA](https://mgba.io) 0.10.5 with git and builds it, along with a small program of the tools' own, [`gba/original.c`](gba/original.c), that runs the original a frame at a time. Both go in `.dreamports/gba/`, and it takes a few minutes the first time. If you already have mGBA 0.10.5's source code, `MGBA_SOURCE=<its folder> npm run dp -- setup` builds that instead of downloading it. `prove` runs the setup by itself if it hasn't been done.

mGBA is the reference: the original runs in it, on your computer only, so there's something to compare against. It's never part of a Dreamport and never runs on dreamports.net. It starts the game with its own stand-in for the console's start-up program, so no BIOS file is needed.

`npm run dp -- rom <file>` checks your copy. It says which game it is, which version, and whether it's the copy a Dreamport's proof uses, and it remembers where the file is, in `.dreamports/copies.json`, so the other tools find it. It only reads the file: it never copies it, changes it or sends it anywhere. Give it a folder and it checks every `.gba`, `.agb` or `.bin` file in it. On its own, `npm run dp -- rom` lists the copies it remembers.

## Recording play

`npm run dp -- play <game> --record <name>` opens the game in a browser window, ready to press Play. Nothing is saved in that window, so the game starts from power-on, the way the original does. Play with the keyboard or a controller, then close the window, and the buttons you held at every frame are written to `games/<game>/proof/recordings/<name>.json`. A recording's name has lowercase letters, numbers and single dashes, such as `act-1`. Without `--record`, `play` just opens the game with your copy, and keeps its saves for next time.

A recording holds nothing from the game, only button presses, so it lives in the game's folder and goes in a commit, and anyone with their own copy can play it again. Write what it plays in its `about`. Its other fields:

- `frames`: how many frames it lasts.
- `held`: the buttons held, as a list of changes. `[120, ["A"]]` means A is held from frame 120 until the next change. Buttons have the console's names (`A`, `B`, `SELECT`, `START`, `RIGHT`, `LEFT`, `UP`, `DOWN`, `R` and `L`), or the Dreamport's own name for a button the console doesn't have, after which the original can't match.
- `onlyInOriginal` (optional): stretches of play the original has and the Dreamport doesn't have yet, such as a menu nobody has made. Each gives `at`, the Dreamport's frame where it goes in, its length in `frames`, the buttons `held` during it, counted from its own start, and an `about`. The original plays them and the Dreamport skips them, so the frames after still line up.
- `clip` (optional): the frames the clip shows, from frame `at`, for `frames` frames.

Sonic Advance Dreamport's [first act](../games/sonic-advance/proof/recordings/neo-green-hill-act-1.json) is an example: it skips the character select, which the Dreamport doesn't have yet.

## Proving

`npm run dp -- prove <game>` plays every recording of the game in the original and in the Dreamport, both from power-on, and compares every frame, pixel for pixel, in the console's own colours. Add recordings' names after the game's to play only those. The Dreamport runs in a browser you don't see, a frame at a time, through its kit's proof mode ([the Game Boy Advance kit's](../kit/gba/README.md#for-the-proof-tools)). Sonic Advance Dreamport's first act, 3,300 frames, takes about a minute.

For each recording it says how many frames were the same and which first differs: the frame, how many pixels differ, and the box they're in. It lists every stretch of frames that differs. It also compares with the last time the recording was proven: frames that differ now where they matched then are listed apart, with the first of them, which is usually the one a change just broke. If any frame differs, `prove` ends with an error, so a script that runs it stops. Frames are numbered as the Dreamport counts them. The console shows each frame's work one frame later, and `prove` lines the two up.

Its results go in `.dreamports/results/<game>/<recording>/`:

- `report.json`: everything it found.
- `first-difference.png`: the first frame that differs, as the original, the Dreamport, and the original in grey with every pixel that differs in magenta.
- `first-new-difference.png`: the same, for the first frame that differs where it matched last time.
- `clip.mp4`, with `clip-start.png`, `clip-middle.png` and `clip-end.png`, pictures of its first, middle and last frames.
- `dreamport.mp4`, the same frames of the Dreamport on its own, with nothing of the original, and `dreamport.png`, its middle frame. It's the clip `share` posts.

The clip shows the original and the Dreamport side by side, with the frame's number, and *differs* over frames that don't match. It holds every frame, about 60 a second, made inside the browser rather than filmed from a screen, so it's smooth and its pixels stay sharp. It shows the frames the recording's `clip` names, or else the four seconds before the first difference and the second after it, or else the recording's last five seconds. It's an H.264 MP4 video under 2 MB, which phones and browsers play.

The clips and the pictures show the game, so they stay in `.dreamports/`, which the ignore rules keep out of commits. [Clips](../docs/STANDARD.md#clips) in the standard says where they may be shared: `share` posts the Dreamport's on its own, and clips of the original wait for [#82](https://github.com/NahuelGenchi/dreamports/issues/82).

## The code map and the %

The code map, `games/<game>/proof/code-map.json`, lists every function in the original program with its address and its size, and nothing of its code. `npm run dp -- codemap <game>` makes one by finding the functions in your copy itself, following the code from where the game starts. A decompilation knows its functions better, and `npm run dp -- codemap <game> --from <list>` takes them from a list: what `nm -S` prints from the decompilation's ELF file, or a CSV with columns for the address and the size, such as the list of functions Ghidra exports. A function listed without a size gets the space up to the next one.

The % is the size of the functions that ran in recorded play where every frame of both versions matched, divided by the size of every function in the code map. `prove` notes which of the original's functions ran in each frame, keeps those that ran in frames that matched, and writes the % to `games/<game>/proof/progress.json`, with each recording's results. Recordings it didn't play this time count as they were last proven. It also says how many of the original's instructions ran outside every function of the code map: code the map is missing, or code the game copies into the console's memory before running it.

## Sharing a preview

`npm run dp -- share <game>` publishes a preview of the game as it is in your last commit, on GitHub Pages from your own fork, at `https://<you>.github.io/dreamports/<game>/`, so anyone can play it with their own copy without waiting for a review. `--as <name>` names the preview, to keep more than one. With `--post --about "<what changed>"` it also posts in the game's progress thread in this repository's Discussions: what changed, the newest `dreamport.mp4` that `prove` made (or the file `--clip` names), the % from `progress.json` and the preview's link. It asks before it publishes, before it switches Pages on for your fork the first time, and before it posts, and `--yes` answers yes for you. [Previews and progress threads](../docs/PREVIEWS.md) explains what a preview holds, what it risks for players, and how the threads work.

## A game's proof folder

What the tools keep in the repository is in the game's `proof/` folder, and it's all JSON. The ignore rules keep anything else out of it.

| File | What it holds |
| :--- | :--- |
| `original.json` | The copy the proof uses: its console, its name, the title and code in its header, and its SHA-1 checksum |
| `recordings/` | Recorded play, one file per recording |
| `code-map.json` | The code map |
| `progress.json` | The %, and each recording's results, written by `prove` |

## What stays on your computer

Everything else the tools keep is in `.dreamports/`, in the repository's folder, which the ignore rules keep out of commits: where your copies are, the reference emulator, every result with its pictures and clips, and the browser profiles the tools use. Deleting it is safe, as `setup` and `rom` make it again.

## For a game on the Game Boy Advance kit

A game made on [the Game Boy Advance kit](../kit/gba/README.md) works with the tools when its page calls `proof?.watch(screen, input)`, as the kit's guide shows, and keeps the kit's start screen, where the tools give it the copy and press Play. Its screen has to be the console's 240 by 160 pixels while the tools play it. Games with more than one player on a page aren't supported yet.
