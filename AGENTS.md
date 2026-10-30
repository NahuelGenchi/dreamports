# Agent instructions

## The project

Dreamports is the source code for dreamports.net, a home for enhanced fan ports of classic games. A Dreamport is "the port fans always dreamed of: the game you remember, with the extras you wished it had"; use that wording rather than "dream means fan". The site lists the owner's own Dreamports (for example Sonic Advance Dreamport), external ports made by other people (links and credits only), and other fan games that aren't ports (for example Kirby's Dead Land). Every Dreamport keeps the rules in `docs/STANDARD.md`, whoever makes it (#73). The site is a static Astro site (#3); hosting it on Cloudflare is #4. Since #68 a small Worker adds players' profiles, signed in with Google, Discord, Steam or GitHub, and keeps the achievements games send through `/dreamports.js` (`docs/ACCOUNTS.md`). Since #23 the whole site is one screen that works like a game launcher: every page shows the menu, with that page's card open. Since #59 a card takes the menu's place as a full screen instead of opening over it.

Never describe something as working or complete unless a recorded check establishes it. A build is not a browser check.

## Layout

| Path | Contents |
| :--- | :--- |
| `README.md` | Front page of the repository, written for non-technical readers |
| `CONTRIBUTING.md` | Contribution workflow and rules |
| `docs/` | One record per decision or process (`docs/TRACKING.md`) |
| `.github/` | Issue form, PR template, tracking workflow, README images |
| `src/content/games/` | One Markdown file per game page; `src/content.config.ts` checks its fields |
| `src/pages/`, `src/layouts/`, `src/components/` | The site's pages and their shared parts |
| `src/scripts/launcher.ts` | The launcher: moving through the row, the cards, the launch, sounds and controllers |
| `src/scripts/profile.ts` | The profile and public player views: signing in, linked accounts, achievements, sign-out and deletion |
| `src/styles/global.css` | Colours (light and dark), type and layout for the whole site |
| `src/lib/site.ts` | Sections, their addresses and labels, the launcher's filters, and shared links |
| `src/lib/players.ts` | The games that keep achievements, and the rules for names and ids, shared with the Worker |
| `worker/` | The Worker: the accounts API under `/api/`, public profiles and sign-in with Google, Discord, Steam and GitHub (`worker/ways.ts`), with its own `tsconfig.json` |
| `public/` | Files served as they are: icons, the star, the social preview, font licenses, `dreamports.js` for the games, and the games' recordings in `public/media/` |
| `wrangler.jsonc` | How Cloudflare serves the built site from `dist/`, the Worker's addresses, and the accounts' D1 databases |

Commands: `npm run dev`, `npm run check` (the site and the Worker), `npm run build`, `npm run preview`, and `npm run worker` (the built site with the Worker and a local database, at `http://localhost:8787`). Site text uses normal capitals: sentences and labels start with one, and names keep theirs (games, platforms, people, Dreamports); key hints are written as on a keyboard (`Esc`, `Enter`). Play and download links live only in a game's `ownCopy.links`, behind the own-copy tick on the game's page.

## Working well here

- Start from the active issue, then read only the files involved.
- Keep the README and site text plain enough for someone who has never used GitHub.
- The site never hosts ROMs, game files or extracted game assets, and only links to projects that require players to bring their own legal copy.
- Pictures of games come only from the owner's own recordings, where the owner decides. Never use publishers' logos, box art or characters in the site's own design.

## Private data

ROMs, game files, saves, extracted assets, private email addresses, Cloudflare account IDs, tokens and other credentials stay out of commits, issues and PRs.

## Tracking and delivery

Every change (code, bug fixes, enhancements, docs, research and repository operations) belongs to an issue with a milestone in `NahuelGenchi/dreamports`, reused or created before editing. Every work item gets its own new branch created from the latest `origin/main`: `<type>/<issue>-<slug>` (`feat`, `fix`, `enh`, `docs`, `research`, `ops`). Never reuse a branch for a second item, never mix two issues on one branch, and never push to `main`. Use `type: summary (#N)` commits. Delete the branch after its PR merges. PRs follow `.github/pull_request_template.md`: a standalone `Closes #N` line, the issue's milestone, and `Refs #N` for unfinished parent work. Decisions, exact changed paths and blockers go in the issue or PR. See `CONTRIBUTING.md` and `docs/TRACKING.md`.

## Final report

Report the issue, the PR and what changed. Keep these separate: site builds and browser checks (exact commands, pages, widths and outcomes, or "none run"), and source/diff review scope.
