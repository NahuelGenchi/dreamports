# Labels

[Back to README](../README.md) · [Contribution workflow](../CONTRIBUTING.md) · [Notices from rights holders](RIGHTS.md) · [Written in: #581](https://github.com/NahuelGenchi/dreamports/issues/581)

## In plain words

Labels are the faint pictures that drift behind the launcher, in rows from the bottom of the screen to the top. Anyone can ask for one, for free: a picture of exactly 240 x 60 pixels, filled with anything fit for everyone to see, such as their art, their studio or a project they love. A person from the Dreamports team looks at every label first, and each one stays up for 30 days.

A label appears only because someone asked for it. Every other place shows one of the site's own designs instead: a small landscape or pattern its code draws, each one different, so the rows are always full and nothing on the screen repeats. The designs are never words, a brand, a game's art or a character.

## How someone asks

By email, at [hello@dreamports.net](mailto:hello@dreamports.net?subject=Label), with "Label" in the subject and the picture attached as a PNG, as the [About page](https://dreamports.net/about/#labels) asks. The address forwards to the Dreamports team. Nobody needs a GitHub account.

The sender's email address and name never go in a commit, an issue or a pull request, and the team keeps the email only to answer it.

## What a label must be

The build checks the picture itself and stops if one is wrong, so nothing broken reaches the site. A label must be a PNG of exactly 240 x 60 pixels, still rather than animated, and at most 64 KB. Its file name uses small letters, numbers and dashes, like `studio-name.png`.

A person checks the rest, as nothing can check it for them. A label must be fit for everyone to see, so nothing hateful, sexual, violent or misleading, and nothing the sender has no right to share. It never holds game art, publishers' logos or characters, since the site's own design never uses them and pictures of games on the site are only real captures of play (`docs/STANDARD.md#a-games-capture`). A label is never a link: the rows take no presses at all.

## Putting a label up

1. **Look at the picture**, at its real size and enlarged, against the rules above. If it breaks one, answer the sender and say which.
2. **Open an issue** for it, as for any change, which says only that someone asked for a label, never who.
3. **Add the picture** to `public/labels/`, and a line for it to `public/labels/labels.json` with the day it starts, written like `2026-11-05`:

   ```json
   [{ "file": "studio-name.png", "start": "2026-11-05" }]
   ```

4. **Build the site** with `npm run build`, which stops on a label that breaks a rule, then open the pull request and merge it. dreamports.net shows the label about a minute later.
5. **Answer the sender**, with the day their label ends.

## When a label ends

A label shows for 30 days from its start, and then the site leaves it out: every build drops it, and pages built before then hide it too. Its file and line can stay until someone tidies them away, as nothing shows them.

To take one down early, for instance because its sender or a rights holder asks, remove its file and its line in one commit and merge it at once.

## How the rows look

The rows sit behind everything, flush, with no space between labels, from the bottom edge of the screen up. Each drifts 6 pixels a second, the other way from the one below it, and repeats so it never ends, with one place more than the screen holds, so a place and its repeat are never on the screen at once. The rows furthest from the game take labels first, so a few labels stay clear of it.

Every place without a label shows a design from `src/scripts/label-designs.ts`: one of 18 kinds of picture, such as hills, a city at night, a checkerboard or confetti, with its colours, sizes and places drawn from the place's own number. Neighbours, and the places above and below, are never the same kind, and no two numbers make the same design, so nothing repeats. They're drawn at half a label's size, two screen pixels to each of theirs, once for each row, so they cost nothing as the rows move.

They're quiet on purpose. Each label and design is tinted the site's blue once, as it's drawn, through the filters in `src/components/Labels.astro`, so the moving rows cost a phone nothing more. Rows show at 32% in light mode and 30% in dark, and fade to about a third of that around the game, where the page's own background lies over them. The games beside the chosen one have the page's colour behind them, so the rows don't show through.

They stand still when motion is calm, fade away in the full-screen views and while a game opens, and never take a press. The rows' code is `src/scripts/labels.ts`, their look is in `src/styles/global.css`, and the build's checks are `src/lib/labels.mjs`, tested by `tools/test/labels.test.mjs`.
