# A task that doesn't finish

For the `/dreamport` command.

## Too big

If the task is far too big for one session, such as a whole story mode, give it back with `/release` on its issue and open a smaller one, its first piece, with `gh issue create --repo NahuelGenchi/dreamports --title "Task: <what it is>" --body-file <file>`, under the headings `### Game folder`, `### Kind`, `### What it is`, `### Done when` and `### Taking it`, with `- [X] I'm taking this task myself.` under the last. `Kind` is one of `Foundation`, `Character`, `Level`, `Mode`, `Achievement`, `Extra`, `A difference from the original` or `Something else`. Make that one instead.

## Not finished

Then don't give up quietly and don't ask. Commit what you have, leave a note if you found something, and do step 12 with `gh pr create --draft`, or `team send --draft`, with `Refs #<issue>` instead of `Closes`, and under the template's Limitations the first frame that differs and what you know about why. Then your last message is these sections instead, in the same plain way:

```markdown
## Not finished

Task #Z isn't finished: <why, in one short sentence>. Draft pull request: <its link>

## Progress

The first difference went from <what `prove` said when you began, such as frame 781, by 26,479 pixels, or nothing made yet> to <what it says now, such as frame 782, by 98 pixels>.

## Next

`/dreamport <game>` carries on from there.
```

The line about the game's card goes under this Next too, as `tools/commands/parts/card.md` says.
