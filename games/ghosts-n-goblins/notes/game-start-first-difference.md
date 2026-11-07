# The title screen turns black three frames after Start, and its player select text first differs at frame 133.

About: The title screen; game-start

Proof: #1005; game-start

The title screen waits for Start at $C41F, then its start code at $C424 sets the timer and the sword's object, and its picture turns black at frame 103. The Dreamport turns its picture off three frames after Start, so frames 103 to 132 match. The player select's text at the left is the first difference, frame 133, by 412 pixels, typeset over the logo's left area. The original's first stage frame is around 397, where the graveyard appears and its sound starts.
