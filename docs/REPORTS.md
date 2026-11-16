# Players' reports

When something in a Dreamport looks wrong, the player opens its settings, chooses **Report a problem**, picks what it was and presses **Send report**. The site gets what they just played, and anyone with their own copy can play exactly that again, next to the original. This page says what a report is, how the site keeps robots and floods out, and how the reports are read.

## What a report is

A report is the buttons the player held at each frame since the game started, which is all a recording is (`tools/README.md`, Recording play), with the game and its version, the address's start point when there is one, whether the game began from a save, and which of four reasons the player picked. There is no box to type in, so a report can't carry a message, a link or anything personal. It holds no save, no copy of the game and nothing of who sent it.

As Send report is pressed the view shows the report going, then how it ended: sent, or not, with the reason picked and what to do next.

The kit keeps the presses in memory while the game runs (`kit/gba/session.js`) and sends nothing until the player presses Send (`kit/gba/ui/report-view.js`). What a report may hold, how its presses are packed and how one is checked are in one file all sides share, `kit/gba/report.js`.

## What the site does with one

The Worker (`worker/index.ts`) takes a report at `POST /api/reports`. It reads it with the same check the tools use, and refuses anything that isn't presses for a named game: a change out of order, a button the report doesn't name, or more than about two hours of play. It keeps it in the accounts' database, in a table of its own, with no address: the sender is kept only as a hash of their address with the day and a secret, so one sender can be counted for a day and never followed past it.

## Keeping robots and floods out

The site runs on Cloudflare's free plan, where the Worker runs at most 100,000 times a day for everything, sign-in included. So the limits start before the Worker:

| Where | Limit |
| :--- | :--- |
| Cloudflare's edge, before the Worker runs | One address can send 5 reports in 10 seconds, and is then blocked for 10 |
| Cloudflare Turnstile | Checks, out of sight, that a person is sending, and shows itself only when it has to |
| One sender | 5 reports an hour and 20 a day |
| The whole site | 200 reports a day and 500 MB kept in all |
| Each report | At least five seconds of play, the same report kept once, deleted after 90 days |

The edge rule is the zone's one free rate limiting rule. Past the site's daily limit the settings say to try again tomorrow. A copy of a Dreamport run somewhere that takes no reports saves the presses as a file from the same button.

A pull request's preview uses the keys Cloudflare publishes for testing Turnstile, which always pass, and its own database, so the whole way can be tried there and nothing of it reaches the live site.

## Reading them

`npm run dp -- reports` fetches the reports sent since the last time and writes each as a recording in `.dreamports/reports/<game>/`, on the owner's computer. Only the owner's key reads them: the site holds it as its secret `REPORTS_KEY`, and the tools read it from `.dreamports/reports.key`, which never goes in a commit. To try one, copy its file into the game's `proof/recordings/` under a name of its own and run `npm run dp -- prove <version> <name> --quick`. Where every frame matches, the Dreamport did what the cartridge does, and there's nothing to fix. Where it differs, that's a bug worth an issue.

A report from a game with a save says so, as the original starts with nothing saved and may differ from where the game first read it.

## What's set up at Cloudflare

- A Turnstile widget, Dreamports reports, for dreamports.net, in managed mode. Its public key is `TURNSTILE_SITEKEY` in `wrangler.jsonc`, and its secret is the Worker's `TURNSTILE_SECRET`.
- The Worker's secret `REPORTS_KEY`.
- A rate limiting rule on the zone for `POST /api/reports`.

The Dreamports team added reports on 16 November 2026, in [#1354](https://github.com/NahuelGenchi/dreamports/issues/1354).
