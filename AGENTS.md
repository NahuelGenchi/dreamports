# Agent instructions

## The project

Dreamports is the source code for dreamports.net, a home for enhanced fan ports of classic games ("dream" means "fan"). The site lists the owner's own Dreamports (for example Sonic Advance Dreamport), external ports made by other people (links and credits only), and other fan games that aren't ports (for example Kirby's Dead Land). The planned stack is a static Astro site hosted on Cloudflare (#3, #4). Until #3 merges, the repository holds only documentation and tracking files.

Never describe something as working or complete unless a recorded check establishes it. A build is not a browser check.

## Layout

| Path | Contents |
| :--- | :--- |
| `README.md` | Front page of the repository, written for non-technical readers |
| `CONTRIBUTING.md` | Contribution workflow and rules |
| `docs/` | One record per decision or process (`docs/TRACKING.md`) |
| `.github/` | Issue form, PR template, tracking workflow, README images |

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
