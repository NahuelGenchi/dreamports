# Agent instructions

## The project

Dreamports is the source code for dreamports.net, a home for enhanced fan ports of classic games. A Dreamport is "the port fans always dreamed of: the game you remember, with the extras you wished it had"; use that wording rather than "dream means fan". Every Dreamport keeps the rules in `docs/STANDARD.md`, whoever makes it, and every game made here lives in `games/`, on its console's kit in `kit/`.

This file is read on every request, so it stays short. Why things are as they are is in `docs/HISTORY.md`, one line per decision: before changing how something behaves, search it for a word, and don't read all of it. `npm run dp -- help <words>` prints one section of the long documents, such as `tools/README.md`, which take thousands of tokens to read whole.

Never describe something as working or complete unless a recorded check establishes it. A build is not a browser check.

## Layout

| Path | Contents |
| :--- | :--- |
| `README.md`, `CONTRIBUTING.md` | The repository's front page, for non-technical readers, and how to contribute |
| `docs/` | One record per decision or process (`docs/TRACKING.md`) |
| `.claude/skills/`, `.agents/skills/`, `.gemini/commands/` | The `/dreamport` command for each agent, written by `npm run dp -- commands` from `tools/commands/`: never edit them by hand |
| `.github/` | Issue forms, PR template, workflows, the moderation bot, first entries, the live site's guard, each game's progress map |
| `games/` | The games made here, one folder each, with `entry.md`, served at `/play/<game>/` (`games/README.md`) |
| `kit/` | What the games on one console share, one folder per console, served at `/kit/<console>/` |
| `tools/` | The proof tools, run on the contributor's computer only (`tools/README.md`) |
| `src/` | The Astro site: pages, launcher (`src/scripts/launcher.ts`), styles, and what it reads from `proof/` (`src/lib/`) |
| `worker/` | The Worker: accounts, profiles and achievements |
| `public/` | Files served as they are, with the games' recordings in `public/media/` and the labels behind the launcher in `public/labels/` (`docs/LABELS.md`) |

Commands: `npm run dev`, `npm run test:game`, `npm run check`, `npm run build`, `npm run preview`, `npm run worker`, and `npm run dp -- <tool>`, which lists the proof tools with no tool named. Site text uses normal capitals: sentences and labels start with one, and names keep theirs; key hints are written as on a keyboard (`Esc`, `Enter`). Play and download links live only in a game's `ownCopy.links`, behind the own-copy tick on the game's page.

## Working well here

- Start from the active issue, then read only the files involved.
- Keep the README and site text plain enough for someone who has never used GitHub.
- The site never hosts ROMs, game files or extracted game assets, and only links to projects that require players to bring their own legal copy.
- Pictures of games on the site are only real captures of play, chosen by a person when one is there, short and silent, which the team looks at before they appear (`docs/STANDARD.md#a-games-capture`). Nothing drawn, generated or reconstructed, ever. Clips that show the original next to a Dreamport, made by `prove`, may appear in pull requests, and nowhere else (`docs/STANDARD.md#clips`). Never use publishers' logos, box art or characters in the site's own design.

## Helping someone make a Dreamport

`/dreamport` (`$dreamport` in Codex) is the only command, and carries all its own instructions, so it needs nothing else from here: when they type it and you haven't loaded it, read `tools/commands/dreamport.md` and follow it. It starts only when they type it or paste a sentence that starts `Set up https://dreamports.net/code`, and `docs/MAKING.md`'s Getting ready says what to do with one in an empty folder. For anything they ask in their own words, read `docs/MAKING.md` first. Say everything to them ultra concisely, in natural, easy words, in a few short sections, with no lists, em dashes or emojis. Whatever you're doing, their copy of the game stays on their computer: you reach it only through the tools, and nothing from it goes in a commit or an issue. Anything public outside the command waits for their yes, and installing a program always does. Never ask for, read or type a password or token.

## Private data

ROMs, game files, saves, extracted assets, private email addresses, Cloudflare account IDs, tokens and other credentials stay out of commits, issues and PRs.

## Tracking and delivery

Every change (code, bug fixes, enhancements, docs, research and repository operations) belongs to an issue with a milestone in `NahuelGenchi/dreamports`, reused or created before editing. Every work item gets its own new branch created from the latest `origin/main`: `<type>/<issue>-<slug>` (`feat`, `fix`, `enh`, `docs`, `research`, `ops`). Never reuse a branch for a second item, never mix two issues on one branch, and never push to `main`. Use `type: summary (#N)` commits. Delete the branch after its PR merges. PRs follow `.github/pull_request_template.md`: a standalone `Closes #N` line, the issue's milestone, and `Refs #N` for unfinished parent work. Decisions, exact changed paths and blockers go in the issue or PR. See `CONTRIBUTING.md` and `docs/TRACKING.md`.

## Final report

Report the issue, the PR and what changed. Keep these separate: site builds and browser checks (exact commands, pages, widths and outcomes, or "none run"), and source/diff review scope.

This is for work on the project itself. When you're helping someone make a Dreamport, as in `/dreamport`, leave it out: end with what the command says to tell them, in plain words, with no lines about review scope or which checks ran.
