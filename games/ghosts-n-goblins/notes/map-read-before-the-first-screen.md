# Before a stage's first screen the view reads the map where no memory answers, and the proof's emulator reads 0 there.

About: game-start

Proof: #1005; game-start

The view starts two screens before the first stage's first, at screen $FE from the table at $CCC5, and moves right 8 pixels a round with the picture off, so the view's task draws 40 columns before the opening scene. For those screens sub_E945 takes a screen's number from the stage's list past its start, and the place it works out for that screen's blocks is below $8000, where this cartridge has no memory. The proof's emulator reads 0 from there, block 0, which is empty, and the Dreamport does the same. A real console would read whatever its bus last held.
