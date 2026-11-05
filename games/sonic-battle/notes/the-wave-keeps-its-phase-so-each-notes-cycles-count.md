# The wave voice keeps its phase from note to note, so frame 7580 of `options` needs each note's length to the cycle.

About: The main menu; options

Proof: #208; options

Frame 7580 of `options`, on the main menu after a new save, differed by 17.2 dB at 125 Hz on the right: the song's first wave note began at another place in its wave. mGBA's wave turns only while a note sounds and never starts over, so what plays there depends on the length in cycles of every wave note since the start, and a note's length depends on where in the frame SoundMain reaches its start and stop. Counted in whole frames, the Dreamport had drifted 14 of the wave's steps.

Three things took the drift away, each measured in mGBA. SoundMain starts about 84,800 cycles into the frame (`soundMainAt`), and each write comes after what it has counted so far. A stop from the game's own code comes where that code has reached, far from SoundMain (`waveAt`). A cursor move in the name entry that doesn't scroll the grid comes before SoundMain in the original's frame, not after it, so the sound's first frame costs its 2,100 to 2,400 cycles a frame sooner (`beforeSoundMain`): one that scrolls draws the grid first, and comes after.

For all this the wave's writes reach the chip a frame later than the other voices', when they land where mGBA's do. Why the name entry's song starts 26,748 cycles sooner after Delete data isn't established: it's what mGBA measures. The other screens' sounds aren't marked as coming before SoundMain, though many do, as the frames that follow them don't differ.
