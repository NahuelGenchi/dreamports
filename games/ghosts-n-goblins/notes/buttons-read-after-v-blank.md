# The original reads its buttons in the V-blank interrupt, so the proof gives them to it a frame later.

About: the whole game; game-start

Proof: #1005; game-start

sub_C278 reads both controllers from the V-blank interrupt, just after the frame's PPU writes, into $42 and $44, with the A button left out of $43 and $45 while it stays held. That's after the V-blank, so original.json has keysAfterVBlank, and a frame's buttons reach the original in the frame the tools count as the next, as they reach the Dreamport.

The tasks only look at the buttons once a round, every other frame, so Start pressed on the title screen at frame 100 or 101 starts the game on the same frame either way: the screen turns black at frame 103.
