# A round that starts in a frame where tasks have already run is caught by V-blank while the sprites' list is filled.

About: the whole game; game-start

Proof: #1086; game-start

A round of the tasks takes 18,000 to 25,000 of the frame's 29,780 processor cycles, most of it in the sprites' task at bank 4's $8000, whose loop at $8059 fills the rest of the list at $0200. When a task has waited in a loop for V-blank and then finishes its turn, the rest of that round runs, and the next round starts at once, as $4E is already 2 or more. V-blank then comes during the second round's sprites' task: the new list at $0200 is made, the backwards copy at $0300 is still last round's, and the tiles' task hasn't had its turn. Whichever list is that frame's goes to the PPU as it is.

It happens at the original's start and at frames 99, 133 and 315 of game-start. At 315 it decides which V-blank writes each row of tiles and which quarter of the colour attributes, so the frames after it depend on it.

In the opening scene's rounds from frame 729 to 751, which take about 30,000 cycles, V-blank finds the tiles' task adding to the list at $0720, with $4F on, and writes the list a frame later. Nothing of that can be seen, as the tiles that change aren't on the screen, but work memory shows it.

The Dreamport counts the processor's time, so its V-blank comes at the same place in the same task in all of these, and its work memory is the emulator's at the end of each of those frames. The note stage-rounds-outrun-the-frame has the case that can be seen.
