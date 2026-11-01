# The proof tools

[Back to README](../README.md) · [Contribution workflow](../CONTRIBUTING.md) · [The Dreamport standard](../docs/STANDARD.md) · [Written in: #77](https://github.com/NahuelGenchi/dreamports/issues/77)

The proof tools show that each step of a Dreamport plays like the original game, so its progress is measured instead of guessed. They play the same button presses in the original and in the Dreamport, compare every frame, work out the game's [two numbers](../docs/STANDARD.md#how-progress-is-measured), code ported and gameplay proven, and make short clips of both side by side. They run on your own computer, with your own copy of the game, and everything they take from the game stays there.

You start each one from a terminal in the repository's folder, with `npm run dp -- <tool>`. `npm run dp` on its own lists them.

| Tool | What it does |
| :--- | :--- |
| `setup` | Builds the reference emulator the original runs in |
| `rom` | Checks a copy of a game, says which game and which version it is, and remembers where it is |
| `play` | Opens a game in a browser with your copy, and with `--record` keeps what you play as a recording, after another recording's presses with `--from` |
| `prove` | Plays each recording in the original and in the Dreamport, compares every frame, updates the numbers, and with `--stills` keeps pictures of the frames you name |
| `codemap` | Makes the code map: every function in the original, with its address and size |
| `portmap` | Makes the port map: each function of the original the Dreamport's code names, and where |
| `share` | Publishes a preview of a game on GitHub Pages from your own fork, with the newest clip for the step's pull request |
| `find` | Shows where a game stands: its lead, its two numbers, its team build, who has claimed which task, and the tasks still free |
| `team` | The game's team build, the lead's branch with the team's finished pieces: `start` makes it, `join` starts a piece from it, `send` sends a piece to the lead, and `add` proves a piece and takes it in |
| `readme` | Writes the README's table of Dreamports, with each one's numbers and lead, from their [entries](../games/README.md#the-entry), and each one's progress map |
| `commands` | Writes the `/dreamport` commands, from `tools/commands/`, in the form each coding agent reads |

For now they work with Game Boy Advance games, and they have only been tried on Linux.

## What you need

You need Node.js and the repository's packages, as [running the site on your computer](../CONTRIBUTING.md#run-the-site-on-your-computer) explains, and Google Chrome, Chromium or Microsoft Edge. `share`, `find` and `team` also need the [GitHub CLI](https://cli.github.com), signed in with `gh auth login`. If the tools don't find your browser, set `CHROME` to where it is. To build the reference emulator you also need git, CMake and a C compiler: on Debian or Ubuntu, `sudo apt install git cmake build-essential` installs them. On Windows, run the tools inside WSL (Windows Subsystem for Linux).

And you need your own copy of the game, made from your own cartridge: the version the Dreamport is built from, such as the USA version.

## Getting ready

`npm run dp -- setup` downloads the source code of [mGBA](https://mgba.io) 0.10.5 with git and builds it, along with a small program of the tools' own, [`gba/original.c`](gba/original.c), that runs the original a frame at a time. Both go in `.dreamports/gba/`, and it takes a few minutes the first time. If you already have mGBA 0.10.5's source code, `MGBA_SOURCE=<its folder> npm run dp -- setup` builds that instead of downloading it. `prove` runs the setup by itself if it hasn't been done.

mGBA is the reference: the original runs in it, on your computer only, so there's something to compare against. It's never part of a Dreamport and never runs on dreamports.net. It starts the game with its own stand-in for the console's start-up program, so no BIOS file is needed.

`npm run dp -- rom <file>` checks your copy. It says which game it is, which version, and whether it's the copy a Dreamport's proof uses, and it remembers where the file is, in `.dreamports/copies.json`, so the other tools find it. It only reads the file: it never copies it, changes it or sends it anywhere. Give it a folder and it checks every `.gba`, `.agb` or `.bin` file in it. On its own, `npm run dp -- rom` lists the copies it remembers.

## Recording play

`npm run dp -- play <game> --record <name>` opens the game in a browser window, ready to press Play. Nothing is saved in that window, so the game starts from power-on, the way the original does. Play with the keyboard or a controller, then close the window, and the buttons you held at every frame are written to `games/<game>/proof/recordings/<name>.json`. A recording's name has lowercase letters, numbers and single dashes, such as `act-1`. Without `--record`, `play` just opens the game with your copy, and keeps its saves for next time.

`--from <recording>` starts the new recording with another recording's presses, so a part later in the game can be recorded without playing everything before it again. Press Play and the game first plays them, at its own speed and with your buttons doing nothing, then it's your turn, and the terminal says when. `--from <recording>:<frame>` plays them up to that frame only, so `--from act-1:2100` takes over at frame 2100 of `act-1`. The new recording keeps those presses, and the stretches only the original has among them, so it still starts from power-on and `prove` plays it like any other.

A recording can also be written by hand, as a list of presses, which suits a part played with nothing pressed, such as logos and an intro left alone. Sonic Advance Dreamport's [logos and intro](../games/sonic-advance/proof/recordings/logos-and-intro.json) is one: A on the language screen, then nothing.

A recording holds nothing from the game, only button presses, so it lives in the game's folder and goes in a commit, and anyone with their own copy can play it again. Write what it plays in its `about`. Its other fields:

- `frames`: how many frames it lasts.
- `held`: the buttons held, as a list of changes. `[120, ["A"]]` means A is held from frame 120 until the next change. Buttons have the console's names (`A`, `B`, `SELECT`, `START`, `RIGHT`, `LEFT`, `UP`, `DOWN`, `R` and `L`), or the Dreamport's own name for a button the console doesn't have, after which the original can't match.
- `onlyInOriginal` (optional): stretches of play the original has and the Dreamport doesn't have yet, such as a menu nobody has made. Each gives `at`, the Dreamport's frame where it goes in, its length in `frames`, the buttons `held` during it, counted from its own start, and an `about`. The original plays them and the Dreamport skips them, so the frames after still line up.
- `clip` (optional): the frames the clip shows, from frame `at`, for `frames` frames.

Sonic Advance Dreamport's [first act](../games/sonic-advance/proof/recordings/neo-green-hill-act-1.json) is an example: it skips the character select, which the Dreamport doesn't have yet.

## Proving

`npm run dp -- prove <game>` plays every recording of the game in the original and in the Dreamport, both from power-on, and compares every frame, pixel for pixel, in the console's own colours. Add recordings' names after the game's to play only those. The Dreamport runs in a browser you don't see, a frame at a time, through its kit's proof mode ([the Game Boy Advance kit's](../kit/gba/README.md#for-the-proof-tools)). Sonic Advance Dreamport's first act, 3,300 frames, takes about a minute.

For each recording it says how many frames were the same and which first differs: the frame, how many pixels differ, and the box they're in. It lists every stretch of frames that differs, and the stretches where the original's screen is one colour, as it is between one screen and the next, which helps find where each of the game's parts starts and ends. For each part the recording proves in `parts.json`, it says whether every frame of it matched. At the end it gives the game's two numbers as they are now. It also compares with the last time the recording was proven: frames that differ now where they matched then are listed apart, with the first of them, which is usually the one a change just broke. If any frame differs, `prove` ends with an error, so a script that runs it stops. Frames are numbered as the Dreamport counts them. The console shows each frame's work one frame later, and `prove` lines the two up. A game that reads its buttons just after the V-blank, rather than just before it as most do, reads each frame's buttons in the frame `prove` counts as the next one: `"keysAfterVBlank": true` in its `original.json` gives the original its buttons a frame later, so the two still line up. Sonic Battle is one.

Its results go in `.dreamports/results/<game>/<recording>/`:

- `report.json`: everything it found.
- `first-difference.png`: the first frame that differs, as the original, the Dreamport, and the original in grey with every pixel that differs in magenta.
- `first-new-difference.png`: the same, for the first frame that differs where it matched last time.
- `clip.mp4`, with `clip-start.png`, `clip-middle.png` and `clip-end.png`, pictures of its first, middle and last frames.
- `dreamport.mp4`, the same frames of the Dreamport on its own, with nothing of the original, and `dreamport.png`, its middle frame. `share` posts `clip.mp4`, and this one when asked with `--clip`.
- `stills/`, a picture of both at each frame `--stills` names, such as `--stills 249,250` or `--stills 900-905`, up to 600 at a time, and at each part's first and last frames, with the one before and the one after. Each is `frame-<frame>.png`, with where the two differ when they do.

The clip shows the original and the Dreamport side by side, with the frame's number, and *differs* over frames that don't match. It holds every frame, about 60 a second, made inside the browser rather than filmed from a screen, so it's smooth and its pixels stay sharp. It shows the frames the recording's `clip` names, or else the four seconds before the first difference and the second after it, or else the recording's last five seconds. It's an H.264 MP4 video under 2 MB, which phones and browsers play.

The clips and the pictures show the game, so they stay in `.dreamports/`, which the ignore rules keep out of commits. [Clips](../docs/STANDARD.md#clips) in the standard says where they may be shared: clips of the original in pull requests and nowhere else, and clips of the Dreamport alone anywhere.

## The code map and the two numbers

The code map, `games/<game>/proof/code-map.json`, lists every function in the original program with its address and its size, and nothing of its code. It's the first thing a new Dreamport needs, before any of its code, as [the standard](../docs/STANDARD.md#how-progress-is-measured) asks: write the game's `original.json` from what `rom` says about your copy, run `rom` again so the tools know it's the copy the proof uses, then make the code map, and commit both with the game's first files. `npm run dp -- codemap <game>` makes one by finding the functions in your copy itself, following the code from where the game starts. A decompilation knows its functions better, and `npm run dp -- codemap <game> --from <list>` takes them from a list: what `nm -S` prints from the decompilation's ELF file, or a CSV with a column for the address and one for the size, such as the list of functions Ghidra exports, or for the end, the address just after the function's last byte, as decompilations list their functions' extents. A function listed without either gets the space up to the next one.

Each Dreamport shows two numbers, code ported and gameplay proven, which [the standard](../docs/STANDARD.md#how-progress-is-measured) explains. The tools write what both are measured with.

`prove` notes which of the original's functions ran in each frame, keeps those that ran in frames that matched, and writes them to `games/<game>/proof/progress.json`, with each recording's results: how many frames it has, which ones differ, and the share of the code map's size those functions make. Recordings it didn't play this time count as they were last proven. It also says how many of the original's instructions ran outside every function of the code map: code the map is missing, or code the game copies into the console's memory before running it. Then it writes the README's table of Dreamports and the progress maps again, with the new numbers.

`npm run dp -- portmap <game>` writes the port map, `games/<game>/proof/port-map.json`: each function of the original that the game's code names, with the first file and line that names it, and every name that lands inside a function of the code map but not at its start, which is usually a mistake. A name is an address in the cartridge, written as a number, such as `0x08029E78`, or as a label, such as `sub_8029E78`, or `FUN_08029E78` as Ghidra writes them. An address outside every function of the code map is the game's data, such as a picture the code copies, and isn't counted or listed. A number is an address in the copy the proof uses. A label is one in the release the game's labels come from, and when that's another release, the game's `proof/names.json` says how far each stretch of its code is from the copy's. Sonic Advance Dreamport's code uses the labels of a decompilation built from the European release, and [its `names.json`](../games/sonic-advance/proof/names.json) gives the shifts to the USA release. Run it after changing the game's code; `npm run check` says when a port map is out of date.

Code ported is the size of the functions the port map names and those `prove` found running in matching play, divided by the size of every function in the code map. Gameplay proven is the share of the parts in `games/<game>/proof/parts.json` that a recording proves: every frame from the part's first to its last matched, with none the Dreamport doesn't have. The game's page, the launcher and the README show both, and the site checks that they add up with the files before it shows them, so they only ever come from the tools. The tools also draw each game's progress map from the same files, with [`src/lib/progress-map.mjs`](../src/lib/progress-map.mjs): a picture of every function in the code map and every part, green once it counts. They keep it in `.github/readme/progress/<game>.svg`, which the README's table links, and write it whenever they write the table. It's only shown on GitHub, never on the site.

## Proving a part

A part, such as a game's logos or one of its acts, is proven by a recording that plays the whole of it, from its first frame to its last, so a recording that skips any of it with Start doesn't prove it. It may end with a press that moves the game on, the way a player leaves it: Sonic Advance Dreamport's title screen is frames 902 to 1252 of `neo-green-hill-act-1`, which ends it with Start, as left alone it would move on to a demo the Dreamport doesn't have yet. These steps prove one:

1. Make a recording that plays the whole part and a little of what comes after it, with `play --record`, with `play --record --from` to start where another recording reaches the part, or by hand.
2. Run `npm run dp -- prove <game> <recording>` and read the stretches where the original's screen is one colour. A part usually starts as one of them ends and ends as the next one does. Where the screen is one colour between two parts, as when one fades out and the next fades in, those frames go with the part before, so the next part starts on the first frame that isn't one colour.
3. Check the frames you picked with `--stills`, such as `--stills 253,254,932,933`, and look at the pictures in `stills/`.
4. Write the part's `recording` and `frames` in `parts.json`, and run `prove` again. It says whether the part is proven, and keeps pictures of its first and last frames, with the one before and the one after, so the lead can check them once more.

Sonic Advance Dreamport's logos are frames 254 to 932 of [`logos-and-intro`](../games/sonic-advance/proof/recordings/logos-and-intro.json): the language screen fades to white until frame 253, and the Sonic Team logo fades to black, which stays until 932.

## Sharing a preview

`npm run dp -- share <game>` publishes a preview of the game as it is in your last commit, on GitHub Pages from your own fork, at `https://<you>.github.io/dreamports/<game>/`, so anyone can play it with their own copy without waiting for a review. `--as <name>` names the preview, to keep more than one. `--about "<what changed>"` puts a sentence of what changed on the preview's first page. Beside the preview, apart from it, goes the newest side-by-side `clip.mp4` that `prove` made (or the file `--clip` names), and `share` prints the lines that show it in the step's pull request. It posts nothing. It asks before it publishes and before it switches Pages on for your fork the first time, and `--yes` answers yes for you. [Previews](../docs/PREVIEWS.md) explains what a preview holds, what it risks for players, and where the clip goes.

## Claims and team builds

`npm run dp -- find <game>` shows where a game stands before you start on it: its lead, its two numbers, its Make page, its team build and team preview, who has claimed which task, and the tasks still free. It takes a game's folder or a few words of its name, and with no game it lists them all. The numbers come from `games/` in your folder, and the claims from this repository's issues.

`npm run dp -- team <game> start`, `join <branch>`, `send` and `add <pull request>` make and use the game's team build, a branch of the lead's fork that gathers the team's finished pieces. `add` merges a piece, runs `portmap` and `prove`, and only takes it in if nothing that matched the original before differs now, then updates the team preview with `share`. [Claims and teams](../docs/TEAMS.md) explains claims, tasks and team builds.

## The /dreamport commands

The README's [Make a Dreamport](../README.md#make-a-dreamport) teaches seven commands that a coding agent runs these tools with, such as `/dreamport-clip`, which runs `portmap` and `prove`. Each is written once, as a Markdown file in [`commands/`](commands/), with its name, its description and, for those that take one, what's typed after it. `/dreamport` also lists, as `pasted`, the sentences that start it when they're pasted into an agent, as the README gives them. `npm run dp -- commands` writes each in the form an agent reads:

- `.claude/skills/<name>/SKILL.md` for Claude Code, set to run only when typed (`disable-model-invocation`).
- `.agents/skills/<name>/SKILL.md` for Codex, with `agents/openai.yaml` turning off its implicit use. Cursor, Gemini CLI and Antigravity CLI read this folder too.
- `.gemini/commands/<name>.toml` for Gemini CLI's own commands.

Every copy starts the same way: it tells the agent to do nothing unless the person typed the command, or pasted one of its sentences, for the agents that might load it by themselves, and where what was typed after it is. A command's file can't hold `{{`, `!{`, `@{` or `'''`, which Gemini CLI would read as its own. `npm run check` runs `npm run dp -- commands --check`, which fails when a copy differs from its file, and removing a command's file and running the tool removes its copies.

## A game's proof folder

What the tools keep in the repository is in the game's `proof/` folder, and it's all JSON. The ignore rules keep anything else out of it.

| File | What it holds |
| :--- | :--- |
| `original.json` | The copy the proof uses: its console, its name, the title and code in its header, and its SHA-1 checksum, and `keysAfterVBlank` for a game that reads its buttons just after the V-blank |
| `recordings/` | Recorded play, one file per recording |
| `code-map.json` | The code map |
| `progress.json` | Each recording's results and the code that ran in matching play, written by `prove` |
| `port-map.json` | The port map: the functions the game's code names, and the names that land inside one but not at its start, written by `portmap` |
| `names.json` | Optional: how far the release the game's labels come from is from the copy's, stretch by stretch, for `portmap` |
| `parts.json` | The game's parts, each with the recording and frames that prove it once there are some, written by the game's lead |

## What stays on your computer

Everything else the tools keep is in `.dreamports/`, in the repository's folder, which the ignore rules keep out of commits: where your copies are, the reference emulator, every result with its pictures and clips, and the browser profiles the tools use. Deleting it is safe, as `setup` and `rom` make it again.

## For a game on the Game Boy Advance kit

A game made on [the Game Boy Advance kit](../kit/gba/README.md) works with the tools when its page calls `proof?.watch(screen, input)`, as the kit's guide shows, and keeps the kit's start screen, where the tools give it the copy and press Play. Its screen has to be the console's 240 by 160 pixels while the tools play it. Games with more than one player on a page aren't supported yet.
