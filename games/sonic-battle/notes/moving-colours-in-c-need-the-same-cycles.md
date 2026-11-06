# The moving colours in C land on the same lines only with the same cycle counts as the JavaScript.

About: A fight's opening; fight-opening; 0x08011c7c

Proof: #626; fight-opening

The arena's moving colours land on a line worked out from the frame's counted cycles and SoundMain's (arena.c's `landColours`), so a few cycles off moves them a line and the picture differs while the console holds the same at the frame. Two things made the C version differ at frames 56, 104, 120, 136, 144 and 160 of `fight-opening`. Its `divArm` didn't count the BIOS division's cycles as `bus.js` does, and it read SoundMain's cycles from the engine that plays the sound rather than from a silent counting engine of its own, as `main.js`'s `countCycles` does, which starts with the chip's length counters partway and two frames gone by. With both, every frame's cycles are the same as the JavaScript's and all 400 frames match.
