---
name: dreamport
description: Shows where a game stands and what you can do. Start here.
argument-hint: <game>
disable-model-invocation: true
---

<!-- Written by npm run dp -- commands from tools/commands/dreamport.md: change that file, not this one. -->

Only do this if the person typed `/dreamport` in their message, or pasted one of these sentences, with a game's name for any `<game>`:

- `Set up https://dreamports.net/code and help me make <game> Dreamport.`
- `Set up https://dreamports.net/code and help me start a Dreamport.`

If you're reading it because of something else they said in their own words, such as "send it" or "put it online", stop here and do none of it: tell them in one sentence what `/dreamport` does, and wait for them to type it.

What they typed after the command, if anything: $ARGUMENTS

Work in the Dreamports repository's folder, as its `AGENTS.md` says under Working on a Dreamport. The person may never have written code: speak plainly, one step at a time, and ask only what they have to decide.

Pasting one of the sentences above starts this command as well as typing it, since it only reads and explains. Every other command waits for the person to type it.

1. Take the game from what they typed or pasted, such as `Sonic Battle (Game Boy Advance)`. If there's none, as in `help me start a Dreamport`, ask which game they'd like to make, and on which console.
2. Get the folder ready, without asking about what changes nothing outside it. If `git remote get-url origin` is `https://dreamports.net/code`, point it at GitHub with `git remote set-url origin https://github.com/NahuelGenchi/dreamports.git`, since the tools and the GitHub CLI only know GitHub's address. Run `npm ci` if `node_modules/` is missing.
3. Check what the tools need, as `tools/README.md` lists it under What you need: Node.js 22 or newer, the GitHub CLI, Google Chrome, Chromium or Microsoft Edge, and git, CMake and a C compiler for the reference emulator, which the first `prove` builds. Anything that installs a program on the computer waits for their yes: say what it is, that it's free, and why it's needed. Install now what this command needs, Node.js and the GitHub CLI, and say what's missing for later steps without installing it yet. If the GitHub CLI isn't signed in (`gh auth status`), ask them to run `gh auth login` themselves: they sign in on GitHub's own page, and you never see or type their password.
4. Once they're signed in, offer their fork if none of this folder's remotes is one: say that a fork is their own public copy of the Dreamports repository on their GitHub account, where their work and previews go before anyone reviews them, that it's free, and that `/dreamport-share` and `/dreamport-send` need it. Carry on while they decide, and only after their yes run `gh repo fork --remote`, which makes the fork the folder's `origin` and this repository's remote `upstream`. If they'd rather wait, those commands ask again. Someone who can push to the Dreamports repository itself, such as its owner, who can't fork it, needs none.
5. Run `npm run dp -- find <a few words of the game's name>`. It says whether the game has a Dreamport, its lead, its two numbers, its progress thread, its team build and team preview, who has claimed which task, and the tasks still free. If it has no Dreamport, it says whether anyone has claimed it, and it also finds a port made elsewhere that the site lists.
6. Look for a head start, if you can search the web: ports of the game made elsewhere, decompilations and disassemblies, each with its license. Code whose license allows it can come in; code with no license can only be read as a guide, unless its authors agree (`docs/STANDARD.md`, Ports made elsewhere).
7. Ask whether they have their own copy of the game as a file, made from their own cartridge or disc, and where it is. `npm run dp -- rom <the file or its folder>` checks it, and remembers where it is once the game has a Dreamport: for a new one, `/dreamport-claim` does that when it maps the game. It never leaves the computer. If they have none, explain that a cartridge reader, a small USB device, copies their own cartridge, and never help them get a copy any other way.
8. Tell them, in a few short sentences, where the game stands and what they can do next, naming the command:
   - No Dreamport and nobody on it: `/dreamport-claim <game>` starts it, with them as its lead.
   - A Dreamport with free tasks: list the free tasks in the order a player meets them, and `/dreamport-claim <task>` takes one. `/dreamport-play` tries the game as it is.
   - A lead still making the first piece, with nothing to split yet: they can try the lead's preview, follow the progress thread, or pick another game.
   - They don't own the game: they can still watch the clips in the progress thread and point out what differs from the original, or pick a game they own.
   - A console whose games can't be read without breaking a lock, such as Switch, 3DS or PS3: it can't be a Dreamport (`docs/STANDARD.md`, Which games qualify).
   - A console with no kit in `kit/` yet: its kit comes first, which is bigger work than a game. Say so plainly.
9. If you weren't opened in this folder, as when they pasted the sentence somewhere else, say where the folder is and how to open their agent in it next time, so it finds the commands: in a terminal, `cd` into it and start the agent again, such as `claude` or `codex`; in an app, open the folder the way they'd open any folder. Until then, when they type a command you haven't loaded, read its file in `tools/commands/` and follow it.

This command posts nothing and claims nothing. The fork, after their yes, is the only thing it makes outside this computer.
