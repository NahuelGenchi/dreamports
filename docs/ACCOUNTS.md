# Profiles and achievements

[Back to README](../README.md) · [Research: #16](https://github.com/NahuelGenchi/dreamports/issues/16) · [Built in: #68](https://github.com/NahuelGenchi/dreamports/issues/68)

## In plain words

Players can make a **profile** on dreamports.net to keep the achievements they earn in Sonic Advance Dreamport, on any device. They sign in with an account they already have: **Google, Discord, Steam or GitHub**. The first time, they pick a player name and the profile is made. The site keeps only the id each service gives the account, never its email address, password, name or friends, and has no password of its own. A profile can link more than one of those accounts, so any of them signs in to it. A profile is private until its player makes it public.

The games played on dreamports.net load a small script, `/dreamports.js`. When a player earns an achievement, the game calls `dreamports.unlock(id)`, and the script saves it to the profile of whoever is signed in. With nobody signed in, it does nothing: the game keeps the achievement on the device, and the profile claims it when its player signs in. While signed in, the game also shows the achievements its player earned on other devices.

## Where it runs

Everything is on Cloudflare's free plan (#16):

- The site's pages are plain files, as before, and so are the games in [`games/`](../games/README.md). A small Worker, [`worker/index.ts`](../worker/index.ts), answers only `/api/`, `/players/<name>/` and `/play/` ([`wrangler.jsonc`](../wrangler.jsonc)).
- Profiles live in a D1 database, `dreamports-accounts`. Pull request previews use their own, `dreamports-accounts-previews`, so trying a preview never touches real profiles. The Worker makes its tables itself the first time it uses a database.
- Signing in is [`worker/ways.ts`](../worker/ways.ts): OAuth 2.0 with PKCE for Google, Discord and GitHub, and OpenID 2.0 for Steam, with the Worker's own `fetch` and Web Crypto and no library. Each service's sign-in is free.
- On a computer, `npm run worker` builds the site and runs it at `http://localhost:8787` with the Worker and a local database. Steam signs in there as it is. Google, Discord and GitHub need their apps' secrets in a `.dev.vars` file next to `wrangler.jsonc` (`GOOGLE_CLIENT_SECRET=…`, one per line), which git ignores and which must never be committed.

Under `/play/`, the Worker serves the games in [`games/`](../games/README.md) from the built site. Away from dreamports.net (a preview, or `npm run worker`), it fetches any other game from the live site, so it can be tried with that copy's own profiles, while a game in `games/` never mixes in the live site's files. On dreamports.net a game with its own Worker, as Sonic Advance Dreamport has until [#75](https://github.com/NahuelGenchi/dreamports/issues/75), answers its `/play/<game>/` first.

## The sign-in apps

Google, Discord and GitHub each know the site as an app, which has an id and a secret. The ids aren't secret: they're in [`wrangler.jsonc`](../wrangler.jsonc) under `vars`, and again under `previews.vars`. The secrets are kept by Cloudflare as the Worker's secrets `GOOGLE_CLIENT_SECRET`, `DISCORD_CLIENT_SECRET` and `GITHUB_CLIENT_SECRET`. Without its secret, a service's button says the sign-in didn't work.

| Service | The app | It asks for |
| :--- | :--- | :--- |
| Google | An OAuth client (Web application) in the Google Cloud project "Dreamports", with the Google Auth Platform's branding set to Dreamports, in production | `openid` only: the account's id, with no email or name |
| Discord | The application "Dreamports" in the Discord Developer Portal, under OAuth2 | `identify` only, without `email` |
| GitHub | The GitHub App "Dreamports" on the owner's account, with no permissions and no webhook | Nothing beyond the public profile, of which the site keeps only the id |
| Steam | None: Steam's OpenID sign-in needs no app or key | The account's Steam id |

Each app sends players back only to the addresses it lists, `<site>/api/oauth/<service>/callback`, where `<service>` is `google`, `discord` or `github`, for these sites:

- `https://dreamports.net`
- `http://localhost:8787`, for `npm run worker`
- each pull request preview that should sign in, such as `https://<branch>-dreamports.<account>.workers.dev`. A new branch's preview needs its address added to the three apps; until then, its Google, Discord and GitHub buttons stop on the service's own page with an error. Steam works on any copy.

To set or change a secret: `npx wrangler secret put <NAME>` for dreamports.net, `npx wrangler preview base-config secret put <NAME>` for previews made from then on, and `npx wrangler preview secret put <NAME> --name <preview>` for a preview that already exists. Each one asks for the value; never paste a secret anywhere else.

## How a sign-in goes

1. The button opens `/api/oauth/<service>/start`. The Worker notes, in a cookie that lasts ten minutes, which service it is, a random `state` and a PKCE verifier, then sends the player to the service's own page.
2. The player signs in there and says yes. The service sends them back to `/api/oauth/<service>/callback` with a code. The Worker checks the `state`, trades the code (with the verifier and the app's secret) for the account's id, and forgets the rest. For Steam, Steam itself confirms the answer it signed.
3. If that account already signs in to a profile, the player is signed in. If not, the Worker notes the account for half an hour and the profile asks for a name; picking one makes the profile, and **Cancel** forgets the account.
4. The Worker sends the player back to `/profile/` with how it went: `?signed-in`, `?new`, `?linked`, or `?trouble=` `cancelled`, `taken`, `expired` or `failed`, each with `&way=<service>`. The profile reads it once and puts the address back to plain `/profile/`.

A signed-in player can link another account from **Signs in with** on their profile (`/api/oauth/<service>/start?link`). An account that already signs in to another profile can't be linked, and a profile's last way in can't be unlinked. Unlinking an account also signs the profile out on every other device, so whoever signed in through it is out too.

## What a profile keeps

| What | Why | Who sees it |
| :--- | :--- | :--- |
| The name the player picks: 3 to 20 letters, numbers, `-` or `_` | To tell profiles apart; two names that differ only in capitals are the same name | The player; everyone, once the profile is public |
| A random id | To link the rest together | Nobody: it's never shown |
| For each account it signs in with: the service, the id the service gives the account, when it was linked and last used | To sign in | Nobody but the player, in their data download |
| Each achievement, by game and id, with when it was earned | The point of the profile | The player; everyone, once the profile is public |
| Whether the profile is public | The player's choice; off by default | The player |
| Each session: a SHA-256 of its cookie's value, and when it started and ends | To keep the player signed in for a year, or until they sign out | Nobody but the player, in their data download |
| For half an hour after an account new to the site signs in: a SHA-256 of a cookie's value, the service and the account's id | So the player can pick a name | Nobody; it goes once the profile is made, the player cancels, or the half hour ends |

No email address, no password, no token from a service, no IP address and nothing about the device. The player can download all of it (`/api/me/data`, a JSON file) and delete all of it from the profile. Deleting also forgets the accounts it signed in with, so they're new to the site again.

The browser keeps up to three cookies, all `HttpOnly`, `Secure` and `SameSite=Lax`: `__Host-dreamports` while signed in (a year), `__Host-dreamports-oauth` while on a service's page (ten minutes), and `__Host-dreamports-new` while picking a name (half an hour). It also keeps a note, `dreamports:player` in `localStorage`, with the player's name, so `/dreamports.js` knows whether anyone is signed in without asking the site.

Players must be at least 13 to make a profile, the age most game sites use for the US children's privacy law (COPPA). This is a placeholder until the owner decides in #16, and sign-up only asks the player to confirm it.

## For a game: `/dreamports.js`

A game played on dreamports.net at `/play/<game>/` uses profiles in four steps:

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

4. **Show what the profile earned** with `dreamports.earned()`. It resolves to the signed-in player's achievements for the game when the page loaded, from every device, as an id → time map. With nobody signed in, or the site out of reach, it resolves to `{}`; it never throws. Show those as earned, with no popup, but **keep them apart from the device's map**: if another player signs in on that device, their profile claims the device's map, and it must hold only what was earned there.

   ```js
   const fromProfile = (await globalThis.dreamports?.earned?.()) ?? {};
   ```

To add a game, list it in [`src/lib/players.ts`](../src/lib/players.ts) (its entry in `src/content/games/`, its list of achievements, its `localStorage` key) and add its key to `DEVICE` in [`public/dreamports.js`](../public/dreamports.js). The list is an ES module the game publishes, exporting `ACHIEVEMENTS`, an array of `{ id, title, description }`; the profile reads titles and descriptions from it.

Sonic Advance Dreamport: the list is `/play/sonic-advance/src/achievements/list.js`, and the key is `onsoku.achievements`.

## The API

All of it is under `/api/`, answers in JSON, and is never cached. Anything that changes something needs the site's own `Origin`.

| Request | What it does |
| :--- | :--- |
| `GET /api/oauth/<service>/start` | Sends the player to the service's page to sign in; with `?link`, to link that account to the signed-in profile |
| `GET /api/oauth/<service>/callback` | Where the service sends the player back: signs in, links, or asks for a name |
| `GET /api/me` | The signed-in player's profile, or `{ "player": null }`, and `pending`: the service of an account waiting for a name, or `null` |
| `PATCH /api/me` `{ public }` | Makes the profile public or private |
| `DELETE /api/me` | Deletes the profile and everything in it, and signs out |
| `GET /api/me/data` | Everything the profile keeps, as a file to download |
| `DELETE /api/me/ways/<service>` | Unlinks that account, unless it's the profile's last way in |
| `POST /api/sign-up` `{ name, age: true }` | Makes the profile for the account waiting for a name, and signs in |
| `DELETE /api/sign-up` | Forgets the account waiting for a name |
| `POST /api/sign-out` | Signs out |
| `POST /api/achievements` `{ game, earned }` | Saves achievements, an id → time map, to the signed-in profile, and answers with `earned`: all the game's achievements on the profile |
| `GET /api/players/<name>` | A public profile: its name, when it was made and its achievements |

A sign-in on a service's page has ten minutes, and a name must be picked within half an hour. Times from a device are kept if they fall between 1 January 2026 and now; otherwise the time it arrived is kept. A profile keeps at most 500 achievements per game.

## Not done yet

- Leaderboards: phase 4 of #16.
- Limits on how fast one visitor can make profiles or send achievements.
- A game shows the profile's achievements only while it can reach the site: they aren't kept on the device for playing offline.
