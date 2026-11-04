# The arena's moving colours land where the frame's work and the sound's mixing take them, partway down the screen.

About: A fight's opening; fight-opening; 0x08011c7c

Proof: #447; fight-opening

The second half of 0x08011c7c writes the colours as it runs, after a V-blank. Its work, about 82,000 cycles as mGBA counts its instructions, usually ends just before the interrupt at line 1 (0x080185cc, with DISPSTAT's 0x128). When it doesn't, SoundMain takes the console's cycles first, 20,000 to 55,000 by how many channels play and how far their samples move, and the lines drawn by then keep the old colours: rows up to 33, 31, 30, 31 and 29 at frames 56, 104, 120, 136 and 160 of `fight-opening`, and at 144 row 31 has pixels of both palettes. Counting those cycles gives all 400 of its frames. A longer choice screen, 2,020 frames with nothing pressed, had 10 of its 250 frames with changing colours still differing by a line or two, as two costs are measured rather than counted, what's the same in every frame and 4 cycles more for each step of a sample than its instructions say.
