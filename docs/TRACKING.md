# Work tracking

[Back to README](../README.md) · [Contribution workflow](../CONTRIBUTING.md) · [Issues](https://github.com/NahuelGenchi/dreamports/issues) · [Milestones](https://github.com/NahuelGenchi/dreamports/milestones) · [PRs](https://github.com/NahuelGenchi/dreamports/pulls)

## In plain words

Every change to Dreamports leaves a trail you can follow:

1. An **issue** says what should change and why.
2. A **branch** holds the work for that one issue.
3. A **milestone** groups the issue with others that reach the same goal.
4. A **pull request** delivers the work, says how it was checked, and closes the issue.

So for anything on the site, you can find out who asked for it, why, and how it was checked.

## Sources of truth

| Record | Owns |
| :--- | :--- |
| Issue | Scope, completion criteria, dependencies, decisions, blockers, outcome |
| Milestone | A coherent project outcome; no invented due dates |
| Pull request | A focused diff, closing issue reference, milestone, and delivery record |
| Documentation | Reusable project knowledge, not duplicate progress reports |

Track all meaningful work: pages, features, bugs, enhancements, docs, research, hosting, the domain and repository settings. Reuse an existing issue when the scope already fits.

## Milestones

| Key | Exact title | Scope |
| :--- | :--- | :--- |
| M0 | M0 — Project foundation | Repository, documentation, the tracking system, and the presentation of the project |
| M1 | M1 — First version of the site | The Dreamports website built with Astro: the home page, Dreamports, external ports, other games, and the about and legal page, easy to read on phones and computers |
| M2 | M2 — Live on dreamports.net | The site hosted on Cloudflare at dreamports.net and updated from main, with HTTPS, the www redirect, privacy-friendly analytics, and a contact address |
| M3 | M3 — Growth | New entries, and features that make the catalog easier to explore, such as search, filters, news, and link previews |
| M4 | M4 — Sonic Advance Dreamport on dreamports.net | Sonic Advance Dreamport played at dreamports.net, with accounts, achievements and leaderboards, on free Cloudflare services |
| M5 | M5 — Game launcher | The site as a one-screen game launcher: a row of games to move through, filters, panels such as settings and about, and a launch animation, on phones and computers |
| M6 | M6 — Anyone can make a Dreamport | Anyone can make or help with a Dreamport in this repository: the Dreamport standard, games played from here, proof of progress with clips and a percentage, previews on GitHub Pages that need no approval, claims and teams, and a step-by-step guide with commands for coding agents |
| M7 | M7 — New games join the launcher on their own | A lead's entry reaches the launcher with everything wired in and a real capture of the game, with one approval from the team for the picture and a review for code |
| M8 | M8 — Lighter tools, on any console | The proof tools and `/dreamport` take less memory, processor, graphics chip, electricity and agent tokens, go faster with the same proof, and are ready for games on other consoles |
| M9 | M9 — Dreamports made with publishers | Rights holders can work with the Dreamports team instead of only asking for takedowns: a way to get in touch, a written offer, and Dreamports made under their license and approval |

The first issue is #1 (M0). Later milestones may be created deliberately; assign them directly in GitHub.

A Dreamport's own issues, opened with the New Dreamport and Task forms, go in the game's milestone instead: the one its issues already use, which for Sonic Advance Dreamport is M4, or one named after the game, such as *Sonic Battle Dreamport*, which the claims workflow makes ([Claims and teams](TEAMS.md#how-the-bot-works)).

M0, M1, M2 and M6 are finished and closed. M3 is on hold: for now the work is Sonic Advance Dreamport, in M4, the game launcher, in M5, and Sonic Battle Dreamport, in its own milestone. M4 is the default for new issues.

## Issue and PR conventions

The work-item form requires a work type, milestone, scope, completion criteria, and constraints. A Dreamport's own work has two more forms, New Dreamport and Task, which [Claims and teams](TEAMS.md) explains. Blank issues are disabled in the UI. API-created issues should include a line such as:

```text
Milestone: M4 — Sonic Advance Dreamport on dreamports.net
```

Issue and PR titles may start with a type prefix (`feat:`, `fix:`, `enh:`, `docs:`, `research:`, `ops:`), which the workflow turns into a label. Every work item gets its own new branch created from the latest `origin/main`, named `<type>/<issue>-<slug>`, and `npm run dp -- update <game>` brings a game's branch up to date when `main` moves. The Readme workflow is the one exception to all of this: every three hours it writes the table in `docs/STATUS.md` and the progress maps from `main`, in a small pull request of its own on `ops/readme-table`, which it merges itself and which has no issue of its own or checks, as it only holds what the tools wrote. One branch holds one issue; branches are not reused after merge and are deleted once their PR merges. Every PR must include a standalone closing reference to its scoped issue:

```text
Closes #123
```

Use one closing line per completed issue and `Refs #123` for unfinished parent or related work. Keep closing issues within the PR's milestone. A PR that must not close anything, such as a draft or a game's capture, has only its `Refs` lines, and those count in its closing lines' place.

## Metadata-only automation

[`.github/workflows/project-tracking.yml`](../.github/workflows/project-tracking.yml) manages metadata, not software quality. It creates the milestones and tracking labels idempotently, processes issues before PRs, and fills missing milestones. An issue's explicit GitHub milestone wins; otherwise the form or `Milestone:` line is used, and unclassified issues fall back to M4. Issues with a *Game folder*, from the New Dreamport and Task forms, are left to [`claims.yml`](../.github/workflows/claims.yml), which puts them in their game's milestone.

PRs inherit a missing milestone from their first valid closing issue, or, with no closing line, from the first issue a standalone `Refs` line names. PRs with no valid issue either way, or with a milestone mismatch, get the `needs-tracking` label; fix the body or milestone to clear it. A milestone a PR already has stays, so a PR in a different milestone from its issue stays marked until someone changes it. The workflow does not comment.

The job uses inline Node.js and the repository's `GITHUB_TOKEN` with only issue and PR write permissions. It has no checkout, third-party action, build, or test. PR text is parsed as data, never executed. To repair metadata after a missed run, use **Actions → Project tracking → Run workflow**.

GitHub keeps only the newest waiting run in a concurrency group. Runs started by events share one group and replace one another while they wait, which saves runs, as each covers every open record. Only a full run, on a push to `main` or by hand, covers closed records, so full runs wait in a group of their own and a burst of events can't push one out.

## Enforcement

The workflow does not block anything. The **main protection** branch ruleset does: every change to `main` goes through a pull request, and `main` can't be force-pushed or deleted. No approving review is required, so the owner can merge their own PRs. The ruleset was set up in #1.
