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

The first issue is #1 (M0). Later milestones may be created deliberately; assign them directly in GitHub.

M0, M1 and M2 are finished and closed. M3 is on hold: for now the work is only Sonic Advance Dreamport, in M4, which is the default for new issues.

## Issue and PR conventions

The work-item form requires a work type, milestone, scope, completion criteria, and constraints. Blank issues are disabled in the UI. API-created issues should include a line such as:

```text
Milestone: M4 — Sonic Advance Dreamport on dreamports.net
```

Issue and PR titles may start with a type prefix (`feat:`, `fix:`, `enh:`, `docs:`, `research:`, `ops:`), which the workflow turns into a label. Every work item gets its own new branch created from the latest `origin/main`, named `<type>/<issue>-<slug>`. One branch holds one issue; branches are not reused after merge and are deleted once their PR merges. Every PR must include a standalone closing reference to its scoped issue:

```text
Closes #123
```

Use one closing line per completed issue and `Refs #123` for unfinished parent or related work. Keep closing issues within the PR's milestone.

## Metadata-only automation

[`.github/workflows/project-tracking.yml`](../.github/workflows/project-tracking.yml) manages metadata, not software quality. It creates the milestones and tracking labels idempotently, processes issues before PRs, and fills missing milestones. An issue's explicit GitHub milestone wins; otherwise the form or `Milestone:` line is used, and unclassified issues fall back to M4.

PRs inherit a missing milestone from their first valid closing issue. PRs without a valid closing issue, or with a milestone mismatch, get the `needs-tracking` label; fix the body or milestone to clear it. The workflow does not comment.

The job uses inline Node.js and the repository's `GITHUB_TOKEN` with only issue and PR write permissions. It has no checkout, third-party action, build, or test. PR text is parsed as data, never executed. To repair metadata after a missed run, use **Actions → Project tracking → Run workflow**.

## Enforcement

The workflow does not block anything. The **main protection** branch ruleset does: every change to `main` goes through a pull request, and `main` can't be force-pushed or deleted. No approving review is required, so the owner can merge their own PRs. The ruleset was set up in #1.
