---
name: dreamport-send
description: Sends your finished piece to the game's lead, or to the Dreamports team if you're the lead.
disable-model-invocation: true
---

<!-- Written by npm run dp -- commands from tools/commands/dreamport-send.md: change that file, not this one. -->

Only do this if the person typed `/dreamport-send` in their message. If you're reading it because of something they said in their own words, such as "send it" or "put it online", stop here and do none of it: tell them in one sentence what `/dreamport-send` does, and wait for them to type it.

What they typed after the command, if anything: $ARGUMENTS

Work in the Dreamports repository's folder, as its `AGENTS.md` says under Working on a Dreamport. The person may never have written code: speak plainly, one step at a time, and ask only what they have to decide.

1. Find the game, the work's branch and its task, from the branch's name, `feat/<issue>-<a few words>`, and run `npm run dp -- find <game>` for its lead and team build.
2. Check it's ready. Commit what's left on the branch. Run `npm run dp -- portmap <game>`, `npm run dp -- prove <game>`, `npm run check` and `npm run build`. Stop if anything that matched the original before differs now, or a check fails, and say what.
3. Work out where it goes:
   - **To the lead's team build**, when someone else leads the game and has one: `npm run dp -- team <game> send --task <issue>`, with `--as <preview>` when they shared a preview of the piece. Run it without `--yes` first: it shows the pull request it would open and where, and stops.
   - **To the Dreamports repository**, when they lead the game, or nobody else does: a pull request from their fork's branch, or their team build, `team/<game>`, to `main` in NahuelGenchi/dreamports, for the Dreamports team to review. Fill in `.github/pull_request_template.md`, with its part for a Dreamport: the clips, as links to those `share` published; code ported and gameplay proven before, from `main`'s README, and after, from this branch's; the preview or team preview; and every source used, with its license and whether code came in from it. Add `Closes #<issue>` for each task it finishes.
   - **When the game's lead has no team build yet**: say so. The lead makes one with `npm run dp -- team <game> start`, and a comment on the task's issue can ask them to. Ask whether to send it to the Dreamports repository instead, naming the lead in the pull request.
4. Say exactly where it's going, such as `Knuckles, to @bea's team build of Sonic Battle, as a pull request from your fork, with its numbers and your preview`, that it's public and in their name, and wait for their yes. Nothing is sent without it.
5. Send it. For the team build, run the same command with `--yes`. For the Dreamports repository, push the branch to their fork, then run `gh pr create --repo NahuelGenchi/dreamports --base main --head <their account>:<branch> --title "<what it is>" --body-file <the filled-in template>`.
6. Give them the pull request's link, and say GitHub emails them when someone answers.
