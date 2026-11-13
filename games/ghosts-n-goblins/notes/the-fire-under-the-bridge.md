# The fire under the fourth stage's bridge burns only while Arthur is within reach of it.

About: Stage 4: The eyeball rafts and the fire bridge; fire-bridge

Proof: #993; fire-bridge

The stage's list places kind $0F along the fire under the bridge. Its turn, sub_04_B9AD, keeps it hidden with its count at 0 while it's out of the view, or while Arthur is more than $30 pixels away across or $40 up or down (sub_F687). Within that, it's shown and its count goes up a round at a time: every two rounds it takes the next of the shapes $FA to $FD from the list at $B9F5, and the list at $BA05 gives the height of its touch box for that shape, 0, 10 or 20 pixels, four wide. It then jumps into the end of the enemies' tests at $F5E3, which sets Arthur's flag $01 when he's within that box, so the low shapes can't reach him.

In the recording the flames burn from frame 29789, as Arthur walks the bridge, and stay below him.
