# A Mini-games picture's colours can land while the screen is drawn, and how far down depends on the sound playing.

About: The mini-games; mini-games-open; mini-games-locked; 0x08031e68

Proof: #508; mini-games-open; mini-games-locked

With every entry open, 0x08031e68 unpacks the tiles and then the palette of the entry's picture past the interrupt at line 1, so SoundMain's cycles come before its colours land, and the top lines of the picture, from line 49, keep the old ones for a frame. Counting the unpacking's cycles as mGBA does and adding SoundMain's gives every frame of `mini-games-open`, whose colours land after line 49 at frame 1360 and line 55 at frame 1600. With the new letters' cycles too, the same total says when a move passes the next V-blank: the lost frames showed in BG3VOFS at 251,244 cycles or more and the kept ones at 239,677 or fewer, which a move up to the second entry can reach too. Past about 267,500 the frame's scroll misses it as well, as at frame 1601. That run still had 47 of its 8,822 frames differing, a row or two of the picture each, as the sound's count is close but not exact. On a new save the pictures are short and land at once: `mini-games-locked` plays 64 presses with every frame the same.

#545 measured SoundMain (0x0804834C) per frame in mGBA over 176 moves (`mini-games-long`, which differs from frame 1296): the Dreamport's count is 828 cycles short, steadily, which the landing constant takes up, and leaves out CgbSound (0x08049C20), about 5,000 cycles with two or three channels sounding. Its frame also reads one or two off the original's. A landing one line (1,232 cycles) off shows, and a wrongly lost frame throws off all after it, as at frame 2248.
