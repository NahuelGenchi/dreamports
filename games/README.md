# Games

[Back to README](../README.md) · [Contribution workflow](../CONTRIBUTING.md) · [The Dreamport standard](../docs/STANDARD.md) · [Written in: #74](https://github.com/NahuelGenchi/dreamports/issues/74)

Every Dreamport made in this repository lives in this folder, one folder per game. A game plays on dreamports.net at the address that matches its folder's name, so `games/sonic-advance/` plays at `dreamports.net/play/sonic-advance/`, on the same site as the player's profile. Every game here keeps the rules in [the Dreamport standard](../docs/STANDARD.md).

## What a game's folder holds

A game is plain HTML, CSS and JavaScript that runs in the browser as it is, with no build step. When the site is built, each game's folder is copied to `/play/<game>/` exactly as it is, so the files in the folder are the files players get. On dreamports.net they are served as plain files, like the site's own pages, without running the site's Worker.

Every folder needs three files at its top: `index.html`, the page the game starts from; `entry.md`, the game's [entry](#the-entry); and the license for the game's code, in a file named `LICENSE` or `COPYING` (it may end in `.md` or `.txt`). Dreamports use GPL-3.0-or-later, as [the standard explains](../docs/STANDARD.md#licenses). The rest of the game can be in any files and folders it needs. Its pages load them with addresses relative to the page, such as `src/main.js`, and load the site's own files, such as [`/dreamports.js`](../docs/ACCOUNTS.md#for-a-game-dreamportsjs) for achievements, from the site's root. A Dreamport's `proof/` folder holds what the [proof tools](../tools/README.md) measure it with: which copy of the original it's compared with, its recorded play, its code map and its progress, all as JSON.

The folder's name is the game's address, so it has only lowercase letters, numbers and single dashes, such as `sonic-advance`. Files and folders whose names start with a dot stay out of the site, and links to files somewhere else (symlinks) aren't allowed.

Nothing from the original game ever goes here: no ROM, no game files, and no music, pictures or data taken from them. Players bring their own copy, and the game reads it on their device.

## The entry

Every Dreamport has one entry, `entry.md` in its folder, which says everything about it: the game and the exact copy it needs, who makes it, what it's built with, and where to follow it. The site makes the game's page from it, at `dreamports.net/dreamports/<game>-dreamport/`, where `<game>` is the folder's name, and the launcher and the README's table of Dreamports show its two numbers, code ported and gameplay proven, and its lead. [Sonic Advance Dreamport's entry](sonic-advance/entry.md) is an example.

An entry is a Markdown file. Its fields go at its top, between two `---` lines, and the text below them, such as the credits, shows at the end of the game's page. Write them as normal sentences and labels, with a capital at the start. `npm run check` and `npm run build` stop and say what's wrong when a field is missing or wrong.

| Field | What to write |
| :--- | :--- |
| `title` | The Dreamport's name, such as `Sonic Advance Dreamport` |
| `platform` | The console, such as `Game Boy Advance`, shown under the name in the menu |
| `year` | Optional: the year the original came out |
| `added` | The day the Dreamport was added, written as `2026-10-27` |
| `summary` | One sentence about it, shown in the README's table and when its page is shared |
| `needs` | The exact copy players need, such as `A Sonic Advance (USA) ROM (.gba)`. It names the same copy as `proof/original.json` |
| `controls` | The ways to play: any of `keyboard`, `controller` and `touch` |
| `lead` | The GitHub account of whoever leads the work on it, such as `NahuelGenchi`, shown in the README's table |
| `team` | Optional: the GitHub accounts of everyone else working on it |
| `kit` | Its console's kit, a folder in [`kit/`](../kit/), such as `gba` |
| `sources` | Every source of its code, each with a `name`, an `href`, its `license` (such as `MIT`, or `none`) and its `use`: `code` when code came in from it, or `guide` when it was only read. Code brought in without a license that allows it also needs `agreement`, a link to its authors' agreement, as [the standard](../docs/STANDARD.md#fair-to-everyone-who-helped) asks |
| `thread` | Its [progress thread](../docs/PREVIEWS.md#progress-threads), once there is one. The page links it as the game thread, where people follow the game and help with it |
| `preview` | Optional: the lead's team preview, which the page shows with a reminder that nobody has reviewed it |
| `ownCopy`, `extras`, `screen`, `share`, `glow` | The game's page, as for [every game on the site](../CONTRIBUTING.md#add-a-game) |
| `facts` | Optional: more lines for the game's box, each with a `label`, a `value`, and an `href` if it's a link, such as an article about it |

The rest of the game's page comes from its folder, not from the entry:

- **Code ported** comes from `proof/port-map.json`, which `npm run dp -- portmap` writes from the names of the original's functions in the game's code, and from `proof/progress.json`, which only `npm run dp -- prove` writes, from recorded play that matched the original ([How progress is measured](../docs/STANDARD.md#how-progress-is-measured)).
- **Gameplay proven** comes from `proof/parts.json`, the game's parts, each counting the same, written by its lead. A part names the recording that proves it and the first and last of that recording's frames it covers, and it's proven when `prove` found every one of those frames matching. The page folds the parts away in one line under the two numbers, with the links to the evidence; opened, it lists every part, with its recording and frames once it has one.
- `npm run check` and the build check that both numbers add up with the code map, the port map, the parts and what `prove` found, so neither can be typed by hand.
- **The achievements** are counted from the game's list, if it keeps them on players' profiles ([Profiles and achievements](../docs/ACCOUNTS.md#for-a-game-dreamportsjs)).
- **The source code** is the folder itself, on GitHub.

The game's tasks are the open issues with its label, which is its folder's name, such as [`sonic-advance`](https://github.com/NahuelGenchi/dreamports/issues?q=is%3Aissue%20is%3Aopen%20label%3Asonic-advance).

The README's table of Dreamports comes from the entries too. `npm run dp -- prove` and `npm run dp -- portmap` write it whenever they change a game's numbers, and `npm run dp -- readme` writes it after an entry or a list of parts changes. `npm run check` says when it or a port map is out of date.

## The kits games start from

What every game on the same console shares, such as reading the player's copy, drawing, sound, controls, settings and saves, is that console's kit, in a folder of its own in [`kit/`](../kit/). The first is the Game Boy Advance kit, [`kit/gba/`](../kit/gba/README.md), whose guide shows how a new Game Boy Advance game starts from it. When the site is built, each kit is copied as it is to `/kit/<console>/`, next to the games, so a game's pages load it with addresses relative to the page, such as `../../kit/gba/styles/kit.css`. Those addresses work the same on dreamports.net and on a file server run in the repository's folder.

A kit's folder follows a game's rules, but it isn't a page of its own, so it needs no `index.html`, only its license: kits use GPL-3.0-or-later, like the games. A kit holds only what any game on its console can use. What only one game needs stays in that game's folder, and nothing from any game ever goes in a kit.

## Trying a game on your computer

After [setting up the site on your computer](../CONTRIBUTING.md#run-the-site-on-your-computer), `npm run worker` builds it with every game in it and opens it at `http://localhost:8787`, with its profiles and a database on your computer. There, `http://localhost:8787/play/<game>/` plays the game the way dreamports.net does. `npm run build` followed by `npm run preview` shows the games too, without profiles. `npm run dev` shows only the site's own pages, not the games. While you work on a game, any static file server run in the repository's folder also plays it, at `/games/<game>/`, without the site's own files such as `/dreamports.js`, as [Sonic Advance Dreamport's README](sonic-advance/README.md#run-it-on-your-own-computer) shows. The server runs in the repository's folder rather than the game's so the game can load its kit. To let others try your work before it's merged, `npm run dp -- share` puts a preview of it online, as [Previews and progress threads](../docs/PREVIEWS.md) explains.

The build stops and says what's wrong if a game's or a kit's folder breaks one of these rules, or if the site grows past what Cloudflare's free plan takes: 20,000 files at most, and none bigger than 25 MiB.

## Removing a game

A game comes off the site in one commit: delete its folder, entry included, and write the README's table again with `npm run dp -- readme`. A game that keeps achievements is also listed in `src/lib/players.ts` and `public/dreamports.js`, as [Profiles and achievements](../docs/ACCOUNTS.md#for-a-game-dreamportsjs) explains, so those lines go in the same commit.
