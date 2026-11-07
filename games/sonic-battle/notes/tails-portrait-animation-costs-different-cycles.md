# Tails's portrait animation costs different cycles, which can move an arena colour landing by a line.

About: Tails's moves; tails-moves; tails-moving; 0x08015924; 0x08011c7c

Proof: #454; tails-moves; tails-moving

The original's 0x08015924 runs 410 instructions and 1546 cycles for Tails's face at frame 104 of a Training fight, against 195 and 721 for Sonic's, and at frame 392 it runs 82 and 257 against 195 and 721. The port counts 430 cycles for each step that asks for a picture and none for a step that only scans, so a frame's total can be a few hundred cycles off, and the arena's moving colours can land a line earlier or later. That showed at frames 104 and 392 of a Tails recording whose Start was at 1201, one pixel each time and the console holding the same in both. The Tails recordings press Start at frame 1198 instead, which moves the landing off the visible pixels, and every frame they play matches. A recording at another Start frame can still show it.
