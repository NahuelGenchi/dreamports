---
name: dreamport-play
description: Opens the game in your browser, with your copy.
argument: <game>
---

1. Find the game: the one they typed, or the one they're working on. If it isn't clear, ask.
2. Run `npm run dp -- play <game>`. It opens the Dreamport as this folder has it now, in a browser window, with the copy `npm run dp -- rom` remembers. If no copy is known yet, ask where theirs is and check it with `rom` first.
3. Tell them how to play: press Play, then use the keyboard keys or the controller buttons the game's settings list. Its saves stay in that window for next time.
4. Ask them to say, in their own words, anything that feels different from the original. `/dreamport-fix` followed by what feels wrong works on it.

If they'd like what they play kept as a recording, `npm run dp -- play <game> --record <name>` starts the game from power-on and saves every button press when they close the window, for `/dreamport-clip` and `/dreamport-fix` to play again.

This command posts nothing and changes nothing in the game.
