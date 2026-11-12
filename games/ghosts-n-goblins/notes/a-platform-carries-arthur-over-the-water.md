# A platform goes from side to side over the water, and holds Arthur when he comes down onto it.

About: Arthur moving; Stage 1: The graveyard; platform

Proof: #983; platform

Kind $0E, at bank 4's $B84D, is a moving platform. The stage's list places it with $D706, heading left, and gives it a state that picks its two ends from the lists at $B95D and $B97D and its speed from $B99D: the first stage's goes between $0690 and $06E8 at speed 8. At an end it turns, and doesn't move that round while it's shown.

After its move, at $B8BE, it looks for Arthur: not on his way up in a jump, not held already, less than 13 pixels above it, and within 16 pixels of its middle. Then it sets his flag $10, puts him 12 pixels above its own place, and adds its own move to his place across. His turn reads the flag as ground under him, at $DAF9, and so do his fall, at $E296, and his jump, and clears it as it ends, so the platform has to set it again every round.

Sub_84E0, the first of the stage's other dangers, starts looking at Arthur's place once he's on the eighth screen, and from 64 pixels in sends something at him, which isn't ported.

A hidden thing that Arthur touches, at $BBAD, becomes a pot, kind $12, 100 pixels further on and 16 higher, falling, with what its state says inside. One whose flag $01 is set needs him crouching, and the armour isn't given to an Arthur who has his.
