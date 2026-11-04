# The proof tools

[Back to README](../README.md) · [Contribution workflow](../CONTRIBUTING.md) · [The Dreamport standard](../docs/STANDARD.md) · [Written in: #77](https://github.com/NahuelGenchi/dreamports/issues/77)

The proof tools show that each step of a Dreamport plays like the original game, so its progress is measured instead of guessed. They play the same button presses in the original and in the Dreamport, compare every frame, what it shows and what it sounds like, work out the game's [two numbers](../docs/STANDARD.md#how-progress-is-measured), code ported and gameplay proven, and make short clips of both side by side. They run on your own computer, with your own copy of the game, and everything they take from the game stays there.

You start each one from a terminal in the repository's folder, with `npm run dp -- <tool>`. `npm run dp` on its own lists them.

| Tool | What it does |
| :--- | :--- |
| `setup` | Builds the reference emulator the original runs in |
| `rom` | Checks a copy of a game, says which game and which version it is, and remembers where it is |
| `play` | Opens a game in a browser with your copy, and with `--record` keeps what you play as a recording, after another recording's presses with `--from` |
| `prove` | Plays each recording in the original and in the Dreamport, compares every frame, its picture and its sound, says what the console holds that differs, updates the numbers, and with `--stills` keeps pictures of the frames you name |
| `capture` | Lets you play the original in a window, and keeps a real moment of it for the game's card, or with `--open`, `--pick` and `--from` does that while the game is being made, with nothing waiting for anyone |
| `codemap` | Makes the code map: every function in the original, with its address and size |
| `new` | Writes a claimed game's first files: its page, its code on the kit with everything wired in, its license and its entry |
| `portmap` | Makes the port map: each function of the original the Dreamport's code names, and where |
| `read` | Prints one of the original's functions, its instructions, from your copy, for code its decompilation has no C for |
| `share` | Publishes a preview of a game on GitHub Pages from your own fork, with the newest clip for the step's pull request |
| `find` | Shows where a game stands: its lead, its two numbers, its team build, who has claimed which task, the tasks free to start, and what the others wait on |
| `tasks` | Opens a Task issue for each of a game's foundations and parts that has none yet, its foundations first and then in the order a player meets them |
| `notes` | Shows what people found while making a game or its console's kit, so nobody has to find it again |
| `team` | The game's team build, the lead's branch with the team's finished pieces: `start` makes it, `join` starts a piece from it, `send` sends a piece to the lead, and `add` proves a piece and takes it in |
| `readme` | Writes the README's table of Dreamports, with each one's numbers and lead, from their [entries](../games/README.md#the-entry), and each one's progress map |
| `commands` | Writes the `/dreamport` command, from `tools/commands/`, in the form each coding agent reads |
| `ready` | Everything a step has to pass before it goes out, in one go: the port map, every recording, `npm run check` and the build, printing only what's wrong |
| `help` | Prints one section of these documents, the ones whose headings have the words you give, so that nobody has to read a whole one |

They've been used with real games only on the Game Boy Advance, and they work the same way for any other console, each in a small emulator built on your computer, as far as [Other consoles](../docs/CONSOLES.md) says. They've been used with real games only on Linux. On a Mac, Apple silicon or Intel, on Windows with only Node.js and git added, and on Windows inside WSL 2, `setup`, `rom`, `notes`, `read`, `play --record`, `prove` and `portmap` work as they do on Linux, with the same results to the last frame, as far as a small made-up program shows on GitHub's computers, with a script pressing the buttons in a real window. On Windows itself that's with Chrome and with Edge, on an account with no administrator's rights as well as on one with them, from a folder and with a copy whose names have spaces and letters from other languages, and `codemap` and `find` gave the same results too. Nobody has tried them there by hand, with a controller or with a real game. `share` hasn't published anything from any of them, and `team` hasn't gone past its first check.

## What you need

You need Node.js and the repository's packages, as [running the site on your computer](../CONTRIBUTING.md#run-the-site-on-your-computer) explains, and Google Chrome, Chromium or Microsoft Edge. `share`, `find` and `team` also need the [GitHub CLI](https://cli.github.com), signed in with `gh auth login`. If the tools don't find your browser, set `CHROME` to where it is. To build the reference emulator you also need git, CMake and a C compiler: on Debian or Ubuntu, `sudo apt install git cmake build-essential` installs them, and on a Mac, `xcode-select --install` and `brew install cmake`.

On Windows you need only [git](https://git-scm.com), and the Edge that comes with Windows is browser enough. `setup` gets a compiler, [w64devkit](https://github.com/skeeto/w64devkit), and [CMake](https://cmake.org) by itself, about 120 MB, each from the people who make it, at a fixed version and checked against its hash. It builds in `C:\ProgramData\dreamports-build`, since the compiler can't read a path with some languages' letters in it, which takes about a gigabyte for those minutes. Then it keeps the two programs it made and deletes the rest, so nothing gets installed. If PowerShell says running scripts is disabled when you run `npm`, write `npm.cmd` in its place.

You can also run the tools on Windows inside WSL 2 (Windows Subsystem for Linux), which `wsl --install` sets up, with everything above installed inside it, as on Linux, and Chrome from Google's own package. `play`'s window opens through WSL's own display. Keep the folder in Linux's home: under `/mnt/c` the tools work too, but installing and building take several times as long. WSL 1 can't run the browser.

And you need your own copy of the game, made from your own cartridge: the version the Dreamport is built from, such as the USA version.

## Getting ready

`npm run dp -- setup` downloads the source code of [mGBA](https://mgba.io) 0.10.5 with git and builds it, along with two small programs of the tools' own: [`gba/original.c`](gba/original.c), which runs the original a frame at a time, and [`gba/read.c`](gba/read.c), which prints its instructions for `read`. They go in `.dreamports/gba/`, and it takes a few minutes the first time. If you already have mGBA 0.10.5's source code, `MGBA_SOURCE=<its folder> npm run dp -- setup` builds that instead of downloading it. `prove` runs the setup by itself if it hasn't been done.

mGBA is the reference: the original runs in it, on your computer only, so there's something to compare against. It's never part of a Dreamport and never runs on dreamports.net. It starts the game with its own stand-in for the console's start-up program, so no BIOS file is needed.

`npm run dp -- rom <file>` checks your copy. It says which game it is, which version, and whether it's the copy a Dreamport's proof uses, and it remembers where the file is, in `.dreamports/copies.json`, so the other tools find it. It only reads the file: it never copies it, changes it or sends it anywhere. Give it a folder and it checks every `.gba`, `.agb` or `.bin` file in it, but names only the copies a Dreamport here measures against, and sums up the rest in one line. `--game "<name>"` names the copies of the game you're starting too, such as `npm run dp -- rom <folder> --game "Sonic Battle"`, when no Dreamport measures against it yet: a copy is that game when its header says the same name, or the start of it when the name is too long for a header's twelve characters, or when its file's name has the name's words in a row, not followed by a number, so Sonic Advance doesn't pick out Sonic Advance 2. It says which of the two it went by, along with what `original.json` needs. On its own, `npm run dp -- rom` lists the copies it remembers.

## Recording play

`npm run dp -- play <game> --record <name>` opens the game in a browser window, ready to press Play. Nothing is saved in that window, so the game starts from power-on, the way the original does. Play with the keyboard or a controller, then close the window, and the buttons you held at every frame are written to `games/<game>/proof/recordings/<name>.json`. A recording's name has lowercase letters, numbers and single dashes, such as `act-1`. Without `--record`, `play` just opens the game with your copy, and keeps its saves for next time.

`--from <recording>` starts the new recording with another recording's presses, so a part later in the game can be recorded without playing everything before it again. Press Play and the game first plays them, at its own speed and with your buttons doing nothing, then it's your turn, and the terminal says when. `--from <recording>:<frame>` plays them up to that frame only, so `--from act-1:2100` takes over at frame 2100 of `act-1`. The new recording keeps those presses, and the stretches only the original has among them, so it still starts from power-on and `prove` plays it like any other.

A recording can also be written by hand, as a list of presses, which is how `/dreamport` makes them, as nobody plays there, and which suits a part played with nothing pressed, such as logos and an intro left alone. Sonic Advance Dreamport's [logos and intro](../games/sonic-advance/proof/recordings/logos-and-intro.json) is one: A on the language screen, then nothing.

A recording holds nothing from the game, only button presses, so it lives in the game's folder and goes in a commit, and anyone with their own copy can play it again. Write what it plays in its `about`. Its other fields:

- `frames`: how many frames it lasts.
- `held`: the buttons held, as a list of changes. `[120, ["A"]]` means A is held from frame 120 until the next change. Buttons have the console's names (`A`, `B`, `SELECT`, `START`, `RIGHT`, `LEFT`, `UP`, `DOWN`, `R` and `L`), or the Dreamport's own name for a button the console doesn't have, after which the original can't match.
- `onlyInOriginal` (optional): stretches of play the original has and the Dreamport doesn't have yet, such as a menu nobody has made. Each gives `at`, the Dreamport's frame where it goes in, its length in `frames`, the buttons `held` during it, counted from its own start, and an `about`. The original plays them and the Dreamport skips them, so the frames after still line up. It can also have `sets`, as [Start points](#start-points) says.
- `start` (optional): what the Dreamport's address adds, as [Start points](#start-points) says.
- `clip` (optional): the frames the clip shows, from frame `at`, for `frames` frames.

Sonic Advance Dreamport's [first act](../games/sonic-advance/proof/recordings/neo-green-hill-act-1.json) is an example: it skips the character select, which the Dreamport doesn't have yet.

## Start points

A late part doesn't have to wait for everything before it. A recording can have a **start point**, so that the Dreamport opens right at the part and the original gets there by itself. Two things make one, and either can go without the other:

- `start` is what the Dreamport's address adds, such as `level=2&character=1`: words and values, which the game's own page reads. `prove` opens the game with them, and so does `npm run dp -- play <game> --record <name> --start level=2`.
- `sets`, in a stretch of `onlyInOriginal`, writes values to the original's work RAM as that stretch runs, such as which levels are unlocked: `[{ "frame": 9, "address": "03005168", "bytes": 1, "value": 2 }]`, with `frame` counted from the stretch's start, `address` in hexadecimal, as the code map has it, and `bytes` 1, 2 or 4. They can't reach the cartridge, and `prove` stops if one tries.

Write the presses and values that take the original to the part's first frame as a stretch of `onlyInOriginal`, at the frame where the Dreamport opens at the part, which is 0 when it opens there straight away. Then run `prove` and change the stretch's length until the frames line up. Its list of frames where the original's screen is one colour shows where each screen ends.

It's still all compared: every frame of the part, against the original, the same as any other. A part proven this way counts towards gameplay proven, and `prove`, `find`, the game's page and its progress map mark it as proven from a start point, as it could still differ once the game's real path reaches it. Once that path exists, a recording with no `start` or `sets` proves it again from power-on, and the mark goes.

**A start point only skips the way there.** What it plays has to be what a player could see at that place, and a match can't tell you that: the original does the same as the Dreamport when it's given the same values, so every frame can be the same in a recording nobody could ever play. Sonic Advance 2's first spring recordings left Sonic in the air as a stage opened, so its countdown ran while he fell and bounced, with its crouch on him in mid-air, its machine and its numbers following him, and on one spring the crouch covered his whole flight. So:

- The character starts where a player could have them: on the ground, unless the game's opening has gone and they're in the middle of something a player could be doing, such as a jump. To find the ground, try a height and see where they land.
- The game's own opening ends before they meet what the recording proves. That's anything that holds the buttons or sets an animation, such as a countdown or a title card.
- Look at it the way a player would, with `--stills` every second or so, before you call it done.

The tools hold a game to this where it can say so. In a frame no player could ever see, a game's code writes why to `dreamportsProof.neverInPlay`, as Sonic Advance 2's countdown does for a character a start point has left in the air. `prove` names those frames and fails, however they compare, it keeps them in `progress.json`, and `npm run check` and the build stop until the recording is played again without them, so a pull request with one can't pass its checks. Only a game's own code knows what its opening does, so a game whose opening holds its character adds this line itself ([the kit's README](../kit/gba/README.md#for-the-proof-tools) shows how). Keep it to what a start point can cause, as a real start must never be flagged.

A recording's start point is only words and numbers, so it goes in a commit and anyone can replay it. Save states stay out of this: they hold the game's memory, so they can't go in a commit, and nobody else could replay them.

## A game's capture

Every game's card in the launcher shows a few seconds of real play. `npm run dp -- capture <game>` makes a Dreamport's from the original, so a game can have one before its Dreamport has anything to play. It opens a window where you play your own copy, from power-on, with the keyboard or a controller, and hear it as you go. `/dreamport` opens it for you as soon as it starts on a game with no capture, and you can also ask your agent, so you run nothing yourself.

Press Finish, or `Esc`, or View and Menu together on a controller, and it picks out the best stretches of what you played: lively and colourful, with buttons held, and with no fades, logos, menus or text. They come up moving. Press the one you want with the mouse, with the arrows and `Z`, or with a controller's d-pad and A. `Esc` or B goes back to playing where you left off, and the next list comes from all of it.

What you choose becomes a few seconds that loop, as near to seamless as the game allows, in `public/media/`: `<game>-dreamport.h264.mp4` and `.av1.mp4`, silent, `-still.webp` and `-share.png`. The game's entry names them, as `screen` and `share`. Choose play, with no logos or title screens: these go in a commit, on to dreamports.net, and the Dreamports team looks at them in the game's pull request ([the rule](../docs/STANDARD.md#a-games-capture)).

With nobody playing for 30 seconds the window rests: the game waits, drawing and playing nothing, until a button is pressed, as `--open` can leave it open for as long as a game takes to make. What it keeps is only what was played.

Your presses stay in `.dreamports/captures/<game>/`, so `npm run dp -- capture <game> --choose` shows the same moments again, if the window closed first or you change your mind. The pictures come from running the original again with those presses, and it stops if any frame comes out differently from what you played. A coding agent can start it for you, but the choice is yours: it never looks at the pictures.

Making a Dreamport never waits for this, so three more ways of running it keep the work going. `--open` starts the window in a process of its own and returns at once. `--pick` ends it, waiting while someone is using it, and keeps what they chose. If they played and didn't choose, it takes the moment the tool ranks first, by those same numbers, in a browser nobody sees. If nobody played it says so, and `--from <file>` plays a list of presses, as a [recording](#recording-play) has them, and takes the first of what they lead to, or says in numbers what each stretch led to: how much of the screen moved, how many colours and how often buttons were held. Values written to the original's memory aren't play, so `--from` stops at them. With any of these, `--yes` also sends what's kept as a pull request of its own, from the commit that needs it: main for a game that's there, or the game's first files for one that isn't, which makes it the game's [first entry](../docs/TEAMS.md#a-games-first-entry). It leaves the branch you're on alone, so what it wrote still shows in this folder to commit there too.

## Proving

`npm run dp -- prove <game>` plays every recording of the game in the original and in the Dreamport, both from power-on, and compares every frame: its picture, pixel for pixel, in the console's own colours, and its sound, as [How sound is compared](#how-sound-is-compared) explains. A frame matches when both are the same. Add recordings' names after the game's to play only those. The Dreamport runs in a browser you don't see, a frame at a time, through its kit's proof mode ([the Game Boy Advance kit's](../kit/gba/README.md#for-the-proof-tools)), as fast as your computer goes rather than at the console's speed, and one browser plays all the recordings. Sonic Advance Dreamport's first act, 3,300 frames, takes a few seconds. `--paced` holds it to the console's speed, for a game whose code goes by the clock.

`prove <game> <recording> --quick` is for while you work: it stops at the first frame that differs, says why, and writes nothing but a picture of that frame and the stills you asked for, with no clip and no numbers, so it's the cheapest way to see whether a change did what it should. Run it plainly before the step goes out, which `npm run dp -- ready <game>` does.

For each recording it says how many frames were the same and which first differs: the frame, how many pixels differ, and the box they're in, or that it's the frame's sound, and then the first picture that differs too. It lists every stretch of frames that differs, then those whose sound differs, with the first of them: the band of pitches where it's furthest from the original's, and how loud each one is there, in the console's steps. It says so when the Dreamport makes no sound at all. It also lists the stretches where the original's screen is one colour, as it is between one screen and the next, which helps find where each of the game's parts starts and ends. For each part the recording proves in `parts.json`, it says whether every frame of it matched, and it names any [note](../docs/NOTES.md) on a part it didn't prove or on a recording that differs. At the end it gives the game's two numbers as they are now. It also compares with the last time the recording was proven: frames that differ now where they matched then are listed apart, with the first of them, which is usually the one a change just broke. If any frame differs, `prove` ends with an error, so a script that runs it stops. Frames are numbered as the Dreamport counts them. The console shows each frame's work one frame later, and `prove` lines the two up. A game that reads its buttons just after the V-blank, rather than just before it as most do, reads each frame's buttons in the frame `prove` counts as the next one: `"keysAfterVBlank": true` in its `original.json` gives the original its buttons a frame later, so the two still line up. Sonic Battle is one.

At the first picture that differs, and with `--state <frames>` at any others, such as `--state 782,1099`, up to 20 at a time, it says what the console holds as it draws that frame, where the original and the Dreamport differ: its display registers, its colours, its sprites and its video memory, with what on the screen uses each stretch of it. That's why a picture differs, which a picture can't say: a layer's scroll, a sprite's place, a stretch of a map. When all of it is the same, the picture differs because of how it's drawn. A register changed between lines shows its last line's value in the original and its first in the Dreamport. For every frame `--stills` or `--state` names, it says how many pixels differ and the box they're in.

Of video memory it prints only where it differs and how each stretch of a map starts, never a tile. What it prints goes only to the terminal and `report.json`, and, as with `read`, to the company that runs your agent's model when an agent reads it.

Its results go in `.dreamports/results/<game>/<recording>/`:

- `report.json`: everything it found, with what it heard under `sound`: whether the Dreamport made any, the stretches whose sound differs, and the first of them, and under `neverInPlay` any frames no player could ever see, as [Start points](#start-points) says.
- `first-difference.png`: the first frame that differs, as the original, the Dreamport, and the original in grey with every pixel that differs in magenta. When it's only the frame's sound that differs, the pictures are the same.
- `first-picture-difference.png`: the same, for the first frame whose picture differs, when a frame before it differs only by its sound.
- `first-new-difference.png`: the same, for the first frame that differs where it matched last time.
- `clip.mp4`, with `clip-start.png`, `clip-middle.png` and `clip-end.png`, pictures of its first, middle and last frames.
- `dreamport.mp4`, the same frames of the Dreamport on its own, with nothing of the original, and `dreamport.png`, its middle frame. `share` posts `clip.mp4`, and this one when asked with `--clip`.
- `stills/`, a picture of both at each frame `--stills` names, such as `--stills 249,250` or `--stills 900-905`, up to 600 at a time, and at each part's first and last frames, with the one before and the one after. Each is `frame-<frame>.png`, with where the two differ when they do.

The clip shows the original and the Dreamport side by side, with the frame's number, and *differs* over frames whose picture doesn't match, or *sound differs* over those where only the sound doesn't. It has no sound itself. It holds every frame, about 60 a second, made inside the browser rather than filmed from a screen, so it's smooth. It shows the frames the recording's `clip` names, or else the four seconds before the first difference and the second after it, or else the recording's last five seconds. It's an H.264 MP4 video, which phones and browsers play, at the console's own size, 480 by 180 with both sides and the bar. Twice that size took about twice the bytes, and more than the 2 MB limit in fast play. It's encoded in the mode browsers have for screens, at up to 2 Mbps. A calm clip stops well short of that, at about 0.1 to 0.3 MB, and five seconds of fast play comes to about 1 MB. A clip that stays over 2 MB is encoded again without that mode, which goes lower. The stills stay at twice the size, with every pixel sharp.

The clips and the pictures show the game, so they stay in `.dreamports/`, which the ignore rules keep out of commits. [Clips](../docs/STANDARD.md#clips) in the standard says where they may be shared: clips of the original in pull requests and nowhere else, and clips of the Dreamport alone anywhere. The original's sound stays there too: `prove` only keeps how loud each frame is, in `report.json`.

## How sound is compared

Both make the console's own sound for each frame: the mix of its four Game Boy channels and its two DirectSound channels, 65,536 samples a second, in its 10-bit steps, before the console's volume and filter. The original's comes from mGBA, through [`gba/original.c`](gba/original.c). The Dreamport's comes from its kit's sound engine, which runs on the page while the tools play the game, a frame of sound after each of the game's frames ([the Game Boy Advance kit's](../kit/gba/README.md#for-the-proof-tools)). A game that doesn't play its sound through the kit is silent to the tools.

The two never match sample for sample, even when the game is right. The console makes each frame's sound at its own moment in the frame, where the game's sound library runs, and the kit at the frame's start, so the two are a fraction of a frame apart, and the parts of a sound by different fractions: in Sonic Advance Dreamport, from 128 to 345 of the 1,097 samples a frame has. So `prove` compares how loud each frame is, pitch by pitch:

- The sound is split into eight bands of pitches, each an octave wide, around 125 Hz, 250 Hz and so on up to 16 kHz, on the left and on the right, and measured over the frame with the one before and the one after.
- A frame's sound is the same when every band is within 10 dB of the original's, which listeners hear as twice or half as loud. A band quieter than one of the console's steps counts as silent.
- When one is silent in every band and the other isn't, the frame differs, however quiet the sound. Two silent frames are the same.
- The original's sound is taken from as far as a frame before or after, wherever it's closest, so a sound may start or end up to a frame apart.
- The sound of the two frames either side of a stretch only the original has (`onlyInOriginal`) isn't compared, as the original's runs into or out of the screen the Dreamport skips. `prove` says which frames those are.

This catches a Dreamport that is silent where the original plays, or plays where it's silent, plays another sound, or plays it far louder or quieter. It can't tell a sound a frame early or late, a quiet sound missing under a loud one, or a difference inside one band, such as a note a little out of tune. On Sonic Advance Dreamport's recordings, 98 in every 100 frames with sound are within 3 dB of the original in every band, and none is more than 6.8 dB away, while Sonic Battle Dreamport, which makes no sound yet, is silent wherever its original plays. [`lib/sound.mjs`](lib/sound.mjs) holds the comparison and its numbers.

## The code map and the two numbers

The code map, `games/<game>/proof/code-map.json`, lists every function in the original program with its address and its size, and nothing of its code. It's the first thing a new Dreamport needs, before any of its code, as [the standard](../docs/STANDARD.md#how-progress-is-measured) asks: write the game's `original.json` from what `rom` says about your copy, run `rom` again so the tools know it's the copy the proof uses, then make the code map, and commit both with the game's first files. `npm run dp -- codemap <game>` makes one by finding the functions in your copy itself, following the code from where the game starts. A decompilation knows its functions better, and `npm run dp -- codemap <game> --from <list>` takes them from a list: what `nm -S` prints from the decompilation's ELF file, or a CSV with a column for the address and one for the size, such as the list of functions Ghidra exports, or for the end, the address just after the function's last byte, as decompilations list their functions' extents. A function listed without either gets the space up to the next one. A list can stop short, as when it didn't follow a function's switch or leaves out what nothing calls, so the tools also follow the code from every function it lists, in your copy, and add what they find beyond them. A listed function keeps its start and its name and grows over the rest of its code, up to the next one listed, and anything else becomes a function of its own, without a name. A list can also name data as a function, as when it takes a switch's table or the words a function loads for the start of another, so a listed function that starts in the data of the code before it is left out, the tools say which, and the function before it grows over what it held. `npm run dp -- codemap <game> --fill` does the same to the code map the game already has, keeping its names, which a list doesn't always have.

Each Dreamport shows two numbers, code ported and gameplay proven, which [the standard](../docs/STANDARD.md#how-progress-is-measured) explains. The tools write what both are measured with.

`prove` notes which of the original's functions ran in each frame, keeps those that ran in frames that matched, picture and sound, and writes them to `games/<game>/proof/progress.json`, with each recording's results: how many frames it has, which ones differ, and of those which differ by their sound, as `soundDiffers`, and the share of the code map's size those functions make. Recordings it didn't play this time count as they were last proven. It also says how many of the original's instructions ran outside every function of the code map: code the map is missing, in the cartridge, which `codemap --fill` adds, or code the game copies into the console's memory before running it, which the map normally lists once already, where it sits in the cartridge. Then it writes the README's table of Dreamports and the progress maps again, with the new numbers.

`npm run dp -- portmap <game>` writes the port map, `games/<game>/proof/port-map.json`: each function of the original that the game's code names, with the first file and line that names it, and every name that lands inside a function of the code map but not at its start, which is usually a mistake. A name is an address in the cartridge, written as a number, such as `0x08029E78`, or as a label, such as `sub_8029E78`, or `FUN_08029E78` as Ghidra writes them. An address outside every function of the code map is the game's data, such as a picture the code copies, and isn't counted or listed. A number is an address in the copy the proof uses. A label is one in the release the game's labels come from, and when that's another release, the game's `proof/names.json` says how far each stretch of its code is from the copy's. Sonic Advance Dreamport's code uses the labels of a decompilation built from the European release, and [its `names.json`](../games/sonic-advance/proof/names.json) gives the shifts to the USA release. Run it after changing the game's code; `npm run check` says when a port map is out of date.

Code ported is the size of the functions the port map names and those `prove` found running in matching play, divided by the size of every function in the code map. Gameplay proven is the share of the parts in `games/<game>/proof/parts.json` that a recording proves: every frame from the part's first to its last matched, picture and sound, with none the Dreamport doesn't have. The game's page, the launcher's Make row and the README show both, and the site checks that they add up with the files before it shows them, so they only ever come from the tools. The tools also draw each game's progress map from the same files, with [`src/lib/progress-map.mjs`](../src/lib/progress-map.mjs): a picture of every function in the code map and every part, green once it counts. They keep it in `.github/readme/progress/<game>.svg`, which the README's table links, and write it whenever they write the table. It's only shown on GitHub, never on the site.

## Starting a game

`npm run dp -- new <game>` starts a Dreamport that someone has claimed and mapped: it needs its [New Dreamport](../docs/TEAMS.md#start-a-dreamport) issue, `proof/original.json` and its code map. It writes `index.html`, `src/main.js`, `LICENSE` and `entry.md` in its folder, then its port map and the README's table. Its [capture](#a-games-capture) then gives it its place in the Make row. The game's code starts as the kit's start for its console, [`gba/new-game/`](gba/new-game/), with the controller, the touch screen, the settings and the start screen already working, and it shows only a blue screen until someone writes the game. The first three files say the same for anyone with the same `original.json`, so nothing has to be reviewed in them. `new` writes over nothing. A pull request of only these, with a [capture](#a-games-capture), comes in with no review of its code ([A game's first entry](../docs/TEAMS.md#a-games-first-entry)).

## Reading the original's instructions

A Dreamport rewrites each of the original's functions from how the original does it, usually from its decompilation's C. When a function has none, because the decompilation hasn't reached it or its C doesn't match, or the game has no decompilation, `npm run dp -- read <game> <function>` prints the function's own instructions, the machine code the console runs, from your copy. The function is an address, such as `0x08016078`, a name in the code map, such as `FUN_08016078`, or a label of the release the game's labels come from, such as `Task_803775C`, which `names.json` moves to the copy's address as it does for `portmap`. It prints the whole function, as the code map has it. When a label doesn't land where a function starts, it says so first, since `names.json` may not say how far that label moved, and it may be the wrong function.

mGBA's own decoder reads the instructions. The library `setup` builds leaves out the part that writes them as text, so `setup` builds that part on its own, with [`gba/read.c`](gba/read.c), and each line is the one mGBA's debugger shows for the same address. On 1 November 2026, for every function in Sonic Battle's and Sonic Advance's code maps, all 381,615 lines it printed as instructions were the same as mGBA 0.10.5's `disassemble` command printed. An automated player then ran 1,860 of those functions, for 198 hours of the games' time: none of the addresses they ran fell on a line printed as data or in the other kind of instructions, and none of the words they read from their own code fell on a line printed as an instruction. For the 82 Sonic Advance functions whose assembly its decompilation keeps, all 24,197 instructions and 1,695 words of data came out the same. Beyond what mGBA's debugger shows, `read`:

- Writes the numbers the code keeps beside itself, its literal pool, as `.word`, and a switch's jump table, the address of each of its cases, the same way, with any padding before them as `.hword`. It finds them by following the game's code from every function in the code map, since a code map entry can start partway into a function and keep its numbers in the next entry. What none of that code reaches still reads as instructions, as it does in mGBA's debugger.
- Follows code that changes from Thumb to ARM or back partway through a function, as a game's sound driver does, and a line such as `@ ARM from here` says where.
- Adds the code map's name of each function a line calls or loads the address of, after `@`.
- Reads the function as ARM or Thumb, the console's two kinds of instructions, as the tools found it by following the game's code, or else from how its first instructions look. `--arm` or `--thumb` reads it the other way, following the code only from that address.
- Reads `--bytes <n>` bytes from the address instead of the whole function. A function the code map doesn't list gets as much as the tools can follow of it, or else its first 256 bytes.
- Reads code at `0x02000000` or `0x03000000`, which the game copies into the console's memory to run there, as it is 60 frames after power-on, or `--frame <n>` frames after, following the code only from that address.

What it prints comes from your copy of the game. It goes to the terminal and to `.dreamports/read/<game>/<address>.txt`, and never in a commit, an issue or a pull request, not even a few lines. A coding agent that reads it sends it to the company that runs the agent's model, as it does with everything it reads, so agents reach a copy only through the tools, a function at a time. The Dreamport's code says which function it rewrites, and that's enough.

A line such as `08001234:  4801  ldr r0, =0x03000010  @ 0x0800123C`, made up for this guide, is an address, the bytes there and the instruction they make. A Thumb instruction takes 2 bytes, or 4 for a call, and an ARM one 4. Most of a game's code is Thumb. A short guide to the rest:

- **Registers.** `r0` to `r12` hold numbers, `sp` points to the stack, where a function keeps what doesn't fit in them, `lr` holds where a call returns to, and `pc` the instruction running. A function gets its first four arguments in `r0` to `r3`, gives its result back in `r0`, and leaves `r4` to `r11` as it found them.
- **In and out.** `stmdb sp!, {r4-r6,lr}`, which other tools write as `push`, saves registers as a function starts, and `ldmia sp!, {r4-r6}`, or `pop`, puts them back before it returns with `bx` or by loading `pc`.
- **Calls and branches.** `bl` calls a function. `b` jumps, and `beq`, `bne`, `bhi` and the like jump only when the `cmp` before found the two equal, not equal, greater and so on: `lt`, `gt`, `le` and `ge` compare numbers that can be negative, and `lo`, `hi`, `ls` and `hs` those that can't.
- **Numbers.** `ldr r0, =0x03000010` loads a number from the literal pool, at the address after `@`. `mov` and `add` with `#` use a number written in the instruction itself.
- **Memory.** `ldr` and `str` read and write 32 bits, `ldrh` and `strh` 16, `ldrb` and `strb` 8, and `ldrsh` and `ldrsb` read numbers that can be negative. `[r1, #8]` is the address in `r1` plus 8, often a field of a structure.
- **Addresses.** `0x02000000` and `0x03000000` are the console's work memory, where the game keeps its variables, `0x04000000` its registers, which drive the screen, sound, buttons and copies (`0x040000D4` is DMA 3), `0x05000000` the palettes, `0x06000000` video memory, `0x07000000` the sprites and `0x08000000` the cartridge.
- **The BIOS.** `swi` calls the console's built-in program: `swi #11` is CpuSet, `swi #12` CpuFastSet, `swi #5` waits for the next frame and `swi #6` divides.

[GBATEK](https://problemkaputt.de/gbatek.htm) describes every instruction, register and BIOS call. Rewrite what the function does, not each instruction: readable JavaScript, with names that say what things are, and every number taken from the instructions. Name the function in a comment, by its address or its name in the code map, so the port map counts it, and prove the step. Sonic Battle Dreamport's `newScreen`, in [`games/sonic-battle/src/core.js`](../games/sonic-battle/src/core.js), rewrites `0x08016078`, which its decompilation has no C for.

## Proving a part

A part, such as a game's logos or one of its acts, is proven by a recording that plays the whole of it, from its first frame to its last, so a recording that skips any of it with Start doesn't prove it. It may end with a press that moves the game on, the way a player leaves it: Sonic Advance Dreamport's title screen is frames 902 to 1252 of `neo-green-hill-act-1`, which ends it with Start, as left alone it would move on to a demo the Dreamport doesn't have yet. These steps prove one:

1. Make a recording that plays the whole part and a little of what comes after it, with `play --record`, with `play --record --from` to start where another recording reaches the part, or by hand.
2. Run `npm run dp -- prove <game> <recording>` and read the stretches where the original's screen is one colour. A part usually starts as one of them ends and ends as the next one does. Where the screen is one colour between two parts, as when one fades out and the next fades in, those frames go with the part before, so the next part starts on the first frame that isn't one colour.
3. Check the frames you picked with `--stills`, such as `--stills 253,254,932,933`, and look at the pictures in `stills/`.
4. Write the part's `recording` and `frames` in `parts.json`, and run `prove` again. It says whether the part is proven, and keeps pictures of its first and last frames, with the one before and the one after, so the lead can check them once more.

Sonic Advance Dreamport's logos are frames 254 to 932 of [`logos-and-intro`](../games/sonic-advance/proof/recordings/logos-and-intro.json): the language screen fades to white until frame 253, and the Sonic Team logo fades to black, which stays until 932.

A part the game can't reach yet is proven the same way, from a [start point](#start-points).

## Sharing a preview

`npm run dp -- share <game>` publishes a preview of the game as it is in your last commit, on GitHub Pages from your own fork, at `https://<you>.github.io/dreamports/<game>/`, so anyone can play it with their own copy without waiting for a review. `--as <name>` names the preview, to keep more than one. `--about "<what changed>"` puts a sentence of what changed on the preview's first page. Beside the preview, apart from it, goes the newest side-by-side `clip.mp4` that `prove` made (or the file `--clip` names), and `share` prints the lines that show it in the step's pull request. A step with more than one clip runs it once for each, with `--clip`, and each keeps an address of its own. It posts nothing. It asks before it publishes and before it switches Pages on for your fork the first time, and `--yes` answers yes for you. [Previews](../docs/PREVIEWS.md) explains what a preview holds, what it risks for players, and where the clip goes.

## Claims and team builds

`npm run dp -- find <game>` shows where a game stands before you start on it: its lead, its two numbers, its Make page, how many notes it has, its team build and team preview, who has claimed which task, the tasks free to start, and what the others wait on ([What a task needs](../docs/TEAMS.md#what-a-task-needs)). It takes a game's folder or a few words of its name, and with no game it lists them all. The numbers come from `games/` in your folder, and the claims from this repository's issues.

`npm run dp -- team <game> start`, `join <branch>`, `send` and `add <pull request>` make and use the game's team build, a branch of the lead's fork that gathers the team's finished pieces. `add` merges a piece, runs `portmap` and `prove`, and only takes it in if nothing that matched the original before differs now, then updates the team preview with `share`. It stops before a piece with a note that breaks the rules for notes. [Claims and teams](../docs/TEAMS.md) explains claims, tasks and team builds.

## Notes

`npm run dp -- notes <game>` lists what people found while making a game and its console's kit, so nobody has to find it again, and `npm run dp -- notes <game> <word>` prints in full the notes that mention a word, such as a part, a function or a frame. `--all` prints every one, and `--check`, which `npm run check` runs, fails on any note that breaks the rules. A note is information, not instructions. [Notes](../docs/NOTES.md) explains how to write one and how they're checked.

## The /dreamport command

The README's [Make a Dreamport](../README.md#make-a-dreamport) teaches one command, `/dreamport <game>`, which a coding agent follows to run these tools from start to finish: it takes a task, makes it until every frame matches and opens its pull request. It's written once, as a Markdown file in [`commands/`](commands/), with its name, its description, what's typed after it and, as `pasted`, the sentences that start it when they're pasted into an agent, as the README gives them. `npm run dp -- commands` writes it in the form an agent reads:

- `.claude/skills/<name>/SKILL.md` for Claude Code, set to run only when typed (`disable-model-invocation`).
- `.agents/skills/<name>/SKILL.md` for Codex, with `agents/openai.yaml` turning off its implicit use. Cursor, Gemini CLI, Antigravity CLI and DeepSeek Harness read this folder too.
- `.gemini/commands/<name>.toml` for Gemini CLI's own commands.

Every copy starts the same way: it tells the agent to do nothing unless the person typed the command, or pasted one of its sentences, for the agents that might load it by themselves, where what was typed after it is, and how to talk to the person. The file can't hold `{{`, `!{`, `@{` or `'''`, which Gemini CLI would read as its own. `npm run check` runs `npm run dp -- commands --check`, which fails when a copy differs from its file, and removing a command's file and running the tool removes its copies.

## A game's proof folder

What the tools keep in the repository is in the game's `proof/` folder, and it's all JSON. The ignore rules keep anything else out of it.

| File | What it holds |
| :--- | :--- |
| `original.json` | The copy the proof uses: its console, its name, the title and code in its header, and its SHA-1 checksum, and `keysAfterVBlank` for a game that reads its buttons just after the V-blank |
| `recordings/` | Recorded play, one file per recording |
| `code-map.json` | The code map |
| `progress.json` | Each recording's results and the code that ran in matching play, written by `prove` |
| `port-map.json` | The port map: the functions the game's code names, and the names that land inside one but not at its start, written by `portmap` |
| `names.json` | Optional: how far the release the game's labels come from is from the copy's, stretch by stretch, for `portmap` and `read` |
| `parts.json` | The game's parts, each with the recording and frames that prove it once there are some, written by the game's lead |

## What stays on your computer

Everything else the tools keep is in `.dreamports/`, in the repository's folder, which the ignore rules keep out of commits: where your copies are, the reference emulator, every result with its pictures and clips, what `read` prints, what you played for `capture`, and the browser profiles the tools use. Deleting it is safe, as `setup` and `rom` make it again. Only what you send leaves it, such as a clip in a pull request. A coding agent is different: whatever it reads, such as what `read` prints, goes to the company that runs its model, unless that model runs on your computer too.

## For a game on the Game Boy Advance kit

A game made on [the Game Boy Advance kit](../kit/gba/README.md) works with the tools when its page calls `proof?.watch(screen, input)`, as the kit's guide shows, and keeps the kit's start screen, where the tools give it the copy and press Play. Its screen has to be the console's 240 by 160 pixels while the tools play it, and the tools hear its sound when it plays through the kit's `createSound()`. Games with more than one player on a page aren't supported yet.
