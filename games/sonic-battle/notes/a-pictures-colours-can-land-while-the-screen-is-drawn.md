# A Mini-games picture's colours can land while the screen is drawn, and how far down depends on the sound playing.

About: The mini-games; mini-games-open; mini-games-locked; 0x08031e68

Proof: #508; mini-games-open; mini-games-locked

With every entry open, 0x08031e68 unpacks the tiles and then the palette of the third entry's long picture while the screen is reached, so the top lines of the picture keep the old colours for a frame. `mini-games-open` differs for this at frames 1360 and 1600 to 1601. Pressing down from the second entry to the third 24 times, 74 frames apart, gave no visible lines when the kit's sound engine had 2 or 3 channels on, the colours landing after lines 50 to 55 with 4, and after lines 55 to 60 with 5. Up to line 50 only the frame's sprites miss the next V-blank, as at frame 1281, and from line 51 its scroll misses it too, as at frame 1601. So the original's sound work in the V-blank sets it, and the same count of channels can still differ by five lines, which is finer than the kit measures. On a new save the pictures are short: `mini-games-locked` plays 64 presses with every frame the same.
