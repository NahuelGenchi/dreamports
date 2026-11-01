# The Make pages

[Back to README](../README.md) · [Contribution workflow](../CONTRIBUTING.md) · [Claims and teams](TEAMS.md) · [Built in: #143](https://github.com/NahuelGenchi/dreamports/issues/143)

## In plain words

Every Dreamport being made has a page in the Make tab on [dreamports.net](https://dreamports.net/make/). Besides its parts and the sentence to paste into a coding agent, it shows two things that live on GitHub: how many of the game's **pieces** are free to take, and its **steps**, the work that has been merged into it, the latest first. Nobody writes them by hand. The site reads them from GitHub each time it's built, and it's built again within a few minutes whenever they change.

## What a page shows

- **Pieces free to take** are the open issues under the game's issue, its [New Dreamport issue](TEAMS.md), that nobody has claimed. The same number shows on the game's picture in the Make row, such as "19 free", and under its name.
- **Steps** are the game's merged pull requests: those in the game's milestone, which the claims workflow makes for each game, and those with the game's label, such as `sonic-advance`. Each shows its title without its `feat:` and issue number, the day it merged and a link to it. The page shows the latest one, with the others folded under it.

A game's pieces and its pull requests get their milestone and label from the claims and tracking workflows, so a step or a piece shows up on its own. An older pull request that belongs to a game shows up once it has the game's label.

## How it stays current

The site is built on Cloudflare, and each build reads GitHub's API: about three requests for each game, which `src/lib/making.ts` makes. So the pages are as current as the last build, and each of these starts one:

| What happens | What starts the build |
| :--- | :--- |
| A pull request merges | Cloudflare builds every change to `main` |
| The bot gives, takes back or releases a claim, or puts a new piece under its game | The claims workflow, `.github/workflows/claims.yml`, after its answer |
| Someone assigns, unassigns, closes, reopens, deletes or moves a piece by hand | The Make pages workflow, `.github/workflows/make-pages.yml` |

Both workflows start the build through a **Deploy Hook**, a private address Cloudflare gives that builds `main` when anything sends it a request. A build takes about two minutes, so a page shows a claim a few minutes after it's made. Cloudflare skips a second request while a build is still waiting, so many changes close together make one build.

Every build also publishes what it read, at [dreamports.net/make/github.json](https://dreamports.net/make/github.json). When GitHub doesn't answer a build, the build uses that instead, so the pages keep what they last showed. When neither answers, the build on Cloudflare stops and dreamports.net keeps the pages it has. A build on a contributor's computer goes on without steps or pieces.

## Setting it up

Everything here is free: GitHub Actions in a public repository, and Workers Builds on Cloudflare's free plan, which builds for up to 3,000 minutes a month. Nothing secret goes in the repository.

1. **The Deploy Hook.** In Cloudflare's dashboard, open Workers & Pages, then the `dreamports` Worker, then Settings, Builds, Deploy Hooks. Make one named `GitHub` for the branch `main` and copy its address.
2. **Its secret.** In this repository's Settings, Secrets and variables, Actions, add a repository secret named `CLOUDFLARE_DEPLOY_HOOK` with that address. Without it, the workflows say so and build nothing, as in a fork.
3. **A token, only if needed.** GitHub answers anyone 60 times an hour, which is plenty for a few builds an hour. If a build's log says the Make pages couldn't read GitHub because its hourly limit was reached, make a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with read-only access to public repositories and nothing else, and add it in Cloudflare's dashboard under the Worker's Settings, Builds, Variables and secrets, as a secret named `GITHUB_TOKEN`. It then gets 5,000 an hour.

The Deploy Hook's address works like a password: anyone who has it can start builds. If it's ever seen where it shouldn't be, delete the hook in Cloudflare, make a new one and put its address in the secret.

## Trying a change

`npm run build` reads GitHub the same way, with no token needed, and writes what it read to `dist/make/github.json`. To try a change on a test fork's issues and pull requests, build with that fork's name, such as `DREAMPORTS_REPOSITORY=dreamports/dreamports npm run build`; the games' entries still name their issues by number, so the fork needs issues with those numbers.
