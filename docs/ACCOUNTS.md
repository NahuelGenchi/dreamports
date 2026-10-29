# Profiles and achievements

[Back to README](../README.md) · [Research: #16](https://github.com/NahuelGenchi/dreamports/issues/16) · [Built in: #68](https://github.com/NahuelGenchi/dreamports/issues/68)

## In plain words

Players can make a **profile** on dreamports.net to keep the achievements they earn in Sonic Advance Dreamport, on any device. They sign in with a **passkey**, which their device or password manager keeps, so there's no password and no email address. A profile is private until its player makes it public.

The games played on dreamports.net load a small script, `/dreamports.js`. When a player earns an achievement, the game calls `dreamports.unlock(id)`, and the script saves it to the profile of whoever is signed in. With nobody signed in, it does nothing: the game keeps the achievement on the device, and the profile claims it when its player signs in.

## Where it runs

Everything is on Cloudflare's free plan (#16):

- The site's pages are plain files, as before. A small Worker, [`worker/index.ts`](../worker/index.ts), answers only `/api/`, `/players/<name>/` and, away from dreamports.net, `/play/` ([`wrangler.jsonc`](../wrangler.jsonc)).
- Profiles live in a D1 database, `dreamports-accounts`. Pull request previews use their own, `dreamports-accounts-previews`, so trying a preview never touches real profiles. The Worker makes its tables itself the first time it uses a database.
- Passkeys are checked by [`worker/passkeys.ts`](../worker/passkeys.ts) with the Worker's own Web Crypto: no other service and no library.
- On a computer, `npm run worker` builds the site and runs it at `http://localhost:8787` with the Worker and a local database. Passkeys need the name `localhost`, not `127.0.0.1`.

Away from dreamports.net (a preview, or `npm run worker`), the Worker fetches the games under `/play/` from the live site, so they can be tried with that copy's own profiles. On dreamports.net each game's own Worker answers its `/play/<game>/` first.

## What a profile keeps

| What | Why | Who sees it |
| :--- | :--- | :--- |
| The name the player picks: 3 to 20 letters, numbers, `-` or `_` | To tell profiles apart; two names that differ only in capitals are the same name | The player; everyone, once the profile is public |
| A random id | To link the rest together | Nobody: it's never shown |
| The public half of each passkey, its algorithm, when it was made and last used | To check sign-ins | Nobody but the player, in their data download |
| Each achievement, by game and id, with when it was earned | The point of the profile | The player; everyone, once the profile is public |
| Whether the profile is public | The player's choice; off by default | The player |
| Each session: a SHA-256 of its cookie's value, and when it started and ends | To keep the player signed in for a year, or until they sign out | Nobody but the player, in their data download |

No email address, no password, no IP address and nothing about the device. The player can download all of it (`/api/me/data`, a JSON file) and delete all of it from the profile. Deleting also asks the player's password manager to forget the passkeys, where the browser supports it.

The browser keeps one cookie, `__Host-dreamports` (`HttpOnly`, `Secure`, `SameSite=Lax`, a year), and a note, `dreamports:player` in `localStorage`, with the player's name, so `/dreamports.js` knows whether anyone is signed in without asking the site.

Players must be at least 13 to make a profile, the age most game sites use for the US children's privacy law (COPPA). This is a placeholder until the owner decides in #16, and sign-up only asks the player to confirm it.

## For a game: `/dreamports.js`

A game played on dreamports.net at `/play/<game>/` uses profiles in three steps:

1. **Load the script** on the game's page:

   ```html
   <script src="/dreamports.js"></script>
   ```

2. **Unlock achievements** with `dreamports.unlock(id)`. The game comes from the page's address, so `/play/sonic-advance/` saves to `sonic-advance`. The call resolves to `true` once the achievement is saved, to `false` when nobody is signed in or it couldn't be saved, and never throws. Call it optionally, so the game works anywhere:

   ```js
   globalThis.dreamports?.unlock?.('hundred-rings');
   ```

   An id is lowercase letters, numbers and dashes, and never changes once shipped. If the same achievement comes twice, the earlier time is kept.

3. **Keep what was earned on the device** in `localStorage` as an id → time map (milliseconds since 1970). When a player signs in, the site claims that map for their profile, and `/dreamports.js` sends it again each time the game loads, in case an unlock didn't reach the site.

To add a game, list it in [`src/lib/players.ts`](../src/lib/players.ts) (its entry in `src/content/games/`, its list of achievements, its `localStorage` key) and add its key to `DEVICE` in [`public/dreamports.js`](../public/dreamports.js). The list is an ES module the game publishes, exporting `ACHIEVEMENTS`, an array of `{ id, title, description }`; the profile reads titles and descriptions from it.

Sonic Advance Dreamport: the list is `/play/sonic-advance/src/achievements/list.js`, and the key is `onsoku.achievements`.

## The API

All of it is under `/api/`, answers in JSON, and is never cached. Anything that changes something needs the site's own `Origin`.

| Request | What it does |
| :--- | :--- |
| `GET /api/me` | The signed-in player's profile, or `{ "player": null }` |
| `PATCH /api/me` `{ public }` | Makes the profile public or private |
| `DELETE /api/me` | Deletes the profile and everything in it, and signs out |
| `GET /api/me/data` | Everything the profile keeps, as a file to download |
| `POST /api/sign-up/options` `{ name, age: true }` | Starts a new profile: the options for a new passkey |
| `POST /api/sign-up` `{ passkey }` | Checks the new passkey, makes the profile and signs in |
| `POST /api/sign-in/options` | Starts a sign-in: the options for a passkey |
| `POST /api/sign-in` `{ passkey }` | Checks the passkey and signs in |
| `POST /api/sign-out` | Signs out |
| `POST /api/passkeys/options`, `POST /api/passkeys` | Adds another passkey to the signed-in profile |
| `POST /api/achievements` `{ game, earned }` | Saves achievements, an id → time map, to the signed-in profile |
| `GET /api/players/<name>` | A public profile: its name, when it was made and its achievements |

A passkey challenge lasts five minutes and works once. Times from a device are kept if they fall between 1 January 2026 and now; otherwise the time it arrived is kept. A profile keeps at most 500 achievements per game.

## Not done yet

- Leaderboards: phase 4 of #16.
- Limits on how fast one visitor can make profiles or send achievements.
- Sonic Advance Dreamport doesn't load `/dreamports.js` yet; that's a one-line change in its own repository.
