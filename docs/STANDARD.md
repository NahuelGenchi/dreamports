# The Dreamport standard

[Back to README](../README.md) · [Contribution workflow](../CONTRIBUTING.md) · [Written in: #73](https://github.com/NahuelGenchi/dreamports/issues/73) · [Milestone M6](https://github.com/NahuelGenchi/dreamports/milestone/7)

## In plain words

A Dreamport is the port fans always dreamed of: **the game you remember, with the extras you wished it had.** It plays in a web browser, on a computer or a phone, with nothing to install. It isn't an emulator: the game is rebuilt in modern code, and it reads its graphics and sounds from the player's own copy, which never leaves their device. With every extra switched off, it plays exactly like the original.

This page holds the rules every Dreamport keeps, whoever makes it, and says how each one is checked. They were decided on 30 October 2026, as Dreamports opened to everyone in milestone M6. [Sonic Advance Dreamport](https://dreamports.net/play/sonic-advance/) is the first Dreamport, and the bar every other one has to reach.

Some of the checks below are still being built. Where one doesn't exist yet, the rule says so and names its issue, and [Not done yet](#not-done-yet) gathers them all.

## The five rules

### It's the real game, rebuilt

**What it asks.** The original program never runs: not on its own, not inside a hidden emulator, and not translated on the fly while the game plays. Its logic is rewritten in plain JavaScript that the browser runs as it is, with no build step, and drawing and sound work the way the console did them, in the Dreamport's own code and its console's kit. With every extra switched off, the Dreamport plays exactly like the original on its console, bugs included.

**How it's checked.** The Dreamports team reads every change before it goes live, looking for anything that loads, runs or translates the original program. The [proof tools](../tools/README.md) also play the same button presses in the original and in the Dreamport, with every extra off, and compare every frame. For that comparison only, the original runs in an emulator on the contributor's own computer. The emulator is never part of a Dreamport and never runs on dreamports.net.

### Nothing from the game is ever shared

**What it asks.** Everything the game shows or plays, and the data it's made from, comes from the player's own copy, on their device: graphics, sounds, music, levels, text and tables. None of it goes into this repository, a pull request, an issue, a preview or dreamports.net, and nothing uploads the copy or any piece of it. No lock is ever broken: no keys, no decryption and no copy-protection removal. An extra that borrows from another game needs the player's own copy of that game too, the way Sonic Advance Dreamport's Boost Mode needs Sonic Advance 2.

What the repository may keep about a game is what tells its versions apart and maps its program: a checksum of each supported version, and the [code map](#how-progress-is-measured), which lists each function's address and size. Neither holds any of the game. Short recordings of play aren't game files either, and [Clips](#clips) says where they may appear.

**How it's checked.** The repository's [ignore rules](../.gitignore) stop game files, saves and extracted assets from being committed by accident, but they're a guard, not permission. The Dreamports team checks every pull request for game data, and for anything that sends the copy off the player's device.

### Always playable, always proven

**What it asks.** The very first piece of a new Dreamport can already be played, usually the first character moving in the first level. Every change keeps it playable, and the work follows the order a player meets things. Progress is proven, not guessed: the [%](#how-progress-is-measured) counts only code that has been played and matches the original, so a game that can't be played stays at 0%. Every change you can see or hear comes with a short [clip](#clips) that shows it, next to the original whenever it claims a match.

**How it's checked.** The Dreamports team plays every change on a phone and a computer before it goes live, and watches its clips. Anyone can play it before then, in the preview its author publishes with `npm run dp -- share` ([Previews and progress threads](PREVIEWS.md)). The [proof tools](../tools/README.md) measure the %, which each game's page and the README show, from the game's [entry](../games/README.md#the-entry) and its proof folder.

### At home on dreamports.net

**What it asks.** Every Dreamport lives in this repository, in a folder of its own in [`games/`](../games/README.md), and plays at `dreamports.net/play/<game>/`, on the same site as the player's profile. Sonic Advance Dreamport moved here from its own repository with [#75](https://github.com/NahuelGenchi/dreamports/issues/75), into [`games/sonic-advance/`](../games/sonic-advance/README.md).

It works with the launcher at least as well as Sonic Advance Dreamport. The player's copy is checked before play, so they know it's the right game and a version the Dreamport supports. Achievements go to the player's profile through `/dreamports.js`, as [Profiles and achievements](ACCOUNTS.md#for-a-game-dreamportsjs) describes, and stay on the device for players who aren't signed in. Its settings, keyboard, controller and touch, saves and the Home Screen app all work, on phones and computers. Its asset viewer lets players look through the graphics and sounds read from their own copy.

**How it's checked.** The Dreamports team tries each of these on a phone and a computer before a Dreamport goes live.

### Fair to everyone who helped

**What it asks.** Code can come from anywhere, as long as its license allows it or its authors agree: decompilations, disassemblies, recompiler drafts and ports made elsewhere. Whatever comes in is rewritten as readable JavaScript, with names that say what things do. Every source is named, and code brought in keeps its license notice and its authors' names. Code with no license can be read as a guide, but it isn't copied unless its authors agree, and their agreement is linked in the game's credits.

**How it's checked.** Every pull request names the sources it used and their licenses, and the Dreamports team checks them. Each game's [entry](../games/README.md#the-entry) lists every source with its license and whether code came in from it, and the game's page shows them.

## How progress is measured

**The %** is how much of the original game's code has been rewritten for the browser and proven by playing.

**The code map** is what it's measured against: the list of every function in the original program, with its address and size, and nothing of its code. A decompilation's list of functions, or a disassembler, can provide it.

**Recorded play** is the button presses for each frame. It holds nothing from the game, so it's kept in the game's folder, and anyone with their own copy can replay it.

**The measure.** The proof tools play each recording in the original and in the Dreamport. A function counts once it has run in recorded play where every frame of both versions matched. The % is the size of the functions that count, divided by the size of every function in the code map. Bigger functions count for more, and code nobody has played counts for nothing, so a high % always means a game you can play.

The [proof tools](../tools/README.md) do this on the contributor's computer, and make the clips. Each game's page and the README's table of Dreamports show the % they wrote, and the site checks that it adds up with the code map before it shows it, so it can't be typed by hand.

## Clips

Every change you can see or hear comes with a short clip, so anyone can check the progress from a phone, without owning the game and without installing anything.

A clip shows every frame the game draws, about 60 a second, captured inside the game rather than filmed from a screen, so it's smooth and its pixels stay sharp. It lasts a few seconds and stays under about 2 MB, as an H.264 MP4 video, which every browser plays. When one frame says enough, a PNG picture does the job. Clips are never GIFs, which are far bigger for the same few seconds.

When a change claims to match the original, its clip shows the original next to the Dreamport, with the same button presses. Clips go with every pull request, and in the game's [progress thread](PREVIEWS.md#progress-threads), where `npm run dp -- share` posts the newest clip of the Dreamport on its own.

Clips of the original appear only in pull requests and progress posts. The site itself keeps showing only the Dreamports team's own recordings. [#82](https://github.com/NahuelGenchi/dreamports/issues/82) adds this exception to the picture rule in `AGENTS.md` and `CONTRIBUTING.md`, and until it does, those files allow only the team's own recordings.

## Which games qualify

Any game from any platform can become a Dreamport, even one that already has ports somewhere else. The one exception is platforms whose games can't be read without breaking a lock, such as Switch, 3DS or PS3, because a Dreamport never breaks one.

Players need their own copy, made from their own cartridge or disc. Each Dreamport names the exact version it's built from, such as the USA version, and supporting another version can become a task.

## Ports made elsewhere

A port someone already made elsewhere is a head start, not a reason to stop. It becomes a Dreamport once its code comes into this repository, which needs its license to allow it or its authors to agree. Its code is rewritten as readable JavaScript on its console's kit, with no emulator and no game files, and then checked against the original. Only what matches counts toward the %, every difference becomes a task, and its authors are credited on the game's page and invited to lead it.

Until someone brings it in, it can be listed in the Mash-ups row as an external port, with a link to its own page and credit to the people who made it.

## Licenses

The site, which is everything outside the games and their kits, stays under the [MIT License](../LICENSE). Each console's kit and every new Dreamport use GPL-3.0-or-later, like Sonic Advance Dreamport. Code brought in keeps its own license, which has to let it be part of a GPL-3.0-or-later game, as MIT, BSD, Apache-2.0 and GPL-3.0 do. Each game keeps its license file in its own folder.

## The Mash-ups row

The Mash-ups row on dreamports.net stays as it is: for fan games that aren't ports, like Kirby's Dead Land, and for ports made elsewhere that nobody has brought in yet.

## Not done yet

Today, these rules are checked by the Dreamports team's review. The rest of milestone M6 builds what makes them easier to keep and to check.

Claims and teams are [#80](https://github.com/NahuelGenchi/dreamports/issues/80). Previews and progress threads came with [#78](https://github.com/NahuelGenchi/dreamports/issues/78), as [Previews and progress threads](PREVIEWS.md) explains, and one entry per game with its measured % came with [#79](https://github.com/NahuelGenchi/dreamports/issues/79), as [the entry](../games/README.md#the-entry) explains. The guide and commands for newcomers are [#81](https://github.com/NahuelGenchi/dreamports/issues/81), and a contact for rights holders, with clips of the original allowed in pull requests and progress posts, is [#82](https://github.com/NahuelGenchi/dreamports/issues/82).

## Words used here

**Copy.** A file made from your own cartridge or disc, also called a ROM.

**Emulator.** A program that pretends to be a console, so a game's original program can run on it.

**Decompilation.** A game's program turned back into code people can read. A disassembly is the same idea, closer to the machine's own language.

**Recompiler draft.** Code a tool translated straight from the game's program, which can serve as a first draft to rewrite.

**Kit.** The parts every Dreamport on the same console shares, such as reading the copy, drawing, sound and controls. The Game Boy Advance kit, in [`kit/gba/`](../kit/gba/README.md), came out of Sonic Advance Dreamport with [#76](https://github.com/NahuelGenchi/dreamports/issues/76).

**Code map.** The list of every function in the original program, with its address and size.

**Entry.** The one file that says everything about a Dreamport, `entry.md` in its folder: the copy it needs, what's playable, its team, its sources and where to follow it. Its % comes from its proof folder.
