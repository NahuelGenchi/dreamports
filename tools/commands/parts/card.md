# The game's card

For a game whose `games/<game>/entry.md` has no `screen`, in the `/dreamport` command.

## First, as soon as you can

Run `npm run dp -- capture <game> --open --yes`, which opens a window and returns at once, though the first time it builds the reference emulator, which takes a few minutes, so give it your shell's longest time limit. If it says the window is open, tell them in these words and carry on, never waiting for it, whatever they do: `A window is open where you can play the game for a minute, press Finish and choose the moment for its card. That's up to you, and I'm carrying on either way.` If it says anything else, such as that no window could open, say nothing and carry on.

## Before the pull request

Run `npm run dp -- capture <game> --pick --yes`, which ends the window once nobody is using it and keeps what they chose, or else the best of what they played, and sends it as a pull request of its own. If it says nobody played, the card is yours: write a list of presses to `.dreamports/captures/<game>/presses.json`, as a recording has them, from power-on, through the first screens to real play and then moving around for a minute, starting from the presses of a recording if one gets further, and run `npm run dp -- capture <game> --from .dreamports/captures/<game>/presses.json --yes`. If it finds no moment to show, it says in numbers what each stretch led to, and real play is where much of the screen moves: change the presses and run it again, at most five times, then leave the card and go on. Never look at the pictures it makes. Commit what it wrote, `public/media/<game>-dreamport.*` and the entry, as `feat: <game>'s card (#<issue>)`.

## In your last message

If they didn't choose the moment themselves, add one of these under Next. When `capture` kept one by itself: `I picked the moment for this game's card, as you didn't choose one. Just ask, and I'll open the window for you to choose another.` When it kept none: `This game's card waits for a few seconds of real play that you choose yourself. Just ask, and I'll open the window.`
