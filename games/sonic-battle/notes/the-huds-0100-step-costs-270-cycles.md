# The HUD animation's 0x0100 step costs 270 cycles, and Rouge's portrait needs it.

About: Rouge's moves; rouge-moves; rouge-moving; 0x08015924; 0x08011c7c

Proof: #460; rouge-moving; rouge-moves

Rouge's portrait script for animation 19 uses the command 0x01000000 at marker 26, where Tails' script uses a 0x1000 picture command instead. The original's 0x08015924 takes its default path for that command and spends 270 cycles there. Without those 270 cycles the port's frame has 270 fewer than the original, and the arena's moving colours land at row 32 instead of row 33 at frame 56 of the Rouge recordings. The seven Rouge recordings match every frame once the step adds that cost; no other script in the recordings uses 0x0100.
