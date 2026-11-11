# Up climbs a ladder, and Down climbs down one or crouches, by the block under Arthur.

About: Arthur moving; ladder

Proof: #978; ladder

A ladder is made of the stage's blocks $BA to $CF. Sub_DC3E reads the block at Arthur's place and sub_DC38 the one 11 pixels below it, and both say whether it's one of those. The blocks from $C6 up are solid too, so a ladder's top is ground to stand on.

Up goes to $DC6B, which does nothing where no ladder is. On one, each round at $DC73 gives him the ladder's colours, puts him on the ladder's middle, the 8 pixels of its block, and moves him at speed $0C the way he's heading, 0 for up and 8 for down, with the two shapes of sub_DDB2. Down on the way up, or Up on the way down, turns him round, and with neither he stays where he is. Where the ladder ends above him he's sent to $DD65, the same place Down goes to from the ground.

$DD65 reads the block under his feet. Solid ground from $D0 up makes him crouch. Anything else is a ladder's top: he waits half over it, shape $1F, until Up stands him on the ground again or Down starts him down the ladder, round by round at $DCC6. At the ladder's foot he stands on the block and goes straight to the crouch.

The crouch, at $DD14, sets his flag $02 each round. A jumps from it without noting that A is held, as a jump from standing does. Letting go of every direction, or holding Up, stands him up, and Left and Right turn him. His shape is $10, or $11 facing left. Sub_F68E takes his height as 4 pixels either way from his place, where standing it's 8 from a middle 4 pixels up.
