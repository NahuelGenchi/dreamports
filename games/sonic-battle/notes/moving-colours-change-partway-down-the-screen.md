# The arena's moving colours change partway down the screen, on a line that changes from frame to frame.

About: A fight's opening; fight-opening; 0x08011c7c

Proof: #447; fight-opening

The second half of 0x08011c7c writes the colours as it runs, after a V-blank, and its work usually ends just before the display starts its next picture. When it doesn't, the interrupt at line 1 (0x080185cc, with DISPSTAT's 0x128) mixes the sound first, and the colours are written around lines 30 to 34, with the rows above still on the old ones. All the console holds is the same at frames 56, 104, 120, 136, 144 and 160 of `fight-opening`, and comparing each row of the original with both sets of colours gives its last row on the old ones: 33, 31, 30, 31, 29 for 56, 104, 120, 136, 160, and at 144 row 31 has pixels of both, as its two palettes fall on either side of a line. Frames 24, 40, 48, 64, 72 to 96, 112, 128, 152 and 168 show the new colours in rows these would have kept old, so their write comes before line 1. How much a frame does before the write doesn't say which: 104 and 112 make the same number of reads and writes, and 112 takes more division steps, yet only 104 is late. So which frames are late depends on the console's cycles to within a small margin.
