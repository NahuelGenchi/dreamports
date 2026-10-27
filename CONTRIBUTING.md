# Contributing

Thanks for helping Dreamports! Keep the work small, traceable, and honest about its current limitations. Agents must also follow [AGENTS.md](AGENTS.md).

## Not a developer? You can still help

You don't need to write code to make Dreamports better. With a free GitHub account you can:

- **Suggest a port** for the External ports section: a fan port made by someone else. Link its own page and say who made it.
- **Report a problem** on the site: a broken link, a page that looks wrong on your phone, a typo.
- **Share an idea** for something the site could do.

Open a new issue, choose **Work item**, and describe it in your own words. The form gives examples for every box. If you aren't sure which work type or milestone to pick, leave the defaults; the owner will sort it.

Please never attach ROMs, game files, or anything extracted from a game, and never post private details such as your email address.

## One work item, one delivery trail

1. **Start with an issue.** Reuse the issue that already owns the work, or open the work-item form. Record the goal, scope, completion criteria, dependencies, and milestone before editing files. Bugs, enhancements, documentation, research and repository operations are work items too.
2. **Create a new branch for the issue.** Every work item is developed on its own new branch, created from the latest `main`:

   ```sh
   git fetch origin
   git switch -c feat/3-first-version origin/main
   ```

   Name it `<type>/<issue>-<slug>`. Types are `feat`, `fix`, `enh`, `docs`, `research` and `ops`. One branch holds one issue: never reuse a merged or existing branch for new work, and never mix two features on one branch. Use focused commits such as `feat: add the Dreamports catalog page (#3)`. Do not commit directly to `main`. Delete the branch after its PR merges.
3. **Open a linked PR.** Include a standalone `Closes #N` line for each completed, same-repository issue. Set the PR to the same milestone as its primary issue. Split cross-milestone changes into separate PRs. Use `Refs #N` for unfinished parent or related work; it does not replace a closing reference to the scoped issue.
4. **Record the outcome.** Describe exactly what changed, which checks ran, and what was not run. Close the issue only when its stated scope is complete.

For non-file operations (repository settings, hosting, domains), put sanitized commands and results in the issue. When an operation produces no code change, deliver its lasting decision through a small documentation PR instead of an empty PR.

## What belongs where

**Issues** own scope, decisions, blockers, dependencies, and outcomes. **Milestones** group outcomes. **PRs** own the proposed diff and delivery record. **Documentation** owns reusable knowledge, not duplicate task status.

Every meaningful action must stay discoverable through that chain. Routine reads do not need separate issues. Split genuinely new scope into a linked issue instead of expanding a task indefinitely.

## Checks

A successful site build shows that the site builds, nothing more. Browser checks open the built site: name the browser and version, the pages, the widths (phone and desktop), light and dark mode, and what you saw. Report each separately in the PR's delivery record.

## Private data and game files

Dreamports never hosts ROMs, game files or assets extracted from games, and links only to projects that ask players to bring their own legal copy. Keep ROMs, saves, extracted assets, private email addresses, account IDs and credentials out of commits, issues, and PRs. The ignore rules are an accidental-staging guard, not permission to collect that data. If a secret is exposed, stop sharing it and revoke it.

Pictures of games appear only where the owner decides, and only from the owner's own recordings of their own projects. Never present an invented or reconstructed image as a capture.

## License

The project's own files are licensed under the MIT License ([LICENSE](LICENSE)), and contributions are accepted under the same license.

Game names and trademarks belong to their owners. Dreamports is an unofficial fan project, not affiliated with or endorsed by Sega, Nintendo, or any other publisher. Anything bundled from elsewhere, such as fonts or icons, needs a license compatible with MIT, its notices kept next to the files, and a line in the README credits.

## Documentation standard

Write clear English that someone who has never used GitHub can follow. Prefer specific paths and actionable instructions. Distinguish **implemented**, **planned**, **blocked**, and **unknown**. Do not invent commands, measurements, or compatibility. Update documentation in the same PR as the change it describes. Keep `README.md` approachable.

## Tracking automation is not branch protection

The metadata workflow assigns missing milestones and labels PRs that need tracking. It does not run checks. A separate branch ruleset requires a pull request for every change to `main`. See [docs/TRACKING.md](docs/TRACKING.md).
