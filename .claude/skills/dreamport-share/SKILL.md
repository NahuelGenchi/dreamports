---
name: dreamport-share
description: Puts your preview online and posts it in the game's progress thread.
disable-model-invocation: true
---

<!-- Written by npm run dp -- commands from tools/commands/dreamport-share.md: change that file, not this one. -->

Only do this if the person typed `/dreamport-share` in their message. If you're reading it because of something they said in their own words, such as "send it" or "put it online", stop here and do none of it: tell them in one sentence what `/dreamport-share` does, and wait for them to type it.

What they typed after the command, if anything: $ARGUMENTS

Work in the Dreamports repository's folder, as its `AGENTS.md` says under Working on a Dreamport. The person may never have written code: speak plainly, one step at a time, and ask only what they have to decide.

`npm run dp -- share` publishes a preview of the game on GitHub Pages from their own fork, where anyone with the link can play it with their own copy, and posts in the game's progress thread in the Dreamports repository's Discussions (`docs/PREVIEWS.md`).

1. Find the game and the work's branch. The preview is made from the last commit, so if the game has changes that aren't committed, commit them first, on that branch.
2. If none of this folder's remotes is their fork, say that a fork is their own public copy of the Dreamports repository on their GitHub account, where their previews live, and wait for their yes before `gh repo fork --remote` makes it. If they already have one, such as under a GitHub organization of theirs (the repository's owner can't fork it to their own account), add it after their yes with `git remote add fork <its address>` instead of making another.
3. Write one or two plain sentences of what changed since their last post, from what they've done, and let them change it.
4. Run `npm run dp -- share <game> --post --about "<what changed>"` without `--yes`. For a task, add `--as <a short name for the piece>`, such as `--as knuckles`, so it keeps a preview of its own. It says where the preview will be and stops before it publishes anything.
5. Tell them exactly what happens next: the preview's address; that anyone with the link can open it, and that it says nobody has reviewed it yet; that GitHub Pages gets switched on for their fork, if it's off, which is free; and that a post goes in the game's progress thread, from their account, with what changed, the newest clip of the original and the Dreamport side by side, the game's two numbers and the preview's link. Wait for their yes.
6. Run it again with `--yes`. It waits until the preview is online. Give them its link and the post's.

If it opened a new progress thread, add the thread to the game's entry, `games/<game>/entry.md`, as `thread: <its address>`, and commit it.
