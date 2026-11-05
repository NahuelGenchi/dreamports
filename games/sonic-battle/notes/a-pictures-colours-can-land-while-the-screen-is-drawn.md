# A Mini-games picture's colours can land while the screen is drawn, and how far down depends on the sound playing.

About: The mini-games; mini-games-open; mini-games-locked; mini-games-long; 0x08031e68

Proof: #508; #545; mini-games-open; mini-games-locked; mini-games-long

With every entry open, 0x08031e68 unpacks the tiles and then the palette of the entry's picture past the interrupt at line 1, so SoundMain's cycles come before its colours land, and the lines drawn by then, from line 49 of the picture, keep the old ones for a frame. On a new save the pictures are short and land at once.

#545 measured SoundMain (0x0804834C) in mGBA over 176 moves. The colours land after the cycles to the tiles' unpacking (20 more going down than up), the unpacking, 250 more, SoundMain's, and the sound chip's DMA: 18 cycles every 25,536. The first line with the new colours is the first drawn after that, each line being drawn 1,008 cycles into it.

A landing a line off shows, so the count had to be right to a few cycles, with no line or frame written down. It took counting CgbSound (0x08049C20), 253 to 1,445 cycles, with its SOUNDCNT_X check and the chip's sequencer behind it; and two more sound frames at the start, for the envelope's step and for 0x08049744's restart of the DMA, 110 cycles every ninth frame.

A move past the next V-blank loses a frame of the list. Past 245,000 cycles of work (243,988 kept, 245,880 lost) the sprites stay in time, past 246,600 (247,361 late) they take the frame after, and past 267,500 the scroll does too.

A second run of 176 other moves, not kept, had all 9,977 frames the same. PSG voices 1 and 2 don't sound on this screen, so their costs are voice 4's, unmeasured.
