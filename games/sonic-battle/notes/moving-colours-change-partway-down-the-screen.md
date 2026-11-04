# The arena's moving colours change partway down the screen, on a line that changes from frame to frame.

About: A fight's opening; fight-opening; 0x08011c7c

Proof: #447; fight-opening

The second half of 0x08011c7c writes the colours as it runs, while the display is drawing, so the lines above that moment keep the old ones. `prove` finds all the console holds the same at frames 56, 104, 120, 136, 144 and 160 of `fight-opening`, and a band of up to 194 pixels in rows 25 to 33 differs. Writing the colours after a fixed line in the Dreamport matched frame 56 only at line 33, 104 and 136 at 31, 160 at 29 and 120 at 30, and 144 at none tried. Frame 168 needs line 7 or sooner, and the other frames of every 8 line 24 or sooner. The sprites queued and the copies waiting don't explain which frames are late: 56 and 64 have the same counts, and only 56 is late.
