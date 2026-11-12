# The Egg Ball seeds the random numbers with the frame count, so a start point has to count the frames it leaves out.

About: Casino Paradise Zone act 2; sonic-casino-paradise-act-2

Proof: #739; sonic-casino-paradise-act-2

When the Egg Ball is made, it sets gPseudoRandom, at 0x03004C58, to gFrameCount, at 0x03001B24. In `sonic-casino-paradise-act-2` that is frame 9201, where the original's count is 9553, and the boss's first path choice and the fireworks' places after it follow from that number.

The recording's start point leaves out 371 frames the original runs, its two `onlyInOriginal` stretches of 126 and 245 frames, so the Dreamport's count was that much lower. The start word `only=371` adds them back as the act starts (`act_start` in `act.c`), and the boss and the fireworks then match on every frame.

The dropped rings' sprite is made with the stage, so it also animates through the frames after the card that the start point runs without objects. Four steps there (`rings_start_point` in `rings.c`) make the rings Sonic drops at the first hit match; three, five and six don't.
