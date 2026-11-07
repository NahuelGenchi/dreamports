# The title screen's Start opens a player select whose colours change at frame 103.

About: The title screen; game-start

Proof: #1005; game-start

The title screen waits for Start at $C41F, then runs its player select at $C44B until the timer at $C4F9, and starts the stage at $C53B. In `game-start` the first difference is frame 103, by 6,807 pixels: the original's player select has changed the title screen's colours and shows PLAYER 1 READY at the left, while the Dreamport still has the title screen. The original's first stage frame is around 397, where the graveyard appears and its sound starts.
