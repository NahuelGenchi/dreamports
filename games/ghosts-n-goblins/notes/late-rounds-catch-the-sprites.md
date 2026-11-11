# A round that starts in a frame where tasks have already run is caught by V-blank while the sprites' list is filled.

About: the whole game; game-start

Proof: #1005; game-start

A round of the tasks takes 18,000 to 25,000 of the frame's 29,780 processor cycles, most of it in the sprites' task at bank 4's $8000, whose loop at $8059 fills the rest of the list at $0200. When a task has waited in a loop for V-blank and then finishes its turn, the rest of that round runs, and the next round starts at once, as $4E is already 2 or more. V-blank then comes during the second round's sprites' task: the new list at $0200 is made, the backwards copy at $0300 is still last round's, and the tiles' task hasn't had its turn. Whichever list is that frame's goes to the PPU as it is.

It happens at the original's start and at frames 99, 133 and 315 of game-start. At 315 it decides which V-blank writes each row of tiles and which quarter of the colour attributes, so the frames after it depend on it. The Dreamport has the sprites' task wait for V-blank between its two lists in such a round, and with that its work memory matches the emulator's at those frames too.

It doesn't count the processor's cycles. In the opening scene's rounds from frame 729 to 751, which take about 30,000 cycles, V-blank finds the tiles' task adding to the list at $0720, with $4F on, and writes the list a frame later. The Dreamport writes it a frame early there, which can't be seen: the tiles that change aren't on the screen, and the attributes are written once a round either way. The note stage-rounds-outrun-the-frame has the case that can be seen.
