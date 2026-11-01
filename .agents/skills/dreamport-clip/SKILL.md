---
name: dreamport-clip
description: Checks your latest step against the original and shows a clip of both.
disable-model-invocation: true
---

<!-- Written by npm run dp -- commands from tools/commands/dreamport-clip.md: change that file, not this one. -->

Only do this if the person typed `/dreamport-clip`, or `$dreamport-clip` in Codex, in their message. If you're reading it because of something they said in their own words, such as "send it" or "put it online", stop here and do none of it: tell them in one sentence what `/dreamport-clip` does, and wait for them to type it.

What they typed after the command, if anything, is in their message.

Work in the Dreamports repository's folder, as its `AGENTS.md` says under Working on a Dreamport. The person may never have written code: speak plainly, one step at a time, and ask only what they have to decide. In Codex the commands start with `$` instead of `/`, such as `$dreamport-play`.

The proof tools play the same button presses in the original and in the Dreamport, compare every frame and make a clip of both side by side (`tools/README.md`). The original runs in a reference emulator on this computer only.

1. Find the game they're working on, from the branch or what they've been doing. If it isn't clear, ask.
2. Make sure a recording plays the new step, in `games/<game>/proof/recordings/`. If none does, make one. The person can play it with `npm run dp -- play <game> --record <name>`, after another recording's presses with `--from <recording>:<frame>`: tell them which keys or controller buttons to use, and that closing the window saves it. A part played with nothing pressed can be written by hand.
3. Run `npm run dp -- portmap <game>` if the game's code changed, then `npm run dp -- prove <game> <recording>`. The first time, it builds the reference emulator, which takes a few minutes.
4. Tell them what it found, plainly: how many frames matched, the first frame that differs and where on the screen, the parts it proves, and the game's two numbers, code ported and gameplay proven. Never say it matches unless every frame did. Show them the clip, `.dreamports/results/<game>/<recording>/clip.mp4`, and `first-difference.png` beside it when a frame differs: open it for them, or give its full path.
5. If something differs, say what it looks like and that `/dreamport-fix` followed by what's wrong goes after it. When it all matches, `/dreamport-play` tries it and `/dreamport-share` puts it online.

The clip and the pictures show the game, so they stay in `.dreamports/` and never go in a commit. A clip of the original may go in a pull request, and nowhere else (`docs/STANDARD.md`, Clips). This command posts nothing.
