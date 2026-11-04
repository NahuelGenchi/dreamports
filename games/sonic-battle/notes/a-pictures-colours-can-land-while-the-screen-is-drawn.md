# A Mini-games picture's colours can land while the screen is drawn, and how far down depends on the sound playing.

About: The mini-games; mini-games-open; mini-games-locked; 0x08031e68

Proof: #508; mini-games-open; mini-games-locked

With every entry open, 0x08031e68 unpacks the tiles and then the palette of the entry's picture past the interrupt at line 1, so SoundMain's cycles come before its colours land, and the top lines of the picture, from line 49, keep the old ones for a frame. Counting the unpacking's cycles as mGBA does and adding SoundMain's gives every frame of `mini-games-open`, whose colours land after line 49 at frame 1360 and line 55 at frame 1600. A longer run, 176 moves through all five entries, not kept, still had 14 of its first 63 moves landing a line or two off, so the count isn't exact, and a measured constant sets it. Past line 50 the third entry's move, with a new row's letters, also has its scroll miss the next V-blank, as at frame 1601, and from around frame 3,900 of that longer run the whole screen differed, which this doesn't explain. On a new save the pictures are short and land at once: `mini-games-locked` plays 64 presses with every frame the same.
