---
name: dreamport
description: Shows where a game stands and what you can do. Start here.
argument: <game>
---

1. Take the game from what they typed, such as `Sonic Battle (Game Boy Advance)`. If they typed none, ask which game, and on which console.
2. Get the folder ready, without asking about what changes nothing outside it. If `git remote get-url origin` is `https://dreamports.net/code`, point it at GitHub with `git remote set-url origin https://github.com/NahuelGenchi/dreamports.git`, since the tools and the GitHub CLI only know GitHub's address. Run `npm ci` if `node_modules/` is missing. Anything that installs a program on the computer, such as Node.js 22 or newer or the GitHub CLI, waits for their yes: say what it is, that it's free, and why it's needed. If the GitHub CLI isn't signed in (`gh auth status`), ask them to run `gh auth login` themselves: they sign in on GitHub's own page, and you never see or type their password.
3. Run `npm run dp -- find <a few words of the game's name>`. It says whether the game has a Dreamport, its lead, its two numbers, its progress thread, its team build and team preview, who has claimed which task, and the tasks still free. If it has no Dreamport, it says whether anyone has claimed it, and it also finds a port made elsewhere that the site lists.
4. Look for a head start, if you can search the web: ports of the game made elsewhere, decompilations and disassemblies, each with its license. Code whose license allows it can come in; code with no license can only be read as a guide, unless its authors agree (`docs/STANDARD.md`, Ports made elsewhere).
5. Ask whether they have their own copy of the game as a file, made from their own cartridge or disc, and where it is. `npm run dp -- rom <the file or its folder>` checks it and remembers where it is. It never leaves the computer. If they have none, explain that a cartridge reader, a small USB device, copies their own cartridge, and never help them get a copy any other way.
6. Tell them, in a few short sentences, where the game stands and what they can do next, naming the command:
   - No Dreamport and nobody on it: `/dreamport-claim <game>` starts it, with them as its lead.
   - A Dreamport with free tasks: list the free tasks in the order a player meets them, and `/dreamport-claim <task>` takes one. `/dreamport-play` tries the game as it is.
   - A lead still making the first piece, with nothing to split yet: they can try the lead's preview, follow the progress thread, or pick another game.
   - They don't own the game: they can still watch the clips in the progress thread and point out what differs from the original, or pick a game they own.
   - A console whose games can't be read without breaking a lock, such as Switch, 3DS or PS3: it can't be a Dreamport (`docs/STANDARD.md`, Which games qualify).
   - A console with no kit in `kit/` yet: its kit comes first, which is bigger work than a game. Say so plainly.

This command posts nothing and claims nothing.
