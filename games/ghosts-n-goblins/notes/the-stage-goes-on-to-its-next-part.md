# The stage goes on to its next part when the view passes a screen, with a new list of objects and its time again.

About: Stage 1: The graveyard; second-part

Proof: #983; second-part

Each round the game's task, at $D332, reads the screen where the next part begins from the list at $CD0B by the stage's place, $C2, and compares it with the view's. The first stage's first part ends at 6, so the second begins when the view is on screen 7, with Arthur 128 pixels into the eighth.

Then $D341 adds one to the place and to the player's count at $AC, takes the tiles' task's second set from the list at $CCB7, starts the stage's list of objects again at none placed, and clears the flag that says the time is over. Unless the new place is 2, 5 or 6 it also puts the counts at $EA and $0718 back to 8, starts the music if it had been changed, and sets the time from the list at $D847. Last, every object from 1 to 16 that isn't shown is gone.

The zombies stop there: bank 2's $8416 only makes them in places 0 and 7.

In the first set of stages two blocks are solid across half their width, at $E3F3: $76 where the place across is 8 or more into its 16 pixels, and $77 where it's less. They're the edges of the gaps in the ground on the eighth screen.

On a longer run that stood with the knights first, one frame of sound, 4314, differed from the original's, with every picture and all work memory the same. It's in the kit's sound, not the game's code, and isn't found yet.
