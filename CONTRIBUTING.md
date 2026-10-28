# Contributing

Thanks for helping Dreamports! Keep the work small, traceable, and honest about its current limitations. Agents must also follow [AGENTS.md](AGENTS.md).

## Not a developer? You can still help

You don't need to write code to make Dreamports better. With a free GitHub account you can:

- **Suggest a port** made by another fan, for the site's mash-ups. Link its own page and say who made it.
- **Report a problem** on the site: a broken link, a page that looks wrong on your phone, a typo.
- **Share an idea** for something the site could do.

Open a new issue, choose **Work item**, and describe it in your own words. The form gives examples for every box. If you aren't sure which work type or milestone to pick, leave the defaults; the owner will sort it.

Please never attach ROMs, game files, or anything extracted from a game, and never post private details such as your email address.

## Run the site on your computer

You need [Node.js](https://nodejs.org/) 22 or newer. In a terminal, inside this folder:

```sh
npm ci
npm run dev
```

Then open <http://localhost:4321> in your browser. The page updates as you save files.

| Command | What it does |
| :--- | :--- |
| `npm run dev` | Runs the site on your computer while you work on it |
| `npm run check` | Looks for mistakes in the pages and the game files |
| `npm run build` | Makes the finished site in the `dist/` folder |
| `npm run preview` | Opens that finished site, to check it before it goes online |

## Add a game

Each game page comes from **one Markdown file** in [`src/content/games/`](src/content/games/). To add a game, copy one of the files there, give it a new name, and change the text. Nothing else needs editing: the menu finds the new file by itself. Dreamports appear in the **dreamports** row, and external ports and other games in the **mash-ups** row.

The file name becomes the page address. `src/content/games/my-port.md` appears at `/dreamports/my-port/`, `/external-ports/my-port/` or `/other-games/my-port/`, depending on its `kind`. Use lowercase letters, numbers and dashes.

The top of the file, between the two `---` lines, holds the details. The site is written in lowercase, so write these in lowercase too.

| Field | What to write |
| :--- | :--- |
| `title` | The game's name on the site, such as `sonic advance dreamport` |
| `kind` | `dreamport`, `external` (a port made by someone else) or `other` (a fan game that isn't a port) |
| `platform` | The short line under the game's name in the menu and above its title, such as `game boy advance` or `a mod for dead cells` |
| `year` | Optional: the year the original game came out |
| `added` | The day it was added, written as `2026-10-27` |
| `summary` | One sentence about the game, shown when its page is shared or found with a search engine |
| `lead` | The paragraph under the title on the game's own page |
| `ownCopy` → `text` | Which copy of the game it needs, and that dreamports never hosts game files |
| `ownCopy` → `confirm` | The sentence visitors tick, such as `i own sonic advance, and i’m using my own legal copy of the game.` |
| `ownCopy` → `links` | The play or download links. Each has a `label`, an `href` starting with `https://`, and an `icon`: `play` or `download`. The first is the main button |
| `ownCopy` → `note` | A short line shown once the box is ticked, such as where the link goes |
| `facts` | The rows of the "the game" box, each with a `label`, a `value` and, if it's a link, an `href` |
| `screen` | Optional, and only with the owner's own recording: `clip` (the recording), `still` (its first frame) and, for pixel-art games, `pixelated: true`, which keeps the pixels sharp. See below |
| `share` | Optional: the picture shown when the game's page is shared, such as `/media/my-port-share.png`. See below |
| `glow` | Optional: the colour of the light the game casts on the menu while it's selected, in quotes, such as `'#8fd1ff'` |

Below the second `---` is the page itself, in Markdown. `## ` lines become headings and the "on this page" list, `- ` lines become bullet points, and `1. ` lines become numbered steps.

**A game's recording** is a few seconds of the game being played, looping smoothly, saved as an animated WebP in [`public/media/`](public/media/). Its first frame goes next to it as a still WebP picture. The menu shows the still until someone selects the game, and keeps showing it when motion is set to calm. Keep the recording short and small, because visitors download it when they select the game. In the game's file it looks like this:

```yaml
screen:
  clip: /media/my-port.webp
  still: /media/my-port-still.webp
  pixelated: true
share: /media/my-port-share.png
glow: '#8fd1ff'
```

**A game's share picture** is what chat apps and social sites show when someone shares the game's page. It is 1200×630 pixels: the recording's still on the site's navy background (`#050a24`), saved in `public/media/`. Scale pixel-art stills by whole steps, such as three times, so the pixels stay sharp, and save them as PNG; save other games as JPEG. Without a share picture, the page shares the site's own picture.

Recordings come only from the owner's own play of their own projects: never box art, logos or pictures from publishers. A game without a recording gets a plain dreamports card.

Two rules keep the site honest:

- **Every play or download link goes in `ownCopy` → `links`,** never in the text below, so visitors always confirm they own the game first.
- **For an external port,** link its own page and credit the people who made it, by name.

Then run `npm run check` and `npm run build`. If a detail is missing or misspelled, they stop and name it. Finally, look at the menu and the new page in a browser at a phone width and a computer width, in light and dark mode.

## One work item, one delivery trail

1. **Start with an issue.** Reuse the issue that already owns the work, or open the work-item form. Record the goal, scope, completion criteria, dependencies, and milestone before editing files. Bugs, enhancements, documentation, research and repository operations are work items too.
2. **Create a new branch for the issue.** Every work item is developed on its own new branch, created from the latest `main`:

   ```sh
   git fetch origin
   git switch -c feat/3-first-version origin/main
   ```

   Name it `<type>/<issue>-<slug>`. Types are `feat`, `fix`, `enh`, `docs`, `research` and `ops`. One branch holds one issue: never reuse a merged or existing branch for new work, and never mix two features on one branch. Use focused commits such as `feat: add the Dreamports catalog page (#3)`. Do not commit directly to `main`. Delete the branch after its PR merges.
3. **Open a linked PR.** Include a standalone `Closes #N` line for each completed, same-repository issue. Set the PR to the same milestone as its primary issue. Split cross-milestone changes into separate PRs. Use `Refs #N` for unfinished parent or related work; it does not replace a closing reference to the scoped issue.
4. **Record the outcome.** Describe exactly what changed, which checks ran, and what was not run. Close the issue only when its stated scope is complete.

For non-file operations (repository settings, hosting, domains), put sanitized commands and results in the issue. When an operation produces no code change, deliver its lasting decision through a small documentation PR instead of an empty PR.

## What belongs where

**Issues** own scope, decisions, blockers, dependencies, and outcomes. **Milestones** group outcomes. **PRs** own the proposed diff and delivery record. **Documentation** owns reusable knowledge, not duplicate task status.

Every meaningful action must stay discoverable through that chain. Routine reads do not need separate issues. Split genuinely new scope into a linked issue instead of expanding a task indefinitely.

## Checks

A successful site build shows that the site builds, nothing more. Browser checks open the built site: name the browser and version, the pages, the widths (phone and desktop), light and dark mode, and what you saw. Report each separately in the PR's delivery record.

## Private data and game files

Dreamports never hosts ROMs, game files or assets extracted from games, and links only to projects that ask players to bring their own legal copy. Keep ROMs, saves, extracted assets, private email addresses, account IDs and credentials out of commits, issues, and PRs. The ignore rules are an accidental-staging guard, not permission to collect that data. If a secret is exposed, stop sharing it and revoke it.

Pictures of games appear only where the owner decides, and only from the owner's own recordings of their own projects. Never present an invented or reconstructed image as a capture.

## License

The project's own files are licensed under the MIT License ([LICENSE](LICENSE)), and contributions are accepted under the same license.

Game names and trademarks belong to their owners. Dreamports is an unofficial fan project, not affiliated with or endorsed by Sega, Nintendo, or any other publisher. Anything bundled from elsewhere, such as fonts or icons, needs a license compatible with MIT, its notices kept next to the files, and a line in the README credits.

## Documentation standard

Write clear English that someone who has never used GitHub can follow. Prefer specific paths and actionable instructions. Distinguish **implemented**, **planned**, **blocked**, and **unknown**. Do not invent commands, measurements, or compatibility. Update documentation in the same PR as the change it describes. Keep `README.md` approachable.

## Tracking automation is not branch protection

The metadata workflow assigns missing milestones and labels PRs that need tracking. It does not run checks. A separate branch ruleset requires a pull request for every change to `main`. See [docs/TRACKING.md](docs/TRACKING.md).
