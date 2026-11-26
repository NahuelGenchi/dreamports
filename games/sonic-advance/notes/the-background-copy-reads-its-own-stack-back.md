# The background copy keeps sixteen words on its stack and reads them back, even after its own copy wrote over them.

About: 0x08001AA4; The language screen, at the first start

Proof: #1901; #1896

`sa2__sub_8002B20` pushes lr, r7, r6, r5 and r4, then r10, r9 and r8, and takes 0x40 bytes more. It keeps the map's width at 0, a wide row's second half at 4, a tile's bytes at 8, a row's at 12, the column and row the view starts at at 16 and 20, a level's block column, the column in it, a run's bytes and the next column at 24, 28, 32 and 56, or at 36, 40, 44 and 52 when the background scrolls, the columns past the map's edge at 48 and a DMA's control or the place a turned tile goes at 60. It makes 30 stores there and 105 loads.

Three calls of the function check showed why the twin has to keep them in the same place. With seed 8 a made-up block map led a byte's read to `0x03007E84`, the r4 the function pushed. With seed 5 a copy 1,470 rows long ran through the whole fast work memory and over the frame, and the original went on with the tile's and the row's bytes the copy left at 8 and 12. Both left the same memory once the twin stored and read each word where the original does, and the check gave it the registers the call starts with.
