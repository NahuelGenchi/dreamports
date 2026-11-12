# The second stage's falling ledge holds Arthur as it falls: it's the way from the towers down to the ground.

About: Stage 2: The castle and the haunted apartments; falling-ledge

Proof: #991; falling-ledge

Kind $37, at $02C8 on the second stage's third screen, waits until Arthur is within 40 pixels across and 16 down, and then falls at its state's speed. Its turn at bank 4's $9D5F jumps to $9DF6, the same move and test kind $36 ends with, so while it's shown it holds Arthur just as the small ledge that goes up and down does: 16 pixels above it, with his flag $10 set, which his own turn reads as ground.

The ledge the towers end with stops at $0290 and the ground starts at $0300, 80 pixels lower, too far for a jump. In falling-ledge Arthur jumps from the ledge's end at frame 8486, lands on the falling one, walks right on it as it goes down, and jumps again at 8570, before it's under the ground's line. He lands at $0306.

A plant on the ledge above shoots at whoever walks on from $01C5 at once: its shot crosses the ledge at frame 8260. Waiting for it and walking from 8285 gets by.

A devil aiming at Arthur from a screen or more away takes sub_EF25's loop at $EF8E, which halves both distances until neither is a screen. No recording had been that far from one.

Two pieces had to be counted store by store, because a frame ends inside them here: the devil's shape, which $AA33 sets to $95 before sub_F576 adds its wing, and the sprites' task's change of bank at $F34F.
