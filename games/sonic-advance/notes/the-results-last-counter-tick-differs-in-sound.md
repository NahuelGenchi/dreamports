# The results' last counter tick still differs in sound by one frame in the C version.

About: Neo Green Hill Zone act 1; sonic-neo-green-hill

Proof: #734; sonic-neo-green-hill

Frame 7170 of `sonic-neo-green-hill` differs by its sound alone, around 125 Hz on the left, the original at 4.5 steps and the Dreamport at 1.4, 10.4 dB apart; every picture matches. The frame is the last of the results' counter ticks, song 140 on music player 2, which the original starts in the same frame its sound is heard while the kit's engine runs a song's first frame one frame later. The act's music is started a frame ahead for the same reason and its frames now match, but moving this tick, or starting it ahead, made other frames of the results differ instead. The JavaScript version differs at the same frame, so the cause is in the kit's sound timing rather than this act's code. The part waits on it.
