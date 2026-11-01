---
name: dreamport-fix
description: Compares that moment with the original and fixes it.
argument: <what feels wrong>
---

What they typed after the command is what feels wrong, such as `the jump feels floaty`. If they typed nothing, take the first difference the last `prove` found inside a part the Dreamport has ported, and if there's none, say so.

1. Find the moment in a recording that reaches it. If none does, make one: they play it with `npm run dp -- play <game> --record <name>`, after another recording's presses with `--from <recording>:<frame>`, and closing the window saves it. Make sure it does what they described, such as a long jump if the jump feels floaty.
2. Run `npm run dp -- prove <game> <recording>`, with `--stills <frames>` around the moment, and look at what differs: `first-difference.png` and the pictures in `stills/`, in `.dreamports/results/<game>/<recording>/`, or, when it's the sound, the frames and the band of pitches `prove` names.
3. Find out why from how the original does it: the sources the game's entry, `games/<game>/entry.md`, lists, and the original's functions in its code map. Where a function has no C in its decompilation, or the game has no decompilation, `npm run dp -- read <game> <function>` prints its instructions from their copy, by its address or its name in the code map (`tools/README.md`, Reading the original's instructions). What it prints comes from their copy: never put it in a commit, an issue or a pull request. What you read goes to the company that runs your model, so reach their copy only through the tools, never with a hex dump or a script of your own. Don't guess at numbers: take them from the original.
4. Fix it in the Dreamport's code. Name the function of the original it rewrites in a comment, as the rest of the game's code does, so the port map finds it.
5. Run `npm run dp -- portmap <game>`, then `npm run dp -- prove <game>` with every recording, not only the new one: nothing that matched before may differ now. If something does, keep working, or say why.
6. Commit it on the work's branch as `fix: <what changed> (#<issue>)`, and show them the new clip, `.dreamports/results/<game>/<recording>/clip.mp4`, and the two numbers.

If the original does the same thing, it isn't a fix: say so, and that it could be an extra, switched off unless the player picks it. This command posts nothing.
