# When the project is missing something

For the `/dreamport` command.

A task can need something the project doesn't have yet: the console's kit can't do what the original's code does, a tool can't check it, or a tool fails on their computer. That's never a question for the person, who can't answer it, so don't hand them a brief, a choice or a side job to start. Fix it yourself, as a piece of its own, and carry on with the task on top of it.

## Look first

Someone may have met it already. Search both with a few words of what's missing: `gh issue list --repo NahuelGenchi/dreamports --state all --search "<words>"` and `gh pr list --repo NahuelGenchi/dreamports --state all --search "<words>"`. If its fix has merged, `npm run dp -- update <version>` brings it in. If its pull request is open, build on it: bring it in as step 9 does, and write `Builds on #<number>` in the task's pull request. If only its issue is open, with no pull request, that issue is the one you fix.

## Fix it

Otherwise open its issue with `gh issue create --repo NahuelGenchi/dreamports --title "fix: <what's missing>" --body-file <file>`, under the headings `### Work type`, `### Milestone`, `### Goal and scope`, `### Completion criteria` and `### Dependencies, evidence, and constraints`, with the open milestone that fits best, as `gh api repos/NahuelGenchi/dreamports/milestones --jq '.[].title'` lists them. Start a branch for it alone, `fix/<issue>-<a few words>`, from the latest `main` of `NahuelGenchi/dreamports`, never from the task's branch, and put nothing of the game's task on it.

Three rules hold whatever it is:

- It adds what's missing and never makes a comparison looser. No frame, byte or sound is left out, no recording is changed, and nothing makes `prove`, `match` or `twin` say the same where they said different. A way through that does is closed, so take the one that keeps the comparison whole, however much longer it is.
- Nothing of the game goes in the kit, the tools or a test. Test it with a program of the project's own, the way the tests `CONTRIBUTING.md` lists for that kit or tool do, and add yours beside them.
- The console is the reference. Where the kit's README says how it keeps the console's time or its hardware, follow that.

It's done when `npm run check` passes with the tests of what you changed. Commit it as `fix: <what it is> (#<issue>)` and open its pull request as step 12 does for a change that isn't a Dreamport's, with `Closes #<issue>`, not as a draft. Then go back to the task's branch, merge the fix's branch into it, and write `Builds on #<its pull request>` in the task's pull request, which merges after it.

## When something has to be decided

A Dreamport is the original, one to one, and that answers every decision the work can meet. So none is ever left for the person, the game's lead or the project's owner, and none is a reason to stop. Where neither the code nor `docs/` says how the console or the project should behave, take the way closest to the real console: the one that compares more and leaves nothing out, even when it's the longer one. Check it against the reference emulator's source or the original's own instructions, and against a second reference where there is one. Then write what you chose and what shows it in the fix's issue and as a line in `docs/HISTORY.md`, and carry on.

## Really stuck

Stop only if ten rounds in a row have changed nothing, as with a frame that won't match. Then open the issue all the same, or add to the one that's there, with what's missing and what shows it: the frame, the addresses and what the tools printed, and nothing of the game. End as `tools/commands/parts/unfinished.md` says under Not finished, with that issue named in the sentence that says why and under the template's Limitations.

## Tell them

One line in your last message, under Done or Not finished, in plain words: `The project was missing <what>, so I added it: <its pull request>.` or `The project is missing <what>, so I reported it: <its issue>.`
