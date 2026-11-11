# Keeping the live site up to date

[Back to README](../README.md) · [Contribution workflow](../CONTRIBUTING.md) · [The Make pages](MAKE.md) · [Built in: #277](https://github.com/NahuelGenchi/dreamports/issues/277)

## In plain words

Everything merged into `main` should be on [dreamports.net](https://dreamports.net) within minutes. Cloudflare builds the site on every merge, but its builds can fail before they start, through no fault of the code, and nothing tells anyone. That happened with [#274](https://github.com/NahuelGenchi/dreamports/pull/274): its numbers were right in `main`, while both of Sonic Battle Dreamport's cards kept showing the old ones, because Cloudflare had an incident with its builds that began three minutes before the merge.

So a workflow now compares the live site with `main`, after every merge and every half hour. While the site is behind, it asks for another build. If that doesn't work, it builds `main` itself and puts it live. If the site is still behind after that, it opens an issue, and closes it again once the site has caught up. A number on a card can't quietly be out of date any more.

## What it compares

The build writes which commit it was made from to [dreamports.net/build.json](https://dreamports.net/build.json), and the workflow, `.github/workflows/live-site.yml`, checks that it's the latest commit on `main`.

Then it reads the pages a visitor gets, and checks each Dreamport's two numbers, code ported and gameplay proven, against what its `proof/` folder makes: on its card in the Dreamports row, at `/dreamports/<id>/`, on its card in the Make row, at `/make/<game>/`, and in its place in that row, at `/make/`. It looks at both what a number says and how far its bar fills, as 5.35% and 4.9% both read 5%. A game with versions in more than one language has each version's numbers checked. The Make row's card shows them all, named by language. The game's own card shows one version at a time, so it keeps each version's numbers in a block of its own, and the check reads every block and that the only one showing at first is the version Play opens. `src/lib/cards.mjs` does this.

The same check runs at the end of every build, on `dist/`, by `src/integrations/live-site.mjs`. So a change that stops a card showing its game's numbers fails its pull request's check, and such a build never goes live.

## What it does while the site is behind

| After a merge | What happens |
| :--- | :--- |
| Up to 10 minutes | It waits for the merge's own build, which takes about five minutes. |
| At 10 minutes | It asks for another build through the Deploy Hook ([The Make pages](MAKE.md#setting-it-up)). A build that fails to start takes about nine minutes to say so. |
| At 20 minutes | It builds `main` on GitHub's machines and puts it live with `npx wrangler deploy`, the same two commands Cloudflare runs, if the repository has a `CLOUDFLARE_API_TOKEN` secret. |
| About 3 minutes later | If the site is still behind, it opens an issue titled "fix: dreamports.net is behind main", assigned to the repository's owner, and the run fails. |

A run every half hour does the same in a shorter time, in case the run after a merge was lost: it asks for a build at once, and after 10 minutes goes on to the next step. Later runs that find the issue open add nothing to it and don't fail, so there's one issue and one failure to read about, however long it lasts. The first run that finds the site up to date closes the issue with a comment.

A newer merge takes over from a run still looking at the commit before it, as only the latest commit matters.

## When its issue opens

Look at [Cloudflare's status page](https://www.cloudflarestatus.com/) first, for Workers Builds. If it shows an incident, there's nothing wrong here, and the workflow keeps trying. Then read the latest build's log, in Cloudflare's dashboard under Workers & Pages, the `dreamports` Worker, Deployments. A log that stops at "Initializing build environment" or "failed to initialize" is Cloudflare's side. An error from the build itself is this repository's, and is fixed with a pull request.

To put `main` live at once, without waiting, open the Live site workflow in the repository's Actions tab, press Run workflow and tick the box. It needs the token below.

## Setting it up

Everything here is free: GitHub Actions in a public repository, and the Workers Free plan. A build asked for while the site is behind comes out of the 3,000 build minutes a month on Cloudflare's free plan, at most two an hour, and one that fails to start uses none. Putting `main` live from GitHub's machines uses none.

The Deploy Hook is already set up, and [The Make pages](MAKE.md#setting-it-up) say how. The token is one more step, which only someone with the Cloudflare account can take, as its value must never go through anyone else or any chat:

1. In Cloudflare's dashboard, open [Account API tokens](https://dash.cloudflare.com/?to=/:account/api-tokens) and press Create Token.
2. Pick the **Edit Cloudflare Workers** template. Under Zone Resources, include only `dreamports.net`.
3. Create it and copy its value.
4. In this repository's Settings, Secrets and variables, Actions, add a repository secret named `CLOUDFLARE_API_TOKEN` with that value.

Without it, the workflow does everything else, and says so in an issue when Cloudflare's builds stay down. The token can change the live site, so it's only in the one step that deploys, on code from `main`, never on a pull request's. If it's ever seen where it shouldn't be, delete it in Cloudflare and make a new one.

## Trying a change

`npm run check` tests what's wrong with a page's cards, when a build is asked for and when an issue opens, and whole runs against a stand-in for the site, Cloudflare and GitHub, in `.github/live-site/test.mjs`. `npm run build` shows the card check, and `dist/build.json` the commit.
