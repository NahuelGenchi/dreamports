# Games

[Back to README](../README.md) · [Contribution workflow](../CONTRIBUTING.md) · [The Dreamport standard](../docs/STANDARD.md) · [Written in: #74](https://github.com/NahuelGenchi/dreamports/issues/74)

Every Dreamport made in this repository lives in this folder, one folder per game. A game plays on dreamports.net at the address that matches its folder's name, so `games/sonic-advance/` plays at `dreamports.net/play/sonic-advance/`, on the same site as the player's profile. Every game here keeps the rules in [the Dreamport standard](../docs/STANDARD.md).

## What a game's folder holds

A game is plain HTML, CSS and JavaScript that runs in the browser as it is, with no build step. When the site is built, each game's folder is copied to `/play/<game>/` exactly as it is, so the files in the folder are the files players get. On dreamports.net they are served as plain files, like the site's own pages, without running the site's Worker.

Every folder needs two files at its top: `index.html`, the page the game starts from, and the license for the game's code, in a file named `LICENSE` or `COPYING` (it may end in `.md` or `.txt`). Dreamports use GPL-3.0-or-later, as [the standard explains](../docs/STANDARD.md#licenses). The rest of the game can be in any files and folders it needs. Its pages load them with addresses relative to the page, such as `src/main.js`, and load the site's own files, such as [`/dreamports.js`](../docs/ACCOUNTS.md#for-a-game-dreamportsjs) for achievements, from the site's root. The game's code map comes with the proof tools ([#77](https://github.com/NahuelGenchi/dreamports/issues/77)), and its entry, with its progress, with [#79](https://github.com/NahuelGenchi/dreamports/issues/79).

The folder's name is the game's address, so it has only lowercase letters, numbers and single dashes, such as `sonic-advance`. Files and folders whose names start with a dot stay out of the site, and links to files somewhere else (symlinks) aren't allowed.

Nothing from the original game ever goes here: no ROM, no game files, and no music, pictures or data taken from them. Players bring their own copy, and the game reads it on their device.

## Trying a game on your computer

After [setting up the site on your computer](../CONTRIBUTING.md#run-the-site-on-your-computer), `npm run worker` builds it with every game in it and opens it at `http://localhost:8787`, with its profiles and a database on your computer. There, `http://localhost:8787/play/<game>/` plays the game the way dreamports.net does. `npm run build` followed by `npm run preview` shows the games too, without profiles. `npm run dev` shows only the site's own pages, not the games. While you work on a game, any static file server run in its folder also plays it, without the site's own files such as `/dreamports.js`, as [Sonic Advance Dreamport's README](sonic-advance/README.md#run-it-on-your-own-computer) shows.

The build stops and says what's wrong if a game's folder breaks one of these rules, or if the site grows past what Cloudflare's free plan takes: 20,000 files at most, and none bigger than 25 MiB.

## Removing a game

A game comes off the site in one commit: delete its folder and its page in `src/content/games/`. A game that keeps achievements is also listed in `src/lib/players.ts` and `public/dreamports.js`, as [Profiles and achievements](../docs/ACCOUNTS.md#for-a-game-dreamportsjs) explains, so those lines go in the same commit.
