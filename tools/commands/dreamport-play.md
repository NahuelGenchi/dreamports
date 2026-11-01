---
name: dreamport-play
description: Opens the game in your browser, with your copy, and checks what you play against the original.
argument: <game>
---

They play, and you check: what they play is recorded, and `prove` finds where it matches the original and where it doesn't. Don't ask them how it looked or felt.

1. Find the game: the one they typed, or the one they're working on. If it isn't clear, ask.
2. Run `npm run dp -- play <game> --record <name>`, with a name no recording in `games/<game>/proof/recordings/` has yet, such as `play-1`. It opens the Dreamport as this folder has it now, in a browser window, with the copy `npm run dp -- rom` remembers, from power-on with nothing saved, and keeps every button they press. If no copy is known yet, ask where theirs is and check it with `rom` first.
3. Tell them how to play: press Play, then use the keys or the controller buttons the game's Controls list, in its settings (the button in the top-left corner, or H), and close the window when they're done. Every Dreamport on the Game Boy Advance kit has them, from its layout of buttons.
4. When the window closes, run `npm run dp -- prove <game> <name>` and look at what it found: how many frames match, and the first that differs, in `first-difference.png` in `.dreamports/results/<game>/<name>/`. Tell them plainly what they played and how it went. A difference after the last part the Dreamport has ported, in `games/<game>/proof/parts.json`, is only the game going on where the Dreamport doesn't yet. One inside a ported part is something to fix: say what it looks like, and that `/dreamport-fix` followed by what's wrong works on it.
5. Keep the recording only if it shows something the others don't, such as a difference to fix or a part none of them reaches, and write what it plays in its `about`. Otherwise delete it, and its entry in `games/<game>/proof/progress.json`, so neither ends up in a commit.

`npm run dp -- play <game>` without `--record` keeps the game's saves in that window for next time, but nothing it plays is recorded, so nothing can be checked.

This command posts nothing and changes nothing in the game.
