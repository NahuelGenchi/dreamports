# Labels

[Back to README](../README.md) · [Contribution workflow](../CONTRIBUTING.md) · [Notices from rights holders](RIGHTS.md) · [Written in: #581](https://github.com/NahuelGenchi/dreamports/issues/581)

## In plain words

Labels are the faint pictures that drift behind the launcher, in rows from the bottom of the screen to the top. Anyone can ask for one, for free: a picture of exactly 240 x 60 pixels, filled with anything fit for everyone to see, such as their art, their studio or a project they love. A person from the Dreamports team looks at every label first, and each one stays up for 30 days.

A label appears only because someone asked for it. Every other place shows one of the site's own scenes instead: a small pixel-art picture its code draws, such as whales at sea, a castle under siege or a rocket launch, each one different, so the rows are always full and nothing on the screen repeats. A few places hold the site's own invitation, "Your art here" or "Your brand here", so people know they can ask. The scenes are never words, a brand, a game's art or a character, and the invitation is the only writing the site puts in the rows.

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

The rows sit behind everything, flush, with no space between labels, from the bottom edge of the screen up. Each drifts 6 pixels a second, the other way from the one below it, and repeats so it never ends. A row is exactly one place wider than the screen, so the moment a label leaves one side it comes back in on the other. Labels need places of 240 pixels, so whatever is left over goes to one or two narrower scenes in the row, between 120 and 240 pixels wide, which come back a few seconds after they leave (`src/scripts/label-rows.mjs`). No place is wider than a label, so a place and its repeat are never on the screen at once. The rows furthest from the game take labels first, so a few labels stay clear of it, and a row mostly off the screen takes them last.

A row glides smoothly, as one layer the browser moves on its own, so a busy page never makes it stutter. Gliding, a row spends most of its time between two screen pixels, where the screen blends each pixel with its neighbour, so a detail one pixel wide, like a dark outline against the sky, keeps going sharp and soft, and so do hard upright edges and dots. On screens where a picture's pixel is less than two of the screen's, those get a little of their neighbours once the row is drawn (`src/scripts/label-scenes/steady.mjs`): the strongest details, long upright edges, which the eye follows most, the dotted bands where one colour of a sky fades into the next, and always the line where two places meet, which flickered most. That's about one pixel in four, labels included, and it cuts the worst flicker to about a third while the rest stays crisp. Moving a whole pixel at a time was tried and dropped: at 6 pixels a second it looked like lag.

Every place without a label shows a scene from `src/scripts/label-scenes/`: one of 30 kinds, from a lighthouse on the cliffs, whales, a coral reef and penguins to a castle siege, tall ships, a night concert, a rocket launch and a ringed planet. Each is drawn in its own pixels, one to each screen pixel, and its time of day, people, animals and where they stand come from the place's own number. Places in a row fewer than ten apart, and every place in the two rows above and below, are never the same kind, and no two numbers make the same scene, so nothing repeats. A row's labels and scenes are drawn once, a few milliseconds at a time so the page never stutters, into one picture that the row shows twice, so they cost nothing as the rows move. `tools/test/label-scenes.test.mjs` checks every kind fills its place at any width and that the rows add up.

About one row in five, among those furthest from the game, holds the site's invitation in its first free place of a label's size: a little window like a handheld game's menu, saying YOUR ART HERE with a painter's palette or YOUR BRAND HERE with a star, over a sky and hills of its own (`src/scripts/label-scenes/invite.mjs`). That's two or three on most screens, and they never take a place someone asked for.

They're quiet on purpose. Each label and scene is tinted the site's blue once, as it's drawn, through the filters in `src/components/Labels.astro`, so the moving rows cost a phone nothing more. Rows show at 32% in light mode and 30% in dark, and fade to about a third of that around the game, where the page's own background lies over them. The games beside the chosen one have the page's colour behind them, so the rows don't show through.

They stand still when motion is calm, fade away in the full-screen views and while a game opens, and never take a press. The rows' code is `src/scripts/labels.ts`, their look is in `src/styles/global.css`, and the build's checks are `src/lib/labels.mjs`, tested by `tools/test/labels.test.mjs`.
