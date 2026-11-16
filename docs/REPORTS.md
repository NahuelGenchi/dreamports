# Players' reports

When something in a Dreamport looks wrong, the player opens its settings, chooses **Report a problem**, picks what it was and presses **Send report**. The site gets what they just played, and anyone with their own copy can play exactly that again, next to the original. This page says what a report is, how the site keeps robots and floods out, and how the reports are read.

## What a report is

A report is the buttons the player held at each frame since the game started, which is all a recording is (`tools/README.md`, Recording play), with the game and its version, the address's start point when there is one, the save the game began from when it had one, and which of four reasons the player picked. There is no box to type in, so a report can't carry a message or a link. It holds no copy of the game, and nothing of who sent it beyond what that save holds.

The save goes because the same presses play something else from another save: the first report a player sent matched the original for 1,838 frames and then differed, as its game had begun from a save it didn't carry. It is the save memory as it was when the visit started, which the kit notes before the game writes over it (`kit/gba/save.js`), packed: a cartridge's save memory is mostly bytes never written, so 64 KB comes to a few thousand characters. A save holds the player's progress, records and settings in that game, and any name they typed in it, as Sonic Advance and Sonic Battle ask for one, with the names of those they played against in Sonic Advance. The view says so under its button, and the site's About card too. A report takes 24,000 characters of save at most, and one whose save is bigger, or can't be packed by an old browser, goes without it and says only that the game began from one.

As Send report is pressed the view shows the report going, then how it ended: sent, or not, with the reason picked and what to do next.

The kit keeps the presses in memory while the game runs (`kit/gba/session.js`) and sends nothing until the player presses Send (`kit/gba/ui/report-view.js`). What a report may hold, how its presses are packed and how one is checked are in one file all sides share, `kit/gba/report.js`.

## What the site does with one

The Worker (`worker/index.ts`) takes a report at `POST /api/reports`. It reads it with the same check the tools use, and refuses anything that isn't presses for a named game: a change out of order, a button the report doesn't name, or more than about two hours of play. A save has to unpack to no more than a cartridge's biggest save memory, 128 KB, and is kept beside its report and deleted with it. It keeps it in the accounts' database, in a table of its own, with no address: the sender is kept only as a hash of their address with the day and a secret, so one sender can be counted for a day and never followed past it.

## Keeping robots and floods out

The site runs on Cloudflare's free plan, where the Worker runs at most 100,000 times a day for everything, sign-in included. So the limits start before the Worker:

| Where | Limit |
| :--- | :--- |
| Cloudflare's edge, before the Worker runs | One address can send 5 reports in 10 seconds, and is then blocked for 10 |
| Cloudflare Turnstile | Checks, out of sight, that a person is sending, and shows itself only when it has to |
| One sender | 5 reports an hour and 20 a day |
| The whole site | 200 reports a day and 500 MB kept in all |
| Each report | At least five seconds of play, the same report kept once, deleted after 90 days |

The edge rule is the zone's one free rate limiting rule.

No limit is the player's to wait out. Where the site can't take a report at that moment, because it has had too many, the check didn't pass or the connection is down, the game keeps the report in the browser's own storage on the player's device and says **Report saved**. The next time a Dreamport opens it sends what waited, out of sight (`kit/gba/report-outbox.js`). Three reports wait at most, for a week at most, and nothing leaves the device until it's sent. Only a report the site says isn't one is turned down for good. A copy of a Dreamport run somewhere that takes no reports saves the presses as a file from the same button.

A pull request's preview uses the keys Cloudflare publishes for testing Turnstile, which always pass, and its own database, so the whole way can be tried there and nothing of it reaches the live site.

## Reading them

`npm run dp -- reports` fetches the reports sent since the last time and writes each as a recording in `.dreamports/reports/<game>/`, on the owner's computer, with the save it began from beside it, as `<name>.<key>.sav`: the save memory's bytes, which are the cartridge's own where the Dreamport saves as its cartridge does ([Saves](STANDARD.md#saves)). Only the owner's key reads them: the site holds it as its secret `REPORTS_KEY`, and the tools read it from `.dreamports/reports.key`, which never goes in a commit. To try one, copy its file into the game's `proof/recordings/` under a name of its own and run `npm run dp -- prove <version> <name> --quick`. Where every frame matches, the Dreamport did what the cartridge does, and there's nothing to fix. Where it differs, that's a bug worth an issue.

`prove` still starts both games with nothing saved, so a report from a game with a save may differ from where the game first read it, and the tools say which reports those are. Starting both from the report's save is [#1441](https://github.com/NahuelGenchi/dreamports/issues/1441).

## What's set up at Cloudflare

- A Turnstile widget, Dreamports reports, for dreamports.net, in managed mode. Its public key is `TURNSTILE_SITEKEY` in `wrangler.jsonc`, and its secret is the Worker's `TURNSTILE_SECRET`.
- The Worker's secret `REPORTS_KEY`.
- A rate limiting rule on the zone for `POST /api/reports`.

The Dreamports team added reports on 16 November 2026, in [#1354](https://github.com/NahuelGenchi/dreamports/issues/1354), and the save a report carries the same day, in [#1440](https://github.com/NahuelGenchi/dreamports/issues/1440).
